# 当前停止门禁阻断与精确续接

截至2026-10-12 02:00（上海时间），本次**尚未完成生产采用与验收**。原前驱 Worker/Django 已按批准的全应用维护停止，PostgreSQL 保留运行。active仍仅原f15，维护/排空实例 `a483894ad8d945298c866c74a06df6ff` 保留，Worker候选及Django候选尚未切换。不得移除门、取消、接管或重放未知步骤。

01:30:38.835原EnterMaintenance通过，原WAL000015包含真实维护ID，`drainedStopped=true`。01:31:53.123执行下一StopWorker；01:31:58.488原WAL000018记录unknown/nonzero_exit，原入口随后exit1。该适配器固定调用StopForRelease，后者先检查系统维护不存在，而本批已建立完整维护。因此它在Stop-WorkerOnly前被拒绝，不能写成原StopForRelease调用成功。

原只读Worker Status实际返回stopped/原978前驱/f4e清单，3000/5791所有地址均无监听，5432原监听PID4080；原Django Status确认PostgreSQL running、reader/writer stopped，D部署manifest仍237。四个固定旧执行/监督PID的CIM缺席及OpenProcess(0x1000)/87已在普通权限只读采样通过。该正常权限样本只用于诊断，未改为管理员样本，也不独自授权调和。原last-controlled-stop记录仅作旁证，不能充当恢复授权。

有限V2补证使用**真正原reconcileOperation和原rotation锁**：重核原19事件/head290394…、已通过的维护、旧链219/aaf629、同owner及完整源/工具字节；锁内新采实际管理员身份、原状态/端口/四PID缺席、同门及原清单，再末采native并按其真实completedAt保持5秒新鲜性。仅以“本批前一维护已经实现停止目标且仍保持”协调这一个步骤；旧unknown永久保留，原调用失败事实保留，无Stop重放、无新Backup、无删减后续Restore。原Stop无未来receipt输出消费，故使用原协调接口，不定制WAL或伪造输出。

Astra与主任务各自27项定向回归通过；新增续接状态10项fixture通过。正例管理员DTO及第20条事件是明确标记的合成输入，不是实际生产补证。真正AGY同会话的非空意见与纠正留存；其外部自愈 concern只在原门/互斥/动作前检查范围内处理，不宣称全OS连续排他。

首次resume3封装误沿用旧Backup两PID检查，经独立复审在执行前修正为本轮四PID，并补OBSERVATIONS canonical→proof→事件关联及门的版本/root。下一轮复审又发现直接native路径漏系统PowerShell字节/链接检查；V3恢复原7600/path/nlink2/物理bracket前后复验，并在外层全程持系统PS读句柄。旧V1/V2源和封包、撤回结论均保留。未执行旧封包；自己尚未确认的V2 RunAs等待已中断。

最终V3为19文件只读闭包，绑定SHA `ff49fedc2cf5542adb4c5ec399679e2bdf27f5bfbc43fdd2e70ab512ce1a1fdc`，ASCII bootstrap SHA `7d7b6d751c017dea4966a2f8aea2f83d4f6ececb3efc57b97154e0d77985ffaf`。重新捕获完整原bc79环境，密文仅私有Temp，未存明文。它直接启动有限补证，只有实际成功后才按新真实链头执行原6989/f15/960c/原15:25:28Z批准参数；四项已证实完成才被原接口正常消费，剩余15项及最终原closeout仍必需。

本次V3 RunAs请求实际被Windows取消，工具exit1，管理员PID未返回，stop-reconciliation/STARTED不存在。聊天中的已批准范围不能代替Windows系统确认；不能绕过或借其他任务权限。本轮生产WAL仍19条/head290394…，**第20条补证尚未写入**。

醒来后可在既有管理员PowerShell运行唯一固定包，无须重新批准本批生产范围：

```powershell
& 'E:\codex-artifacts\release-site-blockers-20261011\production-f15d06a\resume3\RUN_FIXED_STOP_RECONCILIATION_AND_RESUME.cmd'
```

该包不弹新的RunAs、不接受任意命令。非管理员、变更的字节/身份/门/前驱或已变化的WAL均拒绝。若有人已开始本包，先核实际输出及进程，不重跑；未知结果继续保留原所有权及门。当前仍须实际补证、切换、新消费链同点隔离Restore、权限/显示/业务代码闭包/就绪/自然守护及最终交付，不能把这里的准备、测试或模型意见当作已验收。

永久的全维护/Worker-only选路修复另在从main f5b19建立的独立worktree开发，未改本次不可变包/规格。[永久修复报告](../release-maintenance-stop-route-20261012/REPORT.md)区分源码交付和后续采用。

资源采样窗口与首失败见[evidence/STOP_BLOCKER_ARCHIVE.json](evidence/STOP_BLOCKER_ARCHIVE.json)。42点仅静态资源可达性，窗口在失败入口结束时关闭；此后的维护暂停尚未连续采样。维护门自01:27:18起保持，实际业务不可用窗口和批准到必要验收/全部交付均未闭合，不能报告净节省。新规则未来支持的普通展示发布与这次首次采用的故障成本分别记录。
