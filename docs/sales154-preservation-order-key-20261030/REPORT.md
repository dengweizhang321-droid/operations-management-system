# Sales154 preservation 排序键修复（2026-10-30）

## 问题

2026-10-30 的 Sales154 停站发布死在第 11 步「迁移监控字段」：

```
at     2026-10-29T16:58:04Z，本步耗时 55010ms
error  Verify exact finite migration result 失败（exitCode=1; outputRecordCount=1;
       outputSha256=985c87dab0ce0a26885095c050598b52055d616861a4bc16a436d7d1c0dc3398）
```

错误原文没有落盘（`迁移监控字段.stdout.log` 为 0 字节，
`Get-NativeFailureSummary` 只保留输出的 sha256）。用 runtime venv python
在只读连接上复跑同一段门禁，取得原文：

```
psycopg.errors.UndefinedColumn: column "id" does not exist
LINE 1: SELECT to_jsonb(t) FROM "ai_pi_agents" t ORDER BY id LIMIT 1...
  File tools/sales_preflight_catalog.py, line 49, in preservation
```

## 根因

`preservation()` 对 `pi_native_catalog.TABLES` 的七张表一律按 `ORDER BY id`
取行快照，但其中三张主键是 OneToOne 外键，Django 生成的列名带 `_id` 后缀，
没有 `id` 列。生产库实测：

| 表 | 有 id? | 主键列 |
| --- | --- | --- |
| `ai_pi_agents` | 否 | `session_id` |
| `ai_pi_business_delegations` | 否 | `intent_id` |
| `ai_pi_native_states` | 否 | `root_session_id` |
| `ai_pi_agent_messages` | 是 | `id` |
| `ai_pi_agent_waits` | 是 | `id` |
| `ai_pi_file_handoffs` | 是 | `id` |
| `ai_pi_plan_revisions` | 是 | `id` |

按 `sorted()` 顺序 `ai_pi_agents` 第一个命中。空表也会报同样的错 ——
PostgreSQL 在查询规划阶段就拒绝，与有无数据无关。

调用位置在 `sales_preflight_addition.install_schema` 里、
`publish(intent_file, ...)` **之前**，所以 `install-intent.json` 从未写出，
数据库完全没被改动（发布后实测：`django_migrations` 153 条、
`sales_excluded_date_idx` 不存在、无 invalid 索引）。

## 为什么既有测试没发现

这条继承链的现有测试（`test_pi_agent_addition.py` 等）全部注入假 cursor，
假 cursor 接受任何列名，列名错误不会报错。Sales154 这一层也是整条链里
**唯一没有 rehearsal 脚本**的一层（上游每层都有
`pi_agent_rehearsal.py`、`ai_schedule_addition_rehearsal.py` 等），
所以 `preservation()` 从未在真实数据库或真实 SQL 引擎上执行过。

## 改动

### `tools/sales_preflight_catalog.py`

新增 `order_columns(tables, models)`：从 `pi_native_catalog.models_at_revision()`
给出的迁移状态取每张表的 `_meta.pk.column`，`preservation()` 按它排序。

选迁移状态而不是查 `pg_index`，因为这个排序键进 `legacyRowsSha256`，
而该摘要要在 install 与 finalize 两次调用间比对相等
（`sales_preflight_addition.py:281`）。钉在已审阅的迁移字节上，
就不受运行时库状态变化影响。`models_at_revision()` 是该模块已有函数
（`verify_catalog` 也在用），复用而非另造。

成员漂移和缺主键都显式拒绝，不静默回退到 `id`。

### `tests/test_sales_preflight_addition.py`（新增）

四个测试，其中两个用真实 SQL 引擎（sqlite 同样在准备阶段拒绝未知列）：

- `test_order_columns_follows_the_declared_primary_key`
- `test_order_columns_rejects_membership_drift_and_missing_keys`
- `test_preservation_statement_runs_against_a_real_sql_engine`
- `test_preservation_orders_by_the_resolved_key_for_every_table`

**已验证这组测试能抓住原 bug**：把语句还原成 `ORDER BY id` 后，
`test_preservation_orders_by_the_resolved_key_for_every_table` 失败并报
`no ORDER BY session_id statement for ai_pi_agents`；恢复修复后 4/4 通过。

### 摘要更新

改 `tools/sales_preflight_catalog.py` 必然改 `code_digest`（它在
`sales_preflight_addition.CODE_FILES` 的 86 个文件里），因此同步更新：

