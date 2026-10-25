# Antigravity 第二审查事实核对

用户明确授权调用本机 Antigravity。实际 agy CLI 第二次调用 PID61336，01:09:32.049–01:11:59.522Z、147472.1929ms、exit0；原 result SUCCESS、response非空。原 JSONL SHA `044d01a403c6d2a53d12793e2761561ac9821c67ea155e9b86c4280f383b1a76`；完整原文和工具轨迹见 [原报告](AGY_AB_REVIEW_RESULT.md)、[机器记录](AGY_AB_REVIEW_RESULT.json)。首次参数缺时间单位，exit2/stderr原日志保持，没有进入模型审查或生产执行。

工具轨迹实际20次 view_file，18次成功，2次文件未找到：异常报告MD当时尚未落盘、一次尝试了错误路径；之后成功读到异常报告JSON。没有shell/Status/HTTP/SQL/生命周期工具调用，没有默认权限绕过；这些文件未找到不冒称自动审批拒绝。AGY只审工作区公共受限证据，没有独立读取E/D私有档案或自己重哈希4829文件。SHA表是读取现有metadata的引用，真正实物核验由 preparation_review 完成。

核对结果：支持必要验收true、实际三probe及native/producer事实、owner物理缺失的独立证明、三历史unknown保持、原严格false和原20/source88不重放；也正确指出其审查时fullDelivery=false仍待Git/归档。Worker退出/原自动恢复属于保留的稳定性事项，不推翻此时点已满足的新批准合同，不能说崩溃已修复。

需要更正的表述：

- 原文“约25～30秒服务不可用窗口”过于确定。实际是11个不可用样本的25.075秒跨度和相邻正常样本30.086秒界，没有精确停服起止。原机制退避16秒，后面还有验证/启动及入口恢复；不能只用退避或spawn时间推算停服。
- 原文互斥上层合计314628.4124ms、caller残差19830.1639ms正确。Root此前草稿误写20.830秒，已按原数值纠正；残差未打点，AGY称其“框架处理时间”仍属于推测，应只记未归类caller开销。
- 839ms是返回到owner缺失及append前采点，1008ms是返回到completion WAL.at逻辑时间；两者都不是独立观测到的fsync完成耗时。
- AGY没有生产探测，不能凭其SUCCESS或模型共识新增健康证明、证明旧预算就是根因或宣称达到30～60/80～120分钟收益。

本核对不扩张生产范围，也不改变原实际JSON的fullDelivery=false快照。完整交付只能由后续Git/归档/独立行政核验的新真实时点确认。
