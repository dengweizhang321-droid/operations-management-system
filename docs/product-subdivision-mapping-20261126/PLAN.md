# 货品细分映射 + 品类分析“品类细分”三级 tab 实施方案

- 分支 / worktree：`codex/product-subdivision-mapping-20261126`，`D:/.codex/worktrees/product-subdivision-mapping-20261126`，基于 `origin/main` `267944ec`
- 分工（用户指定）：Claude Opus 5.5 方案、提示词与独立复审；Claude Sonnet 5.5 编码
- 来源表：《直饮机分类规格匹配.xlsx》SHA-256 `46a801de…beb44f4`，与上一版相同；已生成的 `backend/sales/subdivision_maps/water_dispenser.py`（603 条，`(代码, 名称, 细分)`）**数据不改**。
- 用户需求：
  1. 系统设置新增“货品细分映射”，至少显示吉客云规格代码、吉客云货品代码、吉客云分类、细分名称；
  2. 销售分析 › 品类分析：删除上一版“品类细分”面板；新增三级 tab “品类细分”，按映射做数据整理与分析，格式参考“品类经营明细”。

## 0. 用户已确认的口径（本次对话）

1. 表格“代码”= 吉客云**货品编号**（即销售明细与 ERP 货品主数据的 `product_code`，规格级，一个规格一个编号）。系统里没有单独的“吉客云规格代码”字段，因此映射页的“吉客云规格代码”“吉客云货品代码”两列都显示 `product_code`。
2. **只要命中映射就计入对应细分**，不论吉客云分类；吉客云分类只用于展示、筛选和发现“未归类”货品。
3. 系统设置的映射页参照“仓库映射”：从吉客云数据（ERP 货品主数据）列出货品，再展示每个货品归到哪个细分。**不做可编辑表格**；映射随代码发布，换 Excel 后重新生成模块并正常交付。因此**不新增数据库表、不加 migration**。

## 1. 映射与匹配（Django，`backend/sales/subdivisions.py` 重写）

- 去掉“父品类 → 映射”的键控。改为全局映射注册：
  ```python
  SUBDIVISION_SOURCES = (
      {"module": water_dispenser, "coveredCategories": ("直饮机",)},
  )
  ```
  `coveredCategories` 表示“这个映射负责归类的吉客云分类”，用来找出**属于该分类但没进映射**的货品（未归类）。
- 对外函数（全部纯函数，模块加载时建索引）：
  - `normalize(value)`：NFKC → 去全部空白 → casefold（沿用现有实现）。
  - `resolve(product_code, product_name) -> (subdivision | None, matched_by: "code" | "name" | None)`：先编码后名称；多个来源冲突时先注册者优先（`setdefault`）。
  - `covered_categories() -> tuple[str, ...]`
  - `raw_codes() / raw_names()`：映射原值（未规范化）集合，用于在 SQL 侧粗筛候选。
  - `subdivision_labels() -> list[str]`：去重后的细分名称，按首次出现顺序。
  - `map_sources() -> list[{fileName, sha256, rowCount}]`；`map_version() -> str`：所有来源 sha256 按序拼接后的 SHA-256（缓存 scope 用）。
  - 常量：`MATCH_ORDER = ["product_code", "product_name"]`、`NORMALIZATION`、`UNCLASSIFIED_LABEL = "未归类"`。
- **候选集合（两处统一使用）**：`resolved_category ∈ coveredCategories` **或** `product_code ∈ raw_codes()` **或** `product_name ∈ raw_names()`。分类以外的货品只能被原值精确命中；规范化差异只在已覆盖分类内生效。此限制写进响应 `mapping.candidateRule` 与页面脚注。

## 2. 删除上一版“品类细分”面板（全部移除，不留死代码）

- Django：`category.py` 中 `SUBDIVISION_*` 常量、`_subdivision_case`、`_compute_category_subdivision`、`get_category_subdivision`；`get_category_analysis` 响应里的 `subdivisionParents`；`views.category_subdivision`；`urls.py` 中 `category-analysis/subdivision`。保留并复用 `_comparison_queryset/_comparison_aggregates`（原品类分析行为不变）。
- Worker：删除 `app/api/sales/category-analysis/subdivision/route.ts`；`tests/django-sales-route-integration.test.ts` 中对应条目改为新路由。
- `lib/sales/category-response.ts`：删除 `validCategorySubdivision` 与 `subdivisionProduct`；`validCategoryAnalysis` 去掉 `subdivisionParents` 校验。
- 前端 `app/sales-category-view.tsx`：删除 `SubdivisionProduct/SubdivisionItem/CategorySubdivisionResponse/matchedByLabel`、`subParents/subParent/subData/...` 状态、细分请求 effect、`openSubdivision/toggleSubdivision`、品类经营明细中“细分”按钮、整个 `category-subdivision-panel`。
- `app/globals.css`：删除不再使用的 `category-subdivision-*` 规则（新 tab 若复用某些类则保留并改名需要的部分）。
- 历史目录 `docs/sales-category-subdivision-20261126/` 保留不动（含生成脚本，仍是映射模块的生成器）。

