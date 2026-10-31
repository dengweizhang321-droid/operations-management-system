# 发布器 `--adopt-live` 入口设计（2026-10-31）

状态：**设计稿，等用户确认后才写实现。** 本阶段未改任何现有代码文件。

本文档的路径约定与 `docs/规范/` 一致：反引号中的代码/工具路径相对仓库根目录；`D:\` 开头的是本机绝对路径。

## 0. 本轮只读勘察改变了任务前提（先看这一节）

上一轮普查说「现役 `sourceRoot` 不是冻结发布包」。本轮实测确认了这一点，但同时发现一个**更强的事实**：

现役的前后台**不是同一个提交**。

| 面 | 身份 | 来源路径 | 提交 |
| --- | --- | --- | --- |
| Worker（前端） | head `20261030T013752Z-91459570a711f22e`，manifest `bfdd5573…` | `D:\codex-isolated\main-release-packages\e62dc33a8a05-bfb340f8-7948e85c\source`（**是**冻结发布包，干净，HEAD = `e62dc33a`） | `e62dc33a8a05059d…` |
| Django（后台） | `deployment.json` 摘要 `e0fc1a0d…` | `D:\codex-isolated
etshop-projection-total-20261030\source`（交付树 `.git/worktrees/source6`，干净） | `2dc377f0d26319f…` |

### 0.1 两者的关系是祖先，不是分叉（修正）

`git merge-base e62dc33a 2dc377f0` = `e62dc33a` **本身**。所以这不是分叉，是一条线上的两个点，Worker 落后 6 个提交。本文件初稿用了「共同祖先」的说法，**那个说法是错的**，已全文改为「Worker 侧落后于 Django 侧」。（由 [发布体系解耦与统一](#local_bcfa94f2-5637-4687-9db7-1938f14306e5) 会话指出，已独立复核。）

### 0.2 那 6 个提交里有没有 Worker 载荷（修正，但结论要分两层）

初稿说「有 Worker 载荷」，依据是 `release-scope-plan` 返回 `components:['worker','django']`。**那个依据是错的**，实测：

- `git diff --name-only e62dc33a..2dc377f0 -- app/ lib/ components/` → **空**。
- 全部 9 个改动文件按顶层目录：`backend/` 3、`tests/` 3、`tools/` 2、`docs/` 1。

`components` 里的 `worker` 来自 `classifyRelease`（`tools/release-scope-plan.mjs:35`）的这条规则：

```js
if(/^(config\/|tools\/|.*\.(?:ps1|bat|cmd)$)/.test(value)){
  state.worker=true;state.django=true;state.persistence=true;state.full=true; … }
