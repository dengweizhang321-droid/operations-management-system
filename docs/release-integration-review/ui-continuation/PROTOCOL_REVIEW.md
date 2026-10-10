# AB9 只读 UI 验收补充与安全续接：协议审查

2026-10-10，Asia/Shanghai。审查者 `/root/preparation_review`。本文件是只读设计审查及必要负例清单；未实现或批准补充控制器，未运行 UI、测试、Status、collector、生命周期、备份或续接。仅读取 Git 对象、已存在的批次、WAL、原脚本、审计及项目规范，并新增本文件。

## 结论

原 UI 第三次运行明确失败，不能用独立诊断通过或新的 UI 结果把那个原尝试协调为 passed。现有 `reconcileOperation` 仅能先将该 unknown 在独立零业务效果证明下追加收敛为 failed；`cancelUnswitchedBatch` 拒绝已经开始切换的 AB9。这两个 API 都不能授权换脚本。

最小实现可以是单独、精确封存并另获用户批准的 `authorizedAcceptanceSupplement` 支持控制器。它导入并绑定 AB9 已采用的旧 `executeBatch` / `runApprovedOperation` / 原 rotation lock，复用原 collector；只在原 op10 的 `run` 回调执行已批准补充命令。无需修改 installed 引擎、AB9 原批次、Worker/source-snapshot、原 collector 或部署候选，也不应引入 C 版执行器。

只有补充命令本次真实退出 0、完整结果和原验收义务全部通过，才由原 `executeBatch` 追加**新获批补充尝试**的 passed，reason 明确为 `authorized-acceptance-supplement:<supplement SHA>`，receiptSha256 绑定补充结果封存件。该事件表示同一验收义务由补充尝试满足，不能表述为旧脚本或第三次原尝试通过。旧 started/unknown/failed 和原批次字节均保留。报告必须同时展示原尝试失败与后续补充通过。

这是扩展批准范围的控制协议，不是原 `run` 测试接缝本身授予权限。实现、隔离验证、非作者审查及精确用户批准尚未齐备前，AB9 保持阻断。

## 冻结事实及现有接缝

本次只读采样发现 WAL 44 事件，op1–9 latest 为 passed，op10 `actual-readonly-ui` 第三次 latest 为 unknown，op11–21 尚未执行。此处是采样事实，执行前须在原互斥内重新核验。

