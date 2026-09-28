# 第 2 项：supervisor 意外退出诊断与修复候选

状态：独立开发分支 `codex/supervisor-exit-diagnostics`，基于 `e00d4a82`。只排查、开发、隔离验证；未合并 main、未上线、未启停正式服务。依据总评估第 4.2 节，按用户追加的并行约束，本项证据只更新本文件及配套 JSON，总评估交统一收尾对话更新。

## 当前复核与已确认原因

2026-09-29 00:08 左右重新执行正式只读 `worker-local-service.ps1 -Action Status -Json`，结果为 `exact_release`，release `20260928T112356Z-eeac7bbc96a8c51a`，manifest `3cd3766cbe39071b2a19c6348d062388c6cdaeb433152c84b73ea2a2bd295b0b`。supervisor PID 32412、创建时间 UTC `2026-09-28T14:56:41.0481500Z`；直接 Node 子进程为 helper 53952 和 Wrangler 27796，workerd 52044 属于 Wrangler 后代。源码与运行包 supervisor SHA-256 均为 `fbd5ecf25e01d553c3e4e0d9b155cbfaf2507421ad04ac6a7e8b0a83a0e66148`。这些是本轮读取结果，不是引用旧状态。

00:16:25 UTC+8 的原看门狗快照为 Running / Ready / exact_release、12 组件及探针健康；复核时 supervisor 身份未变。看门狗继续使用其已安装副本，源码没有改动，也没有重新安装。

历史两次退出的底层原因仍为 **原因未明**：

- 9 月 27 日零点前后与 14:34 左右的原故障证据只确认进程消失及原恢复链生效。原 stderr 分别有普通 Wrangler 提示／一次业务 scheduled 不可用提示，没有能够绑定 supervisor 的致命错误或退出码。
- 本轮重新查 Windows Application/System，上海时间 9 月 27 日 00:00–00:25 和 14:20–14:45，限定事件 41/1074/6008/2004/1000/1001/1002，均无匹配的保留事件。更宽时间范围存在其他 WER 记录，不能把它们按时间邻近归到本故障。
- 无匹配事件不排除强制终止、原生崩溃或日志未落盘；没有能够确认外部终止者的审计证据。没有证据将这两次退出归因于内存。
- 自动恢复成功只证明恢复路径，未证明退出根因闭合。

**本轮已确认的独立代码缺陷：** supervisor 对 stdout/stderr 没有 error 监听器。隔离真实 Node 子进程中关闭读取端后再写 stdout，旧行为因未处理 `EPIPE` 以退出码 1 结束。安装本候选处理器后，同条件记录 `output_error/EPIPE`，继续执行并正常退出 0。此对照证明错误路径真实存在，**不证明它就是上述历史退出原因**。未终止、断开或注入正式服务及其日志管道。

## 最小修复与诊断

1. 只对 stdout/stderr 的 `EPIPE` 记录后继续监督；其他流错误重新抛出。未捕获异常采用 `uncaughtExceptionMonitor` 留证，保留 Node 默认失败退出；未添加吞异常的 `uncaughtException` 处理器或无条件重试。
2. 在既有 runtime `logs` 内新增 `supervisor-lifecycle-0.jsonl` 和 `-1.jsonl` 两个固定槽，各最多 1 MiB、单条最多 4 KiB。复用现有实体路径／单链接检查；使用独立文件句柄同步写，避免依赖启动器标准流。按槽轮转，不删除原 stdout/stderr、看门狗故障证据或业务文件。
3. 记录 manifest SHA、PID/PPID、估计启动时间、递增序号、启动验证阶段、直接子进程角色/PID/退出码/信号、restart 延迟、liveness 终止、supervisor 信号／失败／退出。每分钟一个 unref 心跳及事件时的 supervisor RSS/heap、整机可用/总内存。不采集 workerd 内存曲线，不调整堆上限，不推进第 3 项。
4. 错误只保留类型、固定错误码、SHA-256 和最多 6 个已知生命周期源码文件的行列位置；不保存异常原文、完整堆栈、命令行、环境变量、URL、凭据或业务数据。`estimatedStartedAt` 是 Node uptime 推算值，精确创建时间仍以原 `state/worker-process.json` 和 Windows 进程身份为准。
5. 唯一控制器在原精确身份复验后、停止前写 `state/worker-last-controlled-stop.json`，绑定 PID、精确创建时间、manifest、原 Action 和 requested 阶段；实际观察 supervisor 消失后更新为 supervisor_absent。正常 Stop、EnterMaintenance、Start 失败清理可以分开核对。单个文件原子替换，不累计；它不证明整棵树已清理，不作为授权或恢复凭据。
6. 日志写入失败不得改变启动/停止权限或触发恢复。journal 创建失败输出固定 unavailable 提示；运行中写入失败停用该进程的 journal，后续证据缺口须如实保留。磁盘掉电、原生崩溃、TerminateProcess 可能没有最终事件，不能伪造原因。

