# 第 12 代 addition 设计：WorkflowAutomation（154 → 155）

任务目标：把两个已合并到 `main` 的迁移收编进结构发布链，解开闸③（11 层 addition 的 `successor`/`release` 校验被打断）与闸④（`tools/main-schema-release.mjs` 的 `finite[]` 止于 154 代）。

本文件只是设计。设计阶段未改动任何现有代码文件；唯一新增的是本目录。

## 0. 现场复核（本次实测，不抄历史）

| 事实 | 实测方式 | 结果 |
| --- | --- | --- |
| 现役 runtime 代际 | `ls D:\teruisi-runtime\django-sales\*addition-active.json` | 11 个标记，最新是 `sales-preflight-index-addition-active.json` |
| 现役 app 的 workflow 迁移 | `ls app/backend/workflow/migrations/` | 只到 `0008_new_product_shop_plan.py` |
| 仓库与现役 app 的迁移差集 | 全仓 `backend/*/migrations/*.py` 集合相减 | 仅多 `workflow/0009`、`workflow/0010`，无删除、无改写 |
| 非 `__init__` 迁移文件数 | 同上 | 现役 152，仓库 154（`__init__.py` 12 个；与"代际数"是两个口径，见 §1） |
| 闸③ 现状 | `sales_preflight_addition.py successor` | `exit=1`，`{"status":"blocked","reason":"Only the exact reviewed153-to154 delta is supported"}` |
| 闸④ 现状 | `assertMainSchemaPlanSupported(makeReleasePlan(2dc377f0→main))` | `REFUSED: 最新main含新增或改写迁移，尚无对应结构发布包；本次未部署` |
| 现役部署来源 | `app/deployment.json` → `sourceRoot` 的 git HEAD | `2dc377f0`（`D:\codex-isolated\netshop-projection-total-20261030\source`） |

两道闸都在本次实测中复现，不是推断。

## 1. 代际与父链

### 代际号

`verify_receipt_generation()`（`tools/postgres_no_key_backup.py:81`）的代际是 **`django_migrations` 收据条数**，不是文件数：`baseline`(138) + 逐代 `STEPS` 累加，现役 = 154。`contenttypes` 的 2 条内建节点在 policy 里、不在仓库文件里，所以"仓库 154 个迁移文件"与"154 代"数值相同纯属巧合。

本代新增 2 个迁移节点（`workflow.0009`、`workflow.0010`），因此：

- `fromGeneration = 154`
- `toGeneration = 156`

**两个迁移作为一代收编，不拆两代。** 理由：

1. `0010` 的 `dependencies = [("workflow", "0009_automation_projection_b1")]`，它 `RunPython` 往 `0009` 刚建的 `automation_modules` 里写 3 行注册数据。拆两代意味着中间存在一个"表已建、注册行未写"的可发布代际 155，而那个状态对 `automation_gates` 是半成品。
2. 它们是同一块功能（`feat(workflow)` 京准通试点 B1 + 闸①客服链身份扩展）带进来的，收编的边界应与功能边界一致。
3. 多步一代有现成先例：`tmallSchema` 的 `147→149` 就是 `['inventory.0016_jd_product_monitoring','inventory.0017_tmall_warehouse']` 两步一代。`steps_files`/`steps_for_base` 的两参数形态直接可抄。

与 tmall 的区别：tmall 需要支持 `from147`（两步）和 `from148`（一步）两个父变体，因为 148 当时可能已装。本代只有一个父（154 现役），所以 `steps_files` 只接受 `154`，像 `sales_preflight` 那样单变体，`parentVariants` 只有 `[[154, 156]]`。

### 命名与父链接法

| 项 | 取值 |
| --- | --- |
| `additionKind` | `WorkflowAutomation` |
| kind slug | `workflow_automation` |
| 模块 | `tools/workflow_automation_addition.py` / `_catalog.py` / `_candidate.py` |
| `VERSION` | `teruisi-workflow-automation-schema-addition-v1` |
| `ACTIVE` | `workflow-automation-addition-active.json` |
| 操作目录 | `<runtime>/workflow-automation-additions/<32hex>/` |
| `POLICY` | `schema-only-no-full-backup-or-restore-v1`（沿用 Sales154 的，本代同样不做全量备份/恢复） |
| recipe | `config/main-schema-releases/workflow-0009.json` |
| evidence 文件名 | `workflow-0009-evidence.json` |
| `parent` | `sales_preflight`（154 代） |
| import 行 | `import sales_preflight_addition as parent` |
| 顾问锁 key | `pg_try_advisory_xact_lock(156, 20261031)` |

`parent_proof()` 照 `sales_preflight_addition.py:62` 的形状：

