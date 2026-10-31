# 三份方案施工协调（2026-10-27）

- 性质：**协调与核查记录，lead 全程未改业务代码、未合并、未发布**
- 协调对象：三份方案
  1. `D:\.codex\worktrees\board-main\运营管理系统\docs\施工\BOARD.md`（发布提速施工看板）
  2. `C:\Users\86137\.kiro\crew\workspace\reviews\2026-10-24-系统全面审查\00-总结与改造路线.md`（全面审查 40 项 + 阶段 0–4 路线）
  3. `docs/n8n-daily-download-stability-20261024/`（n8n 稳定性，含 STEP11 京东物流方案、界面操作清单）
- 分工：sonnet 施工写代码，lead（本会话）审查与写方案
- 授权边界：本次只到「在分支上完成改动并自测」。合并到 main、准备制品、发布上线各自须用户单独授权（AGENTS.md 规则 4）

## 一、贯穿三份方案的根因：本地检出落后远端 17 个提交

协调开始时 `origin/main` = `e0dffdec`，本地 main = `313c8d35`，**纯 fast-forward 无分叉**。

这个事实一开始被判反了（lead 和一名核查代理都先以为本地领先），纠正后三份方案里「代码不在 main」类结论必须重新分类：

| 方案 | 原结论 | 核查后 |
| --- | --- | --- |
| BOARD.md | 基线 main = `e0dffdec` | **没有过期**。它基于 `e0dffdec` 写的，恰是新的那一头。S05d/S08/S19 的 grep=0、S16=30 在远端最新点逐字节复核一致 |
| 审查 #26（钉钉提醒） | 转人工出口无人通知 | **修复就在本地缺的 17 个提交里**（`f2bbbc0b` → `bb3dd101`）。在落后基线上数会得出错误缺口数 |
| STEP11（京东物流） | 源码不在 main，改不了失败逻辑 | **三处前提不成立**，见第三节 |

教训：在落后的检出上做「某代码不在 main」的判断会系统性出错。这是本仓库记忆里已记过两次的同类坑（`fresh-restart.ts`「已过时」、`release-scope-plan.mjs`「不存在」）的第三次变体。

### 处理

已 fast-forward 到 `e0dffdec`。拉取前工作区有 10 个文件未提交改动，两个会话均否认归属，**无人认领**，已按用户决定先保全：

- `git stash` → `stash@{0}`，标签含说明
- 补丁：`未提交改动备份-20261027.patch`（473 行）
- 全文快照：`文件快照/`（10 个文件）

两条独立恢复路径。**这批改动未被丢弃，去向待用户决定。**

其中 `AGENTS.md` 的改动方向值得单独提醒：它把远端更严的授权措辞改松了。origin/main 第 4 条原文含「这三步每一步都必须单独取得用户对本次该步骤的明确授权」及「不得通过 hook、队列或后台任务自动跨入未授权步骤」，工作树版本删去了这些并压缩成一句。考虑到用户在另一会话明确要求「每一步都需要我授权」，远端那版更贴合该要求。

另一个文件 `tools/worker-local-release-rotation.mjs` 曾被提示有「生产者资格失败」风险，**实测排除**：工作树字节哈希 `5171f548…`，与 origin/main 完全相同且在已登记代际内（`tools/preparation-producer-qualification.mjs` 注册 5 个哈希，含此值）。`git diff` 显示 118 行变化只是因为拿落后 17 步的 HEAD 作基线。

## 二、审查报告阶段 0：实测新基线

报告以 `36668589` 为准写于 10-24，部分数字已失真。在 `e0dffdec` 上实测：

| # | 项 | 结论 | 实测证据 |
| --- | --- | --- | --- |
| 1 | 生产附件与密钥在开发 git 目录 | **仍成立，且恶化** | `.wrangler/state` 已 **17 GB**（报告写 8.3 GB）；`.dev.vars` 2402 字节；`.gitignore:45,54` 确认未入库但仍在开发目录 |
| 2 | 54 个写接口无同源校验 | **主闸门已修复**，2 子项仍在 | 闸门 `worker/index.ts:189-192` → `worker/same-origin-write-gate.ts:104-119`，覆盖 `/api/` 下 POST/PUT/PATCH/DELETE，豁免 12 条且**无浏览器/n8n 豁免**（`525ad36b`+`3cda84ef`）。仍在：`app/api/jackyun/session/open/route.ts:21` 默认端口仍 9223；`lib/auth/authorization.ts:19` 本地直连一律 `role:"admin"` |
| 3 | 工作区落后、worktree 堆积 | **仍成立，数字全变** | 落后 **17**（非 563）；未提交 **15**（非 491）；worktree **211**（非 165，**不降反增**） |
| 4 | 生产代码从 `tests/legacy` 导入 | **仍成立** | `lib/market/admin-service.ts:2`、`lib/market/annotation-service.ts:12` |
| 22 | xlsx 漏洞版本 + 双锁文件 | **仍成立** | `package.json:80` = `"xlsx": "0.18.5"`；两份锁文件均在 |
| 26 | 转人工出口无人通知 | **已修复，覆盖不全** | 见第四节 |

