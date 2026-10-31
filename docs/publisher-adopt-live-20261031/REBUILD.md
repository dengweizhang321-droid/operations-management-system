# 控制包重建的两步调查（2026-10-31）

**本轮只读。未执行任何准备或采用动作，未写 D:\teruisi-runtime、未写 D:\codex-isolated。** 区分 `[实测]`（读到或算到）与 `[推断]`（据代码形状判断，附依据与不确定度）；查不到写「未查到」。

## 0. 先更正两个数字（都很要紧）

### 0.1 目标 bundleSha256 已经不是 134bf8ed… 了

`[实测]` 原因：**`preparation-retirement-entry.mjs` 本身也是 `controlFiles` 成员**，所以上一轮改 pin 的那次提交 `0ee3ef50` 自己又把 bundle 摘要推进了一代。

`[实测]` 逐代复算（同一算法）：

| 基线 | bundleSha256 |
| --- | --- |
| `refs/remotes/origin/main`（89429877） | `e664af36f9aed179875fb1bf66447321d4f906ff1734bdeb2e38514b92842a8e` ← 现役已采用 |
| `350b3245`（入口 + 承认范围字段） | `134bf8ed0061da3ac1fa36dab220d28ee64a7e05c4cb892518437662f3b852a0` |
| `HEAD` = `0ee3ef50`（再加 pin 改动） | **`83831638fe37400ddce1b5df7725cda5916c71d6724e968be6061c7f686f438e`** |

**执行重建时必须用现算值，不要抄本文档里的任何一个**——我改的两个文件都在 `controlFiles` 里，任何后续改动都会再推一代。

一般性结论：`controlFiles` 的 35 个成员里任何一个变了，`bundleSha256` 就变、控制包就要重建。所以「改 pin」与「改发布器」不是两次独立重建，合并成一次即可。

### 0.2 canonical 算法已用现役包反证，我的算法是对的

姐妹会话说复算的绝对值与我不同。`[实测]` 我用**现役已采用的那个包自己的 35 个文件**反算，得到的正是它的目录名：

