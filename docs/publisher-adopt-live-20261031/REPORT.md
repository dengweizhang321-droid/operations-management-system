# 发布器 `--adopt-live` 入口实现报告（2026-10-31）

设计见同目录 [DESIGN.md](DESIGN.md)。本报告只记实现与实跑结果。

**本任务只做代码开发与隔离验证。未合并、未准备制品、未发布、未碰生产。** 全程没有执行任何会写 `D:\teruisi-runtime` 或 `D:\codex-isolated` 的命令；对这两个目录只做了读取。

## 1. 改了什么

| 文件 | 变化 |
| --- | --- |
| `tools/publish-latest-main.mjs` | +241 / −11 行。新增 `LIVE_ADOPTION_BEGIN…END` 段（`observeLiveIdentity`、`adoptLivePublication`、`gitSucceedsAt`、三个常量）、CLI 两个 flag 与互斥断言、控制协议标识 `adopt-live`、`runLatestMainCliOperation` 的 adopt 分支；回执的 `adoption.catalogMismatch` / `adoption.priorReceipt` 两个字段（见 §1.3）；另给 `readLivePublication` 加了**注入缝**（见 §1.2）。 |
| `tests/publisher-adopt-live.test.mjs` | 新增，489 行，39 个用例。 |
| `docs/publisher-adopt-live-20261031/` | DESIGN.md、本报告。 |

没有改 `tools/django-local-service.ps1`、`tools/manual-maintenance-continuation.mjs`、`config/main-schema-releases/*`，也没有改任何 `.ps1`。工作区只暂存了上述本任务文件。

### 1.1 新增入口的形状

```
node tools/publish-latest-main.mjs --config <固定入口配置> \
  --adopt-live --adopt-reason "<依据原文>" --adopt-confirm <现役后台实测摘要前12位>
```

写盘**只有三处**，全在 `config.stateDirectory` 下：

1. `adoptions\<adoptionId>\ADOPTED.json` —— 承认回执；
2. `adoptions\<adoptionId>\superseded-PUBLISHED-MAIN.json` —— 被取代的旧记账（`COPYFILE_EXCL`，建不出来就拒绝）；
3. `PUBLISHED-MAIN.json` —— tmp(`wx`) + rename 原子替换。

不写 `LATEST-PREPARED.json`，不建 packet，不调任何 `PrepareApp`/`DeployApp`/`EnterMaintenance`。

### 1.2 对 `readLivePublication` 做了什么（请重点看这一条）

设计承诺「不改 `readLivePublication` 的任何现有断言，也不加承认分支」。实现**守住了这个承诺**，但为了能在隔离环境里真实驱动它，给它加了**注入缝**：

```js
export async function readLivePublication(config,{loadApi,loadRotation,readDjango,
  runtimeRoot='D:/teruisi-runtime/django-sales', fetchReady=<原来的 fetch>}={})
```

- 新增的是**第二个可选参数**，一个字段都不传时行为与改动前**逐字节相同**：原来硬编码的 `'D:/teruisi-runtime/django-sales/app/deployment.json'` 变成 `runtimeRoot+'/app/deployment.json'`，而 `runtimeRoot` 的默认值就是原字面量；`fetch(...)` 变成 `fetchReady()`，默认实现是原来那一行。
- **断言一条没动、没放宽、没加条件分支**：`:40` 的 catalog 三值全等分支、`:42` 的回执摘要校验、`:55`-`:60`、`:61`-`:62`、`:63`-`:64` 的 `resolvedOriginalAttempt` 全部原样。
- 这条改动的唯一目的是让「adopt 写出的 catalog 能被真实的 `readLivePublication` 接受」这个核心主张**可被测试证明**，而不是靠我在文档里断言。对应用例见 §3 的第 2 条。

这是实现阶段对设计的一处偏离（设计里写的是「零改动」），明确列出来由你判断是否接受。

### 1.3 承认范围被收窄并记进回执

姐妹会话复核后指出（我已复核确认，详见 DESIGN.md §0.2c）：那份真实回执 `…\publish-e62dc33a8a05\SUCCESS.json` 仍在磁盘上，`PUBLISHED-MAIN.json` 的 `receiptPath` 正指向它且 `receiptSha256` 校验通过。逐项比对后，`status`、`mainCommit`、`workerRelease`、`workerManifestSha256`、`startupVerified`、`readyVerified` **全部已满足**，**唯一失配是 `djangoManifestSha256`**（回执声明 `27d72aab…`，现役实测 `e0fc1a0d…`）。

即 adopt 要做的不是「凭空造一份全新记账」，而是让记账承认**一个**已漂移的值；Worker 侧的记账本来就是闭合的。这不放宽任何一条前置（18 项仍须全部满足），但改善了回执的诚实度，故新增两个字段：

