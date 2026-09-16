# 多 Agent 深度经营分析：分阶段实施

## 目标与阶段

经用户确认，按以下顺序开发。目标是按经营问题分析、诊断、规划并交付 HTML/XLSX，参考报告只是质量样本，不固定店铺、章节或工作表数量。

| 阶段 | 范围 | 放行条件 |
| --- | --- | --- |
| 一：数据与计算基础 | 来源、身份、粒度、覆盖、同比环比、完整分页、确定性计算、共享证据结构；及早核验市场/B 端历史可用性 | 来源金额与分组核对；缺失和映射歧义明确；店铺销售/推广关联与跨源证据具备实测依据 |
| 二：最小多 Agent 闭环 | 协调、店铺商品、推广搜索、独立复核；有界并发、持久共享证据、局部失败；基础双文件 | 至少两个专业 Agent 与独立复核真实协作；两个店铺、两个周期；冲突与失败用例；完整授权明细可取得 |
| 三：完整诊断与规划 | 市场、B 端、店铺销售/利润及全部维度；原因下钻、预算情景、近期/中期计划 | 每条建议有对象、证据、动作、前提、指标、观察期及回退条件；有数据/缺失分别验收 |
| 四：工程级文件与规模 | HTML 搜索/筛选/排序/分页/图表/导出；XLSX 格式、公式、情景、分片；交互与视觉检查 | 两格式同源同数，参数可复算，完整明细不截断，接近参考报告规模验收 |
| 五：工作台与正式验收 | 自然语言入口、进度、取消/恢复、证据追问、版本、成本和并发限制 | 多店、多周期、多问题真实端到端；权限变化、重复提交和模型未知结果安全处理；受控采用 |

阶段开发不代表每阶段必须生产发布。第二阶段的试用闭环不等于最终需求完成。正式启停、迁移与采用仍走现有维护流程。

## 当前交付边界

**已完成阶段一的前三批候选代码，不是阶段一整体或五阶段完成；尚未合入 main 或生产采用。用户已要求持续开发至五阶段完成，后续批次无需再次确认开发意图。**

第四批已接通阶段二的专业 Agent 队列和结构化诊断复核基础；文件交付、工作台、市场与店铺来源、真实模型及多店多周期业务验收继续开发，不能标记阶段二完成。

已实现：

- 网店 owning reader 的精确平台/店铺规范明细端点，Worker 薄转发、中央 AI 工具、权限与既有审计链。
- 京东推广、SKU、原生 SPU、B2B、主数据；天猫推广、原生 SPU、主数据的现有规范事实适配。适配器存在不证明正式数据已导入或原始 B2B 文件口径已经验收。
- 本期、前一等长期间、去年同期夹闰日；人民币分、缺失 `null`、零/负基期状态、比率百分点。
- 连续签名游标、页摘要、来源版本、完整行数与控制金额核对；数据变化拒绝拼页。
- 流式分组、按汇总分子分母计算比率、跨店隔离、原生 SPU 与 SKU 身份分离、商家编码歧义不扇出销售事实。
- 可复用的 `PageReconciler`、`VerifiedAnalysis` 结构化核对结果。
- 第二批补齐 ERP 正向、退款、净销售、成本及数量规范页；平台/店铺/渠道精确隔离，ERP 网店规格编码与网店当前主数据精确关联，歧义和未匹配金额单独保留。
- 第二批补齐持久证据任务、不可改写的来源分块、版本检查点、取消/封存、所属用户权限和只读 AI 证据工具；来源读取、页核验、持久化及写审计形成可恢复的受控路径。
- 第三批提供统一分析表协议：从封存证据生成店铺、品类、SPU、SKU、关键词、搜索词、逐日分组，稳定行引用及同口径同比/环比；完整重验后分页返回。后续 Agent 和双文件共同使用该结构，不由模型各自计算。

阶段一仍需完成：

1. 店铺自身总览及跨源指标口径对齐；商品日访客不能代替店铺去重 UV。ERP 适配器与合成对账通过不等于正式店铺业务对账完成。
2. 扩充跨域只读来源清单，验收真实身份映射覆盖，建立统一的诊断、建议和双文件报告结果协议；现有持久证据协议仅记录原始规范页及核对结果。
3. 市场区间销量及 TOP 榜样本边界、正式 B 端来源、去年同期历史的实数覆盖验收；没有记录时同时核验真实店铺枚举和源覆盖，不能直接断言没有经营活动。
4. 正式规模的只读查询计划与容量验证。十万行合成计算验证不代表正式数据库查询性能通过。

