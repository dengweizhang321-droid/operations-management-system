# W7 独立反审

- 日期：2026-11-07；当前结论：**通过，W7-R1 已闭合，无剩余阻断**。首轮 1 项 P1 及失败证据保留如下，增量复核见文末。
- 审查者：独立上下文 `astra_w7`，未参与实现；按用户本任务特例请求 `gpt-6-astra / high`，工具未独立确认实际型号。
- 基线：`0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。仅审 W7 增量与直接依赖，不纳入同树 Pi/Chat 改动。
- 已读共享记忆启动入口及相关记录、根 AGENTS、任务模型分工、开发与交付、业务口径、安全与 AI 工具、验证与发布适用章节及原方案 W7；核验本树与本地 main 对应规范无差异。

## 冻结范围

| 文件 | 已核 Git blob |
| --- | --- |
| backend/ai_assistant/report_library.py | 77e5f27a57378827288600974a64a7eacf407f95 |
| lib/netshop/ai-tool.ts | b4d20f3d539c73c5b844b58aae6647d90ef4ba23 |
| lib/ai/tool-registry.ts | 433ae7677aebbd3545595b21f72ddef98daff2a2 |
| tests/netshop-product-insights-ai-tool.test.ts | c45d1d6fc59f1f0c2a86a47483ebb13a9229ce2e |
| backend/ai_assistant/test_shop_conversion_guidance.py（未跟踪） | f7f472c0a3b50e356ad271cbb5bc26bb6468a6dd |

## 首轮阻断 W7-R1（现已闭合）：页面工具仍丢失转化率所依赖的字段完整性

**触发条件：** 模型通过本次更新说明的 `get_netshop_page_data`、`view=performance` 获取商品表现；日期完整，但成交客户数或访客字段缺失。后端现行聚合可保留数值占位和数值转化率，同时依赖 availability 明确标注缺字段。

**位置：** 本次差异 `lib/ai/tool-registry.ts:1360` 规定“取字段和覆盖均完整的服务端 conversionRate”；其实际 handler 指向 `lib/ai/page-data-tools.ts:1092` 的行投影和 `:1160` 的汇总投影，两处保留数值却分别丢弃 `fieldAvailability`、`summaryFieldAvailability`。后端 `backend/netshop/query.py:610`、`:650`、`:786`、`:880`、`:881` 证明数值与完整性是配套契约。

**已复现影响：** 合成源提供 visitors=20、transactionQuantity=8、transactionCustomers=0、conversionRate=0，并明确 transactionCustomers.complete=false / reasonCode=missing_field。调用真实 `getNetshopProductPerformancePageData`、仅覆写取数服务后，汇总与行仍返回 conversionRate=0，两种 availability 均消失。完整日期也被保留，模型无法从工具结果分辨真实 0% 与客户数缺失，W7“缺字段明确不可计算”的直接边界未闭合。此为已有投影缺口在本次明确新增使用契约中的直接影响，不扩展为全库整改。

**建议：** 仅为这条页面表现投影补齐有界的权威完整性标识（汇总与行），或按权威标识将不可用转化率投影为明确不可用并保留原因；避免另算指标或改经营事实。补一条覆盖真实零、缺客户字段、缺访客字段和零分母的合成投影用例，然后回本上下文增量复审。

**独立复现证据：** `D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w7-review-page-boundary.txt`，退出码 0，输出 `status=reproduced`。未访问真实业务服务、数据库或模型。

## 已确认部分与证据边界

- `backend/netshop/query.py:602` 的现行权威汇总公式为成交客户数÷访客，零分母返回 null；`backend/netshop/product_insights.py:238` 的 conversion 同样使用 customers/visitors，并检查状态和分母。W7 没有改动事实表或计算公式。
- 普通 `get_netshop_performance` 新增透传 `summaryFieldAvailability`，原有行 availability、期间、累计口径与截断状态保留。
- 默认 `shop-diagnosis` 正文已纠偏；已存非零资源版本在新组装 guidance 时追加权威规则，不修改原 config/version/digest。直接核过 `chat.py:954/1045` 及 `reports.py:64/89` → `workflows.py:262` → `report_library.pin` 的调用路径。历史已钉住的父执行快照保持原行为，不以本次代码修改冒称已回写旧任务或生产资源。
- 已直接阅读实施者原始 Worker 日志（43/43）与 Django 日志（1/1）及对应测试代码。现有样本验证件数 8、客户数 2、访客 20 得 0.1，并覆盖普通工具 availability 透传；这些通过不能覆盖页面工具投影缺口。
- 没有一般建议；未进行真实模型验证，本次不以真实模型或生产整链作为额外通过条件。

未修改被审源码，未提交、合并、打包、上线或操作生产。原执行者修复后仅复核上述阻断及直接影响。

## 2026-11-07 增量复核：通过

- 原五个文件 blob 均未变；新增冻结 `lib/ai/page-data-tools.ts` = `6db9446e98d1501a155fe1e1c3339c1e64788576`，`tests/ai-page-data-tools.test.ts` = `a9353d7641df274c976d4329689d3576ba1158b0`。
- 新 helper 仅投影成交客户数与访客数的 `complete`、`reasonCode`；汇总和每条明细均接入。原始指标数值、权限、筛选、页数上限及日期覆盖处理不变，没有另算转化率。
- 独立重放首轮同一缺客户字段合成样本，原 conversionRate=0 保持，汇总和行完整性均正确保留 `complete=false / missing_field`，模型可按本次权威指导区分缺数与真实零。另核源 availability 不存在时输出空标志对象，没有提升为完整。
- 已直接读取增量测试与原日志：58/58 通过；新增真实处理器合成用例覆盖真实零、缺客户字段、缺访客字段、零分母及额外字段不泄漏。`git diff --check` 对两新增文件通过。没有重跑全仓或真实模型/生产流程。
- 独立闭合证据：`D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w7-review-page-boundary-incremental.txt`，退出码 0、`status=closed`。首轮 `w7-review-page-boundary.txt` 保留。
- **W7-R1 闭合，W7 本轮独立审查通过；无新增阻断或一般建议。** 此结论只覆盖已冻结 W7 增量与直接影响，不替代整体集成检查或合并/上线授权。
