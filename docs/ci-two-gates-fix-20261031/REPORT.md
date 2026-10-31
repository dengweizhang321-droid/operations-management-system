# main 两道 CI 门禁修复（2026-10-31）

分支 `claude/ci-two-gates-fix-600f89`，基线 `main` = `cf019212`。
**本次只改代码与证据文件：未合并、未准备制品、未发布，未执行任何会写 `D:\teruisi-runtime` 或 `D:\codex-isolated` 的命令。** 对生产 runtime 的访问仅限只读调用其自带 venv 解释器（`D:/teruisi-runtime/django-sales/venv/Scripts/python.exe`）。

所有哈希均为本次实算，不从任何简报或历史文档转抄。

## 1. 两道失败的实测复现（修复前）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| `.github/workflows/ci.yml:50` | `node --test --test-timeout=30000 tests/maintenance-controller-qualification.test.mjs` | EXIT=1，`pass 2 / fail 1` |
| `.github/workflows/ci.yml:62` | `python -I -B tools/check_schema_code_digest.py --recipe config/main-schema-releases/sales-0012.json` | EXIT=1，`"status": "failed"` |

第一道报错原文：

```
django-local-service.ps1: repository SHA-256 fbb62792eb0962cb91b76b0045a08812d29de0dabb0ab9056ac9ce235d76bddb
is not in its reviewed qualification list; review the controller before adding a hash
```

第二道的 7 条 error（比交接简报描述的更宽，简报只提到 `codeSha256`）：

```
Recipe codeSha256 differs from gate.code_digest(root)
Validation codeSha256 differs from gate.code_digest(root)
Validation migrationSha256 differs from source inventory
Sales evidence codeSha256 differs
Sales evidence migrationSha256 differs
Sales evidence sourceFiles differ from actual gate members
Sales evidence supplementalSourceFiles differs: backend/teruisi_backend/settings.py
```

`migrationSha256` 与 `settings.py` 这两项简报未列出，根因见 §4。

## 2. 三处 drift 改动的审阅（本报告核心）

资格化的语义是「承认这个控制器改动」，不是对齐数字。以下逐个判断，判据是**自己读源码核实**，不是采信提交说明。

### 2.1 `tools/django-local-service.ps1`：`98028cb4…` → `fbb62792…`

两个提交叠加：

**`94312406`（perf(status): batch one process enumeration for aggregate status）**
`AggregateStatus` 原来每个 PID 跑一次 `Get-CimInstance Win32_Process -Filter "ProcessId = N"`；十个域各解析 reader+writer，约 20 次查询。该提交加了一个**按 ProcessId 索引的单次全量枚举缓存**，默认关闭（`$script:ProcessSnapshotCache = $null`）。

**`3cf4927f`（fix(status): wrap the whole snapshot if-expression in @()）**
前一个提交把 `@()` 放在 if 的**每个分支内部**。PowerShell 在单元素数组离开 if 表达式时会拆包，`$rows` 退化成裸 `CimInstance`，其 `.Count` 是 `$null`，于是 `-gt 1` 和 `-eq 1` 同时为假，每次单行查找都走完重试循环并**误报进程不存在**；`Assert-PostgresListenerOwnership` 据此判定「5432 监听器不是本部署 PostgreSQL」，`DeployApp` 在 PG 健康的情况下拒绝发布。改成 `@()` 包住整个 if 表达式。

**判断：可以资格化。** 实际核实的点：