后续阶段保持上表完整范围，不能用提高聊天字数或放宽沙箱行数替代这些工作。

## 数据接口与口径

`GET /api/netshop/analysis-records`

参数：`platform`、`shop`、`dataset`、`startDate`、`endDate`，可选 `window=current|previous|yearAgo`、`limit`、`cursor`。日期输入含首尾，数据库谓词使用左闭右开区间。窗口 1—93 天，后端每页 1—100 行；不同源/平台组合不支持时返回 422。禁止重复/未知参数。

仅无范围限制管理员可用；普通用户和有范围限制的管理员均拒绝。端点仅注册在 netshop reader（开发环境兼容路由除外），没有 writer 路由、SQL 输入、文件路径输入或任意代码执行。

AI 工具 `get_netshop_analysis_records` 在中央注册，单页最多 20 行、默认 10 行，单请求最多 8 次；超过 38,000 字符拒绝返回并要求减小页长从头读取，避免通用工具结果裁剪损坏核对链。未接入钉钉自动调用。单请求限额内无法读完时必须披露未完成，不能当作全量诊断。后续大数据执行器应直接使用受控分块服务，不把全部明细塞入模型上下文。

首页返回 `control`（完整行数、已有 typed 指标总额）、`coverage`、`availableDates`；每页都有 `sourceRef`、`sourceRevision`、`pageEvidence` 和 `pagination`。依次将未改写的页面交给 `VerifiedAnalysis.consume(page, request_cursor=...)`，仅在 `result()` 成功后发布该分组结果。

- 游标绑定参数、页长、网店 revision 和主数据批次，1 小时有效；版本变化/过期须重启该来源收集，不能混合旧页。
- 页内读前读后核对 revision。这是单来源版本围栏，**不是跨领域数据库快照**。第二批保存各来源版本、水位和采集时刻；自动持续执行、跨源更新决策属于后续工作。
- `dates_present` 只说明每天有记录，不说明平台已结算；缺日不能补零。
- 京东 `reportedGmvCents` 是平台总订单归因金额；天猫是源净成交口径；两者均不是 ERP 净销售或利润。归因窗口未验证时标记 unknown。
- 订单行不保证跨商品去重，商品×日访客不能当店铺 UV；部分缺失的分子/分母不计算比率。
- 主数据仅用最新已完成、带快照日期的批次。即使查询去年同期，也明确是当前快照，不冒充历史身份映射。
- 商品名、关键词、搜索词等来源文本只作为数据，不能充当 Agent 指令。
- 累计数值超出 JavaScript 无损整数范围时失败；内存分组最多 25,000 组，超限拒绝结果，不截断。超大词×商品组合的持久分区尚未实现。

## 第二批：ERP 与持久共享证据

ERP 通过既有 sales owning reader 的签名 consumer 操作 `analysis_records` 读取，AI 中央工具为 `get_sales_analysis_records`。参数为精确 `platform/shop/channel`、`startDate/endDate`，以及可选 `window/limit/cursor`；窗口、分页、摘要及金额单位沿用前述规范。后端每页最多 100 行，AI 工具每页最多 20 行、默认 10 行，单请求最多 8 次。没有客户、订单号或任意 SQL 输出。

ERP 日期为发货业务日 `business_date`。正向销售与退款按分摊金额符号拆分，净销售保留配件及补差价，排除刷刷仓；数量遵守原 `is_net_quantity_row` 投影。成本保留源符号，计算毛利为净销售减成本，不扣费用；源报告毛利、费用和排除配件的销售额另列。没有数据时返回精确平台/店铺的有界历史渠道枚举供核验，不自动换渠道，也不把空结果解释为零经营。

商品关联只用 ERP `online_spec_code` 对网店当前主数据 `merchantCode`，不回退到 ERP `product_code`。唯一 SKU/SPU 配对才计入匹配组；重复编码对应多个商品时不扇出金额，未匹配和歧义金额仍参加源总额核对。当前主数据不能证明历史映射；该结果不能证明推广归因成交等于 ERP 销售，更不能用于虚构关键词利润。