```

即 `tools/` 下的改动**无条件**同时置 `worker` 和 `django`，是**保守升级**，不是检测到前端产物变化。所以「前端 dist 有待发布内容」这个推论不成立。

**但「Worker 侧没有待发布内容」这个更强的说法也不成立。** 继续实测：Worker 的 immutable release 把整棵源码树快照进 `source-snapshot/`，那 2 个 `tools/` 文件**确实装在现役 Worker 包里**，且装的是**旧字节**：

| 文件 | 现役 Worker 包内 | `e62dc33a` | `2dc377f0` |
| --- | --- | --- | --- |
| `tools/operations-system-watchdog.ps1` | `b40f21a1…` | `b40f21a1…` ✅ 一致 | `106c08cc…` ≠ |
| `tools/postgres_no_key_backup.py` | `dff8e226…` | `dff8e226…` ✅ 一致 | `dd08698f…` ≠ |

所以准确的表述是：**Worker 包内没有待发布的「前端运行载荷」（`app/`、`lib/`、`components/` 全空），但有 2 个随包安装的 `tools/` 文件停在旧字节。** 这正合规范里那条「被应用包收录的离线工具虽无业务载荷，但只能随对应应用包安装，按完整组件流程准备与部署」（`docs/规范/验证与发布.md` 变更分级表），也正是 `classifyRelease` 那条保守规则存在的理由——它在这里是**对的**。

### 0.2b §0.2 的澄清：那 2 个旧字节文件在哪里（两个会话测的是不同位置，结论并不矛盾）

两个会话都没复现 §0.2，因为测的是另两个位置。按要求给出确切路径与实测哈希：

**我指的位置是 Worker immutable release 自己的源码快照**，即 `deployment-manifest.json` 的 `source.snapshotRoot`（实测值为 `source-snapshot`）：

```
A = D:\teruisi-runtime\teruisi-worker-sales\releases\20261030T013752Z-91459570a711f22e\source-snapshot\tools\
B = D:\codex-isolated\main-release-packages\e62dc33a8a05-bfb340f8-7948e85c\source\tools\   (e62dc33a)
C = D:\codex-isolated\netshop-projection-total-20261030\source\tools\                      (2dc377f0)
```

| 文件 | A（现役 Worker 包内） | B（Worker 来源） | C（Django 来源） |
| --- | --- | --- | --- |
| `operations-system-watchdog.ps1` | `b40f21a1…` | `b40f21a1…` 等 A | `106c08cc…` ≠ |
| `postgres_no_key_backup.py` | `dff8e226…` | `dff8e226…` 等 A | `dd08698f…` ≠ |

即 A = B ≠ C：现役 Worker 包内的这两个文件停在 Worker 侧字节。已复测两次，结果一致。

**他们测的位置是 Django app 里安装的 tools**（`D:\teruisi-runtime\django-sales\app\tools\`）与 Worker guard 的仓库根文件清单。我复核了前者，**他们是对的**：

- `postgres_no_key_backup.py`：该处安装的是 `dd08698f…`，**等于 Django 来源**（C），没有旧字节。
- `operations-system-watchdog.ps1`：该处**根本不存在**（ABSENT）——它不在 Django 应用包的复制清单里。

所以两边的结论可以同时成立：**Django app 安装位置没有旧字节残留（他们对），而 Worker 包的源码快照里有（我对）。**

#### 这条事实的实际重量（比我初稿所暗示的小）

我初稿把它当作「Worker 侧有待发布内容」的证据，**这个定位偏重了**。对方已核实：这两个文件**不在** `workerGuardEntrypointPaths` 的 12 项里，Worker guard 钉的仓库根清单也 10/10 一致。所以：

- 它**不影响** Worker 包身份、不影响启动门禁、不构成发布阻塞；
- 它**不进严格前置**——没有为它新增任何一条放行条件；
- 它唯一的作用是作为 `mainCommit` 取 Worker 侧 HEAD 的**佐证**：那 6 个提交里确有随 Worker 包安装的文件尚未更新，取 Worker 侧 HEAD 使它们留在下一次发布范围内。

§0.2 因此**不撕掉**（事实属实），但已按上面的重量重写定位；没有将其写成任何前置条件。

### 0.2c 失配只有 Django 一项（缩小了 adopt 的范围）

另一个会话指出并经我复核：那份真实回执 `…\publish-e62dc33a8a05\SUCCESS.json` **仍在磁盘上**，`PUBLISHED-MAIN.json` 的 `receiptPath` 正指向它，且 `receiptSha256` 校验通过。逐项实测：

| 项 | 回执声明 | 现役实测 | |
| --- | --- | --- | --- |
| `status` | `deployed_and_ready` | — | 满足 `:55` |
| `mainCommit` | `e62dc33a…` | — | 满足 |
| `workerRelease` | `20261030T013752Z-91459570a711f22e` | 同值 | 满足 |
| `workerManifestSha256` | `bfdd5573…` | 同值 | 满足 |
| `djangoManifestSha256` | `27d72aab…` | **`e0fc1a0d…`** | **唯一失配** |
| `startupVerified` / `readyVerified` | `true` / `true` | — | 满足 |

所以 adopt 要做的不是「凭空造一份全新记账」，而是让记账承认**一个**已漂移的值；Worker 侧的记账本来就是闭合的。这不改变任何一条前置（仍要全部满足），但改善了**回执的诚实度**，故实现新增两个字段：

- `adoption.catalogMismatch` —— 三个值逐项记 `{catalog, live, equal}`，让「哪一项真的漂了」可审；
- `adoption.priorReceipt` —— 旧 catalog 指向的那份回执是否存在、字节是否与声明摘要一致（`intact`）、它当时声明了什么。缺失或被改动只作**如实记录**，既不阻塞也不授权。

### 0.3 对 `mainCommit` 取值的影响

据代码定语义（已逐行核）：

- `readLivePublication:44` 的 `source` 取自 **Worker manifest 的 `sourceBinding`**；
- `:46` `commit = gitAt(source,['rev-parse','HEAD'])`；
- `:55` 断言 `receipt.mainCommit === commit`；`:58` 再断言 `gitAt(source,HEAD) === commit`；
- `prepareLatestMainOnce:107` 用 `base: live.mainCommit` 算下一次发布范围。

即**既有代码的 `mainCommit` 语义就是「Worker 来源树的 HEAD」**，不是「整体发布到了哪个提交」。按这个语义，adopt 写 `e62dc33a` 是自洽的，并且附带一个正确的后果：下一次发布的 `base` = `e62dc33a`，那 6 个提交（含上表两个旧字节的 `tools/` 文件）**留在发布范围内，不会漏发**。

**这个取值意味着 catalog 的 `mainCommit` 不代表 Django 侧实际跑的代码——这是既有语义的后果，不是 adopt 引入的。** adopt 的责任是不让这个后果变成隐性的，故：

**新增 `adoption.djangoSourceCommit` 字段如实记录 `2dc377f0`，而不改 `mainCommit` 的含义。** 取舍：改 `mainCommit` 语义会同时影响 `:55`/`:58`/`:107` 三处和 §2.1 表里 6 个回执消费者，且会把下一次发布的 `base` 推到 `2dc377f0` 而漏发那 2 个 `tools/` 文件；加字段零破坏且把分裂写在明面上。（与 [发布体系解耦与统一](#local_bcfa94f2-5637-4687-9db7-1938f14306e5) 的倾向一致。）

## 1. 严格前置清单

入口的放行条件，共 18 项（P1–P18）。每一项都给出：**查什么 / 怎么查 / 不满足时的错误信息**。编号 P\* 在测试里逐项对应一个负向夹具。

实现上这些检查集中在一个纯函数 `assertAdoptableLive(config, live, extra)` 里，入口只调它一次；没有任何一项可以用参数跳过。

### 一组：这次 adopt 确实有必要（否则不该写）

- **P1 catalog 当前确实失配。** 读 `PUBLISHED-MAIN.json`；若它的 `workerRelease` / `workerManifestSha256` / `djangoManifestSha256` 与现役实测**三值同时相等**，则拒绝：`现役与发布记账已一致，无需承认；本次未写入`。
  - 这一条防的是把 adopt 变成一个「随手重写记账」的常规动作。记账一致时它必须是个错误，不是无操作。
- **P2 现役状态可被 `readLivePublication` 之外的独立路径读出。** adopt **不复用** `readLivePublication`（它内含那条会失败的 `:45` 断言）。另写只读的 `observeLiveIdentity(config)`：解析 Worker 链、读 manifest、读 `deployment.json`、读两侧 `sourceRoot`。任一读失败即拒绝，不做任何兜底推定。

### 二组：两侧来源都可追溯且干净

- **P3 Worker 侧来源可追溯。** 从 head manifest 的 `source.sourceBinding.raw` 取 `sourceRoot`；该目录必须存在、`git status --porcelain` 为空、HEAD 等于一个完整 40 位提交。
  - 复用 `tools/frozen-main-source.mjs` 的 `assertFrozenSource({source, mainCommit})`：它一次性校验 HEAD 等于目标提交、tree 属于该提交、工作区干净。**注意它不约束路径**（只约束内容身份），所以路径是否在 `main-release-packages` 下**不作为**前置——这正是它为什么能用在这里。
  - 失败：`现役前端来源不可追溯或有未提交修改，不能承认`。
- **P4 Worker 侧 tree 与 manifest 自洽。** `api.hashRelativeFiles(source, await api.listGitSourceFiles(source))` 必须深等于 manifest 的 `source.tree`。失败：`现役前端来源与运行包不一致，不能承认`。
- **P5 Django 侧来源可追溯。** `deployment.json` 的 `sourceRoot` 目录存在、`status --porcelain` 为空、HEAD 是完整 40 位提交。失败：`现役后台来源不可追溯或有未提交修改，不能承认`。
- **P6 两侧提交都在 `origin/main` 上。** 对两个提交各做 `git merge-base --is-ancestor <commit> refs/remotes/origin/main`。**不允许**只检查其中一侧。失败：`现役来源提交不在 origin/main 上，不能承认`。
  - 这一条是防「承认一棵私有分支/未推送的树」。它要求先 `fetch`；adopt 自己做一次 fetch（与 `observeLatestMain:71` 相同的 refspec），因为不 fetch 就无法判断祖先关系。
- **P7 前后台提交关系必须是「相等，或后台是前端的后代」。** 判定用 `git merge-base --is-ancestor <worker> <django>`（退出码 0/1），**不要**用 `merge-base` 输出值去比字符串——本例 `merge-base` 恰好等于 Worker 提交，照字符串比会在分叉场景下给出误判。计算两侧提交：
  - 相等 → `adoption.split=false`，`mainCommit` 取该提交。
  - 后台是前端的**后代** → `adoption.split=true`，`mainCommit` 取前端提交（§0.3），后台提交记进 `adoption.djangoSourceCommit`，并把 `e62…..2dc…` 的 `release-scope-plan` 结果记进 `adoption.djangoAhead.plan`。
  - 其他任何关系（前端超前于后台、两者分叉无祖先关系）→ **拒绝**：`现役前后台提交关系无法解释（非同一提交且后台不是前端的后代），不能承认`。
    - 前端超前于后台意味着前端装了后台没装的东西，按 §0.3 的语义取 Worker 侧 HEAD 会使下一次发布的 `base` 超前于后台实际代码，**从而漏发后台**。拒绝比猜更安全。
- **P8 Django 侧 app 树与 `deployment.json` 自洽。** 按 `deployment.json` 的 `fingerprintAlgorithm`（现役是 `relative-path-file-sha256-ordinal-v2`）在 `D:\teruisi-runtime\django-sales\app` 上复算 `fileCount` 与 `appFingerprint`，必须相等。
  - 这一条独立于 P5：P5 证明「来源树干净」，P8 证明「装上去的东西确实是那棵树产出的、且之后没被改过」。
  - 算法实现必须复用现役控制器已有的那一套（`Assert-ApplicationTreeManifest`，`tools/django-local-service.ps1:1583` 经 `Assert-DeployedApplication` 调用），不在 Node 侧另写一份口径。做法：走 §4 的既有探针，把 `Assert-DeployedApplication` 的结果当作这一项的证据，**不重新实现指纹算法**。
  - 失败：`现役后台应用树与部署清单不一致，不能承认`。

### 三组：现在这一刻系统是干净就绪的

- **P9 无维护/排空标记。** `D:\teruisi-runtime\django-sales\run\system-maintenance.json`、`automation-drain.json` 都不存在。复用现成的 `assertNoMaintenanceMarkers(runtimeRoot)`（`publish-latest-main.mjs:348`）。失败沿用其原文：`当前仍有维护或排空状态：<name>`。
- **P10 服务就绪。** `GET http://127.0.0.1:3000/_teruisi/local/health/ready`（带 `x-teruisi-local-health:1`，15 秒超时）必须 `status===200` 且 `ok===true` 且 `status==='ready'`。失败：`当前运行版本尚未就绪，不能承认`。
- **P11 轮换锁空闲。** `probeRotationLock()` 必须为 true。失败：`仍有发布或准备持有轮换锁，不能承认`。
  - 这条防的是在另一次发布进行中途写记账。
