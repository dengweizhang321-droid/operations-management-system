# 第七项：启动速度候选与交付

依据总评估 [4.7 节](SYSTEM_OPTIMIZATION_ASSESSMENT_20260928.md#47-第七项启动速度)。基线 `e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e`；独立分支 `codex/startup-speed`，工作树 `D:\.codex\worktrees\startup-speed\运营管理系统`。

本文件独立保存第七项进度和证据，由用户指定的统一收尾对话更新总评估。未合并 main、未发布、未改登录启动项、未停启正式服务、未重启电脑、未访问业务数据或触发通知。候选不改变数据库、凭据、迁移和授权策略。

## 1. 统一测量口径

| 类型 | 开始边界 | 成功结束边界 | 必须固定/记录的条件 |
| --- | --- | --- | --- |
| 整机登录后启动 | Windows 本次登录事件时间；另列登录触发器实际派发时间 | 原总控完整回查通过，12 个组件、全部已配置健康端点、Worker/helper、必要 AI/pandas 和渠道均满足原就绪规则 | 同一用户/启动项、重启类型、操作系统/WSL 缓存、版本和数据规模；登录延迟、锁等待单列 |
| 保留数据库的应用启动 | PostgreSQL 原 PID/创建时间和 ready 已确认，应用已受控停止；发出唯一 Start 请求时刻 | 同上，并确认 PostgreSQL 身份未变化 | 相同数据库/迁移、相同 release、相同域启用状态、相同 pandas 初始状态；是否包含外层桌面打开须固定 |
| Worker-only 启动 | Django/PostgreSQL/pandas 已全部就绪，Worker/helper 受控停止；唯一 Start 请求时刻 | 原全栈和 HTTP 就绪回查通过 | 后端 PID、版本不变，Worker 缓存条件相同；不能用“already_running”代替新启动 |

另列 `Django Start` 子区间、只读加入并发启动的等待区间、最终回查区间。记录父子控制器 PID、开始时间和原 runId，不能把包含关系的耗时相加。`completed` 表示该函数正常结束，绝不等同于整栈就绪；最终成功只使用原控制器结果。失败样本保留阶段、退出码和失败原因类别，不混入成功时延。

正式比较每类至少 5 个前后配对样本，交替顺序，报告每次值、最小/中位/最大及负载，不凭少量样本声称 P95。整机重启、正式停启须逐次纳入获批方案；本轮不以反复正式停启取得数字。

## 2. 实现与历史证据核对

- 历史 126.311 秒和优化后 87.640 秒均为 Django 子区间，负载不同且每次仅一次；166.246 秒为保留 PostgreSQL 的实际桌面应用启动。都不能作为整机登录后启动耗时，也不能直接推导提速比例。见 [既有优化](STARTUP_RELEASE_OPTIMIZATION.md)、[首次并发启动](COLD_START_COORDINATION.md)。
- 本轮只读核验主工作区和正式安装的基础、AI、网店、市场四个控制器原始 SHA-256 完全相同。[只读历史证据](evidence/startup-speed-history-20260929.json)保存摘要和脱敏事件，未发出新 Start。
- 9 月 28 日 22:54:16.450–22:55:49.262 的 Django Start 为 **92.812 秒**。核心栈 ready 用时 **30.777 秒**，其后域启动约 **62.035 秒**；ACL 是原生明确计时 **8.467 秒 / 118,511 对象**。
- ACL 完成到 `django_migrations_applied` 约 7.949 秒包含数据库身份/容量、迁移、授权等，不能当作纯迁移耗时。核心末段约 9.347 秒包含权威核验和销售/财务服务启动。旧日志没有足够细的边界，不能伪造各子阶段数字。
- 各子域 ACL 复用事件之间的包络时间约为：网店 4.689、市场 4.812、商品 5.178、库存 5.702、运营事务 5.099、客服 5.044、权限 4.805、AI 15.477、ERP 6.705、BI 到顶层结束 4.422 秒。这些包含相邻控制器派发开销，只用于定位下一次采样；AI 的 15.477 秒不能直接全归因于 pandas。

当前已采用同域 reader/writer 重叠、一次顶层 ACL 全树审计及短时同进程上下文复用、原 Worker prelaunch 校验交接；本轮保留并复用。当前无证据支持再次跳过 ACL、迁移或权限重置。

## 3. 本轮修改

### 3.1 仅去除新建 writer 的重复等待

11 个域原顺序为：reader 拉起并交还所有权 → writer 拉起并等其 ready → stack 等 reader → stack 再等 writer。新建 writer 的第二次即时检查确实重复。

复用 reader 的 `-DeferReady` 协议：writer 完成精确进程登记后立即把“本轮新建”结果交给 stack，最后仍逐一等待 reader/writer。全新 11 对服务的该片段稳定就绪请求从 33 次降为 22 次。BI 不改等待协议。

- 独立 writer 调用仍自行等 ready 并在失败时清理新进程。
- 已有 writer 即使收到 `-DeferReady` 也先验原身份和 ready，返回 false；不将既有进程纳入回滚。
- 最终 reader 或 writer 检查失败，stack 只回收本轮创建的进程；保留既有实例。销售已成功后财务失败仍保留销售的原规则。
- authority、端口、版本、ACL、单 writer、迁移/授权和连接容量门禁未改变。域间仍串行，环境变量/角色连接没有跨域共享或合并。

### 3.2 分阶段计时

使用单调 Stopwatch 计耗时，UTC 时间用于跨日志关联。Django 复用原有有界 launcher 日志，事件为 `startup_phase`；Worker 写入 `logs/startup-timing.jsonl`，达到 1 MiB 后仅保留一个轮换文件。只记录固定阶段名、开始时间、耗时、completed/failed 和 PID；不记录参数、连接串、凭据、完整命令或异常正文。Status 路径不新增计时写入，日志失败不会覆盖原返回值/异常。

| 范围 | 阶段 |
| --- | --- |
| Django 安全/基础 | 应用清单核验、完整 ACL、PostgreSQL 启动/复用、连接容量 |
| 迁移及授权 | `Invoke-DjangoMigrations` 总包络，原 migrate 子进程及原 grants 子进程分别记录，非零退出码记 failed |
| 各域 | 原 stack 总包络、authority/迁移状态探针、精确 `launch-<service>`，`Wait-DjangoReady-<role>` |
| AI | AI stack/authority、独立同步 `Start-PandasSandbox`，AI reader/writer 最终等待 |
| Worker/helper | 后端预检/必要启动、Django 子控制器、原完整 release 校验、supervisor 到 Worker/helper 就绪、原渠道检查、加入既有启动结果 |

这些是嵌套区间。最终总控的 12 组件及 HTTP 回查仍是独立结束门槛，没有删减、合并或替代探针。锁等待、shell 解析、跨进程派发和外层最终回查须以外层起止/原日志补齐，不能用内部计时之和冒充总耗时。

## 4. 隔离验证与测量

验证只使用随机临时目录、独立命名互斥和动态高位 loopback 端口。没有创建或连接业务数据库、没有使用生产凭据；进程启动以夹具替代，真实 OS 进程用于并发锁、退出码及原进程身份回归。依赖通过只读使用主树 node_modules 的 junction 解析，未安装或修改共享依赖。

基准程序 `node tests/startup-speed-benchmark.mjs` 从固定基线提取原函数，和候选函数交替运行；使用真实 `Wait-DjangoReady` HTTP 请求、同一个隔离返回 200 的服务，11 个 writer 函数，先预热一对，再各测 5 次。没有模拟睡眠、数据库查询、真实 Waitress/Worker 或容器启动。计时只覆盖同域就绪片段，**不是上述三类整栈启动的验收**。[精确样本及负载](evidence/startup-speed-benchmark-20260929.json)保留全部 20 个样本。

| Shell | 基线 min / median / max（ms） | 候选 min / median / max（ms） | 采样段整机 CPU busy |
| --- | --- | --- | --- |
| Windows PowerShell 5.1.26100.9168 | 713.95 / 777.94 / 966.66 | 467.81 / 516.12 / 663.47 | 62.9% |
| PowerShell 7.6.5 | 111.96 / 122.47 / 158.09 | 75.68 / 118.43 / 161.07 | 82.3% |

每次 baseline 33 请求、candidate 22 请求，含预热共 660 个隔离请求。最后这轮本任务没有并发测试/lint/构建/恢复/压力任务，但正式系统与其他任务持续在线；只是相同程序、端口、数据及交替协议，**不能声称整机负载完全相同**。PS7 中位仅少 4.04 ms，5 对中有 2 对候选更慢，尚不能证明稳定时延收益；PS5 中位少 261.82 ms 也只适用于该片段。不能将请求减少三分之一说成整栈提速三分之一。未清空系统缓存或终止其他任务来控制负载。

已覆盖的行为：

- 两种 PowerShell 下 11 reader + 11 writer 的独立调用、延迟等待、已有实例、已有但不就绪实例、未知端口及新实例失败清理。
- 9 个实际域 stack 的 108 组 reader/writer 最终检查与已有实例组合、9 组 writer 拉起失败，精确核对清理对象。
- 原 ACL 上下文超时/跨进程/路径/清单绑定拒绝，原应用版本与进程身份、维护保护、部署回滚、原并发 Start/超时、桌面最终回查与原退出码回归。
- 新计时日志脱敏字段、有界轮换、只读 Status 不写、记录失败不替换真实错误；真实短命子进程返回 37 仍保留 37，并标记迁移阶段 failed。

首次运行中 PS5 测试文件因 BOM 丢失解析失败，已恢复；长等待测试期间本任务改动控制器使摘要 fence 正确拒绝一次，冻结源码后重跑。原失败记录保留在本工作树 `.runtime/startup-speed`，不冒充首次全绿。

## 5. 并行协作与依赖

没有其他优化分支的提交依赖；基于共同 main `e00d4a82`，暂不合并或改总评估。

| 重叠文件/区域 | 建议分工和组合验证 |
| --- | --- |
| `tools/django-local-service.ps1` | 本项改启动/就绪计时及 writer 等待；第 4 项保留维护准入，第 6 项保留 R2 自检，第 1 项保留备份/恢复门禁。按函数合并，不能整文件覆盖 |
| `tools/worker-local-service.ps1` | 本项仅原启动函数外围计时；第 2 项处理 supervisor 退出，第 4 项处理维护。合并后重新验 Start/Restart/维护、失败退出码及已有实例 |
| 各 `django-*-service.ps1`、`django-ai.ps1`、`django-access-control.ps1`、`django-erp-reference.ps1` | writer 的 `-DeferReady` 与调用者最终等待及回滚必须一起保留；AI pandas 仍同步。不能只合调用端或只合 writer |
| `tests/startup-release-optimization.test.ps1` | 本项扩展现有 reader 夹具覆盖 writer；保留其他优化对准备/维护的断言 |

本轮未做大型构建、恢复或压力测试，避免干扰其他任务。没有前端/Worker bundle/数据库实现变化，不以无关全库压力代替生命周期定向验证；正式组合发布前仍须原完整构建及候选门禁。未修改 supervisor、总控 UI、Wrangler、自检、备份、业务查询、调度和其他工作树。

## 6. 待用户确认的正式方案与回滚

本节是后续方案，不是执行授权。由统一收尾对话合并相关分支并完成组合验证之后再提交确认：

1. 固定集成提交，检查其他优化的共享函数变更；在独立目录先通过上述相关测试，再按原流程完成完整构建、Worker 在线候选准备及 Django PrepareApp。准备不改变正式 effective head 或启动项。
2. 列出当前/候选精确 release、部署清单、脚本指纹、12 组件清单、已配置端点、在途业务/helper/备份任务，固定数据库规模和 138 条迁移（届时重新核验，不能沿用历史数字）。确认有可用且独立恢复通过的前备份及 E 盘归档、前驱应用/Worker 包保留。
3. 申请明确的应用维护窗口、每类可执行样本次数及允许的 pandas 初始状态。优先沿用唯一 Worker `EnterMaintenance -KeepPostgres`、受控 Django 部署与 Worker apply、精确 ExitMaintenance、唯一 Start；绝不直接覆盖正式控制器、杀服务或绕过运行意图。
4. 成功必须精确核对 12 组件、所有原端点、角色/进程身份、当前 release/清单和启动绑定，以及原 AI/pandas/渠道状态；完成原前后备份规则。不触发业务补跑或测试消息来证明启动。
5. 若失败，保留原维护/错误和阶段证据，按原身份规则仅回收本轮新建实例。候选没有新增迁移；经核验数据库兼容后，以原部署/激活工具切回已保留的前驱兼容应用和 Worker，不手工修改 manifest 或删除版本链。数据库不逆迁移；不能确认兼容时停止并交人工决定。上线确认须明确包含该失败恢复窗口。
6. 整机登录测试单独获准后执行；保存工作、记录重启/登录事件，分别测不点击的自然启动和一次并发桌面打开。正式 Worker-only 和应用启动样本分开记录，禁止混算。

跨域并行、合并探针、pandas 异步准备仍不启用。今后确需采用时，先在独立数据库/凭据/端口环境验证角色连接隔离、同线程可重入锁迁移方案、连接峰值、未知结果及失败清理、完整就绪屏障；本次只删除重复 HTTP 等待不能作为它们的安全证明。

## 7. 交付状态

阶段计时及重复等待候选已开发。[验证清单](evidence/startup-speed-validation-20260929.json)：核心回归 46/46、各域回归 57/57（其中 2 项与核心重复）、Worker/总控 39/39，去重 **140 项通过**；最终新增夹具复验 5/5。全库 lint 为 0 错误、12 项未改文件警告，新增 JS/TS 定向 lint 零警告；后端边界检查 544 模块/0 违规，`git diff --check` 通过。未运行全库单测或生产构建；本轮采用串行、定向生命周期回归，不覆盖其他任务的业务功能。

正式三类启动均未取得本轮前后配对样本；不存在整机提速、生产稳定比例或全部启动目标达成的结论。主工作区及总评估保持不变；分支和工作树继续保留给统一收尾合并。

源码、测试和证据提交 **`47706d2e50e24dae445405a656506b3cfc99126e`** 已推送 `origin/codex/startup-speed`，通过 `git ls-remote` 精确核对。随后仅补本节交付状态；最终分支 HEAD 以交付消息和远端同名分支为准。无其他分支提交依赖，尚未合并 main、未生产采用。

精确变更文件（21 个）：

```text
tools/django-local-service.ps1
tools/django-netshop-service.ps1
tools/django-market-service.ps1
tools/django-products-service.ps1
tools/django-inventory-service.ps1
tools/django-workflow-service.ps1
tools/django-customer-service.ps1
tools/django-access-control.ps1
tools/django-ai.ps1
tools/django-erp-reference.ps1
tools/django-bi-service.ps1
tools/worker-local-service.ps1
tests/startup-release-optimization.test.ps1
tests/startup-speed.test.ps1
tests/startup-speed.test.ts
tests/startup-speed-benchmark.ps1
tests/startup-speed-benchmark.mjs
docs/STARTUP_SPEED_OPTIMIZATION_20260929.md
docs/evidence/startup-speed-history-20260929.json
docs/evidence/startup-speed-benchmark-20260929.json
docs/evidence/startup-speed-validation-20260929.json
```
