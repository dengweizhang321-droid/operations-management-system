# 全部店铺读取优化：已批准的生产采用记录

用户明确“批准本次候选上线”，授权准确 `a179d1acabd2437a82dc91f7c7005284` / receipt `61113c73a40ba854b248eebce2837837f941a1d537963bbfeff13782a97714be` / candidate manifest `e4f48e98178a77fac41ac269b40076f2c30bf449c8c5562e28a0a056f4ba22e1` 后继及一次原 KeepPostgres 应用维护。该授权不扩大到139迁移或缓存回填、业务补跑、权限/预算变化或其他候选。

源码 `5686f277`，准备及隔离验证见 [候选交付](20261003-all-shops-query-optimization.md)。实际证据目录 `E:\codex-artifacts\netshop-all-shops-production-20261004`，维护 ID `133cf5221e9440dabcf91471e7976b07`。

## 已执行步骤与当前阶段

00:48–00:54：准确 Prepared 和 running318 前驱复核通过，原系统12组件Ready/exact_release、helper空闲、三AI队列0、备份console无在途；市场两running job的cloud均paused、livelease0。n8n仅原5936/5944等待，未取消或重放。PG20664及n8n16852创建身份与前轮保持。既存市场业务告警保留，不冒已修复。

原 Worker87 EnterMaintenance -KeepPostgres 于00:55:20声明本次持久维护，完整排空/停止应用后00:57:30结束，原命令exit0，drainedStopped=true、postgresPreserved=true。未停止 PostgreSQL/n8n。

前备份 `daily-20261003T165941Z-a72aecfecff2` / manifest `c596b11bc4fa276a3d67fbb39dc4cbf1cc5fa872cef03b86a7bf0638daf756c1`、dump `9ab5a8d7f4fff58618012a9f7d8a0d5dec3900d9a2f01e00578552511991077a`、content `5cc542ecd64306a11f438a79ee45babdf9e48f2da9fbf95d24f21604d6b3e6da`，原Backup与Verify均exit0。全部295表、49角色、139迁移和私钥0纳入完整profile。原保留策略将昨日未保护后备份071934轮转淘汰；只保留其历史证据，不冒现存恢复点。原releaseRetention还安全移除4个旧Worker payload，不修改当前87。

前独立恢复 `72f918ca8a2e` / E55897 实际01:16:05–01:25:29完成exit0，expected/restored content均为5cc5、profile `d41d96e509cf2033ce1dabf3ddf41212c4cfe0e5bbc8211377a6d3045ac82948`一致，productionDatabaseTouched=false、临时实例正常停止且data清理。

准确原DeployApp/a179/611实际01:27:56完成exit0，installed manifest e4f48e98、fingerprint abb61f60，三个功能源码逐SHA与批准候选相同。随后HardenAcl exit0，原限制ACL已满足、没有新增权限。未执行Install、迁移或回填。

后备份 `daily-20261003T173240Z-7c549b13c2c3` / manifest `eb7bea76d5e14e554a2c8542897a7952d4f5329cf56fd268c7e9830999eff845`、dump `94084b90aa89b847ce8c2f0681a34bda223fb3797f13e009cbd446de2add8c44`、content仍为5cc5，原Backup与Verify exit0。前后全部295表、49角色、完整profile/evidence逐字段相等，没有豁免；139→139、私钥0。比对原件 `exact-backup-profile-comparison.json`。

原三份/两保护保持；本轮前备份165941按原规则轮转淘汰，当前可恢复点为本次后备份173240及9月28/29两个原保护点。前备份只有历史证据，不能再引用其目录恢复。

后独立恢复 `c388f99ca3e4` / E55897 实际01:49:58–02:00:20完成exit0，expected/restored content为5cc5、profile d41d一致，productionDatabaseTouched=false，临时实例正常停止及data清理。至此全部前后Backup/Verify/Restore和完整数据/角色比较通过。

原ExitMaintenance/133cf实际exit0，维护门按原流程清除。原Worker87唯一Start的直接控制器39492于02:03:11启动，stdout实际报告started/supervisor10124；采集脚本的Process.ExitCode为null，外层因此exit1。**原控制器退出码未知，不冒exit0或业务启动失败**；没有重复Start。该问题只涉及本轮退出码采集。

02:10:49原系统Status实测Running/Ready/exact_release、12组件全true；原VerifyStartup verified，17实际首页assets均200且字节一致。原受保护Restore-WatchSupervisor入口通过持有原Django mutex复核运行意图后补齐Django守护；本轮使用文件标准流/Python直接子句柄采集，实际exit0。后续Status running/healthy/all_components_ready，原pendingAlertCount210保留。PG20664和n8n16852创建身份前后相同；helper ready/idle、无drain；原钉钉stdout被动connected，不发送测试消息。

## 三个截图范围恢复与月度回归

实际用户Chrome独立验收标签通过原界面/已观察链接访问，未伪造principal、缩小店铺范围或放宽生产预算。

| 范围 | 实际结果 |
| --- | --- |
| 天猫全景目录，SPU/自然周、9月20–26日 | context200，完整12,076字节DTO独立解码、六家授权店铺，来源错误0 |
| 京东新总览，全部店铺/逐日、9月20–26日 | 200，headers约2.421秒，完整150,500字节DTO独立解码、四店、来源错误0 |
| 京东推广，全部有效店铺/自然周、9月20–24日 | 200，headers约3.747秒，完整495,729字节DTO独立解码、四店、来源错误0 |
| 原设备店SPU/performance/逐日，9月1–29日 | 200/headers约26.288秒，原六源可信读取、八章渲染、alerts0；仅UI/headers资格 |

前三项实际修订均25591:e3f70e44b80c，原失败已在相同截图范围关闭。推广厨电/洗碗机缺推广日、SKU金额/访客字段和历史比较缺口均原样显示，不补零、不改变数据或宣称全量完备。原月全景继续保留无已完成财报月、ERP/事件请求范围不代表完整覆盖，以及成本/映射/去重等边界。

月度S的CDP getResponseBody返回No data found；同一159请求26.29秒loadingFailed/canceled/ERR_ABORTED，页面仍经合法客户端解码渲染。因此未取得完整月度DTO/源向量，不冒独立完整响应验收或P95；不重复月度热点查询刷通过。Network采集已关闭。

原三端点完整解码报告、摘要和截图在 `browser-scope-verification.json`、`browser-*-decoded.json`、`browser-*.png`；月度UI资格原件 `browser-panorama-month-ui.json`。首次独立解码harness的Windows绝对ESM loader路径报错，改为本树已安装tsx后复用同一浏览器body解码通过，旧错误JSON保留；不重发业务请求。

独立Operations Watchdog的旧23:51检查仍在运行，仅有原Check进程及conhost，最新计划快照仍23:50，未取得两轮新自然任务验收。本轮没有停止它、修改计划任务、扩大监控或把Django守护healthy混作其自然验收。此既存问题与三页面恢复分别报告。

## 业务验收范围

恢复后分别验收：京东推广全部有效店铺9月20–24日、天猫全景授权目录9月20–26日、京东新总览全部店铺9月20–26日，以及原月/单店功能。目录/元数据SQL快或结构Ready不替代实际接口与页面通过；真实缺源继续保留，不能称任意范围/P95或数据全部完备。

原三份/两保护备份保留策略继续执行，备份轮转删除的目录只作为历史证据，不冒现存恢复点。两个旧已停止的合成benchmark目录清理的自动审批拒绝继续保留，不在本轮换方式绕过。
