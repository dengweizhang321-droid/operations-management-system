# 路径 A 设计：单店 ERP 销售 reader

日期：2026-10-29。基线 `f205e96f`。承 [ERP scope 可行性](ERP-SCOPE.md) 第 4 节选定的路径 A。首店已定为**志高商用设备旗舰店（平台：京东）**，库存范围已定为 `included_in_inventory`。

本文只做设计，未改动任何业务代码。第 6 节列出**未验证点**，其中第一项足以改变取数过滤条件，实施前须先排除。

## 1. 要解决的缺口

当前没有任何对外接口按店暴露 ERP 销售。实测 Worker 数据集元数据（`/api/ai/datasets/<id>`，读元数据非业务数据）：

| 数据集 | 查询参数 | 有 shop |
| --- | --- | --- |
| `netshop_product_daily` | startDate、endDate、platform、**shop**、query、limit | 是 |
| `netshop_promotion` | startDate、endDate、platform、**shop**、query、limit | 是 |
| `sales_summary` | range、startDate、endDate | 否 |
| `sales_category` | brands、startDate、endDate、categories、channels、platforms、productQueries… | 否 |

销售事实表底层**有** `shop_name` 与 `shop_key`（[sales/models.py](../../backend/sales/models.py) 第 105、135 行，并有 `(platform_key, shop_key, business_date)` 索引），但没有按店的对外读取通道。所以路径 A 是新建一条链路，不是给现有工具加参数。

## 2. 复用的既有接缝

不新建销售事实查询，全部复用权威实现：

| 接缝 | 位置 | 复用内容 |
| --- | --- | --- |
| 按店明细读取 | [sales/analysis.py](../../backend/sales/analysis.py) `read_page()` | 双字段过滤、`identity_check`、游标绑定、覆盖回执 |
| 店铺目录 | `SALES_ANALYSIS_OPTIONS_PATH`（[sales-gateway.ts](../../lib/django/sales-gateway.ts) 第 18 行） | 平台/店铺/渠道枚举与 `first_date`/`last_date`/`row_count` |
| 续读 | `SALES_ANALYSIS_CONTINUATION_PATH`（同文件第 19 行） | 分页续读契约 |
| 工具模板 | [pi-netshop-tools.ts](../../lib/ai/pi-netshop-tools.ts) `readPiNetshopPage()` | surface 校验、领域 reader 调用、分页完整性断言、`filtersApplied` 回执形状 |
| 单店围栏 | [pi_selection.py](../../backend/ai_assistant/pi_selection.py) | `bind_arguments()` 注入与覆盖店铺条件 |

## 3. 双字段过滤是硬要求

[analysis.py](../../backend/sales/analysis.py) 第 62 至 63 行的条件是 `shop_name=X` **且** `shop_key=X`，必须原样保留。

原因在 [sales/models.py](../../backend/sales/models.py) 第 50 行：`shop_key = shop or channel or platform or UNCATEGORIZED`。`shop_name` 为空时 `shop_key` 回退为渠道名、平台名或 `UNCATEGORIZED`；只按 `shop_key` 过滤会把渠道级、平台级与未分类行误当成某店数据。两字段同时相等，只有 `shop_name` 真有值的行能通过。

**不得改为单字段过滤，也不得为"多匹配一些行"而放宽。**

## 4. 拟定实现

### 4.1 注册表条目

拟名 `get_pi_sales_shop_page`，照 `get_pi_netshop_performance_page`（[tool-registry.ts](../../lib/ai/tool-registry.ts) 第 270 至 282 行）的形状：

- `risk: "read_only"`、`scopePolicy: "principal_scope"`、`allowedRoles` 沿用 `chatDataRoles`
- `execution`: `allowedSurfaces: ["pi_agent"]`、`maxCallsPerRequest: 1`、超时与结果上限对齐 netshop 条目
- `inputSchema`: `platform` 枚举 `["京东","天猫"]`、`shop`、`startDate`/`endDate`（`^\d{4}-\d{2}-\d{2}$`）、`page`、`limit`、`channel`，`additionalProperties: false`
- `platform`/`shop` 在 schema 中可填但**不被信任**：与 netshop 条目一致，真实约束由 `pi_selection` 完成（见 4.3）

### 4.2 Worker handler

拟新增 `lib/ai/pi-sales-tools.ts`，照 `readPiNetshopPage()` 结构：

1. `context.surface !== "pi_agent"` 直接拒绝
2. 取 `context.principal`，按销售域既有 access helper 校验 scope
3. 组装 query 后经销售 gateway 以 `service: "reader"` 调 Django
4. 断言返回含 `items` 与 `pagination`，缺失则 `service_unavailable`（不把缺证明的响应当成功）
5. 回执保留来源 revision、`consistency: "live_per_page"`、金额单位 `CNY_cents`、`filtersApplied`

明确不做：不在 Worker 内拼 SQL、不做跨页聚合、不把单页当完整快照。

### 4.3 单店围栏接线

[pi_selection.py](../../backend/ai_assistant/pi_selection.py) 两处改动：

- 第 10 行 `TOOLS` 加入 `get_pi_sales_shop_page`
- `bind_arguments()` 增加该工具分支，复用现有 `_query()`：比对模型填写的 `platform`/`shop` 是否与可信 `selection` 一致，不一致 403，然后以 `selection` 覆盖

