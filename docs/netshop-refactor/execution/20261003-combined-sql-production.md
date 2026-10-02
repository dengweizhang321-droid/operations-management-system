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

01:45:24与01:51:24两次自然watchdog实际Result0且healthy/supervisorHealthy，早期Running267009和stale记录保留。真实验收读取结束后已顺序完成上节后备份和Verify。未把503历史改写为通过，也未把数据缺源当作系统故障。

正式非作者真实验收FAIL报告 `E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\production-acceptance-combined\review-final-production-combined-fail.md`，SHA256 `95AC257995038E7A48D103D8BB9A5226E77B797132661CA998188AC52157443D`。实际同范围原ERP sales/summary200，自动旧P摘要/旧推广总览200；01切旧视图pressed且原经营明细1表/200。正常导航框架重挂载额外新reader失败单列，不称请求唯一或全部旧功能全面回归。

唯一允许的旧历史9/30设备店SPU单日S LocalDirect补充一次403/access_denied、4.512秒，未伪造身份或重试，不能替代浏览器或证明六源生产闭合。Q已结束全部读取，Network观察关闭，用户页留旧总览同月范围。02:01:42原installed后Backup开始，操作ID `585a32af895c4348a0e71d264770d138`，02:12:32实际完成，准确现存恢复点见上节。

独立启动链/业务就绪新工具原baf存在健康请求头及未验证PID清理两项独立阻断。另一个隔离作者只修这两处和负例，精确源 `f9753b0d47a85e27dd8da6daad3d130053fad649` 已经原非作者复验PASS，正常合main `2fdfca029be054fe41d4fd144fcc564685cb6f37`并核验远端。独立实际12 Node、6私有HTTP预算/取消负例、PS5/7各5归属状态及原拒绝seam通过，拒绝handle Wait/Kill=0；真实启动矩阵两正两负两hash拒继承作者，明确不是非作者自己重跑。工具没有混入76f运行候选或修改现有liveness/看门狗；文档接线见 [就绪检查](../../../NETSHOP_READINESS_GATES.md)。

独立报告 `E:\codex-artifacts\netshop-readiness-independent-delta-20261003-fd89910732bc47f6ad348bd7a1744c0b\PASS-DELTA.md`；旧FAIL保留。新增检查只显式用于发布，不挂定时重型查询、不扩业务授权。

本轮原先安全归档17棵、删除6个闲置本地开发refs；本日新增资格和实际清理见后两段，累计19棵与额外8个闲置本地refs。仍有活动预览、独有历史及未完成候选/审查环境保留。无业务记录删除、强清槽、手工业务重跑/下载导入、付费模型或主动外部通知；n8n定义/调度与数据库保留。原5413 error及历史根因未知状态保留。

10月3日另正常删除Root未checkout的两旧本地refs：`codex/netshop-m6-integration`/56e与`codex/netshop-runtime-peer-urls`/33a，均已远端main包含；后者同名远端8707正常删除，前者远端原不存在。原普通-d因旧upstream落后拒绝peer本地删除，复验main包含后解除该旧upstream、仍普通-d完成，没有force删除。当前context source tree保持；清理回执 `production-combined/unused-old-refs-before.json`、`unused-old-refs-completed.json`。

新增已完成两项工作树清理，累计 **18受管归档+1普通移除=19**：

