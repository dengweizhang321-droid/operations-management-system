# 系统实时数据集 API

实现状态：源码提供 24 个实时逻辑数据集；正式环境需同时采用本次 Worker 与 Django AI reader 代码后才可调用。本文不是生产发布记录。

数据直接来自现有 Django/PostgreSQL 业务查询，不复制事实表，不建立第二写入源，不执行任意 SQL，不新增数据库迁移或数据库角色权限。适合 AI 按业务口径查询、筛选和读取有界明细与汇总；不是全库导出、训练语料快照或可无限分页的数据仓库接口。

## 入口

所有 URL 均使用系统现有同源地址；以下路径相对该地址。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/ai/datasets` | 返回当前账号可访问的数据集目录 |
| GET | `/api/ai/datasets/{dataset}` | 返回业务口径、固定筛选、`querySchema` 和执行上限 |
| POST | `/api/ai/datasets/{dataset}/query` | JSON 正文 `{"query": {...}}`，按该数据集 schema 查询 |
| GET | `/api/ai/tools` | 现有中央 AI 工具目录，包含两个新数据集工具 |
| POST | `/mcp` | 现有 MCP JSON-RPC `tools/list`、`tools/call` 入口 |

GET 不接受查询字符串；查询条件放在 POST 的 `query` 对象内。API 使用系统已有的真实用户认证，不新增匿名入口或通用 API Key。POST 还必须提供精确同源 `Origin` 或 `Sec-Fetch-Site: same-origin`。普通 viewer 可查询其权限范围内的数据集，管理和写接口的角色限制不变。外部 AI 客户端仍需接入现有认证链路；不能把客户端提供的 email、role、scope 或内部签名头当作身份。

公开请求由薄 Worker 鉴权、解析和签名后进入现有 AI reader；Django 负责显式数据集映射，通过已签名执行桥调用中央只读工具。每次来源查询由中央执行器进行参数验证、权限校验、超时/体积限制和开始/完成审计。审计仍经 AI writer 写入 PostgreSQL；业务数据不写入。

## 数据集

| 业务域 | 稳定数据集 ID |
| --- | --- |
| 销售 | `sales_summary`、`sales_category` |
| 库存 | `inventory_health`、`inventory_age`、`inventory_inbound`、`inventory_guangdong`、`replenishment_plans` |
| 商品经营 | `product_performance` |
| 网店 | `netshop_catalog`、`netshop_products`、`netshop_product_daily`、`netshop_promotion` |
| 市场 | `market_overview`、`market_sku_trend`、`market_brands`、`market_price_bands`、`market_pending_review` |
| 财务 | `finance_analysis`、`finance_targets` |
| 客服 | `customer_service` |
| 运营事务 | `workflow_tasks`、`workflow_operations`、`workflow_launch_projects`、`workflow_templates` |

目录依据中央工具的角色和 scope 策略筛选。当前财务、库存库龄/入仓、工作事项/新品/模板等无法安全应用受限 scope 的能力会隐藏并拒绝查询。数据内容继续按来源的仓库、平台、渠道及店铺范围校验。客服沿用现有安全投影与角色限制。ERP 参照继续通过现有商品经营数据消费；没有开放 ERP 全表、用户权限表、凭据、原始聊天、附件字节和任意数据库对象。

参数 schema 从唯一中央注册表派生；每个数据集的固定选择器由 Django 注入，调用者不得传入。例如 `inventory_age` 固定 `view=age`，其 `querySchema` 不含 `view`。输入类型、枚举、必填、日期格式和行数上限仍由原工具验证。不要假设所有数据集都支持相同的字段或分页形式。

## 调用示例

在已登录系统的同源页面中，先发现数据集并读取参数：

```javascript
const catalog = await fetch('/api/ai/datasets').then(r => r.json());
const schema = await fetch('/api/ai/datasets/sales_summary').then(r => r.json());
const response = await fetch('/api/ai/datasets/sales_summary/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: {
    range: 'custom', startDate: '2026-09-01', endDate: '2026-09-07'
  } })
});
if (!response.ok) throw new Error(`数据集查询失败：${response.status}`);
const result = await response.json();
```

日期参数沿用各工具现有契约；底层业务时间使用上海时区，并保持既有左闭右开过滤实现。金额/净额/退款/销量以 schema 描述及来源字段为准；销售与财务金额通常为人民币分，不得不经确认将不同字段统一缩放。网店访客不能解释为店铺去重 UV。

AI 的两个新工具：

```json
{"name":"describe_system_datasets","arguments":{}}
```

```json
{"name":"describe_system_datasets","arguments":{"dataset":"sales_summary"}}
```

```json
{"name":"query_system_dataset","arguments":{"dataset":"sales_summary","queryJson":"{\"range\":\"custom\",\"startDate\":\"2026-09-01\",\"endDate\":\"2026-09-07\"}"}}
```

`queryJson` 是参数对象的 JSON 字符串，便于不同数据集使用各自严格 schema；不是 SQL、表达式或代码。外部调用仍使用上述 HTTP API 和真实认证，系统内 AI chat/Agent 的工具目录会自动包含这两个中央声明，不需要复制工具定义。

已有 MCP 客户端也可通过 `/mcp` 的 `tools/list` 发现两个新工具，再用 `tools/call` 调用。该入口沿用既有 Bearer 配置及服务身份，Django 仍核验对应账号处于启用状态且权限匹配；本次不创建凭据、不自动登记管理员身份、不改 MCP 鉴权。MCP 单条请求另受现有 12 秒预算限制；接口可发现不代表正式连接与账号已经配置完成。

## 结果与限制

- `schemaVersion`：当前为 `1`。
- `source`：业务域、实际中央工具名和权威存储说明。
- `requestId`：与来源工具审计关联；重复请求会重新查询，不复用历史响应。
- `queriedAt`：请求结果生成时间，不是数据覆盖日期。
- `freshness`：查询前自动执行 `get_data_freshness` 获得的销售和库存水位，仅代表这两个域。
- `dataCutoffDate`：来源显式给出的同名字段，否则为 `null`；其他域应继续查看 `data.coverage` 等来源字段，不能借用销售日期。
- `data`：原工具的业务 JSON，保留明细、汇总、`total`/`returned`/`truncated`、coverage、revision 等来源已提供的元数据；不会为缺失字段伪造值，不对截断明细重算完整总计。
- `consistency=live_per_source`：来源实时读取，不承诺跨域或跨页的原子快照。`X-AI-Revision` 是 AI 域 revision，不能作为业务数据版本或分页快照令牌。

查询对象最多 8000 UTF-8 字节。每个来源工具保留其原有行数、分页、超时和结果字符限制；数据集结果封装最多 39,500 个字符和 140,000 字节，超限返回 413，调用方应减小日期范围或分页大小。AI 数据集查询单次最多 30 秒、每轮最多 2 次；来源调用另受原工具限制。未取得水位、审计不可用、权限/策略变化、后端异常或取消时失败关闭，不返回上次结果。查询的 POST 仍是业务只读，但会生成正常工具审计。

Django 数据集目录与查询共用每进程最多 2 个执行槽，网络调用共用 28 秒预算；繁忙时返回 429。客户端取消会中止边缘等待，Django 已发起的只读调用仍受剩余预算限制，可能完成其正常审计，不会转成后台无界任务。

常见响应：400 参数无效；401/403 身份或权限失败；404 数据集不存在或不可访问；413 结果或请求超限；429 执行繁忙；503 来源、审计或内部服务不可用。API 默认 `Cache-Control: no-store`。

## 验证与采用

在隔离工作树运行 `node --import tsx --test tests/system-datasets.test.ts tests/django-ai-service.test.ts tests/ai-tool-calling.test.ts` 和隔离 SQLite 的 `python backend/manage.py test ai_assistant`，再运行项目单元测试、lint、后端边界检查和构建。测试覆盖固定选择器、防任意字段、权限目录、scope、签名、reader/writer 分流、审计失败、取消、参数/结果边界及中央 registry/provider schema 一致性。

正式采用必须同时发布 Worker 与 Django AI 代码，再以真实 principal 回查目录、schema、查询和拒绝路径；沿用现有受控发布及前向恢复流程，不启用新服务、不变更 authority，不回退 D1。首次部署后才可以把本文源码实现状态改为正式可用状态。
