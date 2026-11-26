# 品类细分可编辑 + 大类目 + 按规格代码归集 实施方案

- 分支 / worktree：`codex/subdivision-category-edit-20261126`，`D:/codex-worktrees/subdivision-category-edit-20261126`，基于 `origin/main` `7a769c36`（上一版“货品细分映射”已合入）。
- 分工（用户指定）：Claude Opus 5.5 写方案与提示词并反审；Claude Sonnet 5.5 编码。
- 上一版方案与报告：`docs/product-subdivision-mapping-20261126/PLAN.md`、`REPORT.md`（只读参考，不改）。

## 0. 用户需求与已确认口径（2026-11-26）

**一、销售分析 › 品类分析 › 品类细分**
1. 品类细分设置：删除“趋势粒度”切换（趋势固定按日）。
2. 增加“大类目”选择，当前唯一选项“直饮机”（直饮机细分 = 大类目直饮机）。
3. 品类细分明细：每一列都可排序，表头用 `↕` 表示可排序，点击在降序/升序间切换（当前排序列显示 `↓`/`↑`）；每行“操作”里在“查看货品”后增加“编辑”，可删除该细分或新增细分。
4. 明细表下方增加“汇总合计”行。
5. 映射表中“吉客云未找到”的条目也要计入数据；归集按吉客云规格代码而不是名称。

**二、系统设置 › 货品细分映射**
1. “细分名称”左边增加“大类目”（列 + 筛选下拉，可选项：直饮机）。
2. 货品归类明细“状态”后增加“编辑”，可手动给货品归类。
3. “吉客云货品代码”与“吉客云规格代码”是同一个东西，只保留“吉客云规格代码”一列；补充“供应链名称”列 = 吉客云货品档案 `ErpProductMaster.supplier`（用户确认）。

**用户确认的归集规则**（问答选择“名称转代码 + 兜底计入”）：
- 静态映射表 603 条中 95 条有代码、508 条只有名称。
- 有代码的条目：按代码归集。
- 只有名称的条目：先按名称（规范化后）在吉客云货品档案 `ErpProductMaster` 里找到对应的规格代码（`product_code`），之后按这些代码归集销售。
- 档案里找不到代码的条目（“吉客云未找到”）：仍按名称匹配销售明细兜底计入。用户也可以在系统设置里手动补规格代码。
- 手动归类优先级最高。
- “吉客云规格代码”= `product_code`（系统里没有单独的规格代码字段，上一版已与用户确认）。

## 1. 数据结构（新增 migration，只建表，不写数据）

`backend/sales/migrations/0014_product_subdivision_edits.py`（编号按实际最新顺延），新增两张表：

```python
class SalesSubdivisionLabel(models.Model):          # 细分定义的增改（覆盖静态表的标签）
    major_category = models.TextField()             # 目前只有 "直饮机"
    name = models.TextField()
    sort_order = models.IntegerField(default=0)     # 新增标签追加到末尾；本次不提供编辑 UI
    is_deleted = models.BooleanField(default=False) # 删除 = 软删除；静态标签被删也用这一行表示
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.TextField(default="")
    class Meta:
        db_table = "sales_subdivision_labels"
        constraints = [UniqueConstraint(fields=["major_category", "name"], name="sales_subdivision_label_uniq")]

class SalesProductSubdivisionOverride(models.Model): # 手动归类
    product_code = models.TextField(primary_key=True)   # 吉客云规格代码（原值，trim 后）
    major_category = models.TextField()
    label = models.TextField(default="")                # "" = 手动设为“未归类”
    source_name = models.TextField(default="")          # 给“吉客云未找到”条目补代码时，记下被替代的静态条目名称
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.TextField(default="")
    class Meta:
        db_table = "sales_product_subdivision_overrides"
```

- 不写种子数据。表为空时，行为 = 静态映射 + 名称转代码，与“无任何编辑”一致。
- 核对 sales 域 reader 与 sales_writer 的数据库账号：若按表授予权限（GRANT），照既有做法给 reader SELECT、writer SELECT/INSERT/UPDATE/DELETE；若是同一账号，则无需处理。在报告中写明核对结论。

## 2. 生效映射（`backend/sales/subdivisions.py` 改为“静态 + 档案 + 数据库”合成）

静态来源注册改为：

```python
SUBDIVISION_SOURCES = ({"module": water_dispenser, "majorCategory": "直饮机", "coveredCategories": ("直饮机",)},)
```

新增 `load_effective(principal) -> EffectiveMapping`，按“销售数据 revision + 配置摘要”缓存，复用 `calculation_cache.reuse`。配置摘要 = 两张新表的行数与 `max(updated_at)` 拼接后的 SHA-256，加上静态来源 sha256。每次请求做一次轻量查询读取摘要。

