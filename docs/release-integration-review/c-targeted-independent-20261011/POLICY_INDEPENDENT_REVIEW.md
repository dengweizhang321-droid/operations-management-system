# v4 targeted-first-adoption 实际限定包独立复审

结论：**限定源码机制与原 C 技术门槛可审；当前精确 872d 批次不能接受为可执行对象。** 没有生产批准或操作。被审 W 为 `20261011T075658Z-aed7ddc1be340f5c`、manifest `306e92da…`、source `c279cfb7…`，三模块实际 SHA：impact `197f570c…`、batch **`e0d2e1d3…`**、admission `e877cbf8…`；不是只引用开发132/197结果。[机器报告](POLICY_INDEPENDENT_REVIEW.json)保存完整 SHA 与原证据。

实际 `ADOPTION_BATCH_V2.json` 原字节 `b7555bd9…`，batch `872d7e41…` 的结构 validator 通过，但 Backup 与 Restore 的 `command.timeoutMs` 都是 **3600000**。真实 runner 首句沿用 A `processDeadline`，上限 **1800000**，两操作都在 native 前抛“子进程时限无效”。197 的小/默认预算夹具未覆盖这个实际值。应保留旧 V2 与失败记录，另形成受现有预算支持的新精确批次；不能为通过而放宽 A 门禁。

独立八组 policy/validator/consumer/runner 检查执行真实冻结函数与真实批次输入（5.629秒、exit0）。八个 reviewer 断言成功含上述**拒绝复现**，不是实际批次八项安全通过。只在标明 synthetic 的30000ms模型中确认修正后的 `const backup` 词法作用域及同点参数成功；错 backupID/content、触及生产库、cleanup不闭合、缺消费者都拒绝并保留模拟 native evidence。[实际代码](independent-policy-seams.cjs)、[原输出](POLICY_TESTS_FINAL.stdout.log)、[原预算拒绝脚本](independent-policy-seams.BATCH_TIMEOUT.cjs)和[失败记录](POLICY_TESTS_BATCH_TIMEOUT.stderr.log)保留。最初缺 VM imported helper 的[夹具记录](POLICY_TESTS_FIRST.stderr.log)未当作生产缺陷，也未冒称整轮通过。

本机制只在 v4/strict、完整十 tools 及双 Django 库存/执行代码字节资格成立时适用。恰一次旧 installed Backup；Apply/Deploy/Harden 之后，由新 installed Node retention planner 无 `--execute` 只读消费，再用同一确认恢复点隔离 Restore，均在 Exit/Start 之前。删减/重复/post、旧或 prepared operator、其他恢复点、任意 consumer命令、隔离断言删减及重新 hash 篡改均拒绝。v2/v3旧政策未被此规则改写。

另以固定 Git `0a1e…` 种子执行三个 common collector 回归（12.359ms）：慢扫描不续期、5001ms attempt拒绝、末 WAL漂移拒绝、完整 NotReady不重试且诊断保持。[代码](independent-continuation-seams.cjs)及[原输出](CONTINUATION_TESTS.stdout.log)保留。实际 `executeBatch` 函数与3032字节相同（SHA `10a8584b…`），observer仍为已审 `ab29843b…`，旧 unknown/原记录、不重放和同级存证证据不被冲销。

所有目标小对象与 spec 前后原字节一致。SourceBinding外部 schema读取用固定 envelope断言 seam，原 C输入读取用受控 seam；没有导入生产模块、调用 retention/PG原生程序、真实 Backup/Restore、网络业务或重型构建。模拟同点响应不等于真实恢复演练。完整源/载荷、当前会话与生产准入由相应验证独立闭合；原 source/session标准失败记录保留，准入 unknown是安全阻断，不能写为准入成功。本报告不签随后新源码/新批次，不执行生产上线。