证据任务接口均走现有 AI reader/writer、实时权限及审计链：

| 接口 | 行为 |
| --- | --- |
| `POST /api/ai/business-evidence` | `clientRequestId` 与最多 12 个固定来源，重复标识只允许同一计划 |
| `GET /api/ai/business-evidence/{id}` | 计划、来源进度、水位、版本、核对结果 |
| `POST /api/ai/business-evidence/{id}/collect` | `sourceKey/expectedVersion`，每次读取并提交一页 |
| `POST /api/ai/business-evidence/{id}/finish` | `expectedVersion/action`，`seal` 须全部完整；`cancel` 保留已有证据 |
| `GET /api/ai/business-evidence/{id}/chunks/{sourceKey}?sequence=1` | 单块规范页与摘要 |
| `GET /api/ai/business-evidence/{id}/mapping?sales=源键&master=源键` | 仅对封存证据重验全页并作商品关联 |
| `GET /api/ai/business-evidence/{id}/analysis?sourceKey=源键&dimension=shop` | 统一分析表，支持 `baselineKey`、`offset`、`limit` |

来源格式为 `{key, domain: sales|netshop, query}`。query 只接受固定身份、数据集/渠道、日期及比较窗口，不接受调用方提供的事实页面。中央只读工具 `get_business_analysis_evidence` 可读取本人任务摘要或单块，未接入钉钉。不同专业 Agent 未来可在同一发起人权限下引用相同证据；本批没有自动派发 Agent、付费推理或报告生成。

取数在 AI 写锁外执行，提交时重新核对身份、状态和版本。分块、检查点、写回执及审计同事务提交；取消后的迟到结果或审计失败不会留下新分块。中断后可从已提交检查点继续逐页请求，但游标过期或源 revision 变化须重新创建收集任务；不得把旧页和新页拼接封存。封存仅表示来源完整核对，`modelAnalysisCompleted` 仍为 false，不表示诊断复核通过。

当前有界容量：每人最多 4 个未完成任务；每任务最多 2,000 页、64 MiB，每人累计 256 MiB，全局累计 2 GiB 和 10,000 个任务；每页固定请求 10 行。商品关联每个来源最多 5,000 行、输出最多 1.5 MB。达到上限明确失败并保留检查点，绝不截断后声明完成。尚无历史证据清理或大型分区执行能力，不能据此宣称达到参考报告规模。

新增 AI 迁移 `0014_business_evidence`，自有表从 56 张增至 58 张。分块只增不改，任务身份和计划不可改，封存/取消后为终态；数据库触发器、最小 reader/writer grants、健康检查、历史备份清单及恢复校验同步维护。本批未迁移正式数据库。

## 第三批：统一分析表

`business-result-table-v1` 保存来源核对摘要、筛选/日期、每组值与缺失数、加权比率、比较结果及稳定行 ID。`dimension` 限 `shop/category/spu/sku/keyword/searchTerm/daily`；`baselineKey` 仅接受同来源、同店铺、同原始查询日期的 `previous/yearAgo`，不将不同业务口径作增长比较。日表禁止直接按日期字符串匹配跨期。

当前或基期不存在的分组不补零；缺日或字段缺失不计算增长率；零/负基期保留差额并标记状态。CTR/转化率变化为百分点，CPC 和 ROAS 不误用百分点。空维度单列并标记，商品访客不冒充店铺去重 UV。一个表只表达所选来源，未混加推广成交、ERP 净销售和 B2B 金额。

服务端只从本人封存证据重算，逐块核验摘要和完整控制汇总，不重新查询业务源或调用模型；每次 API 返回最多 100 组，中央工具 `get_business_analysis_table` 默认 10、最多 20 组。沿 `offset/limit` 可读取完整组表，读取一页不能声称全量分析。大型跨源分区和导出仍属后续工作。

第三批验证：隔离 PostgreSQL 27 项通过，中央工具 7 项通过，构建及修改的 TypeScript lint 通过。首次 API 测试把查询串错误地签入 path，改为已有支持独立 query 签名的测试工厂后通过；没有放宽身份或签名校验。日志为 `.runtime/ai-pg-0556957c8f0c/tests.log`、`.runtime/batch3-tools-final.log`、`.runtime/batch3-build.log`、`.runtime/batch3-lint.log`。

