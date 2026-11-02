# 吉客云 11055 时钟失败闭合与写序修复

2026-11-01。分支 `codex/jackyun-clock-closure-20261101`，worktree `D:\codex-worktrees\jackyun-clock-closure-20261101`。

状态（2026-11-02 更新）：首批改动**已合并并上线**（`main` 合并提交 `edb24141`，实现提交 `387ffd82`），
11055 已闭合，11-01 的五表数据由 execution 11070 补齐。下文「状态：未合并」一类的原始表述按本行理解。

随后一次独立反审（`REVIEW-opus-反审.md`）查出三件待修事项，已在分支
`codex/jackyun-review-fixes-20261102` 完成（提交 `cf1af71f` + 本次文档更正），
**未合并、未发布**；详见文末「反审待修项的处理」。

## 故障事实

2026-11-01 凌晨吉客云导入连续三次失败，是两个独立问题叠加。

**11055（定时 00:10）**：`API_SERVER_CLOCK_UNVERIFIED`，抛自 `lib/jackyun/api-clock.ts`。断言要求 `|serverDate - receivedAt| <= 10000`。原控制器记录的实测差值为 **+13.03 秒**：

| 字段 | 值 |
| --- | --- |
| `receivedAt` | 2026-10-31T16:15:18.967Z |
| `serverDate` | 2026-10-31T16:15:32.000Z |
| 差值 | +13.033 秒（容差 10 秒） |

用 `web.jackyun.com`、`www.aliyun.com`、`www.baidu.com`、`www.cloudflare.com` 四个来源交叉测量，一致显示**本机时钟慢约 13 秒**，不是吉客云异常。历史成功运行（11046/11045/11015/11035/11023）的同一差值全部在 -0.9 ~ -2.2 秒区间，属新出现的漂移。根因：`w32time` 服务为 Stopped / Manual，无人校时。

**11057、11058（手动重试）**：错误变为"原运行 n8n-export-first-11055 尚未闭合，且当前执行没有有效续跑许可"。每次重试先在 helper 队列等 5 分钟（`helper_unavailable_wait`），再撞同一断言。重试上下文自报 `kind:"new"`，正是守卫要拒的类型。

## 11055 为何无法闭合

关键事实：`tools/jackyun-api-export.ts` 原顺序是先 `mkdir(runDirectory)` + 持久化 `prepared` 控制器，**再**校验时钟；而 pipeline 层在调 helper 前已写入 plan 的 `exportIntent`。因此一个纯本地断言失败留下了两处痕迹：

- plan 文件含 `exportIntent: "inventory"`
- `outputs/jackyun-import-runs/n8n-export-first-11055/` 目录存在（仅含 `api-controller-state.json`）

控制器自身证明 `submitExport` 从未发出：`status=prepared`，且不含 `exportIntentAt`、`pendingTaskId`、`binding`、`filePath`、`provenance`、`handoffSha256`。平台侧没有本轮导出任务。

但既有闭合入口逐条拒绝（均为实测）：

| 入口 | 拒绝原因 |
| --- | --- |
| `classifyJackyunPreflightFailure` | 返回 `null`，该错误未被分类 |
| `assertEmptyPlan` / `assertEmptyApiChallengePlan` | 要求 plan 不含 `exportIntent` |
| `inspectPreflightZeroEffects` | 同上，且要求 import-runs 目录不存在 |
| `claimJackyunApiResumePermit` | 要求 `status=submitted`，实际 `prepared` |
| `inspectCaptureRetirement` | 要求跨日；11055 的 `runDate` 即当日 |
| `jackyun-preflight-recovery.ts plan 11055` | 实跑 EXIT=1 |

## 本次改动

### 1. 校时提前到任何写盘之前（防复发）

`lib/jackyun/api-clock.ts` 新增 `assertApiServerClock(clock)`，只校验时钟证据本身，容差与 `apiTaskWindowStart` 一致。`tools/jackyun-api-export.ts` 在取得 `serverClock` 后、`mkdir` 与持久化之前调用它。此后时钟漂移失败**零写盘**：无运行目录、无控制器、无 plan intent。

`tools/jackyun-api-export.ts` 另把 `exportIntentAt` 的赋值移到 `apiTaskWindowStart` 之后，使控制器不再出现"校验失败却已标 submit_intent"的状态。

### 2. 错误纳入人工终态分类（防复发）

