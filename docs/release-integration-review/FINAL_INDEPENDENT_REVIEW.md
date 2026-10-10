# 任务 D 最终非作者独立复审

2026-10-10，Asia/Shanghai。结论：**组合核心源码/限定来源、已完成的隔离证据、两份真实不可变候选与非执行发布方案，通过本次交付范围复审。生产执行仍被 P01–P06 阻断；没有已封存 engine batch、最终生产批准或实际采用，C 恢复快路径资格继续拒绝。** 此结论不能被解释为严格生产验收全部通过或现在可以执行 Worker plan。

本次没有编辑实现、重复构建、执行新测试/恢复、调用生产生命周期或安装/调度/外发。复审者此前亲自执行的14项独立负例及原镜像只读回查见[核心复审](COMBINED_INDEPENDENT_REVIEW.md)、[来源与镜像复审](SCOPED_SOURCE_REVIEW.md)。本轮读取最终日志、范围/方案及原候选文件，只对关键字节作独立复算。

## 真实候选与独立字节核对

范围文件 `candidate-scope.json` 及sidecar SHA 均为 `99c96bafc789d80b5bb52c8683f4ef14282f6e455cbe6e87bebc4b6408a7b506`。独立最终检查记录见 [final-independent-review.json](evidence/final-independent-review.json)。

| 范围 | 默认 AB | ABC 合并替代 |
| --- | --- | --- |
| 精确来源 | `5faac8151f59d66de72c3caead8cad916ea547da` | `9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c` |
| release | `20261010T014638Z-97833d2f2b7e7bc9` | `20261010T015810Z-ec9a7dfc12336d52` |
| manifest SHA | `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` | `0153c677b7202ce6dbfbc08647450058693a8e1869ea8058db534b503f8281aa` |
| plan SHA | `266a8574000a90cbeb5baf12fcba7bc2f4a8a06f0262f3b47d4ad73b9d0ddaee` | `1b8cd3f26b9e0ed386a32518077ca3f836414b737f1a7026593c9e1ff3f44107` |
| 完整变化路径 | 124：16 tools／20 tests／88 docs | 164：18 tools／22 tests／124 docs |
| 当前候选快照文件 | 5157 | 5196 |
| 本轮独立物理检查 | plan/manifest、17份存在的核心文件及2份C模块明确排除、22个keyFiles、4份receipt全部匹配 | plan/manifest、19份核心字节、24个keyFiles、4份receipt全部匹配 |

共同前驱为 D5 `20261009T080026Z-d5fb5b62de630ae2`，manifest `01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78`。原完整5050文件与tree `8662394ff24c116685c1342ed6b8b9fa5dd58d8ffa7c0bb869be31e49e5e0646` 已有实际串行读取证据。源码路径集合与对象核对证明两候选没有 `app/backend/lib/worker/package/package-lock` 增量，没有顺带主线未批准业务/依赖变化；这只是源码范围事实，最终文档明确不把它冒充动态业务/权限验收。

AB 的限定 v1/串行读取与必要三处 daily 移植、两处完整盘点补修已复审；`release-impact.mjs` SHA `ad101d63a295ca79ee53c601cbe44c1525de47870505e2059947ba676b5c0944`。ABC核心精确匹配原D独立19字节。Django前驱/候选均绑定实际拥有方 `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`，方案没有DeployApp。

本轮没有重新hash全部31248依赖文件、重跑完整制品验证或再次Prepare。两候选各自原prepare-online exit0及候选完整源/keyFiles/四receipt读取日志提供该层证据；本轮独立复算上表关键字节，不冒称亲自重跑原全树门禁。固定可变来源当前为AB；ABC旧plan当前不能通过可变来源身份，最终文档已明确，不能同时称两计划可执行。

## 测试计数与范围

独立重算实际根 `.test.ts` 集合：首组映射13文件、剩余426文件，并集439，当前实际439，文件层面无交叉、无漏项、无额外项。对应日志确实是首组307通过/0失败，以及剩余3330项＝3306通过＋24跳过/0失败；两组原退出码均0。首组执行当时还有最终wrapper去重前的底层重复例，因此**不把307＋3330写成一次默认全量测试总数**。文档采用逐文件覆盖与分组结果，表达正确。