## 第四批：证据绑定的专业分析队列

`POST /api/ai/business-reports` 接受 `clientRequestId/evidenceRunId/question/dryRun`，只从本人已封存、具有相同原始比较区间的证据创建报告；问题最多 1000 字。复用既有报告表和持久 DAG，不新增迁移。生成三类专业分析（店铺商品、推广搜索、市场/B端），随后独立 Agent 复核、整合报告、人工确认；现有同一 DAG 仍串行运行，尚未扩展到专业节点并行。

这类子任务向模型只提供共享证据和分析表两个工具，执行前再限制 `runId` 必须是本次封存任务；中央工具桥仍校验完整目录摘要。普通 Agent 保持原能力。当前权限、模型版本、调用预算、租约、取消、回执和未知结果不重发沿用既有队列。专业结果及整合正文设置字节上限，避免依赖交接超出 24 KiB；完整数值明细通过证据交接，不复制进模型文字。

`business-diagnosis-v1` 区分观察、假设、动作、缺口。结构化引用必须指定来源、维度、行位置、稳定行 ID、指标及值类型，服务端重新计算并解析真实数值，不接受模型自报的数值替代。每份最多 12 条结论、32 个引用；调整动作必须含对象、具体改动、前提、责任角色、预算影响、观察期、衡量指标及回退条件。引用核验不能证明自由文字及因果解释正确，仍须独立和人工复核。

独立复核有冲突或任一专业/复核 Agent 没有成功的共享证据读取回执时，不能批准正式报告。草稿与阶段结果保留；模型未知结果不得自动重放。当前文件下载对新报告显式拒绝，待后续专用构建器接通，避免把旧 2000 行静态导出冒充完整交付。现有模板报告行为保留。

第四批验证：AI 域与纯计算隔离 PostgreSQL 共 263 项（261 通过、2 跳过），后续针对引用、精度与动作字段的复测通过；构建和后端边界通过。类型检查仍为 153 条既有诊断，与第二批基线无新增差异。端到端队列演练实际经过五个独立 Agent job、十次模拟 provider 派发、五个持久工具回执和人工复核，未调用真实模型；这不是真实分析效果验收。日志见 `.runtime/ai-pg-b8bc1cb6c55f/tests.log`、`.runtime/ai-pg-426da1da527a/tests.log`、`.runtime/batch4-build.log`、`.runtime/batch4-typecheck.log`。

## 验证方式

在独立 worktree 中运行：

```powershell
& '.runtime\test-venv\Scripts\python.exe' -X utf8 tools/ai-postgres-rehearsal.py --tests-only --test-label business_analysis --test-label netshop --port 55485
& '.runtime\test-venv\Scripts\python.exe' -X utf8 tools/ai-postgres-rehearsal.py --tests-only --test-label ai_assistant --test-label business_analysis --test-label sales.tests.test_analysis --test-label sales.tests.test_consumers_api --test-label netshop --port 55485
& '.runtime\test-venv\Scripts\python.exe' -X utf8 tools/ai-postgres-rehearsal.py --tests-only --business-evidence-upgrade --port 55485
node --import tsx --test tests/business-analysis-tools.test.ts tests/django-netshop-service.test.ts
node --import tsx --test tests/django-postgres-maintenance.test.ts tests/django-sales-consumer-reader.test.ts
npm run build
npm run test:unit
node tools/check-django-production-boundary.mjs
```

PostgreSQL 启动器使用独立随机目录、凭据、数据库与 55440—55999 端口，禁止在正式检出运行。新增 `--test-label` 只能用于 `--tests-only`，不能缩减迁移升级演练的验证范围。测试中的 B2B、金额和店铺均为合成数据。

首批无数据库模型或迁移，验证见 `docs/evidence/ai-business-analysis-foundation-candidate.json`。第二批包含迁移与权限变更的候选源码，已在隔离 PostgreSQL 演练升级、旧 56 表行摘要不变、真实角色权限、终态保护和独立 dump/restore；验证见 `docs/evidence/ai-business-analysis-evidence-candidate.json`。两批均未重启生产、调用付费模型、创建真实报告或发送通知。
