# S05b 早上执行手册：采用含 S05d 的控制包并解除 a3d53227 阻塞

2026-10-24 夜间编写，尚未执行，没有任何采用回执。独审 v1 后已更新控制源码提交、推送脚本闸门与已知影响（见文末“独审 v1 后的补充”）；10-24 早上第一次推送脚本中止后，控制源码提交与第 1 步再次更新（见文末“10-24 早上中止后的更新”）。今晚授权含 S05b、S05；AI 沙箱不能在真实仓库提交、不能推送、不能以普通用户运行生产入口，所以以下步骤由用户早上按顺序执行。本手册取代 [10-23 版](../s05d-residual-classification-20261023/S05B-RUNBOOK.md) 的 handoff 路线：那是 AI 宿主无法充当普通用户时的包装，用户本人双击时直接使用原 installer。

## 固定输入

| 项 | 值 |
| --- | --- |
| 发布配置 | `D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json`（sha256 `a90c9b80…`，无 `preparationRetirementCompatibility`） |
| 当前控制 | `CONTROL-INSTALLATION.json`：v3、adopted、installId `ade68625-9378-4358-b31f-e2139c5953e2`、bundle `83e4158f785cf5506997f485879520e8a0e4db8b427e1438aefe364282976ee8`（10-22 08:54） |
| Node | `C:\Program Files\nodejs\node.exe`（与已装准备任务定义一致，必须用这一份） |
| Git | `D:\git\Git\cmd\git.exe`，须是 `where.exe git.exe` 的第一项（配置 gitDirectory 不得变化） |
| 控制源码提交 | 分支 `codex/release-rework-20261024-control` 的 `01b0fc5ff7aaf0e44d7c9192f498ed6637970709`（`24dd52ac` 加审查修复与生产者资格修复，只含 S05d），工作树 `D:\codex-worktrees\release-rework-20261024-control`（detached）。原 `d1b60496` 已于 10-24 早上被生产者资格修复取代 |
| 材料目录 | `D:\codex-artifacts\release-rework-20261024\control-upgrade-<时间戳>`（每次新建，不复用） |
| 阻塞 dispatch | `a3d53227-8976-4762-8be6-6f8c28107b5b`，1 张票 unknown，目标 `36668589cab0…`，期限 2026-10-22 16:11:22 +08:00，包 `D:\codex-isolated\main-release-packages\36668589cab0-71ecf390-bbc9a5ef`（`publish-36668589cab0` 下只有 `preparation\PREPARING.json`、`source-binding.json`） |

控制源码为什么用单独的控制分支而不是全部改动分支：两者的 33 个控制文件只差 `tools/release-scope-plan.mjs`（S08 分类器）。用全部改动分支会把 S08 分类器一并带进生产控制，等于提前做 S09 采用，而 S09 不在今晚授权内。S16 改的是原生工具，不在控制包内。初稿用 `24dd52ac`；独审 v1 要求把放弃判定移到准入之后，修复提交在全部改动分支上是 `b7db5541`，在控制分支上是 cherry-pick 出的 `d1b60496`（父提交 `24dd52ac`，两处 `tools/main-prebuild-queue.mjs` 字节相同）。10-24 早上又加生产者资格修复：控制分支上是 `01b0fc5f`（父提交 `d1b60496`），全部改动分支上是 cherry-pick 出的 `54b3aa0d`，修复文件两边字节相同，所以下文一律用 `01b0fc5f`。若用户决定同时采用 S08（即 S09），换用全部改动分支上的 `54b3aa0d`（原写 `b7db5541`，控制文件与分支头相同），其余步骤不变；此时 `s05b-prepare.ps1` 不能直接使用：它第 4 步要求 `origin/<$ControlBranch>` 恰等于 `$ControlCommit`，只改固定提交不够，而全部改动分支的远端头是 `54b3aa0d` 之后的文档提交。S09 须另写准备步骤（同时改 `$ControlBranch` 与 `$ControlCommit`，并重新审查）。

