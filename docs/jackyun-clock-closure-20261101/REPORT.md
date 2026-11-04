# 吉客云 11055 时钟失败闭合与写序修复

2026-11-01。分支 `codex/jackyun-clock-closure-20261101`，worktree `D:\codex-worktrees\jackyun-clock-closure-20261101`。

状态（2026-11-02 更新）：首批改动**已合并并上线**（`main` 合并提交 `edb24141`，实现提交 `387ffd82`），
原实施记录称 11055 已闭合，11-01 的五表数据由 execution 11070 补齐；本轮仅引用该历史状态，未重新核验生产。

随后一次独立反审（`REVIEW-opus-反审.md`）查出三件待修事项，已在分支
`codex/jackyun-review-fixes-20261102` 完成（提交 `cf1af71f` + 本次文档更正），
**未合并、未发布**；详见文末「反审待修项的处理」。2026-11-02 再次独立反审后，
本报告更正历史统计归因、时钟夹具与 persist 探针解释；本轮修订见
[小范围修订记录](../jackyun-review-revision-20261102/REPORT.md)。
[REVIEW-opus-反审.md](REVIEW-opus-反审.md) 保留原作者记录，作为历史证据，不以本轮更正覆盖原文。

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

`lib/jackyun/api-clock.ts` 新增 `assertApiServerClock(clock)`，只校验时钟证据本身，容差与 `apiTaskWindowStart` 一致。`tools/jackyun-api-export.ts` 在取得 `serverClock` 后、`mkdir` 与持久化之前调用它。该前置检查发现漂移时 exporter **零写盘**；pipeline 在能证明未提交且所有权与持久化正常时清除 plan intent。此结论不涵盖后续 intent 年龄检查或 POST 后观察时钟失败。

`tools/jackyun-api-export.ts` 另把 `exportIntentAt` 的赋值移到 `apiTaskWindowStart` 之后，使控制器不再出现"校验失败却已标 submit_intent"的状态。

### 2. 错误纳入人工终态分类（防复发）

`lib/jackyun/preflight-failure.ts` 把 `API_SERVER_CLOCK_UNVERIFIED` 与 `API_SERVER_CLOCK_MISSING` 归为 `manual`。归 `manual` 而非 `automatic`，因为重试不改变时钟偏差，必须由操作者先校时。

经此两项，前置时钟检查失败且无其他效果时可由通用 `verified_api_preflight_without_business_effects` 路径闭合，无需新增按运行绑定的常量。已由测试覆盖。错误码本身不能证明零提交；后续落盘或已提交场景仍按原证据与目录门禁处理。

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

### 轮次、源码与文件集合

不同轮次的绝对数须同时注明提交与集合，不能混比：

| 轮次与源码 | TS 集合项数 | 三套 MJS 项数 | 扩展集合项数 |
| --- | ---: | ---: | ---: |
| 原基线 `9c184426` | 335 | 30 | 365 |
| 首批修复 `387ffd82` | 339 | 30 | 369 |
| 追加修复基线 `557654fe` | 339 | 30 | 369 |
| 追加修复候选 `42b89d20` | 343 | 30 | 373 |

前两行由原报告明确限定的 `tests/jackyun*.test.ts`、归档反审和源码增量核对得到，
不是本轮重跑旧提交的结果。原 TS 统计 339/332/7 与 335/328/7 保留其集合含义，不能因扩入 MJS 宣布作废。
`557654fe` 已包含首批新增 4 项；`42b89d20` 在其上再新增 API/export-first 各 2 项。

2026-11-02 独立实测只比较后两行：固定同一 45 套（42 TS + 3 MJS），每套串行运行
`node --import tsx --test --test-reporter=tap tests/<suite>`。两侧精确快照与原候选隔离，
每套保存完整 stdout/stderr、退出码和 TAP 摘要。90 份有效结果无取消、跳过、todo、最终超时或摘要缺口。
此前 240 秒测量预算不足与一次续测中断保留为未完成尝试，不计功能失败；必要项续测至 600 秒。