- `adoption.catalogMismatch` —— 三个值逐项记 `{catalog, live, equal}`，使「哪一项真的漂了」可审，而不是让回执暗示三项都错了。
- `adoption.priorReceipt` —— 旧 catalog 指向的那份回执是否存在、字节是否与声明摘要一致（`intact`）、它当时声明了什么。缺失或被改动都只**如实记录**，既不阻塞也不授权（它不是放行依据）。

## 2. 严格前置清单（实现后的实际状态）

18 项全部实现。按设计分组，括号里是实际的拒绝信息关键字：

**一组 必要性**
- P1 catalog 当前确实失配（`已一致，无需承认`）
- P2 现役状态可被独立读出；另加一条设计里没有的：manifest 字节摘要必须等于版本链记录值（`清单字节与版本链记录的摘要不一致`）

**二组 来源可追溯且干净**
- P3 Worker 来源干净可追溯（`现役前端来源不可追溯或有未提交修改`）
- P4 Worker tree 与 manifest 自洽（`现役前端来源与运行包不一致`）
- P5 Django 来源干净可追溯（`现役后台来源不可追溯或有未提交修改`）
- P6 两侧提交都在 `origin/main` 上（`不在 origin/main 上`）
- P7 关系必须相等或后台是前端后代（`前后台提交关系无法解释`）；判定用 `merge-base --is-ancestor` 的退出码，不比字符串
- P8 Django app 树与 `deployment.json` 自洽 —— **复用控制器自己的 `Assert-DeployedApplication`**，经 P12 的探针取证，Node 侧没有另写一份指纹算法

**三组 此刻干净就绪**
- P9 无维护/排空标记（复用既有 `assertNoMaintenanceMarkers`）
- P10 服务就绪（200 + `ok:true` + `status:'ready'`）
- P11 轮换锁空闲（`轮换锁`）
- P12 维护前置探针通过（`权限或部署清单检查未通过`）
- P13 持准备队列锁全程，`finally` 释放（复用 `acquireMainPublicationQueue`）
- P14 退役准入 + 写盘前 `invalidateRetirementReadScope`

**四组 不能把失败说成成功**
- P15 两侧 attempt 都不能「有 STARTED 无 SUCCESS」（`有开始无成功，不能把半切换当作已发布`）
- P16 不存在已声称现役三值的真实 SUCCESS（`应协调发布索引而不是承认`）
- P17 旧 catalog 必须先独占备份成功（`EEXIST` 即拒绝）
- P18 重做 P15 并把两侧 attempt 成员快照与摘要写进 `adoption.suppressedGuard`

**另外两条结构性约束**：入口不接受任何「目标提交」参数（无 `--target`），所以无法声称一个没装上去的版本；`--adopt-reason` 非空必填、`--adopt-confirm` 必须等于现役后台实测摘要前 12 位（§6 第 3 点按推荐采纳）。

## 3. 测试覆盖与实跑输出

### 实跑结果

```
node --test tests/publisher-adopt-live.test.mjs
ℹ tests 39
ℹ pass 39
ℹ fail 0
EXITCODE=0
```

回归（我改了 `readLivePublication` 所在文件，必须复跑）：

```
node --test tests/publish-latest-main.test.mjs tests/main-publication-readiness.test.mjs \
            tests/preparation-superseded-resolution.test.mjs tests/pi150-forward-recovery.test.mjs
ℹ tests 70
ℹ pass 70
ℹ fail 0
EXITCODE=0
```

`npx eslint tools/publish-latest-main.mjs tests/publisher-adopt-live.test.mjs` → **0 errors**，1 个 warning，位于我未触碰的既有代码 `prepareLatestMainOnce`（`:275` 的 `log` 参数未使用），不属本次改动。

所有测试命令都**重定向到文件后再读退出码**，没有用 `cmd | tail`（那会返回管道的退出码，把失败显示成 exit 0）。

### 覆盖内容

**正向 6 个**：写出正确的 catalog/回执/备份；`mainCommit` 取 Worker HEAD、`djangoSourceCommit` 记后台提交；三个结构性 `null`；分裂如实记录且 `frontendPayload:false`；备份与旧记账逐字节相同。

**核心主张 1 个**：`the written catalog is accepted by the real readLivePublication` —— 用**真实的** `readLivePublication` 读 adopt 写出的 catalog，断言它接受且返回值正确。这是设计方案 A 的全部依据，现在有测试证明，不只是文档断言。

**结构性 2 个**：断言回执父目录 **不等于** `path.resolve(source,'..','publish-'+commit.slice(0,12))`（挪进去会把真实半切换伪装成已完成，且打破 `preparation-resolution.mjs:266` 的闭包断言）；断言 `suppressedGuard.stillEnforcedBy` 恰为那两处仍生效的检查，`verifiedAtAdoption` 的摘要与成员一致。另断言只写三个文件、不产生 `LATEST-PREPARED.json`、不建 packet 目录。

