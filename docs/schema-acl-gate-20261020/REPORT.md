# PiBusiness / PiNative ACL 契约门禁（P0-1）

- 日期：2026-10-20（Asia/Shanghai）
- 分支：`codex/schema-acl-gate-20261020`
- 基线：`9637fa692fa93d2b134cbecb689a6b15a119c7ac`（含 P0-3 周报租约、P0-2/P0-5 优化）
- 状态：源码已合并到 `main`（`03cd411c`，后续证据/门禁增补另行提交）；未执行生产部署、迁移、服务启停或控制包采用。

## 目标

2026-10-20 组合发布在 Finalize 才发现 Pi152 的 ACL 目录期望把 append-only 的 intents/audits 也要求 UPDATE，造成约 33.7 分钟返工。本任务把静态 ACL 契约检查放到有限结构准备之前，并覆盖 main 新增的 PiNative 153。

## 改动

| 文件 | 内容 |
| --- | --- |
| `tools/main-schema-release.mjs` | 新增 `schemaAclContractScripts` 和 `runSchemaAclContract`；`prepareMainSchemaRelease` 的新鲜准备分支和 `verifyMainSchemaRelease` 在调用 binder 之前运行对应静态检查。PiBusiness 运行 152 脚本；PiNative 同时运行 152 和 153 脚本，覆盖 Finalize 对父代 152 business ACL 的复核。非 Pi 结构不运行；失败在写 `PREPARED.json` 之前抛出；复用 previous request 时只由 verify 路径运行一次。prepare 路径也透传 `runAcl` seam。 |
| `tests/pi153-acl-catalog-boundary.py` | 新增 PiNative 153 静态契约检查：7 张 native 表、3 张 append-only、有序 TABLES、`ai_pi_business_delegations` 的 native 归属；63 项正反例，不连数据库、不导入 Django。 |
| `tests/pi152-acl-catalog-boundary.py` | 沿用并保留有序 TABLES 与 `permissions=False` 负例；27 项检查。 |
| `tests/schema-acl-contract-gate.test.mjs` | 新增门禁单元测试：PiBusiness 单脚本、PiNative 双脚本、失败信息、非 Pi 短路；并在当前源码上实际跑通 152/153 两个静态脚本。 |
| `docs/schema-acl-gate-20261020/pi153-mandatory-code-checks-v2.json` | PiNative 新证据副本，`codeSha256=bf1f95c1...`；`sourceFiles` 与 node-syntax v2 均绑定当前文件字节。 |
| `docs/schema-acl-gate-20261020/pi152-mandatory-code-checks-v2.json` | PiBusiness 新证据副本，`codeSha256=20769992...`；同步 152 syntax v2。 |
| `docs/schema-acl-gate-20261020/pi152-syntax-code-materials-v2.json`、`pi153-release-code-syntax-v2.json` | 两代 node-syntax 证据副本，更新 `main-schema-release.mjs`、`publish-prepared-main.mjs`、`pi_business_catalog.py` 的当前 SHA。 |
| `config/main-schema-releases/ai-0086.json` / `ai-0087.json` | 分别指向 v2 证据，`codeSha256` 与 `validationSha256`（`4fc6ec85...` / `f6798101...`）同步。 |

## 验证

- `node --test tests/main-schema-pi-release.test.mjs tests/main-schema-release.test.mjs tests/schema-acl-contract-gate.test.mjs`：9 项通过。
- `node --test tests/publish-prepared-main.test.mjs tests/publish-latest-main.test.mjs tests/publish-main-command.test.mjs`：82 项通过。
- `node --test tests/main-prebuild-queue-v2.test.mjs tests/verify-release-candidate.test.mjs tests/main-schema-pi-workspace-release.test.mjs`：21 项通过。
- `python tests/pi152-acl-catalog-boundary.py`：27 项通过；`python tests/pi153-acl-catalog-boundary.py`：63 项通过。
- `pi_native_candidate.candidate(...)` 在当前源码上返回 `bound`，`codeSha256=bf1f95c1...`、`migrationSha256=a08ccd88...`。
- 两代 recipe 的 `codeSha256` 与 `code_digest` 一致，`validationSha256` 与 v2 证据文件 SHA 一致；`readSchemaRecipe` 能解析两个 v2 路径。
- `node --check tools/main-schema-release.mjs`、`python -m py_compile`、`git diff --check` 通过。
- 本机只有 PowerShell 5.1，未运行 PS7；本任务未改 PowerShell 生产脚本。

## 证据与边界

- 两代旧证据文件保持 origin/main 原字节；新摘要写入 `docs/schema-acl-gate-20261020/*-v2.json`，由 recipe 显式指向。没有改写历史报告或已封存证据。
- 两代 `codeSha256` 变化来自 `main-schema-release.mjs` / `publish-prepared-main.mjs` / `pi_business_catalog.py`（均在父链 `CODE_FILES` 内）；v2 的 `sourceFiles` 与 node-syntax 证据同步到当前字节，避免“摘要真实但逐文件证据自相矛盾”。
- 本次门禁测试未写入 `checks` 数组，避免改变证据 schema；运行期 Finalize 门禁仍保留。
- `main-prebuild-queue` 中的历史固定 bundle pin 未改；新的控制包准备/采用需要单独授权。源码门禁在候选 source 的 publisher 路径生效，不依赖已安装控制包。
- 未执行生产部署、迁移、服务启停、周报发送或控制包 `--adopt`；功能与业务验收仍由用户负责。