- 平台作者 `D:\.codex\worktrees\netshop-platform-series\运营管理系统` / `codex/netshop-platform-series` / e3db：旧3受保护进程身份在外部整机重启后消失或重用已独立核实；当前无借用/锁/进程/启动依赖，5尾7471B逐SHA保全复验。Root真实附件范围应用归档为 `01a0fddc-cf79-7330-b56d-43da915df263`，目录/登记/本地与同名远端分支实际消失，main包含源；恢复附件保留。非作者资格报告 SHA `66A22C9869EB3E09ED1894A0C5D465A05B05F7756008C54BB080B183F267E378`；实际回执 `production-combined/platform-cleanup-completed.json`。
- 就绪修复普通树 `D:\.codex\worktrees\netshop-readiness-fixes\运营管理系统` / `codex/netshop-readiness-review-fixes` / f975：必要源及测试证据E保全逐SHA、main包含、无活动借用/锁后原生Git移除。Git留下唯一已知node_modules junction，逐身份确认仅解除该链接、不递归借用目标，再移空目录/父目录；public-freeze借用缓存marker摘要保持。目录/登记/本地与同名远端分支消失，无force。回执 `readiness-fixes-cleanup-preflight/completed/postflight.json`。

## 下一阶段：只准备离线可审恢复候选

单JSONPath原型开发源 `0be58e2189328c74e1753a606bf8e190331d68c3` 推送保全但没有合main或采用。非作者496自造VALUES正过滤Count/Sum等价，原NULL/新FALSE差异单列；微型warm约30%改善未覆盖生产。Root最小reader明确只读、原7秒限额下的真实9月1—29日 original/current与prototype/current/previous各一次均57014（约7.06秒），没有业务行返回、未保存SQL参数或凭据。因此不继续发布该原型。

