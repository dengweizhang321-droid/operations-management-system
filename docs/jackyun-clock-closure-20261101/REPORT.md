# 吉客云 11055 时钟失败闭合与写序修复

2026-11-01。分支 `codex/jackyun-clock-closure-20261101`，worktree `D:\codex-worktrees\jackyun-clock-closure-20261101`。

状态：**代码与资料已就绪，未合并、未发布**。生产侧 `active.json`、原计划和原控制器字节未改动；11055 尚未闭合。

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

| 项目 | 结果 |
| --- | --- |
| `tests/jackyun-preflight-recovery.test.ts` | 36 通过 / 0 失败（新增 4 项） |
| `tests/jackyun*.test.ts`（本分支） | 339 项：332 通过 / 7 失败 |
| `tests/jackyun*.test.ts`（同 worktree 清空改动后的基线） | 335 项：328 通过 / 7 失败 |
| 失败集合逐条比对 | **完全相同**：新增 0、修复 0（见下） |
| `tsc --noEmit` | 171 项，与同一 worktree 清空改动后实测基线 171 **逐条相同**，新增 0、减少 0；五个改动文件均无诊断 |

两次运行的 7 项失败逐条相同，均为既有基线，与本次改动无关：

```
fresh full A-E exports all five files and preserves predecessor facts and evidence
actual sales runner resumes the archived failed contract once and verifies its exact batch
real five-table pipeline resumes response loss at products / inventory / inventory_age / sales / combos
```

项数由 335 增至 339，差值 4 即本次新增的 4 项测试。

全量 `tests/*.test.ts` 未跑完：它在与本次改动无关的客服 UI 套件处长时间无输出（37 分钟），已主动终止。抽取其中一个失败套件 `tests/ai-assistant-safety.test.ts` 单独比对，分支与清空改动后的基线均为 30 通过 / 1 失败，同为既有失败。

新增测试覆盖：正例（闭合成功、三份原字节不变、闭合后拒绝重放）、21 种负例（六类已提交状态、字节篡改、身份不符、三类业务产物、额外文件、证据时间/状态/重试变化、追加后继节点）、不泛化（同形态的 11060 被拒）、未来场景（零写盘后走通用路径，且一旦出现 `submitted` 控制器立即拒绝）。

## 边界

- 本次只改必需程序代码并补测试，未执行功能验收；五表实际导入是否正确由用户上线后判断。
- 校时已在生产本机完成（`w32time` 设为 Automatic、同步源 `cn.pool.ntp.org`、Leap=0、stratum 3、偏移 <0.1s，吉客云差值回到 -0.5s）。注意 `time.windows.com` 在本网络取不到时间数据，且 `w32tm /resync` 失败仍返回 exit 0，不能以退出码判断成败。
- 11055 的闭合**尚未执行**，须在合并后、以当时的真实文件与 n8n 证据重新生成提案再 apply；本文档内的摘要是当前字节的记录，不预先授权任何写入。
