# 补充控制器非作者最终审查

2026-10-10，Asia/Shanghai。审查者 `/root/preparation_review` 未修改作者实现；仅新增独立测试、原运行日志及本审查材料。**本控制器范围内通过，无未闭合已知阻断。** 结论不代替新 UI/helper 的独立审查、精确用户补充批准或生产验收。

被审 `supplement-controller.mjs` SHA-256 为 `97e66370260154a38387b77f3d852112d9583d51f0682b37a9080deaa9032570`，执行独立测试前后相同，与 `E:/codex-artifacts/release-integration-review-20261010/AB-ui-supplement-20261010-0815/supplement-controller.mjs` 相同。机器记录见 [CONTROLLER_FINAL_REVIEW.json](CONTROLLER_FINAL_REVIEW.json)。

## 接口与安全范围

- 只接受原 AB9、原 authority 原字节、原 op10 声明、完整 binding/assertions/covers、既有 collector 和精确 failed event；active 必须原 owner、先前九步骤已passed、无任何unknown、后续步骤未越序。
- 新批准时间严格晚于实际 failed event，且不早于封存时间；新的明确人类批准记录必须绑定本补充 SHA/时间，拒绝旧 AB userItemId。该记录仍须由真实用户指令产生，程序检查不是权限来源。
- main 在导入前完整检查原 collector/op 和新文件 pin，实际导入的四份已采用 root/tools 模块均在原 pin 清单内。没有替换旧批次、source-snapshot、engine、collector或候选；不会从 main 引入 C 机制。
- 原 `executeBatch` 继续持有原 rotation lock、写 WAL、现场准入并跳过已passed步骤；新回调仅替换实际 UI 执行，其他动作保持原声明并委托原 `runApprovedOperation`。
- 新 UI 前在真实 run 回调 create-only+fsync intent/started，绑定本次父 WAL started、新 command SHA、原 failed event及 maxAttempts=1。原引擎不支持的 beforeOperation 已去掉。
- 真实新执行/审计/四 case 不通过、落盘失败或中断都阻断后续并保留unknown；不得靠诊断或常量productionWrites推passed。新成功的 receipt 明确 `originalAttemptSucceeded=false`、`acceptanceCompletedBySupplement=true`，旧失败不改写。
- 控制器是单次入口，不提供cancel或通用skip/换动作API。新UI已passed而tail中断时，计划明确先独立核对补充receipt及WAL关联，再由原CLI续接；不能再次调用本控制器或重放UI、前生命周期/前备份。

## 独立验证

独立 `node --test .../supplement-controller.independent.test.mjs` **8/8通过、0失败、0跳过、真实退出0**。日志 [INDEPENDENT_CONTROLLER_SECOND.log](INDEPENDENT_CONTROLLER_SECOND.log)，SHA `4ebbe8e874fb2e2e1f0d68382c82da4fa223b125d4a4493903104078c30fc00f`；测试源码 SHA `053d034d8770858fd727e44a655dbfcb12a558c5d55d333a9f638b9acad6f6dd`。

夹具明确模拟原旧 ABI，不调用 beforeOperation；所有 runtime、journal、process和文件写入均为内存替身，仅只读原封存spec。验证同锁意图先于child、绑定真实新started/command、原failed保留且仅UI+原tail调用、child非零留unknown并阻断tail、错failed/其他unknown、旧批准/缺人类记录、重算SHA后的contract/绑定扩大、helper字节变化/意图占用及错误failedAt。没有调用生产UI、collector、生命周期、备份或外发。

另只读核对作者 [CONTROLLER_TESTS.log](CONTROLLER_TESTS.log) 17/17通过，包含真实已采用旧 executeBatch＋独立临时WAL＋替身operator/collector的ABI测试；未将其列成复审者亲自执行。原engine内部行为另由其既有采用证据支撑，本轮没有做真实生产互斥争用或故障注入。

首轮独立夹具在作者增加schema后缺少failedAt/sealedAt，3通过/2失败原日志保留在 [INDEPENDENT_CONTROLLER_FIRST.log](INDEPENDENT_CONTROLLER_FIRST.log)。这些前置拒绝不是目标负例证据，也不是产品故障；补齐最终实际schema后才获得上述8项有效复验。

## 发现闭合与限制

中间版本曾把意图放在旧引擎不会调用的 beforeOperation，已修到实际 run 接缝；新批准原只比较原批准时间，已改为失败/封存时间及新的人类记录；failedAt曾未绑定WAL的at，已增加精确比较。上述均由作者修复，复审者没有改实现。

最后仍须封存完整新 UI/helper/Node/浏览器/输入与其他复审证据，并取得用户对最终精确 supplement SHA 的新批准。生产UI及原op11–21尚未由本复审执行；此通过不宣称AB9完整完成、第三次原UI成功或生产分钟目标达成。原批准起点、三次原失败与补充等待继续保留。
