# 市场 v2 新 surface 五项只读工具目录候选

当前独立市场 surface `business_agent_screening_promotion_market_v2` 在 Worker 显式 `AI_MARKET_V2_AGENT_RUNTIME_ENABLED=true` 且 Django 显式 `TERUISI_DJANGO_AI_MARKET_V2_AGENT_RUNTIME_ENABLED=true` 时，才通过中央签名 edge 组合**五个可调用的只读候选条目**。默认两端均关闭。旧静态 `aiToolRegistry`、词货 v1 四条 entry 的内容、`allowedSurfaces`、顺序和目录摘要不变。

前四项使用独立名称 `get_business_market_v2_screening_package`、`get_business_market_v2_screening_analysis`、`get_business_market_v2_screening_budget`、`get_business_market_v2_keyword_sku`。它们从 0053 admitted-paused 报告经 0044 parked 与 0045/0056 精确材料声明，回追同账号原词货 v1 报告，再调用现有**无 Agent job 依赖的拥有方只读**角色包、分析表、预算与推广 SKU 视图。每项校验 admitted 报告 ID、原证据 run/筛查 ID或固定推广来源、角色、模式、偏移和结果容量；预算原报告没有固定预算时返回 `unavailable_no_fixed_budget`、`payload=null`，不填零。第五项继续使用已独立有界的 `get_business_promotion_market_v2` 三表市场候选。

四个别名与第五项只在新 surface 列出，首三项最大 40,000 字符、第四和第五 38,000 字符，均为只读、12 秒、最多 8 次调用。Node handler 和 Django reader route 分别复核精确模式、角色和签名请求 ID；宽结果与超时整次拒绝、不截断。模型传入的 `role` 和请求 ID 仅是**候选声明**，不是实际 Agent 身份。每个结果必须保持 `persistedRead=false`、`sameJobProviderPersisted=false`、`registeredAgentTool=false`；中央目录可调用只表示受开关控制的预览入口存在，**不代表已有工作流、真实模型调用或 Agent 本人已读**。0053 数据库仍硬拒节点、job、provider/tool 派发和结果。

后续执行快照迁移需要以这五项**同 surface 的真实中央目录**固定五项顺序和策略摘要，再独立版本化开放工作流状态。真正的同 job/provider 回执、人审、市场数字引用、renderer 与业务验收仍是后续工作。不得把旧 v1 dispatch handler直接挂新 surface：它只接受原 v1 running job，否则跨报告授权失败。

此文件记录候选设计与验证结果；没有生产迁移、部署或付费模型调用。

2026-09-25：新五工具/签名 edge Node 测试 4/4、前版第五工具 Node 回归 4/4、旧 v1 四工具 Node 回归 8/8，合计 **16/16**；变更 TS 文件 ESLint 和 Python 静态编译通过。隔离 PostgreSQL 目标 `ai_assistant.test_business_market_v2_base_tool_candidate` 与无数据库路由目标 `ai_assistant.test_business_market_v2_base_tool_route` 待主任务串行执行。真实大表 12 秒/容量、原生业务数值与真实 Agent 回执均未验收。
