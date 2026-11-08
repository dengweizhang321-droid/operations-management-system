# Windows 隔离组合启动独立反审

2026-11-08。**有限范围通过，未发现该隔离启动结果的剩余阻断。** 已证明冻结应用的真实 Windows PostgreSQL、AI reader/writer、Worker 运行与正常退出，以及已配置 Django 子进程到两个真实 Runner 的签名调用。**未证明原 Windows 总控完整原生冷启动、全域就绪、HTTP 业务链或真实供应商能力。**

本次按用户逐小项独审要求请求 `gpt-6-astra/high`，工具未独立回传实际底层型号与强度。本上下文未参与实施；先读共享记忆、AGENTS 和模型/开发/架构/安全/运行/交付规范。审查仅读取候选源码、非敏感回执和隔离文件，执行静态摘要与语法检查；未操作 WSL、启动应用、读取进程或凭据、访问生产、发出网络请求，未改实施脚本。

## 冻结来源与真实执行

- 应用提交 `557b497dc0fe42f3693a0c6c76320a4833b46b49`，tree `277573157b4c0e4c41e72a329351639ac6cc80c3`。独立复算原归档 3,396 文件及补归档 automation 46 文件，与隔离实际源码逐字节相符；两归档摘要匹配。首次 build 缺 automation 的失败日志仍在，补充仅恢复同提交已跟踪输入。
- `DIST.json` 的 190 个输出独立重算全部匹配，没有额外文件；Worker 实际入口与运行回执的 build manifest 摘要相符。测试 bootstrap 是明确新增的外置接缝，没有改 frozen backend、Worker 或 Runner 应用源码。后续 `66a9bfa1` 相对应用冻结只改文档、测试及 G02 验证器，不改变本轮实际应用输入。
- 依赖保留同锁来源及原复制/离线安装回执；有限独立补核确认两个锁文件与冻结值和复制来源一致、11 个 wheel 与清单一致、10 个 Node 核心入口/元数据及 workerd 二进制与复制来源一致，另九个直接源码入口与冻结 Git blob 一致。明确不宣称本审完成全部 node_modules/installed RECORD 逐文件复核。最初额外全量只读诊断因耗时异常由负责人按精确 PID/创建时间/命令行停止，结果为中断、非通过；随后仅执行 60 秒预算的上述有限清单（实际 0.61 秒），未重启任何应用。证据：[有限依赖核验](D:/codex-artifacts/ai-repair-integration-20261108/review-windows/DEPENDENCIES-BOUNDED.json)、[诊断停止](D:/codex-artifacts/ai-repair-integration-20261108/review-windows/DIAGNOSTIC-STOP.json)。
- 空 PostgreSQL 使用独立 `pgdata-r5`、55418、独立库和本轮随机 SCRAM 凭据；只复用 PostgreSQL 17.11 的安装二进制。原迁移日志与回执记录 159 条迁移，其中 AI 90 条至 `0090_unified_tasks`，117 张 AI manifest 表及五张统一任务表。没有生产数据复制。
- AI authority、revision 和 verified migration run 为明确标记的合成空库状态。其原生 `health.check()` 确实检查 PostgreSQL、真实 reader/writer 角色、只读事务、DDL 禁止、角色无继承、闭合表/列权限、schema/index/guard 和 authority；没有替换 health 实现。19181/19182 的 live、ready 均 200。因此该结果证明真实健康逻辑接受此合成空库，不能证明生产 authority 或历史数据资格。
- 3918 的监听者为真实 `workerd.exe`，OS 原件记录其父 PID 与 Node bootstrap 一致；三个 Waitress listener 及 PostgreSQL 的 PID、创建时间和二进制摘要分别记录。Worker live、HTML 首页均 200，聚合 ready 为 503/degraded：23 项中仅 AI 两项 ready，其余 21 项缺配置。通用 development Django live 为 200、ready 为 503，内部日志明确空 ERP revision 不满足就绪；这些失败没有被改写为全域绿。

## Runner 接线与出网范围

`runner-binding.py` 运行在使用冻结 Django 源码、独立 AI writer DB 配置的**单独子进程**，先确认数据库角色/库名/端口，再仅将原 transport 的端口换成 19189/18139。它没有从 Waitress HTTP 业务接口发起完整任务。最终 `DJANGO-RUNNERS.json` 中 Pi create/state 均 idle，固定镜像、excel-report 1.3.0 和完整资源声明一致，无待处理 gateway；dispose 为已验签 disposed。Pandas 原 `call_runner` 校验 HMAC、精确镜像和 `cleanupVerified`，真实容器对两行合成值 3/-1 得到 2。两个镜像 ID 与已独审的 `RUNNER-READY.json` 一致，源码与镜像来源复用 [Runner 审查](REVIEW-RUNNERS.md)。没有 prompt、模型调用或真实业务数据。