- **P12 维护前置探针通过。** 调 `assertPublicationPreconditions(config, …)`（`:350`），它含 `Assert-RuntimeAclHardened`、`Assert-DeployedApplication`（即 P8 的证据来源）和 `Assert-NoForeignServiceChildren`。失败沿用其原文。
- **P13 准备队列锁可获得。** adopt 全程持 `acquireMainPublicationQueue(binding)`（`:564`），与发布走同一把锁，并在 `finally` 里释放。拿不到即拒绝（该函数自带 `准备队列正在处理…` 的信息）。
- **P14 退役准入通过。** `assertRetirementAdmission(config, undefined, {scope})`，并在写盘前 `invalidateRetirementReadScope(scope,'publisher-adopt-catalog-write')`，与既有写盘点一致。

### 四组：没有半切换、没有把失败说成成功

- **P15 两侧的 attempt 目录都不能是「有 STARTED 无 SUCCESS」。** 对**两个**提交各算一次 attempt 路径 `path.resolve(source,'..','publish-'+commit.slice(0,12))`，逐个检查。失败：`<commit> 的发布记录有开始无成功，不能把半切换当作已发布`。
  - 现役实测：Worker 侧 `publish-e62dc33a8a05` 有 `SUCCESS.json`（通过）；Django 侧那棵交付树旁**没有** `publish-2dc377f0…` 目录（通过，因为无 STARTED）。
