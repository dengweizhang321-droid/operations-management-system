# 日报含 ERP 销售与库存：可行性与接通设计

日期：2026-10-29。基线 `f205e96f`。承 [工具可达矩阵](MATRIX.md) 第 5 节的待决问题：用户已确定日报必须包含 ERP 销售与库存，走单独获准 scope 或扩充单店白名单。

纯查证与设计，未改动任何业务代码。结论：**销售可行，库存不可行**，两者必须分开处理。

## 1. 结论摘要

| 维度 | 能否证明单店归属 | 依据 |
| --- | --- | --- |
| ERP 销售 | **可以** | `SalesOrderLine` 有 `shop_name` 与 `shop_key`，并有 `(platform_key, shop_key, business_date)` 索引 |
| 库存 | **不可以** | `backend/inventory/models.py` 中**不存在任何店铺字段**，只有 `warehouse`、`warehouse_type`、`warehouse_category` |

因此不能用同一个办法处理两者。把库存按仓库映射成店铺，等于违反 [pi_selection.py](../../backend/ai_assistant/pi_selection.py) 首行声明的边界（ERP 渠道与仓库不能识别店铺），也违反 [系统架构](../规范/系统架构.md) 对库存口径的规定。

## 2. 先纠正一处语义：`unscoped_only` 不是「不支持 scope」

[tool-registry-contract.ts](../../lib/ai/tool-registry-contract.ts) 第 168 行与第 267 行：当 `principal.scope !== null` 且条目为 `unscoped_only` 时直接拒绝。即该策略的含义是**只允许无数据范围限制的 principal 调用**，不是「该工具没有店铺维度」。

`get_sales_summary`、`get_inventory_health`、`get_product_performance` 是 `unscoped_only`，所以它们对 Pi 可达但不在单店白名单——原因是它们面向全局管理员、不做店铺过滤，而不是底层数据没有店铺。两件事不能混。

## 3. ERP 销售：已有一条可证明归属的现成路径

[backend/sales/analysis.py](../../backend/sales/analysis.py) 的 `read_page()` 正是按精确店铺读取销售明细的权威实现，有三处设计可直接复用：

**(a) 同时约束原始字段与回退字段，天然排除回退污染。** 第 62 至 63 行的过滤条件是 `shop_name=X` **且** `shop_key=X`。这一点很关键：[sales/models.py](../../backend/sales/models.py) 第 50 行 `shop_key = shop or channel or platform or UNCATEGORIZED`，当 `shop_name` 为空时 `shop_key` 会回退成渠道名、平台名或 `UNCATEGORIZED`。只按 `shop_key` 过滤会把渠道级、平台级甚至未分类的行误当成某店数据；两个字段同时相等则只有 `shop_name` 真有值的行能通过。**任何新接通必须保留这个双字段条件，不能只用 `shop_key`。**

**(b) 身份与覆盖分别回执。** 零行时不直接返回「该店无经营」，而是给 `identity_check`，列出该精确平台与店铺的历史渠道，并明确「无记录不等于零经营」（第 85 至 89 行）。日报缺数时必须沿用这个语义。

**(c) 游标绑定查询摘要。** `binding` 含 schema、来源、查询规格与 revision；来源或查询变化则游标失效、要求重新收集（第 69 至 75 行）。跨页读取不会混用不同版本的事实。

**现存限制**：第 57 行要求 `role == "admin"` 且 `scope is None`。所以这条路径当前只服务无范围管理员，不是现成的单店通道。

## 4. 两条可选路径

两者都不要求放宽既有权限，差别在接缝位置与工程量。

### 路径 A：新增单店销售 reader，纳入单店白名单（建议）

新增一个专用只读工具（拟名 `get_pi_sales_shop_page`），`scopePolicy` 为 `principal_scope`，经 `piReadOnly()` 开放 `pi_agent`，并加入 [pi_selection.py](../../backend/ai_assistant/pi_selection.py) 第 10 行 `TOOLS`。

- 店铺参数**不由模型填写**：沿用该文件现有机制，由服务端从可信 Pi operation 解析 `shopSelection`，与当前 principal 交叉核验后注入查询条件，与 `get_pi_netshop_performance_page` 经 `_query()` 改写参数的做法一致。
- 领域读取复用 `sales/analysis.py` 的双字段条件、`identity_check` 与游标绑定，不新建第二套销售事实查询。
- 不改 `get_sales_summary` 等既有 `unscoped_only` 条目的策略与行为。

代价：新增一个注册表条目与一个领域 reader 接缝；需要 surface、handler、后端准入与单店 allowlist 四处同步（[安全与 AI 工具](../规范/安全与AI工具.md) 对注册表变更的要求）。

### 路径 B：把现有销售工具改成 `principal_scope`

代价明显更高且影响面外溢：`get_sales_summary` 当前被 `ai_chat`、`dingtalk_chat`、`ai_agent`、`business_collection` 等多个 surface 使用，改其 `scopePolicy` 会同时改变所有这些入口的行为与权限语义，属于方案明确避免的「扩大查询后让模型自己过滤」。**不建议。**