1. **缓存不可能成为「判定不存在」的依据。** `Get-ProcessSnapshot`（`tools/django-local-service.ps1:2640`）只在 `$attempt -eq 1` 且缓存已填充且 `ContainsKey` 命中时读缓存；未命中或元数据空白都落回同一条实时查询与重试循环。三种结局（可用快照 / `$null` 缺失 / 元数据不可用抛错）不变。
2. **枚举失败不会伪装成「不存在」。** `Initialize-ProcessSnapshotCache` 的 catch 把缓存设为 `@{}`（空而非缺失），所有查找落回实时路径。
3. **歧义仍会抛错。** 同一 PID 的重复行被保留为数组，`$rows.Count -gt 1` 的 `throw "Ambiguous process metadata"` 仍会触发。
4. **只有一个填充点，且是只读路径。** 全仓 grep 确认 `Initialize-ProcessSnapshotCache` 仅在 `Show-AggregateServiceStatus`（`:4841`）被调用，`finally` 无条件清理（`:4899`）。
5. **生命周期路径看不到缓存。** 所有进程树/生命周期调用点（`:2704`、`:2730`、`:2747`、`:2763`、`:2770`、`:2778`、`:2853`、`:2997`、`:3180` 等）都显式传 `Attempts` 且从不填充缓存，因而直接走实时查询。
6. **填充路径无法触碰 PID 记录清理。** `Resolve-OwnedProcess`（`:2836-2838`）对任何 `Status$` 动作强制 `-ReadOnly`，`$ReadOnly = $ReadOnly -or $Action -imatch 'Status$'`，即使调用方漏传开关也不会退回清理分支。
7. **另两个控制器以库方式 dot-source 本文件**（`django-postgres-maintenance.ps1:2338`、`django-runtime-supervisor.ps1:957`），两者都不填充缓存，故同样只走实时查询。
8. **未触碰的边界：** 停服/启动协议、维护 enter/exit、维护锁、drain、STARTED/SUCCESS 回执、迁移逻辑、schema addition 准入闸、ACL/权限、worker 启停时序、信号处理均未改动；无新增外部进程，无放宽断言。
9. **语法与编码：** PS 5.1（5.1.26100.9444）与 PS 7（7.6.9）双宿主 `Parser.ParseFile` 均零错误；文件保留 UTF-8 BOM（实测前三字节 `EF BB BF`）。

### 2.2 `tools/postgres_no_key_backup.py`：`dff8e226…` → `dd08698f…`

提交 `4164d99f`（fix: load the Django app registry before generation153 catalogue checks），纯新增 40 行，加一个 `_require_django_app_registry()` 并在 `verify_receipt_generation` 开头调用。

**判断：可以资格化。** 从 generation153 起 catalogue 链要与真实 model 类比对，会 import `ai_assistant.pi_models`；在 registry 未就绪时定义 model 类会抛 `ImproperlyConfigured`，所以日常 PostgreSQL 备份自 2026-10-19 起被卡住，并把真因显示成假的「Pi153 column/default drift」。核实的点：函数先检查 `apps.ready` 并提前返回，不重复初始化；校验全程使用调用方的 cursor，不打开 Django 自己的连接，占位 URL 因此不含任何凭据，只用于固定 `db_type()` 读取的 PostgreSQL 后端；保留了部署态 SQLite 拒绝（见记忆 `pg-backup-blocked-by-missing-django-setup`）；只在 `TERUISI_DJANGO_DATABASE_URL` 未设置时整套写入占位配置，避免继承半套配置被无关变量阻断。未改备份本身的数据路径、保留策略或恢复逻辑。

**需要说明的边界：** 合并本提交**不会**让日常备份自动恢复——调度仍是 PAUSED，属独立的生产状态变更。

### 2.3 `backend/ai_assistant/database_contract.py`：`bea8655d…` → `c5da8528…`

提交 `b8c0ed58`，契约部分是**删一行**：把 `ai_write_request_receipts` 从「限定 SELECT/INSERT/UPDATE」的集合移出，回落到默认四权限。

**判断：可以资格化。** 2026-10-28 的 TTL 清理在 `backend/ai_assistant/views.py:69` 对该表执行 `.delete()`，而契约不授予 DELETE，生产 `teruisi_ai_writer` 因此在每次 AI 写请求上报 permission denied、Django 返回 503。

**我独立核实了「只有这一处 DELETE」这一关键声明**，没有只采信提交说明：grep `backend/ai_assistant/*.py` 的 `.delete()` / `_raw_delete` / `DELETE FROM`，命中的其他位置分别作用于 `AiConversationMessages`、`AiArtifacts`、`AiChannels` 等表，均不在那个被限定的集合内；`policy.py:281` 的 `DELETE FROM` 是正则字面量而非执行。契约里 `WRITER_PRIVILEGES` 的默认值本就是四权限（`database_contract.py:172-173`），所以这次是**恢复默认**而非扩权。

