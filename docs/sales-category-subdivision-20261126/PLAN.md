# 销售分析 · 品类分析：新增“品类细分”（直饮机）实施方案

- 分支 / worktree：`codex/sales-category-subdivision-20261126`，`D:/.codex/worktrees/sales-category-subdivision-20261126`，基于 `origin/main` `7bdcd551`
- 分工（用户指定）：Claude Opus 5.5 规划与审查；Claude Sonnet 5.5 编码
- 来源表：`直饮机分类规格匹配.xlsx`（SHA-256 `46a801de…beb44f4`），列 C=代码、D=名称、E=分类；610 行 → 去重、去掉占位名“没代码，当定制机”后 603 条，其中 95 条有商品编码，其余只有商品名称；15 个细分，代码与名称均无冲突映射。
- 已生成数据模块：`backend/sales/subdivision_maps/water_dispenser.py`（`SOURCE`、`ENTRIES`），生成脚本 `generate_water_dispenser_map.py`（本目录，仅本地开发用，需 openpyxl，不进发布）。

## 1. 业务口径（固定）

1. **细分范围**：父品类 = 销售 `resolved_category == "直饮机"`（与品类经营明细中“直饮机”一行同一口径、同一筛选），细分合计必须等于该父品类合计。不把其他 ERP 品类的商品拉进来。
2. **匹配优先级**：商品编码（`product_code`）命中优先；编码未命中再按商品名称（`product_name`）命中；都未命中归 **“未细分”**。
3. **规范化**：编码与名称比较前都做 `unicodedata.normalize("NFKC")`、去掉全部空白、`casefold()`；只用于比较，不改写任何数据。
4. **指标**：完全复用品类分析现有口径（`category_aggregates`、`_serialize_category` 同字段）：净销售额、占父品类比例、正向销量、退货量、净销量、退款金额、退货率、订单毛利、大毛利率 `(净额-成本)/净额`、商品数、近 7 天环比、去年同期同比。不在前端重算任何服务端指标。
5. **透明披露**：响应须给出
   - 匹配覆盖：按编码命中 / 按名称命中 / 未细分 的商品数与净销售额；
   - `outsideParent`：映射表命中、但当前 `resolved_category` 不是“直饮机”的商品（按 `resolved_category` 分组的商品数与净销售额，最多 20 组），用于判断是否需要扩大父品类；不计入细分合计。
   - 映射来源 `SOURCE`（文件名、SHA-256、条数）。

## 2. 后端（Django，`backend/sales/`）

### 2.1 映射注册 `backend/sales/subdivisions.py`（新）
- `SUBDIVISION_MAPS = {"直饮机": water_dispenser}`；对外提供 `configured_parents()`、`resolve(parent, product_code, product_name) -> (subdivision | None, matched_by: "code"|"name"|None)`、`map_version(parent)`（取 SOURCE.sha256）。
- 启动时（模块加载）构建两张字典：规范化编码→细分、规范化名称→细分；空字符串不入表。
- 用 Python 模块而非 JSON，避免发布复制清单遗漏非 `.py` 文件。

### 2.2 服务 `backend/sales/category.py` 新增 `get_category_subdivision(params, principal)`
- 参数与 `get_category_detail` 一致（startDate/endDate/channels/platforms/outlets/productQueries/productCodes）+ `category`（父品类，必须在 `configured_parents()` 中，否则 `SalesRequestError("该品类暂无细分配置")`）。复用 `_validate_range`、`_base`、`_comparison_periods`。
- 步骤：
  1. 以四个周期并集（当前 / 近 7 天 / 前 7 天 / 去年同期，与 `_grouped_with_comparisons` 相同）为范围，在父品类内取 `distinct (product_code, product_name)`，上限 5000；超过则 `SalesRequestError("品类细分商品数超过 5000，暂不支持")`（失败关闭，不截断返回错误合计）。
  2. Python 逐对 `resolve`，得到：细分 s 的“编码命中原值集合”和“名称命中原值集合”。
  3. 构造 `Case(When(product_code__in=codes_s1, then=Value(s1)), …所有编码 When…, When(product_name__in=names_s1, then=Value(s1)), …所有名称 When…, default=Value("未细分"))`，编码 When 全部排在名称 When 之前以保证优先级；`annotate(subdivision=…)` 后 `values("subdivision")` 聚合。聚合字段与周期对比**抽取并复用** `_grouped_with_comparisons` 中的注解（小幅重构为可传入分组字段/queryset 的私有函数，原 `get_category_analysis` 行为与结果不变）。
  4. 每个细分附带商品清单：在同一 Case 注解下按 `(subdivision, product_code, product_name)` 聚合当前周期，每个细分按净销售额取前 50，字段：`productCode`、`productName`、`netSalesCents`、`netQuantity`、`grossMarginRate`、`matchedBy`。
  5. `outsideParent`：`_base` 范围内 `~Q(resolved_category="直饮机")` 且（编码 ∈ 表内原编码 或 名称 ∈ 表内原名称——此处只做精确原值匹配，不规范化）按 `resolved_category` 聚合当前周期净销售额与商品数，前 20。
