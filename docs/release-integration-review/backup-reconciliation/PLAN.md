# 后备份效果补登记方案（尚未批准或执行）

AB 原批次 `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15` 已实际采用限定源码 `5faac8151f59d66de72c3caead8cad916ea547da` 的 Worker；前15项已确认通过。第16项 `backup-post` 在 `2026-10-10T09:44:11.721Z` 非零退出并留下 unknown 事件 `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09`。实际数据库备份及三槽轮转已经发生，禁止重跑该动作。17–21没有开始，整批仍未闭合。

原 `tools/release-batch.mjs` 的 `reconcileOperation(passed)` 不登记 outputs，而 `outputsFor` 要求此前 passed 事件中有真实输出，原 Restore/保全/比较步骤才可解析备份身份。原接口不能完成本次安全续接。用户批准的 `0bcad05b` 只读 UI 补充已用完；不能把它扩展为新元数据接口的生产授权。

本方案只新增一个外置、Node 内建模块实现的效果补登记 API，代码在独立 worktree 开发，不替换已经运行的 Worker/启动脚本，不引入 C。不修改旧批次、历史 WAL、active、制品或数据。执行前须另获封存 scope 精确批准。

## 精确新动作

只执行 [execute-reconciliation.mjs](execute-reconciliation.mjs) 调用 [reconcile-completed-backup.mjs](reconcile-completed-backup.mjs) 一次。它使用原9批次的 rotation lock、journalState、writeOnce/fsync 和 typed full-manifest validator，向原验证过的 journal 追加一条带以下5项真实 outputs 的协调事件：backupDirectory、backupId、manifestSha256、dumpSha256、contentSha256。输出只来自绑定原 stdout 摘要的真实 native result，不接受调用者提交 outputs。

本事件 reason 是 `independently-reconciled-completed-backup-with-outputs`。原 exit1/unknown 字节继续保留；reconciliation 明确 `originalShellSucceeded=false`、`backupReplayed=false`、`releaseRetentionStatus=blocked`。新的 passed 表示已独立确认该步骤所需备份发布效果和原断言，不表示原命令正常成功、清理成功或整批完成。

所有当前会执行的原 collector、backup-post 及17–21命令闭包继续完整钉 SHA。EnterMaintenance 所用旧 primary 入口与 Apply 后现入口不同，旧字节由原 collector 的 primary-before 文件保全；前15项必须 passed 且禁止重放，不把两个阶段同 path 的不同 SHA 强行要求同时成立。新增 API、自调用器、独立 proof/observations、native audit、manifest/sidecar、原合同/validator 另行封存。重新流式核验精确 dump 后，重核所有 pin、active、head 与文件身份，再原子 create-only 追加。scope 绑定唯一 unknown 与 sealed head，重复执行/并发 head 改变会拒绝。

## 仍然阻断完整验收

1. 原严格 comparator 对真实前后 manifests 已拒绝：6 张 profile 表、10 项两层差异，含 `market_write_request_receipts`、`workflow_task_activity_logs`、`workflow_task_comments`、`workflow_write_request_receipts`、`workflow_tasks`、`workflow_data_revisions`。前4表计数增加，后2表行数相同而 SHA 变化。角色、catalog、migration、软件相同不能覆盖这些差异。没有变更来源的独立证据，不能声称合法业务写入，也不能声称发布损坏。
2. 原备份三槽轮转已经删除 AB 发布前 `daily-20261010T054420Z-3f75a3055cf6` 的 dump。其保全 manifest/前 Restore 回执不等于当前可用恢复点。不得继续宣称旧 pre 恢复包有效。当前后备份须原隔离 Restore 验证，完整回滚资格仍要明确核定。
3. 原 release-payload-retention 在 `release-payload-retention.ps1:57` 的只读 planner 阶段阻断，未进入该调用的 payload 删除循环。stderr 仅有原摘要，临时原字节已删除，底层原因尚不明。不得伪造原日志或记作清理完成。
4. 实际入口有短暂异常和观测缺口；应以完整采样及独立追溯报告表达，不以页面恢复 200 或切换跨度替代稳定性结论。10:18既有快照曾HTTP200但BackendUnavailable/core=false，10:19自然恢复快照已保全；前一raw未及时保全的限度明确报告。两个时点都不能代替下一次动态准入。

补登记本身不执行原尾部。批准补登记后，原已批准 AB 的17–21仍只能通过原引擎、新鲜动态身份/权限/维护/排空及每步完整 pin 准入继续；Restore 指原隔离 `34d6af76d635:55593` 演练，不能恢复到生产。第19项必须保留原严格比较，已知差异预计会阻断它；不能承诺整批通过或自动完成。继续前须核前驱及当前恢复点未变，变化则拒绝并重新准备。

## 验证及交付

作者21项隔离测试在最终阶段闭包上通过，包含真实 immutable 元数据及冻结 validator；注入的是隔离 IO/journal，未执行生产动作。非作者15项独立验证通过，包含原 journalState/writeOnce 的真实临时 journal 追加、重复调用与已变化head拒绝；最终源码/caller复审见本目录独立报告。旧失败、旧 O(n²) 运行中止和前置 schema 失败日志保留，不计为最终通过。

新接口候选必须先提交、正常合并推送并封存独立 scope，核远端精确提交。仅文档与外置接口交付，不构建或切换新 Worker。四状态为：源码候选已实现；隔离验证按实际报告；生产元数据候选待精确封存/批准；实际采用未执行。所有正式9/0bca pinned 工作树仍在用，不能清理。

必要验收闭合、完整交付仍为 null；原05:28:51批准时间继续计时。预算80～120分钟已不能据本次超时链路宣称达标；也没有完成同范围前后提速比较，不计算节省时间。