**照搬报告原数字派工会出错**，须以本次实测为新基线。

## 三、STEP11 京东物流方案：三处前提不成立

| STEP11 的断言 | 实测 |
| --- | --- |
| `tools/jd-logistics-n8n-pipeline.ts` 不在 main，`git ls-files` = 0，工作目录也没有 | **在**。HEAD 与 `e0dffdec` 均正常跟踪，35405 字节，工作树也有，由 `dc1e80d9` 引入 |
| `SOURCE_COUNT_UNSTABLE` 是「现在卡住的这个」 | **已修复**。`tools/jd-logistics-export.ts:255-263` 对 `inventory_snapshot` 提前返回，注释写明 "A late default query can overwrite that list's count"，正是 10-17 诊断的请求竞争。修复提交 `e07fbe64` 时间 **2026-10-17 13:46**，晚于 STEP11 所列最后一次失败（10-17 11:18）两个半小时，且已在 main 上 |
| 5 个恢复工具全部只在禁区目录 `.codex-tmp/` | **5 个全在主干**（`known-flow`、`known-four-imports`、`known-two-downloads`、`login-9851`、`preexport`）。整句错误 |
| 线上跑的物流代码，仓库主干里没有 | 不成立，但错法不同。helper 含 42 处 `jd-logistics` 路由，但它是 `tools/build-worker-helper.mjs` 从主干源码打包的产物（见 `tools/worker-local-release.mjs:1626-1634`），不是独立代码。不存在「线上代码脱离主干」 |

根因早已查清并记录在 `docs/jd-snapshot-count-diagnosis-20261017/REPORT.md`：页面自身那次默认查询（`whStatus=2`，600 条）晚到，覆盖了全仓查询（`whStatus=0`，900 条）的结果——请求竞争，不是登录失效或平台门槛。该报告还写明了优化方向，`e07fbe64` 即其落实。

**所以 STEP11 的三个选项（A 清清单试跑 / B 改定时到下午 / C 把源码合进 main）都不是真正该做的事。** 选项 C 指向一个不存在的任务。

### 修复已在生产运行（lead 独立实测）

不只在主干。当前最新制品 `D:\teruisi-runtime\teruisi-worker-sales\releases\20261027T061221Z-298f565cfaaad6f6\helper\tmall-workflow-helper.mjs` **第 15813 行**即 `if (options.sourceKind === "inventory_snapshot") {` 提前返回分支，函数名命中 5 次。

**工具陷阱（已两人踩中）**：不要用 grep 找那条注释来判断修复是否打进制品——打包会剥掉部分注释，grep 注释返回 0 会误判成「没打进去」。**必须看函数体。**

另一条边界：`current-deployment.json` 指向 8 月 29 日的 release，文件时间戳也是 8 月 30 日，**不是当前生效的切换指针**，不能用它判断生产在跑哪个版本。

### 真正剩下的唯一待办

n8n 会话独立复核确认：那份卡住的清单（`jdl-794e9ecf`，executionId 9896）第 4 个数据集 `inventory_snapshot` 正好停在 `stage=exporting`，就是 `e07fbe64` 提前返回所覆盖的路径。清单现已清空（`active.json` 只剩 `jackyun-export-first` 一个），定时已由 08:00 改到 10:25，开关仍关。

**所以选项 A 的清单部分已完成，剩下的只有：在 n8n 界面打开 `JdLogisticsDaily2026`，让它明天 10:25 跑一次，看修复后的真实结果。** 这是用户的界面操作，不是施工任务。

### 两条实时状态（影响界面清单）

- n8n 今天 11:51 重启过（审计日志 8 条 `mode=init`），原记录的「3 条假开」**已自动变成真生效**，界面清单第一组不用做了。
- 吉客云今天 10:07 手工跑的 11013 五表全成功；`active.json` 虽指向它但 `phase=completed`，不命中任何阻断分支（`tools/jackyun-export-first-pipeline.ts:456-470`），今晚 00:10 会正常建新计划。

## 四、n8n 转人工告警：缺口 11 条正式流