- 从 `control-bundles\e664af36…\tools\` 反算 → `e664af36f9aed179875fb1bf66447321d4f906ff1734bdeb2e38514b92842a8e`
- 该目录名本身（ground truth）→ 同值，**相等**
- 该包 `MANIFEST.json` 的 `bundleSha256` → 同值，**相等**

**算法由此被现役事实验证**，不是推断。正确算法见 `install-main-prebuild.mjs:120-121`：先对 35 个成员各算 `sha`，键名为 `tools/<name>`，再 `sha(Buffer.from(canonical(files)))`。

`[实测]` 三个易错点，任一弄错就得到不同值（都已实算对照）：

| 变体 | 得到的值 | 对不对 |
| --- | --- | --- |
| `canonical(files)`：键排序 + **末尾换行** | `83831638…` | 正确 |
| `JSON.stringify` 排序但**无末尾换行** | `792cbf92…` | 错 |
| 键名**不带** `tools/` 前缀 | `83a84f6c…` | 错 |

`[实测]` `canonical` 定义在 `main-prebuild-queue.mjs:36`：`value=>JSON.stringify(ordered(value))+'\n'` —— **那个末尾换行是最可能的分歧来源**。另外 `files` 只含 35 个成员摘要，**不含** manifest 其他字段（`sourceCommit`/`sourceTree`/`version` 都不进 `bundleSha256`；整份 manifest 的摘要是另一个量 `bundleManifestSha256`）。

## 1. 准备步骤

### 命令行

`[实测]` `install-main-prebuild.mjs:324` 的 `main()`：不传 `--adopt` 即准备模式，调 `prepareControlUpgrade({configFile:values.config,out:values.out,…})`。

```bash
node tools/install-main-prebuild.mjs --config <绝对路径> --out <新目录绝对路径>
```

`[实测]` `:91` 要求两者都是**绝对路径**。

### --config 指哪个

`[推断，依据充分]` 应指 `D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json`（无后缀）。依据：现役 `CONTROL-INSTALLATION.json` 的 `configSha256` = `a461db4d…`，而 `main-control-dispatch.mjs:39` 断言 `sha(configRaw)===state.configSha256`；记忆条目 `release-fixed-entry-config-and-control-bundle` 也记明固定入口是无后缀那个。**我没有实算该文件 sha256 去对 `a461db4d…`**（避免无授权时过度触碰状态目录），留给执行时核对。

`[实测]` 注意 `:103` 会就地改写 config 对象（写入 `gitDirectory`、`publisherBaseEnvironment`、`controlProtocol`），`:140` 以 `sha(configNew)` 作为新 `configSha256`。所以**新配置字节可能与旧不同，这是正常的**；`:104` 的 `Exact update cannot change other publisher configuration` 仅在传了两种精确更新时生效。

### --out 指哪里：必须是不存在的新目录

`[实测]` `:113` 是 `fs.mkdir(out,{recursive:false})` —— 目录已存在抛 `EEXIST`，父目录不存在也抛。所以**不能复用**已有目录，必须新建，父目录须已存在。

`[实测]` 命名约定：代码里**未查到**任何约定。磁盘上也**未查到**任何留存的历史 `--out` 目录（见 §5：`control-upgrades\` 不是 `--out`，那是采用时另建的副本）。`[推断，中等不确定]` 历史 `--out` 多半建在临时区或 `D:\codex-artifacts\` 并已清理。执行时自定新路径即可；建议放 `D:\codex-artifacts\control-upgrade-<日期>-<短摘要>`，不放进 `D:\codex-isolated`，以免与状态目录保留策略纠缠。

### prepareControlUpgrade 的前置断言（它会拒什么）

`[实测]` 按执行顺序：

| 行号 | 断言 | 拒绝条件 |
| --- | --- | --- |
| `:91` | 两个路径均为绝对 | 相对路径 |
| `:91` | `git status --porcelain` 为空，报 `Control source must be frozen and clean` | **源码树有未提交改动**。`sourceRoot` 默认是 `:20` 的仓库根（本 worktree），故我的改动必须先提交（已提交） |
| `:92` | 不得同传两种精确更新 | 混用 |
| `:93` | `--restore-disabled-preparation-task` 不与那两种混用 | 混用 |
| `:104` | 传更新时 config 不得被改到别处 | 顺带改配置 |
| `:105` | `policy.local===null\|\|policy.local===policy.hooks` 且 `policy.effective===policy.local` | 仓库有外来/自定义 `core.hooksPath` |
| `:107` | 旧 hook 须匹配 `^#!/bin/sh\r?\n# TERUISI main-prebuild v[12]:` | 第三方 hook 受保护，不覆盖 |
| `:110` | `nativeOperationBindings(releaseDirectory)` | 存在不支持的成熟布局 |
| `:111` | `assertRetirementConfigUpgrade(...)` | 退役配置迁移不自洽 |
| `:113` | `mkdir(out,{recursive:false})` | `--out` 已存在 |
| `:120` | 逐个读 35 个 `controlFiles` 成员 | 任一缺失 |
| `:136` | 模板须含 `const legacyBridge = null;` | `main-control-dispatch.mjs` 桥接模板被改过 |
| `:142` | `Preparation task is not the exact owned predecessor` | **现役计划任务定义与安装记录不一致**（有人手改过那个计划任务就会被拒） |

### 它写哪些文件；是否改变现役状态

`[实测]` 全部写在 `--out` 内（`:113-138`）：

```
<out>\RETIREMENT-OLD-CONFIG.json      <out>\CONTROL-OLD-CONFIG.json
<out>\CONTROL-OLD-INSTALLATION.json   （现役已有安装记录时）
<out>\PREPARED-ARTIFACT-LOSS.json     （绑定了 artifact loss 时）
<out>\bundle\tools\<35 个成员>        <out>\bundle\MANIFEST.json
<out>\CONFIG.json  <out>\HOOK  <out>\BRIDGE-HOOK  <out>\SHIM.mjs
<out>\INTENT.json  <out>\PREPARED.json
```

`[实测]` **这一步是纯产出候选，不改变任何现役状态。** 三条依据：

1. `:113-145` 逐行核对，所有写操作目标都在 `out` 之下，无一例外；
2. 返回值 `:145` 为 `{status:'bundle-prepared',…,adoptionPerformed:false}`；
3. `bundleRoot`（`:121`）只是**算出**路径字符串，真正的拷贝在采用阶段 `:284`，不在准备阶段。

`[推断，不确定度低]` 因此**准备这一步不需要单独的生产授权**（不触控制代际、不碰生产运行目录）。但它会落盘约 40 个文件，仍应取得用户对「可以跑这一步」的同意。

## 2. 采用步骤

### 命令行

`[实测]` `:324`：

```bash
node tools/install-main-prebuild.mjs --adopt <第1步的 out 目录绝对路径> [--resume]
```

