# 第 12 代 addition 交付报告：WorkflowAutomation（154 → 156）

分支 `claude/workflow-automation-addition-e31757`。**未合并、未准备制品、未发布**；`plan`/`install`/`finalize` 一次也没在生产上跑。设计见 [DESIGN.md](DESIGN.md)，6 个决策点由上游会话逐条确认（第 4 条采用备选，见 §3）。

## 1. 改了哪些文件

### 新增（11 个）

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `tools/workflow_automation_catalog.py` | 254 | 只读结构期望值 |
| `tools/workflow_automation_catalog.json` | — | `inspect_tables` + `sequence_catalog` 的冻结指纹，由隔离演练捕获 |
| `tools/workflow_automation_addition.py` | 380 | 核心 gate |
| `tools/workflow_automation_candidate.py` | 108 | 候选态声明脚本 |
| `tools/workflow_automation_rehearsal.py` | 288 | 隔离演练（含正负面用例，见 §5） |
| `config/main-schema-releases/workflow-0009.json` | — | recipe |
| `docs/workflow-automation-addition-20261031/DESIGN.md` | 383 | 设计 |
| `docs/workflow-automation-addition-20261031/run-mandatory-checks.py` | 245 | 必需代码检查执行脚本 |
| `docs/workflow-automation-addition-20261031/bind-recipes.py` | 88 | 从真实 gate 计算并写入两条链的 recipe/proof |
| `docs/workflow-automation-addition-20261031/prove-gate3.py` | 170 | 闸③ 两段式证明 |
| `docs/workflow-automation-addition-20261031/MANDATORY-CHECKS.json` + `MANDATORY-CHECKS-SALES154.json` + `workflow156-mandatory-code-checks.json` | — | 本次执行证据与 proof |

设计里预留的 `tools/workflow_automation_private.py` **没有单独建**：正负面用例直接写在 rehearsal 的 `capture()` 里（`reject()` / `probe()` 两个辅助），与 `tmall_warehouse_rehearsal.py` 的做法一致。单独拆一个 `_private.py` 在本代没有带来隔离收益，只会多一层间接。

### 改动既有（9 个）

| 文件 | 改什么 |
| --- | --- |
| `tools/bi-app-adopt.ps1` | 7 处：`ValidateSet` 第 13 个 kind、schema-only 名单、Reconcile 名单、gate 路由、`--execute` 名单、`--prepared-id` 名单、应用名 `teruisi_workflow_automation_schema_append`。UTF-8 BOM 保留 |
| `tools/django-local-service.ps1` | +33 行、0 行修改或删除：29 行是 `Assert-NoUnapprovedProtectedAiMigration` 里新增的一个 `if` 块（置于 Sales154 块之前），4 行是 PrepareApp 拷贝清单条目。UTF-8 BOM 与 CRLF 保留 |
| `tools/integration_release_gate.py` | `verify_release`、`verify_database_complete` 各加一条本代路由（各 3 行，置于最前） |
| `tools/main-schema-release.mjs` | `workflowAutomationSchema` / `workflowAutomationMigrations` 两个导出常量 + `finite[]` 首位条目 |
| `tools/postgres_no_key_backup.py` | `generation156` 定义、`workflow_automation_installed`、`sales_preflight_installed` 放宽为 `(generation154, generation156)`、7 个祖代元组各补 `generation156`、末尾三元链加 156 分支、接入本代 `verify_tables` |
| `tools/check_schema_code_digest.py` | `SPECS` 加一条；`kind == "SalesPreflightIndex"` 的执行材料绑定分支改为 `kind in EXECUTION_MATERIAL_KINDS`（纯扩面） |
| `tools/manual-maintenance-continuation.mjs` | 新增 `workflowAutomationSchemaAdditionDjangoScriptSha256` 并追加进 `piNativeCandidateControllerSha256`，**4 个旧代际哈希全部保留** |
| `tests/manual-maintenance-continuation.test.mjs` | 字节绊线指向新常量、3 处顺序断言各加一位、新增一个本代资格化测试 |
| `config/main-schema-releases/sales-0012.json` + `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json` | `code_digest` 级联，见 §4 |

