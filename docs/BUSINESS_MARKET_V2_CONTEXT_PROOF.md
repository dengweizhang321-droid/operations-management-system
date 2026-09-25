# 市场 v2 context 独立证明（0061 候选）

0060 的暂停执行档案保存 `marketContextDigest`，但当时数据库只验证其 SHA 形状。0061 新增 SQL-owned 不可变 `ai_business_market_v2_context_proofs`，由独立 `teruisi_ai_market_context_attestor`（NOLOGIN、无成员关系、无表权限）经 `ai_market_v2_attest_context(reportId)` 创建。该函数不接收客户端 context 或摘要：数据库从 0045 材料固定的原词货 v1 报告，取 `reportId`、封存证据 `runId`、`screeningIntent.id`、`sealedDigest`，按固定键序和无空格 JSON 字节重算 SHA-256。只有计算值与新 0060 档案的 `marketContextDigest` 一致，且 0053 准入、0044 停放、0045 材料、账号、selector、manifest、原报告和 0060 paused 流程均仍精确匹配，才写入证明。重放只接受同一 SQL 计算结果。

reader 只能通过 `ai_market_v2_context_receipt(reportId,ownerEmail,actorVersion)` 获得窄回执；函数重新计算并比对已保存证明、当前无范围管理员和账号版本。reader、writer、attestor 对证明表都没有直接 SELECT 或 DML；writer 无回执函数权限。回执表示 context 根已被独立证明，`agentReadPersisted=false`、`executionReady=false`；它不是同 job/provider 的市场页读取记录，不开放 Agent 节点、模型、工具结果、数值引用或文件发布。

迁移依赖 `ai_assistant.0060`；先单独完成 0059→0060 全链演练及目标 PG，再验证 0061。新增表使 AI 清单从 81 变 82；旧 0057、0058、0059、0060 升级脚本须使用各自冻结的 81 表清单。纯合同测试目标 `ai_assistant.test_business_market_v2_context_contract`；隔离 PostgreSQL 目标 `ai_assistant.test_business_market_v2_context_proof`（预置真实 reader/writer 角色），覆盖 SQL 推导、独立 attestor、窄读、跨账号、伪造 SHA、表和函数 ACL。尚未运行 PG 或部署生产。