## 5. 库存：当前无法纳入单店，三个选项

库存没有店铺字段，所以不存在「正确实现」的接通方式。按诚实优先排序：

| 选项 | 说明 | 代价与风险 |
| --- | --- | --- |
| B1 日报首版不含库存 | 网店侧 + ERP 销售先交付，库存章节标注「当前环境无法证明单店归属」 | 无风险；日报章节少一块 |
| B2 单独获准库存 scope | 按方案第 4 节「不能证明单店归属时使用单独获准库存 scope」，由用户显式授权一个**非单店**的库存范围，日报中该章节明确标注其范围不是本店 | 需用户明确授权；报告中必须分开披露口径，不能与店铺指标并列为同一范围 |
| B3 建立仓库到店铺的映射 | 把仓库归属映射成店铺 | **不建议**。库存模型无店铺字段，映射是推断而非事实；且 [系统架构](../规范/系统架构.md) 规定库存健康分布的仓别口径固定，工厂代发、售后、样品、海外等仓不得计入，映射会引入无法核验的归属 |

方案正文已经预见了这一点，用词是「不能证明单店归属时使用单独获准库存 scope」——即 B2，而不是想办法让库存变成单店。

## 6. 建议的组合与施工顺序

**销售走路径 A，库存走 B2，且报告中两者口径分开披露。**

1. 先确认首个店铺的精确 `platform` + `shop`，并用 `sales/analysis.py` 现有路径核实该店 `shop_name` 在事实表中确有值、覆盖日期足够（否则路径 A 接通后同样取不到数）。
2. 实现 `get_pi_sales_shop_page`：注册表条目 + 领域 reader + `pi_selection` allowlist + 服务端注入店铺条件。
3. 库存按 B2 取得用户对具体范围的显式授权；日报模板中该章节独立标注范围与口径，不与店铺级指标混算。
4. 日报章节定稿后回填 [工具可达矩阵](MATRIX.md) 第 5 节。

## 7. 待用户决定

| 决定点 | 为什么需要 |
| --- | --- |
| 首个店铺的精确平台与店名 | 路径 A 与第 1 步核实都依赖它；无此值无法验证该店销售事实是否齐全 |
| 库存走 B1 还是 B2 | B1 首版不含库存；B2 需要你授权一个明确的非单店库存范围，并接受报告中口径分列 |

## 8. 本文边界

只读查证与设计。未改动代码、未执行构建、未调用模型、未读取生产数据。所有拟新增名称均为设计命名，开发前与当时最新 main 核对。文中对 `shop_key` 回退与库存无店铺字段的判断来自当次直接读取源码，不依赖方案正文自述。

## 9. 库存 B2：单独获准范围的设计与待定值

用户已于 2026-10-29 选定 B2：授权一个明确的非单店库存范围，报告中口径分列。本节给出设计与需要你填的具体值。

### 9.1 授权不能塞进 `shopSelection`

[pi_selection.py](../../backend/ai_assistant/pi_selection.py) 第 28 行要求 `shopSelection` 的键**恰好等于** `{platform, shop}`，多一个键即 403。所以库存授权必须是 Pi operation payload 中与 `shopSelection` **并列的独立字段**（拟名 `inventoryGrant`），不是它的扩展。

这个约束正好与「口径分列」一致：两个范围在数据结构上就是分开的，不会被误当成同一范围。拟定形状：

```json
{"shopSelection": {"platform": "<平台>", "shop": "<精确店名>"},
 "inventoryGrant": {"scopeKind": "warehouse_category", "values": ["<分类>"], "grantRef": "<授权记录>"}}
```

`inventoryGrant` 由服务端在创建环境时按用户授权写入，模型不可填写、不可修改；读取时与当前 principal 交叉核验，与 `shopSelection` 同样处理。

### 9.2 可选的范围维度

[warehouse_mapping.py](../../backend/inventory/warehouse_mapping.py) 第 9 行 `WAREHOUSE_CATEGORIES` 共 10 个分类：`jd`、`dropship`、`afterSales`、`guangdong`、`sample`、`cainiao`、`overseas`、`virtual`、`exception`、`selfOperated`。

库存是否计入由 `classify_warehouse()` 产出的 `include_in_inventory` 决定（第 30、69 行），并在查询层以 `includedInInventory` 过滤（[query.py](../../backend/inventory/query.py) 第 452、529 行）。按 [系统架构](../规范/系统架构.md)，库存健康分布固定只统计京东仓、天猫履约仓（`cainiao`）、精确广东仓与自营仓；工厂代发、售后、样品、海外等不得计入。

因此 B2 的范围建议表述为**仓库分类的明确子集**，而不是自由文本仓库名——分类是服务端既有的受控枚举，仓库名是导入数据里的原始文本。

| 候选范围 | 含义 | 与既有口径的关系 |
| --- | --- | --- |
| 全部计入库存的仓 | `include_in_inventory` 为真的全体 | 与库存总览现行口径一致，最易核对 |
| 指定分类子集 | 例如仅 `jd` + `cainiao` | 需在报告中说明排除了哪些分类 |
| 单一分类 | 例如仅 `guangdong` | 范围最小，但与「日报含库存」的用途可能不匹配 |