```
codeSha256        e411415d0a76aae5ba8648e3db2b306c82dcd786262eb8171eff6e593875b1a1
               -> e28cfe42b6684b1dea639af9da03510b6fc694a978bf33dda75d4dd1cfa10704
validationSha256  4cd684632b28cef6c4770bd452f6e211b29ae7f3b0da994a04d406eafa7dbb4a
               -> a1be0123e18c6a5f981c3ebcf03e7be6bdd020e2cbdc7879c1de314a5c7abe33
```

- `config/main-schema-releases/sales-0012.json`：两个值
- `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json`：
  `codeSha256`、`checkedAt`、`evidence`（指向本次证据）

`recipeSha256` 不在仓库里声明，发布时由 `main-schema-release.mjs` 实时计算。

## 必需代码检查

`run-mandatory-checks.py`（复制自上次任务，脚本本身未改）在本树执行，
结果见同目录 `MANDATORY-CHECKS.json`：

```
checks        migration-closure, node-syntax, powershell-syntax, python-syntax
python        passed (57 files)
node          passed (5 files)
powershell    passed (11 files)
json          passed (14 files)
codeSha256    e28cfe42b6684b1dea639af9da03510b6fc694a978bf33dda75d4dd1cfa10704
codeFileCount 86
baseCommit    930509cc39185903c9051709b06872cd4c0c858f
databaseContacted / productionTouched / functionalValidationPerformed  全部 false
```

该脚本的 `codeSha256` 与我单独用 `gate.code_digest()` 算的一致，两个独立
口径对上。绑定链 16 项用门禁自己的读取器核过，全部自洽。

## 既有失败基线

`tools/` 里六个同类 addition 测试在改动前后对照：

```
基线（origin/main 的 sales_preflight_catalog.py）  73 测试  3 failures  2 errors
本次改动                                           77 测试  3 failures  2 errors
```

同样那 5 个失败，新增的 4 个全绿。既有失败：

```
FAIL  test_jd_monitor_preferences_addition ... test_windows_powershell_real_lifecycle_function_and_package_inventory
FAIL  test_jd_product_monitoring_addition  ... test_windows_powershell_real_lifecycle_function_and_package_inventory
FAIL  test_tmall_warehouse_addition        ... test_native_lifecycle_routes149_and_retains_failure
ERROR test_jd_monitor_preferences_addition ... test_rehearsal_rejects_real_production_checkout_and_runtime_before_start
ERROR test_jd_product_monitoring_addition  ... test_rehearsal_rejects_real_production_checkout_and_runtime_before_start
```

这五个与本次改动无关，基线上已存在，不在本次范围内。

## 影响面

全仓 `ORDER BY id` 共 39 处，其中遍历动态表集合的只有三处：

| 位置 | 遍历的集合 | 结论 |
| --- | --- | --- |
| `sales_preflight_catalog.py:49` | `pi_native_catalog.TABLES`（7 张） | 本次修复 |
| `pi_native_catalog.py:131` | `pi_business_catalog.TABLES`（3 张） | 安全，三张都有 `id` |
| `pi_agent_catalog.py:82` | 写死的 5 张 `ai_*` 表 | 安全，与 TABLES 无关 |

未改 `pi_native_catalog.py` —— 它当前正确，改它会动已上线代码的字节
并触发原生资格化要求。

`ai_pi_gateway_nonces` 主键是 `nonce` 而非 `id`，但只出现在
`pi_agent_catalog.TABLES` 里，而 `:82` 不遍历那个集合，不受影响。

## 未做与待确认

- **未建 Sales154 的 rehearsal 脚本。** 这一层缺 rehearsal 是本 bug 的
  结构性原因，补齐需要隔离库和建表，超出本次最小修复范围。建议另立任务。
- **发布失败不留错误原文**是独立缺口：`Get-NativeFailureSummary` 只存
  sha256，`.stdout.log` 为 0 字节，同样的失败下次仍然查不出来。另立任务。
- **PG 备份阻塞**（自 2026-10-19 起）报
  `Pi153 column/default drift: ai_pi_native_states`，指向同一张表，
  可能同根因但**本次未验证**，不作结论。
- 本次只做代码修改与资料，未合并、未准备制品、未发布。

## 重试发布不需要重新准备制品

上次失败的制品本身完好，三个摘要已逐字节复算一致。本次改动后
`codeSha256` 变化需要新候选，但不需要重走「准备制品」之前的排查流程。
注意上次回退已把 `app` 与 `app.previous` 对调，当前
`app/` = 3142 文件 `6defc323…`（发布前旧代码），
`app.previous/` = 3148 文件 `a2a1a2c9…`（被退掉的 Sales154 新代码）。