```python
def parent_proof(runtime, baseline):
    receipt, _, folder, previous = parent._verify_active_with_base(baseline, runtime)
    catalogue = previous | set(parent.steps_for_base(previous))
    if len(catalogue) != 154 or receipt["migrationCount"] != 154:
        raise ValueError("Workflow156 requires its exact verified154 parent")
    steps_for_base(catalogue)
    return catalogue, common.sha(Path(runtime) / parent.ACTIVE)
```

递归到根仍然成立：`sales_preflight.parent_proof` → `pi_native._verify_active_with_base` → … → `bi_app.original_parent`，11 层全部保留，一层都不撤。

## 2. `FILES` 声明与 `source_delta` 的静态验证

### 声明

```python
STEPS = ("workflow.0009_automation_projection_b1",
         "workflow.0010_customer_service_chain_modules")
FILES = {
    "backend/workflow/migrations/0009_automation_projection_b1.py":
        "adafff9db82c661409e16488be6461f6a52d436f226360254d8af82a9b6c89bc",
    "backend/workflow/migrations/0010_customer_service_chain_modules.py":
        "f5cf004563db635baa29fcb57e3965f26c085eb14ba2eb13eaf78a85f53de8cd",
}
```

两个哈希是 `integration_migration_plan.python_source_sha256` 的值（`bi_app_addition.migrations()` 用的就是它）。另外用 node 按 `readSchemaRecipe` 的口径（UTF-8、`\r\n`→`\n` 归一后 sha256）复算，两边同值、且归一后不含独立 `\r`——所以 recipe 的 `stepFiles` 与 catalog 的 `FILES` 可以共用同一组字面量。

### 静态验证（已实跑，不是断言）

`source_delta` 的四个条件（`sales_preflight_addition.py:53`）在 before = 现役 `app/`、after = 本 worktree 时逐条复算：

```
cond1 set(before)&set(FILES) empty:            True
cond2 set(after)==set(before)|set(FILES):      True
cond3 unchanged common bytes:                  True
cond4 FILES hashes match:                      True
```

复算用的是 `bi_app_addition.migrations()` 的同一实现（`glob("*/migrations/*.py")` + `python_source_sha256`），不是另写一套。这是"baseline 是 `plan` 那一刻对现役 `app/` 的整树拷贝"的直接后果：拷出来的 baseline 没有 0009/0010，而 `FILES` 恰好等于差集，所以 `set(after) == set(before) | set(FILES)` 成立。

**失效前提（必须写进 REPORT）**：等式成立的条件是"在本代被安装之前，不再有第三个无关迁移合并进 main"。一旦有，`cond2` 立刻再次失败——这是现有设计的固有性质（`migrations()` 扫全仓），不是本代引入的，也不在本次最小改动的范围内。合并单一真相源那条调查正是对着这个问题。

## 3. 要不要 catalog / rehearsal / private

### catalog：要，而且是本代最重的部分

`sales_preflight` 能省 rehearsal/private 是因为它只加一个**部分索引**，没有新表、新列、新权限、新数据。本代不同：

- `0009` 建 **4 张表**：`automation_logical_runs`、`automation_modules`、`automation_attempts`、`automation_module_results`，带 6 个 `models.Index`、3 个 `UniqueConstraint`（其中两个带 `condition`）、2 个 `ForeignKey`（含一个自引用 `PROTECT`）、1 个 `BigAutoField` 序列。
- `0010` 用 `RunPython` 往 `automation_modules` 写 **3 行**注册数据。

所以 catalog 必须有 `inspect_tables` + JSON 期望值（照 `tmall_warehouse_catalog.py` + `tmall_warehouse_catalog.json` 的模式）：列类型/notnull/default、约束定义、索引定义、触发器、表级与列级 ACL、policy、序列归属与权限，逐项比对。这不是"新建结构"——结构已由别人的功能定稿、已在 main——而是**把既成结构的指纹冻结成期望值**，让后续任何偏移（手改列、漏建索引、权限漂移）被挡住。

catalog 需要的函数，按父代接口对齐：

| 函数 | 作用 |
| --- | --- |
| `STEPS` / `FILES` | 两步两文件 |
| `TABLES` | 4 张 `automation_*` 表 |
| `inspect_tables(cursor)` | 全量结构指纹，照 tmall 的 7 类查询 |
| `sequence_catalog(cursor)` | `automation_module_results.id` 的序列（唯一的 BigAutoField） |
| `verify_catalog(cursor, *, installed, permissions)` | 先递归 `sales_preflight_catalog.verify_catalog(installed=True, permissions=True)`，再比对本代 4 表；`installed=False` 时断言 4 表**不存在** |
| `preservation(cursor)` | 递归父代 `preservation`，不新增被保护表（见下） |
| `verify_initial_values(cursor)` | **与父代不同**：3 张表必须为空，`automation_modules` 必须恰好是 `0010` 声明的那 3 行 |
| `verify_defaults(apps)` | 从迁移状态核对 `AutomationModule` 的字段默认值与 4 个模型的 pk/index 成员 |