- **P16 不存在任何声称当前 Django 摘要的真实 SUCCESS.json。** 若在两侧 attempt 中找到一份 `status==='deployed_and_ready'` 且三值与现役实测全等的回执，则**不该用 adopt**——那说明是目录索引断了而不是记账缺失，应走 `publish-main-status.mjs` 的协调路径。拒绝：`已存在与现役一致的真实成功回执，应协调发布索引而不是承认`。
- **P17 不覆盖已有 catalog。** 沿用 `wx` 语义：先把现有 `PUBLISHED-MAIN.json` 复制成 `PUBLISHED-MAIN.<adoptionId>.superseded.json`（`COPYFILE_EXCL`，失败即拒绝），再 tmp + rename 换上新的。这一步照抄 `pi150-forward-recovery.mjs:152-153` 的既有先例（它正是「备份旧 catalog 再原子替换」）。
  - 与 `:686-688` 发布路径的差异：发布路径的 tmp 用 `flag:'wx'` 但**不备份旧 catalog**（因为它是正常演进）。adopt 改的是记账本身，必须留下被它取代的那一份。
- **P18 被短路的半切换门禁要在前置里补回并留证。** 写入前重做 P15，并把两侧 attempt 目录的成员快照及摘要写进回执的 `adoption.suppressedGuard`。理由、短路机制与残留边界见 §9.1。失败（任一侧出现「有 STARTED 无 SUCCESS」）即拒绝，与 P15 同一条错误信息。

## 2. 回执怎么标明「承认而非发布」

### 2.1 为什么不能换 `status`

`readLivePublication:55` 断言 `receipt.status==='deployed_and_ready'`。而且它不是唯一的消费者——同一个字面量还被这些地方断言：

| 消费者 | 位置 | 读的是什么 |
| --- | --- | --- |
| `readLivePublication` | `publish-latest-main.mjs:55` | catalog 指向的回执 |
| `main-prebuild-status.mjs` | `:43` | attempt 里的 SUCCESS.json |
| `preparation-resolution.mjs` | `:51`、`:223`、`:224` | 被取代决议的后继发布 |
| `publish-main-status.mjs` | `:53` | 续接时的回执 |
| `publish-main-completed.mjs` | `:15` | 已完成任务证明 |
| `publish-prepared-main.mjs` | `:148` | 成功凭证 |

把 `status` 换成 `adopted_live` 会让以上全部拒绝，等于换一个死锁。所以：

**`status` 保持 `deployed_and_ready`（它描述的是「现役确实已部署且就绪」，这一点是真的），承认语义放在新增的必填字段里。**

### 2.2 回执结构

新增一个顶层 `adoption` 段。**它的存在本身就是「这不是一次发布」的标记**，字段名刻意用 `adoption` 而不是 `publication`：

```jsonc
{
  "status": "deployed_and_ready",        // 现役确实已部署就绪，这是实测事实
  "at": "<adopt 执行时刻>",
  "mainCommit": "e62dc33a8a05059d…",     // §0.3：既有语义即「Worker 来源树的 HEAD」
  "components": ["worker", "django"],
  "workerRelease": "20261030T013752Z-91459570a711f22e",
  "workerManifestSha256": "bfdd5573…",
  "djangoManifestSha256": "e0fc1a0d…",   // 现役实测值
  "source": "<Worker 侧 sourceRoot>",
  "sourceTree": { … },                   // 实测复算，非抄录
  "djangoPreparedId": null,              // adopt 不知道、也不猜；显式 null
  "maintenanceId": null,                 // 同上：adopt 没开维护窗口
  "migration": null,
  "startupVerified": true,               // 来自 P12 探针的实测
  "readyVerified": true,                 // 来自 P10 的实测
  "backupPerformed": false,

  "adoption": {
    "version": "teruisi-live-adoption-receipt-v1",
    "kind": "acknowledged-not-published",      // ← 一眼可辨的承认标记
    "reason": "<操作者给的 --adopt-reason 原文>",
    "adoptionId": "<uuid>",
    "adoptedAt": "<ISO>",
    "operator": {                              // adopt 当时的操作者身份
      "username": "…", "userdomain": "…",
      "pid": 1234, "processCreatedAt": "…",
      "commandLineSha256": "…", "controlExecutionId": "…"
    },
    "acknowledgedDeployment": {                // 被承认的那次部署是怎么发生的
      "djangoDeployedAt": "2026-10-30T14:46:15.969…",   // 抄自 deployment.json
      "djangoSourceRoot": "D:\codex-isolated\netshop-projection-total-20261030\source",
      "djangoCommit": "2dc377f0d26319f…",       // 与顶层 adoption.djangoSourceCommit 同值
      "workerSourceRoot": "D:\codex-isolated\main-release-packages\e62dc33a8a05-…\source",
      "workerCommit": "e62dc33a8a05059d…",
      "workerReceiptPath": "…\publish-e62dc33a8a05\SUCCESS.json",
      "workerReceiptSha256": "…",
      "entryBypassed": "django-local-service.ps1 PrepareApp/DeployApp",
      "basis": "docs/规范/验证与发布.md#发布入口与记账边界"
    },
    "djangoSourceCommit": "2dc377f0d26319f…",   // §0.3：后台实际跑的提交；mainCommit 不代表它
    "split": true,                             // 前后台不同提交
    "djangoAhead": {                           // 分裂的如实记录
      "fromCommit": "e62dc33a…", "toCommit": "2dc377f0…",
      "commitCount": 6,
      "frontendPayload": false,                // app/ lib/ components/ 实测为空
      "packagedToolsStale": [                  // 随 Worker 包安装、停在旧字节的文件
        "tools/operations-system-watchdog.ps1",
        "tools/postgres_no_key_backup.py"
      ],
      "plan": { "components": ["worker","django"], "migrate": false, "planSha256": "…" }
    },
    "supersededCatalog": {                     // 被它取代的那一份记账
      "path": "…\PUBLISHED-MAIN.<adoptionId>.superseded.json",
      "sha256": "…",
      "mainCommit": "e62dc33a…",
      "djangoManifestSha256": "27d72aab…"      // 失配的旧值，留证
    },
    "preconditions": { "P1": true, "P3": true, … },   // 逐项留证
    "publicationPerformed": false,
    "productionMutationsPerformed": false
  }
}
```

