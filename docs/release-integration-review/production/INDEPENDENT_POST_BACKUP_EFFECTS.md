# PostBackup unknown 的独立效果复核

2026-10-10 09:55 UTC。**数据库备份及原三份保留效果已证实；原Backup进程仍是exit1/unknown，发布制品保留清理仍blocked，整批AB未闭合。** 原API的输出续接及严格全库比较存在两个独立技术阻断。机器记录见 [INDEPENDENT_POST_BACKUP_EFFECTS.json](INDEPENDENT_POST_BACKUP_EFFECTS.json)，SHA `4d8c43629dad301637df255feb16eae6f7ca4d55ef762c975f54922a854cc5c2`。

原WAL000074于 `09:44:11.721Z` unknown/hash `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09`，PID69376 exit1，preserve/direct-exit-files，无timeout或树清理。stdout1319字节/SHA `49b85219faffedc5c185f8257f2f401ae2eb8f08d53bf6cfa9f9eb7d5a0202d8`，stderr2428字节/SHA `d3bea73cde7a844806baa4ff1a08185e1aa84c8c490d3b7947b68eb121ce50b0`；临时原文件已由原runProcess删除，不能重建为“原日志”。独立纯计算 `JSON.stringify(nativeAudit.result)+CRLF` 得1319字节及完全相同stdout SHA，支持该原结果对象确已输出；这只是一项计算核验，未制造stdout文件，也未推断完整stderr或底层planner错误原因。

原 native audit `420adb985efc496a8c6d861a7c717046.json` 的status、databaseBackup、result均completed，failure=null；databaseBackup与result对象深比较相等。实际发布点为 `E:\运营管理系统业务数据\daily-20261010T093506Z-8a5a7107b3f6`，manifest SHA `4cc95143e5feffbd801388cb5de8dd59e269f099ce193afbdc4cfaba310e0f88`，dump SHA `bd3c532a8f897eea2f09f3b60270543993abcda802bd2147c3937539dfc680c8`，content SHA `b2a042fd4e5287ab30642180365d05a74694f7d07ed490c83454bd40f50cf6ce`。manifest/侧车相等，完整295 evidence表及296 profile表、profile重算checksum、软件7元组与原合同均通过。

在原engine停止、无Restore/构建并行时独立串行完成**一次**946,874,951字节流式dump哈希，字节SHA相等、PGDMP头有效、路径无重定向、文件身份/大小/时间/链接数前后稳定。见 [INDEPENDENT_POST_BACKUP_DUMP_VERIFICATION.json](INDEPENDENT_POST_BACKUP_DUMP_VERIFICATION.json)，SHA `8fd3b90cb8ef9bc4fdc1fbe0947314bbf9b245f77cf36c066fede6900b629590`。它证明所发布容器及元数据身份，不代替尚未执行的post Restore/序列/内容/清理实演；这次约0.659秒哈希不外推恢复或生产发布预算。

原保留审计 `postgres-retention/4f0dcf0883fe4f18ba48c22d99dad2f0.jsonl` 完整记录plan、delete-reserved、deleted及completed：新点的D本机临时副本和原AB pre `daily-20261010T054420Z-3f75a3055cf6` 的E副本确已删除；只读存在性检查一致，E新点仍在。原pre的aa5 manifest在E9两处原字节保全，但JSON/旧演练回执不等于仍可用恢复点，不能继续宣称旧pre dump保留或有效。

releaseRetention为明确blocked/release_plan，异常定位 `release-payload-retention.ps1:57`。安装operator SHA542e及retention脚本SHAe5ba与原批准一致。其原路径先调用只读Node planner，非零则在57行throw，早于audit创建及payload删除循环；native maintenance在2244行捕获为blocked，仍在2251附近保存completed Backup结果。原Node→PS桥会传播global LASTEXITCODE；源码与exit1/真实结果摘要一致地解释“已完成备份效果+清理失败+非零外壳”。底层planner stderr已不可得，因此不声称查明其更深原因，亦不把blocked清理改成completed。第16步两个原断言及引擎额外的E路径/backup retention completed条件确由结果满足，但进程非零协议仍失败。

**原API续接阻断**：`release-batch.mjs` 的reconcileOperation(passed)仅追加status/reason/receiptSha，不追加outputs；400行附近outputsFor要求先前passed且有outputs，而17、18、19引用backup-post路径、manifest、content及dump字段。因此即便仅用原API标passed，仍无法诚实运行原Restore/Preserve/Deep。该Backup已有实际发布及删除效果，noEffect=false，不能用failed零效果证明后重跑。禁止手改WAL/active、内存注入未持久化outputs、伪造exit0或重新Backup。若要继续，须另行形成受审、明确批准的窄追加式效果确认/outputs协议，绑定本unknown、native audit、精确E点及当前owner，保留原exit1和清理blocked；本reviewer没有实施或协调它。

**严格数据比较阻断**：已用两原manifest及冻结pure comparator执行只读断言，严格拒绝，未运行实际第19步。共有10个两层差异、6个profile表：市场写入回执180759→180952，工作流活动198→202、评论9→10、写入回执59→63；workflow_tasks仍90行、workflow_data_revisions仍1行，但内容SHA变化。角色、catalog、migrations及软件相同，不证明全业务内容相同，也不证明变更合法或由哪个参与者产生。不得删除表、改基线、用源码未变标签或归零unauthorizedContentChanges掩盖差异；需要精确独立来源证据及可审查新方案。

独立快照75条canonical/hash链通过，active仍原9，backup-post只started一次；17–21未开始。没有生产SQL/业务数据读取、Backup/Verify/Restore/Retain/删除/维护/启停/Install/Status/UI或外部发送。本次只读效果复核、一次容器流式哈希和小metadata pure断言，不表示原操作正常成功或AB完整采用验收完成。