`lib/jackyun/preflight-failure.ts` 把 `API_SERVER_CLOCK_UNVERIFIED` 与 `API_SERVER_CLOCK_MISSING` 归为 `manual`。归 `manual` 而非 `automatic`，因为重试不改变时钟偏差，必须由操作者先校时。

经此两项，**将来**的时钟失败由通用 `verified_api_preflight_without_business_effects` 路径闭合，无需新增按运行绑定的常量。已由测试覆盖。

### 3. 绑定 11055 的小范围闭合入口（解既存卡点）

`lib/jackyun/preflight-recovery.ts` 新增 `audited11055` 常量与 `inspectAudited11055Controller`，仅在 `executionId === "11055"` 且错误精确为 `API_SERVER_CLOCK_UNVERIFIED` 时启用。它要求全部满足：

- plan、active、controller 三者字节摘要精确匹配审计值
- n8n 证据与审计快照逐字段深相等（含 8 节点序列与 `executionDataSha256`）
- 运行目录内**恰好**只有 `api-controller-state.json`
- 控制器 `version=2`、`transport=session_api_v1`、模块键恰为 `["inventory"]`、`status=prepared`
- 控制器不含 `exportIntentAt`、`pendingTaskId`、`binding`、`filePath`、`provenance`、`handoffSha256`、`attachmentObjectSha256`
- 浏览器事件、校验、下载三类路径均不存在

回执 `reason` 为 `audited_11055_server_clock_before_export_submit`、`status` 为 `closed_before_export`，控制器作为证据保留（故其目录不进入 `absentPaths`）。`assertClosedPreflight` 同步接受该 reason。原计划与 active 字节不变，不标 completed，原 execution 永久拒绝重放。

该入口沿用既有 `audited_843` / `audited_897` / `audited_4098` 的同类做法，不构成跨 execution 接管，也不适用于任何已提交导出、已下载或已开始导入的运行。

## 检查结果

### 测量口径（先看这里，绝对数只在同一口径下可比）

本节的套件数与项数按以下口径测得，换口径数字必变：

- **glob 是两条**：`tests/jackyun*.test.ts`（42 个）**加** `tests/jackyun*.test.mjs`（3 个），共 **45 个套件**。
- **全部套件都用 `--import tsx`**，`.mjs` 也不例外。那三个 `.mjs` 自己 import `.ts` 模块
  （如 `jackyun-7792-recovery.test.mjs` → `tools/jackyun-preflight-recovery.ts`），
  裸跑 `node --test` 会 `ERR_MODULE_NOT_FOUND`，而 node 把这个**加载失败报成「1 项 / 1 失败」**，
  于是既少算该套件的真实项数、又凭空多出一项假失败。带 loader 后三者实为 10 + 3 + 17 = **30 项全通过**。
- **逐套件串行**跑，不并行；并行会让负载敏感的用例偶发失败，污染绝对数。
- 基线在**同一 worktree**内用 `git checkout HEAD~1 --` 还原本次三个改动文件后测得，不跨机器、不跨检出。

命令形如 `node --import tsx --test --test-reporter=tap tests/<suite>`，逐个汇总。

### 结果

| 项目 | 结果 |
| --- | --- |
| `tests/jackyun-api.test.ts`（单套件） | 11 项全通过 |
| `tests/jackyun-export-first.test.ts`（单套件） | 11 项全通过 |
| 45 套件（本分支 HEAD） | **373 项：366 通过 / 7 失败** |
| 45 套件（同 worktree 还原改动后的基线） | **369 项：362 通过 / 7 失败** |
| 失败集合逐条比对 | **完全相同**：新增 0、修复 0（见下） |
| `tsc --noEmit` | 171 项，与既有基线一致，新增 0；三个改动文件均无诊断 |

两次运行的 7 项失败逐条相同，均为既有基线，与本次改动无关；这三个套件都不引用本次改动的
`assertApiServerClock` / `assertNoSubmittedApiExport`：

```
fresh full A-E exports all five files and preserves predecessor facts and evidence
actual sales runner resumes the archived failed contract once and verifies its exact batch
real five-table pipeline resumes response loss at products / inventory / inventory_age / sales / combos
                                                （上行是 5 个独立用例，不是 1 个）
```

项数由 369 增至 373，差值 4 即本次新增的 4 项测试。

**原记录的绝对数已作废。** 本报告初版写「339 / 332 / 7」与基线「335 / 328 / 7」，
漏了三个 `.test.mjs`。独立反审指出该遗漏（正确），但它给出的「369 / 361 / 8」与
基线「365 / 358 / 7」同样不可用：它把 `.mjs` 裸跑了，那「第 8 项失败」就是上述加载失败假象。
两版绝对数都不要再当基线引用；差值 +4 与「失败集合逐条相同」这两个结论在三次测量中一致成立。

