# 前恢复期间入口异常独立追溯

2026-10-10。结论为 **已证实短暂不可用及旧 Worker 退出/自动恢复，底层原因未闭合**。原始路径、SHA、逐项事件与限度见 [机器报告](INDEPENDENT_PRE_RESTORE_ENTRY_ANOMALY.json)，SHA `289907a4a10eee409b7718be992f74162759dbfc2c285e872d89ce0df8a9a0f1`。本审查仅只读现存日志/元数据及窄时间窗 Windows 事件；没有额外正式请求、Status operator、恢复、启停或完整制品扫描。

原入口 JSONL SHA `9801c4e6f2f128c622b8263064c8b054c93e413a32fc91ac6d959e57e4e85ad7` 与快照相等。`06:06:06.592–06:06:16.613Z` 的五个失败样本包含 HTTP500、连接拒绝及超时；前后正常样本为 `06:06:04.083/06:06:19.127Z`，采样跨度约10.021秒，邻近正常边界15.055秒。它发生于 restore-pre，须与 `06:13–06:26` 的维护期间区间分开报告，不能当作仅慢请求或删去。

`logs/supervisor-lifecycle-0.jsonl:1251–1254` 记录同一 D5 supervisor `2924`（估计启动 `01:44:50.849Z`）在 `06:06:07.683Z` 收到其 Worker 根 `64644` 的 exit1，5毫秒后安排1000毫秒重启；`06:06:11.714Z` 生成新 Worker 根 `15520`。前后心跳 supervisor 身份连续。原 watchdog 留存快照 `1c49f6db8c7d44708d68dfb40b52d36a-latest.json` 的实际观测时间 `06:06:25.095Z` 已显示 D5、supervisor2924、3000监听59416及 healthy=true，没有数据库恢复记录。可证这次由既有 supervisor 自动恢复；新监听 PID 与 managed Worker 根属于不同进程角色，不能混为同一 PID。

原 Wrangler 日志 `wrangler-2026-10-10_01-44-59_259.log:17871` 于 `06:06:06.606Z` 报 `Error inside ProxyWorker`，内层 cause 为 `Network connection lost.`，调用栈在 Wrangler ProxyController/Miniflare loopback；随后的 CLI 错误及 exit1 时间与失败样本吻合。这是已定位的错误表面，未给出 workerd 原生进程终止、内存故障、CPU争用或外部终止的因果证明。watchdog 列出的 `06:03:48/51` Windows1000/1001事件经只读原日志核实属于 `AlibabaProtect.exe`，不是 Worker。窄 System2004查询没有返回记录，不构成所有资源故障均不存在的证明。

原 restore-pre WAL `000010` 为 passed、PID37096 exit0、`direct-exit-files`/`preserve`、timeoutType=null、treeCleanupPending=false；该父操作没有执行期限触发的树清理。因此不能把这次直接归因于 A 的根包装超时杀树，也不能由此声称所有正式服务保护路径均已生产证实。精确受审 native operator SHA `542e4fb67ed96a680f76f1de9f4b124bfb7f039094ff664fe25595b4a8fb48e6` 与批准文件相等；其 pg_ctl 停止作用于本 rehearsal data 目录，隔离 PG 原日志的 fast shutdown 发生在 `06:08:20.993Z`，晚于入口异常。缺少完整 workerd/OS 终止轨迹，仍无法排除一切外部误杀或确定本机争用是否诱发断连。

原恢复回执的 profile/内容/清理成功保持不变。operator `django-postgres-maintenance.ps1:1886` 对 `serviceStateChanged` 直接赋 false，它表达该流程的操作范围，不是对所有同期服务状态的实测证明，不能覆盖现场失败样本及正式 Worker child_exit。最终发布报告必须保留这段额外不可用、原因不确定与自动恢复，不能把它重写成无异常恢复或已达停服预算。