**权限边界的影响是收窄语义上的放宽，必须明说：** 这确实给 writer 角色在该表上增加了 DELETE。我判断可接受的依据是代码已经在执行该 DELETE（所以当前是契约与代码不一致、且生产正在因此 503），且清理范围受 `status="completed"`、7 天 TTL、单批 20 行三重限制，`stale_manual_review`/`processing` 状态被显式排除留待人工对账。

**需要说明的边界：** 合并本提交**不改变生产数据库权限**，仍需单独授权执行 `ProvisionRoles` 才会生效。

### 2.4 结论

三处改动均**未**触及停服/启动协议、迁移逻辑或权限边界之外的范围，各自只影响其声称影响的范围，无实质问题，可以资格化。

## 3. 第一道门禁的修复

### 3.1 追加资格哈希

`tools/manual-maintenance-continuation.mjs`：

- 新增 `export const batchedStatusEnumerationDjangoScriptSha256='fbb62792…'`，照 `sales154SchemaAdditionDjangoScriptSha256` 的命名与注释范式，注释写明两个提交、缓存的安全性质、`@()` 拆包的真因，以及审阅位置。
- `piNativeCandidateControllerSha256['django-local-service.ps1']` **追加**该哈希，**三个旧代际全部保留**，现为四元：`piNativeCandidate` → `aDescendantCreationGuard` → `sales154SchemaAddition` → `batchedStatusEnumeration`。保留旧代际是为了让本次改动的回退不被它自己的资格条目挡住。

**未改动** `piMaintenancePredecessor` / `nativePiBusinessPredecessor` / `firstMaintenancePredecessor` / `nativePiWorkspacePredecessor` 里的 `djangoScriptSha256`、`workerScriptSha256`、`workerTransportSha256`——那些描述「生产现在装的是什么」，是前驱实际字节。

### 3.2 同步测试绊线（保留绊线语义）

`tests/manual-maintenance-continuation.test.mjs`：

- 既有用例 `reviewed Django controller generations…` 改为断言仓库 .ps1 的实算 SHA-256 **等于注册常量** `batchedStatusEnumerationDjangoScriptSha256`，并新增 `notEqual` 把新代际与 Sales154 代际区分开。**仍然是「等于恰好一个注册值」，没有改成自动跟随文件**。
- 两处 `deepEqual` 的 pin 列表同步为四元。
- 新增用例 `batched status enumeration: append exact qualification…`，照既有范式覆盖：前向采用、后向回退、**每一个**更早代际对新字节仍可采用、未资格化字节失败关闭（改末位一字符）、哈希不泄漏到 `worker-local-service.ps1` / `process-deadline.ps1` / `unknown.ps1`。

### 3.3 绊线反向验证

在 .ps1 末尾追加一行注释后重跑，两套测试都如期失败（`maintenance-controller-qualification` EXIT=1、`manual-maintenance-continuation` EXIT=1），随后恢复原字节并复核 SHA-256 回到 `fbb62792…`。绊线仍然失败关闭，没有被改成自动跟随。

## 4. 第二道门禁：一个交接简报未预见的复杂情况

### 4.1 为什么不能手改哈希

简报的第 4 步要求把 `codeSha256` 同步到四处，并手改两份 proof 里 86 条 `sourceFiles` 的逐文件哈希。实际读文件后判断**不应该这么做**：

`docs/sales154-preservation-order-key-20261030/MANDATORY-CHECKS.json` 不是哈希表，而是一份**执行记录**：它带 `executionScriptSha256`、双 PowerShell 宿主的版本与检查文件数、`migrationClosure` 里 Django 真实迁移图的节点数/操作类型/`modelsMatchMigrationState`/Django 版本。手工改写其中的数字，等于**伪造一次没有发生过的检查**，违反 AGENTS.md 第 4 条与规范里「不得手填通过」。

正确做法有先例：生成它的脚本 `run-mandatory-checks.py` 就在同目录，且其实算哈希仍等于记录里的 `executionScriptSha256`（`82d407e1…`，已实测核对）。历史上两次续期（`0e4e851a`、`368a88a7`）都是**新建任务目录 + 重跑生成器 + 把 proof 的 `evidence` 指向新记录**，而不是改旧文件。本次沿用该先例。