机制已就位：`automation/n8n/data-import-hourly-safe-retry.workflow.json`（id `TeruisiHourlyRetry2026`）13 个节点，含「转人工发钉钉提醒」→ `POST http://127.0.0.1:3000/api/ai/channels`，后端 `backend/ai_assistant/channels.py:44` 真实发往 `oapi.dingtalk.com/robot/send`。

39 个 `*.workflow.json` 中 27 个已挂 `errorWorkflow`，12 个没挂；扣除告警目标自身，**真实缺口 11 条**。

**关键安全结论**：重试流内有 `const targets = {...}` 白名单（13 个 workflowId → 各自重试 webhook）。不在白名单的失败归入 `droppedFailures`，走「收集被丢弃的终局失败」节点**只发钉钉提醒、不触发自动重试**。

故缺口分两类：

| 类 | 条数 | 性质 |
| --- | --- | --- |
| id 不在白名单 | 9 | 挂载**纯增告警、零业务副作用** |
| id 在白名单（吉客云 `J8kY2mQ5vR7sT4pN`） | 2 | 挂载会**引入此前没有的自动重试**，性质不同，须单独决定 |

### 时序风险（已向用户提醒）

`界面操作清单-20261027.md` 要求今天在 n8n 界面开 12 条流，其中京东客服 4 店、京东物流、天猫仓库**正是没接 errorWorkflow 的那批**。开了它们，失败是静默的——没人收到提醒。

**补挂载应排在开流程之前。**

## 五、本次派工

两组并行，文件零重叠，且均不碰 `tools/` 发布链（4 个会话在用）。

| 组 | 内容 | 分支 | 文件范围 |
| --- | --- | --- | --- |
| 一 | 9 条流补 `errorWorkflow`；吉客云 2 条只读调查不改 | `codex/n8n-manual-action-alert-20261027` | `automation/n8n/*.json` |
| 二 | 审查 #4（`tests/legacy` 导入归位 + lint 规则）、#22（xlsx 版本 + 删多余锁文件） | `codex/stage0-legacy-import-and-xlsx-20261027` | `lib/market/`、`package.json`、eslint 配置 |

派工单内含本仓库已知陷阱的显式约束：n8n JSON 字节敏感禁用 `json.dump` 整体重写；xlsx 若 npm 上取不到 0.20.x 不得擅自改 exceljs（范围扩大）须回报。

### 文件占用已摸清（两个会话回信 + lead 复核）

两个被问的会话均报**零占用**，主工作区那 10 个改动都不是它们的（故确认无人认领）。

**已划归 C 项第三步那条线，不得派给别人**：

- `tools/publish-main-tail.mjs`（落点：新增拦截器与 `apply-timing.json` 落盘；该文件在 HEAD 上存在，由 `72496caa` 引入）
- `tools/verify-release-candidate.mjs`（新开窄 flag `applyTimingReceiptOnly`）
- `tests/publish-latest-main.test.mjs`

**排期硬约束（跨线冲突风险）**：该窄 flag 的命中条件是「差异必须恰好落在 `{publish-main-tail, publish-latest-main, verify-release-candidate}` 内」，**带任何集合外的工具文件就失败关闭**（实测：带 `rotation` 进去 → `unsupported=["publish-main-tail.mjs"]`）。

**所以那次修复必须单独走一个候选，不能与别的工具改动合批发布**，否则门禁第一道断言就过不去。

差异集还含一个文件（lead 已核实存在于 HEAD，且被 `6365c5f0` 改过）：

- `docs/规范/历史记录/发布限定资格-20261022.md`（资格登记）

它被 `candidateCompatibilityProfile` 的 `paths` 过滤器排除（`tests/` + `docs/` 的 `paths=[]`），**不影响 profile、不影响窄 flag 命中**，但在 git 差异里，故记录在此。资格文档与测试文件不受「恰好落在成员集合内」之限。

该方案中途改过四次落点：(b1) prepared → (b2) tail → 回 (b1) → 评估 (c) → **最终 (b2)**。(c) 指 `tools/publish-main.mjs:80` 的 `publishPreparedMain` 调用处，被否原因是窗口不洁净：该函数内部会调 `planWorkerReleaseRotation`，10 个准备侧计时键会混进回执，使异常计数字段恒非零。lead 已核对该行代码形态，否决理由成立。

收紧条件已定稿为**要求 `verify-release-candidate.mjs` 同在**。该线按 lead 建议用真实差异跑了三形态边界，其中一个结果反直觉：

| 形态 | 实测 |
| --- | --- |
| 只要 tail | 将来单改 tail 会被放行（永久敞口）✗ |
| tail + verifier | 本次命中✓、单改 tail 失败关闭✓、带集合外失败关闭✓ ← **采用** |
| tail + latest | **连本次都不命中**✗（解析器一字不改 → latest 不进差异） |

