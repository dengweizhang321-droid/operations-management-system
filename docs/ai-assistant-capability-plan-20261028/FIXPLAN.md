# AI 能力修复施工方案

日期：2026-10-29。基线为本机 main `1bc539c4`。本方案处理 [施工方案](PLAN.md) 第 17 节复核发现的问题，分两类：**清理类**（已实现但未启用或重复的代码）和**补齐类**（模型底层能力与外部动作层缺口）。

本文件只是施工方案。编写本方案不构成实施授权；每个工作包的开发、合并、制品准备、发布上线仍须按根 [AGENTS.md](../../AGENTS.md) 第 4 条分别取得当次明确授权。方案内所有拟新增文件、接口和字段均为设计命名，开发前与当时最新 main 核对。

## 1. 为什么先清理再补齐

清理类工作包（F1—F4）不新增能力，但降低后续每一次改动的成本：当前改注册表或 surface 要绕过 5694 行恒不可达的市场 v2 代码，加工具要判断该进两套 screening 的哪一套，动 `lib/ai` 要分辨某个读取器是现役还是第二套实现。补齐类（F5—F8）才是方案 PLAN.md 主线所需的前置能力。

清理与补齐可并行，但 F1 必须先于 F2。F3 经用户选定路线 B 后已由清理类转为补齐类，内含 M1—M6 六个阶段，是本方案中跨度最长的一包。各包独立交付，不要求打包成一次发布。

| 编号 | 工作包 | 类型 | 相对复杂度 | 依赖 |
| --- | --- | --- | --- | --- |
| F1 | 解开 `tests/ai-assistant.test.ts` 的跨目录文本绊线 | 清理 | 中 | 无 |
| F2 | 归档 `tests/legacy/` 与两个零引用读取器 | 清理 | 低 | F1 |
| F3 | 市场 v2 启用路线图（M1—M6） | 补齐 | 高 | 路线 B 已定；M1 先于市场 v2 运行态变更 |
| F4 | `ai_sandbox` surface 定性与收口 | 清理 | 低 | 需用户确认意图 |
| F5 | 结构化输出 / JSON Schema | 补齐 | 中 | 无 |
| F6 | 公开研究接入中央注册表 | 补齐 | 中 | 无 |
| F7 | 外部平台动作层（首个动作） | 补齐 | 高 | F5 建议先行 |
| F8 | 异常分诊层 | 补齐 | 中高 | F7 并行 |

## 2. F1：解开测试文本绊线

### 问题

`tests/ai-assistant.test.ts` 第 228 行起的测试 `"AI assistant routes, callbacks, knowledge, artifacts, UI, and migrations are wired"` 一次 `readFile` 28 个文件的源码文本做正则断言，其中混合三类对象：

- 现役文件：`app/ai-assistant-view.tsx`、`app/api/ai/chat/route.ts`、`lib/ai/bounded-fetch.ts` 等
- legacy 文件：`./legacy/ai/assistant-service.ts`、`question-workflow.ts`、`data-knowledge.ts`、`artifacts.ts`、`tool-audit.ts`
- D1 时代迁移：`drizzle/0014_ai_channel_callbacks.sql` 等 7 个 `.sql`

同文件第 14 至 19 行另有真实 `import`，从 `lib/ai/channel-callbacks` 导入 `createDingTalkSignature`、`createWeComSignature`、`verifyDingTalkSignature`、`verifyWeComSignature` 并断言签名行为。

因此 PLAN.md 第 17.3 节"`entry-context.ts` 与 `channel-callbacks.ts` 的唯一调用方在 legacy 目录内"的表述不准确：现役测试同时依赖这两个文件，`channel-callbacks` 是被真实调用并断言行为，不只是被读取文本。本方案按核实后的事实施工。

`package.json` 第 34 行 `test:unit` 为 `node --import tsx --test tests/*.test.ts`，单层通配，`tests/legacy/` 下文件不作为测试直接运行，只作为被 import 的模块和被 readFile 的文本存在。

### 为什么这是绊线

该测试把「功能是否接线」表达为「源码文本是否匹配某正则」。这类断言与实现文本耦合，重命名变量或调整 JSX 即可失败，且失败信息不指向真实缺陷。它同时是 F2 的硬阻碍：删除 legacy 目录会使 5 处 `readFile` 直接抛错。