### 9.3 报告中的口径分列要求

日报模板中库存章节须独立标注，不与店铺级指标并列为同一范围：

- 明确写出该章节的范围是仓库分类集合，**不是本店**；
- 给出该范围的 `grantRef`、授权时间与授权人，以及 `asOf` 快照时点；
- 不把库存数量与店铺销售额做任何按店归因的计算或比率；
- 该范围变化（授权修改、分类映射调整）时作为新版本，不回写历史报告。

### 9.4 需要你定的具体值

| 待定项 | 说明 |
| --- | --- |
| 库存范围的精确取值 | 从 9.2 的三类候选中选一种并给出分类列表；建议「全部计入库存的仓」，与现行总览口径一致、最易核对 |
| 首个店铺的平台与精确店名 | 路径 A 与销售事实核实都依赖它，仍未确定 |

两项齐备后，P0-02 的接通范围才完全确定。在此之前可以先实现路径 A 的销售 reader 骨架，但单店环境的实际创建需要这两个值。

## 10. B2 范围定稿：全部计入库存的仓

用户已于 2026-10-29 选定「全部计入库存的仓，与现行总览口径一致」。查证时发现系统存在**两层不同的库存口径**，本节固定授权取值并说明二者区别，避免施工时取错。

### 10.1 两层口径必须分清

| 口径 | 定义位置 | 范围 | 用途 |
| --- | --- | --- | --- |
| `includedInInventory` | [warehouse_mapping.py](../../backend/inventory/warehouse_mapping.py) 的 `classify_warehouse()` 产出，权威取值来自 `config/inventory-warehouse-mapping.json` | 该 config 共 284 个仓，**66 个计入**；按分类为 `jd` 45、`guangdong` 8、`dropship` 4、`sample` 4、`cainiao` 3、`afterSales` 1、`overseas` 1 | 库存总览、补货计划输入（[query.py](../../backend/inventory/query.py) 第 529 行以此过滤） |
| `HEALTH_WAREHOUSE_CATEGORIES` | [query.py](../../backend/inventory/query.py) 第 32 行 | 仅 `{jd, cainiao, guangdong, selfOperated}` 四类 | **只用于库存健康分布**（第 515 至 520 行 `_health_distribution_items()`） |

[系统架构](../规范/系统架构.md) 所述「健康分布只统计京东仓、天猫履约仓、精确广东仓和自营仓，工厂代发、售后、样品、海外不得计入」指的是**后者**，不是 `includedInInventory`。本文第 9.2 节此前把两者混为一谈，此处更正。

用户选定的「与现行总览口径一致」对应**前者 `includedInInventory`**，即 66 个计入仓，其中确实包含少量 `dropship`、`afterSales`、`sample`、`overseas` 仓。这不是配置错误，而是总览口径与健康分布口径本就不同。

### 10.2 授权取值

```json
{"inventoryGrant": {"scopeKind": "included_in_inventory",
  "mappingVersion": "<config 文件 SHA-256>", "grantRef": "<授权记录>"}}
```

- `scopeKind` 固定为 `included_in_inventory`，不枚举具体仓名或分类：枚举会在 config 更新后静默过期，而该字段直接复用服务端既有的 `includedInInventory` 过滤。
- `mappingVersion` 绑定 `config/inventory-warehouse-mapping.json` 的内容摘要。该 config 的分类与计入标记可由管理员更新（`warehouse_mapping_json`、`warehouse_mapping_updated_by`、`warehouse_mapping_updated_at` 见 [inventory/models.py](../../backend/inventory/models.py) 第 480 至 482 行），范围变化必须形成新版本，不回写历史报告。
- 读取时与当前 principal 交叉核验；模型不可填写或修改该字段。

### 10.3 报告中的披露要求

库存章节须写明：范围为「全部计入库存的仓」（当前 66 个）、`mappingVersion`、`grantRef`、授权时间与授权人、快照 `asOf`，并明确**该范围不是本店**。

额外一条：若日报同时呈现库存健康分布，该分布的实际范围是更窄的四类仓，与本章节的 66 仓口径不同，**必须分别标注**，不能让读者以为是同一范围的两种切法。

仍然禁止任何按店归因的计算：不得用本店销售额与该范围库存做比率、周转或覆盖天数推断。

### 10.4 首店与设计状态

首店已于 2026-10-29 定为**志高商用设备旗舰店（平台：京东）**。路径 A 的实现设计见 [路径 A 设计](PATH-A-DESIGN.md)。

该设计可直接施工，但其第 6 节 U1 为阻断级未验证点：该店在销售事实表中 `shop_name` 是否有值尚未核实（生产只读连接串未取得，核实脚本为 [tools/shop-sales-readonly-probe.py](../../tools/shop-sales-readonly-probe.py)）。若为空，双字段过滤将匹配零行，须调整取数条件。实施取数逻辑前应先排除该点。