### `preservation` 不扩张

父代的 `preservation` 已覆盖 `pi_native.TABLES` 的 7 张表及更上游的链。本代新建的 4 张表在 `install` 之前**不存在**，不能进"被保护的既有行"集合——`preservation` 的语义是"安装前后必须一字不变的旧数据"。所以本代 `preservation` 直接转调父代的，不加表。这与 `sales_preflight_catalog.preservation` 的做法一致（它也只是把父代结果再 digest 一层）。

### `verify_initial_values`：本代的特殊点

`sales_preflight` 和 `tmall` 的 `verify_initial_values` 都断言"新表为空"。本代**不能一律断言为空**，因为 `0010` 故意写了 3 行注册数据。设计：

- `automation_logical_runs` / `automation_attempts` / `automation_module_results`：必须空。
- `automation_modules`：行键集合必须恰好是 `0010` 的三个 `module_key`，且每行各字段值与 `0010` 的 `CUSTOMER_SERVICE_MODULES` 字面量逐字段相等（含 `depends_on` 的 JSON 内容、`imports_data`、`evidence_requirement="pairing"`、`contract_version=1`）。

期望值从迁移文件 import，不手抄：`importlib.import_module("workflow.migrations.0010_customer_service_chain_modules").CUSTOMER_SERVICE_MODULES`。这样 `0010` 的字面量一改，`FILES` 哈希先失配，不会出现"期望值和迁移各说一套"。

**注册数据不是业务数据**：`0010` 的注释已写明（`automation_models.py` 的 `AutomationModule` docstring："not a user-editable table"），且沿用 `workflow.0002_seed_control_rows` 为本 app 其他控制行建立的惯例。把它放在 `verify_initial_values` 里当"预期初始状态"、而不是当"禁止 seed 业务数据"的违例，与现有 `POLICY = schema-only-...` 相容。这点要在 REPORT 中明示，因为 `install` 的 `apply_steps` 会执行一次 `RunPython`，与前几代"纯 DDL"不同。

### 权限：本代不发 GRANT

实测：`0009`/`0010` 里**没有任何 `GRANT`**；`backend/teruisi_backend/health.py` 的 `WORKFLOW_WRITER_TABLE_PRIVILEGES` 里**没有任何 `automation_*` 条目**（grep 计数 0）；`tools/django-workflow-service.ps1:238` 的角色授予只遍历 `reader_tables` / `writer_privileges`，也就不会碰到这 4 张表。

结论：4 张表安装后是 **owner-only**，`teruisi_workflow_reader`/`writer` 对它们无任何权限。catalog 的 ACL 期望值就按 `acldefault('r', relowner)` 冻结。

这带出一个必须诚实记录的**业务后果**：`backend/workflow/automation_run_views.py` 的 4 个只读 HTTP 端点（`backend/workflow/urls.py:11-24`）走 workflow 角色访问这 4 张表，而 `health.py:2053` 起的 writer 就绪检查把"有权限但不在白名单"判为 `privilege_excessive`、把"白名单里有但实际无权限"判为 `privilege_missing`——**两边同时没有这 4 张表，所以就绪检查会一致通过**。于是：结构能装上、就绪能通过，但那 4 个端点在生产上大概率因无权限而失败。

**这不是本代要修的事**，也不该顺手改：改 `health.py` 的白名单属于那块功能自己的权限设计，不在"收编迁移解闸"的范围内。本设计只负责**把这个缺口写明**，并在 catalog 里把 owner-only 冻结为当前事实的期望值。REPORT 的"未验证/待办"一节必须列出它。

### rehearsal：要

4 张表 + 2 个外键 + 带条件的唯一约束 + 一次 `RunPython`，这个规模靠只读检查覆盖不了 `install`/`finalize` 的原子性。照 `tools/ai_schedule_addition_rehearsal.py` / `tools/tmall_warehouse_rehearsal.py` 的模式新增 `tools/workflow_automation_rehearsal.py`：