其他实际结果与记录一致：原AB158通过，最终盘点必要回归61通过，非作者14通过；lint exit0、0错误/35 warning，650模块边界通过，D隔离构建exit0。AB/ABC各自prepare-online结果与来源分别绑定，不能互借构建回执。D主线可能含未采用业务，439文件覆盖没有被宣称为两候选所有业务测试重新逐项执行；候选核心相同/限定修复及各自制品层证据的范围单独注明。

同mtime负例当前真实stat前后都为 `1767225600000`，示例字节改变使inventory/treehash改变；Git选择文件消失后实际ENOENT拒绝。首次不充分标签日志另保留。首轮联合162项161通过/1失败的watcher异常保留，当前原断言独立1/1、同文件23/23及最终联合通过；首次根因仍未知，没有放宽断言或称资源根因已确定。候选范围核验首两次ENOENT夹具错误原日志保留，最终成功不反推它们曾通过。

## 现存点恢复与计时

现存点 `daily-20261009T114230Z-7117da1c1055` 的原Verify/RestoreRehearsal、受保护原回执/sidecar、实际manifest/dump/content/profile绑定，以及profile/序列/隔离清理已有独立只读复核。私有55591已关闭、镜像data移除；当次生产PID4080创建UTC ticks保持。没有新生产备份/保留修改/生产恢复。附加 `policySyntaxEquivalenceVerified=false` 与空witness明确保留，不泛化为全部SQL语法等价证明。

记录的准备/验证样本与日志相符：最终联合墙钟480595ms、剩余673942ms、现存点恢复706423ms、AB在线准备556424ms、ABC在线准备694864ms。报告区分Node内部duration与外层墙钟，并单列首轮失败及文档/协调未单独采样部分；没有将父操作与子阶段叠加。

没有生产批准/切换，批准→必要验收、批准→完整交付、生产排队/排空/切换/自然观察及入口实际不可用均未测，字段为null或未测，未写0。两个不同范围prepare的差2.31分钟不是性能对照；一次真实点恢复不能乘成发布净收益。30–60/80–120分钟、C原21.614/24.167秒限定样本均保留原资格与不确定性，不声称生产SLA或最终ABC分钟收益。

## 非执行方案与授权边界

[FINAL_RELEASE_PLAN](FINAL_RELEASE_PLAN.md) 与范围JSON一致：STRICT/FULL，前后新Backup/Verify/Restore、原排空/维护/版本/权限门禁及原错误保留均继续要求。默认AB先、C在新实际前驱重准备；ABC仅在AB未采用时为替代，不换绑旧批准。

新增自动验收/封存草稿已撤为 `evidence/withdrawn-drafts/*.txt`，原失败条件保留 [BD01–BD10](BATCH_DRAFT_REVIEW.md)。撤下没有被写成修复通过，也未进入候选或被实际执行；没有自动给strict checks/covers贴passed。真实业务/历史基线、精确资源/UI/权限、完整原审计集合、真实AggregateStatus及自然观察仍是明确门槛。

| 阻断 | 最终文档的正确边界 |
| --- | --- |
| P01/P02 | 具体完整执行/验收闭包未形成；必须真实负例与非作者最后字节复审，不能以长布尔标签或wrapper completed补严格保障 |
| P03 | 真实安装Control/helper、原拥有方PG/Python及独立watchdog完整闭包需pin；watchdog task XML/动作/主体/触发/设置与原Install/Set/Enable/Start效果须准确批准 |
| P04 | 新鲜前驱、来源、权限、未决操作及维护/drain动态现场变化失效；started/unknown只按原精确独立协调、不重放 |
| P05 | `schedulerLatest=unknown`、`recoveryFastPathEligible=false`；没有可信native最后尝试就拒绝，未启用e，手工点/改ACTIVE不能替代 |
| P06 | `engineBatchSha256=null`、`productionApproval=false`、`productionAdopted=false`；scope SHA及Worker plan不是最终生产批准 |

watchdog原Check可能自动恢复/告警，方案明确要求对应通知边界；TestNotification未调用不能证明零自动外发，不能约束则阻断该采用步。当前任务没有执行Install、启停、调度写、业务写或外部发送。兼容代码回退与生产数据恢复分开，后者仍需精确点/库/窗口另批。

源码/测试/候选/非执行方案交付范围内没有新增未报告的阻断。P01–P06仍是实际执行前的阻断，用户“开始集成验收”只开启第二阶段，不满足生产批准。主线最终文档提交/合并/推送由[DELIVERY](DELIVERY.md)另行记录，不能将本报告生成时间当作已推送完成。