`git status` 只含上述文件，工作区里其他会话的在途 `docs/` 未跟踪文件一个没动。

### 明确没碰

`tools/publish-latest-main.mjs`（另一条会话在改）、11 个现有 `*_addition.py` / `*_catalog.py` 的内部逻辑、`docs/ci-two-gates-fix-20261031/` 与 `docs/sales154-preservation-order-key-20261030/` 下的任何文件、`tools/verify-release-candidate.mjs`（见 §7）、`backend/teruisi_backend/health.py`（见 §7）。没有做"代际枚举合并成单一真相源"的重构。

## 2. `source_delta` 的静态验证过程与结果

`source_delta`（`tools/workflow_automation_addition.py:62`）有四个条件。用 `bi_app_addition.migrations()` 的同一实现（`glob("*/migrations/*.py")` + `python_source_sha256`）在 before = 现役 `D:\teruisi-runtime\django-sales\app`、after = 本 worktree 上逐条复算：

```
cond1 set(before)&set(FILES) empty:            True
cond2 set(after)==set(before)|set(FILES):      True
cond3 unchanged common bytes:                  True
cond4 FILES hashes match:                      True
```

集合口径：现役 app 共 164 个迁移 `.py`（含 12 个 `__init__.py`），仓库 166 个，差集恰好

```
+ backend/workflow/migrations/0009_automation_projection_b1.py
+ backend/workflow/migrations/0010_customer_service_chain_modules.py
```

无删除、无改写。两个 `FILES` 哈希：

```
0009 → adafff9db82c661409e16488be6461f6a52d436f226360254d8af82a9b6c89bc
0010 → f5cf004563db635baa29fcb57e3965f26c085eb14ba2eb13eaf78a85f53de8cd
```

另用 node 按 `readSchemaRecipe` 的口径（UTF-8、`\r\n`→`\n` 归一后 sha256）独立复算，两边同值，且归一后不含独立 `\r`——所以 recipe 的 `stepFiles` 与 catalog 的 `FILES` 共用同一组字面量是安全的。

执行脚本 `run-mandatory-checks.py` 又用**真实 Git 夹具**（`ed3bd8b3^`，即 0009 落地前的提交）复核了一次：继承的迁移全部字节一致（`inheritedMigrationsByteIdentical: true`）、本代两步在 baseline 中不存在、差集恰好等于 `FILES`、本代 `source_delta` 对该夹具**通过**，摘要 `05802c9e…` 与全量 source inventory 的 digest 相等。

### 这个等式的失效前提（必须知道）

成立的条件是"在本代被安装之前，不再有第三个无关迁移合并进 `main`"。一旦有，`cond2` 立刻再次失败——因为 `migrations()` 扫全仓所有 app。这是现有设计的固有性质，不是本代引入的，也不在本次最小改动范围内。执行脚本对此是**失败而不是吸收**：`assert added == set(gate.FILES)`，第三个迁移会让它报错而不是悄悄扩张 `UNRELATED`。

## 3. 决策点 4 的落地（与原设计不同）

上游会话要求把注册行校验独立出来，不塞进 `verify_initial_values`。已照此实现：

- `verify_initial_values(cursor)`：只断言 `automation_logical_runs` / `automation_attempts` / `automation_module_results` 三张表为空，**对 `automation_modules` 一字不提**。docstring 明写了为什么不提。
- `verify_registry_rows(cursor)`：`automation_modules` 的行键集合必须恰好是 `0010` 的三个 `module_key`，且每行各字段与 `0010` 的 `CUSTOMER_SERVICE_MODULES` 字面量逐字段相等；期望值用 `importlib` 从迁移文件读取，不手抄。

两个函数在 `apply_steps` 的后置检查和 `check_database(seeded=True)` 里都被调用。演练专门验证了**分工正确**：篡改一行注册数据时 `verify_initial_values` 仍然通过（它不该管这个），而 `verify_registry_rows` 拒绝。

