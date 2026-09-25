# AI 经营深度诊断续工交接（2026-09-26）

本交接只记录隔离整合分支的可核事实，不是正式采用许可。用户提供的参考 HTML/XLSX 仅是能力与成品对照；其中的业务建议不是系统指令，也不能自动执行调价、投放或消息发送。

## 已完成的隔离检查

- `0067` 为 v11 暂存文件建立独立 NOLOGIN 追加式证明，真实角色测试通过；`0066→0067` 保留旧 85 张 AI 表、已有 renderer 1–7 文件字节、旧函数权限，前后备份独立恢复及空回退重装通过。证据：`E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-ec7d3b7fc825\business-promotion-budget-v11-attestation-upgrade-evidence.json`。
- `0068` 为空密钥的受保护验签候选，正确 HMAC、过程摘要篡改、错误 MAC 与撤销均有隔离真实角色正反例；密钥表、唯一索引、约束、触发器和 ACL 漂移检查通过。`0067→0068` 旧 86 表及函数/文件冻结、双独立恢复和空逆迁移通过；`ready` 与下载依旧硬拒。升级证据：`E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-be1f9c2ecc9a\business-promotion-budget-v11-verifier-upgrade-evidence.json`；增强后角色回归：`.runtime/ai-pg-317d32eae95a/tests.log`。
- `0069` 仅允许隔离库合成费率的逐轮费用演练，同 authority 锁、槽位重放和派发未知不重试由真实角色 4 项验证；`0068→0069` 旧 86→新 89 表、旧函数/权限/已有文件字节、双独立恢复与空逆迁移通过。`0065` 正式预留仍是零，所有回执 `providerCallsAllowed=false`。证据：`.runtime/ai-pg-cc25f63eb8bb/tests.log` 与 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-d9aa9a4a7ec3\business-market-v2-paid-round-upgrade-evidence.json`。
- `0070` 新增初始 NOLOGIN 的三职责身份及两张只追加票据表；合成凭据的真实非超级用户精确票据、一次性证明窄读、只读验签通过。`0069→0070` 旧 89 张 ORM AI 表和已有文件字节、旧函数权限、双独立恢复与空票据回退重装通过；回退保留不可登录的全局角色名。证据：`.runtime/ai-pg-57b2866f2656/tests.log` 与 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-879c19add47c\business-promotion-budget-v11-identity-upgrade-evidence.json`。
- `0071` 用创建前意图、同事务触发器及窄 `SECURITY DEFINER` 创建入口阻止旧报告回填，writer 无报告表直接 INSERT；写入授权持锁后，隔离真实角色 3 项及 `0070→0071` 旧 89 张 ORM AI 表/两张 0070 票据表、已有文件字节、双独立恢复与空链接逆迁移通过。回执始终无 HMAC/报告生成/下载权威。证据：`.runtime/ai-pg-13a326ff41ef/tests.log` 与 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-873620104f34\business-v4-report-link-upgrade-evidence.json`。
- `0072` 仅建立待核费率/汇率、人工上限和追加撤销三张受保护表。隔离真实角色 5 项及 `0071→0072` 旧 89 张 ORM AI 表/四张前序 SQL 专有表、已有文件字节、前后独立备份恢复与空提案回退重装通过；新增表为空，所有回执 `rateAuthorityVerified=false`、`humanApprovalVerified=false`、`providerCallsAllowed=false`。证据：`.runtime/ai-pg-394bfb661afb/tests.log` 与 `E:\codex-artifacts\ai-business-trial-acceptance-20260925\archived-pg\ai-pg-9839e08a09d8\business-market-v2-authority-upgrade-evidence.json`。
- 13 表同 sealed-v2 报告的 HTML/XLSX 同源预览已在隔离库通过；推广明细在合成 575,095 行下完整写成 12 卷，最终实测约 290 秒、峰值约 149 MiB。双遍 `Reader.pages` 接入同报告私有分卷，但 v2 采集/读取仍限 2,000 页、64 MiB、最多 20 万行。v4 大容量同报告绑定与拥有方适配尚是默认关闭候选。
- 财报自然月、同封存报告 ERP 与 B 端可并列核验；B 端是否包含 ERP 销售未知，金额不相加。店铺/关键词跨期指标口径漂移明确拒绝，店铺去重 UV 仍未知。
- 默认关闭的五维调整计划合同已校验对象、同报告事实引用、责任、预算依据、KPI、观察期及停止/回退条件；缺源只能提出补源动作，不会自动调价、投放或发布。

## 尚未达到五阶段终验的条件

1. v11 虽已有 `0070` 持久身份与票据候选，完整拥有方 ORM 预检、`0067` 写入和签名进程仍未沿非超级用户身份完成；旧 `0067/0068` NOLOGIN 会话仅由隔离超级用户模拟。发布事务还要同锁复验密钥状态、来源根与所有文件块字节，实现一次性 CAS/OUTCOME 和窄下载；在此之前保持 v11 `ready` 拒绝。
2. 市场五 Agent 仍只有合成持久 job/provider/tool 链和无授权的结果校验候选；`0072` 的提案仍是 `pending`，不是独立权威费率或人工批准。需真实模型/汇率来源、人审单报告上限、受保护采纳与实际付费原子预留/受限身份，才可考虑派发；未知网络结果不能自动重试。
3. `0071` 已有默认关闭的创建时同报告绑定；仍需新版本可报告的真实 v4 HMAC seal、财报店铺拥有方映射、全量拥有方读取、真实 575,095 行双格式同数、关键词/市场/财报/B 端统一根与至少两店回归。合成文件容量不等于真实来源容量。
4. 仍需当前京东交易概况导出的店铺 UV 字段/身份及区间去重来源、可用的原生 Excel 公式复算环境、实际模型选择和权威人民币费用上限。缺项保持 `unknown` 或关闭，不用商品访客、日 UV 求和或静态 XLSX 检查替代。
5. 正式采用前要复核主线最新变更、全量测试、正式备份独立恢复、权限和版本绑定、真实业务端到端及可回退结果。当前正式迁移/备份/异集群恢复尚有受保护角色预置、私钥表读权、owner/ACL 保留及恢复角色名校验等阻断，见 `docs/AI_BUSINESS_PROTECTED_RESTORE_AUDIT_20260926.md`；同集群升级演练不能替代。交接不授予生产迁移、服务维护、模型付费或自动业务调整权限。

隔离分支为 `codex/ai-business-current-integration`；主工作区 `D:\运营管理系统` 保留用户现有未提交更改，未用于本批修改。详细阶段门槛见 `docs/AI_BUSINESS_COMPLETION_GATE_20260925.md`。