要点：

- `djangoPreparedId` / `maintenanceId` / `migration` 写 `null` 而不是编造。真发布这些有值；adopt 这里是 `null`，**这本身是第二道可辨识信号**。
- `supersededCatalog.djangoManifestSha256` 把失配的旧值 `27d72aab…` 留在记录里，使这次承认的「之前错在哪」可追溯。
- 回执落盘位置：`<stateDirectory>\adoptions\<adoptionId>\ADOPTED.json`，**不写进任何 `publish-<12hex>` 目录**——那些目录是真发布的审计空间，不混入。

### 2.3 catalog 怎么写

```js
const catalog = {...receipt, source, sourceTree, receiptPath, receiptSha256};
```
与 `:685` 发布路径**同形**，所以 `adoption` 段会一并进入 catalog，`readLivePublication` 之后读到的 catalog 也带着承认标记。

## 3. 它绝对不能放过什么（拒绝条件）

| 不能被用来…… | 挡住它的前置 |
| --- | --- |
| 把一次**失败**的发布说成成功 | P15（有 STARTED 无 SUCCESS 即拒）+ P10/P12（服务必须真就绪）+ P4/P8（装上去的字节必须与来源自洽） |
| 绕过维护/排空门禁 | P9（标记存在即拒）+ P12（探针含 ACL 与部署清单） |
| 在服务未就绪时承认 | P10（必须 200 + ok + ready） |
| 承认一棵**脏**的来源 | P3/P5（两侧 `status --porcelain` 都必须为空） |
| 承认一棵**不可追溯**的来源 | P6（两侧提交都必须在 `origin/main` 上）+ P3（HEAD 必须是完整 40 位提交） |
| 在另一次发布进行中插写记账 | P11（轮换锁）+ P13（队列锁，与发布同一把） |
| 当成常规动作反复用 | P1（记账已一致时必须报错） |
| 掩盖前后台分裂 | P7（关系不可解释即拒）+ 回执 `adoption.split` / `djangoAhead` 必填 |
| 悄悄覆盖旧记账 | P17（必须先 `COPYFILE_EXCL` 备份旧 catalog，备份失败即拒） |
| 顺带改生产 | adopt **只写** `<stateDirectory>` 下的 catalog / 回执 / 备份三处；不碰 `D:\teruisi-runtime`，不调任何 `PrepareApp`/`DeployApp`/`EnterMaintenance` |
| 无理由地执行 | `--adopt-reason` 为必填非空参数，原文进回执 |

还有两条**结构性**的不放过：

- **adopt 不接受任何「目标提交」参数。** 它只承认实测到的东西。没有 `--target`，所以无法用它声称一个没装上去的版本。
- **adopt 不写 `LATEST-PREPARED.json`。** 它不产生制品指针，所以不能被下游误当成「已准备好可发布」。

## 4. 兼容性：`readLivePublication` 要不要加承认分支

### 两个方案

**方案 A：adopt 写出一份满足现有断言的真实回执，`readLivePublication` 一行不改。**

走 catalog 分支（`:40`）需要三值全等——adopt 写入后天然全等。然后 `:42` 校验 `receiptPath` 指向的回执字节摘要（adopt 自己写的回执，自己算的摘要，成立）；`:55-56` 要求回执的 `status==='deployed_and_ready'`、`mainCommit===catalog.mainCommit`、三值等于实测值（全部由 adopt 按实测写入，成立）；`:57-60` 校验 `source` 的干净度、HEAD、tree（= P3/P4，成立）；`:61-62` 校验就绪（= P10，成立）。

**全部能过，且过的方式是「这些断言说的都是真的」，不是绕过。**

**方案 B：在 `readLivePublication` 里加一条承认分支**，例如允许 `status==='adopted_live'`。

### 取舍与选择

| | 方案 A | 方案 B |
| --- | --- | --- |
| 改动面 | 只新增，`readLivePublication` 零改动 | 改一个被 7 处共享语义的热路径 |
| `controlFiles` / `currentLatest` pin | 都要重新资格化（改了同一个文件） | 同样要 |
| 其他 6 个 `deployed_and_ready` 消费者 | 不受影响 | 每一个都要单独评估是否也要加分支 |
| 「承认」的可辨识性 | 靠 `adoption` 段 + 三个 `null`，catalog 和回执里都在 | 靠 `status` 值，更醒目 |
| 风险 | 回执的 `status` 字面上像真发布，**依赖读者看 `adoption` 段** | 放宽了一条一直很严的断言，任何未更新的消费者会把 adopt 当成未知状态而失败 |
| `observeLatestMain:77` 半切换门禁 | **被短路**（回执在 attempt 目录外 → `resolvedOriginalAttempt=true`）。靠 P15/P18 在前置里直接拒绝来补，另两道同语义检查仍生效。详 §9.1 | 可以把门禁恢复成运行时有效（代价是改读取侧） |