实现中发现一个真实缺陷并修掉：`depends_on` / `allowed_actions` 是 JSONField，在裸 cursor 上取回的是 JSON 文本而不是 Python 对象，首次演练因此报 `registry values differ`。现在按解码后的文档比较。

## 4. `code_digest` 级联的实际范围

本次改动的 7 个既有文件里，**6 个是 Sales154 `CODE_FILES`（86 项）的成员**（实测）：`bi-app-adopt.ps1`、`main-schema-release.mjs`、`django-local-service.ps1`、`integration_release_gate.py`、`postgres_no_key_backup.py`、`manual-maintenance-continuation.mjs`；只有 `check_schema_code_digest.py` 不是成员。

本代 `CODE_FILES` = 父代 86 项 + 10 项（4 个本代模块、2 个迁移、4 个 automation 后端模块）= **96 项**（实跑确认）。

所以要两份执行证据，`sourceFiles` 条数不同，由 `run-mandatory-checks.py` 一次运行产出（共享同一 `baseCommit`、同一迁移清单、同一套 syntax 结果）：

| 文件 | `sourceFiles` | `codeSha256` | 服务 |
| --- | --- | --- | --- |
| `MANDATORY-CHECKS.json` | 96 | `c38e87aa84b97e0a6919343d7b70afbe4e7fb3c2fe9d7ca07bcb1eff445e860d` | `workflow-0009.json` |
| `MANDATORY-CHECKS-SALES154.json` | 86 | `1959cbba59b3e4f4629aa14bbe4887435d26e7a218405b076535b62ebeb82141` | `sales-0012.json` |

Sales154 原 `codeSha256` 是 `04ba55b4…`，现为 `1959cbba…`。照 CI 那次刚验证过的模式处置：**新建**本次证据，把 `sales154-mandatory-code-checks.json` 的 `evidence.path` 从 `docs/ci-two-gates-fix-20261031/MANDATORY-CHECKS.json` 改指向 `docs/workflow-automation-addition-20261031/MANDATORY-CHECKS-SALES154.json`，旧证据文件字节不动、只是失去最后一个引用（和它上一任 `sales154-preservation-order-key-20261030/` 一样）。查引用链请走 `recipe.validation` → 该文件的 `evidence.path`。

所有摘要由 `bind-recipes.py` 从真实 gate 计算后写入，没有一个是手抄的；代码一改就重跑这个脚本，陈旧摘要活不下来。

| 链 | `codeSha256` | `validationSha256` | `evidence.sha256` |
| --- | --- | --- | --- |
| WorkflowAutomation | `c38e87aa…` | `aea2abbb…` | `56c1fc20…` |
| Sales154 | `1959cbba…` | `fb68c1d3…` | `607c47a6…` |

## 5. 需要重新资格化的 pin

只有一处：`tools/manual-maintenance-continuation.mjs` 的 `piNativeCandidateControllerSha256['django-local-service.ps1']`。

新字节哈希 `af6b3b4242f0863296f018d3908ce9d9e93a1d8ec89565e299c7dba16e6e279c` 以 `workflowAutomationSchemaAdditionDjangoScriptSha256` 追加在末位，**4 个旧代际哈希全部保留**（`piNativeCandidate`、`aDescendantCreationGuard`、`sales154SchemaAddition`、`batchedStatusEnumeration`），所以本次改动的回退不会被自己的资格条目挡住。资格化理由写在常量上方（为什么这 33 行可以被资格化：全部是新增、零修改零删除，新分支只在本代证据/操作/标记存在时进入，三者都不在盘上时控制流与改动前逐字节相同，祖代生命周期证明经 `parent_proof` → `sales_preflight_addition._verify_active_with_base` 完整保留）。

绊线语义未变：测试仍断言"等于恰好一个注册值"（`assert.equal(sha(file), workflowAutomationSchemaAdditionDjangoScriptSha256)`），没有改成自动跟随文件。另加一个本代测试，覆盖前进采用、回退、每个更旧代际仍可采用、改一位即失败、哈希不泄漏到其他控制器名。