全量 `tests/*.test.ts` 未跑完：它在与本次改动无关的客服 UI 套件处长时间无输出（37 分钟），已主动终止。抽取其中一个失败套件 `tests/ai-assistant-safety.test.ts` 单独比对，分支与清空改动后的基线均为 30 通过 / 1 失败，同为既有失败。

新增测试覆盖：正例（闭合成功、三份原字节不变、闭合后拒绝重放）、21 种负例（六类已提交状态、字节篡改、身份不符、三类业务产物、额外文件、证据时间/状态/重试变化、追加后继节点）、不泛化（同形态的 11060 被拒）、未来场景（零写盘后走通用路径，且一旦出现 `submitted` 控制器立即拒绝）。

## 边界

- 本次只改必需程序代码并补测试，未执行功能验收；五表实际导入是否正确由用户上线后判断。
- 校时已在生产本机完成（`w32time` 设为 Automatic、同步源 `cn.pool.ntp.org`、Leap=0、stratum 3、偏移 <0.1s，吉客云差值回到 -0.5s）。注意 `time.windows.com` 在本网络取不到时间数据，且 `w32tm /resync` 失败仍返回 exit 0，不能以退出码判断成败。
- 11055 的闭合**尚未执行**，须在合并后、以当时的真实文件与 n8n 证据重新生成提案再 apply；本文档内的摘要是当前字节的记录，不预先授权任何写入。

## 反审待修项的处理（2026-11-02）

分支 `codex/jackyun-review-fixes-20261102`，提交 `cf1af71f`（代码与测试）+ 本次文档更正。
反审结论见 [REVIEW-opus-反审.md](REVIEW-opus-反审.md)。**未合并、未发布。**

### 1. `assertNoSubmittedApiExport` 的 null 守卫（已修）

`tools/jackyun-export-first-pipeline.ts` 原守卫 `entry === undefined` 挡不住 `null`，
`entry.status` 抛 `TypeError`。该 TypeError 会**替换掉**原始的 `API_SERVER_CLOCK_UNVERIFIED`，
于是过不了 `classifyJackyunPreflightFailure`，走不了通用闭合路径。

**取向与反审建议相反。** 反审建议 null 也 `return true`（放行）；实际改为**一律 `return false`**，
并额外接住 `readJsonDurableOr` 可能抛出的 corrupt JSON、`nlink !== 1`、目录形态，
保证该函数**不再抛任何异常**。依据：

- 该函数的返回值只有一个用途——`true` 时允许调用方删掉 plan 的 `exportIntent`。
  而删掉 `exportIntent` 正是通用闭合路径的硬性入口条件
  （`lib/jackyun/preflight-recovery.ts:372` 的 `assertEmptyApiChallengePlan` 要求 plan 不含该键）。
- 所以 `true` 的语义是「已证明从未提交」。null、非对象、数组、读不出来的控制器
  **都不构成该证明**；按 `true` 放行等于把「证据不可读」当成「证据表明没提交」，
  那才是真正危险的方向。函数原注释（「包括不可读或非预期状态都返回 false」）才是本意，
  是实现偏离了注释。
- 两种返回值都不会丢失原始错误：时钟失败归 `manual`，`pageFailure` 为 false，
  控制流必定走到 `throw error` 原样重抛。**唯一**能替换原始错误的就是该函数自身抛异常，
  这正是本次消除的。

### 2. catch 分支的真实驱动测试（已补）

原第 4 项新测试是**手写 plan 夹具**模拟修复后的落盘状态，没有驱动 `runApiExports`
或 pipeline 的 catch，所以「将来时钟失败走通用路径闭合」这一结论当时建立在手造夹具上。
新增 4 项（即测量差值 +4）：

- `tests/jackyun-api.test.ts`：`assertApiServerClock` 直接单测（含 11055 的 +13.03 秒实测形态、
  窗口倒置/超宽、非整秒 `serverDate`、`MISSING` 分支，并核对与 `apiTaskWindowStart` 容差一致）；
  以及真实 `runApiExports` 在时钟漂移下**零写盘**（无运行目录、无控制器、无事件树、未发 POST）。
