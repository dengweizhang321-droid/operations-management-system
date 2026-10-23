# 1cae 实际补充验收独立复核

结论：本次唯一执行失败，必要验收与完整交付均未闭合。独立检查器退出 0 表示失败证据核对成功，不表示验收通过。

- 批准范围：1cae786dfffa78b362e056ef2abffd889138106d6c3ce9d64add1f86b628aed7；封存源码 c060f4d6bf330797dce28241416f4a4d43125a8f。真人收据 SHA 570dc8b6fcca40b8fcfa4aac64a1ef12ab7a6d3459138cc95eb1b6cf30a0aa7a。
- 调用器 PID 48772，2026-10-10 22:44:49.442Z 至 22:50:01.130Z，311687.5465 ms，exit 1。stderr 3801 字节，SHA aa4475db92fd3fd6543fd7b3c9265ad2c3fdd16151d4ddeef79bb94cddd472dc。
- WAL 共 102 条，head ceb8ee2a73a3140ae427adc06ebf373eee785360b36a7a3b27f6d7da0a384e7c。旧 97 条逐 SHA、旧 89 条归档逐字节及全链 canonical/LF/previous 均核对通过。旧 19/21 unknown 保留，20 未重放，88 仅一次；新独立操作最终 unknown。
- 未出现 pending/completion 或成功 receipt；active 原 owner 字节 SHA 7c5af7f44a5aa80579bc9ac2a5038ad5ab757a90dc837de4977513d8be7b0cbf 仍存在，未释放。

## 失败场景与原因边界

22:48:53.332Z 准入捕获为 Running / Ready / exact_release，12 项均 true；22:50:00.768Z 最终捕获变为 Unresponsive，backend 仍 Ready，worker 仍 exact_release，releaseMatchesExpected=true，12 项仍 true。最终 native PID 71628 确实 exit 0、34557 ms、stdout 603 字节，SHA 707135c8d88aff9ebc06217bcaf573844871d70eaa51c20c1124d05428c59032。捕获 SHA c0e6c1b1fe6dc25946a542314b909a4b7d650fc96d3d6c234c495c2bec6734dd，记录先于原断言。

封存 legacy/release-readonly-retry.mjs:109–111 要求整体 state=Running；该条件真实失败，因此 STATUS_NOT_READY、retryable=false、仅一项失败尝试，没有重试。native exit 0、后端 Ready 或 12 项 true 均不能替代整体就绪断言。新 unknown 的顶层 processEvidence 为 null，但真实进程证据已保留在 000101.json.error.processEvidence 及状态捕获中；旧原 21 缺失证据不作事后补造。

静态 tools/operations-system-control.ps1:414–448 将 Unresponsive 作为本地 liveness/helper/readiness 复合条件未满足时的默认结果（另有特定 BackendDegraded 分支）。现有限定摘要未保存各子探针结果，不能确定是哪一个条件失败，也不能断言后端故障。复核者没有再次调用 Status 或发起 HTTP/SQL。

## 计时和入口观察

原批准 05:28:51Z → 本次 caller 终态为 62470130 ms（17 小时 21 分 10.130 秒）；新批准 22:42:23Z → 本次终态为 458130 ms（7 分 38.130 秒）。两者均不是验收闭合时间，必要/完整闭合时间保持 null。

本次 proof 13966.086 ms；原 mutex 排队 2.5338 ms；准入 227115.642 ms；新校验 52403.66719999997 ms。合计为 caller 内互不重叠阶段 293487.92899999995 ms，剩余 18199.61750000005 ms 未细分。native 34557 ms 是校验内子阶段，不重复相加；批准至启动 146442 ms 另列，不能冒称锁排队。此前确认暂停 11:58:54Z→14:19:06Z 下限 140.2 分钟保留于总经历，不再相加；此前各阶段/补充沿用原计时报告。

本段 161 个入口样本均可用并消费后丢弃响应正文；仅能支持本段入口 HTTP/HTML 观测。旧末样本 17:51:56.053Z 至新首样本 22:44:33.468Z 存在 17557415 ms 缺口，不能作为停服时长。新正文处理方式与旧 headers-then-cancel 不同，不作配对性能比较、不推断旧 worker 退出原因，也不用切换跨度或 HTTP 200 证明 backend 健康。

## 审查范围与阻断

仅检查真实小文件、102 条 WAL、两份受限捕获、wrapper 日志/审批/入口元数据及 owner；未导入生产模块、未获取锁、未重哈希 4771 项或大 dump、未运行新探测。旧 source/封存报告不覆写。原 manifest f4e537eb…同版本；没有采用 C、no-data 策略或执行生命周期/备份恢复重放。

阻断：整体 Unresponsive 原因尚未精确确定；新验收 unknown，owner 保留，必要验收尚未闭合。本报告不批准再运行，不修改原断言或失败历史。完整交付仍待实际验收闭合及 Git/归档后按规范单独记账。