`worker-local-service.ps1` 与 `process-deadline.ps1` 未改动，其资格条目原样。

## 6. 闸③ 与闸④ 解开的实跑证据

### 闸④：`assertMainSchemaPlanSupported` 不再拒绝

改动前（实测）：

```
REFUSED: 最新main含新增或改写迁移，尚无对应结构发布包；本次未部署
```

改动后（`base = 2dc377f0`，即现役部署来源 `D:\codex-isolated\netshop-projection-total-20261030\source` 的 HEAD；`head = HEAD`）：

```
$ node -e "...assertMainSchemaPlanSupported(makeReleasePlan({base:'2dc377f0',head:'HEAD'}))"
exit=0
{"version":"teruisi-main-schema-release-v1","additionKind":"WorkflowAutomation",
 "fromGeneration":154,"toGeneration":156,
 "steps":["workflow.0009_automation_projection_b1","workflow.0010_customer_service_chain_modules"]}
```

返回本代 schema 对象而非 throw。该 plan 的 `migrate=true`、`components=["worker","django"]`，迁移改动恰好是那两个 `status:"A"` 的文件。

### 闸③：11 层校验不再被那两个迁移打断

证据分两段给，脚本 `prove-gate3.py`，输出 `exit=0`。**两段的适用面不同，不混为一谈。**

**段一（真实仓库 + 真实生产 runtime，纯只读）** —— 这是闸③ 的实质证据：

```json
{
  "newGenerationSourceDelta": "05802c9ef1af3a46fb9c980965d6f98ba06d1ee35459cf514050280fbd67bb31",
  "parentCatalogueSize": 154,
  "parentReferenceSha256": "73ff14d8559599fbfc51579435400e508b38f768d5c8bcba34f88843450c052c",
  "sales154RepositoryDeltaStillRefused": true,
  "sales154Refusal": "Only the exact reviewed153-to154 delta is supported",
  "productionWritesPerformed": false
}
```

读法：本代 `parent_proof(runtime, runtime/app)` **通过**，父代目录恰好 154 条，递归穿过全部 11 代到 `bi_app_addition` 的 139 代父（递归路径在调试栈里逐层可见：`sales_preflight` → `pi_native` → `pi_business` → `pi_workspace` → `pi_agent` → `tmall_warehouse` → `jd_monitor_preferences` → `jd_logistics` → `ai_schedule` → `jackyun_audit` → `bi_app` → `integration_release_gate.verify_parent_138`）。同时 Sales154 对**仓库树**仍然拒绝——它的 `FILES` 里没有 0009/0010，这条没被放宽、没被续期。

这正是 DESIGN §9 预判的机制：两层各比各自的 delta。父代的比较对象是 154 代的 baseline 快照，不是含 0009/0010 的仓库树；本代的比较对象才是仓库树。11 层一层不撤、一层不改。

**段二（合成 runtime 副本，`parent_proof` 被 stub）** —— 只证明本代自己的收据契约：

```json
{
  "stubScope": "gate.parent_proof only; it returns the catalogue size and parent reference
                segment 1 proved against production. No other function is patched and no
                assertion of this generation is relaxed.",
  "stubbedParentCatalogueSize": 154,
  "commands": {
    "release":   {"statusField":"verified","migrationCount":156,"registrySeeded":true,
                  "permissionsVerified":true,"migrationSha256":"05802c9e…",
                  "steps":["workflow.0009…","workflow.0010…"]},
    "successor": {"statusField":"verified","migrationCount":156,"registrySeeded":true,
                  "permissionsVerified":true,"migrationSha256":"05802c9e…",
                  "steps":["workflow.0009…","workflow.0010…"]}
  },
  "allNegativesRefused": true,
  "negativeCasesAccepted": [],
  "productionWritesPerformed": false
}
```

`release` 与 `successor` 都返回 `status:"verified"`、`migrationCount:156`。

