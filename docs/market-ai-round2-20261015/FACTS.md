# 当前事实核验

2026-10-15，Asia/Shanghai。本机替代来源：运营MCP工具不可用，按用户明确指定目标使用公开只读市场API和现有市场最低权限reader的REPEATABLE READ READ ONLY事务。原回执表reader无SELECT，单独以现有writer身份执行receipt-only READ ONLY事务，没有扩权限/生产写入。

02:55:03冻结数据库快照：目标任务running，总8558，完成4082、失败80、reviewed0、committed0；明细claimed9、queued4387、failed80、review_pending4082。公开02:52进度曾显示活动12、配置12、新模型3492、历史复用47、最近一分钟190。两者时间不同，不混算。最新失败提示image_fetch；固定653历史模型样本不是本轮金标。

原26个保护身份全部仍failed、attempt_count=3、无lease；自原恢复提交时间以后无新身份审计。21个原封顶项updated_at仍原时刻，5个旧过期领取更新时间是02:30:23.126331，与原隔离动作一致；没有重置/重放。

运行Worker进程回执release `20261014T170130Z-17e3867852424323`、manifest `9272ee20a5d718b1cf6a1f13f32383a8ba31ab6a45cd3262243cbb3cdf7d0f25`；Django appFingerprint `abeaee20a07a991e4a725c1cfb633efe6a673eb45153ede332056bc4f3ad3c14`，sourceRoot仍第一轮86fa发布源。后续制品准备会基于实际运行源组合本轮差异，避免顺带采用main其他未上线内容。

原恢复请求精确回执现已核实：requestId `a3fdedf8-3a55-4434-8083-871f9ce6d478`，body SHA `972844e3c2211db7a1071a6e76f684a7da739042579e049b85b69b7af0c4ec65`，created02:30:23.109904、completed02:30:53.288886，相隔30.178982秒，completed HTTP200，原jobId、state=running、resumeAccepted=true、quarantinedExpiredClaims=true。SDK默认传输期限30秒；浏览器操作期限110秒。原恢复audit02:30:53.277552。证据支持业务提交和传输30秒期限不一致，不能还原旧请求的获锁/查询/构造响应各阶段占比或直接归因为数据库锁。

Prompt与权威字典快照见[evidence/prompt-taxonomy-current.json](evidence/prompt-taxonomy-current.json)；具体冲突见[PROMPT_REVIEW.md](PROMPT_REVIEW.md)。私有只读原件`D:/codex-artifacts/market-ai-round2-20261015/{current-facts-private,resume-receipt-private}.json`，不复制凭据或原客户数据入仓。
