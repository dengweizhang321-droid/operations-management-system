# 京东物流9851精确闭合与完整重跑

日期：2026-10-17。用户明确选择“重跑京东 POP 工作流”，授权实际下载和导入。本任务使用当前已上线版本，不部署候选登录优化或预打包制品，不更改数据口径或启用缺货通知。

## 原失败与方案

9851为08:00定时执行，首个flow在业务surface识别时以JD_LOGISTICS_LOGIN_REQUIRED失败；后续三源planned，无export/receipt，精确下载目录为空。原错误不改成success，旧计划/文件不交给新执行。新流程必须从A创建fresh计划。

原生append-only日志seq241/242将9851全过程夹在8a54的有效head区间；原8a54与当前1cb四文件helper树及exporter源逐字节相同。原错误唯一定义在businessSurface，先于flow导出及其baseline/submitting写入。当前helper PID、出生身份与当前release单独绑定，不以当前进程冒充原运行进程。

现有9542/9556工具限定manual、inactive、初次零批次，不能直接套用。新增独立且CLI仅固定9851的operator，复用既有双锁、普通文件身份、限长读取、精确GET、create-only及同卷不可覆盖移动；不放宽旧入口。允许已有历史批次和非零revision，但锁内前后完整分页、每个精确批次currentSelection、settings、来源配置、Profile及原失败均须保持冻结摘要。

恢复先通过官方n8n UI短暂停用同一发布版本，核验原图/时区/定时、非终态execution为零、helper空闲无drain及端口关闭。在pipeline→全局Chromium双锁下保存intent/原件、复验、归档active，再多次复验后create-only提交committed。任一步未知均保留原intent和停用状态，不自动重试、不在finally恢复调度。

停用只禁止生产定时，不能阻止编辑器manual。本任务独占该工作流的手动入口，闭合前不发起新执行；新execution、版本或业务状态变化均停止。archive后无committed不得仅凭active消失恢复计划或执行A。独立现场核验committed及原件/业务状态后，才恢复原196ba版本，再发起一轮完整manual。

## 验证与保全

14项隔离测试通过：非零revision及历史批次、inspect零写入、一次不可覆盖归档、版本/原执行/并发变化拒绝、空目录门槛、分页和currentSelection缺失、helper/端口/PID变化、原生激活区间、原树额外文件/依赖目录、intent及archive后中断、临近移动的新执行、提交前原件变更，以及仅允许全库存根revision变化、固定部门2/4政策证明。严格TypeScript及三文件ESLint通过，Git空白检查通过。

独立审查复现原helper树额外第五成员未被拒绝的准入漏验，已补完整成员集合精确比较及反例。原调用命令字符串的显示层转义疑点已排除，最终仍使用明确的Windows路径构造。规划请求Astra High，审查请求Sol XHigh；工具未独立返回实际型号。审查及生产现场回执保存在 `D:/codex-artifacts/jd-logistics-rerun-9851-20261017/`。

官方取消发布前，已通过node:sqlite一致性备份保全整个n8n元数据，私有备份位于原用户`.n8n/backups/jd-logistics-9851-20261017`，回读确认原active版本196ba完整存在；原数据库不写。摘要回执为包外N8N-BACKUP.json，数据库及凭据不进入Git/报告/记忆。TARGET-v2及BASELINE-v2固定本次运行证据与八个历史批次及精确当前选择，旧捕获也保留。

## 实际执行状态

官方UI已短暂停用同一工作流，回读active=false、version196ba保留。前两次只读inspect分别被全库存域根revision推进、旧部门policyHash与当前版本差异拦住；原active与failed manifest未动，未产生闭合intent。经源码与原始基线核对后，仅从settings摘要剔除全库存根revision，其他原始字段完全冻结；部门revision在08:00后、基线捕获前已从2推进4。固定原2/当前4，只在深复制的内存settings中改目标部门4→2即可精确重建旧四源policyHash及所有selection字段，复原后副本须与当前settings全同；不修改实际配置、不放宽正式assertPolicy。该精确闭合证明经独立decision确认；不能据此断言2→4两次历史变更必然只是展示设置。后续新A使用实际当前4。

修正后真实INSPECT-v3/v4取得eligible_intent。独立预检在共享helper被天猫占用时正确返回WAIT，等待其自然结束后于上海11:08:25取得新鲜PASS。原operator单次apply在11:09:17.924取得committed；原active归档至`outputs/jd-logistics-pipeline/login-9851-18ffecdf11972a5a/active.archived.json`，原9851的error、execution data和failed manifest字节保持，八个历史批次及精确currentSelection不变。独立后置核验PASS，回执为包外CLOSURE-RESULT.json、POSTCHECK.json。

闭合之后另一天猫任务取得共享helper，不将它误记为闭合unknown。按独立decision和复核确认，恢复原196ba发布版本与原图、上海08:00计划后，仅从原manual→coordination/claim入口创建一次9896；未绕开等待直接调用A。9896于11:12:52.715开始，先按原Wait等待5分钟，随后原子claim获准，创建fresh run `jdl-794e9ecf-03e1-4189-bd88-8f3af6f95cc2`，不使用9851的计划或文件。POSTCHECK-INTERPRETATION.json区分health空闲快照与新execution实际admission，唯有claim granted才能进入A。

## 本轮重跑结果：失败，未导入业务数据

9896于11:18:46.970以error结束。前三来源完成新的下载及纯文件校验，第四来源库存快照在导出前报`JD_LOGISTICS_SOURCE_COUNT_UNSTABLE`。

| 来源 | 新文件验证行数 | 终态 |
| --- | --- | --- |
| 库存流水 | 352 | validated，未导入 |
| 启用店铺商品 | 906 | validated，未导入 |
| 实时库存 | 427 | validated，未导入 |
| T-1库存快照 | 尚未取得文件 | exporting阶段失败，目录为空、无export-manifest |

该错误定位到`stableSourceRows`：30轮、每轮等待200ms，要求页面总条数与本次响应总数一致，且完整筛选回读hash与准备时一致，连续两次成立。名义等待预算6秒，另含采样读取耗时；原失败未记录每轮具体count或scopeHash，因此不能判定哪一项变化，也不能单独归因为京东响应慢。

四文件屏障阻止所有导入，四项receipt均不存在，C/D未执行，n8n失败释放节点返回released。执行者和独立审查者分别重新解析三份原文件，核对原始/内容SHA、数量及export-manifest；八个历史列表及每个精确批次currentSelection与重跑前摘要完全相同。本轮新增业务导入0、通知0；京东浏览器9224及两锁已释放。当前helper再被其他天猫任务领取，与9896释放成功分开判断。

当前原196ba、每天08:00/AsiaShanghai仍active，9896 failed active、三文件及原失败证据继续保留，防止盲目重发；不能套用仅为9851准备的闭合工具处理9896。本轮没有修复或部署快照稳定性代码，也未再次执行/闭合9896。登录优化候选尚未由本任务上线，实际重跑使用既有1cb版本。

最终机器结果为包外RERUN-RESULT.json及RERUN-REVIEW.json；后者PASS仅表示失败取证可信，其workflowStatus明确为error，不表示工作流成功或数据已补齐。n8n结果页与截图分别为`http://localhost:5678/workflow/JdLogisticsDaily2026/executions/9896`和包外n8n-9896-error.png。
