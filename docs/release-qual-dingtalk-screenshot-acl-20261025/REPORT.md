# 钉钉定时截图目录 ACL 容忍：发布限定资格（Q14）

日期：2026-10-25。性质：只写发布工具的窄资格；**未合并、未发布、未触碰 `D:\teruisi-runtime`**。

## 背景

特性分支 `codex/dingtalk-screenshot-acl-tolerance-20261025`（提交 `33043e9d`，已独立审查通过）只改 `tools/django-ai.ps1` 的 `Assert-DingTalkScreenshotProfile`，并新增 `Test-AppContainerReadOnlyAce`。线上与候选的 `django-ai.ps1` 哈希不同，现有两道门禁会挡住这次上线：

1. 维护前准入 `maintenanceReadiness`（`tools/manual-maintenance-continuation.mjs`）：两边 `django-ai.ps1` 哈希不同时，只认两个写死的旧前驱，当前线上前驱不在其中，报“维护前驱资格与最初读取字节不一致”。
2. 合并前固定验证 `tools/verify-release-candidate.mjs`：只要改了 `django-ai.ps1` 就走“新增 Pi 退出观察”检查，而基线已含 `Wait-PiWorkerExit`，必然判不通过。

## 登记的字节（全部由本任务实测）

| 项 | SHA-256 |
| --- | --- |
| 线上 / `origin/main` `525ad36b` 的 `tools/django-ai.ps1` | `f97cf7e2bc532407cdf86501de57097ce6e4f626eaf68f73ee6ab308532e0e73` |
| 候选 `33043e9d` 的 `tools/django-ai.ps1` | `55b6701ac0f38e7aed6abea441085aa2b77f0a5f8d1a3f6c81651829ae6f9aba` |
| 旧 `Assert-DingTalkScreenshotProfile` | `e960f78453d3a08aea1d7e4299f5ccbf51c905189a5516132fa7660311abb61c` |
| 新 `Assert-DingTalkScreenshotProfile` | `a12db3ee9ef8834fedc871df5700a7e7fa820d815ee60ef70cf98364e4cec789` |
| 新增 `Test-AppContainerReadOnlyAce` | `801fd43a50668ae3b6f274353efd0adaec9db3ffb1936dc41ac79f81a6ab4f16` |
| `Wait-PiWorkerExit`（新旧相同） | `4372d8872c46760d40f7aa346b6476932be8edba7415baba0ae21e9b73293fd3` |
| `Stop-PiRuntime`（新旧相同） | `49725370782414b0c4bea2065161679ba50ed911cfd1439381b7b65d7259b3e6` |

函数哈希按“`\r\n` 归一为 `\n` 后的函数全文 UTF-8”计算，PS5.1 与 PS7 解析结果一致（已实测）。线上字节本任务未读取（主代理已只读核实）；准入时由代码在线重算，不符即拒绝。

## 改动

- `tools/manual-maintenance-continuation.mjs`
  - 新增 `dingtalkScreenshotAclQualification`（冻结对象）与 `isDingTalkScreenshotAclPair`，只登记上表中“线上 → 候选”这一对，单向。
  - `maintenanceReadiness`：命中该对时按同一 AI 控制器代际判断——其余三个控制器（`worker-local-service.ps1`、`process-deadline.ps1`、`django-local-service.ps1`）照旧逐个过 `assertMaintenanceControllerGeneration`；线上字节再读一次重算哈希；线上字节的 `Wait-PiWorkerExit` / `Stop-PiRuntime` 函数哈希继续核验（候选的原有检查保留）。路由仍为 `native-exit-observer`，pins 与原同代际分支完全相同，PS 侧 `Assert-MaintenanceReadiness` 无需改动。未登记组合（差一位、反向、其他）走原有 `assertPredecessorPins` 等检查，照旧拒绝。
