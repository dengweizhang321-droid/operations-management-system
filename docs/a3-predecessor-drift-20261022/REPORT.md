# S01 · A3 新增收敛决策 + 收敛入口 — 施工报告

- 单号：S01（A3 新增收敛决策 + 收敛入口）
- 分支：`codex/a3-predecessor-drift-resolution-20261022`，自 `origin/main` `61f891a8` 新建
- worktree：`D:\codex-worktrees\a3-converge-20261022`
- 代码/测试/证据提交：`8be7a3bf`（本报告为同一分支第二个提交）
- 本单不 adopt、不推送、不合并；未触碰生产、未写入任何队列/发布文件

## 0. 结论摘要

1. 新增 decision `superseded-by-later-publication`，与既有 `failed-cleaned-before-plan` 并列；**既有 decision 的任何一条 assert 都没有放宽**（`validateResolution` 逐字未改，键集与断言全部保持原样）。
2. 新 decision 的成立条件是 4 条不变式，全部由**归档字节**重新推导，两次独立扫描（初始/最终静态证据）都必须复算通过；只做"目标相等"不放行。
3. 复用既有三段式：`REQUEST-<phase>.json` → 提权只读观察者产出 `OBSERVATION-<phase>.json` → ACK；epoch/nonce/deadline/CAS/队列锁/轮换锁全部沿用，无旁路、无手写 resolution。
4. 入口是可执行 CLI：既有 `cleaned-preparation-writer.mjs` 增加 `--decision`，并在每阶段打印**提权观察者的完整命令行**。第 5 节给出可直接复制的收敛命令（S03 使用）。
5. 历史一致性：`preparation-resolution-history.mjs` 8 条记录补 `decision` 字段；`readHistoricalResolution` 新增 decision 校验与 superseded 专用 pin 校验，并支持注入 catalog（供测试）。
6. 队列侧**零改动**：`main-prebuild-queue.mjs` 已经通过 `readPreparationResolution()` 判定"该 dispatch 是否已收敛"，新 decision 走同一读者即可解锁；未改动任何其他判定语义。
7. 对真实 e786 证据做过**只读**推导，4 条不变式全部通过（证据见 `evidence/real-e786-readonly-derivation.json`）。

## 1. 改动文件清单与理由

| 文件 | 改动 | 理由 |
|---|---|---|
| `tools/preparation-resolution.mjs` | 新增 `resolutionDecisions`/`supersededTerminationBasis` 与键集常量；新增 `supersededFacts`（唯一推导函数）、`validateSupersededStaticProof`、`collectSupersededPreparationState`、`validateSupersededResolution`；`readPreparationResolution` 按 `decision` 分派并拒绝未知 decision；`readHistoricalResolution` 增加 `catalog` 注入与 decision 校验；`writePreparationResolution` 增加 `decision` 参数、替换前预检、二次收敛拒绝 | 新 decision 的推导、校验与写入入口。既有函数（`validateResolution`/`collectPreparationState`/`validateStaticProof`）**未编辑**，避免放宽旧断言 |
| `tools/cleaned-preparation-writer.mjs` | 新增 `--decision`（默认旧 decision）；`collect` 按 decision 选择收集器；帮助文本列出两种 decision | 提供可执行入口，满足"没有可用入口=本单未完成" |
| `tools/cleaned-preparation-observer.mjs` | 请求带 `decision` 时用 `collectSupersededPreparationState` 独立复算；未知 decision 拒绝 | 提权只读观察者必须能独立复算新 decision 的同一静态证明 |
| `tools/preparation-resolution-history.mjs` | 8 条历史记录各补 `decision` 字段（取值即对应 resolution 文件里的真实 `decision`） | 历史校验要能容纳（并约束）新 decision，否则下次 adopt 重建 bundle 后历史校验会失败 |
| `tests/preparation-superseded-resolution.test.mjs` | 新增 9 个测试（含全部负向用例） | 正/负向证据 |
| `docs/a3-predecessor-drift-20261022/evidence/*` | 原始测试输出、真实 e786 只读推导输出 | 原始证据留存 |