### 4.2 生成器已经跑不起来——真正的根因

直接复制生成器无法运行。它调用 `gate.source_delta(ROOT, baseline)`，而该函数（`tools/sales_preflight_addition.py:53-59`）要求迁移清单恰好是 parent-153 集合加上 Sales154 那一个步骤。实测抛错：

```
ValueError: Only the exact reviewed153-to154 delta is supported
```

原因是 Sales154 证据上次续期后，main 上又合入了两个**与本代无关**的 migration：

| 文件 | 实算 SHA-256 | 引入提交 |
| --- | --- | --- |
| `backend/workflow/migrations/0009_automation_projection_b1.py` | `adafff9db82c661409e16488be6461f6a52d436f226360254d8af82a9b6c89bc` | `ed3bd8b3` |
| `backend/workflow/migrations/0010_customer_service_chain_modules.py` | `f5cf004563db635baa29fcb57e3965f26c085eb14ba2eb13eaf78a85f53de8cd` | `7ca4fbec` |

`bi_app_addition.migrations()` 用 `(root/"backend").glob("*/migrations/*.py")` 扫全仓所有 app，所以任何无关 app 的新迁移都会打断这代的 delta 判定。这同时解释了简报未列出的两条 error：`migrationSha256` 变了（迁移清单多了两个文件），而 `settings.py` 的 supplemental 哈希变了是因为 `2c29fc3c` 给它加了两个网店投影配置项。

### 4.3 采取的做法

新建 `docs/ci-two-gates-fix-20261031/run-mandatory-checks.py`，相对前一版**只改迁移闭包那一段**，其余检查逐字保持。替换后的校验比原来**更严而不是更松**：

- parent-153 的每个迁移文件在当前树里字节完全一致（实测 163 个文件零差异），记为 `inheritedMigrationsByteIdentical`；
- Sales154 的步骤文件存在且字节等于 `gate.FILES` 声明值；
- 除此之外新增的**只能是**上表两个被点名的文件，哈希写成脚本里的字面量——出现第三个无关迁移时脚本直接失败，不会自行扩大集合；
- `gate.source_delta` 的真实拒绝被**记录为事实**（`salesDeltaAdmittedByGateSourceDelta: false` 与 `gateSourceDeltaRefusal` 原文），并断言它确实拒绝，而不是绕过它；
- Django 真实迁移图仍然加载，`sales.0012` 仍只含 `AddIndex`，models 与迁移状态仍一致（autodetector 零变更）。

**明确声明：本次没有、也不打算重新采纳 Sales154 的代际 delta。** 未改动任何 addition 模块、catalogue、admission 路径或已安装门禁；`scope` 字段在证据里写明了这一点。那道 `source_delta` 失配是发布链的独立问题（见第 7 节），不在本任务范围。

### 4.4 实跑生成器

```
python -I -B docs/ci-two-gates-fix-20261031/run-mandatory-checks.py    → EXIT=0
```

`status: passed`，`codeFileCount: 86`，python 57 / node 5 / powershell 11 / json 14 个文件；PowerShell 双宿主均 0 错误（5.1.26100.9444 与 7.6.9）；`databaseContacted: false`、`productionTouched: false`。完整输出存 `MANDATORY-CHECKS.log`，证据存 `MANDATORY-CHECKS.json`。

### 4.5 同步的字段（全部现算）

**关键顺序：** `tools/manual-maintenance-continuation.mjs` **本身就是 `CODE_FILES` 的 86 个成员之一**，所以第一道门禁的修复会改变 `codeSha256`。因此先完成第 3 节的全部改动，再计算第二道门禁的所有摘要。

| 位置 | 字段 | 新值 |
| --- | --- | --- |
| `config/main-schema-releases/sales-0012.json` | `codeSha256` | `04ba55b47b61b7de11a7096b1441fc210c31cbb9135ac810a813799385c13c17` |
| 同上 | `validationSha256` | `641dfa31f87b8140437b5f7293ce634f1708666372ccd87782a131204217358c` |
| `docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json` | `codeSha256` | 同上 `04ba55b4…` |
| 同上 | `migrationSha256` | `05802c9ef1af3a46fb9c980965d6f98ba06d1ee35459cf514050280fbd67bb31` |
| 同上 | `evidence.path` | `docs/ci-two-gates-fix-20261031/MANDATORY-CHECKS.json` |
| 同上 | `evidence.sha256` | `f2c8b645a1f93d81eb264b28b467d2b7dbacdf0614f04e2ec225b88d9bd17679` |