窄索引的私有Micro虽然可IndexOnly，但合法长batchId完整回退的耗时仍退化，且未覆盖A五指标/原对象路径，不采用。这符合 [PostgreSQL17覆盖索引限制](https://www.postgresql.org/docs/17/indexes-index-only-scans.html)，不能将wide metrics_json塞索引后承诺消除TOAST。

I已组织新的 **仅离线** 候选 `codex/netshop-promotion-presence-cache`：仅JD推广/ad五tuple，以两个mask保存完整TRUE/NULL/FALSE，加规则及精确rowhash/batch echo五nullable派生字段；未知或不匹配始终原JSON回退，writer原事务维护，业务basis更新失效，历史精确JSON快照CAS分批更新。原0003 guard不改、不加例外；缓存更新也遵守全局revision/digest，每批推进会使token失效；锁顺序先global再目标行，0row CAS savepoint撤marker。结构readiness将校验新增列/失效触发器，liveness不改。

这是新增迁移/派生回填及另一采用窗口的候选准备，**生产138/76f/87保持，没有实施**。离线完整迁移、写链/并发、三态、旧源兼容和非作者审查尚在途，未给可采用结论。待精确源码/包绑定与测试收口后，必须先向用户说明新增结构、回填WAL/锁/容量、token失效、回滚及维护影响；未获该范围明确许可不能执行生产迁移或回填。设计 `E:\codex-artifacts\netshop-scheme2-20261003\JD_PROMOTION_PRESENCE_RECOVERY_DESIGN.md` 与冻结补充 `JD_PROMOTION_PRESENCE_RECOVERY_DESIGN_ADDENDUM.md`（SHA A4978E7E486BF94CF898E130E67EFB6ED22BE688CAE19D38B10CE6AA65621D57）分开保留旧备选与最终不绕守卫的决策。

离线最终作者候选为 `00c6f642fb4228f1c91a2e03844a1140a8fd6fd0`，干净远端分支 `codex/netshop-promotion-presence-cache`；20拥有者文件Root对作者磁盘SHA清单全部匹配。三处作者磁盘CRLF、Git/Q清洁源码LF导致原字节SHA不同，Root逐二进制归一复验20/20内容与准确Git相同，映射 `presence-cache-author-git-provenance.json` / SHA `ecb7f787baec1bad35a196b992dd3a1ab1b997852bd8a9dfd239b2094884652f`；不把作者原字节清单说成Git原字节清单。尚未合main、Prepare或生产采用。作者最终49实际私有PG、38unit、PS5/7各5通过；早前core独立57+2私有验证只覆盖core版本，不能替代最终新增代际与catalog delta的复核。作者原交接明确没有完整138→139备份/profile及应用生命周期证据，当前安排纯自造完整schema的官方函数演练和两名非作者分工复核。准确交接 `E:\codex-artifacts\netshop-scheme2-20261003\presence-cache-author-20261003-07\FINAL-HANDBACK.md`；具体采用和回退待审方案 `E:\codex-artifacts\netshop-scheme2-20261003\PRESENCE-CACHE-ADOPTION-PLAN.md`。

原正式代际控制器要求同一维护标记时间之后的新138前备份及独立恢复；139后备份、独立恢复与Finalize也须应用停止、保持同一维护。必须在Finalize后再Exit/Start，不能把普通应用维护的先启动后备份顺序套用。新方案窗口包括这些重型步骤，尚未声称可短窗口采用；原安全门槛不放宽。

最终补证实际发现原PowerShell备份校验仍硬138；未放宽为>=，唯一作者只改NoKeys代际符号和专属PS测试，后继 `3dba3b66ec3d6db4fb0e5fa03f18979079297840`：完整原138集合固定Ordinal/canonical SHA，139须只增加唯一0004，真实标量类型、重复/未知/缺项/表计数不一致均拒。作者与非作者分别PS5/7各2正、8集合负、9类型负实际通过；原数组类型反例已拒。最后作者真实139 Python备份、新PS载荷验证、独立新DATA恢复及AI reader/writer实际登录健康均通过，295表/308合成行/31角色。原完整138由实际62+76步骤构建，并先真实备份/独立恢复；不是插入138条假记录。21见证SHA、真实before138 roles/authority/catalog witness、唯一0004原引擎intent/outcome和139内容/角色/权限完整根由非作者独立审核；Q明确此准确源码可正常合main和进入候选准备，未闭源码阻断0。Root与Q分别实际官方candidate gate verified，候选证据SHA `9a1245bfebdc15eefd1a324d62ea597ce1ed748ac8d60d676b17bb466c0befda`，独立证据核验 `q-final-evidence-audit-3dba.json` / SHA `51cef3369fa4515a94ac379b7dbd7e5004c8db0b94b2d4c067a4b1e353ea6b21`。正式context/生产生命周期没有执行；旧拒绝日志、两次私有harness失败和已停用tainted合成DATA保留。最终证据入口 `presence-full-rehearsal-00c6-01/candidate-evidence-final/README.md`。

非作者2万条真实TOAST合成范围完成有限核心SQL资格：完整八Sum/五presence Count、owner/title/分组结果592251B同hash且匹配oracle。保全原续测0.694秒、cache冷首0.151秒、warm0.149秒；TOAST堆122880000B，缓存样本观测TOAST访问0。单SQL7秒保持，原首样本耗时未保全、续测经重启不能叫raw warm，异步IO和OS缓存未知、两harness失败分列，不称P95/正式月范围/整体RPC通过。私有55891正常停止、监听0。报告 `E:\codex-artifacts\presence-scale-independent-20261003-8b6286021a9843fd9f1fa3b41a05522c\FINAL-SCALE-REVIEW.md` / SHA `c190e0b730189949edb4b6ba51b541a1fe2960d9ca8a3dff3ddec25581d3ee6c`。现存后备份netshop_rows元数据1,999,139行，不能由2万合成样本推导正式所有范围预算。

Root只读核实际Worker87全部19声明artifact匹配、实际无sibling Django库，原canonical successor resolver确认effective87而非旧bootstrap pointer；非作者静态补记确认维护与普通Start均委托installed Django，此Django-only候选本身不要求重建Worker。此为静态包闭包，真实139/Start尚未执行。补记 `WORKER87-STATIC-ADDENDUM.json` / SHA `644405ed7ece1f82d52febd22c4cbdc284e4a9b9fec78f34afab9328595206d2`。

实际顺序回执入口：`E:\codex-artifacts\netshop-scheme2-20261003\production-combined`。
