# 发布工具固化：正式采用与受限恢复

2026-10-21，本任务代码 `988810cf4b9cccc6d9a3eea905f15e3b67989d8f` 已上线。19:19:59（UTC 11:19:59）生成真实恢复 SUCCESS，`status=deployed_and_ready`、`startupVerified=true`、`readyVerified=true`；19:20:23 原发布目录 CAS 更新完成。原失败入口没有改写为成功。

本次范围为 Worker + Django，前驱运行代码为 `2b6447f3`。计划 `migrate=false`，无本次结构迁移、额外备份或 Runner 升级。复用 [既有程序检查与私有验证](REPORT.md)，未新增业务功能、真实模型或消息投递验收。后来另任务合入 main 的 `58f292b5` 等审计业务修复没有混入本次冻结制品。

## 最终版本与证据

| 项目 | 实际结果 |
| --- | --- |
| 冻结包 | `D:/codex-isolated/main-release-packages/988810cf4b9c-f6565b40-79d6d565` |
| Worker | `20261021T050959Z-309bb3d722f0ee47` |
| Worker manifest | `276cdc185fdfb56bf5d8497fa5ad8804ec36428079e586bb0557675074663cfb` |
| Django manifest | `884d09d732204aca24d656c6ef769d029775d680ae9bd30206edc3bc63aa1554` |
| 原生 PREPARED SHA | `4ea8fd203a902aaa551913fe02ba5ac2786ba458637799e38a80aafe0d77c5a5` |
| 实际 SUCCESS | `D:/codex-artifacts/release-resume-20261021/publication-start-reconciliation/recovery/SUCCESS.json` |
| SUCCESS SHA | `c376bf58d5a901f89d18c3b58807393a8f5a272e7d9a3b57240ceab6f5449c5c` |
| 发布目录 | `D:/codex-isolated/main-manual-release-20261016/PUBLISHED-MAIN.json`，目标同为 `988810cf` |
| 发布目录 SHA | `61590ea2767c651217d2c5522eca2138d467f3ebd1d81ae564d0f774b84d87e3` |

最终回执明确 `manualRecovery=true`、`automatedPublisherSuccess=false`、`originalStartExitedSuccessfully=false`、`originalStartDirectExitCode=1`。最后一次只读协调入口和 GUI 宿主真实退出码均为 0，raw 输出 EOF 完整；这不追认此前失败入口退出 0。所有外置脚本仅适用于本次原请求、前驱、制品和维护 ID，不是通用续接入口。

## 中断与恢复边界

原准备 dispatch `e786aed6-25c2-4cce-b433-4fd21d3ac2c2` 留下 unknown。数次外层 PowerShell 出现 `STATUS_CONTROL_C_EXIT`；V4 证明宿主先退出、Node 随后因父身份缺失安全拒绝。用户提供“应该是另外一个 AI 操作的”线索，但缺少具体清理动作和进程关联证据，不能作为已确认根因。原 n8n 记录只证明周报因发布 defer、重试等待，没有其终止准备宿主的直接证据。

无控制台 GUI 宿主通过真实普通权限、session 1、medium、console=0 探针，保留 direct exit/raw 输出，不使用 kill-on-close job 或进程树清理。V5 另一次只读预检因初始快照后新增 opaque 身份拒绝；修正版只移除此重复预检，正式执行仍保留原身份守卫、新鲜度和六次补证上限。

`preparation-recovery-v5-preflight` 于 UTC 09:35:46 单次执行，复用已有候选，完成原生完整校验、Worker plan/prepared-build、Django PrepareApp/Verify；09:49:28 真实生成原 PREPARED，没有重建候选。随后原发布器在 STARTED 前误落历史维护资格：本次只读状态动作改变 AI 控制器整文件摘要，旧表用历史 `ca9c731a` 比较实际当前 `79d6d565`，实际前驱并未漂移。

独立逆投影/AST 和真实差异证明原 Stop、退出等待、维护、锁与相关调用保持；Django 控制器仅增加六项准备依赖。精确外置资格桥完整绑定当前前驱、冻结 988、请求、PREPARED 和真实摘要，只替换原 `publishPreparedMain` 的只读 `maintenanceReadiness`；原 PowerShell 动态门禁保持，没有改 sealed 源码或伪造 pins。

原生发布于 UTC 10:24:23 写入 STARTED，随后 EnterMaintenance、Stop、Django Deploy/Harden 和 WorkerApply 均真实成功；10:36:31 激活目标 Worker。这些动作未重放。

原 ExitMaintenance 在清门前的 `Assert-DeployedApplication` 中发生 `wrangler --version` 原 15 秒超时。输出文本相同或 EOF 完整不能当作退出 0。两道原维护门仍同 `e53d9bba2d294b6e9308257a41e94e40`；原控制者和迟到 writer 已退役，源码与原日志证明尚未执行清门。一次同环境、同预算只读版本探针通过后，才继续一次原 ExitMaintenance；10:53:59 两门正常关闭。没有增加预算、手工删门或重放部署。

随后原 Start 实际完成后台、Pi 和 Worker 启动，却在最后等待 AutoStartDingTalk 时耗尽整轮 600 秒预算。原时间证据：EnsureDjango 330886ms、完整 release 验证 151113ms、supervisor 启动 20677ms 均完成；最后接收器等待约 91520ms 失败。原 parent direct exit 为 1，内层未知、旧 GUI EOF 不完整事实保留。接收器和调度器随后启动，原回执与当前精确进程匹配。

最终仅用原公开 Worker Status、Django AggregateStatus、AI Status 和原 HTTP 后置判据对账当前状态。前后 Worker 状态一致，后台、AI 和接收器符合原判据；明确协调已完成启动作用后，只执行原 VerifyStartup、ready 和 SUCCESS/catalog 收尾。没有再次 Start、ExitMaintenance、Apply、Deploy 或准备。证据位于外部 `publication-readiness-recovery`、`publication-native-tail` 和 `publication-start-reconciliation`；原包 STARTED/FAILED 及全部异常原件保持。

## 收尾与未完成事项

10 个本任务一次性计划任务均在精确 XML SHA、Ready/0 instances 核验后删除，定义已归档；未调用 Stop 或终止生产进程。临时 TaskScheduler Operational 日志于 UTC 11:22:44 恢复原 disabled，回读通过，10MB 上限和 4002 条日志保留，没有清日志。证据位于外部 `closeout/TEMPORARY-TASKS-DELETED.json` 和 `closeout/TASKSCHEDULER-LOG-RESTORED.json`。

本次只提交自有文档，不 checkout/reset 主工作区、不暂存用户已有改动。运行包、冻结 source、真实回执与异常证据保留；本次文档提交不再次发布应用。

以下问题没有因临时恢复而永久解决，不能把“已上线”当作标准发布流程全部修好：

- 标准维护资格尚未正式覆盖本次只读控制器变化。后续控制器不变可能通过，再次变化仍需精确兼容处理。
- 原 e786 unknown 保持。已安装 851 准备消费者只识别已有历史 resolution，未来自动准备仍会被阻断；没有伪造队列完成或覆盖原记录。
- 本次完整冷启动触发原整轮 600 秒预算；未修改标准预算或推广自动重试。版本检查的单次 15 秒超时也保持原真实记录。

这些临时适配器均为历史专用。长期修复应在标准入口和原队列协议内完成，保留身份、互斥、制品、未知结果与防重放门禁。
