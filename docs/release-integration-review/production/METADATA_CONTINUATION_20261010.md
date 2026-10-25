# 7389补登记实际执行及原AB尾部续接

用户本次真实消息“批准补登记方案 7389a4d4 并续接 AB”，时间锚点 `2026-10-10T10:34:17.000Z`（本会话turn startedAt秒精度，不编造消息毫秒），user item `01a12560-b472-7250-9b1a-63ca0079f774`、turn `01a12560-b41f-7b01-8855-a17ab7cefa22`。新approval create-only/fsync保存于 `E:\codex-artifacts\release-integration-review-20261010\AB-backup-metadata-20261010-1025-final\human-metadata-approval.json`，scope完整 `7389a4d45c9ac8356eae7a6cb50bf987ea647703fbd68ec8f63f83dbf949640c`。原9/0bca/source5fa/Worker f4/Django237保持；不能把新批准视作重跑Backup、生产数据恢复或C授权。

冻结API3fabc200/caller7b0e27fc原字节执行一次，原4539pin全量检查、真实946874951-byte dump重新核验及输入/head/owner后复验后，10:37:17.677Z只追加000075协调事件 `c61b37e251337abd6d520742c776add236845e91a52406cf948fb184cb5b1c05`，previous仍原unknown `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09`，reason=`independently-reconciled-completed-backup-with-outputs`，receipt `afa87a175247037a6028c40c5992f028c8788f8d0e30e01156538c1313ab8687`。原外壳9376 exit0于10:37:17.720Z，36.458秒；新stdout1318字节与新WAL逐字节相等，SHA f4576e3c，stderr0。

5个真实outputs来自原native result：backupDirectory=`E:\运营管理系统业务数据\daily-20261010T093506Z-8a5a7107b3f6`、backupId同目录名、manifest4cc95143、dumpbd3c532a、contentb2a042fd。旧unknown及其exit1保持，new reconciliation明确originalShellSucceeded=false、backupReplayed=false、releaseRetentionStatus=blocked。只确认PG备份发布及原断言，不表示原命令正常成功、payload清理成功、post Restore或全批完成。

非作者实际复核已通过：76条完整链、原75前缀链/head及原确定性canonical+LF序列化、scope/真人收据/exit/native/manifest/proof/5输出和receipt全部一致；前15passed不重放、17–21当时未开始、active9。没有本次调用前另存的75件rawSHA清单，不能伪称独立前后物理raw快照比对；本结论明确使用原封存75链/head及已绑定writeOnce确定性序列化。独立报告另附，不能将元数据补登记扩大为健康或数据比较通过。

随后调用原已pin `D:\teruisi-runtime\teruisi-worker-sales\releases\20261010T014638Z-97833d2f2b7e7bc9\tools\release-batch.mjs execute`，固定原authority9f79和最早批准 `05:28:51.000Z`，cwd仍干净限定5fa clone，不修改argv/collector/timeout/断言。原全量动态准入、每步闭包及5秒fresh继续；已passed1–16不重放。17是原隔离RestoreRehearsal `34d6af76d635:55593`／E drive，不恢复到生产；18保全、19严格比较、20历史、21精确最终Status按原顺序，遇阻断停止。

原尾部已停止，实际结果如下；整批仍未闭合：

| 原步骤 | 实际结果 |
| --- | --- |
| 17 restore-post | 000079于10:44:33.318Z started；000080于10:57:05.027Z passed，751709.1404ms／12.528分钟，event0bb19357、receipt380e1427 |
| 18 preserve-post-recovery | 000082于11:00:06.262Z started；000083于11:00:08.112Z passed，1850.1164ms；原manifest及Restore/sidecar逐字节保全 |
| 19 full-postgresql-deep-comparison | 000085于11:03:09.301Z started；000086于11:03:09.704Z unknown/exit1，402.6621ms，event316f341e；仅一次，未协调或重跑 |
| 20 original-historical-audits-preserved | 未开始；不以早先独立历史校验代替本步 |
| 21 exact-final-readiness | 未开始；页面200及此前准入不代替最终Status |

原尾部外壳14692于11:03:09.731Z exit1，1364505ms／22.742分钟。最早批准05:28:51保持；此次初始准入173888.4598ms、Restore前边界73323.1650ms、保全前181228.6240ms、比较前181182.1533ms均在原WAL准确计入。子程序是其细分，不重复加总。

[第17独立核验](INDEPENDENT_POST_RESTORE_CLOSEOUT.md)确认native audit834b7d及原result/sidecar/WAL完全匹配，295/296-table原完整profile/角色/序列合同通过，55593没有listener、隔离data目录已清理，正式5432 PID4080及创建时间与原基线精确一致。productionDatabaseTouched=false、serviceStateChanged=false保持；policySyntaxEquivalenceVerified=false原值保持，因为本次profile checksum精确匹配，不借替代witness放宽。原1–16started次数未增加。新点内部可恢复不覆盖前后6表差异。

[第19独立阻断复核](INDEPENDENT_STRICT_CLOSEOUT_BLOCK.md)核87条原链、实际原参数和两保全manifest/typed全合同，并在只读元数据同输入复现原runAdapter：最早在冻结validators.mjs:97拒绝evidence.tables深比较；此前database/software/migrations/catalog/roles相同。4个count层与6个profile表的rows/SHA确实不同，其中90／1相同行数两表仍有SHA变化。原stderr50bytes/SHA89f830ac只有WAL摘要，原临时raw已删除；冻结catch的50-byte AssertionError格式计算摘要相等，仅是派生见证，不重造原stderr或伪造原trace。原UNCLASSIFIED_FAILURE/unknown保持，不标正常success或无授权变化0。来源和修复要求见 [来源证据缺口](SOURCE_WITNESS_GAPS.md)。

原pre dump已轮转删除、payload cleanup仍blocked；本次补登记和成功后Restore没有解除这两项，也没有执行C或生产数据恢复。active9保留，不能手工删除或取消已切换批次。

第三段观察器正常create-only stop退出：10:36:04.328–11:04:39.350Z，685样本／0入口失败，最大采样间隙2520ms。与第二段末10:15:23.909Z有未连续观测缺口，最后样本以后亦未知。此前五段异常和backend NotReady仍保留，不以本段0失败覆盖后台、接口、数据或整批验收。

11:04:43.208Z冻结捕获见 [机器计时](strict-closeout-blocked-final.json)：原批准到捕获335.870分钟、必要验收与完整交付均null。原87条WAL，1–18latest passed（16为明确协调效果）、19unknown、20–21未开始。准备/准入、恢复/收尾、所有失败/协调及等待保留；文档Git交付仍在此捕获之后继续。不能将捕获终点称完整交付终点，不能以本次耗时证明预算或提速收益。

所有子进程原stdout/stderr、准确argv/cwd/时间及exit create-only保存在E7389/production。本次metadata36.458秒是原最早批准总墙钟中的协调细分，原WAL并未为它记录durationMs，不重复加入phase总计。原批准到必要验收、完整交付仍未闭合；预算不是成绩，后续实测及异常单独更新。
