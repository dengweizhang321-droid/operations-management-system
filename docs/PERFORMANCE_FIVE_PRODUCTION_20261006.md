# 五项性能优化：2026-10-06 本次生产采用

用户在具体组合候选完成后明确“正式上线”。本次授权仅覆盖组合源码 `2f46e1a998264a15ed514165942c5ecccd4fc044` 的以下 Django/Worker pair、原 KeepPostgres 应用维护、原备份与隔离恢复、恢复及验证。没有新增迁移、回填、权限/预算扩展、业务补跑、n8n 定义或重启、测试消息授权。开发结果与性能限制见 [组合报告](performance/integration/REPORT.md) 与 [候选](performance/integration/RELEASE_CANDIDATE.md)。main `1310f522` 是采用前验证/文档后继，不替代已固定的候选来源。

| 目标 | 精确身份 |
| --- | --- |
| Worker/helper | `20261005T185310Z-463d585110456a95` |
| Worker manifest | `d67a7cdddae2c0c9ca448e30e538699e584635c7bff02d9fd54fed7e9829c361` |
| Worker rotation plan | `a82cca1d598bdadd2e11a8f295df2b1c300d2bff87e46b80eee0b9baffaea698` |
| Django PreparedApp | `5cdf848db1a64ccaa17044c91e59b1d4` |
| Django prepare receipt | `5f76ba6a96594bf1132da43642b8d623dffcf557e9b0e964ab83561cdd2a3dba` |
| Django manifest | `c51eba5ae0b59e77793a77af51278c19b470c870c5da1adfea866e5c869a6ec5` |

执行证据在受限 ACL 的 `E:\codex-artifacts\five-performance-production-20261006`。直接控制器使用文件标准流采集真实退出码；不因业务子进程持有输出流而杀服务。所有失败和未完成样本保留，外壳成功不冒充操作成功。

## 前置与恢复

原 Worker `20261005T063949Z-62c5bbb1bc2901ab`、Django `426b1ab9` Running/Ready/exact_release，12 组件通过。准确候选来源、完整45变更业务文件、11受保护入口旧字节和149迁移源码核验通过；当前139已安装迁移不新增。运维 MCP 本轮未提供，改用原本机只读 API，未读取或输出凭据。

排空前四域固定范围 API 都返回200，仅保存摘要/时间而非原始行。销售单写源 Django/PostgreSQL，revision46:43，截止2026-10-05、throughYesterday=true。AI agent/workflow/space 三队列0，backup console 无非终态；helper ready/idle；n8n 元数据只读无非终态。市场两历史 running job 实际 cloudRun paused/activeClaims0/nextRunAt=null，原 inference_result_unknown 保留，不冒业务完成或恢复。

前原 Backup 20:32:33—20:43:08 UTC 实控 exit0，E恢复点 `daily-20261005T203313Z-3e877e891f22`；manifest `b77396f615a261feeed7262281acfa3a3e200a63de304a517476eae80a84e78f`，dump `2c10fee201698503672da10d0221dae9292f5ed7a4f97e5136aeaea8a03c239e`，content `ef93513dcb9d20f65021f1af8bd62c2ae9ccd9c119b43c9c7aa5e366bdb9c258`。Verify实控exit0。完整manifest/sidecar、295表和49角色元数据在自动淘汰前逐字节保全。

首次 RestoreRehearsal 缺12hexID，在参数门禁失败 exit1、未启动私库；失败样本保留。准确 E55894/`e8bc13b2bf82` 恢复20:51:19—21:01:35 UTC 实控exit0，expected/restored content相同、profile003f/profileRestoreVerified=true、productionDatabaseTouched=false/serviceStateChanged=false、isolated_data_removed。非作者独立核回执、摘要、私有数据/临时密码清理及端口释放，不冒再次查询已删除私库。

## 应用维护

维护ID `c4ad24a5d23c4907807c6c1706bfeeb1`，原EnterMaintenance21:08:07—21:11:25 UTC实控exit0、maintenance、keepPostgres/drainedStopped=true。正式PG4080（创建UTC2026-10-04T14:26:47.0957370Z）和n8n18800（2026-10-04T14:25:05.7875120Z）精确身份保持。应用停止后追加原一致性工具的全表/角色/profile只读摘要，后续采用与恢复结果将追加。

停稳后的原一致性工具 probe21:11:33—21:15:35 UTC实控exit0；完整frozen-before元数据另存E。content `0c7d0540542a1b59216ff2536ea3ed40fd0a694193a5648315c2edb8248a8a86`、profile `cecacd238a170940b131ee6728283f941fe25a887427e56ec8a14682d93da935`。在线前备份到停稳基线仅 `market_write_request_receipts` 从172387到172425行及摘要变化；其他294表、49roles、catalog、migrations、sequenceLowerBounds和其他domain evidence相等。该比较只能定位区间变化，不能自动将38条变化归因自然写入或本次源码。没有恢复旧库制造相等。

