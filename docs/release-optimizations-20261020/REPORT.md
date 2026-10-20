# 发布流程可避免返工优化（候选）

- 日期：2026-10-20（Asia/Shanghai）
- 分支：`codex/release-optimizations-20261020`
- 基线：`f5c688452710c939dd50e354a60df20f65c7acf8`
- 状态：源码候选；未合并、未准备生产制品、未上线。

## 范围

本轮只实施不改变 Start/Stop 生命周期语义、且不触碰已封存 Pi152 材料的三项：

1. **P0-2 前驱资格前置**：复用已准备包时，先核维护前驱/控制器资格，再进入 Worker 与 `VerifyPreparedApp` 的昂贵复验。
2. **P0-5 sourceRoot 规范化**：Worker source binding 写入前统一 Windows 分隔符、点段和尾分隔符；保留大小写，兼容既有准备包。
3. **P0-1 ACL 契约测试**：把 `tests/pi152-acl-catalog-boundary.py` 从“钉住历史两行改动”改为“从 migration 的 `TABLES`/`APPEND_ONLY` 推导期望 ACL”，并增加 `npm run check:pi152-acl` 入口。

P0-3（周报发布租约）和 P0-4（排队 Start fence）本轮未实施，原因见末节。

## 改动

| 文件 | 内容 |
| --- | --- |
| `tools/publish-prepared-main.mjs` | 新增 `normalizePreparedSourceRoot`；在复用分支的 Worker 复验前执行一次维护前驱资格检查（仅发布模式，`prepare-only` 不额外收紧）；保留 STARTED 前的完整即时复核。 |
| `tests/publish-prepared-main.test.mjs` | 新增非规范 source 拼写规范化用例；新增“资格检查早于 Worker 复验/`VerifyPreparedApp`”的顺序用例。 |
| `tests/pi152-acl-catalog-boundary.py` | 静态读取 migration 与 catalog，验证 actions 可 UPDATE、intents/audits 仅 SELECT/INSERT；覆盖正反例 24 项，不连数据库、不导入 Django。 |
| `package.json` | 新增 `check:pi152-acl` 脚本。 |
| `docs/release-optimizations-20261020/` | 本报告与验证证据。 |

## 验证

- `node --test` 8 个发布工具测试文件：133 项通过、0 失败，日志见 [evidence/node-tests.log](evidence/node-tests.log)。
- `python tests/pi152-acl-catalog-boundary.py`：`PI152_ACL_CONTRACT_PASSED tables=3 append_only=2 checks=24 no_database=True`。
- `node --check tools/publish-prepared-main.mjs` 通过；`python -m py_compile tests/pi152-acl-catalog-boundary.py` 通过；`git diff --check` 通过。
- 本机只有 PowerShell 5.1，未运行 PS7；本轮未改 PowerShell 生产脚本。
- 未执行生产部署、迁移、服务启停、控制包采用或真实发布。
- `node tools/release-scope-plan.mjs --base f5c68845 --head 0221d7bd` 输出 `scope=full`、`migrate=false`、组件 worker+django，原因是 `package.json` 与发布工具路径；证据见 [evidence/release-scope-plan.json](evidence/release-scope-plan.json)。本轮未准备任何制品。

## 预计效果

- P0-2：每次复用包的坏前驱在数秒内失败，不再先浪费约 6.5 分钟 Worker 复验；本次样本可省约 8–9 分钟。
- P0-5：非规范入口路径不再触发 WorkerBuild 前的 adapter 拒绝；本次样本可省约 3–5 分钟。
- P0-1：在进入结构准备前发现 ACL 期望与 migration 声明不一致；按本次样本可避免约 25–30 分钟的 Finalize 返工。该测试目前是候选检查，合并后需由发布负责人纳入结构发布前的必要检查；尚未写入已安装控制包。

## 边界与后续

- **P0-3 未实施**：周报发布租约需要同时改 `django-workflow-service.ps1` 的派发入口和 `docs/release-contention-20261020/Check-WeeklyAdmissionProjection.ps1` 的逆投影；后者是上一轮发布的封存证据，不能为本次候选热改。应作为独立发布工具任务，使用新的投影适配器和 PS5/PS7 夹具。
- **P0-4 未实施**：排队 Start 的 fence 语义属于生命周期变更。按[验证与发布](../../docs/规范/验证与发布.md)要求，需先在专用隔离环境完成原生冷启动及失败分支验证；本轮没有该环境，强行合并会违反发布契约。
- **P0-1 的门禁位置**：`pi_business_candidate.py`、`pi_business_catalog.py` 在 Pi152 `CODE_FILES` 摘要内，直接修改会使已封存的 152 证据失效。因此本轮只交付独立静态测试和 npm 入口；下次控制包准备时再把它接入结构发布检查，并重新生成对应证据。
- 本分支不是上线授权；合并、制品准备和生产发布仍按[发布交付契约](../../docs/规范/验证与发布.md#统一发布交付契约)另行执行。
