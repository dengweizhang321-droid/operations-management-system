# 补充 CLI 前置失败独立核验

2026-10-10 08:50 UTC 独立只读快照：**初次 standalone CLI 停在闭包校验，未新增引擎执行步骤**。机器证据见 [CLI_PRECHECK_ZERO_EFFECT.json](CLI_PRECHECK_ZERO_EFFECT.json)。用户08:41:31对精确补充 `0bcad05b44a127e63bb0c38ad16046d282eb529e47cf0c7d9022fac248f6cac2` 的明确批准已存在；旧封存元数据中未批准字段是历史快照。

原 stderr 101字节逐字保留，内容为 `assert.ok(before.isFile() && before.nlink === 1n)` 失败；stdout为0字节。文件在补充 root `production/execute-supplement.{stderr,stdout}.log`，实际 SHA 及原路径列入机器证据；exit1/5824.9ms来自父任务的原 exec 元数据。第一份未拿到原日志路径的观测另外保留，没有重建 stderr。

封存 controller `supplement-controller.mjs:71` 对所有文件严格要求单硬链接；main在149行先验证完整旧/新依赖，然后才导入原 engine 并调用 `executeSupplement`。独立确认唯一系统host `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 为常规文件、nlink=2，完整 SHA仍 `7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5`；逐级路径无重定向、哈希前后身份/大小/时间/链接数稳定。已采用 AB 的 `release-impact.mjs:34` 原 `safeFileDigest` 本来就只允许这个精确 OS host 的受保护链接，仍要求路径、SHA及元数据稳定，未为普通脚本/工具放宽要求。

新22个封存文件全部SHA相等，原9 authority与补充manifest原始SHA也相等。active仍原9，WAL45条完整canonical/hash链通过，末节点仍 `b68be115be0dc4061a1aca79df78eaabf2ed858e76e2c1bdb96c8c178e507556`，第10步三次started、零passed、末failed。1–9仍各只有一次started并passed；11–21无事件。本补充命名空间中 `supplement-approval/intent/started/result` 及新UI audit/result均不存在。独立快照因此支持该初CLI未取得执行lock、未写新引擎started、未运行新UI或重放生命周期；人工批准文件/只读观察器是另外的准备证据，不当作CLI执行步骤。

本报告不审定随后薄API调用器，也不批准新的执行范围；其接口及前置闭包保留由另一reviewer审查。没有修改原9、新22文件、封存inputs或历史失败；没有运行Status、UI、Backup、Install、启停、调度或外部发送。此零效果结论仅限初CLI失败，不能套用到已完成切换的整个AB批次。
