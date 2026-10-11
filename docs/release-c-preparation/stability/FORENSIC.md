# 三个历史退出窗口与任务操作关联

三个窗口均证实 Worker child exit1、signal null，原 supervisor 随后启动替代进程。但“被记录退出并自动恢复”不能证明是自主故障，也不能排除另一对话结束了相关进程。用户提出的任务关联是待核线索；本轮没有找到可把具体 Stop/Restart/Terminate/构建命令与某个退出PID绑定的审计。

| 窗口UTC | supervisor | 退出Worker/时间 | 原恢复等待 | 替代Worker/时间 |
| --- | --- | --- | --- | --- |
| 10日06:05～06:08（D5） | 2924 | 64644 / 06:06:07.683 | 1000ms | 15520 / 06:06:11.714 |
| 10日17:42～17:45（AB） | 48744 | 66676 / 17:43:12.744 | 8000ms | 52084 / 17:43:24.475 |
| 11日00:58～01:01（AB） | 48744 | 52084 / 00:59:19.502 | 16000ms | 51028 / 00:59:39.749 |

对应 Wrangler 日志分别在06:06:06.606、17:43:12.374、00:59:19.145Z出现固定 `Error inside ProxyWorker` / `Network connection lost`。三个窄窗均未记录 liveness_termination 或 supervisor signal/exit；Django launcher按原时区偏移解析为UTC后未见后端Start/Stop/维护，Worker startup-timing也没有对应新受控启动事件。这是已覆盖日志的事实，不是全机“没有人为操作”的证明。

原AB WAL给出已知正式生命周期：EnterMaintenance在06:12:02.069开始、06:16:26.798 passed；apply在06:17:34.292开始、06:19:56.831 passed；退出维护06:20:51.918～06:21:35.712；Start06:22:35.879～06:29:21.667。它们都不落三个退出窗。最新 controlled-stop diagnostic 为06:13:23 EnterMaintenance/supervisor2924，与上述维护相符，不能用于解释此前06:06退出。rotation receipt的声明 activatedAt 和文件mtime也不是任意进程终止时间，已分别保存。

## 审计的实际覆盖缺口

在真实D5和AB发布包的 worker-local-service.ps1 中，Restart-ExactWorkerChild都保留原supervisor，直接调用 Stop-ExactProcessIdentity；实际方法内部用 Stop-Process -Force。该热重启分支**不调用** Write-WorkerStopDiagnostic。后者只在停止整个supervisor的 Stop-ExactWorkerSnapshot 路径输出并覆盖单个 `worker-last-controlled-stop.json`，不是完整append-only命令历史。startup-timing也不记录所有child-only终止或外部taskkill/Stop-Process。

因此不能从“同一supervisor恢复”“没有当前stop记录”排除明确结束Worker子树或workerd子进程的另一任务。也不能把用户的推测直接定为事实。较准确的表述是：**退出效果和自动恢复已证，是否被预期/任务操作触发尚未定案**。不修改旧封存报告；本次以此补充其原因不确定的边界。

根任务应继续核对其他对话的精确命令与UTC开始/结束回执、目标PID及创建时间/父树；特别区分 Wrangler父进程、workerd后代与supervisor，以及是否使用泛进程名/3000端口清理、正式目录共享cache/配置。分支名、任务完成声明或时间重叠本身不能证明因果。本reviewer没有向其他任务发消息，也没有查看/复制其凭据或客户正文。

根任务补充的原任务API turn核对显示：高收益任务10日09:53～10:18Z已结束；NoData任务10日15:47Z结束、11日03:06Z才续接；两者未覆盖17:43/00:59退出窗。其找到的唯一Stop-Process命令在10日11:18暂停turn内，仅停止经PID/创建身份核准的freeze-bootstrap-payload私有Node，没有指向正式workerd。前端AGY任务9日已结束，记录群工作11日01:02:42Z才开始，比00:59晚。此段明确来自根任务的API证据交接，本reviewer没有自行查询其他任务；JSON记录来源，不以sidebar updatedAt代替原turn。目前仍未找到用户所指具体会话，不能据此排除所有其他操作者、正常API任务的间接影响、明确热重启或外部kill，也不贸然归咎框架或AB。

## 最小私有复现条件

现有堆栈的具体边界是 Wrangler cli.js311625～311632 接收 ProxyWorker `type=error` 后emitErrorEvent，311742～311755包装ProxyController原因；Miniflare index.js88260～88278通过loopback调用自定义service并将异常转为500。已核实际包版本：Wrangler4.92.0、Miniflare4.20260515.0、workerd1.20260515.1。该表面不能分辨谁关闭了连接或具体请求。

后续由根任务协调串行、先纯私有目录和随机端口：使用同包版本与无业务Worker，分别测试正常fetch/完整消费、只终止fixture Wrangler父进程、只终止它的fixture workerd后代、只关闭fixture socket、请求abort/正文取消、server dispose。动作须先记录intent/PID/创建时间/父树，再取真实退出/框架错误/请求阶段，对比哪个条件产生同一表面；仅操作该fixture自有PID，不按进程名或正式端口清理。另将独立与故意共享的**私有**build/cache路径作为单独组，不触碰正式包。保持互斥/身份/owned-tree和5次/10分钟保护，不为复现抑制错误或把失败HTTP改200。

此次未执行私有复现、真实HTTP/Status/SQL/构建/生命周期/锁或源码修补。仅写 [FORENSIC.json](FORENSIC.json) 与本文件；原日志摘要、逐行/原始读取SHA、三个窗口的限定事件及旧报告SHA均在JSON，客户/凭据/任意日志正文未进入Git。原AB109必要闭合和之后健康是历史验收事实，不代表这些稳定性事件被抹去或已修复。