- 自建合成 PostgreSQL（用 `D:\teruisi-runtime\django-sales\postgresql-17.11\bin` 下的 initdb/pg_ctl，只读调用二进制，不碰生产实例）。
- 端口段 **55500–55510**（实测现有占用：55471-55480、55531-55540、55884-55900、55910-55925、55925-55940、55940-55950、55950-55960、55960-55970、55970-55980、55980-55990；55500 段空闲），库名 `teruisi_workflow_automation_rehearsal`，`capture()` 里硬校验 host/port/name，连错即 `raise`。
- `sitecustomize.py` 的 socket 钩子限制外联，照 ai_schedule 的写法。
- `assert_isolated_source()`：拒绝 `D:\运营管理系统` 与 `D:\teruisi-runtime` 作为 ROOT（照 tmall 的 ASCII 转义写法，避开代码页问题）。
- 合成出 154 代父：migrate 到各 app 叶子但 workflow 停在 `0008`，再按链逐代 `apply_steps`，最后跑本代。

### private：要（正负面用例）

`tools/workflow_automation_private.py`，照 `ai_schedule_addition_private.py` 的 `reject()` 模式。覆盖的用例见 §6。

## 4. 必须同步改的既有文件

### 新增文件（7 个）

| 文件 | 说明 |
| --- | --- |
| `tools/workflow_automation_catalog.py` | 只读结构期望值，约 170 行 |
| `tools/workflow_automation_catalog.json` | `inspect_tables` + `sequence_catalog` 的冻结指纹，由 rehearsal 的 `--capture-catalog` 产出 |
| `tools/workflow_automation_addition.py` | 核心 gate，约 400 行 |
| `tools/workflow_automation_candidate.py` | 候选态声明脚本，约 110 行 |
| `tools/workflow_automation_rehearsal.py` | 隔离演练编排 |
| `tools/workflow_automation_private.py` | 正负面用例 |
| `config/main-schema-releases/workflow-0009.json` | recipe |

### 改动既有文件（8 个）

| 文件 | 改什么 |
| --- | --- |
| `tools/bi-app-adopt.ps1` | `:3` `ValidateSet` 加第 13 个 kind `WorkflowAutomation`；`:10` schema-only 名单、`:12` Reconcile 名单、`:62` gate 路由 elseif 链、`:65` `--execute` 名单、`:70` `--prepared-id` 名单、`:86` 应用名 elseif 链（`teruisi_workflow_automation_schema_append`）各加一处。**含中文，必须保留 UTF-8 BOM**（首字节现已是 BOM）。 |
| `tools/main-schema-release.mjs` | 加 `workflowAutomationSchema` 常量（`fromGeneration:154,toGeneration:156,steps:[两步]`）、迁移路径常量、`finite[]` 首位插入条目（`planSpec` 用全等匹配，顺序只影响可读性，保持"最新代在前"的既有惯例）。`schemaAclContractScripts` **不加**本代（本代不发 GRANT，没有 ACL 契约脚本可跑；`runSchemaAclContract` 对未登记 kind 返回 `null`，是既有行为）。 |
| `tools/django-local-service.ps1` | `Assert-NoUnapprovedProtectedAiMigration`（`:1777` 起）在 Sales154 分支**之前**插入本代分支，照 `:1790-1811` 的形状；`:2210` 起的 PrepareApp 拷贝清单加 `workflow_automation_addition.py` / `_catalog.py` / `_catalog.json` / `_candidate.py` 四项。**含中文，必须保留 UTF-8 BOM**。 |
| `tools/integration_release_gate.py` | `verify_release`（`:329`）与 `verify_database_complete`（`:404`）各在最前面插一条 `workflow-automation-addition-active.json` 路由。 |
| `tools/check_schema_code_digest.py` | `SPECS` 加 `"WorkflowAutomation": ("workflow_automation_candidate", (154,), 156, "workflow-automation-mandatory-code-checks-v1")`。另：`:144` 起 `kind == "SalesPreflightIndex"` 那段"执行材料绑定"检查是 Sales 专属分支——本代同样需要这道强绑定，所以把条件改为 `kind in {"SalesPreflightIndex", "WorkflowAutomation"}`，错误措辞里的 "Sales" 字样改为中性。这是本次唯一一处轻微重写而非纯追加，理由：那段正是防"只改 proof 摘要却留着旧 CHECKS 源映射"的。 |
| `tools/postgres_no_key_backup.py` | `verify_receipt_generation` 加 `generation156`（`generation154 + 本代 STEPS`）；新增 `workflow_automation_installed = receipts == generation156`；`sales_preflight_installed` 改为 `receipts in (generation154, generation156)`；原先列举到 `generation154` 的各 `*_installed` 元组（native/business/workspace/pi/tmall/monitoring/schedule，以及 `:160` 的大元组）各补 `generation156`；末尾三元链加 `156 if workflow_automation_installed else ...`；接入本代 `verify_catalog(cursor, installed=workflow_automation_installed)`。 |
| `tools/manual-maintenance-continuation.mjs` | `piNativeCandidateControllerSha256['django-local-service.ps1']` **追加**本次新字节哈希（保留全部 4 个旧值），上方写资格化理由注释（照 `batchedStatusEnumerationDjangoScriptSha256` 的范式）。 |
| `tests/manual-maintenance-continuation.test.mjs` | `:37-39` 的字节绊线与 `:53-57`、`:67-70`、`:84-87` 的顺序断言各加一位。**保留绊线语义**："等于恰好一个注册值"不改成自动跟随文件。 |

