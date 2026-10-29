# 隔离协议检查逐项证据

最终执行 15 个相关文件：161 tests / 161 pass / 0 fail / 0 skipped。完整原始输出：[QUEUE-PROTOCOL-FINAL.tap](QUEUE-PROTOCOL-FINAL.tap)。其中新增损失协议实际执行 20 项（含三个固定入口的独立参数化用例），如下逐项对应。

| 检查点 | 实际结果与原始证据位置 |
| --- | --- |
| 无损失记录：结构可读、普通盘点仍拒缺失回执 | `ok 103`；TAP 第 616 行；`no loss record: structure validates every byte but absent native receipt still blocks normal inventory` |
| 同 ticket 重复 dispatch：结构层拒绝 | `ok 104`；TAP 第 622 行；`structural reader rejects a duplicate dispatch operation for an already-dispatched ticket without opening packet files` |
| 整包缺失且清单完整：核销后盘点通过；原件与 pending 保持 | `ok 105`；TAP 第 628 行；`whole packet ENOENT: full multi-dispatch/ticket group retires, originals and pending stay untouched, then exits` |
| 整包/部分缺失、权限错误、父目录缺失、重定向、硬链接逐项拒绝 | `ok 106`；TAP 第 634 行；`present packet, partial tree, EACCES, missing parent, symlink and hardlinked evidence all refuse without new records` |
| 存在回执哈希错误：原结果保留且继续阻断 | `ok 107`；TAP 第 640 行；`present receipt with a changed hash blocks before any retirement and preserves the original terminal bytes` |
| 回执重现：错字节/错请求拒绝，完整正确仍退休且不复用 | `ok 108`；TAP 第 646 行；`reappeared packet: changed receipt/request blocks; fully valid restoration stays retired and cannot publish or reuse` |
| 漏 dispatch/ticket、原件摘要错、目标队列错、替换清单拒绝 | `ok 109`；TAP 第 652 行；`bindings are exhaustive: omitted dispatch/ticket, changed queue/result/dispatch/native hash and swapped manifest fail closed` |
| 删旁记录/完成结果拒绝；完整追加后崩溃按同清单对账 | `ok 110`；TAP 第 658 行；`deleted record or completed result is detected; crash after append resumes the same records without draining pending` |
| 删除 dispatches 整目录不能走 legacy 空集合旁路 | `ok 111`；TAP 第 664 行；`deleting the entire dispatch namespace cannot use the legacy empty-queue shortcut to reopen a loss packet` |
| 三锁覆盖追加；代际变化拒绝；pending 不消费 | `ok 112`；TAP 第 670 行；`queue and rotation locks cover the complete append; original generation drift refuses and no pending ticket is consumed` |
| 固定准备函数拒绝退休包 | `ok 113`；TAP 第 676 行；`fixed prepare function refuses a restored retired packet before source/native effects` |
| 固定检查函数拒绝退休包 | `ok 114`；TAP 第 682 行；`fixed check function refuses a restored retired packet before source/native effects` |
| 固定发布函数拒绝退休包 | `ok 115`；TAP 第 688 行；`fixed publish function refuses a restored retired packet before source/native effects` |
| 旧 pending 原票由新代际追加 blocked，不迁代或准备 | `ok 116`；TAP 第 694 行；`new bundle leaves original pending tickets to incompatible-generation rejection and never migrates or prepares them` |
| 已采用+main 五组精确闭包及154 schema保留 | `ok 117`；TAP 第 700 行；`adopted and main producer closures remain the exact five-member union; SalesPreflightIndex154 remains supported` |
| 后继材料继承；换清单、漏 intent 绑定、能力降级及孤立记录拒绝 | `ok 118`；TAP 第 706 行；`successor material inherits the external manifest; replacement, missing intent binding, capability drop and orphan records refuse` |
| 真实私有 build-only 材料生成和原材料读取器拒删除/合法重哈希降级 | `ok 119`；TAP 第 712 行；`actual build-only upgrade material inherits the manifest and readMaterials refuses deleted or legally rehashed downgraded capability` |
| 旧 publication-retired 写入/分层读取/退休集合及篡改拒绝保留 | `ok 120`；TAP 第 718 行；`existing publication-retired writer and layered inventory preserve packet retirement and reject changed bindings` |
| 损失 CLI 与 prepare/check/consume/abandon 模式互斥，manual-only保留 | `ok 121`；TAP 第 724 行；`fixed prepare/check/publish and loss CLI modes are exclusive; native direct scripts retain their documented boundary` |
| 独立26包/35记录清单的纯 schema/canonical验证 | `ok 122`；TAP 第 730 行；`pure manifest validation accepts the independent 26-packet/35-dispatch inventory without opening production` |

所有 case 都使用私有目录/对象。EACCES 使用仅针对私有目标 `fs.lstat` 的窄故障注入，验证拒绝传播；没有修改生产 ACL。junction 和 hardlink 拒绝用私有真实文件系统对象验证。准备/检查/发布三项直接调用实际函数，native/source 执行次数必须保持零，并非只有源码字符串断言。材料用例调用真实 build-only `prepareControlUpgrade` 及原材料读取器，整个 repo/state/release 均私有，不采用、不注册或唤醒任务。

核销 writer 只核验队列结构、绑定清单及目标损失包，不替清单外存活包做外部制品验收。普通 inventory/消费准入仍检查这些存活包；其错误继续阻断普通消费和发布。

完整追加后中断可对账同一清单，原记录不覆写；半写、非 canonical 或摘要错误仍失败关闭，不提供覆盖修复。

## 既有机制与隔离修正

既有回归覆盖旧 queue-v2、结构化失败/plain error→unknown、S05d abandonment、generation rejection、manual-only/abandon-only、R1b entry/ref、publication-retired、资格闭包与 main 的完整 apply 计时测试。八条封存历史用原始字节的私有副本验证，未删除断言、未跳过。复制清单摘要由本地 `.runtime/historical-queue-copy-receipt.json` 保存，生产源只读。

首次扩展回归 147 项中有一个 R1b 无 Git 负例受 worktree 内 TEMP 的祖先 Git 发现影响；原 804a 同字节 guard 在同私有夹具也复现。修正为独立空 Git 仓库隔绝祖先，保留原 `native-no-git-source` 精确断言。旧失败输出：[QUEUE-ISOLATION-FIRST.tap](QUEUE-ISOLATION-FIRST.tap)。

本轮一度从1456额外导入、但 main 原来不存在的 native failure writer 历史测试不适用于 main 或1456真实 writer；已从候选移除，未改原生文件，也未用更早历史源码替代被测候选来凑通过。失败保留：[EXCLUDED-HISTORICAL-TEST-FAILURE.tap](EXCLUDED-HISTORICAL-TEST-FAILURE.tap)。它不计入最终161项或候选通过证明。

分层结构校验首轮还曾误拒原本合法的 crash→blocked 依赖终态（其字段本来没有 dispatchId）。已按原 ticketResult 的精确 blocker 校验保持兼容，unresolved 仍阻断，损失核销仍只接受完整 prepared 组；原两个回归断言未改。过程输出保留 [QUEUE-STRUCTURE-FIRST.tap](QUEUE-STRUCTURE-FIRST.tap)，最终161项已包含修复后的原用例。
