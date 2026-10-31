# 合并前重新资格化范围调查（2026-10-31）

**本轮只读调查，未改任何文件、未碰生产。** 结论分 `[实测]` 与 `[推断]`；查不到的写「未查到」。

起点 `[实测]`：`tools/publish-latest-main.mjs` 摘要 `b27c76018d8f36023d07b831bda560ad446c177638858039d99a5737b8412e8b` → `17a9799fba21fe925a7ad6167cf09994bcb9cbd8b0653933333be5f60d4f60a3`。

## 摘要：我上一份报告有三处错，先列出来

调查推翻了我在 REPORT.md §4 写的内容，必须先更正：

| 我原来写的 | 实测结论 |
| --- | --- |
| 需要更新 `CONTROL-INSTALLATION.json` 的 `dispatcherSha256` | **错。** 它不变，详见 §2 |
| 「三项」pin | **不全。** 实际是 2 处源文件 + 1 份控制包重建；另有 1 条我漏掉的测试绊线 |
| 两条既有失败与我无关（共 2 条红） | **不全。** 我的改动**自己弄红了第 3 条**（`manual-preparation-recovery.test.mjs`），上一份报告漏报，详见 §4 |

另外更正姐妹会话的一处前提：`publish-latest-main.mjs` **在** `controlFiles` 里。

`[实测]`：
```
node -e "import {controlFiles} from './tools/install-main-prebuild.mjs'" →
controlFiles.length = 35
controlFiles.includes('publish-latest-main.mjs') = true
controlFiles.indexOf('publish-latest-main.mjs') = 2
```
见 `tools/install-main-prebuild.mjs:21`（它是数组第 3 个成员）。所以「它走冻结包不走控制包」不成立——**两边都走**：控制包收录它的字节，冻结发布包另有一份。这一条直接决定 §2 和 §5 的答案。

## 1. 十五个引用点逐个判定

判定口径：**按文件名引用**＝只用路径或 import，不校验内容，改字节无影响；**按摘要钉住**＝有 `sha(...)===` 形式的比对，必须同步。

| # | 位置 | 性质 | 判定 |
| --- | --- | --- | --- |
| 1 | `tools/install-main-prebuild.mjs:9` | `import {publisherEnvironment}` | 文件名 |
| 2 | `tools/install-main-prebuild.mjs:21` | `controlFiles` 成员（数组里是文件名字符串） | **间接钉住** —— 名字本身不校验内容，但 `:120` 会读它的字节算进 `files`，进而决定 `bundleSha256`。见 §5 |
| 3 | `tools/install-main-prebuild.mjs:123` | `dispatcher` 路径拼接 | 文件名 |
| 4 | `tools/install-main-prebuild.mjs:191` | 断言 `intent.dispatcher` 的**路径**相等 | 文件名（比路径，不比字节） |
| 5 | `tools/install-manual-startup-reconcile.mjs:29` | 动态 `import` | 文件名 |
| 6 | `tools/main-control-dispatch.mjs:64` | `sha(stable(control/tools/publish-latest-main.mjs))===state.dispatcherSha256` | **钉住，但钉的不是本文件** —— 那个路径上的文件是 shim，不是仓库里的 publisher。见 §2 |
| 7 | `tools/main-control-dispatch.mjs:94` | 从 `bundleRoot` 动态 `import` | 文件名（但读的是控制包内副本，§5） |
| 8 | `tools/main-prebuild-hook.mjs:7` | 静态 `import` 三个符号 | 文件名 |
| 9 | `tools/main-prebuild-task.mjs:23` | `dispatcher` 路径拼接 | 文件名 |
| 10 | `tools/pi150-forward-recovery.mjs:8` | `import {publisherEnvironment}` | 文件名 |
| 11 | `tools/preparation-resolution.mjs:366` | 钉 `CONTROL-INSTALLATION.json` 的 `stateSha256` | **间接**：不钉本文件，但钉安装状态整体（§2 决定它是否变） |
| 12 | `tools/preparation-retirement-entry.mjs:75` | `latest.sha256===currentLatest \|\| in previousCurrentLatest \|\| in latest[]` | **钉住本文件字节** —— 必须同步，§3 |
| 13 | `tools/preparation-retirement.mjs:62` | `captureRetirementControl` 收 `CONTROL-INSTALLATION.json` | 间接，同 #11 |
| 14 | `tools/publish-main-status.mjs:11` | `import` 两个符号 | 文件名 |
| 15 | `tools/publish-main-tail.mjs:34,40` / `publish-main.mjs:195,201` | 注释 + 动态 `import('./publish-latest-main.mjs')` | 文件名（刻意用动态 import 以免扩大闭包） |
| 16 | `tools/verify-release-candidate.mjs:14,88,133,146,150,151` | import + profile 清单（字符串路径） | 文件名，§6 |
| 17 | `tools/verify-release-candidate.mjs:445-446` | `git show <base>:tools/publish-latest-main.mjs` 后比对**结构** | **条件性**：仅 `--reuse-report` 时生效，本次不触发，§6 |
| 18 | `tools/codex-isolated-task-retention.mjs:23`、`release-package-retention.mjs:4` | 纯注释 | 无影响 |