## 3. 新接口 A：品类细分分析（Django reader）

`GET /api/sales/category-analysis/subdivisions`（`analytics_patterns`，名称 `sales-category-subdivisions`）。新模块 `backend/sales/subdivision_analysis.py`，`views.category_subdivisions` 仿 `category_analysis`：`_category_common` + `granularity/sortBy/direction/page/pageSize`（同一校验与上限）+ `resolve_product_codes` + `_consistent_read` + `_json`。

计算（复用 `category.py` 的 `_validate_range/_comparison_periods/_comparison_queryset/_comparison_aggregates/_serialize_category/_period_annotation/_category_trend/_base`，必要时只把私有函数改为可被同包导入，不改行为）：

1. `union_qs = _comparison_queryset(params …)` 后再 `.filter(候选条件)`。注意 `params["categories"]` 置空（三级 tab 不受品类多选影响；渠道/平台/店铺/商品搜索仍生效）。
2. 在 `union_qs` 上取 `distinct(product_code, product_name)`，上限 5000，超出 `SalesRequestError("品类细分商品数超过 5000，暂不支持")`（失败关闭）。
3. Python 逐对 `resolve`；构造 `Case`：所有编码 `When(product_code__in=…)` 在前，名称 `When(product_name__in=…)` 在后；未命中且 `resolved_category ∈ covered` → `Value(UNCLASSIFIED_LABEL)`；其余 `default=Value("")`（被排除，见下）。
4. `annotate(subdivision=case).exclude(subdivision="")`，按 `subdivision` 分组聚合 `_comparison_aggregates` → 每行 `_serialize_category({**row, "resolved_category": label}, mapped_total_net)`。
   - `mapped_total_net` = 已归类细分（不含“未归类”）的净销售额合计；`shareRate` 以它为分母。
   - **“未归类”不进入明细表**，单独放 `unclassified`（同指标 + 前 50 个货品）。
5. 排序/分页完全照搬 `get_category_analysis` 的 `sort_key_map` 与 NULL 规则（`shareRate` 按净额排序），只对已归类细分排序分页。
6. 趋势：当前页细分按 `granularity` 取每期净销售额（照 `_trend_rows` 逻辑，但分组字段为 `subdivision` 注解），最近 24 期，`_category_trend` 生成 `trend`。
7. 每个当前页细分附 `products`（当前周期，按净额降序前 50）：`productCode, productName, erpCategory(=resolved_category), matchedBy, netSalesCents, netQuantity, grossMarginRate`，`productsTruncated`。
8. `coverage`：当前周期内 code 命中 / name 命中 / 未归类 的货品数与净额。
9. 缓存：`reuse("category-subdivisions", scope, principal, fn)`，scope = 全部参数（除排序/分页/粒度外可与 category-analysis 同法拆分）+ `mapVersion`。

响应：
```
{
  range, comparisonPeriods, dataCutoffDate,
  mapping: { sources:[{fileName, sha256, rowCount}], coveredCategories:[...], matchOrder, normalization,
             candidateRule: "covered_category_or_exact_raw_value", unclassifiedLabel: "未归类" },
  summary: { netSalesCents, grossSalesCents, refundAmountCents, positiveQuantity, returnQuantity, netQuantity,
             costAmountCents, grossProfitCents, grossMarginRate, productCount, lineCount, subdivisionCount },   // 仅已归类
  coverage: { code:{productCount, netSalesCents}, name:{…}, unclassified:{…} },
  unclassified: { …CategoryMetric 同字段（category="未归类"）, visible: bool, products:[…], productsTruncated },
  details: { items:[ CategoryMetric 同字段 + trend + products + productsTruncated ],
             pagination:{page, pageSize, total, returned, truncated}, sort:{by, direction},
             trend:{granularity, periodLimit:24} }
}
```

## 4. 新接口 B：货品细分映射（系统设置，Django reader）

`GET /api/sales/product-subdivisions`（`analytics_patterns`，名称 `sales-product-subdivisions`）。新模块 `backend/sales/subdivision_mapping.py`，`views.product_subdivisions`：鉴权同其他 reader（`_principal`），参数 `q`（≤100 字，匹配编码/名称/规格/分类/细分，大小写不敏感包含）、`subdivision`（细分名或空）、`status`（`all|mapped|unclassified|missing`）、`page`、`pageSize ≤ 100`。