原DeployApp21:15:52—21:17:04 UTC实控exit0；实际installed manifest c51、fingerprint571与准确候选一致，16变更后端文件逐SHA通过。HardenAcl21:17:34—21:18:00实控exit0，原限制ACL已满足、无需重复修改。没有Install/迁移/回填。

原Worker rotation apply21:18:06—21:20:43 UTC实控exit0/stdout activated。准确release463d/manifestd67/plan a82；successor `a65163667fcf82b8704fc969122871e0ce98bcd38ec22e7333385a544890f962`、consumption `ee3bcf58ca246b3e84fb0a276be3be2c5d08a4973669530672fabfabce5a855c`、startupBinding `e9846b9795022e45f7ac95847568c32a6bf95c41b09a14a68b69bc018f4d4f49`。

## 后备份与全库比较

原后Backup21:21:31—21:30:48 UTC实控exit0，E点 `daily-20261005T212205Z-d11436560acc`；manifest `223e36f187357a2f8257838f1dc7d4d9e2a8dfc2510c78c6c2ac5b8fe6ff4d17`、dump `3b62687771c2920b61d096adf77eab2d6a1ca59445c93ca3c2129b42313cb010`、content0c7d。完整后manifest/sidecar另存；原3恢复点/2保护保持，前点daily203313已淘汰，不能再引用其目录为现存恢复点。前元数据与原成功恢复证据仍在E执行目录，不额外复制dump绕过保留策略。

停稳基线→采用后备份，295表集合及每表rows/sha、49完整角色合同、catalog、sequenceLowerBounds、139迁移、完整domain evidence/profile **严格相等**。非作者对完整对象逐项独立比较，而不是仅比较总体hash。在线前备份→后备份仍只有上文38条市场回执区间变化，不宣称两个在线时点全库相等。

后Verify21:31:10—12 UTC实控exit0，准确三摘要匹配。原后E55895/`6d87cc3aa9b1` RestoreRehearsal21:31:24—21:41:08 UTC实控exit0；expected/restored content0c7d与profile ceca一致，profileRestoreVerified=true、productionDatabaseTouched/serviceStateChanged=false、isolated_data_removed。非作者独立核完整回执与原E实体字节、端口释放、data/临时密码不存在及原PG/n8n身份保持，给应用恢复前置PASS；没有再次查询已删除私库。

## 应用恢复

原精确ID ExitMaintenance21:42:41—21:43:18 UTC实控exit0/stdout maintenance_ended，维护marker已不存在。随后原唯一Start入口执行，具体终态与业务验收追加在下方。

原唯一Start21:43:52—21:47:44 UTC实控exit0/stdout started，准确release463d/manifestd67。原SystemStatus21:50:26 UTC实测Running/Ready/exact_release、12组件全true。原VerifyStartup21:51:10—14 UTC实控exit0/verified/startupVerified=true。17个正式首页资产HTTP200、逐字节匹配candidate dist/client；PG/n8n完整PID与UTC创建时间保持。helper ready/idle、无activeWorkflow/storeExecutions/drain。后原BackupStatus实控exit0、3恢复点/2保护、operationHistory.unresolved=[]。

早期直接健康URL读取未带原约定 `x-teruisi-local-health: 1`，返回404，不作为后端失败或健康资格；原控制器与随后携带原标记的只读健康探针返回ready。未放宽身份或另建健康入口。自然看门狗早期stale/cooldown/identity_failed及在途非零TaskInfo样本保留；最终自然验收另述。

## 正式业务与性能限定

固定销售9月1—30完整summary、库存overview/page1/20、商品9月1—30/page1/20/净额降序、市场9月20—26/SKU/page1/20/不附筛选项，采用前后均200，四对象全部原业务字段规范化摘要相等。仅排除生成/检查时间、读取scope/snapshot、附加salesSourceRevision等版本元数据；商品新版本见证另验证46:43。没有保存原始客户行。此结论只覆盖这些读取对象及范围，不冒全部页或任意范围等价。

实际生产新分区七次只读请求均200：真实validSalesSummary验证core/full必要DTO，46:43一致且current/previous/yearAgo/日期/筛选深等价；库存summary/detail完整scope/snapshot和metrics一致；商品真实decodeProductRead验证initial-page→overview→page2同snapshot/46:43/全集合total/请求筛选与排序。合成异常/身份交错沿用组合隔离材料，不在生产注入故障。

以下为有限单次抽样，前后负载、并发、缓存状态没有配对；不称冷缓存/P95或稳定提速。旧整包接口仍保持兼容，分区契约测量发生在整包读取后，可暖。

