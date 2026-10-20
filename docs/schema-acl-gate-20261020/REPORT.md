# PiBusiness / PiNative ACL 契约门禁（P0-1）

- 日期：2026-10-20（Asia/Shanghai）
- 分支：`codex/schema-acl-gate-20261020`
- 基线：`9637fa692fa93d2b134cbecb689a6b15a119c7ac`（含 P0-3 周报租约、P0-2/P0-5 优化）
- 状态：源码候选；未执行生产部署、迁移、服务启停或控制包采用。

## 目标

2026-10-20 组合发布在 Finalize 才发现 Pi152 的 ACL 目录期望把 append-only 的 intents/audits 也要求 UPDATE，造成约 33.7 分钟返工。本任务把静态 ACL 契约检查放到有限结构准备之前，并覆盖 main 新增的 PiNative 153。

## 改动

| 文件 | 内容 |
| --- | --- |
| `tools/main-schema-release.mjs` | 新增 `schemaAclContractScripts` 和 `runSchemaAclContract`；`prepareMainSchemaRelease` 与 `verifyMainSchemaRelease` 在调用 binder 之前运行对应静态检查。PiBusiness 用 `tests/pi152-acl-catalog-boundary.py`，PiNative 用 `tests/pi153-acl-catalog-boundary.py`；非 Pi 结构不运行。检查失败在写 `PREPARED.json` 之前抛出。 |
| `tests/pi153-acl-catalog-boundary.py` | 新增 PiNative 153 静态契约检查：7 张 native 表、3 张 append-only、有序 TABLES、`ai_pi_business_delegations` 的 native 归属；63 项正反例，不连数据库、不导入 Django。 |
| `tests/pi152-acl-catalog-boundary.py` | 沿用并保留有序 TABLES 与 `permissions=False` 负例；27 项检查。 |
| `tests/schema-acl-contract-gate.test.mjs` | 新增门禁单元测试：选择正确脚本、失败信息、非 Pi 短路；并在当前源码上实际跑通 152/153 两个静态脚本。 |
| `docs/pi-native-capabilities-20261020/mandatory-code-checks.json` | 重新绑定 `codeSha256` 为当前 PiNative `CODE_FILES` 摘要 `3dc78ede13bb...`；更新 `checkedAt`。旧值保留在 Git 历史，未改写历史报告。 |
| `config/main-schema-releases/ai-0087.json` | 同步 `codeSha256` 和 `validationSha256`（`efbba0b6...`）。 |

## 验证

- `node --test tests/main-schema-pi-release.test.mjs tests/main-schema-release.test.mjs tests/schema-acl-contract-gate.test.mjs`：9 项通过。
- `node --test tests/publish-prepared-main.test.mjs tests/publish-latest-main.test.mjs tests/publish-main-command.test.mjs`：82 项通过。
- `python tests/pi152-acl-catalog-boundary.py`：27 项通过；`python tests/pi153-acl-catalog-boundary.py`：63 项通过。
- `pi_native_candidate.candidate(...)` 在当前源码上返回 `bound`，`codeSha256=3dc78ede...`、`migrationSha256=a08ccd88...`。
- `node --check tools/main-schema-release.mjs`、`python -m py_compile`、`git diff --check` 通过。
- 本机只有 PowerShell 5.1，未运行 PS7；本任务未改 PowerShell 生产脚本。

## 证据与边界

- PiNative 的 `codeSha256` 变化来自 `main-schema-release.mjs`（在 PiNative `CODE_FILES` 内）；已针对变更加跑 Node 语法与两个 ACL 脚本，迁移和 PowerShell/Python 源未变，四个原检查类别保持原记录。未把本次门禁测试写进 `mandatory-code-checks` 的 `checks` 数组，避免改变 PiNative 证据 schema。
- `main-prebuild-queue` 中的历史固定 bundle pin 未改；新的控制包准备/采用需要单独授权。源码门禁在候选 source 的 publisher 路径生效，不依赖已安装控制包。
- 未执行生产部署、迁移、服务启停、周报发送或控制包 `--adopt`；功能与业务验收仍由用户负责。
- 合并到 `main` 前仍建议独立 `critical-review`，重点核对门禁位置、PiNative 证据重绑和控制包 pin 的影响。