数据来源 = ERP 货品主数据 `sales.models.ErpProductMaster`（吉客云货品档案）：

1. 候选：`category ∈ covered` 或 `product_code ∈ raw_codes()` 或 `product_name ∈ raw_names()`，上限 20000，超出报错（失败关闭）。
2. 每行 `resolve(product_code, product_name)` → `status`：命中 = `mapped`；未命中且分类属 covered = `unclassified`；其余丢弃。
3. 映射表中编码与名称都没能在主数据候选里命中（规范化比较）的条目 → `status = missing`（“吉客云未找到”），`specCode/goodsCode` 取表中代码（可为空），`erpCategory` 为空。
4. 行字段：`specCode`（= product_code）、`goodsCode`（= product_code）、`productName`、`specification`、`erpCategory`、`productStatus`、`subdivision`（未归类为 null）、`matchedBy`（code/name/none）、`status`。排序：status（mapped → unclassified → missing）、细分出现顺序、编码二进制序。
5. 汇总（不受 q/status/subdivision 筛选影响）：`totals:{mapped, unclassified, missing, entries(映射条数), subdivisions(细分数)}`、`subdivisions:[{label, productCount}]`、`mapping` 同接口 A。
6. 缓存：`reuse("product-subdivisions", {mapVersion}, principal, 全量计算)`，筛选与分页在缓存结果上做。

## 5. Worker（薄适配）

- `app/api/sales/category-analysis/subdivisions/route.ts`：照抄 `detail/route.ts`（同鉴权、`routeDjangoSalesReadRequest`），错误文案“读取品类细分失败。”。
- `app/api/settings/product-subdivisions/route.ts`：GET only；鉴权照 `warehouse-mappings` GET（`requireAppPrincipal` 全部角色 + `requireUnrestrictedDataScope(principal, "系统设置")`），转发到 Django `GET /api/sales/product-subdivisions`，用与 detail 路由相同的销售 reader 通道（先看 `routeDjangoSalesReadRequest` 能否按路径转发；不能则用 `lib/django/sales-gateway`/现有 sales reader 客户端的等价调用，不新造鉴权或签名）。
- `tests/django-sales-route-integration.test.ts` 的路由清单：去掉旧 subdivision，加入两个新路由（若该测试只覆盖 `app/api/sales/**`，settings 路由按测试实际约束处理）。
- `lib/sales/category-response.ts` 新增 `validCategorySubdivisions(value, {startDate, endDate, sortBy, direction, page, pageSize})`，结构校验同 `validCategoryAnalysis` 风格；新增 `lib/sales/product-subdivision-contract.ts`（或同文件）`validProductSubdivisions(value)`。
- 若仓库有 Worker 路由白名单 / 后端边界清单（如 `check:backend-boundary`、路由 manifest、`app/api` 权限表），一并登记；以检查脚本结果为准。

## 6. 前端

### 6.1 品类分析三级 tab（`app/sales-category-view.tsx`）

