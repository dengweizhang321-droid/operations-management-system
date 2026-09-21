# 启动与发布诊断复核及优化候选

本候选基于 `ae3d0780`，对照同事的[诊断报告](https://claude.ai/artifact/DSjjmPVVwmKfLNPingSs4H)和 2026-09-21 本机日志核验。尚未部署，不能把下面的测试结果表述为正式停服时间已经缩短。

## 已核实的现状

- 9 月 21 日 Django 启动从 13:57:02.445 到 13:59:08.756，约 **126.31 秒**。核心域就绪约 50.08 秒，之后各域合计约 76.23 秒；本轮完整 ACL 审计 13.117 秒，AI 域约 18.58 秒。该范围不包含外层总控、Worker 完整启动和后续钉钉启动，不是整机开机到可用时间。
- 23 个业务服务及逐域等待属实。报告的“约 35 次 Python 冷启动”仍是按代码推算，日志没有逐一记录所有短命探针，不能称为实测进程总数。
- 周报每五分钟的失败记录只是离散采样，不能用失败次数乘五分钟充当精确停服时长。
- `Assert-WranglerLocalR2RoundTrip` 原来已经使用唯一 `run/wrangler-smoke-*/state`，本次保留该隔离方式。此前超时不足以证明 R2 存储目录争用；本轮长临时路径中也遇到了 CLI 超时，缩短测试路径并使用官方真实版本元数据缓存后完整门禁通过，未放宽超时、删掉检查或修改依赖。尚不足以区分路径、版本检查和机器负载各自的影响。

## 本次实现

| 报告建议 | 处理及保护条件 |
| --- | --- |
| A1：构建与暂存前移 | Worker 增加显式 `plan --prepare-online`；Django 增加 `PrepareApp` 和绑定收据的部署。只准备候选，不改变生效版本。 |
| A2：代码发布保留 PostgreSQL | `EnterMaintenance -KeepPostgres` 将维护范围持久保存；只停止应用，保留有准确身份且 ready 的 PostgreSQL。普通完整维护仍要求数据库停止。 |
| A3：Worker-only | 现有 `Stop` 不带 `IncludeBackend` 已支持。沿用原快速路径，部署前仍核验后端、任务排空和候选版本。 |
| B1：同域重叠启动 | 11 个读写域先拉起 reader，再拉起 writer，最后等待二者就绪；BI 仍只有 reader。复用已有实例时仍先核验其就绪状态。 |
| B2：跨域并行 | 暂不采用。当前域控制器共用同线程可重入互斥、进程环境变量及本轮 ACL 上下文；并非只因端口不同就可以安全并行。需要独立的凭据环境隔离、锁协议和连接峰值验证。 |
| B3：合并探针 | 暂不采用。必须显式绑定各角色的独立数据库连接并防止 Django 连接缓存或环境切换串用，不能把探针简单放进同一进程。 |
| B4：pandas 异步准备 | 暂不采用。需同时调整 capability/readiness、精确进程回收及 AI 启动失败语义，再做真实容器验证。 |
| B5：跳过迁移/授权重置 | 保留当前检查；本次没有降低权限、迁移或完整性门槛。 |
| A4：蓝绿及维护页 | 本次不改变固定端口、路由或单 writer 所有权；没有承诺零停机。 |

### Worker 在线准备

从已审查的干净候选集成树执行 `node tools/worker-local-release-rotation.mjs plan --prepare-online --json`。固定源仍为 `D:\运营管理系统-sales-django-release`；运行中的生产保护入口必须保持前驱原字节，不能先更新这些入口再准备。

准备前、候选校验和计划发布时都重新解析完整 successor 链及已安装入口，并使用前驱自身不可变校验器按 `stopped-or-exact-release` 复验进程。构建期间保留发布互斥，释放生命周期互斥，让原恢复链继续可用；每个校验边界重新取得生命周期互斥。前驱变化、未知端口/进程、损坏回执均拒绝计划。

候选仍做完整源码、依赖、构建、合约、guard、helper、硬链接和摘要验证；准备专用内部校验不产生启动许可。公开 Verify、Start、apply 的原进程门禁不变。首次 D1 控制退役采用不能使用在线准备。

### Django 提前准备及应用维护

1. 从候选源码树执行 `powershell -NoProfile -File tools/django-local-service.ps1 -Action PrepareApp`，保存返回的 `id` 与 `receiptSha256`。
2. `PrepareApp` 复制完整应用/运行依赖，执行原 R2 往返自检并计算原算法完整指纹，写入唯一候选及收据。准备不持有长时间生命周期锁，不移动 `app/`，前后绑定同一前驱部署清单。
3. 经本次发布明确授权，排空业务任务，完成发布前备份与独立恢复验证；从唯一 Worker 引擎进入 `EnterMaintenance -KeepPostgres`。首次采用新版生命周期脚本仍用旧版完整维护，不能把新参数传给旧版 runtime。
4. 从候选源码执行 `DeployApp -PreparedAppId <id> -PreparedAppSha256 <receiptSha256>`。切换前重查维护、Worker/helper/supervisor 停止、全部应用进程/端口、数据库身份和就绪、收据与前驱绑定、完整候选指纹及重解析点。过期前驱或篡改候选必须重新准备。
5. 按原受控流程完成 HardenAcl、Worker apply、精确 ID 的 ExitMaintenance，再调用唯一 Worker Start。维护记录决定是否允许数据库保持运行，不依赖调用者退出时临时改参数。Start 仍执行 migrate、最小权限重置、写权探针及全部 reader/writer 就绪检查。
6. 验证 12 组件、effective release、启动绑定、守护与已批准渠道；完成发布后备份及 E 盘归档。迁移/启动失败保留维护或失败状态，按原恢复协议处理，不自动补跑业务或重发通知。

不带准备参数的 DeployApp 保留原兼容路径；应用版本回退仍须遵守迁移兼容性与原恢复约束，不是数据库回滚。旧维护记录没有 `keepPostgres` 时按完整维护处理。

### 同域启动失败处理

仅本轮新建 reader 可以延迟等待，其进程归属立即交给原 stack 的清理逻辑。writer 启动失败或最终 reader 就绪失败时，只清理本轮新建进程；原来已运行的 reader/writer 不被误杀。authority 校验、全栈 128 连接门槛、角色凭据、单 writer、ACL 及生命周期锁保持原样。

## 验证与限制

- 新增 Windows PowerShell 5.1/PowerShell 7 行为测试：11 个 reader 的独立/延迟/复用/未知端口/失败清理，stack 启动失败及已有进程保护；准备文件和收据篡改、前驱变化、路径逃逸；应用/完整维护及数据库身份、就绪和范围变更拒绝。
- 本轮相关 Django 和生命周期测试 42/42 通过；发布链原回归在全量测试中通过。
- 全量 Node：2243 项，2218 通过、23 跳过、2 失败。两项失败分别是财务静态路由断言、缺失 `color-surface-subtle`；在独立干净的原始 `ae3d0780` 副本复现，未修改这两项业务代码或用户已有修复。
- 独立生产构建、456 个模块的后端边界检查通过；lint 0 错误、11 项既有警告。
- 独立临时 runtime 的真实复制、摘要、Wrangler 版本/帮助及 R2 put/get/delete/缺失回查通过。首次准备 45.914 秒，文件切换及复验 12.589 秒，已有安装上的第二次准备 50.593 秒；准备前后已安装 manifest 不变。该演练只替代应用停机探针，不创建业务数据库、真实服务或生产凭据，不能作为生产进程切换验收。
- 尚未执行正式维护、数据库迁移、生产停止/启动、Worker 在线完整候选的实际生产准备或新冷启动计时。首次采用需要备份恢复门禁、实际不可变候选校验及用户发布授权；不能据此承诺两至五分钟停服或冷启动减半。

最小回归入口：`node --import tsx --test tests/startup-release-optimization.test.ts tests/django-local-service.test.ts tests/system-lifecycle-race.test.ts`。真实文件/R2 演练入口：`tests/django-prepared-app-runtime.test.ps1`，使用独立短路径 TEMP/TMP，避免长路径引入的额外变量。