### 文档与证据（本目录内）

| 文件 | 说明 |
| --- | --- |
| `DESIGN.md` | 本文件 |
| `run-mandatory-checks.py` | 执行脚本，照 `docs/ci-two-gates-fix-20261031/run-mandatory-checks.py` 改写（见 §5） |
| `MANDATORY-CHECKS.json` | 本次**新建**的执行证据（`teruisi-schema-mandatory-code-execution-v1`） |
| `workflow156-mandatory-code-checks.json` | recipe 的 `validation` 指向物（`workflow-automation-mandatory-code-checks-v1`），其 `evidence.path` 指向上一行 |
| `REPORT.md` | 交付报告 |

**不改** `docs/jackyun-sales-preflight-20261029/` 与 `docs/ci-two-gates-fix-20261031/` 下的任何文件——除 §5 说明的 Sales154 级联。

### 明确不碰

- `tools/publish-latest-main.mjs`（另一条会话在改）。
- 11 个现有 `*_addition.py` / `*_catalog.py` 的内部逻辑一行不改；唯一共享的代际枚举 `postgres_no_key_backup.py` 必须改。
- 不做"把代际枚举合并成单一真相源"的重构（另有设计调查在做，不抢跑）。

## 5. `code_digest` 级联

### 级联范围（实测，不是估计）

`sales_preflight_addition.CODE_FILES` 共 **86** 项。本次计划改动的 7 个既有文件里，**6 个是它的成员**：

```
MEMBER  tools/bi-app-adopt.ps1
MEMBER  tools/main-schema-release.mjs
MEMBER  tools/django-local-service.ps1
MEMBER  tools/integration_release_gate.py
MEMBER  tools/postgres_no_key_backup.py
MEMBER  tools/manual-maintenance-continuation.mjs
not     tools/check_schema_code_digest.py        ← 唯一不是成员的
```

所以 **Sales154 自己的 `codeSha256` 也会变**，不只是本代的。当前基线（本次实测，CI 那道门禁 `exit=0`、`status:"passed"`）：

```
sales-0012 actualCodeSha256     = 04ba55b47b61b7de11a7096b1441fc210c31cbb9135ac810a813799385c13c17
sales-0012 actualMigrationSha256= 05802c9ef1af3a46fb9c980965d6f98ba06d1ee35459cf514050280fbd67bb31
codeFileCount                   = 86
migrationSourceFileCount        = 166
```

### 本代 `CODE_FILES`

照 `sales_preflight_addition.py:25` 的形状继承父代再追加：

```python
CODE_FILES = tuple(dict.fromkeys((*parent.CODE_FILES,
    "tools/workflow_automation_addition.py", "tools/workflow_automation_catalog.py",
    "tools/workflow_automation_catalog.json", "tools/workflow_automation_candidate.py",
    "backend/workflow/migrations/0009_automation_projection_b1.py",
    "backend/workflow/migrations/0010_customer_service_chain_modules.py",
    "backend/workflow/automation_models.py", "backend/workflow/automation_gates.py",
    "backend/workflow/automation_run_query.py", "backend/workflow/automation_run_views.py")))
```

父代已含 `main-schema-release.mjs`、`bi-app-adopt.ps1`、`django-local-service.ps1`、`integration_release_gate.py`、`postgres_no_key_backup.py`、`manual-maintenance-continuation.mjs`，不重复列（`dict.fromkeys` 去重）。预计 `codeFileCount` = 86 + 10 = **96**（实现后以实跑为准，不预先写进文档）。

### 必须同步的摘要（两条链，分别处置）

**链 A：本代自己的**
1. `config/main-schema-releases/workflow-0009.json` 的 `codeSha256` = `workflow_automation_addition.code_digest(root)`
2. `docs/workflow-automation-addition-20261031/workflow156-mandatory-code-checks.json` 的 `codeSha256` + `migrationSha256`，`evidence.{path,sha256}` 指向本目录的 `MANDATORY-CHECKS.json`
3. 本目录 `MANDATORY-CHECKS.json` 的 `codeSha256`、`codeFileCount`、`sourceFiles`（96 条）、`migrationSha256`、`supplementalSourceFiles`
4. recipe 的 `validationSha256` = `workflow156-mandatory-code-checks.json` 的字节 sha

**链 B：Sales154 的级联**

