# 第19步实际严格比较阻断独立核验

独立捕获 `2026-10-10T11:07:32.986Z`。**原严格比较真实失败，AB完整验收未闭合；没有差异豁免、比较器或基线修改。** [机器报告](INDEPENDENT_STRICT_CLOSEOUT_BLOCK.json) SHA `72bbe86274704f3e2d252ec11a6a66823d5d9af3aef0aeac71556982200c489b`，列出全部十个层项及六表完整前后SHA。

原WAL000085 started `11:03:09.301Z` / f4b4ad→000086 unknown `11:03:09.704Z` / `316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d`，402.662ms。PID23196 exit1/direct/nonzero，无timeout/treeCleanupPending，stdout0、stderr50字节/SHA `89f830ac2a279106b931debec167604a4fe6bfe72dae915a0aaa2ade4af282b1`。原临时流文件已删除。原catch统一格式从独立复现的AssertionError派生为50字节及相同SHA，只作**计算见证**，不制造原stderr文件、不声称恢复原内部stack。

原第19参数按先前passed outputs精确解析，仍为冻结adapter `deep-recovery-comparison`、原E9、pre `aa5f8b30...` 与post `4cc95143...`。两份保全manifest及sidecar摘要匹配；完整typed合同295/296表、非负安全整数count、profile checksum、数据库与软件7元组均通过。使用原冻结runAdapter的deep分支、原safeRead和相同参数仅做小metadata复现；该分支无写入、任务读取或生产调用。

独立确认比较器在 `validators.mjs:97` 的 `before.evidence.tables` 深比较必然拒绝。此前完整manifest、不同backup、时间顺序、database/software/migrations/catalog/roles等断言均通过；它们不覆盖业务内容差异，不能继续返回completeBusinessContentEqual=true或unauthorizedContentChanges=0。原adapter下一项profile表也存在差异，尚未因前项失败而在原process中通过。

| profile实际差异表 | 前→后行数 | 内容SHA |
| --- | --- | --- |
| market_write_request_receipts | 180759→180952（+193） | 改变 |
| workflow_task_activity_logs | 198→202（+4） | 改变 |
| workflow_task_comments | 9→10（+1） | 改变 |
| workflow_write_request_receipts | 59→63（+4） | 改变 |
| workflow_tasks | 90→90 | 改变 |
| workflow_data_revisions | 1→1 | 改变 |

前四表在evidence count层也不同，故共四个evidence项及六个profile项。后两表说明相同行数不能证明内容相同。前后content及profile总SHA均不同；这只证明差异存在，没有识别具体前后业务行、写入参与者、授权或是否合法。

原pre点的E/D已发布目录均不存在，旧pre dump被原保留策略删除；保全manifest/旧恢复回执不包含可恢复的前行基线。不能从计数和checksum反推旧行或变更来源。闭合要求是精确独立来源/行级差异证据与可审查方案；若无法取得应保持阻断。禁止删表、改基线、套用“源码未变/角色同/新点恢复通过”标签、伪造合法变更或生产数据回写来使比较green。生产数据恢复亦无本报告授权。

实际87条canonical原字节及完整hash链通过，active仍原9；前18的latest状态passed，但Backup原exit1/unknown经scope7389效果确认而继续，其原失败语义不改。前1–16started次数与旧baseline相等，第17/18各一次，第19一次；20–21未开始。所有既往UI/自然守护/Backup unknown、清理blocked和入口/core异常保持，不以当前断言通过覆盖历史。

本reviewer没有调用原CLI、reconcile、Status、HTTP、SQL/业务读取、锁、生产写入、dump/fullpins重hash或任何恢复/启停。复现限于冻结比较器和已保全两小manifest；原unknown未协调，未知变更授权没有被认定。