### 施工动作

1. 把该测试按断言对象拆分。针对现役文件的断言保留，但改为面向行为或导出接口，不再匹配实现文本；无法改为行为断言且价值低的文本断言（如 `assert.match(page, /新增模型配置/)` 这类界面文案）移除，界面文案由前端自身负责。
2. 针对 legacy 文件和 `drizzle/*.sql` 的 `readFile` 与断言整体移除。这些对象已被 Django 实现取代，对其源码文本的断言不证明现役行为。
3. `channel-callbacks` 的 4 个签名函数断言**保留且不改动**。该文件是 Worker 侧现役代码，虽然生产回调链的验签在 Django 侧 [channels.py](../../backend/ai_assistant/channels.py) 第 222 行完成，但保留 Worker 侧实现与其测试不造成歧义，删除它属于 F2 之外的独立决策，本包不做。
4. `entry-context.ts` 的处置移交 F2。

### 检查与边界

只运行受影响测试文件及其直接依赖的既有检查，确认拆分后断言数量、覆盖对象和通过状态；不新增功能测试，不借本包修复仓库既有的其他测试问题。本包不删除任何 `lib/ai` 或 `tests/legacy/` 文件，只改 `tests/ai-assistant.test.ts` 自身。

按记忆中既有教训：改测试前先记录当前失败基线，拆分后逐条比对，不把既有失败计为本次引入，也不把本次引入的失败归入既有基线。

## 3. F2：归档 legacy 与零引用读取器

依赖 F1 完成。

### 范围

`tests/legacy/` 下 46 个文件，为 D1 时代 AI 实现的全量副本，`git log --oneline -- tests/legacy/ai` 仅一条提交 `d04a57f2 refactor(ai): move full assistant domain to Django PostgreSQL`。含 15 个 `tests/legacy/ai/*.ts` 与 30 个 `tests/legacy/app/api/ai/**/route.ts`，另有 `tests/legacy/auth/authorization.ts` 与 `tests/legacy/integration-catalog-projection.ts`。`tests/legacy/ai/analysis-sandbox.ts` 第 7 行仍 `import type { D1Database } from "@/lib/database/d1"`。

同时处置两个零引用读取器：

| 文件 | 处置 | 依据 |
| --- | --- | --- |
| [business-promotion-screening-tools.ts](../../lib/ai/business-promotion-screening-tools.ts) | 删除 | `readBusinessPromotionKeywordSkuV1` 全仓仅定义处一处命中，无测试、无生产调用方 |
| [business-market-observation.ts](../../lib/ai/business-market-observation.ts) | 删除，连同 `tests/business-market-observation.test.ts` | `readBusinessMarketObservationV2` 仅被该测试引用，生产侧零引用 |
| [entry-context.ts](../../lib/ai/entry-context.ts) | 待定，见下 | F1 移除其文本断言后需重新确认是否还有引用方 |

两个读取器对应的后端端点均在用，但走另一条路：`/api/ai/reports/{id}/promotion-keyword-sku` 由 `views.py:439-441` 分派给 `business_promotion_runtime_tools`，`/api/ai/reports/{id}/market-observation` 由 `views.py:445-447` 分派给 `business_market_observation_runtime_tools`。注册表中实际在用的 `get_business_promotion_keyword_sku_v1`（[tool-registry.ts](../../lib/ai/tool-registry.ts) 第 391 行）handler 指向 `business-promotion-dispatch-tools.ts:53`。删除这两个文件不影响任何现役路径；保留它们会让后续改动有一半概率改错一侧。

### 施工动作

1. 删除 `tests/legacy/` 整个目录。
2. 删除上表标注删除的文件及其专属测试。
3. `entry-context.ts`：F1 完成后重新 grep。若仍无任何引用方则删除；若现役测试或代码仍需要，保留并在本包报告中说明保留原因，不强行删除。
4. 核对仓库是否存在针对该目录的禁止导入规则或路径白名单（提交 `63e77515 fix(market): legacy 标注实现移出 tests/ 并加禁止导入规则` 表明这类规则存在），删除目录后同步清理已失效的规则条目，避免留下指向不存在路径的配置。
5. 核对 `config/integration-migration-policy-v3.json` 与 `config/integration-migration-policy-v4-netshop-presence.json` 中的文件 SHA256 清单是否含被删文件。这两份清单是完整性清单而非调用方，但留下指向不存在文件的条目会使后续完整性校验失败，须在同一包内同步。