**合成步骤**：
1. **标签**：对每个大类目，先取静态标签（首次出现顺序，`sort_order = 序号*10`），再叠加 `SalesSubdivisionLabel`。同名行覆盖 `sort_order`/`is_deleted`，新名字作为自定义标签追加。生效标签 = 未删除者，按 `(sort_order, binary_text_key(name))` 排序。
2. **档案候选**：从 `ErpProductMaster` 取 `category ∈ covered` 或 `product_code ∈ 静态代码` 或 `product_name ∈ 静态名称原值` 或 `product_code ∈ 手动归类代码` 的行。上限 20000，超出时报 `SalesRequestError`（失败关闭）。
3. **代码映射 `code_map: normalize(code) -> (label, majorCategory, source)`**，先写者优先：
   1. 手动归类（`source="manual"`）。`label=""` 表示显式未归类，同样占位，阻止后续规则命中。
   2. 静态有代码条目（`source="code"`）。
   3. 静态只有名称的条目：在档案候选中按 `normalize(product_name)` 相等找到全部货品，把它们的 `product_code` 写入（`source="name_to_code"`）。
4. **名称兜底 `name_fallback: normalize(name) -> (label, majorCategory)`**：静态只有名称且档案里没找到的条目，并排除 `source_name` 等于该名称的手动归类（规范化比较）。这些就是“吉客云未找到”条目。有代码但代码不在档案中的条目同样算“吉客云未找到”，但它们照常按代码计入，不进 `name_fallback`。
5. 指向已删除标签的映射（任一来源）视为未命中：覆盖分类内的货品 → 未归类，其他 → 不计入。
6. **对外接口**：
   - `resolve(code, name) -> (label | None, majorCategory | None, matchedBy)`，`matchedBy ∈ {"manual", "code", "name_to_code", "name", None}`；
   - `raw_codes()`：代码映射中出现过的全部原值代码；
   - `raw_fallback_names()`；
   - `labels(major)`；`major_categories()`；`covered_categories(major)`；`version`；`mapping_info()`。

   上一版的 `raw_names()` 不再用于销售候选，只用于档案候选。`MATCH_ORDER` 改为 `["manual", "product_code", "name_to_code", "name_fallback"]`。
7. `normalize` 不变（NFKC + 去空白 + casefold）。

## 3. 接口 A 改动：`GET /api/sales/category-analysis/subdivisions`（reader）

- **参数**：
  - 新增 `majorCategory`（默认第一个大类目，未知值返回 400）；
  - 删除 `granularity` 参数，趋势固定按日。Worker 与前端同步删除；请求里带了也忽略，不报错，避免旧页面缓存出错。
- **销售候选**：`resolved_category ∈ covered(major)`、`product_code ∈ raw_codes()`、`product_name ∈ raw_fallback_names()` 三者满足其一。之后逐对 `resolve`，只保留 `majorCategory` 匹配的行。未命中且分类在 covered 内的归“未归类”。
- **明细**：列出该大类目的**全部生效标签**，没有销售的显示 0。已归类细分数不超过 200，超出时报错。
  - 由于标签总数小，排序与分页可改为在 Python 里对全部标签行完成，保持现有 `pagination` 结构。
  - `SORT_KEYS` 扩展到表格的每一列：`subdivision`（名称，二进制序）、`netSalesCents`、`shareRate`、`netQuantity`、`refundRate`、`refundAmountCents`、`grossProfitCents`、`grossMarginRate`、`yearOverYearRate`、`weekOverWeekRate`、`productCount`。NULL 值无论升降序都排最后，与品类经营现有规则一致。
- **`summary`**：增加与明细行同口径的 `yearOverYearRate`、`yearAgoNetSalesCents`、`weekOverWeekRate`、`currentWeekNetSalesCents`、`previousWeekNetSalesCents` 和 `shareRate`（已归类合计 = 1，无销售时为 null），供“汇总合计”行使用。
  - 同比、环比按已归类全部行整体聚合，复用 `_comparison_aggregates`，不能把各行比率相加。
  - `productCount` 改为按去重 `product_code` 计数（修上一版的重复计数问题）。
- **货品清单**：`products[].matchedBy` 使用新取值。每个细分附全部标签元数据 `labelSource: "static" | "custom"`，供前端编辑使用。
- **`mapping`**：增加 `majorCategories: [{name, coveredCategories, labels:[{name, source, sortOrder}]}]`、`selectedMajorCategory`、`configVersion`。

## 4. 接口 B 改动：`GET /api/sales/product-subdivisions`（reader）

