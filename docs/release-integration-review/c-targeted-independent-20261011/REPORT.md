# C 集成独立验收：首次采用限定保护方案

本轮独立验收的结论是：**限定非复用首次采用方案准备通过；整个C不能判定全部通过，缓存会话的现场项仍阻断。生产准入未通过，C未采用。** 本任务已完成这一截点的证据核对、独立复审与交接，不把限定方案通过改写为所有优化或生产验收通过。生产由统一任务“拆分发布验证与备份门禁”在条件齐备后另获最终精确批准。

## 准备对象与授权

用户本轮要求继续到 C 验收。统一发布任务的人类指令为“一次发布前备份＋一次针对新恢复工具消费链的隔离演练”，取消发布后重复全库备份和演练。该指令允许形成新方案，不能替未知新候选取得生产批准，也不能中途删改旧批次或 WAL。

已实际采用的前驱 Worker 是 `20261010T014638Z-97833d2f2b7e7bc9`，manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`；原生链截点 `aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9`。AB 旧批次历史成功、失败、unknown 和协调记录不改写，不为测速重放。现场动作前须重新读取动态身份、链、WAL、权限、维护、排空与互斥，截点不等于长期有效许可。

当前待核完整 Worker 为 `20261011T090355Z-21c2645a63247749`：

| 对象 | 精确 SHA-256 |
| --- | --- |
| manifest | `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4` |
| 原 plan | `0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881` |
| prepared receipt | `4e2ad957633171ae5e57e521e3d327cc311fc93e517285aed24d746e1af152f2` |
| source tree | `dc1dbeeded593980c6712e7afabde0a053dfd13d8f6c4bb9375718330af2b8fb` |
| source inventory | `d1f39fc003f51c511d1ae26fce1aaadc223cb99db1475cff1f33316728afade1` |
| SourceBinding | `1168c06784a134da5390b7403e83de8af27d5f866ad239f92bd4c136c134b745` |
| evidence helper | `b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6` |

已有 Django PrepareApp `1e1138feef7148fb851713c2b39a25d0` / manifest `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09` / receipt `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b` 仅在最终工具、完整应用前后库存、精确 CF 缓存差异与实际现场仍相符时可续用。不能因 Django 业务摘要未变就放行部署副作用。

## 已完成的独立复核

| 复核 | 结论与边界 |
| --- | --- |
| v4 targeted-first-adoption | [八组限定策略/实际原 runner 检查](POLICY_INDEPENDENT_REVIEW.md)：完整十工具、双 Django 库存/执行代码资格、旧协议兼容、新 installed 消费链及同点参数可审；同时复现旧实际批次 3600000ms 在 native 前被 A 的 1800000ms 上限拒绝，因此不是八项实际批次放行。 |
| IG04 | [原生身份字段 guard 与安装顺序复核](IG04_AND_INSTALLATION_REVIEW.md)：非作者 7/7，缺失或矛盾必要身份保持 unknown；只窄允许可证明无关的系统项，不能以无引用代替完整身份。 |
| 最终 helper | [非作者 7/7](FINAL_HELPER_REVIEW.md)，1069.5223ms；固定配置的 change 仅进入 pending，并同步重读完整字节及 dev/ino/nlink/size/mtime/ctime，against 不可变 baseline。普通源码/npm、未知/rename/null、watch error、inode 或非访问身份变化保持拒绝。包括私有真实 Windows 通知；不签完整候选、正式配置会话或生产采用。 |
| 新候选断言与收据 | [十一文件原断言精确改址核对](FINAL_HARNESS_AUDIT.json)，来源4697f674；[四份原audit收据字节](FINAL_RECEIPT_AUDIT.json)均相符。没有重跑215或借此取消其失败。 |
| 全源/载荷核对 | [脚本非作者复审](PAYLOAD_AUDIT_SCRIPT_REVIEW.md)补齐前驱manifest、树根与祖先、目录成员和配置stat终态；[V2实际独立执行通过](FINAL_PAYLOAD_AUDIT_V2.json)，394.810秒，41765文件/4190目录/45970路径身份无漂移，原AB源5157→候选5160、精确十工具、dist164/helper3/node_modules31248、keyFiles及原plan/receipt/binding相符。第一版232.517秒只能[初步历史](FIRST_PAYLOAD_AUDIT.json)。静态核验与生产速度无关，不取消失败回归或放行新入口。 |
| 非复用执行路径 | [NRT01静态报告](NONREUSE_TRANSPORT_REVIEW.md)：targeted validator精确强制in-process，不能只改spec走旧child分支；旧child失败取证与父WAL回传并不完全等价。须形成并审查明确新入口，未预签。 |
| 外置入口首轮 | [b7c1字节独立反例](FRESH_ENTRY_REVIEW_FIRST.md)：2/2反例均触发未闭合接缝（测试0/2），校验前import与采样返回后证据丢失；不签该稿，须修复后复审。作者10个既有fixture通过不能覆盖这两个新反例。 |
| 外置入口冻结稿 | [8bf固定根路径反例](FRESH_ENTRY_REVIEW_THIRD.md)：第10行普通JS字串的两处反斜杠转义为TAB，不是绝对固定root。四模型都在真正bootstrap的正规root断言先拒（0/4），没有到达原三边界，未改fixture成坏root找绿。旧稿保留，另形成6989路径修正稿待复审与实际资格。 |
| 外置入口v2 | [固定6989非作者复审通过](FRESH_ENTRY_V2_REVIEW.md)，四私有模型4/4、133.4159ms，真正Droot表达式无控制字且绝对；闭包校验在import之前、普通stale保当前事实、存证EACCES仍抛原STALE并保当前事实、beforeOp拒绝保已存admission。只签此固定源码和隔离模型，不证明真实31k树、qualify、新spec或生产采用。 |
| 新精确批次 | [f0bb小对象与安装审计](INSTALLATION_FRESH_FINAL_AUDIT.json)：28文件、19步、一次旧installed Backup和一次新installed同点Restore/consumer、D/W原准备对象与精确源码/CF范围相符。rawspec `eec240464811a6e954f489d8504aa6b77880f99187340b5899509a2093a5d639`，batch `f0bb923070dc0741a6b76885b6fe08f54710928b0eda1398a9cab8452d1d6c9e`，v2入口 `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`；`productionApproved=false`。 |
| 新实际预算 | [十九操作预算原函数核验](BATCH_BUDGET_AUDIT.json)：采用原runner的`readOnlyRetry.totalTimeoutMs ?? command.timeoutMs`优先级，默认600000/上限1800000，继承clamp/旧3600000拒绝保持；synthetic时钟仅用于纯函数断言，没有native，预算不等于预计耗时。 |
| 真正声明入口资格 | [原实际CLI结果独立绑定核验](ACTUAL_QUALIFICATION_AUDIT.json)：6989/f0bb的完整bootstrap＋原无session collector真实通过，15阶段通过，573.818秒，原stdout与record.current、完整binding、argv和rawspec一致，结束时末观察仅70ms。statusObservation为null，没有借此宣称新installed就绪、真实重试、PG恢复或生产引用准入。该时点已是历史，未来动作仍重新采集。 |
| 缓存来源会话实测 | [固定新包单次真实来源探针](FIXED_SOURCE_SESSION_PROBE.json)：b735/dc1d在2026-10-11T10:40:04.955Z至10:40:20.027Z（15.072秒），首次collect(full)身份返回前因输入通知拒绝。未到reuse/recheck；record的identityMatchingSourceBinding=false是初值，**身份比较尚未执行**，不是证实身份不匹配。不重复同字节跑至绿、不改变冻结f0bb的fresh范围。 |
| C 准入续接 | 三个旧 C common-collector 回归：扫描不续期、超过 5000ms 的 attempt、末 WAL 漂移及 NotReady 不重试；原拒绝诊断保存。仅固定旧源码 seamed 独立验证，不冒称现场。 |
| 原 3032 | [历史完整源/制品独立核对](../c-final-independent-20261011/BYTE_AUDIT_3032.json)与原166测试断言保留；新源码/候选改变后不能直接继承整包签署。 |

作者、非作者、旧版本和定向复跑的计数分别报告，不相加制造“总通过数”。模型复审包括实际 Antigravity 原文及事实更正，模型赞同不能取代上述执行记录。

## 必须保留的失败与修正

1. 最初限定移植曾将 `backupId` 使用放在恢复块外，真实 196/197，属于源码缺陷；后续修正词法作用域，旧候选保留，不把它归为测试夹具问题。
2. 旧 `872d7e41…` 批次虽然结构 validator 通过，但两数据库操作 timeout=3600000ms，实际 runner native 前拒绝。新批次必须逐操作调用原 deadline 验证受支持预算，不能放宽 A 上限。
3. 正式 `.dev.vars` 是原生产者规定的硬链接。旧 session 的 generic 单链接读取与此不兼容；修复只限固定原路径，generic 源码、npm 和其他配置仍不能接受硬链接。独立窄修复分支 `3f5cfb7e275d67b688f18a115c5584d619dc1346` 已保全推送，最终采用统一方更完整的 b735 helper，不重复合入两份实现。
4. 多次真实 session 在普通输入通知后拒绝。无 session 的完整 collector 通过不能证明声明 in-process transport 的旧批次路径成立；不能忽略通知或删除失败，以“再跑至绿”替代原因定位。
5. 新 21c2645a 包联合 V4/V5 都是 214/215，且失败用例不同；V4 原生私有 hardlink/session，V5 missing-config-parent。V4 同断言定向通过不冲销首次失败；V5 原定向仍失败。当前未签整包全绿。
6. 真实IG04最新2026-10-11T10:24:24.706Z审计为0明确引用、**198身份未知**，guard正确阻断；早期197只保留为历史。身份不明项没有被本任务停掉、清除、提升权限或当作无关。生产准入保持blocked；源码/隔离验收与生产准入分开判定。

缓存项的精确阻断位置为冻结helper的`assertStable`输入通知门禁（`tools/release-preparation-evidence.mjs`）。根任务一次新包实测与原V4/V5异常保留，不把安全拒绝推断成实际字节漂移或某个外部任务已证明的根因。后续修复要求：先确认通知对象与实际身份、字节、非访问元数据及并发输入变化；保持完整源/Node/npm/config观察、同批绑定、期限、动态身份/权限/维护/排空与末复验。真实输入不稳定时继续拒绝或完整非复用流程，不静默忽略未知/普通输入事件，不改负例或先前错误，修改后按新的精确源码/制品独立复审和实际会话复验。本轮不另建重复开发任务。

拒绝位置亦须准确：原 `executeBatch` 第427行已经先保存current的阶段/状态attempt，428才执行beforeOperation；此后verifyInputs拒绝不等于既有采样WAL全丢，不另列为P1。真正另核的是collectCurrent内部当前结果尚未交给原引擎时，stale存证的写入失败遮蔽原错误；入口需保主拒绝与已采事实，并保持保存失败不转成功。第二稿测试在执行前遇SHA变化、语义用例未运行的[原记录](FRESH_ENTRY_REVIEW_SECOND_PENDING.md)与后续跨VM realm夹具问题分别保留，不当源码结论。

原文件保存在 `E:/codex-artifacts/release-first-adoption-targeted-20261011/`，包括 `CANDIDATE_REGRESSION_FINAL_V4.json`、`CANDIDATE_REGRESSION_FINAL_V5.json`、原 stdout/stderr、`STANDARD_REAL_COLLECTOR_V2_FAILURE.json`、`NATIVE_SESSION_DIAGNOSTIC.json`、`NATIVE_IG04_AUDIT_20261011T082547711Z.json`。私有配置只用于内容摘要与文件身份验证，配置值不导出到报告。

## 联合验收与交接清单

- A 与 B：同一顶层绝对期限；完整引擎状态/证据优先于页面健康；重试只重读，不能重放生命周期。停止/超时只清理本次隔离新子进程，正式服务树必须保留。
- B 与 C：错误和收尾前 blocked 状态保留，末尾复核实际 head、Django、WAL；unknown 与原失败不能改写成原动作成功。
- C 分类：实际生产前驱的完整差异，源/制品/部署动作完整闭包，不能按 app/、GET、fetch 或摘要直接认定无数据。未支持类别严格拒绝。
- 恢复复用：旧 v2 有效日备份、恢复点与现场资格要求不减免。v3 not-required 是独立有证据的无新增数据策略，不冒充旧恢复复用资格。新机制自身首次使用走本轮人类限定 strict/targeted 保护。
- 不可变证据复用：只有限期复用派生身份，完整源码、Node/npm 和配置字节仍重读；ACL、进程、权限、ready、维护、排空、互斥和动作前动态核验不缓存放宽。
- 新方案：一份旧 installed 发布前备份；切换后新 installed retention planner 只读消费，再由新恢复工具隔离消费同一恢复点；原恢复隔离、role/migration、dump/receipt/backupId、未触生产、cleanup 全部断言保持；无发布后重复 Backup/Restore。
- 最终交接：精确 Git、完整制品/SourceBinding/前驱、新批次 hash 与实际 transport、逐操作预算、原生会话证据或明确新的无复用路径、联合回归与独立复审、回退、安全续接、远端包含状态都须保存。分支存在、任务停止或报告部分出现不等于交付。

## 回退与计时边界

切换前异常不动生产；切换后失败保留维护/owner/WAL，兼容 successor 后按最终批次明确范围续接或回退。不能直接装回旧 resolver、重放已可能执行的动作、自动生产数据库恢复，不能删除旧 `app.previous` 或依赖来源。新工具对旧原生收据和同点恢复链须通过，业务数据恢复另需具体授权。

本轮尚无生产配对。批准到必要验收、批准到完整交付、其他批次排队、真实入口不可用均未测，不用切换跨度代替停服。作者原准备记录09:03:55.857Z至09:17:06.503Z为790.646秒（原外层command耗时833.797秒，不能重复计入）；失败联合V5为56.690秒；独立helper为1.070秒，这些是不同阶段的工程观测，不能相加为净节省。全部UTC记录加8小时对应Asia/Shanghai，例如原准备17:03:55.857至17:17:06.503。准备、准入、备份、恢复、排空、切换、验收、文档、失败/协调/续接分别按原日志记录；跨阶段重叠不重复算。UI 30～60分钟、严格80～120分钟以及旧四数据库阶段50～55分钟只是预算/历史参考，不承诺生产目标。

## 四类状态（本轮验收截点）

| 状态 | 本轮截点 |
| --- | --- |
| 源码完成 | f8a207b7协议、4697f674配置修复、4887b6f8精确候选/入口与a1afb8d5交付附记均已在远端main；helper与6989外置v2独立通过。缓存现场资格仍非完成。 |
| 隔离验证 | 固定新v2作者26/26、非作者四模型4/4；原新包V4/V5各214/215不改写。明确fresh路径使用原全量采集，未采用缓存会话；缓存现场与其一未闭合用例仍单独记录。 |
| 生产候选 | 21c完整包和f0bb/raw eec240新批次已封，限定fresh路径的结构/预算/小对象/完整源与制品/真实只读qualify通过。最新IG04审计0明确引用、198身份未知，production blocked；现场资格不能跨时点复用。 |
| 实际采用 | C 未采用；AB 前驱保持。 |

本任务没有执行生产维护、启停、切换、调度修改、真实 Backup/Restore、业务写入或外部发送。最终候选不能顺带纳入 main 中其他未批准业务功能。

## Git与可审查范围

实际源码提交为`f8a207b7f01c640f67801b4788317557c488a8e4`和`4697f674952870319d282bfa7925c9422ed6e267`；与新main无冲突合并`aaaec722b31bc2075ac0f991c958bfd2ea12be81`；范围/证据提交`4887b6f89f6c18224c9df980b8b318856e5bd3c2`，交付附记`a1afb8d5432306de5e15db371184408d44d52063`。原发布方分支/工作树已洁净，远端包含核验另见最终交付记录。本任务只提交本目录，原主检出2f55及九项原改动保留。

main另有`c1d89b29347ce6868b6f86dd4276c06e226b5356`的watchdog变更；它**不在**本次5157→5160精确十工具候选差异中，不因Git合并顺带采用。精确批准范围应为前述W21c/manifest6cff/plan0afd/receipt4e2a/source dc1d/binding1168、D85cf/receipt10db/准备1e1138、batch f0bb/rawspec eec240与外置v2入口6989及明确argv，一次旧installed前备份＋一次新installed消费同点隔离恢复、完整19步保障与关闭。必须先解决真实引用未知及重新采集其他动态前置条件，再由统一发布任务取得精确用户批准；本报告不申请或执行生产上线。

仍依赖的来源、候选、回退、工作树、原app.previous保全与未合3f独立窄修复分支保留。原记录、脚本、raw日志设置本目录局部`-text`，按Git blob/原文件/归档逐一hash保全。最终本任务文档提交与远端结果在独立交付记录中列明。