### 边界

不动 `drizzle/` 目录本身（115 个文件，含非 AI 域迁移，其退役边界属于[数据存储与迁移](../规范/数据存储与迁移.md)，不在本方案范围）。不动 `lib/ai/channel-callbacks.ts`。删除前按 Git 完整差异确认无其他引用，不依赖本方案的清单。

## 4. F3：市场 v2 启用路线图

用户已于 2026-10-29 选定路线 B：市场 v2 仍在计划内。本节替换原决策待定内容，给出启用路线图。方案成立不等于已获实施授权，每阶段仍须单独取得当次授权。

### 4.1 必须先纠正的一个认识

**启用市场 v2 不能靠改环境变量。** `0053_business_market_v2_admitted_paused.py` 第 246 至 300 行的四个触发器函数（`ai_market_v2_admitted_job_guard`、`node_guard`、`tool_guard`、`result_guard`）按 `executionProfile` 等于 `business-agent-screening-promotion-market-admitted-v2` 或工具名等于 `get_business_promotion_market_v2` **无条件 RAISE EXCEPTION**，不读取任何 Django 设置。因此：

- 打开 `AI_MARKET_V2_AGENT_RUNTIME_ENABLED` 只会让工具目录出现该条目，实际派发仍被数据库拒绝
- 解除拒绝必须通过**新 migration 替换触发器函数**，使其改为按受保护条件放行而非无条件拒绝
- 这是结构变更，须按[数据存储与迁移](../规范/数据存储与迁移.md)与[验证与发布](../规范/验证与发布.md)走完整迁移、备份、恢复演练与发布流程

同理，`0065` 成本表的 `reserved_cents` 存在恒为 0 的数据库约束（见[付费前门禁](../技术专题/AI经营分析/市场数据/business-market-v2-paid-preflight.md)），即使打开 `AI_MARKET_V2_PAID_RUNTIME_ENABLED`，缺少持久原子预留仍会拒绝。付费能力本身要先建，不是开关问题。

### 4.2 门控现状的完整事实

实测全仓共 18 个 AI 门控经 `getattr(settings, ..., False)` 读取，[settings.py](../../backend/teruisi_backend/settings.py) 只声明 3 个（第 200 至 210 行，均 default False），**其余 15 个在任何环境变量下恒为 False**，仅测试 `override_settings` 可开。

| 门控 | settings.py | 读取方 |
| --- | --- | --- |
| `AI_MARKET_V2_PREVIEW_ENABLED` | 已声明 | `views.py`、`django-route.ts` |
| `AI_MARKET_V2_AGENT_RUNTIME_ENABLED` | 已声明 | `views.py`、`django-edge.ts`、`tool-registry.ts` |
| `AI_MARKET_V2_PAID_RUNTIME_ENABLED` | 已声明 | `business_market_v2_paid_gate.py` |
| `AI_MARKET_V2_HUMAN_CAP_ENABLED` | 未声明 | `business_market_v2_human_cap_owner.py`、`django-route.ts` |
| `AI_MARKET_V2_COST_CANDIDATE_ENABLED` | 未声明 | `business_market_v2_cost_admission.py` |
| `AI_MARKET_V2_EXECUTION_PLAN_ENABLED` | 未声明 | `business_market_v2_execution_plan.py` |
| `AI_MARKET_V2_READ_PLAN_V6_ENABLED` | 未声明 | `business_market_v2_read_plan_v6.py` |
| `AI_MARKET_V2_READ_ADMISSION_V5_ENABLED` | 未声明 | `business_market_v2_read_admission_v5.py` |
| `AI_MARKET_V2_OWNED_RESULT_ENABLED` | 未声明 | `business_market_v2_owned_result.py` |
| `AI_MARKET_V2_MODEL_TRANSPORT_OWNER_ENABLED` | 未声明 | `business_market_v2_model_transport_owner.py` |
| `AI_MARKET_V2_TOOL_OBSERVATION_V6_ENABLED` | 未声明 | `business_market_v2_tool_observation_v6.py` |
| `AI_MARKET_V2_SYNTHETIC_ENABLED` | 未声明 | `business_market_v2_active_synthetic.py` |
| `AI_MARKET_V6_PAUSED_TOPOLOGY_PREPARE_ENABLED` | 未声明 | `business_market_v6_paused_topology_owner.py` |
| `AI_MARKET_V6_PAUSED_TOPOLOGY_RECORD_ENABLED` | 未声明 | `business_market_v6_paused_topology_persistence.py` |
| `AI_MARKET_V6_SOURCE_TICKET_REPLAY_ENABLED` | 未声明 | `business_market_v6_source_ticket_replay.py` |
| `AI_PROMOTION_AGENT_RUNTIME_ENABLED` | 未声明 | `views.py`、`workflows.py`、`business_reports.py`、`business_evidence.py`、`business_promotion_activation.py`、`business_promotion_runtime_permission.py` |
| `AI_PROMOTION_BUDGET_V10_DOWNLOAD_ENABLED` | 未声明 | `business_promotion_budget_v10_download.py` |
| `AI_PROMOTION_BUDGET_V11_STAGE_CANDIDATE_ENABLED` | 未声明 | `business_files.py`、`business_promotion_budget_v11_durable_stage.py`、`business_promotion_budget_v11_slim_stage_candidate.py` |