第三形态「看着更自然但实测相反」——不用真实差异验一遍很可能就选了它，门禁第一道断言直接过不去。

### 本次工具差异修正为两个文件

- `tools/publish-main-tail.mjs`
- `tools/verify-release-candidate.mjs`

`tests/publish-latest-main.test.mjs` 仍在差异里（测试落点），但 **`tools/publish-latest-main.mjs` 零改动、不进差异**（「解析器一字不改」是硬约束）。三文件的占用划分依然有效，只是其中 `publish-latest-main.mjs` 本身不会被动。

连带后果：因 `preparationQueue=false`（其触发项正是 `publish-latest-main.mjs`），**`optimization-boundaries` 这个 check 本次不跑**。预期 profile：`unsupported=[]`、`applyTimingReceiptOnly=true`、`publication=true`、`preparationQueue=false`、`worker=false`。

lead 提的「门禁换判定条件须加独立口径辅助统计」已被该线采纳：profile 返回对象将多带 `applyTimingReceiptPaths`（实际参与判定的文件集合），使 `REPORT.json` 能看到集合本身而非只有 true/false，并在测试里与 flag 互为冗余口径。依据是本仓库那次「正则抓列号当 error 数、基线锚在无意义数字、靠独立口径才暴露」的事故。

### 暂不派工

BOARD.md 的发布提速线（S05d/S08/S09/S06/S07/S17）暂不派，等用户定优先级。

n8n 线的其余未完成项同样暂不派，保持给原会话（它零占用、无在跑任务）：

- 独立审查遗留 6 项：库龄天数小数静默截断（54.9 万行，属本仓库「数值字段一刀切」系统性模式第四处，已知未修）、`DUPLICATE_KEYS` 未进固定告警优先档、后端库龄负数下界未对齐、告警上限 200 两处硬编码、库龄文案列名不符、服务层重复键死代码。涉及 `lib/imports/erp-reference.ts`、`lib/inventory/django-age-import-service.ts`、`backend/inventory/import_service.py`
- 「自动闭合零产物失败」长效机制未做

派这些时须把真实数据分布一并交给实现者（本仓库已有两次「收紧型修复误伤合法负数」的事故：2356 条合法负库存、3290 行退货单）。

## 六、未决事项（须用户决定）

1. `stash@{0}` 那批无人认领改动的去向（含 `AGENTS.md` 授权措辞被改松）。
2. 吉客云 2 条流是否挂载（会引入自动重试）。
3. `.wrangler/state` **17 GB** 迁移 —— 运维动作须授权；报告写 8.3 GB，三天翻倍，风险随时间增长。
4. 211 个 worktree 清理。
5. 审查 #2 剩余 2 子项（固定端口 9223、共用 admin 身份）是否纳入本轮。
6. n8n 界面打开 `JdLogisticsDaily2026`（建议在 9 条流补挂载落地后再开）。
7. n8n 线独立审查遗留 6 项与「自动闭合零产物失败」长效机制的优先级。

## 六点五、合并与制品（2026-10-27 下午）

用户逐步授权：先授权合并，后授权准备制品。

### 合并已完成

最终提交 **`f2c2c414`**，已推送并用完整 ref 核验远端一致。

```
81dcc97d (同步远端：BOARD.md 进 main)
  e3b0254c → 84442b5d  feat(n8n): 转人工告警覆盖 9 条正式流
  63e77515 → f2c2c414  fix(market): legacy 移出 tests/、删废弃 pnpm 锁文件
```

合并过程两处值得记：

1. 远端 main 在提交期间前进到 `81dcc97d`（别的会话合并 BOARD.md）。先核与本次零文件重叠，再同步、再合并，未基于过期 main 操作。
2. **合并后首次构建失败，未推送**。原因是 `@xterm/xterm`（package.json 声明 6.0.0）在主工作区 `node_modules` 未安装，`app/globals.css:6` 要 import 其 CSS。核实本次合并未碰任何 xterm 或 CSS 文件，属主工作区依赖不同步。装完依赖重新构建通过，`package-lock.json` 无漂移。

### 制品：未准备，按零载荷结案

固定验证入口 `verify-release-candidate.mjs` 在隔离工作树跑出 `status: failed`，但 `checks` 为空、失败在所有 check 之前：`unsupported` 非空，15 个文件不在 `supported` 集合内。

**这是设计行为不是缺陷**：该集合专门覆盖发布工具链（`.ps1` 控制器、发布 `.mjs`、资格清单），每项有 AST 级针对性检查；`tools/verify-release-candidate.mjs:100-118` 的注释明确写了不在集合内即失败关闭是故意的，防止无覆盖改动过门禁。业务代码 `lib/` 与自动化配置 `automation/n8n/` 本不在其覆盖范围。与 `STEP10-合并记录与门禁说明.md` 记录一致。