未改动：`main-prebuild-queue.mjs`、`install-main-prebuild.mjs`（控制包文件数仍为 15 件）、`django-local-service.ps1`、`worker-local-release*.mjs`、`publish-prepared-main.mjs`、`publish-latest-main.mjs`、`release-scope-plan.mjs`。

## 2. 新 decision 的完整不变式与校验位置

decision 名：`superseded-by-later-publication`（`resolutionDecisions.supersededByLaterPublication`）
终止依据：`preparation-consumed-by-later-publication`
推导函数：`tools/preparation-resolution.mjs:182` `supersededFacts(o)`
证明入口：`tools/preparation-resolution.mjs:249` `validateSupersededStaticProof`
采集入口：`tools/preparation-resolution.mjs:275` `collectSupersededPreparationState`
Resolution 校验：`tools/preparation-resolution.mjs:308` `validateSupersededResolution`

### 不变式 a — 维护从未由**本 dispatch**开始

| 断言 | 位置 |
|---|---|
| 准备阶段失败回执 `maintenanceStarted === false` | `preparation-resolution.mjs:209`（`Maintenance already started`） |
| 准备阶段失败回执 `processEvidence === null`（没有任何子进程证据） | `preparation-resolution.mjs:209`（`Preparation termination retained a live process`） |
| 准备阶段失败回执 `phase !== '构建前端'` | `preparation-resolution.mjs:208` |
| `automaticRetry === false`，`error` 非空字符串，`mainCommit === selectedTarget` | `preparation-resolution.mjs:207,209,210` |
| 时间序：`dispatchedAt ≤ PREPARING.at ≤ PREPARED.at ≤ FAILED.at`（准备**成功在前**，失败发生在准备之后的发布前校验） | `preparation-resolution.mjs:193,194` |
| 加强条件：若同一 packet 的发布尝试确实开始过维护（`publish-<target12>/FAILED.json` 的 `maintenanceStarted === true`），则该尝试必须有可识别的 actor（`processEvidence.processId` 为正整数），且取代它的那次发布必须显式对账：`originalStartReconciled === true` 且 `originalStartExitedSuccessfully === false` | `preparation-resolution.mjs:211-215,226,227` |
| 两条 census 都必须看不到该 actor | `preparation-resolution.mjs:328,334` |

> 说明（重要，不做美化）：基线事实里 `FAILED-e1de27e8-…json` 的 `maintenanceStarted=false`（准备阶段从未开始维护），但同一 packet 根目录的 `FAILED.json`（发布尝试，"退出维护"失败）是 `maintenanceStarted=true`。因此本单把不变式 a 写成**加强版**：本 dispatch 自身从未开始维护，且任何"同 packet 上真的开始过的维护"必须被取代它的那次发布对账过，否则不放行。这是加固，不是放宽。

### 不变式 b — 目标已被一次成功部署覆盖，且处于已就绪终态

| 断言 | 位置 |
|---|---|
| `PUBLISHED-MAIN.mainCommit === dispatch.selectedTarget` | `preparation-resolution.mjs:216` |
| `PUBLISHED-MAIN.status === 'deployed_and_ready'`、`startupVerified === true`、`readyVerified === true` | `preparation-resolution.mjs:216` |
| 回执侧同样 `mainCommit/status/startupVerified/readyVerified` 一致，且 `PUBLISHED-MAIN.at === receipt.at`（同一条记录） | `preparation-resolution.mjs:217,218` |
| 发布晚于本 dispatch 的终止：`receipt.at ≥ preparationTermination.at` | `preparation-resolution.mjs:219` |
| `PUBLISHED-MAIN.json` 必须位于该队列目录的上一级（`dirname(queue)/PUBLISHED-MAIN.json`），不得被指到别处 | `preparation-resolution.mjs:266` |
| resolution 顶层再次声明 `maintenanceStarted=false / prepared=true / publicationPerformed=false / retryOriginal=false` | `preparation-resolution.mjs:312` |

### 不变式 c — 覆盖它的那次部署有可核验回执