`[实测]` `--adopt` 的目录**就是**第 1 步的 `--out`：`:271` → `:272` 的 `readMaterials(directory)` 读该目录下的 `INTENT.json`、`PREPARED.json`、`bundle\MANIFEST.json`、`CONFIG.json` 等。

`[实测]` `:324` 互斥：`--adopt` 不得与 `--dependency-update`、`--native-tools-update`、`--restore-disabled-preparation-task`、`--artifact-loss-manifest` 同用，报 `Exact updates must be sealed during material preparation`。

### adoptControlUpgrade 的前置断言

`[实测]` **读材料段**（`readMaterials`，`:149-165`，在任何锁之前执行）：

| 行号 | 断言 |
| --- | --- |
| `:150` | 两份记录版本正确；`prepared.intentSha256` 等于 `INTENT.json` 的摘要；`installId` 一致；`adoptionPerformed` 为 false |
| `:151` | MANIFEST 摘要等于 `intent.bundleManifestSha256`；`manifest.bundleSha256` 等于 `intent.bundleSha256`；**`manifest.files` 的键集合必须恰好等于 `controlFiles`**（增删成员即拒） |
| `:152` | manifest 必须声明 `preparationRetirementProtocol` 与 `preparationRetirementRefProtocol` —— **控制材料不得移除退役准入与原生退役目标围栏** |
| `:153-155` | artifact loss 绑定自洽 |
| `:158-162` | 前代已有该能力时，**后继不得丢弃或替换**（`Successor cannot drop artifact loss capability`） |
| `:156-157` | `CONTROL-OLD-INSTALLATION.json` 字节须等于 `intent.old.installation`（前像未变） |
| `:163` | 逐个核 `bundle/tools/<name>` 字节等于 manifest 声明（`Prepared closure changed`） |
| `:165` | 核 `CONFIG.json`、`HOOK`、`BRIDGE-HOOK`、`SHIM.mjs` 四者摘要等于 intent 声明 |

**幂等短路** `[实测]` `:273`：现役已是 `adopted` 且 `installId` 相同时，复核后直接返回 `already-adopted`、`adoptionPerformed:false` —— 重复采用同一份材料是安全的。

**CAS 前像** `[实测]` `:274-280`：现役安装记录的摘要须等于 `intent.old.installation`；不等时**必须显式 `--resume`**（`Explicit same-intent resume required`），且现役记录须恰为四个键的 `installing` 中间态，且 `installId` 与 `intentSha256` 与本材料一致。

### 锁：三把，固定顺序

`[实测]` `:290` 依次获取三把命名管道锁，顺序 v1-queue、v2-queue、native-rotation。第三把**就是发布器用的那把轮换锁**（与 `publish-latest-main.mjs:231` 的 `rotationLockPipe` 同一字面量）。采用期间发布与准备因此被排除在外。

### 要不要求发布器不在运行

`[实测]` **不是靠断言「不在运行」，而是轮询等相关进程清空。** `:296-299` 调 `controlProcessSnapshot`，收集命令行提到 hook、状态目录下 `control/tools/`、`control-bundles/`、发布包 `source/tools/`，或含 `publish-main`、`process-deadline`、`manual-maintenance` 的进程（`:260`），并沿 `ParentProcessId` 递归（`:261`）；**连续 3 轮快照为空才继续**。超过 `deadlineUnixMs`（默认 `timeoutMs=30000`，上限 30 分钟）则写一份 `teruisi-main-control-blocked-v2` 并失败。

`[实测]` `:262` 还要求每个相关进程身份可读（`Related control process identity unknown`），且同一 pid 的创建时间在多轮之间不得变（防 pid 回收混淆）。

`[推断，不确定度低]` 所以实际前置等价于「采用期间不能有发布器、准备或维护相关进程在跑」，但表现为**等待与超时**，不是立即拒绝。

### 要不要维护窗口

`[实测]` **不要。** 采用流程里**未查到**任何 `EnterMaintenance`、`system-maintenance.json` 或排空标记的读写；`:321` 的返回值明确 `productionDeploymentPerformed:false`。它改的是控制面（hook、shim、安装记录、计划任务、BAT），不动应用运行目录。

### --resume 的语义

`[实测]` 就是「续接一次中断的**同一份材料**的采用」，不是别的：

