# 方案二 SQL 与跨域配置组合修复

2026-10-03，Asia/Shanghai。用户选择“先修完SQL，再一次追加维护”，并授权休息期间常规问题自主决策。本文记录准确候选与实际回执，不以结构 Ready 代替五栏目业务验收。首次采用及保留的真实503见 [原采用记录](20261002-production-adoption.md)。

## 已完成源码与独立资格

- peer URL 源码 `8707b9d60092a2697439de5609be0a09df5481ad`，已合 main `33a608b7ebda968ce77dc16f6846fa20b3b1e837`；只补网店 reader 的 Sales/Finance/Workflow 三固定本机地址及环境恢复。
- SQL/期限源码 `21d79ab19e3aef37e0b67df5755c779178859a90`，正常合入 main `ac319dfca7cc8c21307a8bbf008be2c12cea9e31`；远端精确相同，主工作区干净快进。递归店铺发现保留原平台、历史、数据库排序和51成员拒绝；日期查询使用已有索引的64行证明前缀，不能证明时按原完整范围聚合回退，不截历史或缺口。
- 共享读 SQL 复验原绝对期限，不提高单 SQL 7秒、RPC 8秒、整体65秒或2MiB限制；不改变业务指标、批次资格、实时账号检查、权限、索引或迁移。
- 非作者 Q 实际独立 PostgreSQL **47/47**，另7纯期限/取消负例通过；私有数据库60910已正常停止。正式报告 `E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\context-sql-review\review-final-context-sql.md`，SHA256 `DD2FF9DB4D64CBDDC782E294DCCB996758594DF6A8DE0C2A33664DA4C973824E`。
- 原最小只读身份仅做 EXPLAIN、未 ANALYZE，候选使用已有索引；估计成本与隔离时间不冒生产P95。缺少账号GRANT的假说已否定，没有扩权。

## 组合准备与维护状态

已按原 PrepareApp 完成组合准备并独立核对：id `99e085cd17ab4c4c9e1e8a7a9f142fa2`、receipt `a4471ae09ff70f6936ff3ecc60e76794f99b1d8aa7c474853ef84da8a0dcdc1d`、candidate manifest `76f7857203e780758fb2393b10ae735a0e46ba8aaa2dbf3fba32654a2c3a3179`、fingerprint `5b76b77030088834c39f25b82e0dd6b6f1768a191757ba885c32bdd48803aace`。前驱仍 `6929b2c6cc4248c5be84e108c57622419f7f071bfc393b4075d8b198d1c88707`。旧配置单包5bed仅准备，没有单独采用。

原 Worker/helper `20261001T164608Z-4dc26d0ae8921e88` / manifest `87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9` 保持，本次没有另 apply Worker。第二次维护ID `3c3dd4a3c51f4dbab9c2b0092f4c54ea` 已实际完成：最新任务准入及原排空通过，KeepPostgres / DeployApp / HardenAcl / 同ID Exit / 原Start 均exit0。维护标记生成01:29:55.7755513，Exit命令实际返回maintenance_ended；没有精确结束标记时间证据，不据此声称精准网页停服秒数。

01:38:18.2352051原组合状态为Running/Ready/exact_release，全部12组件true；live/ready正确请求头均200，VerifyStartup verified。原Start回执started/supervisor27716；本轮外壳正常exit0。安装三处改动文件逐文件SHA与受审源完全相同。PostgreSQL20664/create10月2日20:37:32.026194、n8n16852/create20:35:33.535468维护前后均保持。

Django守护在恢复初期stale，按原已安装Restore-WatchSupervisor受保护函数补齐，01:40:29状态running/healthy/all_components_ready；没有重新停止业务服务或主动发送通知。初期任务exit0但healthy=false记录保留，不冒最终健康轮次。

## 备份

新前备份及 Verify 实际完成：`daily-20261002T170502Z-8f5c76835ea7`，manifest `c7904ac23a503bb99847cb8ef4a151f1c51d9252d1d19ebd07ddaa1ec937adc4`、dump `8d42bf504db44af114c78bfc6829aea654d606736822c93a8620e4cc137ac868`、content `6ffb67840c3f5fa00f3fc25a2c4e0bffe0762fb2d8fd48947cbf4454b28c8b5f`。独立 E 恢复 `a5b40bb1ca39` / 55897 实际01:19:05—01:28:10完成，内容摘要相同、profileRestoreVerified、isolated_data_removed，productionDatabaseTouched=false、serviceStateChanged=false，原执行exit0。该前备份已在本次后备份成功后被原策略淘汰，是历史证据而非现存恢复点。

原保留策略仍最多3份/2保护。首次采用后备份 `daily-20261002T135742Z-51d1f444fb7a` 已被新前备份按原策略淘汰，只是历史验证证据，不能继续当现存恢复点。