| 断言 | 位置 |
|---|---|
| `PUBLISHED-MAIN.receiptPath` 为绝对路径 | `preparation-resolution.mjs:297` |
| `sha256(receiptPath 字节) === PUBLISHED-MAIN.receiptSha256 === resolution.successorPublication.receiptSha256` | `preparation-resolution.mjs:299`、`validateSupersededStaticProof`（`main.receiptPath`/`main.receiptSha256` 与记录逐字相等） |
| 回执指名**这一次尝试**：`receipt.originalAttempt === PUBLISHED-MAIN.originalAttempt`，且两者都 resolve 等于 `join(dispatch.selection.packet, 'publish-'+target12)` | `preparation-resolution.mjs:220,221` |
| 回执钉住该尝试的 STARTED/FAILED 字节：`receipt.originalStartedSha256 === sha(packet/publish-<12>/STARTED.json)`、`receipt.originalFailureSha256 === sha(packet/publish-<12>/FAILED.json)`；`PUBLISHED-MAIN` 侧同值 | `preparation-resolution.mjs:222,223,224` |
| `receipt.source` resolve 等于 `join(packet,'source')` | `preparation-resolution.mjs:236` |

### 不变式 d — 该发布消费的正是**本 dispatch 准备出的产物**（不能只凭目标相等）

| 断言 | 位置 |
|---|---|
| `receipt.workerRelease === PREPARED.workerPlan.candidateReleaseId` | `preparation-resolution.mjs:229` |
| `receipt.workerManifestSha256 === PREPARED.workerPlan.candidateManifestSha256` | `preparation-resolution.mjs:230` |
| `receipt.djangoPreparedId === PREPARED.djangoPackage.id` | `preparation-resolution.mjs:231` |
| `receipt.djangoManifestSha256 === PREPARED.djangoManifestSha256` | `preparation-resolution.mjs:232` |
| `PUBLISHED-MAIN` 侧与回执的四个候选身份逐字相等 | `preparation-resolution.mjs:233` |
| `receipt.sourceTree === 冻结源码 tree`；`PUBLISHED-MAIN.sourceTree.sha256 === source-binding.identity.sourceTree.sha256` | `preparation-resolution.mjs:234,235` |
| `PREPARED.requestSha256 === sha(JSON.stringify(main-release-request.json))`，且 `PREPARING/PREPARED.sourceIdentity === selectedTarget/tree`，`STARTED.mainCommit/requestSha256/sourceTree/predecessorChainStateSha256` 一致 | `preparation-resolution.mjs:185-203` |
| `worker-plan.json` 与 `PREPARED.workerPlan` 的 version/planSha256/planPath/候选/前驱逐字相等 | `preparation-resolution.mjs:195-199` |
| 准备产物与发布产物必须来自**同一冻结源码**：`assertFrozenSource`（git `rev-parse HEAD/HEAD^{tree}/commit^{tree}` + `status --porcelain` 为空） | `preparation-resolution.mjs:203`；`frozen-main-source.mjs:5` |

### 结构性约束（防止"随便凑一段证据"）

| 断言 | 位置 |
|---|---|
| 归档 packet 闭包恰好 8 件：请求、`publish-<12>/STARTED.json`、`publish-<12>/FAILED.json`、`preparation/{PREPARING,source-binding,PREPARED,worker-plan}.json`、唯一一个 `FAILED-<uuid>.json`；多一件少一件都拒绝 | `preparation-resolution.mjs:257-259` |
| 磁盘上 `preparation/` 只允许这 5 个文件 + `verify-<token>/` 目录 | `preparation-resolution.mjs:284,285` |
| 每个记录块必须是**闭集键**（`preparationKeys`/`terminationKeys`/`attemptTerminationKeys`/`successorKeys`），并与归档字节重新推导出的结果 `deepEqual` | `preparation-resolution.mjs:255,270` |
| 生产代码闭包必须命中已审阅的 producer qualification | `preparation-resolution.mjs:271` |
| 两次扫描的证明必须逐字相等（`Complete inventories changed`），且 resolution 记录块必须等于扫描块 | `preparation-resolution.mjs:326,327` |

### 协议层（沿用既有，未跳过）