### 4.3 一个比市场 v2 更靠主干的发现

`AI_PROMOTION_AGENT_RUNTIME_ENABLED` 被 6 个模块读取，其中 `views.py` 第 499 行使 `analysisMode` 为 `screening-promotion-v1` 的报告创建直接返回 409「词货五角色分析尚未启用」。**即推广五角色分析整条链同样处于停放状态**，而市场 v2 的五工具目录正挂在推广 v1 的 surface 旁边。

这意味着启用顺序不是"先市场 v2"：推广 v1 链是市场 v2 的上游语境。本路线图把它列为阶段 M1，先于市场 v2 的任何运行态变更。该门控的启用范围、是否只开部分角色、以及它与既有[词货 v1 四工具](../技术专题/AI经营分析/市场数据/ai-business-market-v2-five-tool-catalog.md)目录的关系，需在 M1 内单独确认。

### 4.4 已完成的部分不重做

以下能力已有源码与隔离验证材料，路线图复用而不重建。[市场数据专题](../技术专题/AI经营分析/市场数据/)下共 25 份文档记录了逐切片进展：

| 已有 | 性质 |
| --- | --- |
| 0044 停放 profile、0053 已准入停放报告与流程 | 结构已采用，触发器与不可变守卫在位 |
| 0061 context proof、0062 `ai_market_v2_read_claim` | 已读链的证明结构已定义 |
| 0063 执行计划、0064 合成纵向链、0065 成本账本 | 隔离测试库内已建，`externalProviderCalled=false`、`reserved_cents` 恒 0 |
| 0069 逐轮预留彩排、0072 来源与人工上限提案 | 隔离无外部调用，提案待核 |
| 0074 人工上限审批、0077 v6 停放拓扑 | 结构已采用，门控未声明 |
| `business_market_v2_read_admission_v5` 只读准入诊断 | 已实现，始终返回 `agentReadPersisted=false` |

[0073 前置阻断合同](../技术专题/AI经营分析/市场数据/business-market-v2-read-bridge-0073-blocker.md)已列出真实正例的五项前置条件，本路线图的阶段划分沿用该合同，不另立标准。

### 4.5 启用阶段

每阶段独立交付、独立授权。任一阶段未达成即维持其后阶段关闭，不跳阶。阶段内编号以实施时最新 main 为准（当前 migration 已至 `0087`，新增从 `0088` 起，不预占）。