**承认范围的可审性 2 个**（姐妹会话复核后新增）：复现生产形状——catalog 的 `workerRelease`/`workerManifestSha256` 本来就与现役一致、`receiptPath` 指向一份真实 `SUCCESS.json`，只有 `djangoManifestSha256` 漂移——断言 `adoption.catalogMismatch` 把前两项记为 `equal:true`、只把 Django 那项记为 `equal:false`，且 `adoption.priorReceipt` 记下它存在、字节完整、当时声明了旧摘要，并断言这份旧回执的字节未被改动；另一例覆盖旧回执缺失（`present:false`）与被改动（`intact:false`）。

**负向 24 个**，逐项对应一条前置，每个都断言「失败」且「错误信息指向该项」，并且**统一断言拒绝时 `PUBLISHED-MAIN.json` 逐字节未变、`adoptions\` 目录未创建**：P1、P2（两例：读失败、manifest 字节漂移）、P3、P4、P5、P6、P7（两例：前端超前、真实分叉）、P9（两个标记各一例）、P10（四例：非 200 / `ok:false` / 非 ready / 不可达）、P11、P12、P15（前后台各一例，并断言原 STARTED 记录保留）、P16、P17、依据缺失（三例，并断言在任何读取之前就拒绝）、`--adopt-confirm` 错值（两例，含「填成旧 catalog 的值」）。

**CLI 互斥 7 个**：与 `--check`/`--prepare-only`/`--consume-preparation`/`--retire-lost-artifacts`/`--abandon-dispatch` 各一例；缺 `--adopt-reason`、缺或格式错的 `--adopt-confirm`；两个参数脱离 `--adopt-live` 使用。

**夹具真实性**：用真 `git init` + 真 remote + 两个真 worktree 复现生产形状（Worker 在冻结包的提交 W、Django 在交付树的后代提交 D），所以 `merge-base --is-ancestor` 是真 Git 在回答。P7 的分叉用例特意把 main 构造成**两侧的 merge**，使两个提交都是 `origin/main` 的祖先却互不为祖先——否则该用例会落到 P6 上而非 P7，证明不了想证明的事（第一版就是这么写错的，实跑失败后才修正）。

## 4. 改完后需要重新资格化的 pin

`tools/publish-latest-main.mjs` 摘要变化：

| | 值 |
| --- | --- |
| 改前（= 当前 `currentLatest` pin） | `b27c76018d8f36023d07b831bda560ad446c177638858039d99a5737b8412e8b` |
| 改后 | `17a9799fba21fe925a7ad6167cf09994bcb9cbd8b0653933333be5f60d4f60a3` |

必须处理的四项（后续发布的前置清单）：

1. **`tools/preparation-retirement-entry.mjs` 的 `retirementEntryPolicies`**（`:69-70`）：新摘要 `17a9799f…` 要成为 `currentLatest`，旧值 `b27c7601…` 下移进 `previousCurrentLatest`。该文件现仍含旧值 1 处。
2. **`tools/install-main-prebuild.mjs:21` 的 `controlFiles`** 成员：需重建控制包，产生新的 `bundleSha256` 与 `MANIFEST.json`，并走一次控制采用。
3. **现役控制包与安装状态**：`control-bundles\e664af36…` 里的那一份 `publish-latest-main.mjs`，以及 `CONTROL-INSTALLATION.json` 的 `dispatcherSha256`（现为 `6c88c513…`）、`bundleSha256`、`bundleManifestSha256` 都要随新一代控制包更新。
4. **`tools/verify-release-candidate.mjs` 的 profile：已核，无需改动。** 新规范 `docs/规范/验证与发布.md#ci门禁不进入发布链路` 要求改动测试文件前必须核对该工具的 profile 清单（它引用 36 个 `.test.mjs`，且本身没有生产调用方、不被发布器调用）。实测：用我的实际改动集调 `candidateCompatibilityProfile`，得 `version=release-three-optimizations-v1`、`paths=["tools/publish-latest-main.mjs"]`、**`unsupported=[]`**、`preparationQueue=true`。`publish-latest-main.mjs` 已在 `supported` 集合里（`:88`），我新增的测试文件落在 `docs/`/`tests/` 过滤之外（`:83` 会剔除 `tests/`），所以**不需要把新测试注册进任何 profile**。
   - 另外核了 `:442` 那条限定增量断言（要求改动集只含 `main-prebuild-queue.mjs`/`publish-latest-main.mjs`/`verify-release-candidate.mjs`）——它只在传 `--reuse-report` 时生效，属历史限定 profile，本次不触发。