- **行**：
  - 删除 `goodsCode`，保留 `specCode`；
  - 新增 `supplier`（`ErpProductMaster.supplier`）、`majorCategory`、`overridden: bool`（存在手动归类）、`defaultSubdivision`（不考虑手动归类时的结果，用于“恢复默认”提示）；
  - `matchedBy` 使用新取值。
- **状态**：`mapped`、`unclassified`、`missing` 三种含义不变。
  - `missing` = 静态条目在档案中找不到：只有名称的找不到名称，有代码的找不到代码；
  - 被 `source_name` 手动归类替代的只有名称条目不再列出；
  - `missing` 行显示“仍计入：按代码 / 按名称兜底”。
- **手动归类**：若手动归类的代码不在档案候选里，也作为一行列出，`status` 取 `mapped`（label 非空）或 `unclassified`，`erpCategory` 为空。这样用户补的代码可见、可撤销。
- **参数**：新增 `majorCategory`（可空 = 全部）；`subdivision` 校验改为“该大类目下的生效标签”。
- **汇总**：`totals`、`subdivisions` 保持现状并按大类目区分，`mapping` 同接口 A。缓存 scope 加入 `configVersion`。

## 5. 接口 C（新增，writer）：`POST /api/sales/product-subdivisions/edits`

- 只在 `sales_writer`（和 `development`）进程注册（`write_patterns`）。
- Django 侧要求 principal 为 admin 且不受数据范围限制，鉴权方式照搬 sales 现有 writer 视图；Worker 侧 `requireAppPrincipal(["admin"])` + `requireUnrestrictedDataScope(principal, "系统设置", "修改货品细分映射")`。
- 请求体为 JSON 对象，`action` 区分以下操作：

| action | 字段 | 行为 |
| --- | --- | --- |
| `add_label` | `majorCategory`, `name` | `name` 去首尾空白后长度须在 1–40；不能叫“未归类”，不能与该大类目的生效标签重名。已存在被删除的同名行就恢复（`is_deleted=False`），否则插入，`sort_order = 当前最大值 + 10`。 |
| `delete_label` | `majorCategory`, `name` | 必须是当前生效标签。upsert 一行 `is_deleted=True`。手动归类到它的货品不动，生效时视为未命中。 |
| `assign` | `productCode`, `majorCategory`, `label`（字符串，`""` = 设为未归类），可选 `sourceName` | `productCode` 去首尾空白后长度须在 1–100，`sourceName` ≤ 300。`label` 非空时必须是该大类目的生效标签。`update_or_create` 覆盖行。 |
| `reset_assignment` | `productCode` | 删除手动归类行，不存在也返回成功（幂等）。 |

- 在 `transaction.atomic()` 中完成，写入 `updated_by = principal 标识`。
- 返回 `{ok: true, configVersion}`；校验失败返回 400 + 中文 `error`。
- 照现有 sales writer 视图的约定处理幂等键和请求体大小上限；有就沿用，没有不新造。
- 写完不需要 bump 销售 `SalesDataRevision`：配置摘要变化会让缓存 scope 自动失效。若 `reuse` 在写入后 30 秒内仍可能命中旧值，必须确认 scope 含有每次请求现读的摘要。
- **登记位置**：
  - Worker `lib/django/sales-writer.ts`：新路径常量，并加入 `WRITER_ONLY_SALES_PATHS`；
  - Django 内部签名鉴权 / 进程路径准入清单：查找 sales writer 现有路径在哪里登记（例如 `backend/sales/auth.py`、middleware、`config/` 下的 path allowlist、`tests/django-sales-route-integration.test.ts`、`check:backend-boundary` 相关清单），新路径一并登记；
  - 以真实请求入口的准入为准，不能只改高层 helper。

## 6. Worker（薄适配）

- `app/api/sales/category-analysis/subdivisions/route.ts`：透传白名单改为去掉 `granularity`、加入 `majorCategory`（≤ 40 字）。
- `app/api/settings/product-subdivisions/route.ts`：GET 透传加入 `majorCategory`；新增 `POST`，转发到接口 C。写法照 `warehouse-mappings` 的 PUT（admin、请求体非空对象），走 `requestDjangoSalesService` 的 writer 通道。错误文案“保存货品细分映射失败”。
- `lib/sales/category-response.ts`、`lib/sales/product-subdivision-contract.ts`：按新字段更新校验。去掉 granularity 相关断言；新增字段放宽校验为结构存在即可，不做过度断言。

## 7. 前端

### 7.1 `app/sales-category-view.tsx` → `CategorySubdivisionTab`