| 阶段 | 目标与完成形态 | 关键约束 |
| --- | --- | --- |
| M1 推广 v1 链启用 | 声明 `AI_PROMOTION_AGENT_RUNTIME_ENABLED` 及 env 读取点，确认 `screening-promotion-v1` 五角色链的角色范围、权限与既有 v1 四工具目录关系；解除 `views.py` 第 499 行的 409 | 市场 v2 的任何运行态变更都不在本阶段；推广 v1 启用不自动开放市场工具 |
| M2 门控声明补齐 | 为 M3 及以后实际需要的门控在 settings.py 补声明与 env 读取点，逐个说明用途与默认值 | 只补本路线图阶段真正要用的；不为"将来可能用"批量声明。补声明不等于打开，默认仍 False |
| M3 付费与成本能力 | 实现持久原子预留替换 `reserved_cents` 恒 0 约束；来源费率、汇率、人工上限按 0072 提案独立通过；逐轮预留与未知结果处理验收 | 这是 0073 合同第 4 条。无付费许可不得进入真实 provider 调用，也不得制造替代 provider 响应 |
| M4 拥有方真实读取 | 现有 owning 工具完成对应模式的来源回放，工具结果携带报告、角色、selector/manifest/context、页或行与完整结果摘要；独立 NOLOGIN attestor 写同 job 回执 | 0073 合同第 3 条。通用 `succeeded` 行与自报 `auditStatus=recorded` 不足以证明 owning 读取 |
| M5 新 profile 与触发器替换 | 以新 profile 建新报告/流程/任务，来源根由 SQL 重验；新 migration 替换 0053 四个触发器函数，改为按受保护条件放行 | 0073 合同第 1、2 条。旧 0060/0061/0062/0064 行、ACL 与 paused 守卫保持不变；`syntheticOnly`、`dry_run`、`externalProviderCalled=false` 或未知调用状态一律拒绝 |
| M6 数值引用与发布 | 同任务精确行/字段二次拥有方复算与独立持久单元格证明 | 0073 合同第 5 条。在独立门禁验收前，`numericCitationAllowed` 与发布权限保持 false |

### 4.6 本包先交付什么

路线图确认后，F3 的第一个交付仍是材料而非代码：一份启用前置清单，逐个模块列出有无生产调用方、门控名称与声明状态、关联表与 migration 编号、在 M1 至 M6 中的归属阶段，以及该模块当前是否已有隔离验证材料。该清单用于确认阶段划分无遗漏模块，不改代码。

此后按 M1 起逐阶段施工。每阶段须有隔离 PostgreSQL 升级与恢复演练，不在生产直接试；真实 provider 调用在 M3 通过前一律不执行。

### 4.7 本阶段明确不做

不因启用市场 v2 而放宽任意 SQL、任意 HTTP 写或正式账号浏览器自动化。不把合成占位行翻译为"模型本人已读"。不删除任何历史证据行或既有 paused 守卫。`business_market_v2_active_synthetic` 等合成链模块在 M5 之后仍只用于隔离验证，不进入生产运行态。

## 5. F4：`ai_sandbox` surface 定性

### 现状

`ai_sandbox` 注册在白名单但全仓零 setter：[tool-registry-contract.ts](../../lib/ai/tool-registry-contract.ts) 第 19 行列入 `aiToolSurfaces`，[django-edge.ts](../../lib/ai/django-edge.ts) 第 63 行放行，[tool-registry.ts](../../lib/ai/tool-registry.ts) 第 120 行一组工具的 `allowedSurfaces` 含它，但没有任何代码把执行上下文的 `surface` 设为 `"ai_sandbox"`。对照其他 surface 的 setter 数量：`business_collection` 20 处、`ai_chat` 4 处、`pi_business` 4 处、`pi_agent` 3 处、`ai_sandbox` 0 处，仅测试构造。`/api/ai/sandbox` 前端亦无 fetch 调用方，而后端实现仍在用（`views.py:593-594` 与 `:730-731`）。

### 需要用户确认的问题

这组工具经 `ai_sandbox` 永久不可达。两种可能：

- **漏接前端**：原设计中沙箱页面应以该 surface 调用这组工具，前端入口未实现。则动作是补前端入口并确认权限路径。
- **设计已变**：沙箱改由 `ai_chat` 等既有 surface 承载，`ai_sandbox` 是残留声明。则动作是从 `aiToolSurfaces`、`django-edge.ts` 放行列表和 `allowedSurfaces` 中摘除，并确认 `/api/ai/sandbox` 路由是否仍需保留。

两者改动量都小，但方向相反，不能由施工方自行判断。本包先交付现状说明，待用户确认后执行。摘除 surface 需同步注册表变更测试（[安全与 AI 工具](../规范/安全与AI工具.md)要求每次注册表变更测试名称唯一性、schema 一致、角色与 scope 过滤、surface 与风险限制）。