- `tools/verify-release-candidate.mjs`
  - 新增窄配置 `dingtalkScreenshotAclOnly`：除文档与测试外，变更文件只能是 `tools/django-ai.ps1`（可附带 `verify-release-candidate.mjs`、`manual-maintenance-continuation.mjs` 两个资格载体）。命中时 `piExitObservation` 置 false，不再走“新增 Pi 退出观察”检查；不命中时行为不变。
  - 命中时：前驱 `django-ai.ps1` 与候选整文件哈希固定；用语法树（`functionsOfExact`：严格 UTF-8 解码、`ParseInput`、文本以 base64 传回，与控制台代码页和 PS 版本无关）证明参数块与全部顶层语句不变、既有函数顺序与文本逐字不变，仅 `Assert-DingTalkScreenshotProfile`（固定新旧哈希）和新增 `Test-AppContainerReadOnlyAce`（固定哈希）变化（`compareDingTalkScreenshotAclChange`）；再在 Windows PowerShell 5.1（`windowsPowerShellEnvironment` 去掉继承的 PS7 `PSModulePath`）和 PowerShell 7 下各跑 `tests/dingtalk-screenshot-acl.test.ps1`、`tests/dingtalk-startup-acl.test.ps1`。
  - 报告字段 `evidence.dingtalkScreenshotAclTolerance=true`；`nativeColdStart=false` 且说明原因，不称完整冷启动。该配置没有包完整性步骤，`packageIntegrity`、`nativeEntryBoundary` 为 false，属预期（与 Q06 同样只声明已证明范围）。
  - `run()` 增加可选环境参数；`functionsOf` 保持原样，没有改动其他配置的行为。
- 测试：`tests/manual-maintenance-continuation.test.mjs` 新增 8 条，`tests/verify-release-candidate.test.mjs` 新增 5 条（含真实字节与真实 PS 语法树）。
- 文档：`docs/规范/历史记录/发布限定资格-20261022.md` 新增 Q14；`docs/规范/验证与发布.md` 的“历史限定资格索引”补一行；`docs/运维/部署与启动/发布门禁执行细则.md` G02 引用补上 Q14。

## 测试

新增用例覆盖：

- 登记哈希与真实字节一致；冻结对象不可改。
- 准入通过：安装 `525ad36b` 字节、候选 `33043e9d` 字节、其余控制器同代际，结果 `native-exit-observer`，pins 含两侧哈希。
- 拒绝：候选字节多一行、线上字节多一行、反向（线上=候选、候选=旧）、任一侧上报哈希差一位、线上字节在登记后被改（上报哈希冒充登记值）、候选改动 `Wait-PiWorkerExit` 调用、未登记的 worker 控制器、`process-deadline.ps1` 漂移、未登记的 `django-local-service.ps1`。
- 放行（与原同代际分支一致）：worker 控制器候选命中 S05a 登记哈希、`django-local-service.ps1` 候选命中 PiNative 登记哈希。
- 验证器：配置只在“django-ai.ps1 + 两个载体”命中；多一个其他工具文件、没有 django-ai.ps1、重命名都不命中；真实新旧字节通过语法树比较；改动其他函数（含 `Stop-PiRuntime`、`Wait-PiWorkerExit`）、改动两个固定函数哪怕一个空格、改参数块/顶层语句、缺少/改名/重复 helper、多一个函数、乱序、删函数、新旧反向、基线被改、三个固定哈希任一差一位，都判不通过；仅行尾差异判通过。

运行结果（均在 `D:\codex-worktrees\release-qual-dingtalk-screenshot-acl-20261025`，串行）：

- `tests/manual-maintenance-continuation.test.mjs`：46 条全部通过（原 38 + 新 8）。
- `tests/verify-release-candidate.test.mjs`：13 条全部通过（原 8 + 新 5）。
- 与发布入口相关的 12 个测试文件合计 218 条，210 通过、8 失败。**这 8 条在 `origin/main` `525ad36b` 上同样失败，失败集合完全一致**（见“疑点”第 2 条），本次改动没有新增失败。
- 三条分支（A/B 的 `codex/native-descendant-verify-20261025`、本分支、`33043e9d`）在临时工作树合并后，上述两个测试文件加 `release-chain-preflight`、`publish-prepared-main` 共 129 条，128 通过，唯一失败仍是基线就有的 `release-chain-preflight.test.mjs:60`。

## 第 5 步：用候选分支真实 `django-ai.ps1` 实跑新配置（只读、本地）