- `tests/jackyun-export-first.test.ts`：用**真实 `runApiExports`** + 漂移 `serverClock`
  驱动 pipeline 的 catch，断言 `exportIntent` 被清掉、无残留产物、且错误码未被替换；
  另覆盖四种退化控制器（null / 非对象 / 数组 / corrupt JSON）必须**保留** `exportIntent`。

**绊线已验证**（两次，分别由实现者与审查者执行）：把守卫临时还原成旧形态后，
「null module entry」子用例精确复现 `TypeError: Cannot read properties of null (reading 'status')`，
位置正是旧代码的 `entry.status` 行；恢复后全绿。即这些测试确实能抓到该缺陷。

### 3. 既有 flake 的真因与修法（已修，未放大超时）

`tests/jackyun-api.test.ts` 的 `real API exporter emits a recoverable bound-download error...`
偶发失败。反审归因为 `taskTimeoutMs: 100` + `pollIntervalMs: 1` 在负载下不够。
**实测真因更底层：夹具自己的时钟不自洽。**

旧夹具 `receivedAt = now`（带毫秒）而 `serverDate = floor(now)`（整秒），二者最多差 999 ms。
`apiTaskWindowObserved` 做 `observed = now + serverDate - receivedAt`，该偏差恒为负，
把任务窗口**上界往前拉**最多 999 ms；而 `matchJackyunExportTask` 要求
`task.createdAt <= observed`，夹具又把 `gmtCreate` 设成 `floor(提交时刻)`。
于是当 `receivedAt` 落在一秒靠后、提交发生在下一秒初时，刚建出来的任务有最多约 1 秒
「还匹配不上」，100 ms 预算不够等它。

用固定相位的探针**确定性复现**（不靠负载）：

| `receivedAt` 相位 | 提交相位 | 预算 | 结果 |
| --- | --- | --- | --- |
| 900 ms | 50 ms | 100 ms | `API_ORIGINAL_EXPORT_TASK_PENDING`（poll 8 次后超时） |
| 900 ms | 50 ms | 1500 ms | 正常 |
| 0 ms | 50 ms | 100 ms | 正常 |

**修法是把夹具时钟改成自洽**（`requestStartedAt == receivedAt == serverDate ==` 整秒），
`taskTimeoutMs: 100` **保持不动**——不放大超时，以免掩盖真实性能问题。
自洽后在最坏相位（990/5、990/50、990/500、990/995）均一次 poll 通过。
这也解释了反审「隔离重跑 6 次全过、并行时基线也失败」的现象：
并行只是改变相位命中概率，并非预算绝对不足。

## 仍未处理：`persist` 超过 5 秒会重现 11055 形态

反审列为「设计边界，需方案讨论」，**本次未改**，但已实测复现，且比反审描述的更容易触发。

机制：`entry.serverClock.receivedAt` 在 `mkdir` + `persist` **之前**采集，
`exportIntentAt` 在其**之后**采集，而 `apiTaskWindowStart` 要求 `intent - end <= 5000`。
所以该差值等于 **persist 自身的耗时**，与任何时钟偏差无关。

探针用放慢 `persist` 内部的 `assertOwned` 代替重负载下的 powershell 发布延迟（零 CPU 占用）：

| persist 额外延迟 | `exportIntentAt - receivedAt` | 结果 |
| --- | --- | --- |
| 0 ms | 726 ms | 正常 |
| 900 ms | 2588 ms | 正常 |
| 1800 ms | 4286 ms | 正常（已接近上限） |
| **2200 ms** | — | **`API_SERVER_CLOCK_UNVERIFIED`，提交数 0** |

即 persist 往返约 **2.2 秒**（不是 5 秒，因为基线差值本身已有约 0.7 秒且该路径多次 persist）
就足以在**时钟完全健康**时抛出时钟错误。反审实测 `writeJsonDurable` 单次 537–619 ms，
故余量比「5 秒」听起来小得多。

此时新增的 catch 分支能正确清掉 `exportIntent`，但 `prepared` 控制器已落盘，
`assertAbsentEffects` 仍会以「原运行已存在浏览器、下载、演练或导入证据」拒绝闭合，
需要另一个 audited 常量。因此提交信息与本报告中「零落盘」的说法
**条件成立（persist 在 5 秒内完成），不是无条件成立**。

可能方向（均未实施，需先定方案）：把 `exportIntentAt` 改为在 persist 之前采集、
或让 `assertApiServerClock` 同时承担 intent 约束、或把仅含 `prepared` 的控制器纳入零效果证明。
三者都改动「可能已提交」的判定边界，不宜顺手改。