Sales154 的 `codeSha256` 因 6 个共享成员改动而移动。处置方式**照 CI 那次刚合并的范式**：不改旧证据文件去对齐，而是**新建一份本次证据**。具体：

- `config/main-schema-releases/sales-0012.json` 的 `codeSha256` 更新为新值，`validation` 路径**不动**（仍指向 `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json`）。
- `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json` 的 `codeSha256` 更新，`evidence.path` **改指向** `docs/workflow-automation-addition-20261031/MANDATORY-CHECKS.json`（本次新建的那份），`evidence.sha256` 随之更新；`validationSha256` 回写进 recipe。
- `docs/ci-two-gates-fix-20261031/MANDATORY-CHECKS.json` **一字不改**——它成为失去引用的历史证据，和它上一任（`docs/sales154-preservation-order-key-20261030/`）一样。

这就是 CI 那次的做法（`sales154-mandatory-code-checks.json` 的 `evidence.path` 当时指向了新建的 `ci-two-gates-fix-20261031/`），所以查引用链要从 `recipe.validation` → 该文件的 `evidence.path` 走，而不是对着任何旧证据文件数 drift。

**一份 `MANDATORY-CHECKS.json` 同时服务两条链**是可行的：`check_schema_code_digest.py` 对 Sales 分支要求 `evidence.sourceFiles == {name: sha for name in gate.CODE_FILES}`，`gate` 是**该 recipe 自己的** gate。所以 Sales154 需要 86 条、本代需要 96 条——同一个文件的 `sourceFiles` 不能同时等于两个集合。

**结论：必须产出两份执行证据**，各自 `sourceFiles` 条数不同：

| 文件 | `sourceFiles` 条数 | 服务 |
| --- | --- | --- |
| `docs/workflow-automation-addition-20261031/MANDATORY-CHECKS.json` | 96（本代 `CODE_FILES`） | `workflow-0009.json` |
| `docs/workflow-automation-addition-20261031/MANDATORY-CHECKS-SALES154.json` | 86（父代 `CODE_FILES`） | `sales-0012.json` |

两份由同一个 `run-mandatory-checks.py` 一次运行产出（两个 gate 各算一遍），保证两份的 `migrationSha256`、`baseCommit`、syntax 结果来自同一次执行。这是对 CI 那次范式的必要扩展——它只需要维护一条链，本次有两条。

### `run-mandatory-checks.py` 的改法

照 `docs/ci-two-gates-fix-20261031/run-mandatory-checks.py` 改写，`migration-closure` 阶段的变化：

那份脚本的 `UNRELATED` 常量把 0009/0010 列为"无关的已合并迁移"，并**断言 `gate.source_delta` 必须拒绝**当前树（`assert not sales_delta_admitted`）。本代把这两个迁移收编后：

- 以**本代 gate** 跑：`workflow_automation_addition.source_delta(ROOT, baseline154)` 必须**通过**（baseline 取 154 代的 Git 夹具，即 `main` 上 0009 之前的提交 `ed3bd8b3^`）。
- 以**父代 gate** 跑：`sales_preflight_addition.source_delta` 对当前树仍然**拒绝**（它的 `FILES` 里没有 0009/0010，`cond2` 不成立）。这一事实照旧记录为 `salesDeltaAdmittedByGateSourceDelta: false` + 明文 refusal，**不绕过、不改父代**。
- `UNRELATED` 常量在本代证据里**变为空**：0009/0010 不再是"无关"，它们是本代的 `stepFiles`。若此时出现第三个无关迁移，脚本 `assert added == set(gate.FILES)` 直接失败——不自行扩张。

两份证据的 `migrationClosure.scope` 要分别写明各自是哪个 gate 的视角，避免混读。

## 6. 隔离验证计划

### 硬指标（必须贴实跑输出）

| # | 验证 | 方法 | 判定 |
| --- | --- | --- | --- |
| 1 | 闸③ 解开 | `python tools/workflow_automation_addition.py release --root <repo> --runtime D:\teruisi-runtime\django-sales` 与同参数 `successor` | 两个子命令都 `exit=0` 且 `{"status":"verified",...}`。两者纯只读（`main()` 里 `release`/`successor` 直接 `return verify_active(root, runtime)[0]`，在任何写路径之前返回）。 |
| 2 | 闸④ 解开 | `assertMainSchemaPlanSupported(makeReleasePlan({base:'2dc377f0',head:'HEAD'}))` | 返回本代 schema 对象而非 throw。 |
| 3 | 四道门禁正负面 | `tools/workflow_automation_rehearsal.py` | 见下表 |
| 4 | 两道 CI 门禁 | `node --test tests/maintenance-controller-qualification.test.mjs`；`check_schema_code_digest.py --recipe workflow-0009.json --recipe sales-0012.json` | 测试全过；digest 检查 **exit=0 且每条 `status:"passed"`**（两个口径都看） |