| 约束 | 位置 |
|---|---|
| 队列锁 + worker 轮换锁 + 20 分钟 epoch + 每阶段 60 秒观察者 ACK + 每次校验前 CAS 重读 dispatch/terminal/CONTROL-INSTALLATION | `preparation-resolution.mjs:344,355,367,368` |
| 请求必须是 `initial`/`final` 两阶段，nonce 不可复用，非提权 ordinary 令牌，控制代际一致 | `preparation-resolution.mjs:319-334` |
| 未知 decision 一律失败关闭（读路径与写路径各一道） | `preparation-resolution.mjs:70`（读）、`preparation-resolution.mjs:345`（写）、`cleaned-preparation-observer.mjs:17`（观察者） |
| 同一 dispatch 已有 resolution：**拒绝**（不覆盖），且在任何证据对象创建之前 | `preparation-resolution.mjs:351-356` |

### 队列侧（不变）

队列通过 `readPreparationResolution()` 判定已收敛并放行后续工作：`main-prebuild-queue.mjs` 中
`if(!terminal||['unknown','failed','blocked'].includes(terminal.status)){ … await readPreparationResolution(...) }`，
本单**未改动**该文件。测试 `superseded-by-later-publication converges … and the queue recognises it` 直接驱动 `drainPreparationQueue` 证明解锁生效。

## 3. 全部测试原始输出

### 3.1 新 decision 测试（含全部负向用例）

命令：

```text
node --test --test-concurrency=1 tests/preparation-superseded-resolution.test.mjs
```

原始输出（完整，未删改）：

```text
✔ superseded-by-later-publication converges the e786 evidence shape and the queue recognises it (1959.7498ms)
✔ a resolved dispatch is never converged twice and its evidence closure is untouched (1454.6222ms)
✔ maintenance that already started, a drifted target and a frontend timeout are refused (1729.5727ms)
✔ a successor publication that consumed another candidate is refused before any evidence is written (737.2002ms)
✔ unreconciled interrupted maintenance and unknown packet artifacts are refused (911.4916ms)
✔ the legacy decision reader refuses a superseded resolution (1104.974ms)
✔ the historical catalog reads a superseded resolution back and refuses any later change (1159.7055ms)
✔ an unknown decision and a tampered evidence object are refused on read (1151.6715ms)
✔ the frozen bundle CLI advertises both decisions and never touches production (607.3942ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10904.6898
```

逐条负向用例与断言消息对照（均在上述文件内，可复现）：

| 要求的负向用例 | 实际断言 | 结果 |
|---|---|---|
| `maintenanceStarted === true` → 拒绝 | `Maintenance already started` | 拒绝 |
| `selectedTarget ≠ 当前 PUBLISHED-MAIN.mainCommit` → 拒绝 | `Later publication deployed another commit` | 拒绝 |
| 回执 sha256 不匹配 → 拒绝 | `Published receipt digest changed` | 拒绝 |
| 用新 decision 收敛 `phase='构建前端'` 超时案例 → 拒绝 | `A frontend build timeout cannot be superseded`（且 `processEvidence !== null` 另有一道 `retained a live process`） | 拒绝 |
| 同一 dispatch 已有 resolution 时再次收敛 → 拒绝且不覆盖 | `Dispatch already carries a resolution; a second convergence is refused`（且断言前后 resolution 文件字节与证据对象数不变） | 拒绝、不覆盖 |
| 已存在 resolution 文件被改动后 → 历史校验失败 | `Historical resolution changed` / `Historical successor receipt changed` / `Historical preparation receipt changed` / `Noncanonical` | 校验失败 |
| 额外（本单新增）发布消费了别的候选 → 拒绝 | `Successor published another worker manifest`，且**在创建任何证据目录之前**拒绝 | 拒绝 |
| 额外（本单新增）被中断的维护未被对账 → 拒绝 | `Interrupted maintenance was not reconciled` / `was not reconciled` | 拒绝 |
| 额外（本单新增）packet 里多出未知产物 → 拒绝 | `Unknown preparation artifact` | 拒绝 |
| 额外（本单新增）读入未知 decision → 拒绝 | `Unknown resolution decision` | 拒绝 |
| 额外（本单新增）证据对象被篡改 → 拒绝 | `digest mismatch` | 拒绝 |