**进清单的只有两处源文件**：`preparation-retirement-entry.mjs:69-70`（§3）和 `install-main-prebuild.mjs:21` 引发的控制包重建（§5）。其余 13 处都是按文件名引用，改字节无影响。

## 2. `CONTROL-INSTALLATION.json` 八个摘要：只有两个会变

`[实测]` 逐字段定性（源头见 `install-main-prebuild.mjs:140`、`:318`）：

| 字段 | 源头 | 因本次改动而变？ |
| --- | --- | --- |
| `bundleSha256` | `:121` `sha(canonical(files))`，`files` 含全部 35 个 `controlFiles` 的字节摘要 | **会变** |
| `bundleManifestSha256` | `:123` `MANIFEST.json`（内含 `files` 与 `bundleSha256`） | **会变** |
| `dispatcherSha256` | `:140` `sha(shim)`，shim 由 `main-control-dispatch.mjs` 模板替换一行常量生成（`:137`） | **不变** |
| `hookSha256` | `:140` `sha(finalHook)`，hook 内容是 `main-prebuild-hook.mjs` 的路径 | 不变 |
| `configSha256` | `:140` `sha(configNew)`，发布器配置 JSON | 不变 |
| `intentSha256` | `:143` 整份 `INTENT.json`（内含 `bundleSha256`、`bundleManifestSha256`） | **会变**（随上面两个） |
| `preparationTask.hostSha256` | `main-prebuild-task.mjs:30` PowerShell 宿主 exe 的字节 | 不变 |
| `preparationTask.nodeSha256` | 同上，`process.execPath` 的字节 | 不变 |

### `dispatcherSha256` 为什么不变（这是我上一份报告的错）

`[实测]` 我按 `:137` 的算法在本机复算了 shim：

```
recomputed dispatcherSha256: 6c88c5131c850beb73bd8685e429bd5d543d582acc6bf61df3aa24fb446c52a4
installed  dispatcherSha256: 6c88c5131c850beb73bd8685e429bd5d543d582acc6bf61df3aa24fb446c52a4  → 相等
```

关键是 `D:\codex-isolated\main-manual-release-20261016\control\tools\publish-latest-main.mjs` 这个路径上的文件**不是**仓库里的 publisher，而是那个 shim：

`[实测]` 它的 sha256 = `6c88c513…`（正是 `dispatcherSha256`），11059 字节，内容含 `legacyBridge`。

shim 由 `main-control-dispatch.mjs`（本次未改）替换 `const legacyBridge = null;` 一行生成，嵌入的只有三个**固定路径**（`fixedCli`、`oldHook`、`configFile`），不含任何 bundle 摘要。所以只要不改 `main-control-dispatch.mjs`、不改 stateDirectory 布局，`dispatcherSha256` 就不变。

因此 `main-control-dispatch.mjs:64` 那条断言（#6）**不会**因本次改动失配——它校验的是 shim，不是我改的文件。

### `intentSha256` 的连带关系 `[推断，依据 :140 的字段构成]`

