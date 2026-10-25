# Astra 实现与验证交接

三运行文件已冻结，未提交／执行生产。显式 v4 重算完整工具迁移闭包资格，产生 targeted-first-adoption；默认 v3 与旧 v2/v3 full/reuse/not-required 不变。

原 maintenance:235 允许 matching requests drain、drainedStopped、应用和 Worker 停止的维护状态；:270 保留部署与 ACL 检查。原 :1181 仅 RequireCurrentDeployment 才要求备份软件等于当前部署／配置，RestoreRehearsal:1687 不传该开关，旧前备份可由新已安装原工具消费；其软件字段、摘要和归档核验不减弱。只有 Backup 尾部执行 retention，Restore 不执行。本次固定只读消费者调用新 installed 原 planner，不能将规划成功描述为清理已执行。

Restore 对同点 manifest/dump/content 的相等核验是隔离恢复忠实性，不是自然生产写入前后相等。v4 额外核 backupId；原 profile、sequence、productionDatabaseTouched=false、serviceStateChanged=false、isolated_data_removed 全保留。新消费者确认实际 head/chain 后写入 WAL 有限输出。

## 隔离结果

新 targeted31 与相关原101共132/132，34.660秒；ESLint、syntax、diff 检查通过。覆盖新旧政策、删增／重排、重算摘要篡改、库存漂移、旧/prepared operator、同点真实参数展开、固定消费者原函数及 head/chain/shape 错误、unknown 保留与禁止后续恢复／启动／重放。

原 runApprovedOperation 在底层 native transport 受控 JSON 接缝中执行，沿用真实 Unicode 参数编码；没有 pg_dump、pg_restore、PostgreSQL、生产 HTTP 或生命周期。测试不冒称真实恢复演练或现场新消费者已通过。

首21中7项 fixture 加载漏去 export；修 fixture 后21/21。首相关117/131，14 freshness VM 少新协议常量；仅补上下文、原断言不变后131/131。再增加 backupId 与有限消费者 WAL 输出后最终132/132。原失败日志保留，不累加轮次，不归因为生产缺陷。

## 冻结

证据根 E:/codex-artifacts/release-first-adoption-targeted-20261011；ASTRA_TARGETED_HANDOFF.json SHA `5a9d5d3523490d75f65dda595cf776f246179118585a5fe9499f17c5af5c0ef8`；三文件零上下文补丁 SHA `7d611e793583f5cb4feef072ce138492254e0db8ac5768d15092cf5dced8979e`。

基于 main030024，新 worktree 独立开发；补丁已应用到旧58cc实际来源 adoption-source-v3 并检查三文件语法。完整十文件源码由主任务组合／构建／封存。Worker verifier/rotation 未改，D85cf 是否复用仍须对3c18/ec525和完整准备回执／库存核验。

主任务负责外置guard、独立AGY、Git与新精确候选。旧65fc、各旧guard、58cc/D85cf和AB109均保留；新实际生产维护、切换、备份演练另行精确批准。


后续实际受限候选197项发现零上下文移植的语句错位，原开发132项不代表该候选通过。旧受限677与7d611直接移植结果已停止采用；开发核心本身不改。详见[LIMITED_TRANSPLANT_CORRECTION](LIMITED_TRANSPLANT_CORRECTION.md)及新V2精确冻结交接。