**实际载荷为零**（逐项实测）：

| 项 | 结论 |
| --- | --- |
| `app/` `worker/` `backend/` | 与生产字节完全相同 |
| `lib/market/` 三文件 | `app/`、`worker/` 零引用（死代码族）。唯一命中的 `app/api/market/annotations/route.ts` 引的是活的 Django 版 `@/lib/market/annotation-model`，未被动 |
| `automation/n8n/*.json` | **不在打包清单**。`tools/worker-local-release.mjs:251` 的 `workerReleaseBundledSourcePaths` 里 `automation/` 零命中 |
| `eslint.config.mjs`、`pnpm-lock.yaml` | 构建无关 |

`scope=full` / `components=[worker,django]` 是 11 个「未知路径」按规则 5 保守升级的结果，非真实载荷变化。按规则 5「纯文档等无应用载荷变更不需要准备生产制品或上线」结案，候选工作树已清理。

### 关键更正：生产当前提交不是 `71a384f5`

整轮制品分析一度以 BOARD.md 记录的 `71a384f5` 为生产基线，**该记录已过期**。C 项那条线指出后，lead 用生产源码快照逐字节核实：

```
D:\teruisi-runtime\teruisi-worker-sales\releases\20261027T061221Z-298f565cfaaad6f6\source-snapshot\
  tools/publish-main.mjs         live = a5a1ea7f… = e0dffdec（≠ 71a384f5 的 228e1512…）
  tools/publish-latest-main.mjs  live = 0b1a2b3d… = e0dffdec（≠ 71a384f5 的 a5b567fb…）
```

**生产跑的是 `e0dffdec`**（2026-10-27 07:24:26Z 上线，worker release `20261027T061221Z-298f565cfaaad6f6`）。所以 `6365c5f0` 早已上线，「要不要随这次上线」这个问题本身不成立。

用正确基线 `e0dffdec..f2c2c414` 重算，**零载荷结论不变**（`app/`/`worker/`/`backend/` 区间内零文件）。待发范围实为四笔：BOARD.md、n8n 告警覆盖、legacy 移出 tests、删 pnpm 锁文件。

**方法教训**：判断「生产在跑什么」必须读生产侧真实字节（源码快照 / 制品内文件），不能引用文档记录的提交号——看板记录会过期，而两个会话都可能跟着同一个过期前提往下推。`current-deployment.json` 也不可用（停在 8 月 29 日，非当前机制）。

### 一个被接住的错误叙述

lead 曾问「`6365c5f0` 上线后 `apply-timing.json` 实数是不是这次就能拿到」。C 项那条线核实方向错了，lead 独立验证代码形态确认：

- `publish-main.mjs:62` 常规发布 `await import('./publish-prepared-main.mjs')` 分流
- `:102` `if(!resumeMode)throw Error('旧构建并发布入口已停止接收新发布…')`
- `:187` 拦截器在该 throw **之后**，常规路径不执行

2026-10-27 07:24:26Z 那次发布已实证（`WorkerApply-result.json` 有、`apply-timing.json` 无、`grep -c "stage=apply"` = 0）。**不得写成「通道已生效」或「实数可取」。**

### 跨会话授权的边界

另一会话转达「用户已授权 `6365c5f0` 随本次制品一起上线」。lead **未将其作为授权**——跨会话转述的批准不构成对本会话该步骤的放行（AGENTS.md 规则 4）。回问用户本人后得到的是另一方向的判断，与转述不是一回事。该转述后亦被用户改为「等 C 项第三步修复做完一起发」。

**这道关卡拦住了一次基于错前提的上线决定**：那句授权是在「`6365c5f0` 尚未上线」的错前提下给出的，而前提本身不成立。

### n8n 告警如何真正生效

仓库里的 `*.workflow.json` 是导出副本，**不进制品、发布不会使其生效**。要让 9 条流的告警挂载起作用，须在 n8n 界面重新导入工作流或手工添加 errorWorkflow 设置。这是界面操作，与制品、发布无关。

**时序**：`界面操作清单-20261027.md` 要开的 12 条流里，京东客服 4 店、京东物流、天猫仓库正是本次补挂载对象。导入生效后再开，否则失败仍是静默的。

> **这一条必须留给后人**：`automation/n8n/*.json` 的改动**合并进 main 不等于生效，发布也不等于生效**。
> 实测依据：`tools/worker-local-release.mjs:251` 的 `workerReleaseBundledSourcePaths` 清单中 `automation/` 零命中，`tools/build-worker-helper.mjs` 亦零命中。
> 否则下次有人会以为「发一次就生效」而漏掉 n8n 界面导入那一步，告警照旧静默。