`INTENT.json` 的字段里含 `bundleSha256` 与 `bundleManifestSha256`，二者既变，整份 intent 的摘要必变。它由安装流程在重建时自动产生，**不需要手工填**；列出来是因为 `preparation-resolution.mjs:366` 与 `preparation-retirement.mjs:62` 会钉 `CONTROL-INSTALLATION.json` 整体，重建后那些历史证据的绑定也随之换代（不是要改历史记录，而是新一代安装产生新的绑定）。

## 3. `retirementEntryPolicies` 的 current/previous 机制

姐妹会话说的机制 `[实测]` **成立**。

`tools/preparation-retirement-entry.mjs:75` 的放行条件是三者 OR：

```js
assert.ok(retirementEntryPolicies.latest.includes(latest.sha256)
  || (latest.sha256===retirementEntryPolicies.currentLatest
      || retirementEntryPolicies.previousCurrentLatest.includes(latest.sha256)),
  'Unqualified latest-main source entry: '+tools);
```

`[实测]` 当前容量与内容：

| 项 | 值 |
| --- | --- |
| `latest[]` | 14 条（历史数组） |
| `previousCurrentLatest[]` | 4 条 |
| `currentLatest` | `b27c76018d8f…`（单值字符串，非数组） |
| 对象 | `Object.isFrozen(...) === true`（`:8` 的 `Object.freeze`） |
| `b27c7601` 是否已在 `latest[]` 或 `previousCurrentLatest[]` | **都不在**（只作为 `currentLatest` 存在） |

**容量上限**：`[实测]` 这三个集合本身**未查到任何长度断言**。`grep` 只找到 `:22` 对退役登记目录的 `names.length<=128`、`:73` 的 `unique.length<=1024`、`:74` 的 `members.length<=2048` 与 16 MiB 字节预算——都不约束这三个数组。所以追加一条不触上限。

### 正确做法：挪而不是替换 —— 确认

`[实测]` 除 `:75` 的放行外，`:80` 还据同一组集合给出分类标签：

```js
latestPolicy: (latest.sha256===currentLatest || previousCurrentLatest.includes(latest.sha256))
  ? 'current-retirement-admission-and-native-ref-before-checkout'
  : 'native-manual-main-ref-before-checkout'
```

即 `currentLatest` 与 `previousCurrentLatest` 在**放行**和**分类**两处都等价，而 `latest[]` 只能放行、分类会降级成 `native-manual-main-ref-before-checkout`。

所以：
- **把 `b27c7601` 挪进 `previousCurrentLatest`、`currentLatest` 改成 `17a9799f`** —— 回退到旧字节时仍放行**且**保持同一分类标签。
- **直接替换**（丢掉 `b27c7601`）—— 旧字节既不在 `currentLatest` 也不在两个数组里，`:75` 会直接 `Unqualified latest-main source entry` 拒绝。这正是 `native-controller-requalification` 那条记忆的教训形态。
- **挪进 `latest[]`** —— 能放行，但分类降级，与 `previousCurrentInstaller`/`previousCurrentLatest` 既有用法不一致，不建议。

`[实测]` 既有先例印证：`previousCurrentInstaller` 有 2 条、`previousCurrentLatest` 有 4 条，说明历次换代都是「挪」而非「替换」。

## 4. 测试绊线：有一条，而且我的改动已经把它弄红了

`[实测]` 全仓只有一处断言本文件的实际摘要：

**`tests/manual-preparation-recovery.test.mjs:83`**（用例名 `R1b current pins bind exact final source bytes and preserve historical pins`）：

```js
assert.equal(sha(await fs.readFile(new URL('../tools/publish-latest-main.mjs',import.meta.url))),
             retirementEntryPolicies.currentLatest);
assert.equal(sha(await fs.readFile(new URL('../tools/install-main-prebuild.mjs',import.meta.url))),
             retirementEntryPolicies.currentInstaller);
assert.ok(retirementEntryPolicies.previousCurrentLatest.includes('1fa234d5…'));
assert.ok(retirementEntryPolicies.previousCurrentInstaller.includes('a0865630…'));
```

`[实测]` 当前实跑它是**红的，原因就是我的改动**：