- 排序：按净销售额降序，名称二进制序兜底；“未细分”固定最后。
- 缓存：用 `reuse("category-subdivision", scope, principal, fn)`，scope 必须含 `category` 与 `mapVersion`；与现有 reuse 用法一致。
- 响应：
```
{
  range, comparisonPeriods, category, dataCutoffDate,
  mapping: { source: {fileName, sha256, rowCount}, matchOrder: ["product_code","product_name"], normalization: "NFKC+strip-whitespace+casefold", unmatchedLabel: "未细分" },
  parent: <父品类 _serialize_category 同字段的汇总，category=父品类>,
  coverage: { code: {productCount, netSalesCents}, name: {...}, unmatched: {...} },
  items: [ { ...CategoryMetric 同字段（category 字段填细分名）, subdivision, shareRate=占父品类, products: [...], productsTruncated: bool } ],
  outsideParent: { items: [{category, productCount, netSalesCents}], truncated: bool },
}
```

### 2.3 接口接线
- `backend/sales/urls.py`：`path("category-analysis/subdivision", views.category_subdivision, …)`。
- `backend/sales/views.py`：仿 `category_detail`（`_category_common` + `category` + `_consistent_read` + `_json`）。
- 父品类配置列表：在 `get_category_analysis` 响应中新增 `subdivisionParents: [...]`（`configured_parents()` ∩ 当前结果中出现的品类）——只追加字段，不改已有字段。

## 3. Worker（薄适配）

- 新增 `app/api/sales/category-analysis/subdivision/route.ts`：照抄 `detail/route.ts` 的鉴权、参数校验、`routeDjangoSalesReadRequest({ request, principal })`，错误文案改为“读取品类细分失败。”。
- `tests/django-sales-route-integration.test.ts` 的 `migratedRoutes` 加入新路由（源码约束检查，非功能测试）。
- `lib/sales/category-response.ts` 新增 `validCategorySubdivision(value, start, end, category)`，按 2.2 响应结构做结构校验；`validCategoryAnalysis` 对 `subdivisionParents` 做“缺省视为 []、存在则必须是字符串数组”的兼容校验。

## 4. 前端（`app/sales-category-view.tsx`，复用现有样式）

- 位置：“品类经营明细”面板之后、“数据来源与口径”之前，新增 `<section className="panel table-panel category-subdivision-panel">`，标题“品类细分”，eyebrow `CATEGORY SUBDIVISION`。
- 仅当 `data.subdivisionParents` 非空时显示；多个父品类时用现有 `segmented` 按钮切换（当前只有“直饮机”，仍显示为单个选中按钮以表明归属）。品类经营明细中“直饮机”行的操作列追加“细分”按钮，点击滚动到本面板并选中该父品类。
- 独立请求 `/api/sales/category-analysis/subdivision?startDate&endDate&category&channel*&platform*&outlet*&productQuery`，**完全仿照现有 detail 请求**：AbortController、generation 门禁、30 秒超时、`validCategorySubdivision` 校验、失败保留上次成功结果并提示。随公共筛选变化重新请求；不随品类页排序/分页变化重新请求。
- 内容：
  1. 顶部一行汇总：父品类净销售额、净销量、大毛利率；覆盖情况“编码命中 x 个 / 名称命中 y 个 / 未细分 z 个（占净额 r%）”。
  2. 表格（`data-table category-detail-table` 同款）：细分、净销售额、占比、净销量、退款金额、退货率、订单毛利、大毛利率、商品数、环比上周、同比；格式化函数复用 `formatCurrency/formatCount/formatRate/formatComparison/comparisonTone`。
  3. 行可展开显示商品清单（前 50，`productsTruncated` 时注明“仅显示前 50 个商品”），列：商品编码、商品名称、匹配方式（编码/名称/未匹配）、净销售额、净销量、大毛利率。
  4. `outsideParent.items` 非空时显示提示条（复用 `category-unclassified-notice`）：“映射表中有 N 个商品当前不属于‘直饮机’品类（列出品类与净额），未计入细分”。
  5. 面板底部口径说明：映射表文件名与 SHA-256 前 8 位、条数；“编码优先、名称次之，未命中归未细分”。
- 如需新增样式，只在现有样式文件中追加少量 `category-subdivision-*` 类，不另建第二套主题。
- `useAiPageDetails` 不改。

## 5. 文档

- `README.md` 销售分析 · 品类分析处补一句“品类细分（当前支持直饮机，映射来自《直饮机分类规格匹配》，编码优先、名称次之）”。
- `docs/规范/业务口径.md` 追加一条稳定口径（第 1 节的 1–3 条精简版）。
- 本目录 `REPORT.md`：变更、检查结果、未做事项。
- 按 `前端与性能.md`，另交付一个可直接打开的单文件 HTML 演示 `subdivision-panel-demo.html`（本目录；内嵌样式与**明确标注为合成**的演示数据，含父品类切换与行展开交互；不调用任何接口）。

## 6. 不做 / 边界

- 不改数据库结构、不加 migration、不写入任何业务数据；不改 `resolved_category` 口径；不接 AI 中央工具（可作后续）。
- 不新增功能测试或业务验收（按 AGENTS 第 4 条，功能由用户上线后检测）。
- 必需检查：`python -m py_compile` 新改 Python 文件、`python backend/manage.py check`（如环境可用）、`npx tsc --noEmit`（或仓库现有 typecheck 脚本）、`npm run check:backend-boundary`、`node --test tests/django-sales-route-integration.test.ts`（源码约束）以及仓库现有 build 命令（若耗时过长可只跑 typecheck 并在报告注明）。
- 只提交本任务文件；不合并、不推送 main、不发布。
