# Opus 独立反审结论（2026-11-01）

反审者未参与本次方案与实现，新上下文、直接核对证据。本文只记录结论与我方复核，不修改被审源码。

## 确认的缺陷

### 1. `assertNoSubmittedApiExport` 对 null/非对象 entry 抛异常（真实缺陷，未修）

[tools/jackyun-export-first-pipeline.ts:124](../../tools/jackyun-export-first-pipeline.ts)

```js
const entry = state.modules?.[module];
if (entry === undefined) return true;   // 不挡 null
return entry.status === "prepared" && ...
```

`entry === undefined` 不覆盖 `null`，`entry.status` 抛 `TypeError: Cannot read properties of null`。我方已复现确认。另外 corrupt JSON、`nlink !== 1`、目录形态会从 `readJsonDurableOr` 抛出。

函数注释声称"包括不可读或非预期状态都返回 false"，与实际行为不符。

**效果上是 fail-safe**：异常从 line 688 的 catch 传出，`exportIntent` 得以保留，不会错误放行。但失败形态有两处不对：

1. 原始 `API_SERVER_CLOCK_UNVERIFIED` **被 TypeError 替换丢失**
2. TypeError 过不了 `classifyJackyunPreflightFailure`，因此**无法走通用闭合路径**，operator 看到误导性错误且该运行需要新的 audited 常量

**修法**：line 124 的守卫应为 `if (entry === null || typeof entry !== "object") return true;`。属独立修复，需单独走 `codex/*` 分支与授权。

### 2. 报告里的测试绝对数错了（资料缺陷）

`REPORT.md` 写"339 项 332 通过 / 7 失败"与基线"335 / 328 / 7"。反审独立复跑（HEAD 与 `9c184426` 全新 worktree，45 套件逐个跑）实测：

| | 报告 | 实测 |
| --- | --- | --- |
| HEAD | 339 / 332 / 7 | **369 / 361 / 8** |
| 基线 | 335 / 328 / 7 | **365 / 358 / 7** |

差值 +4、失败集合逐条相同这两个结论**成立**，但绝对数漏了 `.test.mjs` 三个套件（`jackyun-7792-recovery`、`jackyun-adoption-checks`、`jackyun-audit-adoption`，共 30 项）。我方 `tests/jackyun*.test.ts` 的 glob 不含 `.mjs`。**该数字不能作为未来基线**。

### 3. 第 8 项失败是既有 flake，但正好覆盖本次改动的提交路径

`tests/jackyun-api.test.ts` 的 `real API exporter emits a recoverable bound-download error and resumes with exactly one inventory POST`。反审查明：`taskTimeoutMs: 100` + `pollIntervalMs: 1`（[tests/jackyun-api.test.ts:175](../../tests/jackyun-api.test.ts)），负载下 100ms 预算不够。隔离重跑 6 次全过；3 套件并行时**基线也失败**（4 次中 2 次），HEAD 4/4 通过。

结论：既有 flake、非本次引入。但它是唯一覆盖 `runApiExports` 提交路径的测试，意味着**本次的"全绿"存在负载依赖的覆盖盲区**。

## 证据缺口（非缺陷）

### 4. 新增的 catch 分支零测试覆盖

`grep -rln "assertApiServerClock\|isJackyunServerClockFailure" tests/` 无结果。第 4 项新测试是**手写** plan 模拟修复后的落盘状态，没有驱动 `runApiExports` 或那段 catch。所以"将来时钟失败走通用路径闭合"这一结论建立在手造夹具上，不是建立在真正产生该状态的代码上。缺陷 1 正是这类覆盖本可以抓到的。

### 5. `assertApiServerClock` 无直接单测

`tests/jackyun-api.test.ts:7` 只导入 `apiTaskWindowStart` 与 `apiTaskWindowObserved`。

## 残留风险

### `persist` 超过 5 秒会重现 11055 形态（健康时钟下）

`apiTaskWindowStart` 多一条 `intent - end <= 5000` 约束，`assertApiServerClock` 没有（我方已复核：该函数内无 `intent` 相关判断）。两次调用之间夹着 `mkdir` + `persist`，而 `persist → writeJsonDurable → publishDurableFile` 在 Windows 上**会 spawn powershell.exe**。反审实测 `writeJsonDurable` 耗时 **537–619 ms**。

正常远在 5 秒内，但重负载下 >5 秒会让 `apiTaskWindowStart` 在 `mkdir` 与 `prepared` 控制器**已落盘之后**抛 `API_SERVER_CLOCK_UNVERIFIED` —— 在时钟健康的情况下重现 11055 的形态。

新 catch 分支能正确清掉 intent，但闭合仍会失败：残留的 `prepared` 控制器、甚至**空运行目录**都会被 `assertAbsentEffects` 以 `原运行已存在浏览器、下载、演练或导入证据` 拒绝（反审两种情况都验证过）。该场景需要另一个 audited 常量。

因此提交信息与报告里"零落盘"的说法**条件成立（persist 在 5 秒内完成），不是无条件成立**。

## 反审确认我方判断正确的项

- 两处容差**确实一致**：288 种时钟形态 fuzz（偏移 × 漂移 × 亚秒），`assertApiServerClock` 与 `apiTaskWindowStart` **0 处分歧**
- `serverClock` 在新位置可用且语义正确：`http.serverClock` 是实时 getter，每请求重置，由前一行 `readDirectTasks` 的基线响应赋值
- `clockBeforeSubmit` 分支顺序行为中立；11060 同形态探针被拒；`API_SERVER_CLOCK_MISSING` 不会进入该分支
- `effects.filter(index !== 1)` 索引正确（index 1 = import-runs），且不削弱其余三项（逐一创建后仍被拒）
- 七字段排除清单对"可能已提交"**完整**：`ModuleState` 中仅 `readyObservedAt`、`refreshedBindings` 未列，二者无 `binding` 不可达
- **21 项负例全部真实触发拒绝，无假绿**，另加反审自造 2 项探针。但其中 13 项是被字节 pin 挡住（报 `原控制状态已变化`）而非字段逻辑，字段逻辑目前只在摘要被更新时才可达
- 摘要按 git 存储字节计算、CRLF 免疫：三个 fixture 的 blob 均 0 个 CR，`text: unset`，`core.autocrlf=input`
- 三份生产文件闭合后字节未变；`active.json` 已合法推进到 11070（五表齐全、`completed`），**闭合被真实成功运行消费**
- `manual` 分类正确：改动前该错误分类为 `null`，阻塞所有路径；归 `manual` 只放开到 operator 驱动重试，从不放开自动重放
- 发布记账完整：`PUBLISHED-MAIN.json` 为 `deployed_and_ready`、回执 sha 实测匹配、`sourceRoot` 是冻结发布包而非 worktree
- 修复确已上线：现役 helper bundle 含 `assertApiServerClock`、`audited_11055_server_clock_before_export_submit` 与三个 pin
- `CancelDrain` 是 ValidateSet 一等入口、与 `EndWorkerDrain` 内部同调用，无残留债
- `tsc` 不受影响，五个改动文件均无诊断

## 待办

| 事项 | 性质 | 授权 |
| --- | --- | --- |
| 修 line 124 的 null 守卫 | 代码缺陷 | 需新分支与单独授权 |
| 给 catch 分支补集成测试 | 覆盖缺口 | 同上 |
| 修正 REPORT.md 的测试绝对数 | 资料更正 | 同上（纯文档） |
| `jackyun-api.test.ts:175` 的 100ms 预算 | 既有 flake | 独立事项 |
| persist >5s 的残留风险 | 设计边界 | 需方案讨论 |