| 场景 | 上线前(ms) | 上线后(ms) | 说明 |
| --- | ---: | ---: | --- |
| 销售整包summary | 5672 | 5359 | 固定9月，自然缓存与负载 |
| 库存整包overview | 3266 | 3672 | 不是渐进首内容时延 |
| 商品整包summary | 735 | 766 | 商品试点前驱已有优化 |
| 市场单周榜单 | 2843 | 5562 | 保留较慢样本，不冒已全面提速 |

新契约暖范围读取：销售core397ms/full1357ms，库存summary448ms/detail456ms，商品initial81ms/overview89ms/page2 37ms。页面实际渐进呈现由独立真实浏览器验收另述，不把API完成时间当作绘制时间。

维护区间原n8n“新品销售周报（本机时间）”6481与6488为error，6489随后自然success；历史失败保留，未手工重放、修改定义或发送测试消息。不把任意success当作业务下载/导入成功。当前只读n8n非终态为空，原进程未重启。

## 自然守护与独立复核

原自然看门狗补齐Django supervisor40784，monitoring最新state21:54:06 UTC为healthy/all_components_ready。Root没有另行手工运行看门狗、启动守护或清状态。两次不同自然计划任务分别21:56:24、21:58:24 UTC触发，作者采集时均TaskState=Ready/LastTaskResult=0；对应新snapshot at21:56:25.284/21:58:25.369 UTC、healthy、12true、supervisor running/healthy。非作者逐项复核通过，原受控渠道新stdout仅被动connected，没有测试消息。

早期stale/cooldown/identity_failed、267009/2147946720在途样本保持，不能作为完成exit0；notification preflight失败不冒已发送。实际服务Ready与守护补齐时点分别记录，不把旧snapshot当当前健康。

后端/发布/运维非作者最终PASS，原完整报告在本E `independent-review.json/md`；实际源码45/45、149迁移定义、139已安装迁移、准确生效链、全库比较/恢复、数据契约/资产和两自然轮范围通过。独立UI验收范围另述，不冒任意范围/P95/所有速度目标已达标。

## 真实浏览器独立验收

独立Chrome验收tab明确加载新包，原用户tab保持不动。17主子页（销售5、库存6、商品2、市场4）及14附加只读视图/详情共31项均取得终态、无未完成loading；50个非图片API全部GET/200，13图片读取无失败，Runtime异常0、console error/warn0。十张实际截图及metadata独立回读通过；验收tab已关闭，没有mock、注入故障、业务写入、导入、任务启动或消息。

额外覆盖广东清单/供应商、商品规格、销售品类店铺详情、市场趋势、五设置分区、SKU详情、AI复核列表/大图及既有类目配置。sales core→full、库存同scope/snapshot、商品initial→overview同snapshot/46:43由实际浏览器网络元数据再次确认。报告 `ui-acceptance/production-ui.json/md`，JSON SHA `8a7e3ab47e5378a252b2562ef176753e4306ae163813ac82f7fe50ec62bdee00`；后端独立完整JSON SHA `f8d342af23a5debdb88c63f39df145c613af292f21c46bf37532a94f3acb19ca`。

CDP请求到loadingFinished的有限单次样本：库存summary/detail约2.190/2.197秒并行、商品initial/overview约536/71毫秒先后、规格约1.992秒；市场榜单/独立筛选约1.904/3.697秒并行、行业约4.151秒；AI workspace_fast/candidate_counts约5.491/1.783秒、先后约7.275秒。不是DOM首绘、纯后端时延、冷测或P95；同期Root读取可温热相同范围，保留responseReceived/loadingFinished原事件差异，不制造严格TTFB。

财报10月无来源，按原明确规则回退8月；市场TOP覆盖、未锁单类目/范围、历史窗口/正式价/品牌/细类缺失及全历史比较口径提示保持。库存截图为10月6日快照、销量9月6日至10月5日，优先补货建议仍受原数据质量门禁保护。页面Ready不是业务门禁已解除或缺源已修好。行业/AI工作区/部分冷读取仍慢，不宣称所有页面1—2秒、任意大范围或长期负载已达标。

本次准确候选生产采用、恢复、独立后端/运维与上述UI限定验收分别成立。原开发及被当前部署/预览/证据引用的来源树暂保留，不删除占用树；正式源2f46与原前驱回退材料保持，回退代码须走新精确候选/原生命周期门禁，不擅自恢复旧数据库制造等价。仅本次已批准采用，不授予未来维护、迁移、回填、扩权、调度、业务补跑或外部消息。

## 并发主线与来源边界

本次正式来源始终固定独立仓库2f46，实际Django c51/139与Worker463d。期间main另推进e7244e5f（BI/ERP140候选），本轮只将生产文档在最新main追加，没有采用其代码或迁移、没有重建包或占用其他候选。提交到main的文档SHA不能作为本次构建SHA；后续任务须复验当前前驱，不能复用本次已消费rotation plan或旧Prepared，不能直接修改共享固定源。遵循本轮边界没有联系其他聊天。
