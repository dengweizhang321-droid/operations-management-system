# P0-1 发布范围计划

- 生成时间：2026-10-20（Asia/Shanghai）
- 工具：`node tools/release-scope-plan.mjs --base <生产source> --head <候选>`
- 生产基线：`e52361d5a8fc095713e0ac3553ba078c12fcba9f`（`D:\teruisi-runtime\django-sales\app\deployment.json` 的 `sourceRoot`，部署于 2026-10-20 03:39:55）
- 候选：`54e2e8f663b3b064d20fb8cc1de387fa990f0235`（`origin/main`）
- 本轮只生成计划，**没有**部署、迁移、服务启停、数据写入或控制包采用。

## 结论

P0-1（ACL 契约门禁）本身只改发布工具、测试、配置和文档；但当前生产基线仍停留在 `e52361d5`，而 `main` 已包含 PiNative 153、P0-3 周报租约、P0-2/P0-5 发布器优化。因此**不能把 P0-1 当作独立上线单元**直接从 `main` 发布，否则会连带发布 PiNative 153 等未单独批准的范围。

- **计划 A（实际下一次发布）**：`e52361d5 → 54e2e8f6`，`database-migration`，Worker + Django，包含 0087 迁移。
- **计划 B（P0-1 增量）**：`9637fa69 → 54e2e8f6`，`full`，仅 12 个文件，无 app/backend 业务代码，无迁移；用于说明 P0-1 自身的变更边界，不是独立可发布的批次。

## 计划 A：下一次完整发布（推荐先评审此范围）

| 项目 | 值 |
| --- | --- |
| 范围 | `database-migration` |
| 组件 | `worker`, `django` |
| 迁移 | 是（`ai_assistant.0087_pi_native_capabilities`） |
| 变更 | 120 个文件（68 新增、52 修改） |
| 业务域 | `ai_assistant`, `pi_runner` |
| 数据库保护 | `schema-only-no-new-full-backup-or-restore` |
| 业务数据处理 | `separate-authorization-required` |
| 计划 SHA | `95ce47af1068e5ed91a380ac2e992772d9302a810a78bfbc3eb151f838957cbf` |
| 原始计划 | [RELEASE-SCOPE.json](RELEASE-SCOPE.json) |

包含的主要范围：

- PiNative 153：`backend/ai_assistant/migrations/0087_pi_native_capabilities.py`、Pi Native 后端/前端、`containers/pi-agent/*`、Pi Runner 1.3.0 技能。
- P0-3：周报与发布租约互斥（`tools/django-workflow-service.ps1` 等）。
- P0-2/P0-5：发布器维护前驱资格检查与 source 规范化。
- P0-1：`tools/main-schema-release.mjs` 的 152/153 ACL 门禁、v2 证据和 recipe。
- `config/main-schema-releases/ai-0086.json`、`ai-0087.json`；docs/tests。

按工具生成的必需动作：

- 验证：`git-diff-check`、`worker-affected-tests`、`django-affected-tests`、`affected-integration-tests`、`django-system-check`、`migration-dry-run`、`isolated-postgresql-migration-rehearsal`。
- 制品：`prepare-worker-immutable-release`、`prepare-django-app`。
- 发布：`apply-approved-migrations`、`activate-worker-release`、`deploy-django-app`、`verify-startup`、`verify-affected-function`。

注意：`containers/pi-agent/*` 五个文件被工具列为 `unknown`，会按“未知路径升级完整流程”处理；不能按仅前端或仅后端缩小范围。

## 计划 B：P0-1 增量（仅用于边界说明）

| 项目 | 值 |
| --- | --- |
| 范围 | `full` |
| 组件 | `worker`, `django` |
| 迁移 | 否 |
| 变更 | 12 个文件（8 新增、4 修改） |
| 数据库保护 | `verified-current` |
| 计划 SHA | `ee2b5b34c7bb42b4d119cabef79e3b1a7ca6432faf306703d4462fdf2a378758` |
| 原始计划 | [P0-1-DELTA.json](P0-1-DELTA.json) |

12 个文件：

- `tools/main-schema-release.mjs`（152/153 门禁）
- `tests/pi153-acl-catalog-boundary.py`、`tests/schema-acl-contract-gate.test.mjs`
- `config/main-schema-releases/ai-0086.json`、`ai-0087.json`
- `docs/schema-acl-gate-20261020/*`（报告、验证、两代 v2 证据和 syntax v2）
- `docs/任务记录/README.md`

工具仍判为 `full`，因为 `tools/`、`config/` 属于共享发布工具；但没有 app/backend/containers 业务代码，也没有迁移。**若确实只发 P0-1**，需要从 `e52361d5` 另开一个只含 PiBusiness 152 门禁和 152 v2 证据的分支，重新生成计划；当前 `main` 不能直接拆出 P0-1。

## 已验证与未验证

已在 P0-1 合并前后完成：

- 结构发布测试 9 项、发布器 82 项、队列/验证器 21 项。
- Pi152 ACL 27 项、Pi153 ACL 63 项。
- PiNative binder `bound`；两代 recipe 的 `codeSha256`/`validationSha256` 与 v2 证据一致。
- P0-3 的 PS5 夹具 48 项、发布器 52 项、争用 5 项、验证器 8 项、优化 3 项（合并到 main 时复跑）。

计划 A 仍需补：

- `django-system-check`、`migration-dry-run`、`isolated-postgresql-migration-rehearsal`（针对 0087，当前会话未跑）。
- PiNative 的独立候选验证/必要原生冷启动证据（当前无完整隔离冷启动环境；PS7 不可用，只有 PS5）。
- 新控制包准备与采用：`main-schema-release.mjs` 在 `install-main-prebuild.mjs` 的 controlFiles 内，已安装控制包尚未采用本次变更；采用需要单独授权。
- 生产上线授权；数据库迁移、服务启停和任何业务数据写入均未授权。

## 建议顺序

1. 先确认计划 A 的范围是否包含 PiNative 153；若 PiNative 未获批准，不要从当前 `main` 发布，改用只含 152 门禁的独立分支重新计划。
2. 在隔离环境补齐计划 A 的 `django-system-check`、migration dry-run 和 PostgreSQL 迁移演练。
3. 冻结 `54e2e8f6` 为发布候选，准备 Worker 不可变制品、Django PrepareApp 和新控制包；记录制品 SHA。
4. 取得明确生产授权后，按 plan 的 publish 顺序执行：0087 迁移 → Worker 激活 → Django 部署 → 启动/受影响功能检查。
5. 发布后按原生回执收尾，不追加独立功能验收。

原始 JSON 的 `reasons` 字段保留了工具现有的中文编码显示；`scope`、`components`、`validation`、`changes`、`planSha256` 均为工具原值，路径和 SHA 不受影响。