### 附：离线依赖缓存（将来打包时可直接用）

`package-lock.json` 在 `d5b043cd` 与 `f2c2c414` 逐字未变，哈希
`8ec00f801aff894796d783595d202811bccbe94296603ae26766864247d4a4ca`。

离线依赖目录按该哈希前 6 位命名：`D:\运营管理系统\.codex-tmp\rework-20261024\deps-8ec00f`（由 C 项那条线核实并提供）。锁文件未变即现有缓存仍匹配，`--dependencies` 参数可直接沿用。

所有锁文件门禁只认 `package-lock.json`（`publish-latest-main.mjs:95-96`、`:236-242`；`worker-local-release.mjs:943-944`、`:1326-1332`、`:253`；`install-main-prebuild.mjs:30-34`），`tools/` 与 `config/` 全目录 `pnpm-lock` 零命中。**删除 `pnpm-lock.yaml` 对发布链零影响**，该风险已排除。

## 六点八、C 项第三步修复：一次重复派工（2026-10-27 晚）

用户在本会话说「下次你能待我启动么，我只在这个界面操作」，lead 据此派出实施代理。但**同一时间用户在另一会话直接说了「启动」，那边已先派出实施者 `c-landing-fix`**（分支 `claude/apply-timing-landing-fix-00b7bb`，基线 `cde5cad9`）。两个 Sonnet 指向同一批文件。

### 处理

lead 立即停掉自己的代理（当时仍在读文件阶段，**零字节写入**），清理空工作树与分支 `codex/apply-timing-receipt-landing-fix-20261027`。对方独立核实清理干净，相关 worktree 只剩一个。

### 根因与可操作的教训

lead 在派工前**已向那条线发了交接消息**，但那是单向通知，没等回复就开工了。

> **涉及会话间会撞的动作（派实施者、改共享文件、请授权），发通知不够，要等对方确认。** 消息发出不等于对方收到并同意。

这与当天早些时候那次授权错位是**同一形态**：都是把一条从别处转述或推断来的指令，当成对本会话这一步的直接放行。

| | 指令来源 | 结果 |
| --- | --- | --- |
| 授权错位 | 另一会话转述的用户授权 | **拦住了**（回问用户本人） |
| 本次撞车 | 把用户说的「下次」读成「现在」 | **没拦住**（派了工） |

### 后续分工

实施由 `c-landing-fix` 继续；lead 转做**独立审查**——方案非 lead 制定、未参与实现，符合 AGENTS.md「审查使用未参与该部分方案或实现的新上下文」。

审查边界（同规范「独立审查与执行边界」第 2 条）：只读，可在隔离环境验证，**审出问题返回证据、由 `c-landing-fix` 修复**，lead 不改被审文件、不接管发布。

审查三个重点（均属「代码看着对但实际错」，正是本任务栽过的类型）：

1. **落点是否真在 `once('WorkerApply',…)` operation 内部**——放外面时 resume 复用会写空回执（伪造），而常规发布下两种写法都「能跑」、测试都绿。这是本次所修缺陷的同形变体。须直读实际嵌套层级，不采信描述。
2. **阴性测试变异点是否落在拦截器/落点**——上一轮六个用例全是喂硬编码字符串给解析器，拦截器改坏也全绿。须实际把变异打进去跑一次，确认测试真会红；只读测试代码判断不了。
3. **`applyTimingReceiptPaths` 是否真能旁证 flag**——须跑规划第三节五个场景，核 flag 与集合取值互为冗余。

### 一处未决：授权入口（并记第四次同形错误）

那条线提出「合并授权由它统一请用户」以避免两边同时请。lead 起初**未照办**，理由是用户在本会话说过「我只在这个界面操作」，请求若从另一会话发出会落在他不看的界面。

**这个理由不成立，是同一模式的第四次。** 那条线给出 lead 看不到的另一侧事实：当天四次合并授权（`e0dffdec`、`81dcc97d`、`36411dc9` 快进合并）、一次范围授权（`6365c5f0` 随制品上线）、一次「启动」指令，**全部是用户在那个会话给的**。所以「他不操作那个界面」这个前提与可观察事实相反。

lead 把用户一句话当成了一条路由规则，而手上并无证据支持该推断——只看到他在此说过那句话，看不到他在别处的操作。

**最终处理**：那条线未接受 lead 的替代方案，而是**把问题交用户本人定**（他此刻在那边操作）。理由是「我只在这个界面操作」只有他能解释：可能指以后、可能指某类操作、可能两边都看，lead 与那条线都不该从中推断出路由规则。