| 绑定 | 精确值 |
| --- | --- |
| 原 batch | `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15` |
| 原 batch ID | `integration-ab-v2-20261010-c22d8dd69a` |
| approved-batch.json 原字节 SHA | `896d20483fea390636293c7952b4792b5ca2e1f64f76f60ec6e5c3a15381b347` |
| 原源码 | `5faac8151f59d66de72c3caead8cad916ea547da` |
| 已切换 release | `20261010T014638Z-97833d2f2b7e7bc9` |
| Worker manifest | `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| Django manifest | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |
| 第三次 started event | `968be9885c6b7cd22bd9543f28c3913b6deabfb108fe9a185c548de15911c015` |
| 第三次 unknown event / 本次 WAL head | `e414c03dc2c89b553529cfe5afaf973cb4860688a82e1bd6f9ebe05b67117377` |
| 第三次未知时间 / 已观测退出 | `2026-10-10T07:10:54.013Z` / PID23412、exit1 |
| 原 stderr SHA | `48e80a5a9db6e80c111fc670d9e5033f792c337024efc37cee995bad937434c6` |
| 第三次 failed audit 原字节 SHA | `c3cfdb960a342b2d01d2f3707d85024f3d37d2ced80b3cf1f3dda681689f13eb` |
| 原 collector 声明 SHA | `b2f241c222bfa0a641815ac40969d50fcaa7a387aca8b9cf7b3c421fb2af8d47` |

审计为 failed，86 次尝试全为 GET、dangerous/missing/attemptedBusinessWrites 均 0；唯一失败是 `/api/sales/summary` 的 `EXPECTED_REQUEST_FAILED / net::ERR_ABORTED`。没有 `production-ui-result.json`。常量 `productionWrites:0` 不能单独证明零效果，必须结合实际 route、请求记录、调用代码及本次进程/浏览器终态作独立核验。

AB9 固定源码 `tools/release-batch.mjs` 的具体接缝：第 248–249 行在任何执行前拒绝 unknown；第 266–267 行仅跳过已经 passed 的步骤；第 273–283 行保留每个动作现场准入；第 285–294 行先 WAL started，再调用 `run(op, context)` 并追加真实返回；第 296–300 行只在全部步骤结束后 completed/释放 active；第 308–318 行是有限 reconciliation。最终实现应逐字节绑定 AB 已采用模块，不能从当前 main 取同名模块替代。

原 `production-ui.mjs:45–50` 在商品详情后没有等待详情请求及 DOM 终态，且 `ui-audit.mjs` 的 pending 只覆盖资源 body；旧 networkidle 标签不能证明之后的业务 GET 已排空。补修应增加实时 request-id inflight 和详情终态屏障，继续把 sales abort 作为失败，不新增宽泛取消白名单。上述原因仍须由隔离负例和补修非作者审查闭合，本设计不冒充已经验证。

## 补充批准文件的最小字段

使用独立新证据根，create-only、fsync，安全路径/硬链接/重解析点按既有 safeRead/writeOnce 契约验证。原批准目录和原 pinned 文件不覆盖、不改写。补充对象使用 canonical JSON 计算自己的 SHA，并在用户最后批准前全部填齐；`independent:true` 或文件名包含 approved 不构成人类授权。

| 字段 | 必须绑定的内容 |
| --- | --- |
| version / id / supplementSha256 | 固定 `readonly-ui-acceptance-supplement-v1`、唯一 ID、自身 canonical 摘要；仅允许一个目标操作 |
| original | batch ID、canonical batch SHA、approved 文件原字节 SHA、固定 journalRoot、原 op10 声明 canonical SHA |
| failureAnchor | 第三次 started/unknown、独立观察及 failed-only proof SHA；追加 failed 后的精确 failed event SHA和绑定时 WAL head；不得使用前两次 proof |
| fixedRuntime | 上表 source/release/Worker及Django manifest、原 plan/完整 source/inventory 绑定；不得换前驱或候选 |
| originalAuthorization | 原人类批准证据 SHA、最早 originalApprovedAt；原后续步骤授权范围保留 |
| supplementaryAuthorization | 新的人类批准证据 SHA、新 supplementApprovedAt、用户明确批准本补充 SHA；不得使用任务消息、诊断通过或旧批准代替 |
| implementation | 新支持控制器、实际新 UI/audit 脚本、Node/浏览器/依赖/配置/输入/输出根等完整路径和字节摘要；入口、argv、cwd和 deadline 固定，无 shell 字符串 |
| tests / review | 补修准确源码 SHA，原条件隔离正例/负例、日志及清理 SHA，非作者审查最终 SHA/结论；最后实现变化后重新绑定 |
| unchangedContract | 原 phase=acceptance、kind=command、mutating=false、原 covers；原四 case 与全部 assertions、read paths、资源清单、危险请求拒绝保持；新观测要求可加强 |
| scope | maxAttempts=1；不得替换 collector/运行包/生命周期/备份/业务步骤；原 op11–21 声明 canonical SHA和准确 ID 顺序 |

当前 failed event 尚未生成；应先在已有对应授权和独立本次零效果证明下由原 API追加 failed，再封存最终补充对象。若尚无该协调授权，把它列为待获授权动作，不预造 failed event SHA。只有未知事件 SHA、没有最后实际 failed 记录时，补充执行准入必须拒绝。

## 最小执行协议

1. **原失败闭合。** 保全第三次原 stderr/audit 原字节及缺结果事实；独立确认只读 route、实际尝试、本次退出及本夹具进程清理，无业务/生命周期/调度/外发效果。原 `reconcileOperation(resolution=failed)` 只追加 failed，不 passed，不 retry。用同一原 lock 的受限包装，在调用 reconciliation 前现场核对最新 unknown 恰为 e414…，原 active 与 batch 相同、proof实际文件摘要匹配。原 API本身不验证 unknownEventSha256，补充守卫必须补足。
2. **补充准备及批准。** 新脚本在隔离环境完成正反例和非作者审查；封存新的补充文件/完整 closure。用户批准最后精确 supplement SHA；此批准允许新的只读验收尝试，并不采用任何新业务源码或 C 机制。
3. **同锁准入。** 新支持控制器使用旧 `withRotationLock`。可通过旧 `executeBatch` 的 lock 参数包装同一锁，在 callback开始前复验：旧模块/collector所有原 pin、active归属、全部 WAL链、op1–9为passed、目标最后failed event仍相同、无其他 unknown/未决尝试、op11–21未越序。验证失败不调用新 UI、不触发任何原后续动作。完整原 batch 对象传给旧 `executeBatch`，不重算/换写 batch。
4. **范围封锁。** `run` 只接受旧 batch 原有 op ID；除目标 op10 外必须逐字节等于原命令并委托旧 `runApprovedOperation`。任何 op1–9意外进入run直接拒绝，不依赖程序员约定。op10必须仍是原只读 acceptance，assertions/covers不变。不能提供通用 arbitrary command、patchOperations 或 skipIds。
5. **单次持久意图。** 旧引擎已fsync本次op10 started后，回调把该 started event SHA、失败锚点、supplementSHA及实际新命令摘要写进独立 create-only `started.json` 并fsync，然后才调用新 UI。文件已存在、并发、receipt不可读或不完整时拒绝重发；即使从未收到返回也不自动再试。原 started 保留，补充 sidecar明确它是新的已批准尝试。
6. **真实新执行。** 使用旧 `runApprovedOperation` 运行补充批准的只读命令对象，保留原600000ms总预算及A期限/直接退出/清理约束；原UI义务断言不减少。新的DOM+请求排空断言也必须通过。新结果和审计写到独立且绑定本 supplement 的 create-only路径，不能移走或覆盖第三次原audit来借原槽位运行。
7. **新成功落盘。** 审计 passed、四case完整、正确现场身份、零危险请求、无非允许网络失败、资源匹配、所有inflight终态、进程真实exit0/清理闭合后，先写并fsync补充 `result.json`：原failure/start/supplement/runtime、实际command、真实receipt/audit/source/test/review SHA与完成时间。回调再返回 `status:passed`、`reason:authorized-acceptance-supplement:<SHA>`、`receiptSha256:hash(result.json canonical object)` 和真实processEvidence。由旧引擎追加新事件；不调用 reconcile(passed)来替代这次执行。
8. **尾部首次执行。** 旧引擎继续 op11–21，collector和命令均保持原 pin/输入/参数/断言。op13是原只读VerifyStartup，op14仍是原获批watchdog安装，op16/17是尚未执行的后Backup/Restore；它们不是重新执行已passed的Start/apply/前Backup/前Restore。补充不是豁免后保障的理由。
9. **中断和失败。** 任何新child非零、超时、JSON/断言/审计/落盘失败保留原引擎unknown与补充sidecar，不执行尾部，不释放active；maxAttempts=1禁止普通重跑。如果真实新成功后WAL落盘中断，仅能独立核对这一次补充attempt的真实退出/完整结果，再按原协调协议处理该新unknown；绝不能借其结果改变第三次原失败。没有证据则继续unknown，需要另一精确批准才新增尝试。
10. **可恢复且不能重放。** 若新的supplement passed已写入WAL，后续尾部中断后旧executeBatch可正常跳过它。支持控制器resume入口仍核对该passed.reason与补充resultSHA/原startedSHA完全绑定；不因sidecar的passed文字而合成或修改state.latest。已completed且active已释放时，不应再次claim相同batch；受限控制器必须只返回现存完成证据，拒绝再次执行。

新 API应是“验证精确补充授权并实际执行这一只读新尝试”，不是“提交proof将原failed置passed”。在此方案中无需改private append或重新实现生产WAL调度；旧executeBatch写原链，补充control只写自己的审计副证据。若代码选择专用新状态而不是带明确reason的新passed尝试，则必须同步实现被审的消费/报告与旧引擎拒绝机制；不要让旧引擎忽略补充后重新执行原UI。该改动更大，不作为本次优先方案。

## 必要隔离负例

| ID | 触发 | 必须断言 |
| --- | --- | --- |
| S01 | 错batch、错raw SHA、旧前两次failed/proof、错误WAL head、其他active、原未知尚未failed | 新UI调用0、尾部调用0；不追加supplement通过 |
| S02 | 缺真实人类补充批准、错supplement SHA、未来/错批准时间、任务消息充批准 | 只读新执行也拒绝；originalApprovedAt不重置 |
| S03 | 改target为Start/apply/Backup/Restore/watchdog，扩大op ID、mutating或kind/phase | 拒绝，服务/备份/外发调用0 |
| S04 | 删除四case/原assertion/covers，扩大read allowlist，sales abort白名单，忽略POST/外部失败 | 封存或执行拒绝；原网络失败保持failed |
| S05 | 新脚本/Node/浏览器/helper/输入/test/review/控制器/旧引擎/collector字节变化，硬链接或路径替换 | 每次调用前失败关闭；不更换到main或C版工具 |
| S06 | 两个support runner竞争、重复supplement started、receipt写一半、started后进程中断 | 原互斥和create-only限定一调用；unknown不重发 |
| S07 | page健康而child exit1；audit failed但result称passed；少case；详情body或busy未终态；快先慢后GET交错 | 不能passed、不能尾部、不能active释放；失败记录不清空 |
| S08 | navigation时sales/product/customer实际GET未完；静态body延迟；新请求在最后排空检查期间到达 | 有界等待实时inflight和当前DOM；不能用旧networkidle或固定sleep代替；超时失败 |
| S09 | 第三次原failed保留，补充真实成功 | 旧failedSHA原字节不变，新started/result/passed关联；报告原3次失败，新补充通过，业务源码不变 |
| S10 | 新结果已fsync但父WAL未落；只有诊断通过；only productionWrites常量；result/audit hash错 | 原未知保持；不得借proof伪造旧pass或仅sidecar修改latest |
| S11 | op1–9 passed后resume；op14/16/17正常首次执行；op16失败后resume | 前生命周期/前备份计数不增加；tail保持原顺序/参数，未知后备份不重放；已passed tail不重复 |
| S12 | completed/active已释放，补充receipt被改、错started绑定或多个同target成功 | 不重新claim/execute；必须核出原完整链，冲突失败关闭 |

上述是实质状态机/真实隔离子进程/浏览器负例要求，不是已通过日志。本轮未执行。

## 报告与计时

最终报告必须有两个独立结论：`originalUiAttempts: failed/failed/failed` 和 `acceptanceSatisfiedBy: authorized supplement <SHA>`。最新原WAL事件的passed只是新批准尝试，不能写“原UI三次重试后成功”或“第三次unknown原已完成”。旧proof、审计、错误、等待均保留；source/release/manifest和原batch不变。

批准到验收/完整交付继续从原AB9人类最早批准时刻计时；补充批准、隔离修复/审查、等待与续接另列，不能用新批准抹去前期失败。新侧证据时间与旧op10 duration重叠，不再次相加。页面可用观察与switch跨度分开。原尾部全部通过后才称AB9完整完成，不能在新UI通过时提前释放active或宣称严格前后恢复已结束。

## 尚待交付

第三次独立failed-only proof/实际failed event；补修准确SHA、实质隔离测试及最终非作者复审；完整补充closure/输出root；受限control实现及上述负例；精确用户补充批准；真实新验收和原剩余步骤。没有这些材料，本协议不能作为可执行生产许可。