指标 1 的说明：`release`/`successor` 在**本代 active 标记尚不存在**时会因 `common.read(runtime/ACTIVE)` 失败而 blocked，这是正确行为（本代还没装）。所以闸③ 的真正判定是**父代链不再因那两个迁移失配**，具体验证方式是：
- `sales_preflight_addition.py successor` 现在报 `Only the exact reviewed153-to154 delta is supported`；
- 本代 gate 的 `parent_proof()` 走的是 `parent._verify_active_with_base(baseline, runtime)`，它内部调 `parent.source_delta(root, folder/"baseline")`——**用的是 baseline 目录而不是仓库 root**。所以在本代 `plan` 之后，父代的 delta 校验对象是 154 代的 baseline 快照，不再是含 0009/0010 的仓库树。
- 在 `plan` 之前可独立验证的部分是：本代 `source_delta(repo, <runtime>/app)` 通过 + 本代 `parent_proof(runtime, <runtime>/app)` 通过。后者会调父代的 `_verify_active_with_base(runtime/app, runtime)`，而父代 `source_delta(runtime/app, folder/baseline)` 比的是现役 app 与它自己的 baseline——与仓库里的 0009/0010 无关，所以应当通过。

**这是设计上的关键判断，实现阶段必须实测确认。** 如果实测发现父代链在 `plan` 之前仍对仓库树做 delta 校验，则闸③ 需要另一种解法（可能要在本代 `admission` 里显式传 baseline），届时停下来报告，不自行改父代。

### rehearsal 覆盖的正负面用例

| 门禁 | 正面 | 负面 |
| --- | --- | --- |
| `admission` | 完整 code-checked 证据 + 真 154 父 → 通过 | 证据字段缺失/多余、`status != code-checked`、`codeSha256` 失配、`migrationSha256` 失配、`predecessorSha256` 失配、proof 的 `generations != [154,156]`、`parentVariants` 不符、`checks` 集合不符 |
| `plan` | 首次 `plan` 写出 `plan.json` + baseline 拷贝 | 操作目录已存在、ACTIVE 已存在、prepared 回执 `predecessorManifestSha256` 与证据不符、维护窗口 id/摘要不符 |
| `install` | 154 → 156 两步原子前进，3 行注册数据写入，父代 7 表行与 ACL 不变 | 第二步注入失败 → 必须整体回滚到 154 且无任何 156 对象（照 tmall 的 `patch.object(addition,"verify_initial_values",side_effect=...)` 写法）；重放 `install`（已有 `install-intent.json`）必须拒绝；`verify_receipt_generation` 不是 154 时拒绝；顾问锁被占时拒绝；`preservation` 在 intent 之后变化时拒绝 |
| `finalize` | `installed` → `verified`，`permissionsVerified:true` | 无 `installed.json` 时拒绝；别的 operation 持有 ACTIVE 时拒绝；`check_database` 发现 pending migration 时拒绝；重复 `finalize` 必须幂等且字节相同 |

另外验证 `verify_receipt_generation` 在合成库上对 154 返回 154、对 156 返回 156，且 11 层 catalog 校验全部仍过。

### 明确无法验证的部分

`install` / `finalize` **在生产上**的行为无法验证：需要停机 + 用户单独授权，本任务范围内不做、不跑。隔离演练能证明"同一套代码在合成 PostgreSQL 上四道门禁逻辑成立"，不能证明生产现场的权限、ACL 硬化、维护窗口与进程状态。REPORT 要把这块单独标为**待验证**，不用"已完成"掩盖。

## 7. 风险与边界

1. **`verify-release-candidate.mjs:438` 的硬断言**：
   ```js
   if(profile.paths.some(p=>['tools/main-schema-release.mjs',...].includes(p)))
     assert.equal(schemaAdmissionOnly,true,'新增schema能力/见证入口必须有专用受审增量资格')
   ```
   而 `schemaAdmissionOnly` 只在 `reusePreflightReport` 且 `baseCommit === 'a7041338...'` 时为真。本次改 `tools/main-schema-release.mjs`，所以这个工具会拒绝本次候选。
   **判断**：按规范 `ci门禁不进入发布链路`，`verify-release-candidate.mjs` **没有生产调用方、不被发布器调用**，是合并前的候选兼容性验证工具。它拒绝不等于发布被拒。但这会影响合并步骤的检查选择，**必须在 REPORT 中明确列出**，由用户在合并授权时知悉。本任务不改这个工具（改它需要独立的受审资格）。

