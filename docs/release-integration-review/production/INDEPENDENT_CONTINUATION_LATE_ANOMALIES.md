# 冻结续接采样中的晚期异常独立追溯

2026-10-10。两次晚期AB Worker exit1及原监督自动重启已证实，根因仍未知。[机器证据](INDEPENDENT_CONTINUATION_LATE_ANOMALIES.json) SHA `1d5a190abbbc8ed593ebefee4c74dab936ba4ad88278e3ac7dbb8c6be3863072`；旧06:06、09:06报告未改。

| 冻结入口失败样本（UTC，各5次） | 请求起点采样跨度 | 相邻200确认的保守边界 | 原Worker exit1 | 自动新根 |
| --- | --- | --- | --- | --- |
| 09:54:12.503–09:54:22.529 | 10.026秒 | 15.522秒 | 44348，09:54:12.885 | 40148，09:54:18.980 |
| 10:02:06.526–10:02:16.559 | 10.033秒 | 15.126秒 | 40148，10:02:07.230 | 66676，10:02:15.422 |

监督进程48744及其 `06:26:26.7917950Z` 身份保持，原lifecycle日志1481/1484、1493/1496行分别绑定exit/spawn，重启退避分别2000/4000ms。对应旧Wrangler原日志在 `09:54:12.520Z` 和 `10:02:06.546Z` 再次报 `Error inside ProxyWorker` / `Network connection lost.`。这是与先前相同的错误表面，不是native根因证明；不能推定CPU争用、固定周期、A回归或观察器原因。

两段均发生于 `09:44:11.721Z` Backup unknown及原engine停止之后。原WAL仍75条、末000074/head `420fd5e13e5b637c1a6d62f6fad1e16dccd19c8f1f2c26c8302db892c34fcd09`，canonical原字节/全hash链通过；两故障窗口内没有新WAL步骤，17–21未开始，active仍原9。最后Backup processEvidence为preserve/exit1、timeoutType=null、treeCleanupPending=false；原runProcess完成时取消两个期限timer，preserve路径拒绝杀树。没有已有timeout/treecleanup记录支持误杀归因，但缺少完整OS/native终止轨迹，不能排除所有外部终止。

续接观察器已正常显式停止，非deadline结束。原JSONL SHA `2b5d7b5ed3cb80438fd729051aff56c4ab36c65bb38bfa30b51e95e22669a9f1`，2201样本/15失败，最后样本 `10:15:23.909Z`；以后服务状态不在该采样范围。原批准 `05:28:51.000Z` 至快照捕获 `10:15:27.752Z` 为286.612533分钟，至最后样本为286.548483分钟；必要验收、完整批次及交付闭合时间仍null。这里只计算墙钟，不把父子阶段重复加总，也不将这些边界叫作精确停服时间。09:06先前独立报告的15.061秒是相邻请求起点间隔；最终15.076秒保守值包含下一正常响应15ms的确认时延，两种量不混用。

采样之后另观察到原watchdog `10:18:25.646Z` 的被动快照：BackendUnavailable/NotReady/core=false/healthy=false，四个入口probe仍HTTP200。同AB、supervisor48744、worker25236没有换；它再次表明页面200不能覆盖完整后端失败。该动态latest在保存前被原task下一快照替换，故本报告仅保留实际只读tool所见语义，不重造它的raw文件或SHA。

随后原守护自然出现 `10:19:25.594Z` 的Running/Ready/12true/healthy=true，同48744/25236。其原字节已保全为 [INDEPENDENT_POST_OBSERVER_PASSIVE_STATUS-101925.json](INDEPENDENT_POST_OBSERVER_PASSIVE_STATUS-101925.json)，1438字节/SHA `8c2261887f470c080ef3e0cfdef81aa653854860350f4cb8c52018713e07e0f6`；既有 `evidence/8e3d893683d343aeaf5653b7e3442732-latest.json` 于10:20:53捕获同状态，databaseRecovery为空，未提供新的主动恢复动作证据。两份快照各按自己的observedAt报告，不宣称永久current或以后一份正常状态改写前一份异常。未来tail仍须取得新的精确完整动态准入，PG效果确认不覆盖core健康。

本reviewer仅只读已有metadata/日志并新增docs，未运行Status、GET/UI、服务动作、生产DB/业务数据查询或外部发送。AB/f4身份保持，但整个批次仍有Backup unknown、输出协议及严格内容差异阻断；晚期恢复、被动健康快照和原自然守护通过都不能代替尚未完成的原17–21。