## 6. F5：结构化输出 / JSON Schema

### 问题与收益

[provider.py](../../backend/ai_assistant/provider.py) 与 [model_capabilities.py](../../backend/ai_assistant/model_capabilities.py) 全文无 `response_format`、`json_schema`、`strict`。模型返回的结构靠文本约定和事后解析，自动化链路上这是可靠性缺口：PLAN.md 的 P1 要从报告提炼参数化 Skill、P2 要让定时任务消费模型输出，两者都需要模型输出可被程序可靠解析。

这是本方案里改动最集中、收益最直接的一项，建议排在补齐类第一位。

### 为什么可以低成本做

`model_capabilities.py` 第 41 行已有成熟的参数能力协商机制，当前处理 `default`、`thinking`、`reasoning_effort`、`anthropic_budget`、`anthropic_adaptive` 五种推理格式，并在第 51 至 59 行校验参数间的互斥关系。结构化输出是同构的第六类参数：OpenAI 兼容端点用 `response_format: {type: "json_schema", json_schema: {...}}`，Anthropic 侧用工具定义上的 `strict: true` 配合 `additionalProperties: false`。复用既有协商与校验骨架即可，不需要新抽象。

### 施工动作

1. `model_capabilities.py` 增加结构化输出能力声明与参数格式选项，沿用现有 `choice()` 校验与互斥规则。供应商不支持所选格式时明确报错，不自动降级、不改参数重发可能计费的请求（沿用该文件现有约定）。
2. `provider.py` 按协商结果组装对应供应商字段。两种协议分别处理，不以域名或"兼容 OpenAI"推断能力。
3. 管理界面增加该项配置，范围与行为按[模型生成能力配置](../使用手册/AI助手/ai-model-generation-capabilities.md)的既有表格形式登记。实际支持仍须管理员按所用端点文档确认，系统不做付费探测。
4. 结果解析失败按失败关闭处理，不把解析失败的输出当部分成功使用。

### 边界

本包只做 provider 层能力与配置，不改任何业务调用方的提示词或输出约定。哪些业务链路改用结构化输出是后续独立决定，不在本包。不新增模型调用做能力探测。

## 7. F6：公开研究接入中央注册表

### 现状

[pi_research.py](../../backend/ai_assistant/pi_research.py) 已有完整实现：第 315 行 Bing RSS 搜索、公网 GET 读取、第 50 至 92 行的公网单播 IP 校验与敏感参数名检查、DNS 与超时边界。但 `lib/ai` 下无 `search_public_sources`、`read_public_source` 或任何引用它的注册条目，**模型工具目录中不存在该能力**，只能由用户在工作区手填引用结果。

PLAN.md 把这项放在 P3-03，判断偏晚：推广诊断和选品都需要外部信息（规则变更、竞品动态、平台政策），而读取器已经写好、外发校验齐全，缺的只是注册条目与来源代理。

### 施工动作

沿用 PLAN.md 第 10 节的 broker 设计，该设计本身是对的，本包只是把它提前：

1. 中央注册表增加 `search_public_sources` 与 `read_public_source` 两个只读条目，按[安全与 AI 工具](../规范/安全与AI工具.md)要求补齐稳定名称、精确描述、`additionalProperties: false` 的 schema、允许角色、`scopePolicy`、`risk`、annotations、有界执行策略和 handler。
2. 实现来源 broker：模型只能传 broker 持有的 `sourceId` 或用户明确批准 URL 的引用 ID，**不接受模型自行构造或改写的 URL**（不可改写 host、path、query）。服务端按引用 ID 还原真实地址，重新核验归属与研究范围。
3. 保留 `pi_research.py` 现有的 DNS 公网校验、逐跳重定向检查、SSRF 限制、固定超时与字节上限、无 Cookie 机制。请求不携带聊天历史、文件正文、账号身份、私人记忆或经营数字。
4. 返回结构化来源信息：`sourceId`、实际 URL、标题、获取时间、内容摘要、可用正文、截断状态。界面按 `sourceId` 解析为来源卡，禁止模型自行拼装下载 URL。

