# P0-01 工具可达矩阵（日报案例）

日期：2026-10-29。基线：`f205e96f`（`origin/main`）。方法：脚本机械提取 [tool-registry.ts](../../lib/ai/tool-registry.ts)，非人工阅读；条目名含常量引用（如 `NETSHOP_PRODUCT_INSIGHTS_TOOL_NAME`）已解析为字面值。

纯盘点，未改动任何业务代码。本清单回答一个问题：**经营日报案例在 Pi 环境下实际能调用哪些工具**。

## 1. 总量与分布

注册表共 **86 个条目**，其中 `risk: "read_only"` 74 个、`risk: "write"` 12 个。

按 Pi 可达性：

| 类别 | 数量 | 判定依据 |
| --- | --- | --- |
| Pi 可达（`pi_agent` in `allowedSurfaces`） | **16** | 经 `piReadOnly()` 包装（13 个）或显式声明 `allowedSurfaces: ["pi_agent"]`（3 个） |
| 非 Pi 可达 | 70 | 仅 `ai_chat`/`ai_agent`/`dingtalk_chat`/`codex_mcp` 等其他 surface |

`piReadOnly()` 定义在 `tool-registry.ts:141`，作用是在原 policy 的 `allowedSurfaces` 追加 `pi_agent`。注释明确「Pi admission is explicit at each reviewed entry; adding another tool does not grant it」——新增工具不自动获得 Pi 准入。

运行时过滤在 [pi_gateway.py](../../backend/ai_assistant/pi_gateway.py)：第 70 行取 `transport.catalog(principal, "pi_agent")`，第 73 行与第 263 行各自再核 `"pi_agent" in execution.allowedSurfaces`，第 264 行以 `surface="pi_agent"` 执行。即 schema 声明与实际执行两侧都查，单改一处不生效。

## 2. Pi 可达的 16 个条目

「单店可用」列指 [pi_selection.py](../../backend/ai_assistant/pi_selection.py) 第 10 行 `TOOLS` 白名单——单店环境下仅这些可调用，其余一律 403「该工具不能证明单店归属，当前环境不可使用」（第 64 行）。

| 工具 | scopePolicy | 单店可用 |
| --- | --- | --- |
| `describe_system_datasets` | principal_scope | 是 |
| `get_data_freshness` | metadata_safe | 是 |
| `get_inventory_health` | unscoped_only | 否 |
| `get_inventory_page_data` | unscoped_only | 否 |
| `get_netshop_analysis_records` | unscoped_only | 否 |
| `get_netshop_page_data` | principal_scope | 否 |
| `get_netshop_performance` | principal_scope | 否 |
| `get_pi_dataset_export` | principal_scope | 是 |
| `get_pi_netshop_performance_page` | principal_scope | 是 |
| `get_product_performance` | unscoped_only | 否 |
| `get_sales_analysis_records` | unscoped_only | 否 |
| `get_sales_category_analysis` | principal_scope | 否 |
| `get_sales_summary` | unscoped_only | 否 |
| `get_system_dataset_records` | unscoped_only | 否 |
| `query_system_dataset` | principal_scope | 是 |
| `start_pi_dataset_export` | principal_scope | 是 |

## 3. 单店环境的硬边界

这是日报范围的决定性约束，不是可配置项。

**可用工具 6 个**（`pi_selection.py:10`）：`get_pi_netshop_performance_page`、`get_data_freshness`、`describe_system_datasets`、`query_system_dataset`、`start_pi_dataset_export`、`get_pi_dataset_export`。

**可见数据集 2 个**（同文件第 9 行 `DATASETS`）：`pi_netshop_product_daily`、`pi_netshop_promotion`。`describe_system_datasets` 带其他 `dataset` 参数时返回 403「当前环境仅发现可证明单店归属的数据集」。

**参数会被服务端改写**：`get_pi_netshop_performance_page` 经 `_query()` 注入店铺条件；`query_system_dataset` 与 `start_pi_dataset_export` 的 `queryJson` 经 `validate_dataset()` 重写后才下发。模型填写的范围不被信任。

该文件首行自述：单店围栏与真实 principal 取交集，**ERP 渠道与仓库不能当作店铺身份**，不能证明归属时拒绝而非放宽。

## 4. 方案第 4 节点名的 7 个工具：全部待接

方案正文列为「可接工具」的 7 个，当前**没有一个**对 Pi 可达。表述准确（是「可接」而非「已可达」），但施工时须逐个补 surface。

| 工具 | 在注册表 | Pi 可达 | 当前 surface 来源 |
| --- | --- | --- | --- |
| `search_system_knowledge` | 是 | 否 | 未经 `piReadOnly` 包装 |
| `search_personal_memory` | 是 | 否 | 未经 `piReadOnly` 包装 |
| `get_jd_promotion_diagnostic` | 是 | 否 | 未经 `piReadOnly` 包装 |
| `get_netshop_insights_context` | 是 | 否 | 仅 `synchronousReadOnlyExecution` |
| `get_netshop_product_insights` | 是 | 否 | 仅 `synchronousReadOnlyExecution` |
| `get_netshop_promotion_insights` | 是 | 否 | 仅 `synchronousReadOnlyExecution` |
| `get_netshop_promotion_object_detail` | 是 | 否 | 仅 `synchronousReadOnlyExecution` |

后 4 个的条目名使用常量而非字面量（`tool-registry.ts:1199`、`:1211` 等），按 `name: "..."` 字面检索会漏，本清单已解析。

## 5. 对日报案例的直接结论

**单店日报当前只能基于网店商品日数据与推广数据两个数据集**，经 6 个工具读取。`get_sales_summary`、`get_inventory_health`、`get_product_performance` 虽对 Pi 可达，但**不在单店白名单内**——它们的 `scopePolicy` 是 `unscoped_only`，无法证明单店归属。

因此：

- 日报若需 ERP 销售额、毛利或库存健康，当前单店环境取不到。用户已于 2026-10-29 确定日报必须包含 ERP 销售与库存；查证结论见 [ERP 销售与库存 scope 可行性](ERP-SCOPE.md)——**销售可行、库存无店铺字段故不可行**，两者分开处理。
- 知识与记忆检索（`search_system_knowledge`、`search_personal_memory`）未开放 Pi，方案 P0-02「接通必要工具与有界知识/记忆」须包含这两项的 surface 补全，且按方案第 13 节要求，单店下的业务背景记忆必须带可核店铺归属。
- 推广诊断与 4 个 netshop insights 都未开放 Pi，推广诊断案例的工具接通量大于日报。

## 6. 待用户决定

| 决定点 | 影响 |
| --- | --- |
| 首个店铺的平台与精确店名 | 决定 `shopSelection`，无此值单店围栏不生效、也无法验证归属 |
| 日报是否必须含 ERP 销售/库存指标 | 若必须，需另行授权库存 scope 或扩充单店白名单；若否，首版只做网店侧 |
| 日报必需章节 | 决定要补哪些工具的 Pi surface，进而决定 P0-02 的接通范围 |

## 7. 本清单的边界

脚本提取 86 个条目的 `name`、`risk`、`scopePolicy` 与 `execution` 块，全部解析成功、无残留未解析常量。未执行构建、未调用模型、未读取生产数据、未改动业务代码。surface 判定依据源码声明；运行时实际可见目录还受当次 principal 的角色与 scope 过滤，本清单不代替真实调用回执。
