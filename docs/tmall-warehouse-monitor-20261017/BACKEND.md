# 天猫入仓监控后端验证

2026-10-17，独立开发树 `D:/codex-worktrees/tmall-warehouse-monitor-20261017`。本报告仅覆盖 Django inventory 实现和 SQLite 聚焦验证；独立审查待做，PostgreSQL 结构、最小权限及并发证明由本任务 schema_delivery 子任务另行记录。

## 实现范围

- `inventory.0017_tmall_warehouse` 只新增 scope、batch、fact、audit 四张 `inventory_tmall_warehouse_*` 表，没有业务数据迁移、导入或回填。
- 天猫事实独立，不写 ERP `inventory_stock_lines` 或京东物流事实。货主范围使用独立版本，发布复用库存 authority、全局 revision 行锁和事务；同货主及日期全量原子替换，失败回滚旧事实、版本和批次。
- 内容指纹包含货主、快照日及完整规范业务集合，忽略文件名、原文件哈希、行序及源行号。相同内容产生 duplicate 批次并引用有效原批次，回查现存事实，不补插事实。内容 A→B→A 会重新发布 A。
- 仓库身份优先使用 `code:<warehouseCode>`，无编码时使用 `name:<warehouse>`；同名异编码仓独立，重复货品ID及仓库身份拒绝。

## API 契约

内部/公开路径均为 `/api/inventory/tmall-warehouse`。响应为 `{success:true,data:{contractVersion:"tmall-warehouse-v1",mode:"live",revision,...}}`，响应 `Cache-Control:no-store`，成功附库存 revision header。

GET 支持 `operation=monitor|batches|options`、`owner`、`warehouse`、`q`、`page`、`pageSize`、`batchId`。读取仅无数据范围限制的 viewer/analyst/operator/admin，且为库存 reader 或 development 进程。

- `options`：`owners:string[]`、`warehouses:string[]`、`scopeRevisions:{[owner]:number}`；未登记货主按调用方版本 0 提交。仓库选项取各货主最新快照，可按 owner 缩小。
- `monitor`：逐货主取最新有效快照日，再筛选、按 owner+goodsId 聚合和分页。`items` 含货品身份、名称、品牌、货主、快照日、`warehouseCount`、完整当前页 `warehouses` 明细、`totals` 和 `quantityCoverage`。响应另含完整筛选范围的 `totals/quantityCoverage/rowCount/asOf` 及分页 `total/page/pageSize/returned/truncated`。
- `batches`：分页批次，支持 batchId 精确回查。字段包括 `id/owner/snapshotDate/rowCount/status/fileName/rawFileHash/contentHash/createdAt/collectedAt/sourceDate/sourceAsOf/sourceUrl/scopeRevision/referenceBatchId/isCurrent`。`isCurrent` 仅表示该批次仍被该货主最新监控日期的现存事实引用；duplicate 本身不持有事实。

POST 仅无范围限制的 admin，经库存 writer、签名 principal 和既有写请求重放保护执行。字段为 `owner/snapshotDate/fileName/rawFileHash/rows`，并支持 `expectedScopeRevision/collectedAt/sourceDate/sourceAsOf/sourceUrl/collectorEvidence`。

- 建议前端和自动化在开始前读取 options 并冻结 expectedScopeRevision。兼容未显式传入的请求在服务开始读取范围版本，并于提交时 CAS，拒绝处理期间的竞争变化。
- 有 sourceDate 时必须等于 snapshotDate；若同时没有 collectedAt，必须显式提供 expectedScopeRevision。无 sourceDate 的实时导入必须有带时区 collectedAt，且其上海日等于 snapshotDate。较旧采集不能用新内容覆盖同日较新的实时快照。
- sourceUrl 省略时为固定 SCP 实时库存页面，显式提供时必须精确匹配。采集证据仅限有界标量对象，拒绝凭据字段。采集证据只用于审计，不作为登录身份或来源真实性证明。
- 行字段：`goodsId/goodsCode/goodsName/warehouse/warehouseCode/region/owner/brand`，可空数量字段 `availableQuantity/onHandQuantity/salesOccupiedQuantity/goodAvailableQuantity/goodOccupiedQuantity/defectiveQuantity/purchaseInTransitQuantity/transferInTransitQuantity/sales7dQuantity/sales30dQuantity`，以及 `sourceAttributes/sourceRowNumber`。数量拒绝布尔、字符串和非有限数，范围 ±10亿，最多6位小数。
- 成功返回批次字段及 `batchId/status("completed"|"duplicate")/verified:true/revision`；成功前核对落库完整内容指纹和行数。预校验失败只写拒绝审计，不创建业务范围或指纹。

未知数不作为零。任一仓数量未知时，该指标的商品及范围 totals 为 null，`quantityCoverage` 返回 knownRows/totalRows/complete；原始明细继续区分 null、0 和负数。

补货固定30天。每仓 `turnoverDays=availableQuantity/(sales30dQuantity/30)`，零或负销量保留未知；`suggestedQuantity=max(0,ceil(sales30dQuantity-availableQuantity-purchaseInTransitQuantity-transferInTransitQuantity))` 仅全部依据已知且销量非负时计算。逐仓正缺口相加，富余仓不抵消缺口仓；任一仓依据缺失时合计建议保留 null。原报表没有明确期间的销售出库，不可作为30日销量。

边界：导入1–20,000行，请求24MiB；分页每页最多100个商品、页码最多10,000；当前页分仓最多5,000行，超过后失败并提示缩小范围；选项最多200货主、500仓库。汇总在数据库按完整筛选范围计算。

## 验证

使用已安装 Python 依赖，仅执行工作树源码；`TERUISI_DJANGO_ENVIRONMENT=test`、`TERUISI_DJANGO_PROCESS_ROLE=development`，清除数据库 URL，SQLite 路径指向私有 artifacts。测试数据库由 Django 使用临时内存库创建和销毁，未连接正式业务库。

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONUTF8='1'
$env:TERUISI_DJANGO_ENVIRONMENT='test'
$env:TERUISI_DJANGO_PROCESS_ROLE='development'
$env:TERUISI_DJANGO_SQLITE_PATH='D:\codex-artifacts\tmall-warehouse-monitor-20261017\tmall-unit.sqlite3'
Remove-Item Env:TERUISI_DJANGO_DATABASE_URL -ErrorAction SilentlyContinue
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' manage.py test inventory.tests.test_tmall_warehouse --verbosity 1
& 'D:\teruisi-runtime\django-sales\venv\Scripts\python.exe' manage.py makemigrations inventory --check --dry-run
git diff --check -- backend/inventory
```

16项测试通过，覆盖原子替换、回查失败回滚、跨货主/日期/领域隔离、内容重复与内容回退、重复身份、未知和部分覆盖、完整范围汇总、30日逐仓补货、批次精确回查、来源日期/上海日、旧采集拒绝、版本冲突、角色/scope/reader-writer隔离、签名重放及有界输入。测试日志：`D:/codex-artifacts/tmall-warehouse-monitor-20261017/backend-sqlite-tests.log`。migration 检查无漂移，差异格式检查通过。

本子任务未提交、未推送、未执行正式迁移、导入、部署、启停或外部消息发送。