### 3.2 既有 preparation 测试（回归）

命令与原始输出：`evidence/legacy-resolution-node-test.txt`（`node --test --test-concurrency=1 tests/preparation-resolution.test.mjs`，10/10 通过，含 8 条封存历史 resolution 的只读读取与 replay 策略计数）。

### 3.3 定向全量（14 个相关测试文件，198 个用例）

命令：

```text
node --test --test-concurrency=1 --test-skip-pattern="real on-demand fixed task" tests/preparation-resolution.test.mjs tests/preparation-superseded-resolution.test.mjs tests/fixed-cleaned-preparation.test.mjs tests/fixed-admin-resolution.test.mjs tests/fixed-cache-rejection.test.mjs tests/fixed-native-abandonment.test.mjs tests/fixed-schema-rejection.test.mjs tests/installer-0038-control.test.mjs tests/main-prebuild-queue-v2.test.mjs tests/main-prebuild-generation-rejection.test.mjs tests/main-prebuild-task.test.mjs tests/main-prebuild-status.test.mjs tests/main-prebuild-hook.test.mjs tests/main-prebuild-eligibility.test.mjs
```

结果（原始输出：`evidence/targeted-suite-node-test.txt`）：

```text
ℹ tests 198
ℹ pass 196
ℹ fail 2
```

2 个失败均为 **环境性既有失败**，与本次改动无关：`tests/fixed-admin-resolution.test.mjs` 里两处 `execFileSync('pwsh.exe', …)` 在本机 PATH 上找不到 `pwsh.exe`（PowerShell 7 实际位于 `D:/teruisi-runtime/tools/pwsh/pwsh.exe`）。

在**未改动的基线** worktree（`D:\codex-worktrees\merge-20261022`，`61f891a8`）上同样失败：

```text
node --test --test-concurrency=1 --test-name-pattern="pwsh.exe" tests/fixed-admin-resolution.test.mjs
ℹ pass 0
ℹ fail 2
✖ failing tests:
  Error: spawnSync pwsh.exe ENOENT
```

### 3.4 对真实 e786 证据的只读推导（不改任何文件）

只读探针（脚本仅置于未提交的临时目录，功能由 `collectSupersededPreparationState` 提供）：

```js
import path from 'node:path';
import {readQueueObject} from '../tools/main-prebuild-queue.mjs';
import {collectSupersededPreparationState,resolutionDecisions} from '../tools/preparation-resolution.mjs';
const directory='D:/codex-isolated/main-manual-release-20261016/prebuild-queue-v2';
const dispatchId='e786aed6-25c2-4cce-b433-4fd21d3ac2c2';
const dispatch=(await readQueueObject(path.join(directory,'dispatches',dispatchId+'.json'))).value;
const terminal=(await readQueueObject(path.join(directory,'results',dispatch.requestId+'.json'))).value;
const proof=await collectSupersededPreparationState(dispatch,terminal,new Map(),{decision:resolutionDecisions.supersededByLaterPublication,directory});
console.log(JSON.stringify(proof,null,1));
```

原始输出：`evidence/real-e786-readonly-derivation.json`（`status: read-only-superseded-proof-accepted`）关键值：

```text
selectedTarget            988810cf4b9cccc6d9a3eea905f15e3b67989d8f
preparation.sha256        4ea8fd203a902aaa551913fe02ba5ac2786ba458637799e38a80aafe0d77c5a5
preparation.workerRelease 20261021T050959Z-309bb3d722f0ee47
preparationTermination    phase=核对维护前驱资格  maintenanceStarted=false  processEvidence=null  at=2026-10-21T09:49:41.979Z
originalAttemptTermination phase=退出维护  maintenanceStarted=true  actorProcessId=39356  at=2026-10-21T10:37:56.372Z
successorPublication      status=deployed_and_ready  at=2026-10-21T11:19:59.969Z  originalStartReconciled=true
successorPublication.receiptSha256 c376bf58d5a901f89d18c3b58807393a8f5a272e7d9a3b57240ceab6f5449c5c
successorPublication.workerRelease === preparation.workerRelease     （相同候选身份：worker release + manifest + Django package + Django manifest）
```

