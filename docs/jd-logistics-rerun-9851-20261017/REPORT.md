# 京东物流9851精确闭合与完整重跑

日期：2026-10-17。用户明确选择“重跑京东 POP 工作流”，授权实际下载和导入。本任务使用当前已上线版本，不部署候选登录优化或预打包制品，不更改数据口径或启用缺货通知。

## 原失败与方案

9851为08:00定时执行，首个flow在业务surface识别时以JD_LOGISTICS_LOGIN_REQUIRED失败；后续三源planned，无export/receipt，精确下载目录为空。原错误不改成success，旧计划/文件不交给新执行。新流程必须从A创建fresh计划。

原生append-only日志seq241/242将9851全过程夹在8a54的有效head区间；原8a54与当前1cb四文件helper树及exporter源逐字节相同。原错误唯一定义在businessSurface，先于flow导出及其baseline/submitting写入。当前helper PID、出生身份与当前release单独绑定，不以当前进程冒充原运行进程。

现有9542/9556工具限定manual、inactive、初次零批次，不能直接套用。新增独立且CLI仅固定9851的operator，复用既有双锁、普通文件身份、限长读取、精确GET、create-only及同卷不可覆盖移动；不放宽旧入口。允许已有历史批次和非零revision，但锁内前后完整分页、每个精确批次currentSelection、settings、来源配置、Profile及原失败均须保持冻结摘要。

恢复先通过官方n8n UI短暂停用同一发布版本，核验原图/时区/定时、非终态execution为零、helper空闲无drain及端口关闭。在pipeline→全局Chromium双锁下保存intent/原件、复验、归档active，再多次复验后create-only提交committed。任一步未知均保留原intent和停用状态，不自动重试、不在finally恢复调度。

停用只禁止生产定时，不能阻止编辑器manual。本任务独占该工作流的手动入口，闭合前不发起新执行；新execution、版本或业务状态变化均停止。archive后无committed不得仅凭active消失恢复计划或执行A。独立现场核验committed及原件/业务状态后，才恢复原196ba版本，再发起一轮完整manual。

## 验证与保全

12项隔离测试通过：非零revision及历史批次、inspect零写入、一次不可覆盖归档、版本/原执行/并发变化拒绝、空目录门槛、分页和currentSelection缺失、helper/端口/PID变化、原生激活区间、原树额外文件/依赖目录、intent及archive后中断、临近移动的新执行、提交前原件变更。严格TypeScript及三文件ESLint通过，Git空白检查通过。

独立审查复现原helper树额外第五成员未被拒绝的准入漏验，已补完整成员集合精确比较及反例。原调用命令字符串的显示层转义疑点已排除，最终仍使用明确的Windows路径构造。规划请求Astra High，审查请求Sol XHigh；工具未独立返回实际型号。审查及生产现场回执保存在 `D:/codex-artifacts/jd-logistics-rerun-9851-20261017/`。

官方取消发布前，已通过node:sqlite一致性备份保全整个n8n元数据，私有备份位于原用户`.n8n/backups/jd-logistics-9851-20261017`，回读确认原active版本196ba完整存在；原数据库不写。摘要回执为包外N8N-BACKUP.json，数据库及凭据不进入Git/报告/记忆。TARGET-v2及BASELINE-v2固定本次运行证据与八个历史批次及精确当前选择，旧捕获也保留。

## 实际执行状态

本提交为已验证operator候选与操作方案，尚未停用工作流、归档9851或创建新业务execution。后续真实结果以同任务包外CLOSURE-RESULT.json、POSTCHECK.json和RERUN-RESULT.json为准；没有这些实际回执时，不能声称重跑成功或数据已补齐。