**选方案 A。** 理由：

1. `deployed_and_ready` 这个值的真实含义是「这套东西确实部署了并且就绪」——对现役来说这是**实测为真**的。它从来不保证「经过了发布记账」，那是 catalog 的职责。所以保持它不是妥协，是用对了语义。
2. 方案 B 要放宽的那条断言，是阻止「把半切换当已发布」的同一条断言（`:50` 的兄弟）。为了一次性的记账修补去放宽它，收益不值。
3. 方案 A 下 `readLivePublication` 完全不动，意味着 §1 的那些前置是**唯一**的放行面。放行逻辑集中在一处，比分散在读取侧更容易审。
4. 方案 A 对 `preparation-resolution.mjs:273` 那条「catalog 必须在队列代际内」也无影响（路径不变）。

方案 A 的已知弱点（如实记录，两条）：

1. **回执的 `status` 字面上与真发布相同**，分辨承认与真发布需要看 `adoption` 段是否存在。缓解有三重——`adoption.kind==='acknowledged-not-published'`、三个结构性 `null`（`djangoPreparedId`/`maintenanceId`/`migration`）、回执落在 `adoptions\` 而非 `publish-<12hex>\`。
2. **它短路了 `observeLatestMain:77` 的半切换门禁**（见上表末行与 §9.1）。这一条初稿的权衡表里漏算了，是自检时才发现的，也是方案 A 的真实成本。补偿是 P15 直接拒绝 + P18 书面留证 + 另两道同语义检查不受影响。

两条都不假装不存在。第 2 条若用户判定不可接受，方案 B 是唯一出路。

## 5. 实现计划（最小改动）

### 5.1 CLI

在 `runLatestMainCli:581` 的 `parseArgs` 加两个选项：

```js
'adopt-live':{type:'boolean',default:false},
'adopt-reason':{type:'string'},
```

互斥断言（照 `:582-587` 的写法）：

```js
assert.ok(!values['adopt-live']||(!values.check&&!values['prepare-only']&&!values['consume-preparation']
  &&!values['retire-lost-artifacts']&&values['abandon-dispatch']===undefined),
  'Live adoption cannot prepare, reconcile, check, publish or retire artifacts');
assert.ok(!values['adopt-live']||(typeof values['adopt-reason']==='string'&&values['adopt-reason'].trim().length>0),
  'Live adoption requires --adopt-reason');