构造：临时工作树，`610da67a`（本分支资格提交，代表“资格已合入后的 main”）合并 `33043e9d` 得到 `d8fcd719`（树 `0a38460c1df95f3d71af82d06606374bd2765015`），用 `d8fcd719` 自带的验证器：`node tools/verify-release-candidate.mjs --base 610da67a --out <工作树外目录>`。

- **结果 passed**，退出码 0；变更文件为 `docs/规范/安全与AI工具.md`、`tests/dingtalk-screenshot-acl.test.ps1`、`tests/dingtalk-startup.test.ts`、`tools/django-ai.ps1`；`dingtalkScreenshotAclOnly=true`；`evidence.dingtalkScreenshotAclTolerance=true`；候选工作树已清理。
- 前驱/候选整文件哈希、语法树比较通过；四项 ACL 测试全部 exit 0 且 stderr 为空：ps5 screenshot 1547ms、ps7 screenshot 977ms、ps5 startup 1326ms、ps7 startup 1187ms（输出尾行：`PASS: DingTalk screenshot ACL tolerance matrix`、`PASS: automatic audits 3 -> 1; …`）。
- 反例实跑：在同一候选上追加一行注释再跑，验证器在任何检查执行前报 failed（“候选 django-ai.ps1 不是已登记的字节”，实际 `6a39e1e6…`，期望 `55b6701a…`），0 项检查执行。
- 另跑 B：`--base 525ad36b`（载体文件也在差异里）时，四项 ACL 检查同样通过，但随后的通用 `publication` 步骤失败，原因是基线本身的 8 条失败（见疑点 2）。
- 证据：`docs/release-qual-dingtalk-screenshot-acl-20261025/evidence/verify-release-candidate-dingtalk.trimmed.json`（A、B 两次报告的精简版，保留哈希与退出码）、`evidence/acl-tests-ps5-ps7.log`（四项测试输出）。

附加的真实路径演练（非验证器，纯本地、读自建夹具）：用三条分支合并后的真实 `tools/` 作为候选源，线上侧用 `525ad36b` 的 `django-ai.ps1`、`django-local-service.ps1`、`worker-local-service.ps1`、`process-deadline.ps1` 字节搭夹具，`maintenanceReadiness` 返回 `native-exit-observer`，各控制器 pin 为：worker 线上 `83705551` → 源 `36c9a0ac`，django-local-service 线上 `65f05729` → 源 `4ba1fcaf`，django-ai 线上 `f97cf7e2` → 源 `55b6701a`。同一夹具用 `525ad36b` 原版 `manual-maintenance-continuation.mjs` 判断则被拒绝（“维护前驱资格与最初读取字节不一致”）。PS 侧 `Assert-MaintenanceReadiness` 需要生产目录布局，未在本任务实跑。

## 合并顺序与上线步骤

合并顺序（三条分支两两无冲突，已用 `git merge-tree` 逐对验证，并在临时工作树完成三者合并）：

1. `codex/native-descendant-verify-20261025`（A/B；已决定豁免固定检查，照 S04a/S05a 先例）。它也改 `tools/manual-maintenance-continuation.mjs` 和同名测试，改动位置与本分支不重叠。1 与 2 先后可互换。
2. `codex/release-qual-dingtalk-screenshot-acl-20261025`（本分支，须在 3 之前）。
3. `codex/dingtalk-screenshot-acl-tolerance-20261025`（`33043e9d`）。合并前先把最新 main（含 2）合入该分支，再用 `--base <最新main提交>` 跑固定验证入口；此时差异只含 `django-ai.ps1`（加文档/测试），走窄配置，不会触发 `publication` 步骤。

3 必须晚于 2：否则 main 含新 `django-ai.ps1` 而准入不认。准备包本身不调用维护准入（`publish-prepared-main.mjs` 的维护前驱核对在 `prepareOnly` 时跳过），所以不会在打包时报错；但发布前检查（`publish-main.mjs --check`）和发布入口进入维护前的核对都会拒绝，都发生在 STARTED 之前，线上不受影响，只是打好的包不能发，需补合 2 后重新检查或发布。

上线步骤（沿用现有流程）：