- `:276` 仅 `resume` 为真才允许现役处于 `installing` 中间态；`:279` 要求那条记录的 `installId` 与 `intentSha256` 与本材料**完全一致**，所以无法用它去采用另一份材料。
- `:292` 的 `either(...)` 在 `resume` 时额外允许「已前进过的那一步的值」：dispatcher 可为旧值**或**新 `dispatcherSha256`；hook 可为旧值、`bridgeHookSha256` 或 `hookSha256`；config 可为旧值或新 `configSha256`。即**每一步都允许「未做」或「已做」两种状态**，这正是幂等续接。
- `:300` 的 `taskResume` 据现役安装记录是否已偏离前像，决定计划任务按续接方式安装。

### 采用改写哪些现役记录；是否可逆

`[实测]` 按阶段 S0 到 S7：

| 阶段/行号 | 写什么 | 路径 |
| --- | --- | --- |
| `:282-283` | 材料**复制**进状态目录留档 | `<state>\control-upgrades\<installId>\` 下的 INTENT、PREPARED、各 OLD 记录 |
| `:284-286` | bundle 的 35 个成员与 MANIFEST 拷进**新的**不可变包目录 | `<state>\control-bundles\<新 bundleSha256>\`（已存在则逐字节核对，`Immutable bundle differs`） |
| S1 `:302` | 改写 Git hook 为 bridge-hook，并设 `core.hooksPath` | `<repo>\.git\hooks\reference-transaction` |
| S2 `:303` | 改写 shim | `<state>\control\tools\publish-latest-main.mjs` |
| S3 `:306` | 安装记录置 `installing` 中间态 | `<state>\CONTROL-INSTALLATION.json` |
| `:309` | 留存退役原始配置 | `<state>\retirement-configs\<sha>.json` |
| `:310` | 重写三个 BAT | `<state>` 下的准备main、发布main、查看打包状态 |
| TASK `:315` | 安装或更新 Windows 计划任务 | `TERUISI.MainPreparation.*` |
| `:316-317` | 写转移证明 | `<state>\control-upgrades\<installId>\TRANSITION-<uuid>.json` |
| S6 `:320` | 安装记录置 `adopted`（终态） | `<state>\CONTROL-INSTALLATION.json` |

`[实测]` **不可逆性**：`atomic()` 直接原子替换目标文件，代码里**未查到**任何 rollback、undo 或 revert 实现。旧 bundle 目录不被删除（见 §4），所以「回到旧包」物理上可行，但只能靠「用旧材料再跑一次采用」，而 `[实测]` 我**未查到**任何留存的旧 `--out` 材料目录。**因此实际上没有现成的回退路径，这一步应视为不可逆。**

## 3. 采用后的核验点

### 应该不变的量

`[实测]` `dispatcherSha256` 应**仍为** `6c88c5131c850beb73bd8685e429bd5d543d582acc6bf61df3aa24fb446c52a4`。依据：`:137` 的 shim 由 `main-control-dispatch.mjs`（本次未改）替换一行常量生成，嵌入的只有三个固定路径，不含任何 bundle 摘要；我已按该算法复算得到同值。

`[实测]` 同类「应该不变」的量：

| 量 | 期望 | 依据 |
| --- | --- | --- |
| `dispatcherSha256` | `6c88c513…` | 上述复算 |
| `hookSha256` | 不变 | `:140` 的 `sha(finalHook)`，hook 内容只含 `main-prebuild-hook.mjs` 的路径 |
| `preparationTask.hostSha256` | 不变 | `main-prebuild-task.mjs:30`，PowerShell 宿主 exe 的字节 |
| `preparationTask.nodeSha256` | 不变 | 同上，`process.execPath` 的字节 |
| `preparationTask.sid` 与 `name` | 不变 | `[推断]` 同一用户、同一任务名；未实算 |
| `status` | `adopted` | `:320` |

`[实测]` `configSha256` **我判定为「可能变」**，这与我上一份 REQUALIFY.md 写的「不变」不同：`:103` 会写入 `gitDirectory`、`publisherBaseEnvironment`、`controlProtocol` 再取 `sha(configNew)`。若这些值与现役配置里的完全相同则不变，否则变。**执行前应先比对，不要预设。** 这是本次调查对我自己上一份结论的第二处更正。

### 应该变成什么

| 量 | 新值 |
| --- | --- |
| `bundleSha256` | **执行时现算**（本文撰写时 HEAD 为 `83831638…`，见 §0.1 的警告） |
| `bundleRoot` | `<state>\control-bundles\<上面那个值>` |
| `bundleManifestSha256` | 新 MANIFEST 的摘要，由流程产出，**不手填** |
| `intentSha256` | 新 INTENT 的摘要，由流程产出 |
| `installId` | 新 UUID（`:139` 的 `randomUUID()`） |
| `adoptedAt` | 采用时刻 |
| `transitionProofFile` 与 `transitionProofSha256` | 新的 TRANSITION 记录 |

### 只读验证命令

`[实测]` 有一条现成的只读入口，`main-control-dispatch.mjs:89-92`：

```bash
node tools/main-control-dispatch.mjs --config <配置> --control-status
```

它只读 `CONTROL-INSTALLATION.json` 并打印 `status`、`installId` 与 `publicationPerformed:false`，**不触发任何发布动作**，是最安全的第一道核验。

`[推断，依据 :31-69 的断言链]` 更强的全量校验是 `readAdoptedControl(configFile)`：它逐项核 config、state、intent、transition、manifest、bundle 的全部字节。可由 `publish-latest-main.mjs --check` 间接触发（该路径会建 binding），但那是发布器入口，**应在确认 `--control-status` 正常之后再跑**。

### 采用后发布器还能不能用：必须从 shim 运行

`[实测]` 这是本节最要紧的一条。`publish-latest-main.mjs:705` 把**自己所在目录的父目录**作为 `expectedBundle` 传给 `readAdoptedControl`；而 `main-control-dispatch.mjs:42` 断言 `path.resolve(expectedBundle)` 必须等于 `root`（即 `<state>\control-bundles\<当前 bundleSha256>`），否则报 `Control generation changed; old consumer refused`。所以：

- 从**旧控制包**运行发布器 → `expectedBundle` 是旧包目录 → 与新 `root` 不等 → **被拒**。
- 从**仓库工作区**直接运行 → `expectedBundle` 是仓库根 → 同样不等 → **同样被拒**。

`[实测]` 正确入口是 shim：`<state>\control\tools\publish-latest-main.mjs`（即 `dispatcherSha256` 对应的那个文件）。它的 `main()`（`main-control-dispatch.mjs:93-95`）先调 `readAdoptedControl(configFile)`（**不传** `expectedBundle`，故不受代际断言约束），再从 `binding.bundleRoot` 动态 import 真正的发布器并调 `runLatestMainCli`。`[实测]` 三个 BAT 也在 `:310` 被重写为指向这个 shim。

**结论**：采用之后，发布器只能经 shim（或那三个 BAT）运行；直接跑旧包里或工作区里的 `publish-latest-main.mjs` 会被代际断言拒绝。这与记忆条目 `release-fixed-entry-config-and-control-bundle` 一致，但更精确：**是从 shim 运行、由 shim 解析到当前代的包**，而不是直接指向某个 `control-bundles` 子目录。

## 4. 重建后历史证据绑定如何换代

### 旧控制包与指向它的历史记录

`[实测]` 旧包目录**不被删除**：`:284-286` 只往**新**的 `bundleRoot` 拷贝，代码里**未查到**任何针对 `control-bundles` 的删除、prune 或保留策略实现。磁盘现状印证：`[实测]` `control-bundles\` 下现有 **36 个**包目录，`control-upgrades\` 下现有 **37 个** UUID 目录，历次升级的材料都还在。

`[推断，不确定度低]` 因此指向旧包的历史记录**保持指向旧包，不需要换绑**：那些记录（`control-executions\<uuid>.json` 里的 `bundleSha256`/`bundleManifestSha256`、退役侧 `preparation-retirement.mjs:64` 捕获的 `control` 快照）记的是**当时那一代**的事实，旧包目录仍在，所以它们仍然可解析。换绑反而会篡改历史。

`[实测]` 一个佐证：`preparation-retirement.mjs:64` 的校验是拿退役意图里**自带的** `adoption` 快照与 `control.*` 的字节比对，并断言 `path.resolve(state.bundleRoot)` 等于 `control-bundles\<该快照的 bundleSha256>` —— 它校验的是「这份历史记录内部自洽」，不是「等于当前代」。所以新一代采用不会使旧退役记录失效。

`[实测]` 但有一条**必须注意**：`main-control-dispatch.mjs:53-54` 规定，只要退役登记目录非空，新一代 manifest 就必须继续声明 `preparationRetirementProtocol` 与 `preparationRetirementRefProtocol`，且 `preparation-retirement-admission.mjs`、`-ref.mjs`、`-.mjs` 三个成员的摘要必须存在，否则报 `Control generation would reopen retired preparation`。我这次没有删除任何 `controlFiles` 成员，所以这条自然满足。

### currentInstaller / previousCurrentInstaller 要不要跟着动

`[实测]` **不要动。** 那两项钉的是 `install-main-prebuild.mjs` 这个**文件的字节**（`preparation-retirement-entry.mjs:76` 的 `read('install-main-prebuild.mjs')`，以及 `tests/manual-preparation-recovery.test.mjs:84` 的断言）。本次没有改那个文件，`[实测]` 其摘要仍等于 `currentInstaller`（`db64b24e…`，上一轮实测过）。

**「控制包重建」本身不算 installer 代际变化**：`[实测]` 那两项与 `bundleSha256` 无关，只与 installer 文件字节有关。只有改了 `install-main-prebuild.mjs` 才需要动它们。

### 旧包能不能删

`[实测]` 代码层面**未查到**任何删除路径或保留要求的实现。但有两条**反对删除**的硬依据：

1. `[实测]` `preparation-retirement.mjs:64` 会从 `state.bundleRoot` 读 `MANIFEST.json` 与全部成员字节来校验历史退役记录 —— 删掉那一代的包，对应退役记录就无法再校验。
2. `[实测]` `preparation-resolution.mjs:159-162`（经 `readMaterials`）在采用新包时会读**前一代**的 `MANIFEST.json`（`previous.bundleRoot`）以确认后继没有丢弃 artifact loss 能力。即**下一次**采用还要读**上一次**的包。

`[推断，不确定度低]` 所以至少「当前代」与「前一代」必须保留；更早的包被历史退役记录引用的也要保留。**本轮结论：不要删任何包。** 记忆条目 `codex-isolated-release-packages-grow` 提到的膨胀问题属于 `main-release-packages`（发布包），不是 `control-bundles`（控制包，每个只有 35 个 .mjs 文件，体积小）。

## 5. 从历次升级反推（最有力的证据）

`[实测]` `control-upgrades\` 下 37 个 UUID 目录。按 mtime 最新的两个，以及一个关键异常：

### 现役这一代：b8e60296（已采用）

`[实测]` `CONTROL-INSTALLATION.json` 的 `installId` 正是 `b8e60296-81a9-4928-b254-4e07241e754e`，`adoptedAt` = `2026-10-29T08:44:34.828Z`。

该目录含 **7 个文件**：`INTENT.json`、`PREPARED.json`、`RETIREMENT-OLD-CONFIG.json`、`CONTROL-OLD-CONFIG.json`、`CONTROL-OLD-INSTALLATION.json`、`PREPARED-ARTIFACT-LOSS.json`、`TRANSITION-e1a4adef-….json`。

**它没有 `bundle/`、`CONFIG.json`、`HOOK`、`BRIDGE-HOOK`、`SHIM.mjs`** —— 这证实了 §2 的读法：`control-upgrades\<installId>\` 是**采用时按 `:283` 的白名单复制出来的留档副本**，不是 `--out`。

`[实测]` 它的 `INTENT.json` 关键字段：

| 字段 | 值 |
| --- | --- |
| `bundleSha256` | `e664af36…`（与现役一致） |
| `bundleManifestSha256` | `ab6d0a22…` |
| `dispatcherSha256` | `6c88c513…` |
| `configSha256` | `a461db4d…` |
| `old.dispatcher` | **`6c88c513…`（与新值相同）** |
| `old.installation` | `24e0fa94…` |
| `preparedAt` | `2026-10-29T08:41:43.852Z` |

`[实测]` **`old.dispatcher` 等于 `dispatcherSha256`** —— 这是真实历史对 §3 结论的直接印证：上一次换代时 shim 字节也没变。

`[实测]` 时间差：`preparedAt` 08:41:43 → `adoptedAt` 08:44:34，**约 2 分 51 秒**。即准备与采用是前后脚两步，采用本身耗时不长（含那个「连续 3 轮进程快照为空」的等待）。

### 一个留存的 --out：9817efdb（证明命名自由且两类目录并存）

`[实测]` `control-upgrades\9817efdb-8197-4502-b337-dbc04ccd2a16\` 含 **7 个条目，且含 `bundle/`、`CONFIG.json`、`HOOK`、`BRIDGE-HOOK`、`SHIM.mjs`** —— 这是一个**残留的 `--out` 目录**，当时有人把 `--out` 直接指到了 `control-upgrades\` 下面。

`[实测]` 决定性细节：它的目录名是 `9817efdb-…`，而其 `INTENT.json` 里的 `installId` 是 **`ade68625-9378-4358-b31f-e2139c5953e2`**（另一个 UUID，且 `control-upgrades\` 下确实另有一个 `ade68625-…` 目录，含 3 个文件）。`PREPARED.json` 的 `adoptionPerformed` 为 `false`。其 `bundleSha256` = `83e4158f…`，`[实测]` 该包目录在 `control-bundles\` 下**存在**（说明那次采用成功过）。

这证明三件事：
1. **`--out` 的目录名与 `installId` 无关**，可以随意命名（代码里确实没有约定）；
2. `--out` 与 `control-upgrades\<installId>\` 是**两个不同的目录**，采用后并存；
3. `--out` 可以留存，不会被流程清理 —— 所以**它是回退材料的潜在来源**（§6）。

`[推断，中等不确定]` 其余 35 个目录多为留档副本（文件数 3–6，不含 `bundle/`）；我只逐个数了文件数与 extras 数，**未**逐个读其 INTENT 内容。

## 6. 失败与回退

### 准备中途失败留下什么

`[实测]` `--out` 已被 `:113` 以 `recursive:false` 建出，其中可能已有部分文件（各 `*-OLD-*.json`、`bundle/tools/` 的一部分）。所有写入都用 `{flag:'wx'}`（`:114-118`、`:138`）或 `durableCreate`，**不覆盖已有文件**。

`[推断，不确定度低]` 因此重试准备**不能复用同一个 `--out`**：要么 `mkdir` 直接 `EEXIST`，要么内部 `wx` 写入撞上残留文件。**换一个新 `--out` 重跑即可**，旧的失败目录留着当证据。准备阶段不改现役状态，所以失败无后果。

### 采用中途失败留下什么；--resume 是否为此而设

`[实测]` **是。** `--resume` 正是为「采用中断」设计的（§2 已详述语义）。失败点决定残留：

| 失败发生在 | 现役残留 | 恢复 |
| --- | --- | --- |
| 读材料段（`:272` 前）或三把锁未取到 | 无任何改动 | 直接重跑（不必 `--resume`） |
| S1 之后（hook 已换） | hook 为 bridge-hook | `--resume`（`:292` 允许 hook 为 bridge 或新值） |
| S2 之后（shim 已换） | shim 为新值 | `--resume` |
| S3 之后（安装记录为 `installing`） | **安装记录处于中间态** | **必须 `--resume`**；`:276-279` 要求那条记录的 `installId`/`intentSha256` 与同一份材料一致 |
| 进程等待超时（`:297`） | 写一份 `teruisi-main-control-blocked-v2` | 等相关进程退出后 `--resume` 重跑 |

`[实测]` 锁在 `finally`（`:322`）里释放，所以失败不会留下悬挂的管道锁。

### 采用失败后现役控制包还可用吗

`[推断，中等不确定度]` 分两种：

- 失败在 S3 之前：现役 `CONTROL-INSTALLATION.json` 仍是旧的 `adopted` 记录，`bundleRoot` 仍指旧包，**旧包仍可用**。但若已过 S2，shim 已被换成新的 —— `[实测]` shim 字节本次不变（`dispatcherSha256` 相同），所以这一步实际无差别；`[推断]` 若将来 shim 确实会变，这里会出现「shim 指新、安装记录指旧」的错配，由 `readAdoptedControl:64` 的 `Fixed control gate changed` 断言拦住。
- 失败在 S3 之后：安装记录是 `installing`，`[实测]` `readAdoptedControl:37` 断言 `state.status==='adopted'`，否则报 `Control upgrade incomplete; preparation/deployment refused` —— **此时发布器与准备都被拒，必须用 `--resume` 把采用做完**（或用旧材料反向采用，但§4 说了那需要旧 `--out`）。

**这是本次调查里最该让用户知道的风险**：采用一旦进到 S3 而中断，系统会处于「发布被拒」的状态，唯一出路是把采用做完。

### 有没有「采用了新包但发布器跑不起来」的风险

`[实测]` **有，而且前置挡不住它** —— 挡它的是 §3 那条「必须从 shim 运行」：

- 采用成功后，`CONTROL-INSTALLATION.json` 指向新包。此时**从旧包或工作区直接跑发布器会被 `main-control-dispatch.mjs:42` 拒绝**（`Control generation changed; old consumer refused`）。这不是故障，是设计意图。
- 真正能挡「新包本身坏了」的前置是 `readMaterials:163`（逐个核 bundle 成员字节）与 `:305`/`:313` 采用期间的复核：`:313` 在写 `adopted` 之前再核一遍 `intent.dispatcher`/`hook`/`configFile` 与全部 bundle 成员的实际摘要。
- `[实测]` 还有一道：`:314` 的 `assertHooksPolicy(...)` 与 `:315` 的 `installPreparationTask(...)` —— 计划任务安装失败会使采用失败，不会留下「已采用但任务没装」的状态。
- `[实测]` 但**没有**任何前置会实际「跑一次发布器 `--check`」来验证新包可用。所以「新包字节完整但运行时报错」这一类风险**只能靠采用后的核验发现**，这就是 §3 那条只读 `--control-status` 加后续 `--check` 的意义。

## 7. 执行清单

**授权判定**：

| 步骤 | 是否需要用户单独授权 | 理由 |
| --- | --- | --- |
| 第 1 步 准备 | **不需要生产授权，但需用户同意跑它** | `[实测]` 纯产出候选，所有写入都在 `--out` 内，不改现役状态（§1 三条依据） |
| 第 2 步 采用 | **必须单独授权** | `[实测]` 改写 hook、shim、安装记录、计划任务、三个 BAT，且无回退路径（§2、§6） |
| 第 3 步 核验 | 不需要 | 只读 |

### 顺序

**第 0 步（先做，免白跑）**：现算目标摘要与前置自检。

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('tools/publish-latest-main.mjs')).digest('hex'))"
git status --porcelain
```