### 追加修复候选的独立结果（不是本轮修订提交的全套结果）

| 对象 | 套件 | tests / pass / fail |
| --- | ---: | --- |
| 基线 `557654fe` | 45 | 369 / 362 / 7 |
| 候选 `42b89d20` | 45 | 373 / 366 / 7 |
| 候选 API / export-first 单套 | 各 1 | 各 11 / 11 / 0 |

这两侧 7 项失败名称与失败阶段逐条一致；新增 4 项全部通过。失败均在销售预检响应不符合当前契约时停止，
其中两项外层断言本期待响应丢失错误，却先收到销售预检错误。此判断来自两侧完整失败输出和调用栈，
不是以“套件不直接引用时钟守卫”推断无关。失败名称为：

```
fresh full A-E exports all five files and preserves predecessor facts and evidence
actual sales runner resumes the archived failed contract once and verifies its exact batch
real five-table pipeline resumes response loss at products / inventory / inventory_age / sales / combos
                                                （上行是 5 个独立用例，不是 1 个）
```

归档反审记录的 `387ffd82` 369/361/8 对 `9c184426` 365/358/7 明确把额外第 8 失败命名为
API bound-download 用例的偶发失败。本报告此前将其改归因为裸跑 MJS 的 loader 失败，缺少历史命令证据，现撤回该归因。
本轮指定对照中 `jackyun-7792-recovery.test.mjs` 裸跑为 1/0/1、exit 1、`ERR_MODULE_NOT_FOUND`，
带 loader 为 10/10/0；另两套带 loader 为 3/3/0 与 17/17/0。该对照只证明当前加载方式影响结果，
不能反推历史曾裸跑，也不能将历史额外 flake 改写成加载失败。因此不再声称“三轮失败集合完全相同”。

独立原始证据与方法见 `D:/codex-artifacts/jackyun-independent-review-20261102/sol-measurement/REPORT.md`、
`final-results.json` 和 `per-suite-comparison.md`。原小型统计器存在未记录退出码/超时、缺摘要可跳过、
只抓父层失败名等限制；重新解析本次完整输出仍得到同一汇总，不能据潜在缺口否定本次数字。

原实现者另记录 `tsc --noEmit` 为 171 项、与其基线一致，三个改动文件无诊断；本轮未重复该检查。

全量 `tests/*.test.ts` 未跑完：它在与本次改动无关的客服 UI 套件处长时间无输出（37 分钟），已主动终止。抽取其中一个失败套件 `tests/ai-assistant-safety.test.ts` 单独比对，分支与清空改动后的基线均为 30 通过 / 1 失败，同为既有失败。

新增测试覆盖：正例（闭合成功、三份原字节不变、闭合后拒绝重放）、21 种负例（六类已提交状态、字节篡改、身份不符、三类业务产物、额外文件、证据时间/状态/重试变化、追加后继节点）、不泛化（同形态的 11060 被拒）、未来场景（零写盘后走通用路径，且一旦出现 `submitted` 控制器立即拒绝）。

## 边界

- 本次只改必需程序代码并补测试，未执行功能验收；五表实际导入是否正确由用户上线后判断。
- 校时已在生产本机完成（`w32time` 设为 Automatic、同步源 `cn.pool.ntp.org`、Leap=0、stratum 3、偏移 <0.1s，吉客云差值回到 -0.5s）。注意 `time.windows.com` 在本网络取不到时间数据，且 `w32tm /resync` 失败仍返回 exit 0，不能以退出码判断成败。
- 首版“11055 闭合尚未执行”是当时的历史时点，已由顶部引用的后续记录更新；本轮未重新核验或执行闭合、补跑、校时与生产写入。历史摘要和记录均不授权未来写入。

## 反审待修项的处理（2026-11-02）

