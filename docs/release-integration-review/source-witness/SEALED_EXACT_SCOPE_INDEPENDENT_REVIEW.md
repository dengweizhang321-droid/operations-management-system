# 实际295d封存范围独立复核

2026-10-10T15:36:41.698Z 只读复核通过，**最终精确候选可供用户批准，生产批准与执行仍为false**。只检查文件、原Git字节及现有WAL；没有执行caller/API/collector/tail/Restore/生产锁或owner释放。

| 封存绑定 | 实际值 |
| --- | --- |
| 根 | `E:\\codex-artifacts\\release-integration-review-20261010\\AB-exact-closeout-20261010-1530-final` |
| canonical scope SHA | `295d8923fb794079faf5cc9c74f92f12d8bd78a3ccbbce4b9dcbb19e00fcc458` |
| raw scope SHA | `bf82070e60d613a169a059af7374dc3bca43862264b4f222c10e9c6d7412421b`，sidecar匹配 |
| sealedAt／源码提交 | `2026-10-10T15:28:43.231Z`／`60d68879ce0f41ceb5389180b85660c532cbb508` |
| 原闭包／总pin | 原collector＋16–21共16667声明、4505唯一路径完整覆盖；4589总pin＝4505＋84 |
| 串行真实文件hash | 全4589件通过，总1796755679字节，11588ms；不是只看清单或旧日志 |
| post dump | 946874951字节，原SHA `bd3c532a8f897eea2f09f3b60270543993abcda802bd2147c3937539dfc680c8`，实际完整流重核通过 |

所有路径无case-insensitive重复，祖先无symlink，realpath一致，文件dev/ino/size/mtime/ctime/nlink在hash前后保持。唯一多链接是原System32 PowerShell主机nlink2及原SHA7600ffe1…合法例外；新增84件及dump没有新例外。Scope按原raw文本Node JSON.parse和原canonical规则复算，没有PowerShell日期重写。

API `b4d5c0876086712dfa63b8f6192a6827ae5730dfab920bb22d6bc7c17b1343f9`、caller `465ad68a9f6c9b8494e969aac61b2299214860ea896e62067e836e359cca1c04`、sealer `055f66d0fb025dd0b9be4aae8160487096b12e9a0ee245dfea85f3b1361b66a5`、rule22ffac76…、parser0d8bc1bc…逐件匹配既有独立复审及Git60d68879原字节。四份独立before/source/API/caller报告均independent、无blocking、productionExecutionApproved=false且接受各自候选；不能交叉把source报告当API批准。Private v2 SHA `3a214c764366bb9b0bce5c929eb54b12d4d2a37941fa6b1bed39b565ca9a8b6a`、proof、witness、原E9 contract/validator7ada、pre/post manifests及Restore/sidecars均在完整pin核验中匹配。

两份已有Restore回执分别为completed、profileRestoreVerified=true、productionDatabaseTouched=false，原字节及sidecar通过；本次没有再演练。Post点仍可用并已实际重hash；旧pre完整dump未找回，恢复90行和revision不能冒充完整pre恢复包。

现有87件WAL逐条canonical原字节、event hash及previous链通过，末端仍 `316f341eafafe08c3366fc79ca2c36b96258d2b00fcd9767a82a32cd62f7ce7d`。前18项latest passed；原19仍unknown/exit1，且是唯一latest unknown；20/21均未开始。Active仍原AB9，raw SHA `7c5af7f44a5aa80579bc9ac2a5038ad5ab757a90dc837de4977513d8be7b0cbf`与封存观察一致。封存根无新human approval、production目录或新补充事件，owner未释放。

精确范围只允许新typed acceptance合同、原20历史审计与21最终就绪的原argv/文件/断言、append-only发布日志，以及全部新合同完成后的精确owner释放。两原只读operation摘要分别原a06835a6…/4a5112f7…已按完整原定义复算；数据库写入、启停/维护、备份重放、Restore、Worker部署及外发全部为0。原19 unknown、strictEquality=false、old engine completed=false保留；C和main新无数据策略不引入运行。新主线合并及额外解释文档不扩展或改变295d批次。

本复核不代替执行时的真实动态身份、权限、维护、排空、完整pin/dump及freshness门禁。实际生产必须另获用户对这一完整scope明确批准；任何输入/head/owner变化按协议拒绝。机器结果见 [SEALED_EXACT_SCOPE_INDEPENDENT_REVIEW.json](SEALED_EXACT_SCOPE_INDEPENDENT_REVIEW.json)。