2. **`FILES` 等式的脆弱性**：见 §2 的失效前提。本代一旦有第三个无关迁移合并，又要再开一代。这是现有设计的性质。

3. **automation 表的权限缺口**：见 §3。结构能装、就绪能过、端点可能 500。不在本代范围。

4. **`RunPython` 进入 schema-only 策略**：本代是第一个在 `apply_steps` 里执行 `RunPython` 的 addition。`POLICY` 字符串沿用不变（仍不做全量备份/恢复），但语义上多了"写 3 行注册数据"。REPORT 要明示这一扩张。

5. **`check_schema_code_digest.py` 的 Sales 专属分支**：§4 列的那处条件改写是本次唯一的既有逻辑修改（而非追加）。它有 `tests/schema-code-digest-static.py` 覆盖（`test_sales_*` 系列），改动后要跑那套测试确认未回归。

## 8. 待用户确认的决策点

| # | 决策 | 本设计的取值 | 备选 |
| --- | --- | --- | --- |
| 1 | 两个迁移一代还是两代 | 一代（154→156） | 两代（154→155→156），代价是中间出现"表已建、注册行未写"的可发布状态 |
| 2 | `additionKind` 命名 | `WorkflowAutomation` | 其他 |
| 3 | 是否产出两份 `MANDATORY-CHECKS.json` | 是（86 条 + 96 条，§5 给了必要性） | 只产一份 → `check_schema_code_digest.py` 对其中一条链必定失败 |
| 4 | `automation_modules` 的 3 行注册数据算不算"初始值" | 算，在 `verify_initial_values` 里按字面量逐字段冻结 | 另设 `verify_registry_rows`，与"初始值为空"分开表述 |
| 5 | `verify-release-candidate.mjs` 的拒绝 | 不改该工具，在 REPORT 中列为已知限制 | 为本次改动申请专用增量资格（需独立受审，超出本任务范围） |
| 6 | automation 表权限缺口 | 只记录，不修 | 顺手补 `health.py` 白名单（超出"收编迁移"范围，且属功能方的权限设计） |

## 9. 附：§6 关键假设的实测确认（设计阶段已完成）

设计里最关键的一条判断是"父代链在本代安装后，delta 校验对象变成 154 代的 baseline 快照，而不是含 0009/0010 的仓库树"。已用只读方式实测确认（未写任何文件、未连数据库）：

```
sp.parent_proof(runtime, runtime/app)                      FAILED: Only the exact reviewed152-to153 delta is supported
sp._verify_active_with_base(runtime/app, runtime)           OK; migrationCount = 154
sp._verify_active_with_base(<repo>, runtime)                FAILED: Only the exact reviewed153-to154 delta is supported
```

第一行与第三行是今天闸③ 的两副面孔；第二行是解法所在：**父代以 `root = <154 代的 app 树>` 调用时通过**。

进一步按本代 `parent_proof` 的实际组合跑了一遍：

```
parent catalogue size = 154 | receipt.migrationCount = 154
new-gen source_delta(repo, baseline154) would PASS = True
digest = 05802c9ef1af3a46fb9c980965d6f98ba06d1ee35459cf514050280fbd67bb31
```

即：本代 `parent_proof(runtime, <my baseline>)` 把 `root` 传成自己的 baseline（154 代快照），父代拿它和**父代自己的** baseline(153) 比，差集恰好是 `sales.0012`——通过；同时本代 `source_delta(repo, baseline154)` 的差集恰好是本代两个 `FILES`——也通过。两层各自比各自的 delta，**11 层一层不撤、一层不改**。

注意 `sp.parent_proof` 第一行的失败是预期的：它把 `runtime/app` 当 baseline 传给了**祖父**代，而 `runtime/app` 是 154 代的树，对 152→153 的 delta 多了一个 `sales.0012`。本代的 `parent_proof` 不走这条路径（它传的是自己的 baseline 给父代，而非把 app 传给祖父），所以不受影响——这也说明为什么新一代必须自己实现 `parent_proof` 而不能复用父代的。

剩余不确定项：`plan` 之前（本代 ACTIVE 标记尚不存在时）`release`/`successor` 会在 `common.read(runtime/ACTIVE)` 处 blocked，这是正确行为。闸③ 的只读硬证据因此要分两段给：
- 段一（现在就能跑）：本代 `source_delta(repo, runtime/app)` + `parent_proof(runtime, runtime/app)` 的组合通过——上面已给。
- 段二（需要合成 ACTIVE 标记）：在 rehearsal 的隔离 runtime 里造出完整的 11+1 层标记链，再跑 `release`/`successor` 得到 `{"status":"verified"}`。**不在生产 runtime 上造标记**。

实现阶段按这两段分别留证，不把段一的通过说成段二已验证。