诊断不改变唯一 Start、原 mutex、release/receipt/进程校验、端口所有权、维护保护、重启预算或看门狗决策。Worker liveness 仍只使用原 `/_teruisi/local/health/live`；readiness 降级不新增重启路径。helper/Worker 自身的标准流故障仍由其原错误及退出处理决定，本修复只保证 supervisor 的 EPIPE 不再成为未处理流异常。

## 判读边界

| 证据 | 可确认结论 | 不可推导的结论 |
| --- | --- | --- |
| 精确身份的 stop requested + supervisor_absent，Action=Stop | 控制器发起停止并观察 supervisor 消失 | 全栈停止或业务排空已完成 |
| 同上，Action=EnterMaintenance，另有原持久维护证据 | 受控维护中的停止 | 已授权其他维护或发布 |
| child_exit / child_error + restart_scheduled | 指定直接子进程退出/启动失败及恢复决定 | supervisor 自身崩溃；信号发送者身份 |
| uncaught_exception / supervision_failed | 自身未捕获异常或监督任务失败，按类型/源码位置进一步调查 | 历史无日志退出有相同原因 |
| output_error/EPIPE 后继续 heartbeat | 输出管道失效但 supervisor 继续运行 | 管道由谁关闭；所有子进程日志完整 |
| 原进程消失但没有最后事件或精确停止记录 | 原因未明，关联原看门狗及 Windows 事件继续取证 | OOM、恶意终止或受控维护 |

轮转日志是有界运行观测；严重故障发生后应及时和原看门狗 `evidence/*-before/latest.json`、原受保护进程回执及相关 Windows 事件一起归档，不能把这些诊断文件当作授权依据。两槽不是无限历史归档，不新增告警、调度或恢复入口。

## 隔离验证

- 新增 12 项诊断测试通过：两槽容量/脱敏/硬链接拒绝、EPIPE 与非 EPIPE 区分、监听器释放、真实正常退出/异常/rejection、直接子进程非零退出/启动失败、PowerShell 5.1 和 7 的停止/维护/清理记录、真实外部强制终止留证边界、真实断管修复前后对照。
- 既有 10 项相关测试通过：真实 Worker/helper 子进程恢复、retirement proof 篡改拒绝后续启动、短暂 live 失败不重启、原看门狗维护/身份/恢复预算、无控制台启动器、生命周期交错与热重启、原 JSON 身份读取。生产端口未用于故障注入。
- 完整单元测试以 `node --import tsx --test --test-concurrency=2 tests/*.test.ts` 运行，2693 项：2666 通过、23 跳过、4 失败，约 593 秒。4 个失败均为 Python DTO 测试缺少本工作树 `.runtime/test-venv/Scripts/python.exe`；新建本任务独立、无 pip 的标准库 venv 后，相关四文件 46 项复验全部通过，未改业务代码。没有重跑整套后声称首次全绿。
- 最终代码另跑生命周期回归 37/37，通过新增诊断、真实 Worker/helper 恢复和既有 local-worker-start 的 readiness/liveness 分离测试；综合看门狗/控制器/诊断测试 22/22 通过，两组存在交集，不简单相加。最终改动文件 lint 与语法检查通过。
- `npm run lint`：0 错误、12 条警告，均位于未修改的业务或测试文件。`git diff --check` 通过。
- 所有本项故障注入只面向临时目录和本测试创建的进程；原真实子进程恢复夹具使用随机端口和隔离 runtime。未使用正式数据库、profile、下载或备份目录做测试。
- 按并行错峰要求，生产构建、正式候选构建/prepare、恢复演练和压力测试留待统一集成时段；本轮未执行。诊断文件打包、实际安装与自然退出后取证仍待上线验收。

