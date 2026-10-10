# 第17步 post Restore 独立复核准备

2026-10-10。仅准备；等待原operator完成通知后读取最终小回执。没有提前读取正在写入的恢复结果、运行Restore/Verify/Status、查询生产DB或获取锁。

本轮固定绑定：

- 原AB9：`9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`；原批准时间 `05:28:51.000Z`，不重置计时。
- 元数据补充scope：`7389a4d45c9ac8356eae7a6cb50bf987ea647703fbd68ec8f63f83dbf949640c`，人工批准 `10:34:17Z`。
- 000074原unknown420fd及exit1保留；000075 `c61b37e251337abd6d520742c776add236845e91a52406cf948fb184cb5b1c05` 仅追加completed backup outputs，originalShellSucceeded=false、backupReplayed=false、releaseRetention仍blocked。
- 第17步000079 started `10:44:33.318Z`，event `8d277c0cd7d5c3f4181da0af6d860ec50b029e57a54984f3e74e3ee5984648c8`。
- 新E点 `daily-20261010T093506Z-8a5a7107b3f6`；manifest `4cc95143e5feffbd801388cb5de8dd59e269f099ce193afbdc4cfaba310e0f88`，dump `bd3c532a8f897eea2f09f3b60270543993abcda802bd2147c3937539dfc680c8`，content `b2a042fd4e5287ab30642180365d05a74694f7d07ed490c83454bd40f50cf6ce`，profile `2e1375d4a4a0c2a2670291f291d1a116ed68fcaa40a1207d240e0a529bf7a443`。
- 固定隔离 rehearsal `34d6af76d635`、port55593、E盘；原candidate `5faac815...` / AB release `20261010T014638Z-97833d2f2b7e7bc9` / worker f4e537 / Django237f。

完成后的最小充分复核顺序：

1. 原native postgres-operation audit须为同一RestoreRehearsal并completed；其最终result与 `E:\TERUISI-Postgres-Rehearsals\restore-34d6af76d635\rehearsal-result.json` 深比较一致。读取raw及sidecar并计算小JSON原始SHA，不重建stdout/stderr。
2. 对原新点manifest/sidecar和恢复raw/sidecar，使用冻结pure `validateRecovery` 合同验证全部295/296表库存、软件7元组、profile checksum、role/catalog结构、backupId、manifest/dump/content/profile SHA、ID/端口完全相等。复用已完成的唯一dump流式校验证据；不重hash dump或4k文件，不新增PG命令。
3. 检查profileRestoreVerified、sequenceHealthVerified、expected/restored content完全相等、cleanupStatus=isolated_data_removed；policySyntax witness字段如实际未验证，按原值保留，不补称通过。
4. 核原隔离shutdown/清理元数据，独立只读确认 `data` 目录不存在、55593无监听。正式PG如需观察，只读少量已有进程/TCP元数据并与固定PID+创建时间基线比较；不以receipt中硬赋的serviceStateChanged=false代替现场证据，不做生产SQL、Status或主动请求。
5. 手工读取原WAL canonical/hash链及active元数据，不调用会建目录/获取锁的journalState。确认第17步真实passed/exit0、parent started8d绑定、parsed native completion receipt canonical SHA与WAL相等；文件raw SHA另列，不混淆换行。
6. 确认原1–16没有新的started或变异重放：备份/维护/apply/exit/start/install仍各原次数；三次原UI失败、补充UI一次新通过、自然守护旧失败及受限重验、PostBackup unknown及元数据确认全部保留。前后backup身份不得换成旧pre点。
7. 落独立post recovery报告，明确只关闭第17步恢复范围，18–21及整批状态以实际WAL为准。原6profile/10层差异仍是strict full comparison阻断；旧pre dump已删、原releaseRetentionblocked保持。恢复一致只证明“新dump与其自己的新点证据”，不证明前后业务内容未变。

若原operator失败、出现unknown、回执缺失/错点、role/profile/序列/清理或hash不匹配，记录精确原文件、触发条件及缺证；不协调、不重跑、不修改生产文件或旧证据。第三观察器继续由原执行任务管理，独立reviewer只在收到冻结/完成通知后按已有证据报告，不获取新观测请求。
