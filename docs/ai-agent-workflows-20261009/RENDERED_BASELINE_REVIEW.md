# 四项 rendered 静态断言的独立基线复验

2026-10-09，固定基线 `origin/main = da0d62bdd92bef118f617d0ce592a8e60682c231`。

当前分支全套 `rendered-html` 原记录为 20 项、16 通过、4 失败。独立复验把固定基线的**未改完整测试文件及这四项读取的全部源文件**通过 `git archive` 解包到 `.runtime/rendered-baseline-da0d62bdd92b`，直接使用 `node --test --test-name-pattern` 运行同四项。依赖由上级本任务 `node_modules` 解析；未运行生产构建或服务，未复制 `dist`，未改测试断言。

结果为 **4 项同名、同断言行、同正则失败，0 跳过**。每个读取文件均与本任务当前源码逐字节相同，完整 SHA-256 清单见 [rendered-baseline-review.json](rendered-baseline-review.json)。这些失败已经存在于固定基线，不能归因为本次 AI 工作流修改；本结果也不表示全套 rendered 检查通过。

| 原测试 | 同一失败断言 | 当前源码事实及范围 |
| --- | --- | --- |
| `wires the sales import and PostgreSQL analytics capabilities` | `tests/rendered-html.test.mjs:180`，要求 `clientSources` 含 `aria-multiselectable` | 属性实际位于 `app/ui/searchable-select.tsx`，该文件虽被读入 `searchableSelect`，却没有拼入被断言的 `clientSources`。 |
| `keeps sales overview multi-selects mounted while filtered results refresh` | `:271`，要求 `if (!summary && !error)` 后直接出现旧 Fragment 与共享筛选调用 | 当前销售页面把导航与公共筛选封装在 `withSalesContent`，该分支调用此 helper。正则仍限定旧内联形式。 |
| `wires product profitability to synchronized sales and inventory facts` | `:388`，要求 `shopOptions.some((option) => option.value === item)` | 当前商品页通过 `currentOverview.filters.shops.some` 与平台范围清理选中项，未保留旧表达式。该复验仅确认断言与源码现状，不代替商品筛选行为验收。 |
| `exposes the centrally registered, fail-closed Codex MCP connection` | `:900`，要求根 `AGENTS.md` 直接包含 `get_data_freshness` | 根文件已为开发约定与规范索引；水位和只读要求在 `docs/规范/业务口径.md`、`docs/OPERATIONS_DATA_QUERY.md`，中央注册表规则在 `docs/规范/安全与AI工具.md`。 |

原始失败日志：`.runtime/ai-workflow-rendered.log`。基线实际复验日志：`.runtime/rendered-baseline-da0d62bdd92b/four-tests.tap`。两份日志摘要与固定源码绑定均写入 JSON；运行保留失败退出码 1，没有把基线失败改写成通过。

本次仅核对这四项；全局 TypeScript、ESLint 和其他单元测试的结果由主验收另行记录。
