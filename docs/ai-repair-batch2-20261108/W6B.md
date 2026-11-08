# W6b pandas 商品日完整导出与销售品类完整性

## 原失败证据

| 数据源 | 原件可确定的事实 | 尚未确定 |
| --- | --- | --- |
| `netshop_product_daily` | 11 月 7 日上海时间 19:24:18 启动 pandas，19:24:19 以 `tool_execution_failed` 结束。原诊断在该次窗口内未找到已验签并登记的 Broker nonce。商品日普通查询只提供第一页，截断时旧导出缺连续分页接线。 | 原 pandas 的确切参数、当次来源截断状态，以及停止于配置、来源导出、发送或 Broker 登记前的具体阶段。普通查询的截断回执无法替代该次 pandas 调用的入参和结果。 |
| `sales_category` | 19:29:10 首次 pandas 启动，19:29:11 以 `tool_execution_failed` 结束。19:29:17 的 `tool_limit_exceeded` 是之后的拒绝。来源代码独立证实 `trend.items` 受前 8 品类与 3000 行两个上限约束，`trend.truncated` 只反映后者。 | 原 pandas 的实际集合、列、代码、内层错误和关联 Broker 记录。聊天回复提及完整详情，无法据此断定 pandas 读取了详情或趋势。 |

原件归档摘要与脱敏的审计状态/时间见 [历史证据摘录](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/historical-source-facts.json)。旧调用未重放。商品日分页缺口与销售趋势前八品类缺口均可独立复现，原两次失败的内层原因保留为未确定。

## 实现

- `netshop_product_daily` 的 pandas 路径固定读取 `items`。Django 每页重取中央目录和水位，沿原 HMAC 签名执行入口用 `get_netshop_performance` 的内部变体重新校验角色、surface、范围及审计。公开工具 schema、普通数据集查询、普通结果上限和 Pi 专用入口沿用现有契约。
- 网店领域以平台、店铺和 SPU 区分同名商品，按原成交额、访客与商品键排序，再以平台和店铺打破并列。第一页固定 scope、筛选、页大小、来源 revision 与 owning reader 的 `snapshotToken`，后续页使用 `view=page` 并重新核对令牌和版本。来源读期间的已记录 revision 变化、页码和计数不符、重复行、字段截断及超额均拒绝整份导出。仅来源 revision 进入结果溯源，令牌不进入 DataFrame。
- `sales_category` 的 `trend.items` 校验来源品类上限、匹配品类数、趋势行数、品类与时间去重和趋势自身截断。完整详情 `items` 校验自己的匹配数、行数与截断，可通过 `columns` 选择已授权标量字段。单独的筛选选项或详情截断标记不用于证明趋势完整性。
- 仍使用 8 秒导出预算、单源 20 页、总 2000 行、2 MiB 以及原有单页响应上限。商品日受单页最多 20 行限制，最多导出 400 行，实际还受字节与时间上限。`complete` 表示本次查询的该集合已导完。业务日期或字段覆盖及跨源一致性须另看来源证据。

## 证据与交付边界

- [Django 定向测试](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/django-tests.txt) 覆盖三页、相同 SPU 跨店独立、缺页、重复、版本变化、截断、行数及字节预算。实际网店 owning ORM 在隔离 SQLite 中验证并列分页、平台范围与 scope revision 令牌失效。两个需要隔离 PostgreSQL 与真实 Broker 的既有集成测试单列为跳过。
- [Worker 定向测试](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/worker-tests.txt) 覆盖实际签名 edge handler、普通 schema、权限、钉钉 surface、连续版本令牌和逐页审计。使用合成 reader/审计响应，无模型请求。
- [Broker 候选保全证明](D:/codex-artifacts/ai-repair-batch2-20261108/w6b/broker-preservation.json) 从精确基线 `e268b28761ae4ada958455344c0dfbb37d2ae4f8` 在临时 Git index 应用原补丁。8 个改动 Git blob 和 15 份归档源文件全部一致，候选包摘要为 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。本子包冻结时运行包仍为原 8 个文件，摘要 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`。内层诊断采用由独立 Broker 轮换子包处理。
- 真实容器验证依赖本批隔离 rootless 环境就绪。现阶段已有真实 HTTP/HMAC 回环的合成 Docker 测试与上述来源验证。生产请求、数据写入、模型调用、合并及发布均无操作。
