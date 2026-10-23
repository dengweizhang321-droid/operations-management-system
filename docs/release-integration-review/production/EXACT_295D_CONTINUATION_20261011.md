# 295d精确变化合同实际采用与尾部准入阻断

用户明确批准“批准精确变化补充验收方案295d8923并完成AB收尾”，实际时间锚点`2026-10-10T15:59:48.000Z`（北京时间10月10日23:59:48，turn秒精度），item`01a1268a-bc4d-7501-98f1-5ec3ceaa2a99`。create-only/fsync收据SHA`c70ac58556ffca976c0d19c0abebf5858da545b034c3b09048dd82f7fe8a3970`，保存在精确封存根`AB-exact-closeout-20261010-1530-final`；旧9/0bca/7389及原批准起点均不改写。

## 实际结果

唯一受审入口PID23656于北京时间10月11日00:02:43.604开始，00:10:06.046退出1，442440.720ms（7.374分钟）。stdout0，stderr206字节，SHA`356e425f8d366127eb6aacdcf9090161dc5f2f94e947e4dc47ac29ad09e135b0`。stderr只含安全错误摘要`89af35ec...`，无原始私有值；没有保存该失败子collector的完整processEvidence/raw输出，不伪造或反推原始内容。

| 事项 | 实际证据 |
| --- | --- |
| 源/完整证据复验 | 新source proof耗时12444.827ms，原scope4589完整绑定；队列获锁1.685ms，非排队承诺 |
| 首轮完整准入 | 000087于00:07:16.824写入，245423.797ms；实际原Status observation在00:06:10.905 passed |
| 精确变化合同 | 000088于00:07:17.063，event`ee784dfd718bc16aabcc2868667ac5b5d707bf3a582624a4f722019a050d7485`；单独合同passed，原strictEquality=false/原19unknown保持 |
| 第20前准入 | 原collector `_observations/...-795cf0fe-1590-432a-9047-64b3840ed049/1.json`于00:09:29.948 failed，code=`STATUS_NOT_READY`、retryable=false，query耗时35919.288ms |
| 原20历史审计 | 未出现started，不能认已执行 |
| 原21精确最终就绪 | 未出现started，不能认已执行 |
| 单独新合同最终闭合/active释放 | 尚未发生；active仍原9，日志89条/head`ee784dfd...` |

原19严格全等失败的000086字节与unknown不变，原1–18已确认的效果不重放。不能因新88、caller停止或首页正常认整批交付完成。**必要验收与完整AB交付仍null。**

## 独立复核与诊断

非作者核验完整89事件canonical/hash链、原87与既有`DELIVERY-cb007f05/journal-at-delivery`逐字节一致，新88 receipt由真人收据和实际proof重算匹配；source5fa/Worker f4/Django237仍不变。实际报告见[独立效果复核](EXACT_295D_ACTUAL_INDEPENDENT_REVIEW.md)。

89条原事件、停止时active、新真人收据、外层日志、实际两次原状态观察、另行只读诊断、入口样本及报告共111个文件已create-only保全于`E295/ACTUAL-89-20261011`，逐字节回读；`MANIFEST.json` SHA `70d1fa99d73fbea2ba0e648652abc9e5ccd5fdf574b62cd0e8dd68c2ea722bbe`。此归档仅保全现存证据，没有补造未持久化的失败子进程输出。

阻断后只执行一次另行标明的只读Status诊断（不是原21），00:14:03.267–00:14:39.083，PID68700、exit0/direct，回读Running/Ready/exact同一release及12组件true。它只证明后来的诊断状态，不能覆盖00:09的实际NotReady；哪个具体组件和触发原因未取得原输出，保持未确定。未调用Start、Stop、维护、部署、Backup、Restore、业务写入或外发。

新增入口观察00:02:33.577–00:12:27.525，238次、不可用样本0、最大间隔2556ms；00:12:30.031结束。仅GET响应状态/HTML头，取消且不保存body；不能替代后台就绪，恰有首页200而准入NotReady的实际限制。之前三段原失败及11:04:39.350至此段之间缺口继续保留，不以切换跨度报告停服。

## 后续修复范围

295d原入口只绑定原87/head316f，目前已有单独接受的88/89链，禁止改原scope或自动重新进入。应准备精确尾部续接：绑定已实际接受的88及89/head，保留原19/NotReady/exit1，复验原295证据与新实际前驱，仅执行原20–21及新合同的精确所有权释放。不得重复88、Backup/Restore/生命周期或换main新版C/no-data入口；源码、独立复审与精确新scope须先形成可审查结果。

原批准北京时间13:28:51继续计时，新批准只另列；用户确认暂停区间、失败、协调、准备与文档收尾不藏匿。此次7.374分钟是一次失败接口运行，不是完整发布时间或节省时间，工程预算仍未验证。