结论：真实 e786 证据满足 4 条不变式，S03 可用第 5 节命令收敛（**本单未执行收敛**）。

## 4. 合并闸门

**问：以后任何一个 unknown dispatch，会不会都能靠这个新 decision 糊过去？**

**答：不会。** 原因如下，逐条对应代码：

1. **必须同时满足 4 条不变式，缺一不放行。** 任一条不成立都会在 `supersededFacts`（`preparation-resolution.mjs:182`）抛错，且在写路径里发生在"创建任何证据对象之前"（`preparation-resolution.mjs:355`）。
2. **"目标相等"单独无法放行。** 不变式 d 要求发布回执的 worker release、worker manifest、Django prepared id、Django manifest 四项，与**本 dispatch 的 PREPARED.json** 逐字相等（`:229-232`）；而 PREPARED.json 又通过 `requestSha256` 钉在与 dispatch 同一份冻结请求上（`:192`）。仅仅"后来者部署了同一个 commit"过不了。
3. **必须有一条可核验的消费链，且全部由归档字节复算。** 回执字节的 sha256、回执指名的 `originalAttempt` 目录、该目录下 STARTED/FAILED 的字节哈希、回执 `source` 与 packet `source` 的路径一致，缺一不可（`:220-224,236,299`）。任何一环被替换都会在不同断言上失败。
4. **准备其实成功过。** 要求 `PREPARED.json` 存在、`PREPARING.at ≤ PREPARED.at ≤ FAILED.at`（`:194`），并且 `phase !== '构建前端'`、`processEvidence === null`（`:208,209`）。因此老的"前端构建超时"形状（process_timeout）无论如何改造都过不了——这正是既有 decision 覆盖的场景，两者不可互相顶替。
5. **维护语义是加强的，不是放松的。** 本 dispatch 自身必须从未开始维护；若同 packet 的发布尝试真的开始过维护（`maintenanceStarted=true`），则必须由取代它的那次发布显式对账（`originalStartReconciled=true`、`originalStartExitedSuccessfully=false`），且该 actor PID 必须在两次 census 里都消失（`:226,227,328,334`）。也就是"糊过去"反而比原来**更难**：一个真正悬在半路的维护状态会被拒绝。
6. **不掺任何白名单/特判。** 代码里没有 dispatchId、没有具体提交号；所有条件都是从 `dispatch.selectedTarget`、`dispatch.selection.packet`、`PUBLISHED-MAIN` 派生的结构性路径与哈希。
7. **失败方向是关闭的。** 不符合的 dispatch 会继续被判为"未收敛"，队列继续按原逻辑阻塞；未知 decision、未知产物、未知候选、缺少归档对象一律抛错。

**闸门结论：通过。** 新 decision 不会成为"通用放行口"；它只对同时满足 4 条不变式且证据链可验证的 dispatch 生效，其余全部继续失败关闭。

## 5. 收敛命令（S03 直接可用，完整可复制）

前置：S03 已 adopt 新控制包（含本单 15 件控制文件）。`$bundle` 取 `CONTROL-INSTALLATION.json` 的 `bundleRoot`（即 `<state>\control-bundles\<bundleSha256>`）。

```powershell
# 由 CONTROL-INSTALLATION.json 读出状态目录与冻结包路径
$state  = (Get-Content 'D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json' | ConvertFrom-Json).stateDirectory
$config = 'D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json'
$bundle = (Get-Content (Join-Path $state 'CONTROL-INSTALLATION.json') | ConvertFrom-Json).bundleRoot
$node   = 'C:\Program Files\nodejs\node.exe'
$out    = 'D:\codex-artifacts\a3-converge-20261022\e786'

# 1) 只读盘点（普通交互用户；只读，不产生任何效果）
& $node "$bundle\tools\cleaned-preparation-writer.mjs" --config $config --inventory

# 2) 发起收敛（普通交互用户，中等完整性，同一交互会话；会打印两次观察者命令）
& $node "$bundle\tools\cleaned-preparation-writer.mjs" --config $config `
  --dispatch e786aed6-25c2-4cce-b433-4fd21d3ac2c2 `
  --decision superseded-by-later-publication `
  --out $out

