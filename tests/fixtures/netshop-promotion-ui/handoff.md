# A UI Teammate 交接

状态：01 经营双栏正式候选组件已实现；总控私有 PostgreSQL 浏览器验证与独立最终复核由 Root 汇总。此记录不代表已合 main、生产来源验收或生产采用。

工作树：`D:\.codex\worktrees\netshop-promotion-ui\运营管理系统`；分支 `codex/netshop-promotion-ui`。起点 `9d4830ee50232b956bdb9c1c7dd5b30564805355`；通过普通 merge 继承 Root `7331185801ca46c7913ea9ceb9d610f5a5ed5d96`，未复制或改写 Root/公共文件。精确最终提交由后续回执给出。

作者文件仅 `app/netshop/promotion/**`、`tests/netshop-promotion-view.test.ts`，以及 Root 明确追加的 `tests/fixtures/netshop-promotion-ui/**`。没有子 Agent、子分支或其他作者工作树。

| 分区 | 实现与来源边界 |
| --- | --- |
| 5.1 概览 | 共享四态金额、ROI（内部 roas）、CTR/CPC、展现点击和来源订单定义；比较/差额由服务提供；主费率使用 paired-whole coverage，辅助 matchedRange 单列。 |
| 5.2 趋势 | 实际日/自然周/月数据；花费/归因、ROI、点击、CPC；日期只联动对象范围；差额贡献使用服务端可比集合与排除数，四榜最多十位。 |
| 5.3 多店 | 精确店铺列、花费/占比/归因/ROI/费率、比较及覆盖；单店收起重复区，无可核验店铺另标。 |
| 5.4 商品 | 跟单分摊与推广商品身份分别标注；消费 P 四元 productIdentity 焦点及实际匹配状态，焦点不改顶部统计；唯一可靠 mapping 才可 P 钻取，详情保持原整期趋势。 |
| 5.5 计划单元 | canQuery 与实际字段状态分开；只有原可靠明细资格才允许查询；真实 ID、店铺、关系、占比和变化由服务提供。 |
| 5.6 词 | 关键词/搜索词是原词文本与 plan/unit/match 的真实复合关系，不假称平台独立词 ID；缺身份不启详情，不造词或关系。 |
| 5.7 诊断报告 | 原 Panel 实际 import；原管理员/指定京东单店/1—7 日、同 kind owning revision；false paid + ROI alias；原紧邻前等长基期实际日期明确，不冒充本页环比/同比/新贡献导出；报告 invalidation 清整页旧结果。 |
| 5.8 来源归因 | 金额/订单/归因窗口、逐店日覆盖与完整向量；覆盖 ref 同时读取 sections.coverage/context.coverageBySource；已核来源缺席与平台真实零花费分开说明。 |

页面 callbacks 只通过 M2 context/history/期间/钻取/返回合同。q、页码、对象日期和商品焦点不在浏览器计算业务指标或重写 DTO。useScopedRead 与 own reader 负责取消、迟到拒绝、90 秒/2 MiB、严格 UTF-8；401/403、修订失效会清旧 summary/detail/binding。图表缺数断开；CPC 使用 I `DerivedMoneyPerCountV1`、共享 widget/formatter，未造均值算法。

作者验证：最近四套 `node --import tsx --test tests/netshop-promotion-view.test.ts tests/netshop-promotion-insights-query.test.ts tests/netshop-promotion-insights-decode.test.ts tests/netshop-promotion-diagnostic-reuse.test.ts` 共 **51 passed**，包含 Root/I 合同测试，不能统称为 51 个 UI 浏览器用例。7 个 reader transport 用例由本 Teammate 编写。相关 ESLint、diff check、plain React Vite build 通过；A/QA 文件 TypeScript 输出无新增匹配诊断，全库既有诊断由 Root 对照，不声称全库类型通过。

Root 已回报私有 PG UI 搜索不改汇总、自然周日期焦点不改 KPI、精确 SKU001 整期详情趋势通过；原截图 `E:\codex-artifacts\netshop-scheme2-20261001\promotion-integration\root-ui-pg-03\01-overview.png` 是 CTR/CPC 宽度修复前证据，不能当最终截图。最终焦点、原报告、版本/撤权、钻取/返回及 Q 复验以 Root 最终 run/SHA 为准。

本 Teammate 未启动前端、reader/PG 或浏览器；Root 持有 3150/18150 及 PG 生命周期。ignored `node_modules` 为独立 npm ci；`.runtime/promotion-ui/build` 为可再生成的 plain build，无正式配置、凭据、profile 或业务数据。保留当前树供组合复核，清理由总控负责。未执行部署、生产迁移/启停、真实下载导入/补跑、投放操作、外发或真实付费模型。