**用户已定**（2026-10-27 晚，原话）：「C 项第三步修好之后，合并授权我希望在这里请」——指本会话。

最终路径：

```
c-landing-fix 实施 → 报那条线
  ↓
lead 独立审查 → 结论给那条线
  ↓
那条线汇总（保留方案定稿方判断权，请求内容由它定）
  ↓
交 lead → lead 在本会话请用户
```

单一入口，请求只出一次。那条线不直接向用户请——不是不该，而是用户指定了位置，两边都发会让他在两处确认同一件事。lead 只负责呈交与接授权，**不替用户判断该不该放行**，他给哪一步就只报那一步，不扩大。

**结论对不代表推理对**：最终路径与 lead 先前提的替代方案同向，但理由完全不同——不是「用户不看那条线的界面」（该推断已被事实否掉），而是他本人就是希望在这里请。把问题交他定因此仍是正确处理：若按 lead 编出的规则定，入口会建立在一条错前提上，哪天那条前提被人核查就会连带推翻整个安排。

### 四次同形错误要分成两类

前三次与第四次的解药不同，混在一起会以为「多核一遍」能解决全部：

| 类别 | 哪几次 | 错在 | 解药 |
| --- | --- | --- | --- |
| **关于系统状态的前提会变** | 生产版本记成 `71a384f5`、授权前提已失效、把「下次」读成「现在」 | 前提当时为真、后来变了，而依赖它的结论不会自动失效 | **执行前回核前提** |
| **关于用户意图的前提本不该推断** | 把「我只在这个界面操作」当路由规则 | 不是前提变了，是从一句话推出了一条规则 | **直接问用户** |

第二类核不出来——lead 核不到用户的意图，只能问。这也是交叉验证的正确用法：**不是互相认同，而是各自提供对方看不到的那一侧事实**（此处是那条线手上的用户操作记录）。

## 六点九、C 项第三步：审查通过与手动发布（2026-10-27 晚）

### 合并状态

用户在实施会话直接授权并执行了合并，远端 `main` = **`18c25a3a`**（parents `cde5cad9` + `135ec9f4`，no-ff）。差异正是规划要求的五个文件：

```
docs/规范/历史记录/发布限定资格-20261022.md
tests/publish-latest-main.test.mjs
tests/verify-release-candidate.test.mjs
tools/publish-main-tail.mjs
tools/verify-release-candidate.mjs
```

`tools/publish-latest-main.mjs` 一字未动（硬约束达成）。

### 独立审查结论：通过，无阻断

三个重点全部**用执行结果验证**，不是读代码判断：

**1. 落点真在活路径上。** 读 `18c25a3a` 的实际嵌套：拦截器与落盘都在 `once('WorkerApply',async()=>{…})` operation 内部；`finally{console.log=originalConsoleLog;}` 恢复到位；转发自身包 `try{}catch{}`；`WorkerApply-result.json` 先写、回执后写且整块 guarded；解析器 `await import` 动态取。

**2. 五个 flag 场景实测与规划预期逐项一致**：

```
[tail,verifier]            flag=true   unsupported=[]
[tail]                     flag=false  unsupported=[tail]        ← 堵住永久敞口
[tail,verifier,rotation]   flag=false  unsupported=[tail]        ← 带集合外失败关闭
[tail,latest,verifier]     flag=true   unsupported=[]
[verifier]                 flag=false  unsupported=[]
```

诊断字段 `applyTimingReceiptPaths` 确实能旁证——`[tail]` 那行 flag=false 但 diagPaths 含 tail，一眼看出「改了落点却没登记」。

**3. 变异测试真的有效**（这关最关键）。把 `apply-timing.json` 落盘从 `once` operation 内删掉实跑：`pass 35 / fail 4`，失败的正是该响的三类——

- 行为用例：「回执必须落在真实 apply 执行点，而不是已停用的入口」
- 结构断言：「计时回执必须与 `WorkerApply-result.json` 同在一个 operation 内；它们分开就意味着落点又跑了」
- **它自己的阴性测试**：「变异 1 必须真的改到了落盘块，否则这条是空跑」

最后那条防的是阴性测试空跑，正是上一轮栽的坑的元层面。`console.log=` 在测试里命中 6 次（上一轮全目录为 0，拦截器从未被测过）。

变异已还原，审查工作树已清理。

### 手动发布：发现一处与「以往」的关键差别

用户问「手动发布跟以往有什么不一样」。**仓库 docs 查不到以往的实际发布命令**（规则 7 禁止记发布流水），C 项材料与共享笔记里也只有门禁命令。所以该问题无可靠依据回答，lead 如实说明而非推测。

实际跑 `--check` 时撞出了答案：