- 在 `settingsPanel`（品类分析设置）**之前**加三级导航，复用现有 `subnav outlet-subnav` 样式：`品类经营`（现有全部内容，默认）| `品类细分`。`role="tablist"`/`role="tab"`/`aria-selected` 与现有 subnav 一致。
- URL：新增 `salesCategoryTab=subdivision`（默认不写）。`writeCategoryUrl` 会删除 `categoryOwnedUrlKeys` 后重写——必须把 tab 键加入该清单并在写回时保留当前 tab；`readCategoryUrl` 读取；popstate 同步。切换 tab 用 push。
- “品类细分” tab 内容新组件（建议同文件内 `CategorySubdivisionTab`，或新文件 `app/sales-category-subdivision-tab.tsx`）：
  - 只在该 tab 激活时请求 `/api/sales/category-analysis/subdivisions`；请求方式**完全照搬**现有主请求：AbortController、generation 门禁、30 秒超时、`validCategorySubdivisions` 校验、失败保留上次成功结果并提示、`StableReadContent` 包裹。随公共筛选（日期、渠道、平台、店铺、商品搜索）与本 tab 的排序/分页/粒度变化重新请求。品类经营的排序/分页状态与细分 tab 的排序/分页状态互不影响（细分 tab 用组件内 state，可不进 URL）。
  - 品类经营 tab 在细分 tab 激活时**不发**品类分析请求？——不改现有请求逻辑以免回归：品类分析请求照旧（筛选选项来自它）。只新增细分请求。
  - 版式参考品类经营：
    1. KPI 行（复用 `category-kpi-grid`）：细分净销售额、净销量、毛利额/毛利率、已归类货品数（编码命中 x / 名称命中 y）、未归类货品（`warning` 样式，净额与占比）。
    2. `unclassified.visible` 时提示条（复用 `category-unclassified-notice`）：“{coveredCategories} 中有 N 个货品未进入细分映射（净销售额 X），未计入细分。可到 系统设置 › 货品细分映射 查看。”，可展开显示前 50 个未归类货品。
    3. 明细表（复用 `panel table-panel category-detail-panel` + `data-table category-detail-table`，表头排序按钮、分页 footer 与品类经营明细**同款**）：排名、细分、净销售额、贡献率、净销量、退货率、退款金额、毛利额、毛利率、同比、环比上周、趋势（复用 `CategoryDetailTrend`）、商品数、操作“查看货品”（行下展开货品清单：货品编号、货品名称、吉客云分类、匹配方式、净销售额、净销量、毛利率；截断时注明“仅显示前 50 个货品”）。趋势粒度用 tab 内 `segmented` 日/周/月。
    4. 脚注：映射来源文件名、SHA-256 前 8 位、条数；“货品编号优先、货品名称次之；命中即计入，不限吉客云分类；覆盖分类：直饮机”。
  - 格式化函数全部复用现有 `formatCurrency/formatCount/formatRate/formatComparison/comparisonTone`，不在前端重算服务端指标。
- `useAiPageDetails` 不改。

### 6.2 系统设置“货品细分映射”（新 `app/product-subdivision-settings.tsx`）

- `settings-view.tsx`：`settingsTabs` 在 `warehouses` 后插入 `subdivisions`，标签“货品细分映射”；lazy 加载照 `LazyWarehouseMappingSettings`；`app/shell/navigation-catalog.ts` 的 `settings.views` 同步加入。核对 `SettingsTab` 类型、键盘切换、`nextSettingsTab` 等是否自动覆盖。
- 页面版式参照 `warehouse-mapping-settings.tsx`（SummaryCard 汇总卡、筛选行、表格、分页，复用其 CSS 类名），**只读**：
  - 汇总卡：映射条数、细分数、已归类货品、未归类货品（直饮机分类未进映射）、吉客云未找到。
  - 筛选：搜索框（编码/名称/规格/分类/细分）、细分下拉（含各细分货品数）、状态分段（全部/已归类/未归类/吉客云未找到）。服务端分页，每页 20。
  - 表格列：吉客云规格代码、吉客云货品代码、货品名称、规格、吉客云分类、细分名称、匹配方式、状态。
  - 说明文字：“映射来源《直饮机分类规格匹配.xlsx》（SHA-256 前 8 位，N 条），随系统发布；调整归类请更新 Excel 后重新生成并发布。规格代码与货品代码均取吉客云货品编号。”
  - 请求同样有 AbortController / 超时 / `validProductSubdivisions` 校验 / 错误重试。

## 7. 文档

- `README.md`：替换上一版“品类细分”描述为：品类分析下的三级 tab “品类细分”与系统设置“货品细分映射”（一句话各一条）。
- `docs/规范/业务口径.md`：替换上一版细分口径条目为第 0 节第 1–2 条 + 第 1 节候选规则的精简版。
- 本目录 `REPORT.md`：变更、检查结果、未做事项。
- 按 `前端与性能.md` 交付可直接打开的单文件 HTML 演示 `demo.html`（本目录）：内嵌样式与**明确标注为合成**的数据，展示品类分析三级 tab（品类经营 / 品类细分）和设置页“货品细分映射”两个视图，可切换；不调用任何接口。

## 8. 不做 / 边界

- 不新增表、不加 migration、不写业务数据；不改 `resolved_category` 口径；不改品类经营 tab 的既有指标与请求；不接 AI 中央工具。
- 不新增功能测试或业务验收（AGENTS 第 4 条）。可以改动既有测试中被本次删除/重命名直接影响的引用。
- 必需检查：`python -m py_compile`（改动的 Python 文件）、`manage.py check`（临时 venv、假环境变量，同上一版做法）、`manage.py test sales.tests.test_api -k category`（既有测试仍通过；若有引用已删函数的测试需随之调整）、`npx tsc --noEmit`（改动文件 0 新错误，与基线比较）、`npx eslint`（改动 TS/TSX）、`npm run check:backend-boundary`、`node --import tsx --test tests/django-sales-route-integration.test.ts`、`npm run build`。
- 只提交本任务文件；不合并、不推送 main、不发布。