## 前置核对（只读）

1. 以普通用户、非管理员身份操作（准备任务要求中等完整性、非提升）。
2. `where.exe git.exe` 第一行是 `D:\git\Git\cmd\git.exe`；`git config --show-origin --get-all core.hooksPath` 无输出（全局或系统若设了 hooksPath，installer 会拒绝）。
3. 关闭所有 查看打包状态/准备/发布 窗口，确认没有正在运行的准备（采用时要求连续 3 次进程普查为空，30 秒内不收敛即阻塞）。
4. `CONTROL-INSTALLATION.json` 仍是上表的 installId 和 bundle；若已变化，说明有人另行采用过，停止并重新评估。

脚本 `2-S05b-准备控制包.bat` 会自动检查 1、2、4 和工作树状态。

## 步骤

| 序 | 动作 | 性质 | 可逆性 |
| --- | --- | --- | --- |
| 1 | 双击 `D:\运营管理系统\.codex-tmp\rework-20261024\1-检查并推送.bat` | 开发：把分支取入真实仓库、建工作树、测试、推送 | 可逆（远端分支可由用户删除）；不碰 main 与生产 |
| 2 | 建控制源码工作树（脚本 2 自动完成） | 开发 | 可逆（`git worktree remove`） |
| 3 | 双击 `2-S05b-准备控制包.bat`，只做 prepare | 读生产，只写材料目录 | 可逆（未采用前可删材料目录） |
| 4 | 手工输入 adopt 命令 | **生产控制采用** | 不能一键回退 |
| 5 | 下一次消费者运行写放弃记录并准备新包 | 生产队列写入（工具自动） | 放弃记录永久保留 |
| 6 | S05：准备main.bat，再 发布main.bat | **生产准备与应用发布** | 按原生发布流程 |

### 1. 检查并推送

