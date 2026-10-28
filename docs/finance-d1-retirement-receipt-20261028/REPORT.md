# finance 域 D1 退役回执：数据等价核对（2026-10-28）

- 分支：`codex/finance-d1-retirement-receipt-20261028`，基线 `main` = `837c9f39`
- 性质：**纯文档**，无应用载荷变更
- 授权依据：用户于 2026-10-28 明确授权执行 finance 的只读 PG 对照
- 执行方式：**全程只读**，未写入、未建表、未修改任何配置

## 一、本文件回答什么、不回答什么

`docs/技术专题/领域迁移/django-finance-migration.md:146` 规定，D1 财务对象在 **「稳定观察、旧路径不可达证明和独立退役审批」** 三者齐备前继续作为受写保护的审计材料保留。

**本文件只提供其中的数据等价证据**，即回答一个具体问题：*D1 里那 40233 行财务数据，是否已全部安全存在于 PostgreSQL？*

**本文件不宣布 finance D1 退役完成。** 对照销售域的退役标准（`django-sales-migration.md:300-301, 330`），一次完整退役还需要：受控操作者专用退役迁移（销售域是 `0092_sales_domain_retirement.sql`）、退役对象清单与 DDL、代码扫描留证、退役后整套系统测试与观察期指标，以及**独立退役审批**。这些都不在本次只读核对范围内，须单独立项与授权。

## 二、核对结论

**D1 的 finance_lines 是 PostgreSQL 的严格子集。零行、零字段为 D1 独有。**

| 项 | D1（SQLite） | PostgreSQL（权威） | 判定 |
| --- | --- | --- | --- |
| `finance_lines` 行数 | 40233 | 44767 | PG 多 4534 |
| 月份跨度 | 2025-01 … 2026-07（19） | 2025-01 … 2026-09（21） | PG 多 2 个月 |
| `SUM(amount_cents)` | 328,591,023,861 | 367,572,305,208 | 差额全部来自多出的两月 |
| `SUM(rate_bps)` | 286,952,245,646 | 286,952,976,533 | 同上 |
| 非空 amount / rate | 35537 / 4228 | 39541 / 4713 | — |
| `finance_months` | 19 | 21 | — |
| `finance_import_batches` | 3 | 5 | — |

行数差额逐月归因，**完全吻合**：

```
month      D1 rows   PG rows          D1 amount          PG amount
2026-08          0      2294                  0        19,004,075,518
2026-09          0      2240                  0        19,977,205,829
                      ------                            --------------
                        4534                             38,981,281,347
```

2294 + 2240 = 4534 = 行数差；19,004,075,518 + 19,977,205,829 = 38,981,281,347 = 金额差。**D1 的数据停在 2026-07，此后业务只写入 PG**，与写权威早已切换一致。

**除这两个月外，其余 19 个月的行数与金额在两侧逐月完全相等。**

## 三、逐行逐字段核对（关键证据）

汇总数相等可能被正负抵消掩盖，故未止步于聚合。按 D1 的 UNIQUE 约束 `(month, section, scope_key, subject_name)` 取出 40233 行的**全部 15 个字段**逐行比对：

比对字段：`metric_key`、`scope_type`、`scope_name`、`group_name`、`value_type`、`amount_cents`、`rate_bps`、`raw_value`、`source_row_count`、`sort_order`、`is_total`（加 4 个键字段）。

```
D1 rows: 40233   PG rows: 44767
D1 keys absent from PG         : 0
shared keys with differing data: 0

RESULT: every D1 finance_lines row exists in PG with identical field values.
```

**零缺失、零字段差异。丢弃 D1 的 finance 数据不会损失任何财务事实。**

## 四、切换回执早已存在，只是不在按域归档的位置

交接记录称 finance 是「唯一缺退役回执」的域。实测：**受控切换本身有完整回执**，记录在数据库里而非文档树中。

PostgreSQL `finance_write_authority`（实测读取）：

| 字段 | 值 |
| --- | --- |
| `status` | `postgres` |
| `authority_epoch` | `2154ae48-b359-4064-bfb0-91b4b5fee375` |
| `cutover_id` | `finance-pg-20260830T194437Z-184fdca41051401f` |
| `migration_verify_run_id` | `af76d860242440919caaa2069536fa57` |
| `activated_at` | 2026-08-31 03:49:46.479038 +08:00 |

D1 侧 `finance_write_authority`（只读读取）：`owner=postgresql`、`epoch=3`、`cutover_id` 与 PG 侧**完全一致**、`updated_at=2026-08-30 19:49:46`。

另有 `finance_migration_runs` 9 行、`finance_data_revisions` 1 行。

**结论**：finance 早在 2026-08-30/31 完成了带 verify run id 与唯一 cutover id 的受控切换，两侧 authority 记录互相吻合。所谓「缺回执」是**回执以数据库行而非归档文档形式存在**，不是切换未做。本文件即补上文档侧的归档回执。