本次后Backup/Verify实际exit0/completed：现存 `E:\运营管理系统业务数据\daily-20261002T180200Z-0f0593be8742`，manifest `4262b0619518422f37bf267854fca0e53964a19bdde79262d3208d4f4f7e4fae`、dump `6b7224ec09111946a0d02d70393c3168965a2a68190b60c31bde1b0afb98bb81`、content `0a0053411654736494ce0a393b680affd054da8efe3ce0f7892ce4b021b6a022`。E三原文件存在且原工具逐摘要验证；02:12:32操作完成，releaseRetention completed/0旧载荷。现存另外两保护为9月29日012900/ad281与9月28日125351/31cb；138迁移完整证据与9月29日保护基线完全相同，delta0。没有新增迁移或恢复覆盖生产。

## 待完成与边界

组合实际采用与运行绑定完成；非作者Q真实原用户浏览器五栏目在当前用户9月1—29日范围仍全部503，目录也503，未生成可验六来源载体。不是全五栏通过。O原无outlet整JD为约8.68秒、P同设备店SPU约7.30秒、A SKU约7.43秒、S约7.23秒、目录约8.41秒、C约12.04秒；这些是浏览器响应头阶段单次观察，不能称P95或完整渲染耗时。旧入口/01切换及精确FAIL报告仍在收口。新源码隔离资格不覆盖真实生产失败。

新reader固定脱敏日志证实 O store_overview.py:225 的七日推广原始聚合、共享 insights_common.py:311 的字段覆盖聚合出现 statement_timeout。没有权限/schema/连接错误证据；重复trace计数不当作请求数。原最小reader仅 EXPLAIN/noANALYZE 核真实月范围：推广现有 scope/date 索引 Bitmap Heap + completed HashJoin，仍有高估计成本；没有重复低估Nested Loop根因证据。JSON重复TOAST及heap I/O尚为待私有实证假说，不声称已定位全部底层原因。

01:45:24与01:51:24两次自然watchdog实际Result0且healthy/supervisorHealthy，早期Running267009和stale记录保留。后备份待真实验收读取结束后顺序执行。未把503历史改写为通过，也未把数据缺源当作系统故障。

正式非作者真实验收FAIL报告 `E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\production-acceptance-combined\review-final-production-combined-fail.md`，SHA256 `95AC257995038E7A48D103D8BB9A5226E77B797132661CA998188AC52157443D`。实际同范围原ERP sales/summary200，自动旧P摘要/旧推广总览200；01切旧视图pressed且原经营明细1表/200。正常导航框架重挂载额外新reader失败单列，不称请求唯一或全部旧功能全面回归。

唯一允许的旧历史9/30设备店SPU单日S LocalDirect补充一次403/access_denied、4.512秒，未伪造身份或重试，不能替代浏览器或证明六源生产闭合。Q已结束全部读取，Network观察关闭，用户页留旧总览同月范围。02:01:42原installed后Backup开始，操作ID `585a32af895c4348a0e71d264770d138`，完成结果另补。

独立启动链/业务就绪新工具原baf存在健康请求头及未验证PID清理两项独立阻断。另一个隔离作者只修这两处和负例，精确源 `f9753b0d47a85e27dd8da6daad3d130053fad649` 已经原非作者复验PASS，正常合main `2fdfca029be054fe41d4fd144fcc564685cb6f37`并核验远端。独立实际12 Node、6私有HTTP预算/取消负例、PS5/7各5归属状态及原拒绝seam通过，拒绝handle Wait/Kill=0；真实启动矩阵两正两负两hash拒继承作者，明确不是非作者自己重跑。工具没有混入76f运行候选或修改现有liveness/看门狗；文档接线见 [就绪检查](../../../NETSHOP_READINESS_GATES.md)。

独立报告 `E:\codex-artifacts\netshop-readiness-independent-delta-20261003-fd89910732bc47f6ad348bd7a1744c0b\PASS-DELTA.md`；旧FAIL保留。新增检查只显式用于发布，不挂定时重型查询、不扩业务授权。

本轮已安全归档17棵并额外删除6个闲置本地开发refs；仍有活动预览、独有历史和未知进程依赖的树保留。无业务记录删除、强清槽、手工业务重跑/下载导入、付费模型或主动外部通知；n8n定义/调度与数据库保留。原5413 error及历史根因未知状态保留。

10月3日另正常删除Root未checkout的两旧本地refs：`codex/netshop-m6-integration`/56e与`codex/netshop-runtime-peer-urls`/33a，均已远端main包含；后者同名远端8707正常删除，前者远端原不存在。原普通-d因旧upstream落后拒绝peer本地删除，复验main包含后解除该旧upstream、仍普通-d完成，没有force删除。当前context source tree保持；清理回执 `production-combined/unused-old-refs-before.json`、`unused-old-refs-completed.json`。

实际顺序回执入口：`E:\codex-artifacts\netshop-scheme2-20261003\production-combined`。