### 诚实表述要求

当前搜索后端是 Bing RSS，覆盖有限。不得把前若干条搜索结果表述为全网完整覆盖；网页正文读取失败、动态内容、付费墙和时间不可知须分别说明。外部文字只作资料，不触发权限升级、密钥访问或工具安装。

### 边界

本包不启用任何定时或自动的外发搜索。模型自主研究只在用户明确发起或本轮启用后、且在服务端研究范围内进行；超范围先给出具体外发预览由用户决定。不为浏览动态网页给数据容器联网。

## 8. F7：外部平台动作层

这是"全自动电商工作流"终局的必经环节，也是本方案工程量最大、风险最高的一包。

### 现状必须说清

[pi_business.py](../../backend/ai_assistant/pi_business.py) 第 16 行当前四个意图 `work_plan.create`、`replenishment_draft.create`、`n8n_gap.run`、`report.deliver` 全是系统内部写入与投递。实测对外写入通道：

- 京东、天猫侧**零写入通道**。`lib/jd/` 下只有推广诊断的只读实现，且 [promotion-diagnostic-interpret.ts](../../lib/jd/promotion-diagnostic-interpret.ts) 第 106 行与第 149 行明确禁止模型建议自动停投或调价，第 149 行还有正则拦截这类表述
- 对外 `POST`/`PUT` 仅存在于 `lib/jackyun/`（导出任务创建等 ERP 侧操作），不是平台运营动作

因此外部平台 writer 是**从零新建**，不是"接一个现成 API"。PLAN.md 第 12 节把它表述为"外部平台先核账号类型和真实 API 授权，缺能力保持待接入"低估了这一点。

### 首个动作的选择

建议从**调推广预算**起步，理由：可逆（改回原值即恢复）、影响面可量化（预算数字本身就是影响上限）、有现成数据支撑（推广诊断已提供归因 ROI 与对象证据）。

不建议作为首个动作：改价（影响成交与比价，回滚不能撤销已发生订单）、下采购单（涉及供应商与资金，错误代价高）、回客服消息（直接面向客户，不可撤回）。

### 先定契约，再接平台

本包的第一个交付不是能改预算的代码，而是外部平台动作契约。契约至少覆盖：

| 契约项 | 要求 |
| --- | --- |
| 意图与预览 | 沿用 `pi_business.py` 现有意图模式：模型只能 prepare，不能直接执行；预览展示精确对象、原值、新值、影响范围 |
| 确认 | 范围内自动执行须有事前明确的预授权记录（限定动作类型、参数允许区间、对象范围、有效期）；超界形成具体差异重新确认 |
| 幂等键 | 稳定业务键，不含时间戳或重试计数；同键重复提交返回原回执 |
| 唯一执行者 | 一个动作对象只有一个登记的 executor owner，不与既有 n8n 或钉钉调度重叠 |
| 领域回执 | 以平台返回的精确回执为准；受理不等于生效 |
| 结果未知 | 已发出的平台写入结果未知时**不自动重放**，保留 unknown 与原动作身份 |
| 回滚边界 | 明确哪些可程序回滚、哪些只能人工处理；已发生的外部作用不伪称撤回 |
| 对账 | 动作后按平台实际状态复核，与预期不一致时告警而非重试 |

### 施工顺序

1. 交付契约文档与 schema 设计，取得用户对契约的确认（此步不写业务代码）
2. 核实目标平台的真实 API 授权范围与账号类型。这一步可能发现能力不存在，须如实报告"待接入"而非绕路实现
3. 实现单个动作的 prepare、预览、确认、执行、回执、对账全链路，默认关闭
4. 在隔离环境验证全部异常分支（含结果未知、权限撤销、预授权过期）
5. 按逐步授权要求分别取得合并、制品、发布授权；首次启用须用户明确指定对象范围与有效期

### 边界

本包不开放任意 HTTP 写、任意 SQL 或正式账号浏览器自动化。模型不获得平台凭据。F5 的结构化输出建议先行，使动作参数可被 schema 强约束。

## 9. F8：异常分诊层

### 问题