分支 `codex/jackyun-review-fixes-20261102`，提交 `cf1af71f`（代码与测试）+ 本次文档更正。
反审结论见 [REVIEW-opus-反审.md](REVIEW-opus-反审.md)。**未合并、未发布。**

### 1. `assertNoSubmittedApiExport` 的 null 守卫（已修）

`tools/jackyun-export-first-pipeline.ts` 原守卫 `entry === undefined` 挡不住 `null`，
`entry.status` 抛 `TypeError`。该 TypeError 会**替换掉**原始的 `API_SERVER_CLOCK_UNVERIFIED`，
于是过不了 `classifyJackyunPreflightFailure`，走不了通用闭合路径。

**取向与反审建议相反。** 反审建议 null 也 `return true`（放行）；实际改为**一律 `return false`**，
并额外接住 `readJsonDurableOr` 可能抛出的 corrupt JSON、`nlink !== 1`、目录形态，
避免读取或退化 entry 导致该守卫自身遮蔽原时钟错误。依据：

- 该函数的返回值只有一个用途——`true` 时允许调用方删掉 plan 的 `exportIntent`。
  而删掉 `exportIntent` 正是通用闭合路径的硬性入口条件
  （`lib/jackyun/preflight-recovery.ts:372` 的 `assertEmptyApiChallengePlan` 要求 plan 不含该键）。
- 所以 `true` 的语义是「已证明从未提交」。null、非对象、数组、读不出来的控制器
  **都不构成该证明**；按 `true` 放行等于把「证据不可读」当成「证据表明没提交」，
  那才是真正危险的方向。函数原注释（「包括不可读或非预期状态都返回 false」）才是本意，
  是实现偏离了注释。
- 守卫正常返回后可继续到 `throw error`；本次消除的是守卫自身对原时钟错误的遮蔽。
  后续 `assertOwned`、计划持久化或锁释放仍可能抛错，不能保证整个 catch 无条件保留原 Error，
  也不应为此吞掉所有权或写入失败。

### 2. catch 分支的真实驱动测试（已补）

原第 4 项新测试是**手写 plan 夹具**模拟修复后的落盘状态，没有驱动 `runApiExports`
或 pipeline 的 catch，所以「将来时钟失败走通用路径闭合」这一结论当时建立在手造夹具上。
新增 4 项（即测量差值 +4）：

- `tests/jackyun-api.test.ts`：`assertApiServerClock` 直接单测（含 11055 的 +13.03 秒实测形态、
  窗口倒置/超宽、非整秒 `serverDate`、`MISSING` 分支，并核对与 `apiTaskWindowStart` 容差一致）；
  以及真实 `runApiExports` 在时钟漂移下**零写盘**（无运行目录、无控制器、无事件树、未发 POST）。
- `tests/jackyun-export-first.test.ts`：用**真实 `runApiExports`** + 漂移 `serverClock`
  驱动 pipeline 的 catch，断言 `exportIntent` 被清掉、无残留产物、且错误码未被替换；
  另以注入 adapter 故障写四种退化控制器（null / 非对象 / 数组 / corrupt JSON），驱动真实 catch 并要求**保留** `exportIntent`；
  不代表正常 exporter 会生成这些损坏状态。本轮另将 pipeline 漂移夹具改为合法整秒 13000ms，
  API 单测在原用例内验证整秒日期下 ±10000ms 等号允许、±11000ms 拒绝，保留独立非整秒检查。

**绊线已验证**（两次，分别由实现者与审查者执行）：把守卫临时还原成旧形态后，
「null module entry」子用例精确复现 `TypeError: Cannot read properties of null (reading 'status')`，
位置正是旧代码的 `entry.status` 行；恢复后全绿。即这些测试确实能抓到该缺陷。

### 3. 既有 flake 的相位机制与夹具隔离（未放大超时）

`tests/jackyun-api.test.ts` 的 `real API exporter emits a recoverable bound-download error...`
偶发失败。反审归因为 `taskTimeoutMs: 100` + `pollIntervalMs: 1` 在负载下不够。
固定相位探针支持：时钟量化偏差和短轮询预算共同造成该失败，不能将预算排除，也不能据此确定历史每次失败的唯一成因。

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