assert.ok(values['adopt-reason']===undefined||values['adopt-live'],'--adopt-reason only applies to --adopt-live');
```

并把现有三条互斥断言各加一个 `&&!values['adopt-live']`，使互斥是双向的。

### 5.2 控制协议标识

`:597` 的 `controlExecution(binding,…)` 分支链里加 `values['adopt-live']?'adopt-live':…`（放在 `retire-lost-artifacts` 之后、`abandon-only-submit` 之前）。

### 5.3 新函数（两个 export，便于单测）

- `export async function observeLiveIdentity(config, deps)` —— 只读勘察，返回两侧身份。不含任何断言式推定。
- `export async function adoptLivePublication(config, {reason, binding, retirementScope, …deps})` —— 跑 §1 全部前置，然后写备份 + 回执 + catalog。全部依赖（`fetch`、`probe`、`git`、`rotation`、`api`）走可注入参数，默认值是真实实现——照 `inspectNotEnteredPublication:407` 的既有写法。

### 5.4 入口接线

在 `runLatestMainCliOperation` 里，紧跟 `retire-lost-artifacts` 分支之后插入：

```js
if(values['adopt-live']){
 assert.ok(binding,'Controlled live adoption required');
 const releaseQueue=await acquireMainPublicationQueue(binding);
 try{
  const result=await adoptLivePublication(config,{reason:values['adopt-reason'],binding,retirementScope});
  console.log(JSON.stringify(result));return result;
 }finally{await releaseQueue();}
}
```

放在 `publisherEnvironment` 校验（`:599-600`）之后、`retire-lost-artifacts`（`:601`）之后，**早于** `progress` 创建（`:616`）——adopt 不需要发布进度日志，少一个写盘点。

### 5.5 不做的事

- 不抽取、不重构 `:685-688` 的发布路径 catalog 写入。它和 adopt 的写入**要求不同**（adopt 多一步备份），强行共用会给发布路径加上它不需要的分支。两处各自 8 行左右，重复优于耦合。
- 不改 `readLivePublication`、不改 `observeLatestMain`、不改任何 `.ps1`。

## 6. 需要用户拍板的事

1. **§0.3 的 `mainCommit` 取值**：按既有语义写 Worker 侧 HEAD `e62dc33a`，另加 `adoption.djangoSourceCommit` 记 `2dc377f0`，不改 `mainCommit` 含义。姐妹会话已认同这个方向，此处请用户最终拍板。
2. **前后台分裂要不要先解决再 adopt**：另一条路是先补发一次 Worker，把两侧拉到同一提交，再 adopt 一个不分裂的状态。那样回执干净得多，但需要先解开第 3、4 道闸（11 代 addition + 两个无 recipe 的 migration），且本任务不含发布授权。本设计按「承认分裂状态并如实记录」做，是因为任务范围只允许写代码。
3. **半切换门禁被短路可不可接受**（详见 §9.1，这是自检时才发现的）：adopt 回执不在常规 attempt 目录里，会让 `observeLatestMain:77` 的「有 STARTED 无 SUCCESS」门禁在该 catalog 生效期间对现役目标失效。我的方案是在前置里自己执行该检查（P18）并在回执里书面声明失效；如果这不可接受，就必须改用 §4 的方案 B（改 `readLivePublication`）。
4. **`--adopt-reason` 之外要不要再加一道人工确认**（例如必须同时传 `--adopt-confirm <现役 djangoManifestSha256 前 12 位>`，迫使操作者亲手核过实测值）。我倾向加，成本极低；未写进 §5，等拍板。

## 7. 验证计划（实现阶段执行，此处先定口径）

- **单测文件** `tests/publisher-adopt-live.test.mjs`，照 `tests/preparation-superseded-resolution.test.mjs` 的临时目录夹具模式（`mkdtemp` + 真 `git init` + 注入依赖）。
- **正向**：全前置满足 → 写出的 catalog 与回执字段逐项断言；**并用真实的 `readLivePublication` 读一遍写出的 catalog，断言它接受**（这是方案 A 的核心主张，必须被测到，不能只断言字段）。
- **负向**：P1、P3、P4、P5、P6、P7（两种坏关系各一例：前端超前、分叉）、P8、P9、P10、P11、P15（两侧各一例）、P16、P17、P18 各一个夹具，逐项断言「失败」且「错误信息指向该项」。P2/P12/P13/P14 走注入的依赖桩各一例。
- **门禁短路的结构性断言**（对应 §9.1，这是本设计最容易回归的一点）：断言 adopt 写出的 `receiptPath` 的父目录 **不等于** `path.resolve(source,'..','publish-'+commit.slice(0,12))`——即回执确实落在 attempt 目录外；同时断言回执必带 `adoption.suppressedGuard`。若将来有人把回执挪进 attempt 目录以「恢复门禁」，这两条会同时失败，而不是静默打破 `preparation-resolution.mjs:266` 的闭包断言。
- **互斥**：`--adopt-live` 与 5 个旗标各组合一次，断言 CLI 层拒绝；缺 `--adopt-reason` 断言拒绝。
- **只写盘三处**：正向用例跑完后断言临时目录里只多了 catalog、备份、回执三个文件，没有 `LATEST-PREPARED.json`、没有 `publish-*` 目录。
- **测量纪律**：测试输出重定向到文件再读退出码（`node --test … > out.txt 2>&1; echo $?`），不用 `| tail`。

## 8. 改完后需要重新资格化的 pin（后续发布的前置清单）

`tools/publish-latest-main.mjs` 当前字节摘要 `b27c76018d8f36023d07b831bda560ad446c177638858039d99a5737b8412e8b`，**恰好就是** `retirementEntryPolicies.currentLatest` 的当前值。改这个文件必然打破下列 pin：

1. `tools/preparation-retirement-entry.mjs` 的 `retirementEntryPolicies`：新摘要要成为 `currentLatest`，旧的 `b27c7601…` 下移进 `previousCurrentLatest`（`:69-70`）。
2. `tools/install-main-prebuild.mjs:21` 的 `controlFiles` 成员摘要 → 需要重建控制包（新 `bundleSha256`、新 `MANIFEST.json`）并走一次控制采用。
3. 现役控制包 `control-bundles\e664af36…` 里的那一份 `publish-latest-main.mjs` 与 `CONTROL-INSTALLATION.json` 的 `dispatcherSha256`（现为 `6c88c513…`）、`bundleManifestSha256`、`bundleSha256` 全部要随新一代控制包更新。
4. 若 `tests/maintenance-controller-qualification.test.mjs` 或 `tools/check_schema_code_digest.py` 的清单在另一会话修完后纳入了本文件，需复查——**本轮实测这两处当前都不含 `publish-latest-main.mjs`**，所以预期不受影响，但以另一会话修完后的实际清单为准。

这些 pin 失配是改动的**预期后果**，不为了让 pin 匹配而回退改动。

## 9. 设计自检发现的问题（已修正到上文，但要显式记下）

### 9.1 回执落盘位置与 `observeLatestMain:77` 半切换门禁（本节已改写）

这是全文最关键的一节，初稿写得不够清楚。重写如下。

#### 门禁的确切逻辑

```js
// readLivePublication:63-64
const ordinaryAttempt = path.resolve(source,'..','publish-'+commit.slice(0,12));
resolvedOriginalAttempt: path.resolve(path.dirname(receiptPath)) !== ordinaryAttempt

// observeLatestMain:76-77
const liveAttempt = path.resolve(live.source,'..','publish-'+live.mainCommit.slice(0,12));
if (exists(liveAttempt+'/STARTED.json') && !exists(liveAttempt+'/SUCCESS.json')
    && !live.resolvedOriginalAttempt) throw Error('当前目标有STARTED但无成功完成，不能把半切换当作已发布');