## 五、旧路径不可达性（部分证据）

| 检查 | 实测结果 |
| --- | --- |
| Worker 财务路由模式 | `lib/django/finance-service.ts:107-111`：仅接受 `django`，`legacy`/`shadow` 一律 `throw unavailable(...)`。**旧模式在代码层已不可达** |
| D1 写保护触发器 | 实测 46 个：其中 **39 个**抛 `finance_write_authority_not_d1`（覆盖 11 张 `finance_*` 表 + 3 张共享导入控制表上 9 个 `finance_authority_*` 守卫），另 7 个为结构性触发器（版本化 4 个、singleton/transition 守卫 3 个） |
| D1 文件最后写入 | `9,586,368,512` bytes，mtime **2026-09-06 01:45**，切换后 52 天未再被写入 |

> **与既有文档的数字差异**：`django-finance-migration.md:189` 记「42 个永久写 guard」。本次实测按两种口径均不等于 42——按表前缀归属为 37（仅 `finance_*` 表）、按名称含 finance 或表属 finance 为 46、按「抛 `finance_write_authority_not_d1`」为 39。本文件记录实测口径与数字，不改写既有文档的历史记载；差异原因（统计口径或此后迁移新增）未查清，留待退役立项时核。

**尚缺的不可达性证据**：构建产物层扫描、运行时 binding 核查、退役后系统测试。这些属退役立项范围。

## 六、执行方式与安全性核验

**只读保证**：

- SQLite 侧以 `file:<path>?mode=ro` URI 打开，内核级只读句柄
- PostgreSQL 侧使用最小权限角色 `teruisi_finance_reader`，连接串设 `default_transaction_read_only=on` 与 `statement_timeout=20000`，并在 psycopg 层显式置 `connection.read_only = True`
- 凭据经项目自有 DPAPI 路径（`django-local-service.ps1:476-485`，CurrentUser 作用域）解密，**明文未进入任何输出、日志或文件**
- 查询仅 `SELECT` / `COUNT` / `SUM` / `information_schema`

**事后核验未写入**：

| 核验项 | 结果 |
| --- | --- |
| D1 `.sqlite` 文件 | 9,586,368,512 bytes，mtime 仍为 2026-09-06 01:45，**字节未变** |
| D1 `-wal` | 仍为 0 字节、2026-09-06，**无新事务** |
| D1 `-shm` | 时间戳更新（共享内存索引，只读 WAL 访问的正常行为，不含数据） |
| 临时脚本 | 已全部删除 |
| 仓库状态 | 干净，`main` 仍为 `837c9f39` |

**最小权限的正面证据**：读 `finance_migration_runs` 时首次撞上 `psycopg.errors.InsufficientPrivilege`，确认该 reader 角色确实被限制在授予的 6 张表（`finance_data_revisions`、`finance_erp_targets`、`finance_import_batches`、`finance_lines`、`finance_months`、`finance_targets_scoped`）上，权限设计按预期生效。

## 七、这解锁与未解锁什么

**解锁**：D1 那 9.0 GB 中 finance 部分的数据安全性已有据可查。`.wrangler/state` 迁移/归档方案在评估 finance 时不再需要把「数据可能唯一」作为阻塞项。当前 D 盘剩余 **59 GB**（10-27 记录为 89 GB），归档的实际收益较交接时更高。

**未解锁**：

1. **代码侧不能照搬 workflow 的删除判断。** `lib/finance/database.ts` 虽无直接导入，但 `lib/finance/analysis.ts`、`import-service.ts`、`normalized-import.ts` 三个兄弟文件仍以 `./database` 相对路径引用它，其中 `analysis.ts`、`normalized-import.ts` 各有 1 个外部生产导入方，`app/api/finance/` 下另有 5 个路由。**数据可归档 ≠ 代码可删除。**
2. **退役本身仍需独立审批**，连同第一节列出的受控退役迁移、对象清单、代码扫描与观察期指标。
3. 第五节记录的 guard 计数口径差异未查清。

## 八、复现方式

本次核对脚本为一次性只读工具，执行后已删除，未入库（避免在仓库留下一份含数据库连接逻辑的脚本）。复现要点：

1. SQLite 侧：`sqlite3.connect("file:<d1>?mode=ro", uri=True)`
2. PG 侧：以 `teruisi_finance_reader` 连 `teruisi_sales`，置 `default_transaction_read_only=on`
3. 按 `(month, section, scope_key, subject_name)` 建字典，比对上列 11 个载荷字段
4. 事后核验 `.sqlite` 的 mtime 与字节数、`-wal` 大小

## 变更记录

2026-10-28：建立。补上 finance 域文档侧的数据等价回执；明确本文件不等于退役完成，并记录尚缺的退役前置条件。