# 3) 每看到 {"status":"awaiting-independent-read-only-observer", ...} 时，
#    另开【管理员】PowerShell（提权，同一冻结包）执行它打印的那条：
& $node "$bundle\tools\cleaned-preparation-observer.mjs" `
  --request "$out\REQUEST-initial.json" `
  --sha <上一步打印的 requestSha256> `
  --out   "$out\OBSERVATION-initial.json"

#    写者进入最终阶段时会再打印一次，用 REQUEST-final.json / requestSha256 / OBSERVATION-final.json 重复第 3 步。
```

要点：
- 写者必须是**普通交互用户**（非提权，中等完整性、与准备任务同会话）；观察者必须是**提权**（`census.elevated === true`）。
- 观察者与写者必须来自**同一个 adopted 冻结包**（`readAdoptedControl` 会校验代际）。
- `--out` 必须是 `D:\codex-artifacts\` 下的**全新**目录，且**不得**复用 4aac/693e 等任何历史证据目录。
- 全程 20 分钟预算；每个阶段的观察者必须在写者发出请求后 60 秒内完成 ACK。
- 收敛只写 `resolutions\<dispatchId>.json` 及其证据目录，不改写 results/ 里原来的 unknown 终态、不重试准备、不发布任何东西。

## 6. 边界与限制（诚实披露，不打包成"已解决"）

1. **不变式 c 的形状偏好（失败关闭方向）。** 消费链要求回执能指名被覆盖的这次尝试（`originalAttempt` + STARTED/FAILED 字节哈希 + 对账标志）。目前观察到的真实数据形态是"人工恢复（manualRecovery）产出的 SUCCESS 回执"。若未来某次取代性发布产出的回执不带这些字段，则该 dispatch **收敛不了**（继续阻塞）。这是有意为之的失败方向：宁可拒绝一个本可收敛的案例，也不放行一个无法证明消费关系的案例。
2. **`worker-plan.json` 只做自洽性校验。** `PREPARED.workerPlan.planSha256` 并不等于该文件字节的 sha256（已核验：文件字节 sha=`1dabecb3…`，字段值 `36b37f11…`），因此我们只能校验 plan 与 PREPARED 的字段一致，不能把 plan 文件内容钉到 PREPARED 上。消费证明本身不依赖 plan，plan 仅作旁证。
3. **`request.sourceTree` 字段在真实请求中不存在。** 冻结 tree 由 packet 源码的 git 树 + PREPARING/PREPARED/STARTED/回执的 `sourceTree` 相互印证；若请求带 `sourceTree`，则额外要求与之一致（`preparation-resolution.mjs:189`）。
4. **回放栅栏沿用默认值。** 新 decision 收敛后，`resolutionForbidsTargetReplay(dispatchId)` 因不在历史 catalog 中而返回默认 `true`：同一目标不会被再次准备。这是既有语义、本单未改动。若 S03 之后需要允许同一目标再准备，属于另一张单的事，本单不做。
5. **未做真实写入。** 本单只在测试夹具与真实 e786 证据上做过**只读**推导；实际收敛（写 resolution）留给 S03。

## 7. 证据索引（均在本次提交 `8be7a3bf`）

| 文件 | 内容 |
|---|---|
| `docs/a3-predecessor-drift-20261022/REPORT.md` | 本报告 |
| `docs/a3-predecessor-drift-20261022/evidence/new-decision-node-test.txt` | 新 decision 9 个用例原始输出 |
| `docs/a3-predecessor-drift-20261022/evidence/legacy-resolution-node-test.txt` | 既有 preparation 测试原始输出（回归） |
| `docs/a3-predecessor-drift-20261022/evidence/targeted-suite-node-test.txt` | 14 文件 198 用例原始输出（含 2 个既有环境失败） |
| `docs/a3-predecessor-drift-20261022/evidence/real-e786-readonly-derivation.json` | 真实 e786 证据的只读推导结果 |