店铺值来自服务端从 Pi operation 解析的 `shopSelection`（第 26 至 30 行 `for_operation()`），**不接受模型自报**。

### 4.4 Django 侧准入

U4 已于 2026-10-29 读源码排除，结论改变了本节的方案，详见第 6.1 节。要点：现有按店明细链路**两层都硬性要求无范围管理员并回查数据库复验**，不能通过「放宽 principal 限制」复用。

因此确定**新增专用 reader 端点**，复用 `analysis.py` 的双字段过滤、`identity_check` 与覆盖回执逻辑，但：

- 自行按 `principal_scope` 校验，不调用 `analysis_continuation._actor()`
- 不改 `analysis.py:57` 与 `analysis_continuation.py:27` 的任何判断
- 该端点注册在 `sales/urls.py` 的 `analytics_patterns` 中（reader 角色可见），与现有 6 个端点并列
- 店铺条件由 Worker 侧传入并由 `pi_selection` 保证可信，端点自身不接受无约束的任意店铺查询

## 5. 日报的口径分列

日报含三类范围，必须分别标注，不得混算：

| 章节 | 范围 | 来源 |
| --- | --- | --- |
| 网店商品与推广 | 精确店铺 | `netshop_product_daily`、`netshop_promotion` |
| ERP 销售 | 精确店铺 | 本设计的 `get_pi_sales_shop_page` |
| 库存 | `included_in_inventory`（当前 66 个仓，**不是本店**） | 按 [ERP scope](ERP-SCOPE.md) 第 10 节的 `inventoryGrant` |

禁止用本店销售额与库存范围做比率、周转或覆盖天数推断（[ERP scope](ERP-SCOPE.md) 第 10.3 节）。若日报同时呈现库存健康分布，其范围是更窄的四类仓，与 66 仓口径不同，须再分别标注。

## 6. 未验证点

**第一项是阻断级**：未排除前不要实现 4.2 的取数逻辑。

| 编号 | 未验证内容 | 影响与排除方法 |
| --- | --- | --- |
| U1 | **「志高商用设备旗舰店」在销售事实表中 `shop_name` 是否有值** | 若为空，双字段过滤匹配零行，整条链路接通后仍取不到数。排除方法：在有生产只读连接的终端运行 [tools/shop-sales-readonly-probe.py](../../tools/shop-sales-readonly-probe.py)，看第 1、2 行 |
| U2 | `platform` 字段的实际写法 | 可能是「京东」「JD」或其他；写错导致静默零行。同一脚本第 4 行 |
| U3 | 该店的渠道枚举与覆盖日期 | 决定日报「截至昨天」是否有数据，以及是否需要 `channel` 参数。同一脚本第 3 行与 `analysis-options` 的 `first_date`/`last_date` |
U1 至 U3 由同一个只读脚本一次性排除，仍待执行。

## 6.1 U4 已排除：没有可复用的按店 reader 端点

读 [sales/urls.py](../../backend/sales/urls.py) 与相关 view 确认：

reader 角色（`DJANGO_PROCESS_ROLE == "reader"`）只暴露 6 个分析端点：`analysis-records/continuation`、`analysis-options`、`summary`、`category-analysis`、`category-analysis/detail`、`consumers/query`。**没有按店明细读取端点。**

`analysis.read_page()` 经 `/api/sales/analysis-records/continuation` 暴露（[analysis_continuation.py](../../backend/sales/analysis_continuation.py) 第 84、92 行），但权限是两层硬门：

- [analysis.py](../../backend/sales/analysis.py) 第 57 行：`role == "admin"` 且 `scope is None`
- [analysis_continuation.py](../../backend/sales/analysis_continuation.py) 第 27 至 31 行 `_actor()`：同样判断，并**回查 `AppUser` 复验真实 role、status、scope、version**
- 第 99 行在续读返回前**再次比对** `_actor()` 结果，账号权限版本变化即 403；第 97 行同时核来源 revision 未变

这套前后双校验是有意设计，不能为单店场景放宽。结论：按第 4.4 节新增专用端点，复用过滤与回执逻辑而非复用权限路径。

## 6.2 U5 已排除：options 目录同样是管理员专用且有多道就绪门

[analysis_options_projection.py](../../backend/sales/analysis_options_projection.py) 第 32 至 35 行同样要求无范围管理员并回查 `AppUser`。此外有三道就绪门，任一不满足返回 503 `options_not_ready`：

- 第 42 行：ERP 来源修订未就绪
- 第 48 行：销售写入权威 `status != active`，或 `authority_epoch` / `cutover_id` 与 settings 不一致
- 第 53 行：销售切换回执无效

因此 `analysis-options` 不能作为 Pi 单店环境的店铺目录来源。单店环境本身只需服务端已解析的 `shopSelection`，不需要列目录；若日报要展示覆盖日期，应由新增端点自行返回 `first/last` 聚合（如 `analysis.py` 第 81 至 82 行的 `available` 字段），不经 options 投影。

## 7. 本文边界

设计与查证，未改动业务代码、未执行构建、未调用模型、未读取业务数据（仅读取 Worker 的数据集元数据与源码）。所有拟新增名称为设计命名，开发前与当时最新 main 核对。注册表变更须按 [安全与 AI 工具](../规范/安全与AI工具.md) 同步 schema、handler、角色与 scope 过滤、surface 与风险限制的测试。