- **品类细分设置**：删除趋势粒度 `segmented`（约第 441 行）及 `view.granularity` 状态；在原位置放“大类目”`SearchableSelect`，选项来自 `mapping.majorCategories`。首次加载前默认“直饮机”，进组件 state，不进 URL。
- **表头排序**：每个数据列（细分、净销售额、贡献率、净销量、退货率、退款金额、毛利额、毛利率、同比、环比上周、货品数）都是排序按钮。未选中时显示 `↕`，选中时显示 `↓`/`↑`；点击已选中列切换升降序，点击新列从降序开始。排名、细分趋势、操作列不排序。表头要有 `aria-sort`。只改细分 tab，不动品类经营 tab 的表头。
- **操作列**：
  - “查看货品”后加“编辑”按钮（仅 `identity` 角色为 admin 时显示；核对组件拿得到的身份信息，拿不到就始终显示，权限由服务端 403 兜底并提示）。
  - 点击后在该行下方展开编辑行，复用展开货品的同款 `colSpan` 行：
    - 显示“细分：xxx（静态 / 自定义）”；
    - “删除该细分”按钮：`window.confirm`，文案说明删除后该细分下 N 个货品转为未归类，可在系统设置重新归类；
    - “新增细分”输入框 + “添加”按钮。
  - 编辑行与货品展开行互斥。
  - 提交走 `POST /api/settings/product-subdivisions`，成功后刷新细分数据（`retryKey+1`），失败显示错误。
- **汇总合计**：在 `<tbody>` 之后加 `<tfoot>` 一行。排名列写“合计”，细分列写“共 N 个细分”，其余列用 `summary` 的同名字段（同比、环比上周用新增 summary 字段），趋势列和操作列留空。分页时合计仍是全部细分的合计，不是当前页合计。
- **匹配方式文案**：`manual: 手动归类`、`code: 规格代码`、`name_to_code: 名称转代码`、`name: 名称兜底（吉客云未找到）`、`none: 未匹配`。
- **脚注**：“按吉客云规格代码归集；只有名称的映射条目先按名称在吉客云货品档案中找到规格代码；档案中找不到的按名称兜底计入；手动归类优先。趋势按日。”
- 请求逻辑（AbortController、generation、超时、校验、保留上次成功结果）保持现状，只改参数。

### 7.2 `app/product-subdivision-settings.tsx`

- **筛选行**：在“细分”下拉左边加“大类目”下拉，选项为“全部大类目”+“直饮机”。选中大类目后，细分下拉只列该大类目的标签。
- **表格列**：吉客云规格代码、货品名称、规格、供应链名称、吉客云分类、大类目、细分名称、匹配方式、状态、操作。删除“吉客云货品代码”列。
- **操作列“编辑”**：行内切换为编辑态。
  - 细分下拉：该行大类目（或默认“直饮机”）的生效标签 + “未归类”。
  - “吉客云未找到”且没有代码的行：额外显示“规格代码”输入框（必填），提交时带 `sourceName = 该行名称`。
  - 按钮“保存”/“取消”。行已手动归类时再加“恢复默认”。
  - 保存后刷新列表和汇总；失败在行内或页面顶部提示。
- **说明文字**：更新为“映射默认来自《直饮机分类规格匹配.xlsx》，可在此手动调整，手动归类优先；规格代码即吉客云货品编号；供应链名称取吉客云货品档案的供应商。”
- 新增 CSS 尽量少，优先复用 `warehouse-mapping-settings.tsx` 的类名。

## 8. 文档

- `README.md`：两条描述按新能力更新，各一句。
- `docs/规范/业务口径.md`：细分口径条目替换为第 0 节“归集规则”的精简版。
- 本目录 `REPORT.md`：变更、检查结果、未做事项、DB 权限核对结论。
- `demo.html`：可直接打开的单文件演示，使用标注为合成的数据，展示两个页面的新版式（大类目、↕ 排序、编辑行、合计行、设置页新列与编辑态）。

## 9. 不做 / 边界

- 不写业务数据，不加种子数据迁移；不改 `resolved_category` 口径；不改品类经营 tab；不接 AI 中央工具；不提供标签重命名和手动排序 UI。
- 不新增功能测试或业务验收（AGENTS 第 4 条）。仅调整被本次改动直接影响的既有测试。
- **必需检查**：
  - `python -m py_compile`（改动的 py 文件）；
  - `manage.py check`；
  - `manage.py makemigrations sales --check --dry-run`：确认迁移与模型一致；
  - `manage.py test sales.tests.test_api -k category`（如可运行）；
  - `npx tsc --noEmit`：改动文件 0 新错误，与基线比较；
  - `npx eslint`（改动的 TS/TSX）；
  - `npm run check:backend-boundary`；
  - `node --import tsx --test tests/django-sales-route-integration.test.ts tests/settings-view.test.ts`；
  - `npm run build`。
- 只提交本任务文件；不合并、不推送 main、不发布。
- **发布范围**：Worker + Django + migration。