脚本按顺序：确认草稿仓库两个分支头分别等于脚本里固定的审查过的提交（`codex/release-rework-20261024` 与 `codex/release-rework-20261024-control`），不等即中止；确认控制分支含 `24dd52ac`、不含 S08 提交 `c35de78e`；两个分支相对 a6cc9fcd 的变更文件必须与各自白名单完全相等，两分支在 tools/ 下只差 `release-scope-plan.mjs`、`worker-local-release-rotation.mjs`；`git fetch <草稿仓库>` 把两个分支取入真实仓库（仅本地分支）；本地分支已存在时，等于新分支头则跳过，等于上次取入的 `087a8348`（全部改动分支）或 `d1b60496`（控制分支）则只按快进升级（检出该分支的工作树须停在旧提交且无已跟踪改动），其他值不覆盖并中止；建 `D:\codex-worktrees\release-rework-20261024` 与控制测试工作树 `D:\codex-worktrees\release-rework-20261024-control-test`（detached；已存在且停在旧提交时切到新提交）；测试前给各测试工作树建 node_modules 目录联接，指向锁文件一致的依赖副本 `D:\运营管理系统\.codex-tmp\rework-20261024\deps-8ec00f`，结束或中止时删除脚本新建或复用的指向该副本的联接（不递归）；在两个工作树中于沙箱外分别运行受影响测试（全部改动分支 39 个文件，控制分支 32 个 S05d 相关文件；今晚沙箱内无法运行的起子进程测试都在内，每个文件限时 900 秒）。判定按每个文件的 JUnit 结果逐个失败测试进行：超时、缺依赖包或缺 `node_modules` 内的模块文件（环境失败）、无法解析的失败都中止；缺 `node_modules` 外的绝对或相对路径模块文件按普通失败处理；只有 start-timing 1 个已知预期失败，须失败测试名、失败个数和断言文字全部符合（见 [REPORT](REPORT.md#遗留与未完成)），collector 必须通过（10-24 早上前曾被错列为已知预期）；其余失败在 `D:\codex-worktrees\release-rework-20261024-base`（需要时才建，detached 于 a6cc9fcd）复跑，只有本次每个失败测试在基线上都以同名失败才记为既有问题，否则中止且不推送；全部可接受才 `git push --atomic -u origin codex/release-rework-20261024 codex/release-rework-20261024-control`。有既有问题时脚本会提示：状态词改为“通过”前须逐个看日志确认与本分支无关。测试摘要写在 `D:\运营管理系统\.codex-tmp\rework-20261024\morning-tests-<时间>\SUMMARY.txt`。不用 --force、--no-verify，不动 main，不 fetch origin（避免在采用前生成新 hook 票）。先取入再测试，是为了在用户本人的工作树（有 origin/main、归属正常）里运行，测试失败时分支只在本地、不会推送。

### 2、3. 准备控制包（不采用）

脚本 2 先确认 `origin/codex/release-rework-20261024-control` 恰为 `01b0fc5f…`，在真实仓库执行 `git worktree add --detach D:\codex-worktrees\release-rework-20261024-control 01b0fc5f…`（已存在则核对 HEAD 与干净状态），然后运行：

```powershell
& 'C:\Program Files\nodejs\node.exe' 'D:\codex-worktrees\release-rework-20261024-control\tools\install-main-prebuild.mjs' --config 'D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json' --out 'D:\codex-artifacts\release-rework-20261024\control-upgrade-<时间戳>'
```

成功输出一行 JSON：`"status":"bundle-prepared"`、`"adoptionPerformed":false`，材料目录内有 `INTENT.json`、`PREPARED.json`、`CONFIG.json`、`HOOK`、`BRIDGE-HOOK`、`SHIM.mjs`、`bundle\`。prepare 的门禁（`prepareControlUpgrade`）：控制源码 `git status --porcelain` 为空；hooksPath 未被改写；旧 hook 为 TERUISI v1/v2；全部发布包的原生操作证据普查（`nativeOperationBindings`）通过；准备任务定义与已装前任逐字段相同；首次退休协议采用时其余配置不得变化。任一失败都在写生产前退出；材料目录若已部分创建，删除后用新时间戳重跑。

### 4. 采用（生产动作，须手工输入）

脚本 2 结束时打印精确命令，形如：

```powershell
& 'C:\Program Files\nodejs\node.exe' 'D:\codex-worktrees\release-rework-20261024-control\tools\install-main-prebuild.mjs' --adopt 'D:\codex-artifacts\release-rework-20261024\control-upgrade-<时间戳>'
```

成功输出 `"status":"adopted"`、`"productionDeploymentPerformed":false`。会写入：`control-bundles\<新 bundle>`、`control-upgrades\<installId>`、`control\tools\publish-latest-main.mjs`（固定入口 shim）、真实仓库 `.git\hooks\reference-transaction` 及 `core.hooksPath`（installer 设计内的本地 Git 配置写入）、`main-publisher-config.json`（新增 `preparationRetirementCompatibility`）、`准备main.bat`/`发布main.bat`/`查看打包状态.bat`、准备计划任务（定义不变则不重装）、`CONTROL-INSTALLATION.json`。

可能出问题：

- 三把锁（v1 队列、v2 队列、原生轮换）被占用：直接报错，未写入，稍后重试。
- 30 秒内相关进程未清空：写 `BLOCKED-<uuid>.json`，安装停在 `installing`，此时 hook 只记 deferred、准备/发布入口会拒绝；关闭相关窗口后用同一材料加 `--resume` 续完：`... --adopt '<同一目录>' --resume`。不要换新材料重来。
- 前任漂移（配置、hook、入口在 prepare 之后被改）：拒绝，重新 prepare。

回退：旧 bundle `83e4158f…` 目录保留，但没有一键回退；回退须从旧控制来源另行 prepare/adopt，未演练。回退是单向受限的：新控制代际写出第一条带 dispatch 的 `failed` 终态后，旧代际的 `ticketResult` 对这种键集断言失败，整份队列清单不可读，准备完全停住；旧代际也不读 `abandoned/`，a3d53227 会重新阻塞。所以一旦新代际写出过这两类记录，回退到 `83e4158f…` 不能恢复准备，只能继续向前修复。

### 5. 消费者对 a3d53227 的处理（工具自动）

采用后队列不会自己动：现有 85 张票都有终态，消费者只有在出现新票时才进入判定。第 6 步的 准备main.bat 提交一张 manual 票并唤醒消费者，此时新消费者在队列锁内：

1. a3d53227 无 resolution，唯一的票为 unknown；
2. 当前时间不早于期限加 15 分钟宽限（2026-10-22 16:26:22 +08:00），早已满足；
3. `publish-36668589cab0` 下除 `preparation` 外无任何文件（STARTED、SUCCESS、FAILED、WorkerApply-started、maintenance-first-FAILED、resume-* 等都不存在）；
4. 原生轮换锁 `\\.\pipe\TERUISI.Worker.ReleaseRotation.v1` 可占用（没有其他准备在跑）。

全部满足才写 `prebuild-queue-v2\abandoned\a3d53227-8976-4762-8be6-6f8c28107b5b.json`（`consumePermitted:false`，绑定 dispatch 与原 unknown 终态的 sha256），原 `results\` 文件字节不变，不写 FAILED/SUCCESS/resolution。任一条件不满足则照旧阻塞、不写入。随后观察最新 main（会 `git fetch origin main`）：目标仍为 36668589 且实时绑定仍是 `71ecf390`/`bbc9a5ef` 时，原包已退休，新准备进入 `36668589cab0-71ecf390-bbc9a5ef-r2`，工作树分支 `codex/manual-main-36668589cab0-71ecf390-bbc9a5ef-r2`；旧包永不再准备或消费。main 若已前移，则准备新目标。

注意：本批原生发布器来自 36668589 冻结源码，不含 S05d 原生结构化失败记录。准备若非零退出，仍记 unknown；下次有票时，过期限加 15 分钟后按同一规则放弃，不需人工证明。

### 6. S05：准备与发布

1. 双击 `D:\codex-isolated\main-manual-release-20261016\准备main.bat`（采用后由 installer 重写）。最多等 30 分钟；超时显示“已退出等待”，准备仍在后台继续，用 查看打包状态.bat 观察，不要重复双击。正常约 28 分钟，结果 `prepared` 才算制品就绪。注意 查看打包状态 只看 `LATEST-PREPARED.json` 指针与包内文件，不识别退休包：被放弃的旧包在新指针写入前显示“打包尚未完成”；若某次复用核对失败把一个已有 PREPARED 的包退休，它仍可能显示“打包完成”并弹窗，而 发布main.bat 会选下一个槽位并报未就绪。两者不一致时以 发布main.bat 为准。
2. 制品就绪后双击 `发布main.bat`。它在队列锁内复算同一包名（含 `-r2`），拒绝已退休包，需要 PREPARED.json，随后复验、维护、部署、切换、启动，约 20 分钟。以原生 SUCCESS 回执为上线依据，功能由用户检测。

## S05b 代码阻断核对（只读代码，2026-10-24）

结论：按代码阅读，prepare、adopt 和采用后的正常消费/发布路径上没有会拒绝新字节的断言。逐项：

| 检查点 | 结果 |
| --- | --- |
| `prepareControlUpgrade` / `readMaterials` / `adoptControlUpgradeInternal` | 只校验 33 个 controlFiles 的 sha 自洽、manifest 协议版本、配置/hook/入口前任 CAS，不固定任何控制文件字节；`main-control-dispatch.mjs` 只要求成员数 6 至 48 且与 manifest 一致 |
| `withRetirementReadScope` / `assertRetirementAdmission` | 生产无 `preparation-retirements` 目录，`readRetirementIntents` 返回空，只做作用域绑定，无字节固定 |
| `preparation-retirement-entry.mjs` 对 publish-latest-main/publish-main 的固定值 | 只被 `preparation-retirement-collector.mjs` 的 `qualifyRetirementSourceEntries` 使用，属于个案退休流程，正常路径不调用 |
| `preparation-producer-qualification.mjs`（`preparation-retirement-qualification.mjs` 复用） | 在 resolution 证明中校验的是各 packet 自带冻结源码 `source/tools`，不是控制包。初稿写“本次未改该文件”；10-24 早上已追加 S05d 与 S05d+S16 两个闭包，第一个闭包（f641685b）不变，生产队列只读核对 9 份历史 resolution 仍可读 |
| `pi150-failed-start-recovery.ps1` 对 release-scope-plan/publish-latest-main 的哈希 | 仅限 10-17 两个 MaintenanceId 的历史恢复，正常路径不调用；用 `01b0fc5f` 时 release-scope-plan 字节本就不变 |
| 已有 9 份 resolution | 按各自归档的采用记录与 manifest 校验，不随新控制包变化 |

未能核实：`nativeOperationBindings` 对生产全部发布包的普查无法在沙箱内预跑（realpath EPERM），只能在第 3 步由 installer 实测；installer 的“首次退休协议采用”分支此前未在生产走通过（10-23 三次 handoff 都在 native 调用前被拒，与 installer 无关）；用户全局 Git 配置是否设了 hooksPath 无法在沙箱内读取。

## 独审 v1 后的补充（2026-10-24）

- 控制源码（独审 v1 时）：`d1b60496`（分支 `codex/release-rework-20261024-control`），即 `24dd52ac` 加修复“放弃判定在普通用户与消费者身份准入之后”。准入失败（例如提升权限的窗口）时不探测轮换锁、不写放弃记录，照旧阻塞。10-24 早上已由 `01b0fc5f` 取代，见下节。
- 推送脚本固定了两个分支头，推送的必定是审查过的提交；审查后若再改提交，须同步更新 `push-rework.ps1` 的 `$ExpectedHead`/`$ExpectedControlHead` 与白名单、`s05b-prepare.ps1` 的 `$ControlCommit`、本手册。
- 第 4 步回退的单向性、第 6 步 查看打包状态 与 发布main.bat 不一致时的判断、发布入口对队列清单的依赖，见上文对应段落。
- 退休包整包保留（含源码工作树与 `codex/manual-main-*-rN` 分支），同一目标最多 64 份，暂无清理流程，已记为 S05d 待办；本次 a3d53227 的旧包 `36668589cab0-71ecf390-bbc9a5ef` 转为退休包，新准备进入 `-r2`。

## 10-24 早上中止后的更新

- 第一次运行第 1 步时，preparation-resolution、preparation-superseded-resolution、preparation-retirement-integration 新失败，另有缺依赖等环境失败，collector 被错当已知预期，脚本中止，未推送。根因：生产者资格文件固定的字节被 S05d/S16 改动，管理员 resolution 也用它。已追加资格闭包并冻结原审查字节，详见[夜间报告](REPORT.md#2026-10-24-早上推送脚本中止与修复)。
- 新分支头：控制分支 `01b0fc5ff7aaf0e44d7c9192f498ed6637970709`，即本手册的控制源码；全部改动分支为 `54b3aa0d` 之后的文档提交。`push-rework.ps1` 与 `s05b-prepare.ps1` 已按新提交更新。
- 用户操作不变：重新双击 `1-检查并推送.bat`，脚本自动把上次取入的分支与工作树快进升级，通过后再双击 `2-S05b-准备控制包.bat`。

## 记录要求

采用后在 [REPORT](REPORT.md) 和 [S05b](../施工/S05b.md) 追加：材料目录、installId、新 bundle sha256、INTENT/PREPARED/TRANSITION sha256、放弃记录 sha256、新包目录及其 PREPARED 结果。原 unknown、旧包、handoff runs（c6be141b 等）全部保留，不改名不删除。