```

两个路径都从同一个 `source` 和同一个 commit 算出，所以 `liveAttempt === ordinaryAttempt` 恒成立。于是门禁就是：**常规 attempt 目录里有 STARTED 无 SUCCESS 时报错，除非回执不在该目录里。**

#### 两种落盘位置的后果（这是两种不同的风险，初稿把它们混为一谈）

**假设 A：回执写进 `publish-<12hex>/`。** 则 `resolvedOriginalAttempt === false`，门禁**保持生效**。但产生更严重的问题：如果该目录里真的有一份 STARTED（一次真实的半切换），adopt 在旁边放一份 SUCCESS 形状的回执，**就把这次真实的半切换伪装成了已完成**——正是任务书里说的「不标明承认而非发布就比现在更糟」的具体形态。**因此假设 A 被排除。**

另有两条独立理由使它不可行（已实测）：`preparation-resolution.mjs:266` 断言 packet 闭包成员数**恰好是 8**（`Packet contains artifacts beyond the superseded preparation closure`），`:292` 和 `main-prebuild-queue.mjs:31` 的 `isNotEnteredAttemptMember` 又各自约束了 attempt / preparation 目录的合法成员名单。往里面添一份 `ADOPTED.json` 会直接打破这些闭包断言。

**假设 B（本设计采用）：回执写到 `<stateDirectory>\adoptions\<adoptionId>\ADOPTED.json`。** 则 `resolvedOriginalAttempt === true`，门禁在该 catalog 生效期间**被短路**。

#### 为什么假设 B 的短路在本设计下不构成漏洞

关键在于：**门禁要防的那个状态，adopt 在前置里直接拒绝。**

- **P15 直接拒绝（非警告、非记录）**：对**两侧**的 attempt 目录（Worker 侧 `publish-e62dc33a8a05`、Django 侧 `publish-2dc377f0…`）各检一次，任一出现「有 STARTED 无 SUCCESS」就**拒绝 adopt**。所以 adopt 永远不会在存在半切换的状态下写出任何东西。（与姐妹会话的判断一致：应该直接拒绝。）
- **实测现状**：Worker 侧 `publish-e62dc33a8a05/` 有完整 `SUCCESS.json`（过）；Django 侧那棵交付树旁**没有** `publish-2dc377f0…` 目录（无 STARTED，过）。
- **P16** 还要求：若已存在一份三值与现役全等的真实 `SUCCESS.json`，则说明是目录索引断了而不是记账缺失，应走 `publish-main-status.mjs` 的协调路径——adopt 拒绝。

#### 残留风险及其边界（诚实记录）

P15 是**执行时刻的一次快照**。adopt 写入之后、下一次真发布写新 catalog 之前，若有一次发布中断在现役目标上留下 STARTED，`:77` 不会再拦。这条残留风险的**实际边界比字面上小**，因为：

1. 那条路径上还有 `prepareLatestMainOnce:122-123` 和 `inspectMainPreparation:255-256` 两处**独立**的同语义检查（均为「有 STARTED 无 SUCCESS 则 throw」），它们**不看** `resolvedOriginalAttempt`，不被短路。
2. 那一次假设的中断发布自己会在自己的新 packet 里留记录，而 `retireNotEnteredPublication`（`:454`）的退役路径仍然生效。

即这是**三道同语义检查中被短路的一道**，不是唯一一道。尽管如此，它仍是个真实的副作用，所以要求：

- **P18**：写入前重做 P15，并把两个 attempt 目录的**成员快照及其摘要**写进 `adoption.suppressedGuard`：

```jsonc
"suppressedGuard": {
  "guard": "observeLatestMain:77 half-switch check",
  "suppressedBy": "receiptPath outside ordinary attempt directory (resolvedOriginalAttempt=true)",
  "stillEnforcedBy": ["prepareLatestMainOnce:122-123", "inspectMainPreparation:255-256"],
  "verifiedAtAdoption": { "<commit>": { "attempt": "…", "members": [], "membersSha256": "…" } },
  "note": "该 catalog 生效期间此门禁对现役目标失效；下一次真发布写新 catalog 后恢复"
}
```

这不恢复门禁的运行时效力（做不到，除非改 `readLivePublication`，而 §4 选了不改），但它把「哪道门禁因此失效、失效期间现场是什么样、还有哪两道在生效」变成**书面的、可核的**。

#### 不改 `readLivePublication` 的承诺

按姐妹会话的要求重申：**本设计不改 `readLivePublication` 的任何现有断言，也不加承认分支。** adopt 写出的 catalog 走的是 `:40` 那条**本来就存在**的三值全等分支，没有新分支、没有放宽任何原有条件；`:42`/`:55`-`:60`/`:61`-`:62` 的每一条都因为「它们说的都是真的」而通过（详 §4）。

### 9.2 `main-prebuild-queue.mjs:289` 的字段白名单

`live` 对象的键被 `:289` 白名单约束（`mainCommit`/`source`/`sourceTree`/`head`/`chainStateSha256`/`djangoManifestSha256`/`completedReceiptPath`/`resolvedOriginalAttempt`）。adopt **不**构造 `live` 对象（它走自己的 `observeLiveIdentity`），所以不触发这条。已确认无需改动——但实现时不要图省事复用 `live` 的形状往里加字段。

### 9.3 已核实为「不受影响」的几处

- `tests/maintenance-controller-qualification.test.mjs` 只 import `tools/manual-maintenance-continuation.mjs`，**不含** `publish-latest-main.mjs`。
- `tools/check_schema_code_digest.py` 的 `SPECS`/`CODE_FILES` 都是 schema addition 的代码契约，**不含** `publish-latest-main.mjs`。
- 所以 §8 第 4 条的预期成立：另一会话在修的那两道 CI 门禁，不会因本改动而额外失配。

### 9.4 诚实的遗留

- **本设计今天无法用一次真实发布验证**（第 3、4 道闸仍在），这是已知且接受的。§7 的隔离验证能证明「前置逐项生效、catalog 能被 `readLivePublication` 接受」，**不能**证明「真实发布链在 adopt 之后端到端跑通」。实现阶段的 REPORT.md 必须按这个口径写，不得表述为「已验证可发布」。
- §0 的分裂状态是现役的真实样子。本设计选择承认并记录它，而不是修它。修它需要补发一次 Worker，那超出本任务范围。
