# AI159 schema 摘要门禁续期（2026-11-16）

分支 `codex/ai159-structure-evidence-20261116`，基线 `main` = `f6926841`。
**只更新证据文件：未合并、未推送、未准备制品、未发布。** 未写 `D:\teruisi-runtime` 或生产数据库；只执行（不修改）了 runtime 自带的 venv Python 与 `postgresql-17.11\bin` 下的 `initdb/pg_ctl/createdb/psql`，对象是私有临时数据目录。本次隔离演练经用户明确授权。

## 1. 失败现象

CI 步骤 `Current Ai158 schema recipe source bindings`（`.github/workflows/ci.yml`）在 `d26e4e67` 上实跑（不经管道）：退出码 1，`"status": "failed"`：

```
Recipe codeSha256 differs from gate.code_digest(root)
Validation codeSha256 differs from gate.code_digest(root)
ValueError: AI159 PostgreSQL structure input changed; isolated PG rehearsal required: backend/market/models.py
```

CI 上看不到这道红：main 自 11-02 起每次都在第 6 步 Lint 失败，第 7–18 步全部 skipped。Lint 修复在 `codex/ci-lint-baseline-20261116`（另一会话，未合并）。

## 2. 漂移清单（对照 11-07 证据，baseCommit `f3e69c28`）

门禁遇到第一个结构输入错误即停止，实际漂移比报错多：

- `CODE_FILES` 111 个中 12 个变化（`.ps1` 控制器、`pi_*.py`、`publish-prepared-main.mjs`、`manual-maintenance-continuation.mjs` 等）；
- supplemental 15 个中 4 个变化（`settings.py`、`task_dispatch.py`、`task_dependencies.py`、`pi_views.py`）；
- PG 结构输入 309 个中 4 个变化；迁移清单零变化（169 个文件，159 个节点）。

| 结构输入 | 提交 | 改动 | 对 PG 结构的影响 |
| --- | --- | --- | --- |
| `backend/market/models.py` | `668e9e7e` | 新增模块常量 `AUTO_ANNOTATION_RULE_KIND` 与注释 | 无 |
| `backend/teruisi_backend/settings.py` | `4bce2a44` | 生产环境端口校验改用 `native_port(5432)` | 无（演练以 test 环境运行） |
| `tools/django-inventory-service.ps1` | `4bce2a44`、`b7280770` | 原生端口/运行目录映射，其余为 CRLF 重写 | 无 |
| `tools/django-workflow-service.ps1` | 同上 | 同上 | 无 |

`market/models.py` 只是"看起来像"结构变化：当前树上 Django autodetector（dummy 后端、禁止连接）零变更。它被算作结构输入，是因为演练用 audit hook 记录进程打开过的所有 backend/tools/config 文件，而 Django 加载会导入全部 models。

## 3. 为什么必须真跑演练

- `verify_structure_evidence` 把路径固定为 `docs/ai-p2-20261107/structure-result.json`，要求全部结构输入字节一致；发布时的 `admission()` 调用同一函数，豁免文件等于削弱发布闸。
- 代码检查生成器 `docs/ai-p2-20261107/run-mandatory-checks.py` 第一步就校验结构证据，代码那一半不能先生成。
- 手改哈希等于伪造一次 PG 运行。

本代此前也是原地重生成（11-07 的 `26465f99`、`7d21e897`、`0c7dda34`），本次沿用：两个生成脚本均**未修改**，旧值保留在 git 历史中。`docs/ai-p2-20261107/FINAL.json` 与 `docs/ai-finish-20261107/COMBINED-BINDINGS.json` 是 11-07 的历史记录，不被任何代码或测试读取，保持不动。

## 4. 执行

1. 演练必须在 `D:\运营管理系统` 之外运行（`assert_isolated_source`），故使用独立 worktree `D:\codex-worktrees\ai159-structure-evidence-20261116`。
2. `python -B tools/ai_unified_tasks_rehearsal.py` → 退出码 0。私有 PG17（`serverVersionNumber` 170011）位于 127.0.0.1:55522；13 项结构检查全部通过；`cleanup` 五项均为 true；结束后端口已释放。证据差异仅为上述 4 个哈希，外加 2 个新记录的输入（`backend/pandas_runner/__init__.py`、`native_isolation.py`，由 `settings.py` 新增导入）。工具链不变：Django 5.2.17、psycopg 3.3.4。→ 提交 `27647814`。
3. 从干净冻结树 `27647814` 运行生成器，输出写入仓库外的私有目录：退出码 0；111 个 `CODE_FILES`；Python 92 / node 5 / PowerShell 11 个文件（PS 5.1.26100.9444 与 7.7.0）；迁移图未变，models 与迁移状态一致。三个输出逐字节复制入库，并核对工作区、git blob 与输出三者一致。→ 提交 `70364cbd`。

| 字段 | 新值 |
| --- | --- |
| `codeSha256` | `19a06f1cfa5dc0620f7a89c87472e116f05a57cf1aec99800a987d29ded67942` |
| `validationSha256`（`ai159-checks.json`） | `17646a9379626b26f7eed169d58fac8000965e3d92b04bda7455799340b84201` |
| `migrationSha256` | `4fcc89b07c1e4b735d094c5e4efc27a291cfcc5a37a8b8beddfa03540ffd897c`（未变） |

## 5. 验证（在 `git archive HEAD` 导出树上运行，均重定向到文件后读取真实退出码）

| 命令 | 结果 |
| --- | --- |
| `tools/check_schema_code_digest.py --recipe config/main-schema-releases/ai-0090.json` | EXIT=0，`status: passed`，`errors: []` |
| `tests/schema-code-digest-static.py`（同一 CI 步骤） | EXIT=0，30 tests OK |
| `tests/ai159-structure-evidence.py` | EXIT=0，4 tests OK |
| 同一门禁，在本分支与 `codex/ci-lint-baseline-20261116` 的合并树（`git merge-tree`）上 | EXIT=0，`status: passed` |

Lint 分支改动的 12 个文件与 `CODE_FILES`、supplemental、结构输入均无交集，两个分支的合并顺序不影响本证据。

## 6. 须知

- 以后只要改动这 309 个结构输入中的任何一个（包括与 schema 无关的 models、settings 或控制器），这道门禁都会再次变红，需要重新演练；改动 111 个 `CODE_FILES` 之一，则需要重跑生成器。
- 本次只做演练与静态检查，不涉及业务功能验证（AGENTS.md 第 4 条）。
- CI 运行在 Ubuntu 上；该步骤不需要 PowerShell，本地已用相同命令验证。