**为什么段二必须 stub，以及为什么没在生产上跑 `release`/`successor`。** 这两个子命令要求本代的 active 标记存在，而标记只有 `install`/`finalize` 会创建——那两个动作在生产上绝对不能跑（本任务边界）。换到合成 runtime 也不行：11 代祖先的每一个 `app.prepare-*.json` 都把 `runtimeRoot` 绑在生产路径上（实测，例如 jd_logistics 那代的回执里 `"runtimeRoot": "D:\\teruisi-runtime\\django-sales"`），重写它们等于伪造这条链存在就是为了校验的那些哈希。所以段二只 stub `parent_proof` 一个函数，用段一在生产上真实证明出来的目录大小与父引用作为返回值，本代自己的每一条断言原样执行。

段二的 8 个负面用例 × 2 个变体 = 16 次，全部拒绝：

| 用例 | `hashPinned`（不动指针） | `resynced`（指针重指向被篡改字节） |
| --- | --- | --- |
| `migrationCount` 改 155 | Addition evidence changed | WorkflowAutomation schema receipt is incomplete or changed |
| `status` 退回 `schema_installed` | 同上 | 同上 |
| `registrySeeded: false` | 同上 | 同上 |
| `permissionsVerified: false` | 同上 | 同上 |
| `version` 换成 Sales154 的 | 同上 | 同上 |
| `migrationSha256` 置零 | 同上 | 同上 |
| `legacyDataPreserved: false` | 同上 | 同上 |
| `plan.databasePolicy` 篡改 | WorkflowAutomation plan identity changed | 同左 |

设两个变体的原因：只改收据不动指针时，先拒绝的是收据摘要校验（`Addition evidence changed`），**字段级断言根本没轮到执行**。`resynced` 变体把指针重新指向被篡改的字节——一个有写权限的人会这么做——这时才证明字段级断言自己会咬。两个变体都验，才算真的验过。所有探针结束后收据被还原，且重新 `verify_active` 仍通过，证明探针没留下残留状态。

## 7. 隔离演练覆盖范围

`tools/workflow_automation_rehearsal.py`，自建合成 PostgreSQL（端口段 55500–55510，库名 `teruisi_workflow_automation_rehearsal`，`capture()` 里硬校验 host/port/库名，连错即 `raise`；`sitecustomize.py` socket 钩子禁止外联；`assert_isolated_source()` 拒绝 `D:\运营管理系统` 与 `D:\teruisi-runtime` 作为源根——这条在首次运行时真的挡住了我，所以演练跑在 `D:\codex-isolated\workflow-automation-rehearsal-20261031` 的独立副本上）。实跑 `exit=0`，14 项检查：

```json
{"status":"completed","generations":[154,156],
 "checks":["atomic-rollback-leaves-no-156-object","atomic-upgrade","catalog-frozen",
           "empty-tables-pinned","exact-154-156","exact-154-parent-required",
           "legacy-data-preserved","no-pending-migrations","no-replay","owner-only-acl",
           "registry-membership-pinned","registry-seeded","registry-values-pinned",
           "stale-intent-refused"],
 "productionTouched":false,"fullBackupOrRestorePerformed":false,
 "database":"teruisi_workflow_automation_rehearsal","port":55500}
```

合成 154 代父不是靠重放 11 次 `apply_steps` 得到的，而是用 Django 自己的 executor migrate 到各 app 叶子、workflow 停在 `0008`，再跑各域**自带的** provisioning 代码（`django-inventory-service.ps1` / `django-workflow-service.ps1` 里内嵌的 here-string，`exec` 原文而不是抄一份），因为祖代 catalog 的 ACL 期望值细到单个序列的 `USAGE` 授予——手写一份必然漂移。

