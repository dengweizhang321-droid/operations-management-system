# 442b 唯一调用：实际复核准备

当前只准备复核方案，尚不写实际通过/完成结论。已知新真人批准为 2026-10-10T17:40:35Z、item01a126e7…，原文件SHA bcc3a26d…；原批准05:28:51Z不重置。唯一caller已由Root启动，本审查不重复调用。

等待Root确认唯一wrapper和入口observer都已终态后，只读执行 [验证脚本](FINAL_TAIL_ACTUAL_INDEPENDENT.mjs)。脚本要求execution/finished.json与entry-observation/finished.json同时存在；缺失时仅输出awaiting状态和completionConclusion=null。准备阶段只做语法检查，不调用它。

实际复核按以下有限范围完成：

- 新scope/raw、真人receipt、四模块小文件SHA与started/intent/PID/argc/cwd/共享绝对deadline；不重复4718闭包或943MB dump。
- 原89与E295/ACTUAL-89-20261011/journal逐字节一致；全新增canonical+LF/event/previous链；accepted88恰1条、原19仍unknown/strict=false、1–19不重放。
- 只允许原20/21各最多一个started；原argv/pins/assertions由冻结原operator执行，真实direct结果、receipt/字节SHA、原Status重试记录及NotReady不可重试保持。
- 成功分支须真实20/21 passed、typed completion的原engine=false/strict=false/source不重append/fullDelivery=false，并实际lstat ENOENT确认owner释放。失败分支保留真实cause/process/attempt、新head及owner真实存在/缺席状态，不以晚来的Ready洗白。
- 核wrapper stdout/stderr原字节SHA、父子时序及原manifest小文件f4e/同releaseId；核新2.5秒/header-only入口样本与缺口，HTTP200不能证明backend ready，切换跨度不是停服。
- 原批准到必要验收闭合仅在实际成功时记录；新批准另列，完整交付时间仍待文档/Git。所有嵌套阶段不重计。

脚本只有Node内置只读文件/摘要计算，不import生产modules，不调用caller/API/collector/Status、HTTP、SQL、锁或维护/生命周期。最终报告只写本D集成树production/FINAL_TAIL_ACTUAL_INDEPENDENT.json/md，旧封存review及E候选保持。