Worker `outboundService` 只允许两条精确回环 origin 的 GET `/health/ready`，禁止 query、其他 method、其他目标，转发禁重定向；本轮原日志只有这两次 200 健康请求。Worker 无 cron，R2 为临时内存命名空间，环境逐项建立且关闭指标上报；Django 未启消费者/调度器，空库无供应商模型。该控制覆盖本轮调用路径，不是 Windows 全机网络防火墙证明，也不是后续任意业务代码无法出网的证明。

## 初审问题与最终增量

初审发现并通报：原 Pi 断言把返回的 Skill 对象数组误当字符串数组，导致真实 create idle 后仍报 AssertionError；旧 Windows 结果只标 `passed_ai_slice` 并保留 `runnerBindingError`。此外 Worker 完成 dispose 后 stdin 保活，宿主超时强停；三个 Waitress 也为直接 terminate。上述原件和脚本完整保全在 `windows/attempt-04/`，没有将其改成成功。

执行者仅修外置 harness：按 Skill 对象 ID 核验并逐步保存 create/state；最终成功要求 Runner 子进程通过；Waitress 使用 stop 管道关闭 dispatcher/socket，Worker 在 dispose 完成、日志写出后退出。新空库、新合成身份的最终原件显示四个应用/bootstrap 退出码均 0，无初始停止错误，PostgreSQL fast shutdown 完成，PID 文件消失，五个测试端口全部释放。OS 后核对五个原监听进程的创建身份已退出，无 PID 复用。

Pi dispose 本身保留 workspace 卷，不能等同整项清理。负责人随后按两份已签名 disposed 回执的精确 workspace 摘要、namespace label、无容器引用核验后仅删两卷；本审静态核对脚本和 `PI-VOLUME-CLEANUP.json`，两卷名与旧/新回执完全对应、容器及 namespace 卷为空。Runner 总进程和 WSL/Docker 恢复的最终闭合仍由其原独审上下文负责，本报告不代替该独审。

此前 attempt-01 缺 Django 依赖、attempt-02 安装超时、attempt-03 stage 参数冲突的失败回执/日志均保留，各自记录隔离 PostgreSQL 与端口清理。没有以最终成功追认这些旧失败。

## 原生总控边界与交付限制

独立核对 `operations-system-control.ps1` 固定生产 Django root、3000/5791；`worker-local-service.ps1` 的 `AllowTestRuntimeRoot` 在 `Get-DjangoSystemReadiness` 直接返回 Ready=true，不能作为真实后端就绪证明。本轮未调用该总控，也未使用这个合成成功分支。当前真实启动是 Waitress/Miniflare 的显式隔离 bootstrap，未覆盖受管 Windows supervisor/helper、原生 Start/Stop、正式 DPAPI/ACL/authority、128 连接全栈门槛和正式部署入口。

因此准确结论为“Windows 隔离 AI 子集与 Runner 签名接线通过并清理”，不是“完整 Windows 应用栈原生冷启动通过”或“可以直接上线”。本轮没有 main 合并、正式制品准备、生产采用、真实模型/钉钉外发授权；这些状态仍为未执行。

独立机器核验：[STATIC-VERIFY.json](D:/codex-artifacts/ai-repair-integration-20261108/review-windows/STATIC-VERIFY.json)、[最终回执绑定](D:/codex-artifacts/ai-repair-integration-20261108/review-windows/FINAL-AUDIT.json)。原件入口：[WINDOWS-RESULT.json](D:/codex-artifacts/ai-repair-integration-20261108/windows/WINDOWS-RESULT.json)、[DJANGO-RUNNERS.json](D:/codex-artifacts/ai-repair-integration-20261108/windows/DJANGO-RUNNERS.json)、[源码与清理](D:/codex-artifacts/ai-repair-integration-20261108/windows/WINDOWS-SOURCE-AND-CLEANUP.json)、[总控边界](D:/codex-artifacts/ai-repair-integration-20261108/windows/NATIVE-CONTROLLER-BOUNDARY.json)。原运行结果为审查原件复核，不冒称由审查者重跑。
