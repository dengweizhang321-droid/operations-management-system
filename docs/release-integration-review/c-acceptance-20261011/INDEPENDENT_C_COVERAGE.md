# C 冻结候选覆盖独立复核

结论：139 项回归的来源与模块指向可核实，**最终 C 候选仍不通过**。被审对象始终为 f308，manifest `20855e01…`；admission `115fbf67…`、batch `61ef80a8…`、impact `dd0fdafa…`、verifier `3c18a864…`，两个 C helper 保持原字节。完整 SHA、矩阵和未测范围见[机器报告](INDEPENDENT_C_COVERAGE.json)。没有生产 import、请求、数据库、锁或生命周期操作，也没有改另一 owner。

已读 harness SHA `45da09de…`、generator `80a3b311…`、原日志 `819750fb…` 和调用记录 `3a6e324d…`。七份原测试及改址文件的声明 SHA 全吻合，按 generator 的路径替换可逐字节复现七文件，断言未改。139/139、0失败、0跳过分为：C fastpath23、PS5/7 backend2、observer8、policy28、source-binding23、wait55；本轮未重跑它们。

| 主题 | 已有证据 | 不能据此宣称 |
| --- | --- | --- |
| 完整影响前驱 | frozen 分类/证明函数的 synthetic 负例；真实旧两份5050快照及 strict 结果 | 当前 AB5157→f3085160 的完整 collector/效果审查或新 migration-closure 资格 |
| 恢复资格 | 真函数拒绝时效/缺点/绑定/演练异常，mock collectCurrent 在每边界使点失效 | 真实最新调度、当前恢复点及新备份/恢复已验证；首次仍 strict/full |
| unknown 与续接 | tmp 真实 WAL、动作/锁桩；真实 private child exit17；unknown 不重放及 passed 步跳过 | 实际生命周期/协调完成或 synthetic independent 字段等于真实独立证明 |
| session | 真 helper 的10min/24次、克隆、并发、失效；实际 tmp watcher/same-mtime/.env.example | 动态权限、维护/排空/Django/chain/WAL 可缓存，或完整 admission 时序已测 |
| observer 与 native | 随机 loopback 浏览器，PS5/7 AST/私有传输；原 global named-pipe 锁测试 | 生产就绪，或实际 runNoDataObservation 存证后 WAL 能续读 |

139 中多数批次 `run/collectCurrent/lock`、session `identify/observeInputs` 是受控替代。它真实绑定冻结模块，但没有跑完整 `collectBatchAdmission` 或 `runNoDataObservation→journalState` 联合链。原 mutex 测试使用真实 global named-pipe，已由原回归执行；本复审没有重复获取该互斥。两 helper 的字节身份不代表动态边界自动闭合。

旧 B01/诊断缺口继续引用[原独立复审](../c-unified-candidate-20261011/INDEPENDENT_FRESHNESS_REVIEW.md)，没有重跑既有六个缺陷，也未被139的数量消除。另在私有 tmp 用**冻结原 validator、observer、create-only/fsync writer 和 journal 函数**复现：合法 permissions 观察返回 passed、写两个回执，但 `observations` 落在 `state.dir` 下；原 journal 只接受连续六位 JSON，再读即 `Broken phase journal sequence`（observer:103–110，batch:252–263）。这是139未覆盖的组合边界。

本轮三个独立检查（36.5471ms、exit0）为一个 WAL 缺口复现加两个恢复拒绝：latest scheduler unknown 不继承旧 wrapper success；未来 schedule success 时间拒绝。**三项 reviewer 断言通过不是候选三项安全通过。** 只替代外部观察动作和 import 依赖缝，真实文件写入仅在校验过的 reviewer tmp，原代码前后 SHA 不变、tmp 已移除。初版用 validator stub；最终加强为真 validator 与完整合法 op，原版/原输出保留，两轮不累加。代码及输出：[最终脚本](independent-isolated-seams.cjs)、[最终 stdout](INDEPENDENT_ISOLATED_FINAL.stdout.log)、[FIRST 脚本](independent-isolated-seams.FIRST.cjs)、[FIRST stdout](INDEPENDENT_ISOLATED_FIRST.stdout.log)。保存输出没有重跑。

统一方在自身开发树做的 migration-closure/同级 `_observations` 修补不是 f308 字节，本报告不替其签名。新候选仍须带已审时效/末核/受限诊断、observer→WAL 回归、精确来源/制品/配套与安装顺序验证；完整恢复、权限、排空和实际动作边界不能被 unit 结果替代。

附带核对根[REPORT](REPORT.md)、[AB_SEAMS_RESULTS](AB_SEAMS_RESULTS.json)和 generator：原 A27 是14通过/13因稀疏 recovery fixture 在 native 前失败；v2仅两个构造加入 `recovery:{mode:'full'}`，原断言不变，重跑受影响13/13；PS5 6/6、B精选18/18。51为跨两轮不同用例，不是单次51/51，也不加到139。真实 native 目标为私有脚本/AST/夹具，首轮问题未归因生产。根报告的阻断、四状态与未测计时边界在本范围内一致；源码新对象与最终生产批准仍待交付。