夹具选择零偏差（`requestStartedAt == receivedAt == serverDate ==` 整秒）来隔离下载恢复测试，
`taskTimeoutMs: 100` 保持不动。原探针在四个指定提交相位均一次 poll 通过；这是样本，不是穷尽调度保证。
真实 HTTP Date 本来通常整秒，而 receivedAt 保留毫秒，也会出现同形态量化/传输偏差；旧夹具并非物理上不自洽，
新夹具也不意味着生产接收时间应取整。生产默认预算 300000ms，本轮没有量化生产发生率。
并行可能改变相位与等待，不能只据并行复现归因 CPU 负载。

## 仍未处理：`persist` 超过 5 秒会重现 11055 形态

反审列为「设计边界，需方案讨论」，**本次未改**。独立聚焦探针已证明可达，生产触发概率未知。

机制：`entry.serverClock.receivedAt` 在 `mkdir` + `persist` **之前**采集，
`exportIntentAt` 在其**之后**采集，而 `apiTaskWindowStart` 要求 `intent - end <= 5000`。
该差值包含 mkdir、一次 prepared persist 及其他开销；这次 persist 内部为前后两次 `assertOwned` 加 durable write。
健康时钟也可能因这段等待超出年龄门槛而失败。

探针用放慢 `persist` 内部的 `assertOwned` 代替重负载下的 powershell 发布延迟（零 CPU 占用）：

原实现者探针的注入单位是**每次 `assertOwned`**，不是 persist 总耗时；以下历史样本保留其数值与局限：

| 每次 assertOwned 注入 | `exportIntentAt - receivedAt` | 原探针记录 |
| --- | --- | --- |
| 0 ms | 726 ms | 正常 |
| 900 ms | 2588 ms | 正常 |
| 1800 ms | 4286 ms | 正常（已接近上限） |
| **2200 ms** | — | **`API_SERVER_CLOCK_UNVERIFIED`，提交数 0** |

2200ms 在临界 prepared persist 内累计约 `2×2200ms + durable write + 其他开销`，
不能解释为“persist 只要 2.2 秒”或累加整条流程所有 persist。
独立复跑 0/900/1800/2200ms 注入的 gap 为 660/2353/4254/4975ms，均提交一次；2200ms 不是固定阈值。
只在时钟采样后的临界两次检查各注入 2600ms，独立聚焦探针得到时钟错误、零 POST、无 exportIntentAt 的 prepared 残留；
失败后读回证据年龄 6059ms，并非精确拒绝瞬间的 gap。60 秒测量超时不是功能失败，原记录及补测保留。
这些合成 HTTP 与人工延迟探针保留真实 durable 写路径，但不代表生产延迟分布；无生产尾延迟和调用频率样本，不能给概率。

此时新增的 catch 分支能正确清掉 `exportIntent`，但 `prepared` 控制器已落盘，
`assertAbsentEffects` 仍会以「原运行已存在浏览器、下载、演练或导入证据」拒绝闭合，
仍需人工审计或未来有限的 prepared-only 恢复协议；不要求每次新增 audited 常量。
因此“零落盘”只适用于 mkdir 前的前置时钟检查失败，不能覆盖落盘后年龄检查失败。

可能方向（均未实施，需先定方案）：把 `exportIntentAt` 改为在 persist 之前采集、
或让 `assertApiServerClock` 同时承担 intent 约束、或把仅含 `prepared` 的控制器纳入零效果证明。
前移同一 intent 及完整检查可局部消除这个落盘后拒绝窗口，但 intent 是逻辑意图时间，不保证真实 POST 新鲜度；
仅改 helper 参数而不改时序无效；prepared-only 方案则扩恢复协议，需要完整运行身份、证据与无其他效果证明。
本轮只记录取舍，不实现这些方案，不新增生产门禁。