5. **复查另一会话修完后的 CI 清单**：本轮实测 `tests/maintenance-controller-qualification.test.mjs`（只 import `manual-maintenance-continuation.mjs`）与 `tools/check_schema_code_digest.py`（`SPECS`/`CODE_FILES` 都是 schema addition 契约）**均不含** `publish-latest-main.mjs`，预期不受影响；以其修完后的实际清单为准再确认一次。

这些 pin 失配是改动的**预期后果**，没有为了让 pin 匹配而回退改动。

按新规范那一节的区分：`retirementEntryPolicies.currentLatest` 与 `controlFiles` 属**发布链路**（控制器/入口字节资格化，发布器自己会断言），必须在下一次发布前处理；而纯 CI 侧的摘要门禁只约束合并。两类不可合并为「CI 问题」一并对待。

## 5. 我没能验证的部分（诚实清单）

这一节是本报告最重要的部分，请不要跳过。

1. **没有用一次真实发布端到端验证。** 第 3、4 道闸仍在（11 代 addition 标记 + 两个无 recipe 的 workflow 迁移），本任务也没有发布授权。已证明的是「18 项前置在隔离夹具下逐项生效」和「写出的 catalog 能被真实 `readLivePublication` 接受」；**未证明**「adopt 之后真实发布链能跑通」。不要把本报告读成「已验证可发布」。
2. **P8 的指纹复算没有在真实 app 树上跑过。** 实现把它委托给控制器的 `Assert-DeployedApplication`（经 P12 探针），测试里该探针是桩。即「委托关系」被测到了，「真实指纹复算结果」没有——那需要在生产运行目录上执行，超出本任务边界。
3. **P12/P13/P14 在测试里是注入的桩。** `probePublicationPreconditions` 要起 Windows PowerShell 读真实运行目录；`acquireMainPublicationQueue`、`assertRetirementAdmission` 要真实的 control binding 与队列状态。测试证明了「失败时拒绝」，没有证明「真实环境下这三者的行为」。
4. **`adoption.operator` 的身份信息较弱。** 当前只记 `USERNAME`/`USERDOMAIN`/`pid`/`controlExecutionId`。设计稿里写的 `processCreatedAt`、`commandLineSha256` **没有实现**——那需要像 `controlExecution` 那样起一次 PowerShell 查 `Win32_Process`，而 adopt 分支里 `controlExecution` 已经做过一次并留下了 `control-executions\<id>.json`（含 `createdAt`、`commandLineSha256`、`executableSha256`），回执里记 `controlExecutionId` 可以回溯到它。这是个有意的简化，但与设计稿不一致，列出来。
5. **`tests/preparation-retirement-entry.test.mjs` 有一个用例失败，但不是我造成的。** 失败用例是 `adopted and current R1b gates both discover an ancestor worktree HEAD…`（`native-no-git-source` vs 期望 `own-root-head-before-preparation`）。我把 `tools/publish-latest-main.mjs` 还原到 HEAD（摘要实测为 `b27c76018d8f`）后复跑，**同样失败**（`EXITCODE_ON_HEAD=1`），且该测试文件根本不 import `publish-latest-main.mjs`。所以这是既有失败，与本次改动无关；但我也**没有修它**，它仍然红着。
6. **`tests/main-control-upgrade.test.mjs` 另有一个用例失败，也不是我造成的。** 失败用例是 `adopted real Git hook and manual CLI share only v2 tickets; failed fetch cannot reach native preparation`（`ENOENT … prebuild-queue-v2\tickets`）。这一条值得警惕，因为它**确实会走真实 CLI**，所以我按同样方式复核：把文件还原到 HEAD（`b27c7601…`）后复跑，**同一用例、同一 `ENOENT`、同一行**失败（只有临时目录名不同），所以是既有失败。我**没有修它**，它仍然红着。
   - 这两条既有失败（本条与上一条）合计 2 个用例；`tests/control-dependency-update.test.mjs` 与它同批跑，该批 38 个用例 37 通过 1 失败，失败的就是本条。
   - 与 §4 第 2、3 项重建控制包的动作直接相关，做那一步时应先确认这两条既有失败的归属与修复责任（另一会话正在处理 CI 侧门禁）。
7. **分裂状态本身没有被修复，只是被承认和记录。** 现役 Worker 仍停在 `e62dc33a`，Django 在 `2dc377f0`，其中 2 个随 Worker 包安装的 `tools/` 文件仍是旧字节（`tools/operations-system-watchdog.ps1`、`tools/postgres_no_key_backup.py`，实测见 DESIGN.md §0.2）。按设计取舍，`mainCommit` 取 Worker HEAD 使这些留在下一次发布范围内，不会漏发。