```
✖ R1b current pins bind exact final source bytes and preserve historical pins
  AssertionError: Expected values to be strictly equal:
  + actual   '17a9799fba21fe925a7ad6167cf09994bcb9cbd8b0653933333be5f60d4f60a3'
  - expected 'b27c76018d8f36023d07b831bda560ad446c177638858039d99a5737b8412e8b'
  at tests\manual-preparation-recovery.test.mjs:83:9
EXITCODE=1
```

**这是我上一份报告的漏报**：我当时只跑了 4 个发布器套件 + 2 个控制套件，没跑到这个文件，所以报告里写的「两条既有失败都与我无关」漏了这第三条——它**与我有关**，是我造成的。

### 绊线语义必须保留

这条用例是**故意的字节绊线**：前两行钉「当前 pin 必须等于当前源码字节」，后两行钉「历史 pin 不许被删」。它的设计意图是「改了 publisher 而不登记就失败」。

所以更新时：
- **只改 `retirementEntryPolicies` 的数据**（`preparation-retirement-entry.mjs:69-70`），让 `currentLatest` 变成新摘要、旧值进 `previousCurrentLatest`；
- **不要改这个测试**去自动跟随文件（例如把右侧换成现算的 sha），那样绊线就失效了；
- 后两行的历史 pin 断言（`1fa234d5…`、`a0865630…`）必须继续成立 —— 按 §3 的「挪」法不会破坏它们。

`[实测]` 另需注意：`currentInstaller` 的断言钉的是 `install-main-prebuild.mjs`。本次**没有改**那个文件，所以那一行保持绿；但若后续为重建控制包而修改它，这一行也要同步登记。

## 5. 控制包要不要重建：要，因果是 `controlFiles` 成员

这一节直接回答姐妹会话的疑问「它不在 `controlFiles` 里为什么要重建」——前提有误，它**在**里面（`install-main-prebuild.mjs:21`，第 3 个成员，共 35 个）。

`[实测]` 机制与行号：

```js
// install-main-prebuild.mjs:120
for(const name of controlFiles){ const raw=await bytes(path.join(sourceRoot,'tools',name));
  files['tools/'+name]=sha(raw); await fs.writeFile(path.join(out,'bundle/tools',name),raw,{flag:'wx'}); }
// :121
const bundleSha256=sha(Buffer.from(canonical(files))),
      bundleRoot=path.join(config.stateDirectory,'control-bundles',bundleSha256);
```