PLAN.md 对异常状态的定义是完整的（`waiting_data`、`unknown` 不重放、权限收窄即阻止派发），但**没有任何一条说明异常之后由谁处置**。当前 11 个 n8n 流程共用一个 errorWorkflow 发钉钉提醒，依赖人工查看。走向自动化后，异常数量与种类都会上升，人工兜底不可持续。

### 施工动作

定义分诊规则，每类异常明确归属与动作：

| 异常类别 | 判定依据 | 处置 |
| --- | --- | --- |
| 可自动重试 | 幂等且结果已知为未发生（如数据源 5xx、连接超时且无派发回执） | 有界重试，次数与间隔固定，耗尽后转通知 |
| 可降级执行 | 部分数据缺失但不影响核心结论（如某仓库覆盖不全） | 降级产出并在结果中标注缺口与影响范围，不静默省略 |
| 必须停止并通知 | 结果未知、权限撤销、授权过期、平台回执矛盾、业务写入部分成功 | 停止后续派发，保留原回执与 unknown，通知指定对象 |
| 等待而非失败 | 数据未就绪且在窗口内 | 保持 `waiting_data`，过窗记 missed/expired，不补发旧报告 |

关键约束：分诊只决定"下一步做什么"，不改写原状态。`unknown` 不因分诊变成 failed 或 succeeded；已发生的外部作用不因分诊被撤销。分诊规则本身要有版本，变更不影响在途运行。

### 边界

本包不引入新的执行器。分诊在既有 Pi operation 与 dispatch 账本上做判定，复用现有通知链（钉钉投递）。不新建第二套告警系统，不与现有 errorWorkflow 重复触发同一通知。

## 10. 不在本方案范围

以下项在第 17 节中提及，但本方案不处理：

- **embedding 与向量检索**：先按 PLAN.md P3-05 第一步做全量分页词法索引即可消除"只看最新候选"的覆盖缺口，向量作为后续可选增强，须另定来源、费用与权限
- **prompt caching**：只影响成本不影响能力，且 AI 助理主链与市场标注链（[model-gateway.ts](../../lib/ai/model-gateway.ts)，仅被 `lib/market/annotation-model.ts` 引用）的 provider 实现不同，需分别评估
- **视觉与大附件**：按 PLAN.md P3-01/P3-02 由真实案例需求触发，当前 `MAX_INPUT_FILE` 512 KiB 的放宽涉及分片存储全链路
- **Responses 协议**：PLAN.md P3-06，纯协议增量，非任何闭环前置
- **两套 screening 工具合并**：功能重复但两套均可达且在用（由 [workflows.py](../../backend/ai_assistant/workflows.py) 第 216 至 218 行按 `execution_profile` 分岔），合并涉及 surface 与 profile 语义变更，须单独评估，不随清理包处理
- **27 个仅测试引用的后端模块与多代并存**：含 budget v10/v11 五代、v4 系列 5 个 `_owning`/`candidate`/`replay`、`business_promotion_views.py`、`mapping` 与 `mapping-v2` 双路由。它们不像 F2 的 legacy 目录有明确取代关系，逐个需判断是停放候选还是废弃，建议随 F3 的启用前置清单一并出材料后再决定：其中 budget v10/v11 与 `business_promotion_views.py` 可能属于 F3 阶段 M1 的推广 v1 链语境，需在该清单内一并归位
- **PLAN.md 自身的合并**：方案文档当前只在分支 `codex/ai-assistant-capability-plan-20261028`，main 上无此路径，合并仍需单独授权

## 11. 施工与授权约定

每个工作包在独立 `codex/*` 分支与 worktree 开发，从当时最新 main 创建。F4 需用户先确认意图，其余包可在取得开发授权后直接实施。F3 路线已定，但其 M1 至 M6 六个阶段各自独立授权，不得以本路线图获准为由跨阶段推进；涉及触发器替换与真实付费调用的阶段尤其如此。

每包完成后按根 [AGENTS.md](../../AGENTS.md) 第 4 条报告变更范围与就绪情况，再分别取得合并、制品准备、发布上线三步的当次授权。AI 只检查影响构建、部署与启动的必需代码；功能是否符合需求由用户上线后自行检测。F1 涉及测试改动，须保留改动前的失败基线以区分既有问题与本次引入。

本方案不承诺工期与收益比例，不表示其中任何建议已获采纳，也不表示当前生产已具备所列任何缺失能力。