1. 三条合并后 main 更新，后台自动准备包（约 13–18 分钟，不碰线上、不进维护），或手动双击 `发布main.bat --prepare-only --no-pause`。
2. 点发布前可先做一次发布前检查（`publish-latest-main.mjs --check` → `publish-main.mjs --check`），它会真实调用本准入和 `manual-maintenance-preflight.ps1`；输出里 `maintenanceReadinessRoute` 应为 `native-exit-observer`。这是本资格在真实线上布局上的第一次实跑，本任务因不碰生产目录无法提前做。
3. 准备成功后用户再双击 `发布main.bat`（不带参数）：进维护 → 部署 → 切换 → 退出维护 → 启动。发布时 `maintenanceReadiness` 会按新鲜事实再核一次线上 `django-ai.ps1` 是否仍是 `f97cf7e2…`。
4. 是否需要“采用新控制包”：**不需要**。本分支只改 `manual-maintenance-continuation.mjs` 与 `verify-release-candidate.mjs`，都不在控制包文件清单（`install-main-prebuild.mjs` 的 `controlFiles` 共 15 个）里；`publish-latest-main.mjs` 通过 `runPublisher` 运行冻结源码里的 `tools/publish-main.mjs`，新准入随冻结 main 源码生效。A/B 分支改的是原生脚本，同样不是控制包文件。该结论来自读代码，未实机演练。
5. 预计停站：与 2026-10-24 `-r4` 发布同量级——进入维护约 228 秒、切前端约 213 秒、启动服务约 162 秒，停站约 10 分钟，从点击发布到完成约 21 分钟；准备包 13–18 分钟另计，且不停站。以上为上次实测值，本任务未重新测量。本次含 Django 与控制脚本变化，走完整组件流程。

## 疑点与限制

1. **固定验证入口在本机需要手动指定 pwsh。** 验证器用 `where.exe pwsh.exe` 取第一个结果，在本机是 Store 应用别名（`...\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe`），node 读取它报 `EACCES`，验证在任何检查执行前失败；`PATH` 里的 `TERUISI\ControlHost\PowerShell-7.6.5.500-...` 目录也不存在。我只在运行验证器的进程里把真实包目录 `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.8.0_x64__8wekyb3d8bbwe` 放到 `PATH` 最前面（该文件 node 可读），没有改验证器。以后在本机跑固定验证需要同样处理，或另做任务让验证器解析真实路径。
2. **基线已有 8 条失败，会让任何带载体文件的候选在通用 `publication` 步骤失败。** 在 `525ad36b` 上同样失败：`main-publication-readiness.test.mjs:42`（打包副本缺 `publish-main-step.mjs`）、`manual-maintenance-business-readiness.test.mjs` 三条（仍按旧候选哈希 `3b0ae6c0…` 断言）、`manual-maintenance-pi-readiness.test.mjs:95`、`pi-exit-change-boundary.test.mjs:9`、`release-batch-powershell-environment.test.mjs:67`、`release-chain-preflight.test.mjs:60`。因此本分支自身（差异含 `verify-release-candidate.mjs` / `manual-maintenance-continuation.mjs`）无法通过固定验证入口，需要像 A/B 一样豁免；本任务没有去修这些既有失败。`33043e9d` 在本资格合入后单独验证时不触发该步骤。
3. **哈希是死绑定。** `33043e9d` 若再有任何字节变化（例如审查后续建议），须重新计算两个整文件哈希和三个函数哈希，并更新 `dingtalkScreenshotAclQualification`。
4. 语法树比较看不到函数之外的注释，所以同时固定了候选整文件哈希，两者缺一不可。
5. 本任务没有读取线上文件；线上字节是否为 `f97cf7e2…` 以主代理的只读核实和发布时的在线重算为准，不符则 fail closed。
6. 遗留的本地临时物：分支 `tmp/verify-dingtalk-qual-20261025`（本地，指向反例提交，其父提交 `d8fcd719` 即第 5 步候选），可在确认不再需要后删除；本分支 worktree 里有一个指向既有依赖目录的 `node_modules` 目录联接（已被 `.gitignore` 忽略）。临时工作树已移除。