即每个成员的字节摘要都进 `files`，`bundleSha256` 是 `files` 的规范化摘要，**且它同时是控制包目录名**。所以改本文件必然产生一个新的 `control-bundles\<新摘要>\` 目录。

`[实测]` 复算验证（用 `controlFiles` + `canonical` 原样重算）：

| 基线 | `bundleSha256` |
| --- | --- |
| `refs/remotes/origin/main`（`89429877`） | `e664af36f9aed179875fb1bf66447321d4f906ff1734bdeb2e38514b92842a8e` |
| `5a0910d3`（我开工时的基线） | `e664af36…`（同上） |
| 我的分支 `HEAD`（`350b3245`） | **`134bf8ed0061da3ac1fa36dab220d28ee64a7e05c4cb892518437662f3b852a0`** |

现役已采用的是 `e664af36…`（`CONTROL-INSTALLATION.json` 的 `bundleSha256`／`bundleRoot`）。`origin/main` 与它**仍相等**，说明这个变化**完全由我的改动造成**，不含别人的在途改动。

另两条相关断言 `[实测]`：
- `main-control-dispatch.mjs:55`：`readdir(bundleRoot/tools)` 的成员集合必须等于 `manifest.files` 的成员名 —— 成员名没变（我没加删文件），这条不受影响。
- `main-control-dispatch.mjs:56`：逐个 `sha(stable(bundleRoot/tools/<name>))===manifest.files[name]` —— 新控制包内的副本与新 manifest 自洽即可。
- `main-control-dispatch.mjs:42`：`expectedBundle` 与 `bundleRoot` 必须一致，否则 `Control generation changed; old consumer refused`。所以**新旧控制包不能混用**，重建后旧绑定一律拒绝（这是设计意图）。

**不是** `readHandoffSourceClosure` 那种递归闭包把它吸进去的 —— `[实测]` 未查到该函数名；真实机制就是上面这条显式的 `controlFiles` 成员枚举。

### 重建需要什么（只读调查结论，未执行）

`[实测]` `install-main-prebuild.mjs` 的流程是两段式：`:143-145` 先 `bundle-prepared`（写 `INTENT.json`／`PREPARED.json`，`adoptionPerformed:false`），`:272` 起才 `adoptControlUpgrade` 真正采用。`:104` 有 `assert.deepEqual(config,updateOnlyConfig,'Exact update cannot change other publisher configuration')`，即重建不得顺带改配置。

`[推断]` 因此重建是「准备新控制包 → 采用」两步，各自要独立授权（采用会改变现役控制代际）。具体命令行与前置我**未查**（本轮只读、且不该在无授权时演练），列为执行阶段的待查项。

## 6. `verify-release-candidate.mjs` 的加倍门，与那两条既有失败的归因

### 6.1 加倍门：不触发

`[实测]` 全文只有三处「必须有专用资格」式的断言，全部是 schema 专用：

| 行号 | 条件 |
| --- | --- |
| `:429` | 要求 `baseCommit==='a7041338…'` 且 `profile.schemaAdmissionOnly===true`（历史限定） |
| `:437` | `if(profile.schemaAdmissionOnly) assert.ok(schemaAdmissionOnly, …)` |
| `:438` | 改了 `main-schema-release.mjs`／`schema-rejection-observer.mjs`／`schema-rejection-writer.mjs` 三者之一时，必须 `schemaAdmissionOnly===true` |

三条都**不点名** `publish-latest-main.mjs`。`[实测]` 用我的真实改动集调 `candidateCompatibilityProfile`：

```
version          release-three-optimizations-v1
paths            ["tools/publish-latest-main.mjs"]
unsupported      []
preparationQueue true   publication true
schemaAdmissionOnly false   releaseChainPreflight false
```

`unsupported` 为空（因为 `:88` 的 `supported` 集合含本文件），`:83` 会把 `docs/`、`tests/` 过滤掉，所以**新测试无需注册进任何 profile**。

`[实测]` `:442` 那条限定增量断言（要求改动集只含 `main-prebuild-queue.mjs`／`publish-latest-main.mjs`／`verify-release-candidate.mjs`，并用 `compareFixedPreparationAdmissionChange` 比对结构）**只在传 `--reuse-report` 时**进入（`:440` 的 `if(reuseReport)`），且要求 `baseCommit==='aaca1848…'`。本次不传该参数，不触发。

`[推断]` 因 `publication:true`，`:600` 那一大段发布类测试会被选入执行；该套件内含哪些文件我列在 §7 的验证步骤里，但**我没有实跑整个 verifier**（它会建 worktree、跑几十分钟），列为未验证项。

### 6.2 两条既有失败的归因：与资格化机制无关

**`tests/preparation-retirement-entry.test.mjs`** —— 用例 `adopted and current R1b gates both discover an ancestor worktree HEAD for the original uninitialized fixture`。

`[实测]` 失败是 `ownSource.kind` 实际为 `native-no-git-source`、期望 `own-root-head-before-preparation`。根因在 `preparation-retirement-entry.mjs:78`：它对夹具目录跑 `git rev-parse --verify HEAD`，失败（code 128）就记 `native-no-git-source`。而夹具把源码放在 `os.tmpdir()` 下，`[实测]` `C:\Users\86137\AppData\Local\Temp` **不是** git 仓库（`fatal: not a git repository`）。用例名里的 `uninitialized-source` 也印证它刻意不 `git init`。

所以这是**夹具与环境的交互问题**（期望那棵树能从某个父目录继承到 HEAD，而本机 tmpdir 继承不到），**与 `retirementEntryPolicies` 的资格化数据无关**。`[实测]` 把 `publish-latest-main.mjs` 还原到 HEAD 后复跑，同样失败。重新资格化时**不需要**连带处理。

**`tests/main-control-upgrade.test.mjs`** —— 用例 `adopted real Git hook and manual CLI share only v2 tickets; failed fetch cannot reach native preparation`。

`[实测]` 失败是 `ENOENT: scandir …\state\prebuild-queue-v2\tickets`，发生在 `:174` 的 `readdir(queue/tickets)`。`:173` 之前有一个最多 400×25ms（10 秒）的轮询等 `results` 出现；`tickets` 目录要等真实 Git hook 触发排队才会建。`[实测]` 还原到 HEAD 后同样失败（同用例、同错误、仅临时目录名不同）。

`[推断]` 这是时序／环境依赖（hook 未在窗口内产生 ticket），**与资格化无关**；但它确实落在「重建控制包」要动的区域，所以重建后应复跑它以区分「原有环境问题」与「新引入问题」——**不要**把它当作重建成功的判据。

两条我都**没有修**，仍红着。归属与修复责任未定。

## 7. 执行顺序（获授权后执行；本轮未执行）

前提：合并授权与控制包采用授权是**两件**独立的事（AGENTS.md 第 4 条）。下面第 1–2 步属合并前的源码登记，第 4 步起才涉及现役控制代际。

| # | 动作 | 文件:字段 | 之后用什么验证 |
| --- | --- | --- | --- |
| 1 | 把 `b27c7601…` 追加进 `previousCurrentLatest`，`currentLatest` 改为 `17a9799f…` | `tools/preparation-retirement-entry.mjs:69-70` | `node --test tests/manual-preparation-recovery.test.mjs > out.txt 2>&1; echo $?` —— R1b 用例须转绿（这一条同时验证了绊线仍在） |
| 2 | 复跑受影响的既有套件，确认没新增红 | — | `node --test tests/publish-latest-main.test.mjs tests/main-publication-readiness.test.mjs tests/preparation-superseded-resolution.test.mjs tests/pi150-forward-recovery.test.mjs tests/publisher-adopt-live.test.mjs > out.txt 2>&1; echo $?` —— 期望 109/109 |
| 3 | 核 profile 仍无 `unsupported` | — | 用 §6.1 的 `candidateCompatibilityProfile` 复算，期望 `unsupported=[]` |
| 4 | **（另需授权）** 准备新控制包 | `install-main-prebuild.mjs` 的 prepare 段（`:143-145`） | 复算 `bundleSha256` 应得 `134bf8ed…`；检查 `control-bundles\134bf8ed…\tools\` 共 35 个成员 |
| 5 | **（另需授权）** 采用新控制包 | `CONTROL-INSTALLATION.json` 的 `bundleSha256`／`bundleRoot`／`bundleManifestSha256`／`intentSha256` 由流程自动写 | 读回 `CONTROL-INSTALLATION.json` 核 `status==='adopted'`；`dispatcherSha256` 应**仍为** `6c88c513…`（若它变了说明动到了不该动的东西） |
| 6 | 重建后复跑控制类套件，区分既有问题与新问题 | — | `node --test tests/main-control-upgrade.test.mjs tests/control-dependency-update.test.mjs > out.txt 2>&1; echo $?` —— §6.2 那条 `ENOENT` 预期**仍红**（既有），不得据此判定重建失败 |

**不需要做的**（本轮调查排除）：改 `dispatcherSha256`、改 `hookSha256`、改 `configSha256`、改 `preparationTask.hostSha256`／`nodeSha256`、改那条绊线测试本身、把新测试注册进 verifier profile、为 `:442` 的限定增量做任何事。

### 测量纪律

所有命令都按「重定向到文件再读退出码」执行（`cmd | tail` 会返回管道退出码，把失败显示成 exit 0）。

### 本节未验证的部分

- 第 4、5 步的**具体命令行与前置**未查（本轮只读，且无授权不演练）。`[实测]` 已知的只是流程为两段式、`:104` 禁止顺带改配置。
- `verify-release-candidate.mjs` 整体未实跑（会建 worktree、耗时长）。`:600` 段实际会跑哪些测试、是否全绿，未验证。
- 重建控制包后 `preparation-resolution.mjs:366`／`preparation-retirement.mjs:62` 所钉的历史证据绑定如何换代，只做了 `[推断]`，未实跑验证。