## 公共模块、依赖及集成交接

| 文件 | 本项范围 | 潜在重叠及建议 |
| --- | --- | --- |
| `tools/worker-local-runtime-supervisor.mjs` | 日志、EPIPE、退出事件 | 第 3 项可能增加内存观测；本项不负责 workerd 曲线/堆策略。集成保留一套生命周期日志，避免重复 handler/timer |
| `tools/worker-local-service.ps1` | 精确停止前后诊断 | 第 4/7 项可能调整维护或启动；本项不改其互斥/启动策略。合并时保留身份复验→requested→原 Stop→absent 顺序 |
| 两个新增测试文件、本说明、配套 evidence JSON | 独立新增 | 无需修改其他分支或总评估 |

不依赖其他优化项提交或数据库迁移。依赖现有受保护 runtime logs/state、原唯一启动控制器与 supervisor 打包机制；当前 supervisor 本来就在 release bundled/key file 清单中，无新模块漏打包问题。没有改 `package.json`、依赖锁或看门狗实现。node_modules 只以本工作树的本地 junction 复用已有只读依赖，未安装或修改共享依赖。

## 待确认的上线与回退准备

由用户指定的统一收尾对话合并后，复验组合变更和远端提交。按 `STARTUP_RELEASE_OPTIMIZATION.md` 错峰完成独立生产构建、原在线 candidate plan、完整摘要/guard/依赖检查；本次没有可供 apply 的正式计划或候选 manifest。

正式采用需另获本次明确确认：核对当时 effective head/并行任务，业务排空、发布前备份与隔离恢复及 E 归档；通过原唯一生命周期入口进行获批的 Worker/helper 切换，不能提前覆盖生产保护入口。仅该两份脚本变更不需要 Django 部署、迁移或 n8n 重启，实际组合范围仍由统一收尾复核。

验收须包含新 release/启动绑定、12 组件、live/ready、helper、原看门狗自然健康轮次，以及真实运行中两槽日志可读、身份关联正确、受控停止记录可判读。不通过终止正式服务制造故障；上线后没有复现只说明观察窗口结果，历史根因仍保持未明。

回退优先在 apply 前撤销本候选使用，保留原生效版本；apply 后如需撤回，用原发布链准备包含前驱兼容代码的受控 successor，重新经过用户批准的窗口，不能直接启动已被 fence 的旧 release 或改 authority。保留前驱完整载荷、manifest/guard/successor/进程证据与本项诊断文件。此项不改变数据库结构，不以数据库恢复作为默认代码回退。

## 提交状态

本项交付范围固定为 6 个文件，提交/推送目标为 `origin/codex/supervisor-exit-diagnostics`。本文件随源码同一聚焦提交交付；精确提交号、远端核验结果以交付消息及 Git 分支 HEAD 为准，避免在同一提交内写入自身哈希。不合并 main、不删分支或仍待集成的 worktree。原始测试日志保存在本工作树 `outputs/supervisor-exit-20260929/`，摘要写入配套 evidence JSON，不将运行产物提交为源码。

证据：[本轮只读与候选验证记录](evidence/supervisor-exit-candidate-20260929.json)。原历史：[丽力重试](evidence/tmall-lili-retry-4610-20260927.json)、[14:34 退出](evidence/jackyun-safe-recovery-production-20260927.json)。
