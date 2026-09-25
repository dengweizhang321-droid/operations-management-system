# 市场 v2 五 Agent 逐轮费用预留：下一切片合同

本文件描述**未启用**的下一切片。现有 0065 行仅是报价需求：`reserved_cents=0` 为数据库 CHECK，`providerCallsAllowed=false`。通用 Agent 的 `business_market_v2_paid_gate.before_reservation` 继续拒绝全部市场任务，即使独立运行开关被打开。本切片不调用模型、不安装迁移、不生成付费许可。

## 已有能力与新增纯合同

- `market_model_cost_envelope.reserve` 已将五角色、每轮最大输入/输出 token 和 CNY 单价按整数向上取整，算出五角色最坏成本；它不证明费率、汇率或人工批准。
- 0065 已将这个需求与当前模型配置和执行计划绑定，持久记录但强制预留为零。不能修改 0065 行以补齐授权，也不能将一个 SHA 摘要视作批准。
- 新增 `business_market_v2_round_reservation_contract` 从完整 0065 候选重新计费，输出稳定的 `(plan, ledger, role, round)` 槽位 ID 与精确请求绑定的意图摘要。相同槽位换请求会产生不同意图；报价本身仍为 0 元预留和 `providerCallsAllowed=false`。
- 纯状态合同仅允许 `quoted_unreserved → reserved_awaiting_dispatch → dispatch_outcome_unknown → result_observed_unverified`。后续 `result_verified_closed` 只能由未来受保护的数据库验真路径写入，纯状态函数无法生成；同一角色须此前一轮已验证关闭才能进入下一轮。`dispatch_outcome_unknown` 无自动重试边；即使看到模型结果，纯投影仍保留整轮上界，不凭未经认证的 usage 释放费用。纯投影只供设计/测试，不能用调用者传入的条目决定准入。

## 后续独立 SQL 迁移的必备设计（迁移号待整合主线确定）

1. **费率权威记录**：独立、仅受保护采纳入口可写的不可变行，绑定 `provider_id/model_id/model_version`、具体来源标识和采集时间、原币种、输入/输出及所有收费类别、CNY 换算依据/生效区间、完整报价摘要。未知类别或收费工具存在时不采纳。来源摘要及调用者 JSON 不是权威本身。与当前 `ai_models` 配置版本、状态和能力核对，过期即拒绝。严禁存放密钥/令牌。
2. **人工上限记录**：仅受保护的人审路径采纳明确的报告 ID、计划 ID、模型、费率版本、CNY 分上限及批准人/时间/版本。不能从 0065 的 `approvedCapClaimCents` 和 `approvalDigest` 推断批准。账号或报告版本变化、撤销、预算期过期都拒绝新预留。
3. **费用账本与轮次表**：新表不要改变 0065 恒零行。每轮唯一 `(plan_id, role, round)` 和稳定槽位 ID；保存 0065 行 ID/摘要、请求摘要、最坏费用分、阶段、创建/派发/观察时间、不可变事件序号。预算根行记录批准上限和已持有分。采用 `SELECT ... FOR UPDATE` 或原子条件 UPDATE 序列化同一计划的五个 Agent；在一个事务内核当前根/费率/批准/账号/模型，确认唯一槽位，核 `held + max_cost <= approved_cap`，写预留事件和关联的 provider dispatch 意图后提交。相同请求的精确重放只返回原回执，不再扣费；不同请求、不同模型/费率、跨报告或并发争槽失败。严禁单纯进程内锁或先查询后插入。
4. **派发边界**：付费 HTTP 请求只能在上述事务提交、并把 `dispatch_started` 持久化以后进行。网络超时、进程崩溃或不确定是否发送时，阶段维持 `dispatch_outcome_unknown`，不得自动重发同轮或改换请求重用该槽；需人工核服务商结算再决定补救。只有受保护且经过验证的服务商结果和结算证据能关闭该轮，释放差额须独立追加事件，不覆盖历史。
5. **角色与 ACL**：费率采纳、人审批准、预留/派发、只读回执分离成专用 NOLOGIN 角色；无成员、无继承、无表直接写权，函数仅授精确角色。`SECURITY DEFINER` 函数固定 `search_path=pg_catalog,public`，核 `session_user`、owner、角色属性/成员、计划和当前用户。行更新/删除/TRUNCATE 由数据库触发器拒绝，事件只追加。健康门禁核函数正文/owner/ACL、表/列 ACL、约束、索引、触发器绑定和角色漂移；备份恢复、空逆迁移和旧表/旧函数冻结需隔离 PostgreSQL 演练。
6. **调用前复核**：未来正向 paid gate 必须在每次 provider 派发事务中读取 SQL 拥有方回执，不能使用本模块的报价或调用者布尔值。工具调用若另外收费，必须先扩充费率类别和相同原子预留流程。单报告全部收费总额与人工上限以数据库整数分为准。

最小真实角色测试矩阵：两 Agent 并发争相同/不同槽、相同意图幂等重放、改请求冲突、累计超限、过期/撤销费率和批准、模型版本变更、跨店跨账号、直接 INSERT/UPDATE/DELETE/TRUNCATE、角色扩大、事务回滚、派发未知后重试、已观察但未认证 usage 不释放。测试只能用隔离数据库及合成费率；真实价格、用户上限和服务商调用需另行确认。正式服务迁移、付费调用和生产密钥均不属于本切片。
