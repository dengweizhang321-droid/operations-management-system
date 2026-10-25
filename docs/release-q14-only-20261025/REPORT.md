# Q14 单项发布（钉钉截图 profile ACL 容忍）

2026-10-25。本次把 Q14 从"与 A/B 两项打包"改为**单独发布**，并修掉一处挡住固定验证入口的测试夹具漏项。

## 为什么拆开

原先 `codex/release-combined-dingtalk-20261025` 把 Q14 叠在另一会话的 A 项（停服务按创建时间排除 PID 复用假后裔）与 B 项（Worker `-Json` 透出失败原因）之上。独立审查（Opus）在合并分支上判 NEEDS_CHANGES，三处阻断均由"打包"本身引起：

1. `tools/worker-local-service.ps1`（B 项）不在 `verify-release-candidate.mjs` 的 `supported` 清单内 → `unsupported` 非空。
2. 合并后变更文件超出 Q14 自己的 `dingtalkScreenshotAclOnly` 白名单 → 该标志转 false → `piExitObservation` 误判为 true。
3. A 项改了 `Get-VerifiedProcessDescendants`，`compareFunctionOnlyChange` 不放行 → `requiresNativeColdStart`。

在纯 Q14 范围上三者全部消失（实测 `unsupported=[]`、`aclOnly=true`、`piExitObservation=false`、`django=false`）。A、B 两项各自需要独立的窄资格，另行安排。

## 本分支内容

基线 `b092eb2b`（含 PR #62）。四个 cherry-pick 自原分支的 Q14 提交，加一个夹具修复：

| 提交 | 内容 |
| --- | --- |
| `2ce43799` | 容忍截图 profile 上的 AppContainer 只读 ACE |
| `5711e3f8` | 审查后续修正 |
| `520401ad` | 登记 `django-ai.ps1` 的 Q14 资格对 |
| `5c1051b5` | Q14 证据 |
| `9c3c3500` | **本次新增**：补齐发布准入夹具的模块闭包 |

不含 `tools/django-local-service.ps1` 与 `tools/worker-local-service.ps1`（已逐项核实未改）。

## 夹具修复（`9c3c3500`）

`tests/main-publication-readiness.test.mjs` 构造候选包时只复制 `publish-main.mjs` 相对 import 的第一层，缺 5 个传递依赖：`publish-prepared-main.mjs` 需要 `publish-main-owner` / `-pi-reconciliation` / `-step` / `-tail`，`publish-main-known-resume.mjs` 需要 `main-prebuild-task`。

后果不只是该用例失败：运行加载到 `tools/publish-main-step.mjs` 即以 `ERR_MODULE_NOT_FOUND` 终止，走不到准入检查，于是同一用例的

```js
assert.doesNotMatch(..., /ERR_MODULE_NOT_FOUND/,
  'native modules are intentionally absent; admission must precede their import')
```

这条断言从未真正生效 —— 它要证明的正是"准入先于 import"，却被自己的夹具漏项掩盖。

本次只补文件清单，未改任何断言、未改被测代码，原生引擎仍按设计缺席。该失败在干净基线 `b092eb2b` 上同样存在（3 通过 1 失败，同名同错），不是功能分支引入；它同时是固定验证入口 `publication` 步骤失败的原因，Q14 原证据里那份 `failed` 报告也是这一步。

修后该文件 4/4，失败那条耗时 650ms→1300ms，说明确实执行到了准入检查。

## 固定验证入口

`node tools/verify-release-candidate.mjs --base b092eb2b --dependencies <只读依赖目录>`

**结果：passed**（证据见 `evidence/verify-release-candidate-passed.json`）。

- base `b092eb2b`，commit `9c3c3500`，tree `898484ec`
- 九项检查全部 passed：`ps5/ps7-dingtalk-screenshot-acl`、`ps5/ps7-dingtalk-startup-acl`、`publication`、`preparation-queue-control`、`optimization-boundaries`、`powershell-entry`、`actual-django-package`
- `packageIntegrity=true`、`nativeEntryBoundary=true`、`dingtalkScreenshotAclTolerance=true`

### 两处跑法要点（本机特有，记录备查）

1. **pwsh 路径**：PATH 中 `AppData\Local\Microsoft\WindowsApps` 在前，`where pwsh.exe` 返回的是 MSIX 执行别名 —— 该文件 0 字节、不可被读取，而验证器 `:316` 要 `readFile` 它算哈希，于是报 `EACCES`。需把 MSIX 包内真实目录 `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.8.0_x64__8wekyb3d8bbwe` 临时置于 PATH 之前；所得 pwsh 的 sha256 为 `b90c0f48ca4b…`，与 10-24 Q14 那份 passed 报告记录的同一字节。PATH 中另有 `AppData\Local\TERUISI\ControlHost\PowerShell-7.6.5.500-…`，该目录已不存在，是失效残留项。
2. **依赖目录**：本次 `publication=true`（改了发布工具），验证器 `:319` 要求显式 `--dependencies`。10-24 那次 base 为 `610da67a`（只差一个文件）、`publication=false`，故未传此参数。

## 测试

| 文件 | 结果 |
| --- | --- |
| `main-publication-readiness` | 4/4（修复前 3 通过 1 失败） |
| `publish-prepared-main` | 58/0 |
| `publish-latest-main` | 26/0 |
| `manual-maintenance-continuation` | 46/0 |
| `verify-release-candidate` | 13/0 |
| `manual-maintenance-pi-readiness` | 25/0 |
| `main-prebuild-status` | 14/0 |
| `release-chain-preflight` | 10/0 |
| `publish-main-command` | 2/0 |
| `dingtalk-screenshot-acl`（PS5/PS7） | 全部 PASS |
| `dingtalk-startup`（ts） | 7/0 |
| `release-scope-plan` | 10/0 |

`release-batch-powershell-environment` 5 通过 2 失败，已与基线 `b092eb2b` 逐名对照确属既有（断言要求"实际安装的 PS7 模块目录"，与上述 MSIX 情形同源的环境依赖）。

## 发布范围

`scope=full`、`components=['worker','django']`、`migrate=false`、`unknown=[]`。改的是 `tools/` 下的 `.ps1` 与 `.mjs`，按 `classifyRelease` 规则置 `full`；`changes` 中无 `backend/` 路径、无 `migrations/*.py`，**不执行数据库迁移**。

## 后续

A、B 两项不在本次范围。两者的"维护前准入"资格（`piNativeCandidateControllerSha256`）已就绪，缺的是"合并前验证"这道门：

- **A 项**：`Get-VerifiedProcessDescendants` 需补专用隔离冷启动，或比照 Q14 做窄资格（固定该函数新旧哈希 + 证明其余逐字不变）。
- **B 项**：`tools/worker-local-service.ps1` 从不在验证器 `supported` 清单内（基线亦然），需补 `supported` 与 AST 级比较器。审查指出这是结构性缺口 —— 该文件是启动唯一引擎，长期缺合并前覆盖。

另记一项与本次无关的陈旧常量：`manual-maintenance-continuation.mjs:39` 的 `nativePiBusinessPredecessor.candidateDjangoScriptSha256` = `d884882a…`，已不对应任何现存 `django-local-service.ps1` 字节。本轮不可达（控制流三路互斥，`dingtalkAcl` 为真时跳过该分支），但下次 `django-ai.ps1` 脱离 Q14 对时会以误导消息失败，建议另开任务清理。
