# 修 Sales154 发布失败：preservation() 对无 id 列的表发 ORDER BY id

## 任务

修 `tools/sales_preflight_catalog.py:49`。该行对 `pi_native_catalog.TABLES`
里的七张表一律按 `ORDER BY id` 取行快照，但其中三张没有 `id` 列，
PostgreSQL 在查询规划阶段就拒绝，整个 Install 步骤退出 1。

在独立开发树做最小修复，完成后先给我核再谈采用。

## 失败现场

2026-10-30 的 Sales154 停站发布死在第 11 步「迁移监控字段」：

```
step   迁移监控字段（bi-app-adopt.ps1 Install -AdditionKind SalesPreflightIndex）
at     2026-10-29T16:58:04Z，耗时 55010ms
error  Verify exact finite migration result 失败（exitCode=1; outputRecordCount=1;
       outputSha256=985c87dab0ce0a26885095c050598b52055d616861a4bc16a436d7d1c0dc3398）
```

错误原文没有落盘（`迁移监控字段.stdout.log` 是 0 字节，
`Get-NativeFailureSummary` 只保留 sha256）。我用 runtime venv python
在只读连接上复跑同一段门禁，拿到了原文：

```
psycopg.errors.UndefinedColumn: column "id" does not exist
LINE 1: SELECT to_jsonb(t) FROM "ai_pi_agents" t ORDER BY id LIMIT 1...
                                                          ^
  File tools/sales_preflight_catalog.py, line 49, in preservation
    cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY id LIMIT 100001")
                   .format(sql.Identifier(table)))
```

调用链：`install_schema` → `preservation(cursor)`（`sales_preflight_addition.py:311`，
在 `publish(intent_file, ...)` 之前）。所以 `install-intent.json` 从未写出，
**数据库完全没被改动** —— 已核实：`django_migrations` 153 条、
`sales_excluded_date_idx` 不存在、无 invalid 索引。

## 根因

`pi_native_catalog.TABLES` 的七张表里，三张主键是 OneToOne 外键，
Django 生成的列名带 `_id` 后缀，没有 `id` 列。生产库实测：

```
表                           有 id?         主键列
ai_pi_agents                NO ID COLUMN   session_id
ai_pi_business_delegations  NO ID COLUMN   intent_id
ai_pi_native_states         NO ID COLUMN   root_session_id
ai_pi_agent_messages        has id         id
ai_pi_agent_waits           has id         id
ai_pi_file_handoffs         has id         id
ai_pi_plan_revisions        has id         id
```

对应模型（`backend/ai_assistant/pi_models.py`）：

```python
class PiNativeState(models.Model):        # :297
    root_session = models.OneToOneField(PiSession, primary_key=True, ...)
class PiAgent(models.Model):              # :314
    session = models.OneToOneField(PiSession, primary_key=True, ...)
class PiBusinessDelegation(models.Model): # :389
    intent = models.OneToOneField(PiBusinessIntent, primary_key=True, ...)
```

`ai_pi_agents` 实测列：`session_id, lifecycle, dependencies_json,
settings_json, created_at, parent_operation_id, parent_session_id,
root_session_id` —— 没有任何叫 `id` 的列。按 `sorted()` 顺序
`ai_pi_agents` 排第一个，所以它先爆。

空表也会报这个错（规划阶段就失败），但这两张表实际非空：
`ai_pi_agents` 15 行、`ai_pi_native_states` 15 行，其余五张 0 行。

## 影响面（我已逐处核过，只有这一处）

全仓 `ORDER BY id` 共 39 处，其中遍历动态表集合的只有三处：

| 位置 | 遍历的集合 | 结论 |
|---|---|---|
| `sales_preflight_catalog.py:49` | `pi_native_catalog.TABLES`（7 张） | **会爆**，三张缺 id |
| `pi_native_catalog.py:131` | `pi_business_catalog.TABLES`（3 张） | 安全，三张都有 id |
| `pi_agent_catalog.py:82` | 写死的 5 张 `ai_*` 表 | 安全，与 TABLES 无关 |

所以**只改 `sales_preflight_catalog.py` 一处**。不要顺手改
`pi_native_catalog.py:131` —— 它当前是对的，改它会动已上线代码的字节，
触发资格化要求。

另外 `ai_pi_gateway_nonces` 主键是 `nonce` 而非 `id`，但它只在
`pi_agent_catalog.TABLES` 里，而 `:82` 不遍历那个集合，所以不受影响。

## 要求

**排序键必须确定且稳定** —— 这个值进 `legacyRowsSha256` 摘要，
摘要会写进 `install-intent.json` 并在 `install` 与后续 `finalize`
两次调用间比对（`sales_preflight_addition.py:281` 的
`preservation(cursor) != expected`）。排序不稳定会让两次摘要不等，
发布在 finalize 阶段失败。所以：

- 不要用 `ORDER BY 1` 或省略 ORDER BY
- 不要用 `to_jsonb(t)::text` 排序（JSON 键序不保证）
- 建议从 `pg_index` 查该表主键列并按其排序，或在模块里显式声明
  每张表的排序键。两种都可以，选你认为更不易腐坏的，并说明理由。

**保留 LIMIT 100001 与超界检查**（`> 100000` 抛
`"Sales154 parent preservation exceeded bound"`），别动这个上界语义。

**codeSha256 会变。** `tools/sales_preflight_catalog.py` 在
`sales_preflight_addition.CODE_FILES` 的 86 个文件里，改它必然改
`code_digest`。所以同一个候选里要一起更新：

- `config/main-schema-releases/sales-0012.json` 的 `codeSha256`
- `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json`
  的 `codeSha256`（两处必须相同，`admission()` 会比对）

这两个值用你改完后实算的结果，不要抄旧值。

**测试要能真抓住这个 bug。** 现有测试全绿却没发现它，因为注入的是
假 cursor。新增的测试至少要有一个用真实表结构（或至少一个没有 `id`
列、主键为 `<fk>_id` 的表）跑通 `preservation()`，否则同样的回归会再漏。

## 不要做的事

- 不要改数据库（不要加 `id` 列、不要改主键）。表结构是 Pi153 已审阅
  并上线的代际，改它要走另一套流程。
- 不要改 `pi_models.py`。那三个 OneToOne 主键是设计，不是错误。
- 不要动 `tools/django-local-service.ps1` 或 `tools/bi-app-adopt.ps1`。
  原生控制器改字节要同步资格化，这次用不着。
- 不要跑发布，不要碰 `D:\teruisi-runtime\`。

## 旁证材料

发布状态在
`D:\codex-isolated\main-release-packages\930509cc3918-bfb340f8-7948e85c\publish-930509cc3918\`
（`FAILED.json`、`迁移监控字段-started.json`、`迁移监控字段-process.json`）。

制品本身是好的，三个摘要我已逐字节复算一致，不需要重新准备制品：

```
codeSha256       e411415d0a76aae5ba8648e3db2b306c82dcd786262eb8171eff6e593875b1a1
sourceSha256     bb681fc0afc9bf26673306f27aa24e4a78888f134ecb548446bfe6d719d211d3
migrationSha256  f8f2c4c1d1007fd43934e7ac3d4e53a034d88f95efbd514e8d69d2e1dd633848
```

当前已回退到发布前的旧代码（`app/` = 3142 文件 / `6defc323…`），
服务正常，12 个组件全就绪。