验证：工作区必须**干净**（`:91` 的 `Control source must be frozen and clean`）；并用 §0.2 的算法现算 `bundleSha256` 记下来备核。
失败怎么办：工作区不干净就先提交；不要为跑这一步而 stash（本 worktree 与别处共享 stash 栈）。

**第 1 步 准备**：

```bash
node tools/install-main-prebuild.mjs --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json" --out "D:\codex-artifacts\control-upgrade-20261031-83831638"
```

验证：输出应为 `{"status":"bundle-prepared","directory":…,"installId":…,"intentSha256":…,"bundleManifestSha256":…,"adoptionPerformed":false}`；再核 `<out>\bundle\MANIFEST.json` 的 `bundleSha256` 等于第 0 步现算值，且 `<out>\bundle\tools\` 恰有 35 个文件。
失败怎么办：**换一个新 `--out` 重跑**（§6：同目录不可复用）。若报 `Preparation task is not the exact owned predecessor`，说明现役计划任务被手改过，停下来查，不要绕。

**第 2 步 采用（需单独授权）**：先确认没有发布器/准备/维护进程在跑，否则会等 30 秒后超时失败。

```bash
node tools/install-main-prebuild.mjs --adopt "D:\codex-artifacts\control-upgrade-20261031-83831638"
```

验证：输出应为 `{"status":"adopted","installId":…,"bundleSha256":<第0步的值>,"adoptionPerformed":true,"productionDeploymentPerformed":false}`。
失败怎么办：按 §6 的表定位失败点。**若已过 S3（安装记录变成 `installing`），必须用 `--resume` 把它做完**，否则发布器与准备都会被拒。

**第 3 步 核验（只读）**：

```bash
node tools/main-control-dispatch.mjs --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json" --control-status
```

验证：`status` 为 `adopted`、`installId` 为第 2 步返回的那个。然后读 `CONTROL-INSTALLATION.json` 逐项核：`bundleSha256` = 第 0 步现算值；`dispatcherSha256` **仍为** `6c88c513…`；`preparationTask.hostSha256`/`nodeSha256` 未变。
**若 `dispatcherSha256` 变了，说明动到了不该动的东西（`main-control-dispatch.mjs` 或状态目录布局），停下来查。**

**第 4 步 确认发布器仍可用（只读，走 shim）**：

```bash
node "D:\codex-isolated\main-manual-release-20261016\control\tools\publish-latest-main.mjs" --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json" --check
```

验证：不应出现 `Control generation changed; old consumer refused`。`[推断]` `--check` 仍会在来源断言处失败（那正是 adopt 入口要解的问题，本轮未合并，所以现役发布器里**没有** `--adopt-live`）——**这个失败是预期的，不代表重建失败**。
失败怎么办：若报 `Control upgrade incomplete`，回到第 2 步用 `--resume`。

### 本节未验证的部分

- **以上命令我一条都没有执行过。** 行号与断言是读码所得，参数形状由 `:324` 的 `parseArgs` 实测确认，但「真跑一次是什么输出」未验证。
- `--config` 应指无后缀那个文件，是 `[推断]`（依据充分）；**我未实算该文件 sha256 去对 `a461db4d…`**，执行前应先核。
- 第 4 步 `--check` 的预期失败形态是 `[推断]`，未实跑。
- 旧包删除与否的保留要求，代码层面**未查到**明文规定；§4 的「不要删」是据两条读取依赖推断。