```
node tools/publish-latest-main.mjs --check --config <CONFIG>   ← 从仓库跑
→ Control generation changed; old consumer refused
  + actual   'D:\运营管理系统'
  - expected 'D:\codex-isolated\main-manual-release-20261016\control-bundles\804a1331…'
```

**发布不是从仓库跑的，是从已安装的控制包目录跑的。** 从仓库调用会被当成「旧消费者」拒绝。

固定配置在 `D:\codex-artifacts\manual-preparation-recovery-20261026\control-materials\CONFIG.json`（13 个字段，`cacheLockSha256` = `8ec00f801aff8947…` 与当前 `package-lock.json` 一致，七个目录与 `_cacache/content-v2` 均实测存在）。

真实 pwsh 路径用 `pwsh -NoProfile -Command '[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName'` 取得 `7.6.9.0`（glob 匹配 WindowsApps 目录会因权限失败）。

### `--check` 实测状态

```
目标 main      18c25a3a（含 C 项第三步修复）
当前线上       e0dffdec
范围           worker + django，migrate=false
制品           preparationStatus: not-ready
发布包         D:\codex-isolated\main-release-packages\18c25a3a153e-4a9cb3f5-b05895d2
发布前检查     通过（后台运行目录权限与部署清单符合进入维护要求）
```

### ⚠ 这次发布拿不到 `apply-timing.json`

控制包里的执行器字节 `f730c55a…`，而 `18c25a3a` 上含修复的那份是 `0b1a2b3d…`——**发布跑的是控制包那份，它不带本次修复**。

所以：本次发布只是把 `18c25a3a` 装上去；**数据要等下一次发布才产出**（那时执行器才是带修复的代际）。另一条路是先升控制包代际（走 `prepareControlUpgrade` 审批链），本次未采用。

**交付说明不得写成「通道已生效」或「实数可取」。**

### 授权

用户先前那次授权绑定的是 `f2c2c414`（上一批），本次目标 `18c25a3a` 需重新授权（规则 4：一次授权不覆盖后续步骤、历史授权不延伸到本次）。用户在本会话明确授权**准备制品 + 上线两步一起**，绑定 `18c25a3a`。

## 七、本次协调纠正的判断错误（留作同类任务参考）

| 错误 | 纠正 | 根因 |
| --- | --- | --- |
| lead 初判「本地 main 领先远端」 | 实为落后 17 个提交 | 看到本地有 `(#65)` 提交就假设是新的，未先跑 `is-ancestor` |
| lead 在落后基线上数出「12 条流缺 errorWorkflow」 | 真实 11 条（告警目标自身不算） | 在落后 17 步的检出上统计 |
| 提示「`rotation.mjs` 工作树字节会触发生产者资格失败」 | 实测哈希 `5171f548…` 与 origin/main 相同且已登记 | 把落后基线造成的 118 行 diff 当成真实改动 |
| STEP11「源码不在 main」等四处 | 全部不成立 | 一次 `ls`/`git ls-files` 的假阴性，未用 `git log --all` + `git cat-file -e` 双核 |
| 一度想用 grep 注释判断修复是否进制品 | 打包剥注释，须看函数体 | 注释不是可靠的字节证据 |
| 一度想用 `current-deployment.json` 判断生产版本 | 该指针停在 8 月 29 日，非当前机制 | 文件名像什么不等于它仍生效 |
| 整轮制品分析以 `71a384f5` 为生产基线 | 生产实为 `e0dffdec`（源码快照逐字节核实） | 引用了 BOARD.md 记录的提交号，未读生产侧真实字节；**两个会话同时跟着这个过期前提推了好几轮** |
| 曾问「`6365c5f0` 上线后实数是否可取」 | 拦截器在死路径上，不执行 | 假设「代码在目标提交里」等于「代码会运行」 |

共同根因：**在未核实基线新旧的检出上做「某代码在不在／在跑什么」的判断会系统性出错。** 本仓库记忆中已记录两次同类事故，本次又添三次变体。

其中生产基线那次最值得记：**它不是单方失误，而是两个会话共享了同一个过期前提**。对方手上本就有 07:24 那次发布的实测记录，却跟着 lead 给的 `71a384f5` 前提回答了好几轮。所以「另一个会话也这么认为」不构成交叉验证——只有各自回到原始证据（这里是生产源码快照的字节）才算。

## 变更记录

2026-10-27：建立。lead 完成三份方案交叉核查，纠正本地落后 17 提交导致的结论偏差，更正 STEP11 三处前提，确认审查 #26 缺口为 11 条并区分两类风险，保全无人认领改动，fast-forward 到 `e0dffdec`，派出两组 sonnet 施工。**未改业务代码、未合并、未发布。**