| 门禁 | 正面 | 负面 |
| --- | --- | --- |
| `install`（`apply_steps`） | 154 → 156 两步原子前进；4 表建成、3 行注册数据写入；父代行与 ACL 不变 | 注入 `verify_initial_values` 失败 → 整体回滚到 154 且 `verify_tables(installed=False)` 确认**无任何 156 对象**；`preservation` 与 intent 不符时拒绝；父代目录成员多一条时拒绝；`steps_files(153)` 拒绝；父代目录只有 153 条时拒绝；安装后重放 `apply_steps` 拒绝 |
| 结构冻结 | `verify_catalog` 对照 `workflow_automation_catalog.json` 全量比对通过 | — |
| 初始值 / 注册行分工 | 三表空 + 注册行逐字段一致 | 篡改一行注册数据时 `verify_initial_values` **仍通过**（它不管这个）而 `verify_registry_rows` 拒绝；删一行注册数据时 `verify_registry_rows` 拒绝；往空表插一行业务数据时 `verify_initial_values` 拒绝 |
| 权限 | 4 表 owner-only 被冻结为期望值 | `teruisi_workflow_reader` / `teruisi_workflow_writer` 对 4 表的 `SELECT` 全部被拒 |
| 启动 | `check_database(seeded=True)` 通过，无 pending migration | — |

捕获到的 ACL 指纹实证了设计 §3 的判断：4 张表的 `acl` 全部只有 `OWNER` 条目，没有任何 workflow 角色；序列 `automation_module_results_id_seq` 同理。

**`admission` 门禁的覆盖情况要如实说明**：段二的 16 个负面用例覆盖的是 `_verify_active_with_base`（`release`/`successor`/`finalize` 读收据那条路径）与 `plan` 身份校验。`admission` 的字段校验（证据字段集、`status`、各摘要、proof 的 `generations`/`parentVariants`/`checks`）**没有独立的负面用例**——它与 `candidate` 的正向绑定由 `check_schema_code_digest.py` 的两条链间接覆盖（`workflow-0009.json` 通过意味着 recipe/proof/evidence 三者摘要自洽），但"喂一份字段缺失的证据给 `admission` 会不会被拒"这件事我没有单独实跑。这是本次验证的一个缺口，列在 §9。

## 8. 两道 CI 门禁仍过

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 控制器资格化 + 维护续接（含新增本代资格化测试） | `node --test tests/maintenance-controller-qualification.test.mjs tests/manual-maintenance-continuation.test.mjs` | `exit=0`，tests 54 / pass 54 / fail 0 |
| recipe 摘要（两条链一起） | `check_schema_code_digest.py --recipe workflow-0009.json --recipe sales-0012.json` | `EXITCODE=0`，两条都 `status:"passed"`、`errors:[]` |
| 摘要检查器自身的静态测试 | `python -B tests/schema-code-digest-static.py` | `exit=0`，Ran 15 tests OK |

退出码都是重定向到文件后单独读的，不是从管道取的；`check_schema_code_digest.py` 的退出码与每条结果的 `"status"` 字段**两个口径都看了**。

PowerShell 两宿主解析（`Parser.ParseFile`，不执行）：PS 5.1 (5.1.26100.9444) 与 PS 7 (7.6.9) 对 `bi-app-adopt.ps1`、`django-local-service.ps1` 均 0 错误。这道检查当场抓到了两个真实的转义错误（一个多出的反斜杠、一个被吞掉的反斜杠），已修。两个文件的 UTF-8 BOM 与 CRLF 行尾都保留。

## 9. 我没能验证的部分（不用"已完成"掩盖）

