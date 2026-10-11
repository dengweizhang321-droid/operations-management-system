# 12c 入口异常只读复核

确认本次入口异常伴随真实 Worker 退出与原 supervisor 自动恢复，不只是单个请求超时。具体触发请求及连接丢失/退出根因仍未证实；不归因于观察器、CPU、资源争用或 A 的超时清理。机器证据与原日志读取/逐条摘要 SHA 见 [HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json](HEALTH_PROBE_ENTRY_ANOMALY_REVIEW.json)。

147个已有入口样本中，11个 unavailable 位于00:59:19.129～00:59:44.204Z；前后200观测为00:59:16.622/46.708Z。失败样本跨度25.075秒、相邻健康界限30.086秒，均不是精确连续停服时长。第一条 HTTP500 正文已消费，其他10条没有HTTP状态，保留各自原时间/latency/hash；没有读取或保存业务正文。

现存原 supervisor日志确认同 PID48744：Worker PID52084 于00:59:19.502Z exit1/signal null；19.509Z安排16000ms受控重启；35.512Z启动验证；39.749Z spawn替代PID51028。58:08、59:08和01:00:08 heartbeat均为同 supervisor，worker-process原回执仍绑定 f4e537eb…/AB20261010T014638Z-97833d2f2b7e7bc9。选定窄窗无 helper退出、liveness_termination或supervisor更换记录。没有新枚举、信号、Status或端口探测；回执与历史spawn记录不被冒称永久当前状态。

原 Wrangler17:43:27_776日志在00:59:19.145Z记录固定 `Error inside ProxyWorker` 和嵌套 `Network connection lost`，紧邻真实 child_exit。已提取固定 Wrangler cli.js65574/311747/311631/311359与Miniflare index.js88266/88500框架帧及行SHA；其语义是 ProxyController通过Miniflare loopback收到ProxyWorker错误，不能凭此确定原请求、谁关闭了连接或最终退出的完整因果链。与先前D5/AB同类框架表面一致，不证明同一底层根因，也不排除所有可能外部终止路径。

Django launcher时间已按原+08:00偏移解析为UTC，再筛00:58～01:01，16条均为Status/AggregateStatus，未发现Start/Stop/维护动作。core reader24800、writer62136和Django supervisor36244原PID回执/创建时间未变。现存网店reader还有00:59:06与01:00:14Z的固定 statement-timeout warning，保持独立事实，不把它推断为Worker崩溃原因；未读取查询文本/业务行或运行SQL。

这次异常早于01:01:15开始的准入native Status，也早于01:03:00.330Z的最终健康检查。preparation_review已经独立确认scope12c、109条/head5289afac…、新真实健康与必要typed completion/owner ENOENT：最后live58.188ms/helper11.728ms/ready1990.236ms均HTTP200、passed、beforeDeadline，实际闭合01:03:03.646Z。引用该独立实物结论，不在此自签本reviewer所写健康协议。

因此没有证据推翻之后的已批准时点健康合同闭合；同时，合同通过不能证明全程可用或Worker崩溃已经修复，01:03的成功也不抹去00:59的异常。正式稳定性问题仍留后续：用精确既有Wrangler/Miniflare版本隔离重现ProxyWorker/loopback失败，分别控制普通fetch、断连、正文取消与dispose，捕获真实退出/请求阶段，找到具体因果再修。实际16秒恢复等待需如实计时；若优化稀疏故障后的累积backoff，应另验flapping/原互斥/身份/端口安全，不能因本报告直接采用。

本轮只读既存小日志、回执和peer验收文件，只写这两个新报告；未改旧证据、source/pin，未调用HTTP、Status、SQL、锁、生命周期或重跑测试。日志仍可能追加，SHA对应具体读取快照；开放写句柄的文件mtime可能滞后，不能以mtime缺变化替代实际内容核对。