86 条 `sourceFiles` 的逐文件哈希与 supplemental 的 `settings.py` 哈希，都由生成器实算写入新证据文件，**没有手抄任何一条**。旧的 `docs/sales154-preservation-order-key-20261030/MANDATORY-CHECKS.json` 保持原样不动（它是历史记录）。

## 5. 两道 CI 命令的实跑结果

为避开简报点出的两个陷阱：所有输出**重定向到文件后再读退出码**（不用管道，那返回管道的退出码），并且退出码与 `"status"` 字段**都看**。

最终验证不在工作区里跑，而是用 `git checkout-index -a -f` 导出**暂存区的精确字节**到干净目录后执行，确保 CI 看到的就是这个结果（已核对导出树里 .ps1 的 SHA-256 仍是 `fbb62792…`）。

### 第一道

```
$ node --test --test-timeout=30000 tests/maintenance-controller-qualification.test.mjs
EXIT=0
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

### 第二道

CI 的该步骤有两条命令，两条都跑了：

```
$ python -I -B tests/schema-code-digest-static.py
EXIT=0
Ran 15 tests in 16.587s
OK

$ python -I -B tools/check_schema_code_digest.py --recipe config/main-schema-releases/sales-0012.json
EXIT=0
{
  "recipe": "config/main-schema-releases/sales-0012.json",
  "status": "passed",
  "errors": [],
  "codeFileCount": 86,
  "actualCodeSha256": "04ba55b47b61b7de11a7096b1441fc210c31cbb9135ac810a813799385c13c17",
  "actualMigrationSha256": "05802c9ef1af3a46fb9c980965d6f98ba06d1ee35459cf514050280fbd67bb31",
  "actualValidationSha256": "641dfa31f87b8140437b5f7293ce634f1708666372ccd87782a131204217358c",
  "parentVerified": false,
  "databaseContacted": false,
  "declaredChecksExecuted": false
}
```

退出码 0 且 `"status": "passed"`、`errors` 为空，两项同时满足。

### 字节一致性核对

逐个核对工作区文件与 git 暂存 blob 的 SHA-256 完全相同（防止 `.gitattributes` 的行尾转换让门禁在 CI 里算出另一个值）。本次新增目录按既有先例补了两条 `.gitattributes` 规则（`*.json -text whitespace=cr-at-eol`、`*.log -text -diff`），补之后 7 个文件全部一致。

## 6. 既有失败的基线对照（detached worktree 实测）

在 `cf019212` 建 detached worktree 实测，不靠推断。

| 测试 | 基线（cf019212） | 本次修复后 | 判定 |
| --- | --- | --- | --- |
| `maintenance-controller-qualification` | EXIT=1，`pass 2 / fail 1` | **EXIT=0，`pass 3 / fail 0`** | 本次修复 |
| `manual-maintenance-continuation` | EXIT=1，`pass 48 / fail 1` | **EXIT=0，`pass 50 / fail 0`** | 本次修复，新增 1 用例 |
| `manual-maintenance-business-readiness` | EXIT=1，`pass 10 / fail 3` | EXIT=1，`pass 10 / fail 3` | **既有失败，与本次无关** |
| `main-publication-readiness` | — | EXIT=0，`pass 4` | 通过 |
| `manual-maintenance-pi-readiness` | — | EXIT=0，`pass 25` | 通过 |
| `publish-prepared-main` | — | EXIT=0，`pass 58` | 通过 |
| `release-chain-preflight` | — | EXIT=0，`pass 10` | 通过 |
| `verify-release-candidate` | — | EXIT=0，`pass 27` | 通过 |

**对交接简报的两处更正：**

1. 简报说 `manual-maintenance-continuation.test.mjs` 在干净基线上有「约 7 个」既有失败。实测只有 **1 个**，且正是本次这同一处 drift（断言 .ps1 实算哈希等于 `98028cb4…`）。修复后该文件 **50/50 全绿**，没有遗留既有失败。
2. 既有失败的「候选Pi控制器不在已审兼容资格内」实际出现在 `manual-maintenance-business-readiness.test.mjs`（3 个）。已核对基线与修复后的**失败用例名与断言消息逐字相同**，确认与本次改动无关，未作处理。

其余 CI 步骤：`check:pi152-acl` 通过（EXIT=0）；`tests/ai-writer-privilege-coverage.py` 按 CI 的直接调用方式通过（EXIT=0，注意它**不能**用 `npm run` 跑——`2b6c247d` 为保 Worker guard 的字节一致性已把该 npm script 从 `package.json` 移除，CI 改为直接调用）；`check:backend-boundary` 通过。`check-lint-baseline.mjs` 在本 worktree 与基线 worktree **同样失败**（`eslint did not produce parseable JSON output`，stderr 为「系统找不到指定的路径」），属该 worktree 缺少依赖安装的环境问题，基线同症，与本次改动无关。

未执行：`npm ci`、`npm run build`、CI 的 curated unit test 子集（都需要完整依赖安装，本 worktree 不具备；且与本次改动的文件无交集）。

## 7. 明确未做、未验证的事项

**未做（超出本任务范围）：**

- 未合并到 `main`，未推送远端，未准备制品，未发布。AGENTS.md 第 4、5 条要求这三步各自单独授权。
- 未碰生产：未执行任何写 `D:\teruisi-runtime` 或 `D:\codex-isolated` 的命令；对 runtime 的接触仅限只读调用其 venv 解释器。
- 未重构、未合并代际枚举。并行进行的「单一真相源」设计调查的对象正是这几个文件，本次保持最小改动，未抢跑。
- 未改动旧的 `docs/sales154-preservation-order-key-20261030/MANDATORY-CHECKS.json`，未改动任何前驱字节字段（`djangoScriptSha256` / `workerScriptSha256` / `workerTransportSha256`）。

**未验证 / 需要用户知悉：**

- **`gate.source_delta` 对当前 main 仍然拒绝**（见 4.2）。本次把这个事实如实记进证据，但**没有修复它**。它会继续阻塞 `PrepareApp` 的 11 层 addition 校验（这正是五道闸之一），需要独立处理——按既有调查结论，解法是撤标记（属生产状态变更，需授权）或新建一代 addition 把这两个迁移声明进 `FILES`，不是等它们「先上线」。
- 本次只做静态字节与源码检查。三处改动的**业务行为未验证**：缓存在真实负载下的 AggregateStatus 表现、备份链在生产 registry 下的端到端结果、writer 角色在真实权限下的 DELETE 行为，均按 AGENTS.md 第 4 条由用户上线后检测。
- 合并本次改动**不会**恢复日常 PostgreSQL 备份（调度仍 PAUSED），也**不会**改变生产数据库权限（仍需单独授权 `ProvisionRoles`）。
- CI 在 Ubuntu runner 上跑，PowerShell 双宿主解析检查只能在本机验证；本次 `MANDATORY-CHECKS.json` 里的 PowerShell 证据来自本机实跑。

## 8. 改动文件清单

```
 .gitattributes                                            |   2 +
 config/main-schema-releases/sales-0012.json               |   4 +-
 docs/ci-two-gates-fix-20261031/MANDATORY-CHECKS.json      | 283 +++++ (新增，生成)
 docs/ci-two-gates-fix-20261031/MANDATORY-CHECKS.log       | Bin      (新增，实跑输出)
 docs/ci-two-gates-fix-20261031/run-mandatory-checks.py    | 252 +++++ (新增)
 docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json | 8 +-
 tests/manual-maintenance-continuation.test.mjs            |  42 +-
 tools/manual-maintenance-continuation.mjs                 |  36 +-
```

生成器自身 SHA-256：`5385ad5800e7151a1b9d56a0221f08b98a4a274f2b9ecb2ec3f215ff11d6a940`（与证据里的 `executionScriptSha256` 一致，可复核）。
