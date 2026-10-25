# 442b实际续接：原20通过，原21未就绪阻断

用户明确批准442b完整scope，实际人类消息`01a126e7-0115-7943-9bfb-310f0c235a90`，时间`2026-10-10T17:40:35.000Z`（北京时间11日01:40:35、turn秒精度）。新真人收据SHA `bcc3a26d5e92716eeb345bc656388d9b120353502b695f41215e71df653a0b39`已create-only/fsync登记；原批准05:28:51Z和295d实际源接受不改写。

唯一冻结caller于17:42:55.378Z启动PID21924，17:51:04.840Z退出1，489461.1322ms（8.158分钟）。stdout0、stderr789字节/SHA`ee3194c779ce384aa23ae1c3d267457a533fbdf655b79eb74afdb1dd3290628f`。原20通过，原21真实NotReady；**AB必要验收与完整交付仍未闭合，active未释放。**

| 实际阶段 | 结果 |
| --- | --- |
| 新授权/source复验 | 000089通过，完整源证明12.089秒/原rotation获锁2.745ms；source88不重复 |
| 原20前准入 | 000090 passed，220.6167733秒，原Status一次passed |
| 原20历史审计 | 000091 started→000092 passed，3.8386128秒；原adapter及完整原断言，真实PID13144/direct exit0，receipt `fde84841…`，不是准备阶段的1811文件预查 |
| 原21前准入 | 000093 passed，178.826秒，原Status一次passed |
| 原21精确最终就绪 | 000094 started，000095 observation-attempt失败，000096 unknown；STATUS_NOT_READY、retryable=false、唯一一次query，没有重试 |
| 失败/闭合边界 | 原21运行55.674秒，其中Status观察46.4940048秒为子集，不能重复加总；无typed completion、无owner释放 |

原89事件与E295已归档字节全部相同，新97完整canonical/hash链独立复核通过，head `d60a34f1aebce3bf2629a1d2c9b7e1c7f451c40fd74e44b9ac67388ef5cfdf19`。原1–19不重放、原19unknown/strictfalse、原21本次unknown保持。实际独立结果见 [报告](FINAL_TAIL_ACTUAL_INDEPENDENT.md) / [机器结果](FINAL_TAIL_ACTUAL_INDEPENDENT.json)，JSON SHA `78f5dc8dc51b77e3a49dfdefa54138bb94852e64a3f25c4f093f3f6895a7604a`。

## 限定诊断与证据缺口

原21的已审B逻辑在成功读取Status JSON后，再由完整就绪断言抛NotReady；这个异常没有附原native process和状态摘要，所以实际unknown的process/receipt为空。不能从错误码或新测试恢复失败瞬间哪个组件、state/backend条件未Ready，也不能编造原exit0/PID/正文。该确定缺口见 [独立源码定位](READINESS_FAILURE_EVIDENCE_GAP.md)。

只另行执行一次明确标记的只读Status诊断，不是原21或补充验收：17:54:35.468–17:55:10.623Z，PID28888/direct exit0/35144ms，回读Running/Ready/exact同一release和12组件true。518字节原stdout SHA `32118a1e6e67aeacaa018d6d55c9737179f0616191d95c925fe6554f2f9b66c6`已私有保存。它只说明后来诊断状态，不能覆盖原NotReady、协调成原成功或释放owner。未重复诊断以寻找green。

Root另在隔离最新main分支修补失败证据：在原query parse/断言catch中保留实际native process及固定schema状态摘要；禁止raw reason、额外字段/客户值、URL/argv/stdout逃逸，多层安全序列化保持同一摘要。原全部断言、4暂态上限、NotReady非重试及共同期限不变。当前源码修补尚未生产采用，不修改冻结442b/E/已安装原B，不能据此认为真实NotReady已修好。

## 入口观察和运行故障分别保留

新增221样本，首17:42:44.803、末17:51:56.053Z：8次不可用，500一次/ECONNREFUSED七次，实际失败17:43:12.357–17:43:29.885Z；样本跨度17.528秒，相邻正常边界22.545秒，非精确停服。与上一段16:12:27.525Z之间缺口90分17.278秒，其他历史异常/盲区均保持。此段HTTP失败在初始化附近，**不是原21的17:50:18起46.494秒观察窗口**，不能当同一根因。

现存运行日志只读追溯确认17:43 supervisor48744未换、Worker66676 exit1、随后自动启动52084；固定Wrangler框架错误为Network connection lost。17:50–17:51没有匹配Worker退出/spawn日志，所以原21具体NotReady原因仍未知；不归因CPU争用或观察器取消body。完整运行故障独立追溯将单独交付；原20之后无新的维护/启停/部署/调度/Backup/Restore/业务写入或外部发送。

原调用器、批准、原97事件/active、实际历史审计after、观察、另行诊断及独立报告共120件现存材料已create-only归档`E442b/ACTUAL-97-20261011`，MANIFEST SHA `5306c7174221ba8f0d314be7903b557fc7e5f744ab3b9ef0ac11139324c454a9`。现存真实文件不覆写；后来新增的故障/源码修补报告另保全。

## 计时和当前状态

原批准到此次失败终态742.2307分钟；新442b批准到终态10.4973分钟。这不是必要验收闭合或完整交付终点，两者仍null。用户确认的暂停最短140.2分钟另列；失败、诊断、隔离修补/复审和文档收尾继续计时，不用新批准或次日重置。独立核验/叶子夹具/诊断秒数不当发布收益，其他批次排队无新证明，预算30–60/80–120仍待验证。

实际应用继续AB源5fa/Worker f4e/Django237；C及新no-data策略未采用。只有原21这一最终就绪事项未闭合，其真实失败和旧19失败不能回填。旧442b已消费89前驱，97/head已不同，不重新进入；未准备或执行新的生产续接，不通过新批次名称掩盖故障。下一步先补齐可靠失败证据及只读故障定位；任何新精确生产协议须形成受审方案再按用户原规则批准，不能自动重放21或手删active。