1. **`install` / `finalize` 在生产上的行为完全没有验证。** 需要停机 + 用户单独授权，本任务边界内不做。隔离演练只证明"同一套 addition/catalog 代码在合成 PostgreSQL 上四道门禁逻辑成立"，不能证明生产现场的 ACL 硬化、维护窗口、进程停稳、互斥锁与真实数据量下的 `preservation` 投影。**这一块是待验证。**
2. **`release` / `successor` 没有在生产 runtime 上以完整 12 层链实跑。** 原因见 §6 段二：需要本代 active 标记，而标记只有 `install`/`finalize` 会写。段一证明了父链在生产上成立，段二证明了本代收据契约成立，但"生产 runtime 上这两个子命令返回 verified"这一句**我没有也不能在本任务内给出**。
3. **`admission` 的负面用例没有独立实跑**（见 §7 末段）。
4. **`verify-release-candidate.mjs` 会拒绝本次候选。** 它 `:438` 对改动 `tools/main-schema-release.mjs` 的增量硬断言 `schemaAdmissionOnly === true`，而该标志只在 `baseCommit === 'a7041338…'` 且复用特定 preflight 报告时为真。按[CI 门禁不进入发布链路](../规范/验证与发布.md#ci门禁不进入发布链路)，该工具没有生产调用方、不被发布器调用，所以它拒绝**不阻塞发布**；但它会影响合并步骤的检查选择，请在合并授权时知悉。本次没改它——改它需要独立的受审增量资格。
5. **automation 四张表的权限缺口**：见 §10。
6. **`FILES` 等式的脆弱性**：见 §2 末段。第三个无关迁移合并进 main 就要再开一代。
7. **本代是第一个在 `apply_steps` 里执行 `RunPython` 的 addition。** `POLICY` 字符串沿用 `schema-only-no-full-backup-or-restore-v1` 不变（确实不做全量备份/恢复），但语义上多了"写 3 行注册数据"。演练覆盖了它的原子性，执行脚本也断言了 `0010` 的 `RunPython` 是 reversible（所以中断回滚是定义好的动作而非未知态），但这是一次策略语义的扩张，记录在此。

## 10. automation 表的权限缺口：会发生什么

实测三件事：

- `0009` / `0010` 两个迁移里**没有任何 `GRANT`**；
- `backend/teruisi_backend/health.py` 的 `WORKFLOW_WRITER_TABLE_PRIVILEGES` 里**没有任何 `automation_*` 条目**（grep 计数 0）；
- `tools/django-workflow-service.ps1:238` 的角色授予只遍历 `reader_tables` / `writer_privileges`，碰不到这 4 张表。

所以 4 张表安装后是 **owner-only**，`teruisi_workflow_reader` / `teruisi_workflow_writer` 对它们无任何权限（演练已实证：两个角色对 4 表的 `SELECT` 全部被拒）。

而 `backend/workflow/automation_run_views.py` 的 4 个只读 HTTP 端点（`backend/workflow/urls.py:11-24`：`automation-runs`、`.../attempts`、`.../module-results`、`automation-exceptions`）走 workflow 角色访问这 4 张表。

**会发生什么**：`health.py:2053` 起的 writer 就绪检查是双向判定——"有权限但不在白名单"判 `privilege_excessive`，"白名单里有但实际无权限"判 `privilege_missing`。这 4 张表**两边同时缺失**，于是就绪检查**一致通过**。结果是：

> **结构能装上、就绪检查是绿的、那 4 个端点在生产上可能 500。**

这不是本代引入的缺陷——两个迁移是别人的功能带进来的，缺口在它们合并时就存在。但**本代上线后它会从"纸面缺口"变成"可触发"**：表真的建出来了，端点真的会去查它们。

形状与 10/29–10/30 广东仓监控报 `schedule_data_invalid` 是同一个病：门禁只比对契约不比对实际权限，真因在取数之前。

**处置**：本代只冻结现状（catalog 的 ACL 期望值按 `acldefault('r', relowner)` 固定为 owner-only），**不替功能方做权限决定**。改 `health.py` 白名单属于那块功能自己的权限设计，建议作为一条**独立任务交给功能方**，与本次解闸分开授权、分开验收。

## 11. 下一步需要的授权

本任务到此为止。按 AGENTS.md 第 4、5 条，后续三步各自需要单独授权：

1. **合并到 `main`** —— 未取得，未执行。注意 §9 第 4 条。
2. **准备制品** —— 未取得，未执行。
3. **发布上线** —— 未取得，未执行。

发布真正解闸还差闸①②（发布记账无 adopt 入口），那是另一条会话在做的 `tools/publish-latest-main.mjs`，本任务未碰该文件。本代解的是闸③④。
