# 发布流水线工程化优化施工方案（修订版）

- 方案日期：2026-10-12
- 版本：**修订版 v2**，替代 [PLAN.md](PLAN.md)（v1 已标注作废，不得作为施工指令）
- 修订原因：v1 存在四处事实错误，见「附录 A：v1 错误更正表」
- 方案性质：**施工计划**。本文件不执行任何操作，不含生产授权。各工作包由用户单独安排执行。

## 一、v1 的错误与本次修订

v1 在四处事实上失准，全部由用户指正并经本地 `origin/main`（`b3c6018c`）核实：

1. **时间线读错**。v1 称发布前备份与恢复演练"被排在维护窗口之内"。实际记录为：前备份 `20:32:33—20:43:08`、前恢复 `20:51:19—21:01:35`、进入维护 **`21:08:07—21:11:25`**（`docs/历史记录/性能与发布/performance-five-production-20261006.md`）。前恢复结束后 6 分 32 秒才进入维护。**把前备份与前恢复移出窗口不构成本批发布的新增收益。**
2. **把重启当发布**。v1 将 `tools/operations-system-service.ps1 -Action Restart -KeepBackend` 定义为 C 级发布方式。该命令经 `Invoke-Restart`（`tools/operations-system-service.ps1:285`）只调用 Worker `-Action Restart`，返回原 `$identity.ReleaseId` 与 `$identity.Sha256`，**无候选切换步骤**。真正的最短发布链是 `BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain`，其中 `apply` 不可由 `Restart` 替代。
3. **遗漏已有实现**。v1 的 WP-3 拟新建报告生成器，但 `tools/release-closeout-report.mjs` 已实现 `generateCloseoutDraft`（核验批准批次摘要、读原始 journal、检查操作归属、汇总未执行与未通过项）与 `renderCloseoutDraft`，并明确保留 `acceptancePassed: null`。v1 的 WP-5 拟实现退出码可靠传递，但 `tools/process-deadline.ps1:170` 已读取 `$process.ExitCode` 并在 184 行返回。**两包均为重复建设。**
4. **风险分级过宽**。v1 的 C 级凭"前端展示、筛选、只读页面"直接推出减免。现行 `tools/release-impact.mjs` 要求四轴同时成立才返回 `not-required`（`persistentData.effect === 'none'`、`backupMechanism.effect === 'unchanged'`、`components.django === 'unchanged'`、`persistentData.deploymentInputs.effect === 'unchanged'`），首版仅开放有限 CSS 展示值与受限静态组件，并把"GET 查询、筛选事件"明确列为证据不足、保留 full。

**修订原则**：保留工作包框架；先重写现状基线、收益口径、风险分类与依赖顺序；优先补 CI 与剩余可靠性缺口；**复用**已有发布与证据工具，不另建第二套。

## 二、当前基线的关键事实

### 2.1 本地状态

| 项 | 数值 | 说明 |
| --- | --- | --- |
| 本地 main HEAD | `2f55c396`（2026-10-08 11:39） | |
| origin/main HEAD | `b3c6018c`（2026-10-12 19:16） | 本地落后 **159 个提交** |
| 主检出未提交改动 | 5 个已修改文件 + 2 个未跟踪目录 | 属用户所有，不得覆盖 |
| worktree 登记 | 33（20 个 detached HEAD） | |
| 本地 / 远端分支 | 29 / 22 | |
| CI 配置 | **无** | 无 `.github` / `.gitlab-ci.yml` / `.circleci` |

### 2.2 `origin/main` 上已存在的发布工具（19 个）

```
tools/release-impact.mjs              影响分类（v3，四轴判定）
tools/release-batch.mjs               发布批次机制
tools/release-batch-admission.mjs     批次准入
tools/release-closeout-report.mjs     收尾报告生成与渲染
tools/release-no-data-observation.mjs 无数据影响现场观察
tools/release-preparation-evidence.mjs 准备证据
tools/release-lifecycle-step.ps1      生命周期步骤
tools/release-admission-timing.mjs    准入计时
tools/release-acceptance-ui.mjs       验收 UI
tools/release-composition-review.mjs  组合复审
tools/release-daily-backup.mjs        每日备份
tools/release-history-preservation.py 历史保全
tools/release-payload-retention.mjs / .ps1  载荷保留
tools/release-readonly-retry.mjs      只读重试
tools/process-deadline.ps1            进程期限与退出码
tools/worker-local-release.mjs        发布主链
tools/worker-local-release-rotation.mjs 发布轮换
tools/integration_release_gate.py     集成发布门禁
```

### 2.3 已实现但采用状态不明

按 `docs/release-no-data-policy-20261010/REPORT.md` 自述：**"没有生产采用"**，且"原 AB 的 active 所有权与第 19 步 unknown 阻止新正式 plan/batch"。

该报告同时记录了三条轴（运行组件、持久数据/部署效果、备份机制）与若干现存缺口。**这些状态必须在 WP-B 中核实，不能凭文件名或记忆判断。**

### 2.4 结构指标（2026-10-12 实测）

| 指标 | 数值 |
| --- | --- |
| 近 30 天提交 | 1,763 |
| 近 30 天 merge 提交 | 403（23%） |
| 含 verify/audit/evidence/acceptance/recheck/repair 的提交 | 380（22%） |
| `docs/` 改动占比 | 19.3% |
| 工具脚本 | 162 个 / 44,759 行 |
| 测试文件 | 527 |
| `docs/` 文件 | 1,084 |

## 三、收益口径（修订）

v1 的"维护窗口约 40 分钟 → 6 分钟"作废。原因是混用了不同批次的耗时，且遗漏了停稳后校验、后备份、后恢复与实际启动成本。

**必须分别测量三个口径，不得互相折算：**

| 口径 | 定义 | 为什么单独测 |
| --- | --- | --- |
| T1 总等待 | 用户批准上线 → 完整交付（含收尾报告） | 这是用户的真实体验成本 |
| T2 业务不可用 | 应用停止 → 业务恢复可用 | 这是业务方的真实成本 |
| T3 失败与补证 | 失败重试、补证、恢复消耗 | 这是最不可预测、也最伤人的部分 |

**移出批准前的工作，只可能改善 T1，不能自动算作 T2 的等量下降。**任何收益声明必须写明改善的是哪个口径。

目标以**相对值**表述，绝对值待 WP-B 建立基线后确定：T2 取当前批次的实测下界；T1 视可前置范围而定。

## 四、工作包与依赖（修订）

| 包 | 名称 | 并发 | 风险 | 依赖 |
| --- | --- | --- | --- | --- |
| **WP-B** | **现状基线与覆盖缺口对照** | ✅ | 低 | 无。**强制前置** |
| WP-0 | Git 盘点（只读） | ✅ | 低 | 无 |
| WP-0G | Git 治理（执行） | ❌ | 中 | WP-0 + 用户逐项确认 |
| WP-1 | CI 基础设施与验证分级 | ✅ | 低 | 无 |
| WP-2 | 风险分级对齐现行分类器 | 部分 | 低 | WP-B |
| WP-3 | 证据体系**扩展** | 部分 | 中 | WP-B |
| WP-5 | 剩余可靠性缺口核实 | 只读部分可并行 | 中 | WP-B |
| WP-4 | 发布时序测量与重新设计 | ❌ | 高 | WP-B、WP-1、WP-2 |
| WP-5G | 可靠性缺口修复（如确需） | ❌ | 高 | WP-5 + WP-4 串行 |

**关键顺序变更（对应第 6 点指正）**：

- **WP-B 是强制前置**，其余各包在它产出对照表前不启动施工。这是 v1 踩坑的直接教训。
- **WP-5 的只读调查不必等 WP-4 完成**。同域**修改**串行即可，只读核查可先行。
- **更合理的次序是先核清现有修复与剩余阻断，再改发布顺序。**
- **WP-0 拆分为盘点与治理。**只出清单兑现不了"main 落后归零、worktree 少于 5"的目标；盘点只读且低风险，治理需用户逐项确认。
- **WP-4 / WP-5 先完成只读调查与具体设计，再对确需授权的动作确认**，避免一开始就进入审批等待。

## 五、全局约束（每个工作包都必须遵守）

摘自 `AGENTS.md` 与 `docs/规范/开发与交付.md`，执行者须自行阅读原文：

1. 从最新 `main` 创建独立 `codex/<任务>-<日期>` 分支及独立 worktree；不在生产运行目录或主检出上开发。
2. 修改前检查 `git status`，工作区既有改动属于用户，不得覆盖、格式化、暂存或提交。
3. 只暂存本任务文件；推送前核验 `git diff --cached`。
4. **合并不等于上线**。合入 `main` 不等于生产发布；生产迁移、服务重启、路由切换、自动化启用、数据写入仍须用户明确授权。
5. 未经用户在当前对话明确批准，不得停止、重启或中断本地服务；不得在 Worker 监听 `dist` 时原地构建。
6. 生产 Worker 只能经由 `tools/worker-local-service.ps1` 管理；禁止直接运行 Wrangler、旧 release、`dist` 或 `tools/start-local-worker.mjs`。
7. 测试使用临时目录、内存/临时 SQLite 与夹具；不得覆盖生产 runtime、release runtime、浏览器 profile、备份、审计或 `.dev.vars`。
8. 交付说明必须列出：变更内容、验证结果、提交与推送状态、未执行的部署/迁移/服务操作、仍需用户决定的风险。

**底线**：只读调查先于设计，设计先于改动，改动先于授权申请。任一步不得越级。

---

# 六、工作包详述与提示词

以下每节的提示词块可整段复制，作为独立 agent 的首条输入。每段自包含，不依赖本对话上下文。

---

## WP-B 现状基线与覆盖缺口对照（强制前置）

- 风险：低。纯只读调查。
- 目标：产出一张「**已实现 / 已采用 / 仍缺失**」三态对照表，覆盖发布流程、证据体系、可靠性三个域。**这是后续所有包的前提。**
- 硬约束：不修改任何文件（除本包报告）；不重跑测试；不核验生产采用状态之外的生产操作。
- 验收：对照表逐项标注证据来源（文件 + 行号或命令），对"已采用"必须给出采用记录出处，对"仍缺失"必须给出缺口判据；明确列出 v2 各包的重复建设风险点。

```
你是本仓库（D:\运营管理系统）的只读调查 agent。本包产出基线对照表，是后续所有优化包的前提。不得修改任何产品文件。

第一步：阅读 AGENTS.md、README.md、docs\规范\开发与交付.md、docs\规范\验证与发布.md、docs\规范\运行与启动.md。

第二步：核实代码基线
- 确认本地 main 与 origin/main 的关系：git rev-list --left-right --count main...origin/main、git log -1 --format='%H %ad' origin/main。
- 本包以 origin/main（不要用本地 main）为代码事实来源，因为本地 main 落后。逐项读取 origin/main 上的文件：git show origin/main:<path>。

第三步：建立三态对照表，写入 docs\release-pipeline-optimization-20261012\WPB-BASELINE.md
对以下每个能力，判定「已实现 / 已采用 / 仍缺失」，并给出证据：
1. 影响分类与无数据影响发布：tools\release-impact.mjs（classifyImpactV3、recoveryDecision、四轴判定）、tools\release-batch.mjs、tools\release-batch-admission.mjs、tools\release-no-data-observation.mjs。
2. 收尾报告生成：tools\release-closeout-report.mjs 的 generateCloseoutDraft、renderCloseoutDraft，以及 acceptancePassed: null 的语义。
3. 进程退出码与期限：tools\process-deadline.ps1，特别是 ExitCode 读取、有界输出快照、失败代码分类（process_deadline_exhausted / output_limit / output_incomplete / exit_unavailable / process_transport_failed）。
4. 发布主链与轮换：tools\worker-local-release.mjs、tools\worker-local-release-rotation.mjs。
5. 准备证据与保留：tools\release-preparation-evidence.mjs、tools\release-payload-retention.mjs/.ps1、tools\release-history-preservation.py。
6. 生命周期步骤：tools\release-lifecycle-step.ps1。
7. 备份与恢复：tools\release-daily-backup.mjs。
8. 集成门禁：tools\integration_release_gate.py。
9. 无数据影响策略的采用状态：读 docs\release-no-data-policy-20261010\REPORT.md 与同目录其他文件，核实其自述的"没有生产采用"、"原 AB 的 active 所有权与第 19 步 unknown 阻止新正式 plan/batch"是否仍成立、有哪些缺口、缺口编号。
10. 最短发布链：核实 BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain 的现行实现位置与参数。

第四步：判定采用状态
对第 1–9 项，逐项标注：已实现且已生产采用 / 已实现但未采用 / 部分实现 / 仅设计未实现。
"已生产采用"必须给出采用记录的文件与日期；无记录即为"未采用"，不得推断。

第五步：输出重复建设风险清单
明确列出：若按"新建报告生成器""新建退出码处理""新建影响分类器"施工，会与哪些已有工具重复。这是本包最重要的产出之一。

第六步：输出仍缺失清单
只列有证据支撑的缺口，按影响排序，标注每一项阻塞了什么。

禁止事项：不修改任何 .ts/.tsx/.mjs/.ps1/.py/.json 产品文件；不重跑测试；不执行发布、部署、迁移或服务操作；不声称未核实的内容已采用。

交付：创建 codex/release-wpb-baseline-20261012 分支与独立 worktree，提交 WPB-BASELINE.md，做一个聚焦提交并推送该分支。不合并 main。交付说明列出：三态统计、最重要的五个缺口、重复建设风险清单。
```

---

## WP-0 Git 盘点（只读）

- 风险：低。
- 目标：产出 worktree 与分支的逐项判定清单。**明确不含任何删除动作。**
- 硬约束：不执行任何写操作；同时段其他 agent 不得改动 worktree（否则清单失效）。

```
你是本仓库（D:\运营管理系统）的工程维护 agent。本包只做只读调查并产出清单，不得删除分支、不得移除 worktree、不得改变任何生产状态。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md（尤其「本地 worktree 与分支清理」）、docs\规范\README.md。该节是本包权威规则。

第二步：只读采集
- git status --porcelain -b、git worktree list --porcelain、git branch -vv、git branch -r
- git rev-list --left-right --count main...origin/main
- 对每个 worktree：git -C <path> status --porcelain、git -C <path> log -1 --format='%H %ad %s' --date=iso、该 HEAD 是否被 main 或 origin/main 包含（git merge-base --is-ancestor <sha> main / origin/main）。
- 对每个本地分支：是否已完整合入 main（git branch --merged main）、是否有同名远端分支、最后提交时间。

第三步：逐项判定，输出到 docs\release-pipeline-optimization-20261012\WP0-INVENTORY.md
表格列固定：路径 | 分支或 detached SHA | 已合入 main | 已合入 origin/main | 未提交改动数 | 忽略文件情况 | 建议动作 | 阻塞原因。
建议动作只能取：可安全移除 / 需先保全提交 / 需先保全忽略文件 / 使用中不可动 / 身份不明不可动。
注意：本仓库本地 main 落后 origin/main 159 个提交，因此"已合入 main"与"已合入 origin/main"必须分列——只合入 origin/main 的分支不能按已合入处理。
对「可安全移除」必须证明：已完整合入、无未提交内容、无忽略文件、无进程占用、无自动化或正式启动绑定。任一条不能证明即降级为「需先保全」。

第四步：给出主检出对齐 origin/main 的命令序列，写入「待执行命令」小节。逐条可复制，每条前用注释说明作用与不可逆性。不要执行。

第五步：把 WP-B 的结论（若已存在 docs\release-pipeline-optimization-20261012\WPB-BASELINE.md）纳入考虑：哪些 worktree 属于仍缺失能力的工作现场，必须保留。

禁止事项：不执行 git worktree remove、git branch -D、git push --delete、git reset、git clean；不对任何 worktree 做 checkout 或切分支；不修改被调查 worktree 内的文件。

交付：创建 codex/release-wp0-git-inventory-20261012 分支与独立 worktree，提交 WP0-INVENTORY.md，推送该分支。不合并 main。交付说明列出：采集事实、清单路径、未执行的操作、需用户逐项确认的决策项。
```

---

## WP-0G Git 治理（需用户逐项确认后执行）

- 风险：中。
- 前置：WP-0 清单已完成，**且用户已逐项确认处置方案**。未确认前本包不启动。
- 目标：兑现"main 对齐、worktree 降到 5 个以内"，并保全所有未合入提交与忽略文件。
- 硬约束：只处理用户确认过的项；保全优先于清理；不使用破坏性命令。

```
你是本仓库（D:\运营管理系统）的 Git 治理 agent。本包执行 WP-0 清单中经用户逐项确认的处置方案。未在确认清单内的项一律不动。

第零步：读取 docs\release-pipeline-optimization-20261012\WP0-INVENTORY.md 与用户给出的确认清单。若两者不一致，以用户确认清单为准，并报告差异。列出你打算执行的完整动作序列，等待确认后再执行。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md 的「本地 worktree 与分支清理」。核验：未提交内容、未合并提交和有价值的忽略文件必须先形成可恢复且已验证的快照；远端同名提交或 Git bundle 可以保全提交，但不替代忽略文件保全；不得删除仍在使用或身份不明的目录；不以强制重置丢弃改动。

第二步：对齐主检出
- 按用户确认的方式把主检出对齐 origin/main。注意主检出存在 5 个已修改文件与 2 个未跟踪目录，属用户所有，必须先报告并取得用户对处置方式的明确指示，不得自动 stash、checkout 或丢弃。
- 对齐后回读 HEAD 与 git status，确认结果。

第三步：执行已确认的清理
- 对普通 Git worktree：核验 Git 管理目录、归属元数据及占用，确认未受应用管理、未锁定且内容已保全后，可用 git worktree remove。Git 登记移除后仍须检查目录，剩余 junction、空目录或其他文件单独列为残留，不跟随 junction 删除目标。
- 对已合入的本地分支及同名远端分支：按规范清理。未合入、worktree 不干净或使用中的分支必须保留并报告原因。
- 清理前对每一项先做保全核验（提交可达性、忽略文件清单与 SHA-256），保全失败即跳过该项并报告。

第四步：收尾核验
- git worktree list、git branch、git status、git rev-list --left-right --count main...origin/main 复查。
- 明确区分已清理项与仍存在的阻塞项。不得把部分清理说成已达目标。
- 报告实际释放空间。

禁止事项：不使用 git reset --hard、git clean -fdx、git push --force；不删除用户分支；不移动、不删除生产运行目录、备份或归档；不停止或重启任何服务。

交付：创建 codex/release-wp0g-git-governance-20261012 分支与独立 worktree（若主检出即是工作场所，则在该处操作并在交付说明中注明）。交付说明列出：执行的动作序列、每项结果、skip 项与原因、对齐前后状态、实际释放空间、仍存在的阻塞。
```

---

## WP-1 CI 基础设施与验证分级

- 风险：低。
- 现状事实：无任何 CI；Node v24.18.0 / npm 11.16.0；`npm run test:unit` = `node --import tsx --test tests/*.test.ts`，`npm run test` = `vinext build && test:unit && rendered-html`，**测试绑定生产构建**，而 `docs/规范/验证与发布.md` 要求构建前检查 127.0.0.1:3000 是否被本项目服务占用。
- 修订点（对应第 4 点指正）：补三类兜底，并**明确本包实际验收哪几级**，消除 v1 中"禁全量构建"与"逐级实际运行"的矛盾。

```
你是本仓库（D:\运营管理系统）的 CI 工程 agent。本包只建立分级验证基础设施，不发布、不部署、不改业务代码。

第一步：阅读 AGENTS.md、README.md、docs\规范\开发与交付.md、docs\规范\验证与发布.md、docs\规范\前端与性能.md。特别核验：npm test 会先执行生产构建；构建前必须检查 127.0.0.1:3000 是否被本项目服务占用；测试优先使用临时目录、内存/临时 SQLite 和夹具。你的方案不得违反这三条。

第二步：现状勘察（只读）
- 统计 tests\ 下测试文件数与按业务域分布。
- 找出哪些测试会读取 .dev.vars、连接真实 PostgreSQL、或依赖 3000 端口 / dist。列文件名与判定依据。这些不得进入 L0–L2。
- 找出 docs\规范\验证与发布.md 已列出的最小回归入口，以及 package.json 中 test / test:unit / lint / check:backend-boundary / preview:isolated / preview:verify 的语义。
- 确认仓库当前确无 CI 配置。

第三步：设计四级验证，写入 docs\release-pipeline-optimization-20261012\WP1-CI-DESIGN.md
- L0（目标 < 2 分钟）：git diff --check + lint + 受影响域单元测试（不启动构建、不启服务）。
- L1（目标 < 8 分钟）：单业务域接口/契约测试 + 前端组件测试，用临时 SQLite 或内存夹具，不启生产 Worker。
- L2（目标 < 20 分钟）：跨域集成 + 真实浏览器 UI 探针（复用已有 tools\verify-*-ui.mjs，不得新造重复实现）。
- L3（按需，人工触发）：全量 test:unit + 生产构建 + 隔离镜像冷启动验收，保持既有隔离要求。
每级写明：命令、判定判据（退出码与断言）、允许触碰的资源、绝对禁止触碰的资源、超时。

第四步：补齐三类兜底（v1 缺失，本包必做）
1. 扩大测试范围的触发规则：改动公共组件、共享依赖、配置、构建配置、类型定义时，如何从"受影响域"扩到更大范围。必须给出可执行的判定规则（按路径模式），不是原则性描述。
2. 无法分类文件的默认级别：任何不能明确归入某域或某风险级别的改动，默认进入哪一级。默认必须是保守侧（更高级别），并在设计文档中写明理由。
3. 特定契约的验证路径：
   - PostgreSQL 特有契约（约束、事务隔离、序列、迁移）如何用隔离 PostgreSQL 实例验证，需写明连接、端口、命名空间隔离方式。
   - Windows / PowerShell 生命周期（进程身份、互斥、ACL、退出码传递）如何验证，需写明使用的测试框架与隔离方式。

第五步：实现
- 在 package.json 增加 verify:l0 / verify:l1 / verify:l2 脚本，按域参数化。这些脚本不得调用 vinext build。
- 增加按域切片的测试入口，域划分与 backend\ 所有权域一致（sales、finance、netshop、market、products、inventory、workflow、customer_service、erp_reference、bi、ai_assistant、access_control、system_backups、system_datasets、business_analysis）。
- 增加 CI 工作流文件，默认 L0 + L1，手动或标签触发 L2/L3。工作流不得引用生产密钥或生产数据库。
- 不要在 CI 中运行 npm test。

第六步：验证（明确范围）
本包实际验收 L0 与 L1 两级：逐级在本机运行，记录真实耗时与退出码。L2 与 L3 本包只交付脚本与文档，**不实际运行**（它们需要真实浏览器探针与生产构建，属于发布候选阶段）。在设计文档中明确标注各级的实际验收状态。
- 对 L0 或 L1 做一次负向验证：故意失败一个断言，确认以非零退出码失败。
- 运行 npm run lint 与 git diff --check，两者必须干净。

禁止事项：不修改 .dev.vars；不启动 tools\worker-local-service.ps1；不运行 wrangler；不连接生产 PostgreSQL；不触发 n8n、钉钉机器人或任何外部发送；不修改既有发布脚本。

交付：创建 codex/release-wp1-ci-20261012 分支与独立 worktree，做一至三个聚焦提交并推送该分支。不合并 main。交付说明列出：各级命令与实际耗时、切片映射、三类兜底规则、被排除的测试及理由、L2/L3 未实际运行的事实、未执行的操作、需要用户决定的风险（例如 CI 运行器由谁提供）。
```

---

## WP-2 风险分级对齐现行分类器

- 风险：低。规范修订。
- 修订点（对应第 3 点指正）：**不再由方案凭"前端/只读"命名发放减免**，改为复用 `tools/release-impact.mjs` 的判据；发布命令改为既有最短发布链。
- 前置：WP-B 完成（需知道现行分类器的实际采用状态）。

```
你是本仓库（D:\运营管理系统）的规范维护 agent。本包只修改规范文档，不改任何代码或配置。

第一步：阅读 AGENTS.md、README.md、docs\规范\README.md、开发与交付.md、验证与发布.md、运行与启动.md、数据存储与迁移.md、安全与AI工具.md。注意 docs\规范\README.md 的「内容归属」：稳定规则只在所属专题维护一份正文；AGENTS.md 不得追加每日开发内容。

第二步：核实现行规则（这是本包的核心，不要凭名称推断）
- 读取 docs\release-pipeline-optimization-20261012\WPB-BASELINE.md 中关于现行分类器与采用状态的结论。
- 逐项核实 tools\release-impact.mjs：classifyImpactV3 的支持范围（仅 same-css-structure-presentation-values 与 same-client-executable-intrinsic-display 两条证明路径，其余进入 gaps）、四轴判定、recoveryDecision 返回 not-required 的四个必要条件。
- 读取 docs\release-no-data-policy-20261010\REPORT.md 中「新旧规则及支持范围」表，特别是把「GET查询、筛选事件、权限/生命周期/依赖、PNG/Markdown及未知代码」列为证据不足、保留 full 的那一行。
- 核实最短发布链 BeginWorkerDrain → StopWorker → apply → StartWorker → EndWorkerDrain 的实现位置，确认 apply 不可由 Restart 替代。
- 核实 tools\operations-system-service.ps1 -Action Restart -KeepBackend 的真实语义：它只重启当前 exact release 的 Worker 子进程，返回原 ReleaseId 与 Sha256，无候选切换。

第三步：设计风险分级
分级必须**建立在现行分类器之上**，而不是另立一套判据。目标是让规范与代码一致，并让"何时可以减免备份"有单一权威来源。
- 对每一级，明确其判据是"由 tools\release-impact.mjs 判定为 display/not-required"，而不是由人凭改动描述判断。
- 发布方式必须引用真实存在的链路，不得把 Restart 或 Restart -KeepBackend 描述为发布手段。
- 明确哪些改动**无论看起来多简单**都保留完整保障：GET 查询、筛选事件、权限、生命周期、依赖、部署输入、迁移、存储、恢复机制、无法分类的代码。
- 每一级写明：必需的验证（引用 WP-1 的级别）、备份要求（引用 recoveryDecision 的结论）、是否进入应用维护、最短发布链、回退方式。
- 任何一级都不得放宽鉴权、权限、敏感数据、ACL、迁移完整性与发布后回读。

第四步：落笔
- 把分级写入 docs\规范\验证与发布.md 的相应位置，或经判断写入更合适的既有专题。只有一处正文。
- 在开发与交付.md 与运行与启动.md 中只添加指向该正文的链接，不复制内容。
- AGENTS.md 不得新增任何每日内容、发布流水或验收结果。
- 逐条检查新增与改动的相对链接可达。

第五步：对照验证
- 把 2026-09-25 至 2026-10-08 期间已发生的发布逐一对照新规范，产出对照表写入 docs\release-pipeline-optimization-20261012\WP2-CLASSIFICATION-AUDIT.md，列出「按现行分类器实际会判定为哪级 / 当时实际走了哪些阶段 / 差异」。
- 不得改写任何历史采用记录。
- 若发现现行分类器与规范无法对齐之处，列为需用户决定的边界，不要自行放宽代码或规范。

禁止事项：不修改任何代码或脚本；不修改 package.json；不执行发布、部署、迁移或服务操作；不复制正文到多处；不凭改动描述名称发放减免。

交付：创建 codex/release-wp2-release-gates-20261012 分支与独立 worktree，做一个聚焦提交并推送该分支。不合并 main。交付说明列出：改动文件清单、分级判据摘要、与现行分类器的对齐情况、链接检查结果、对照审计路径、未执行的操作、需用户决定的边界。
```

---

## WP-3 证据体系扩展

- 风险：中。
- 修订点（对应第 5 点指正）：**改为扩展现有体系，不另建第二套**。删除"验证类提交占比 < 10%"这一效果指标。
- 前置：WP-B 完成。
- 现状：`tools/release-closeout-report.mjs` 已实现草稿生成与渲染，并保留 `acceptancePassed: null`。

```
你是本仓库（D:\运营管理系统）的证据体系 agent。本包扩展现有发布证据体系，不新建第二套。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md（尤其「文档与长期信息维护」）、docs\规范\安全与AI工具.md、docs\规范\验证与发布.md。核验「禁止记录密码、令牌、个人敏感信息或原始客户数据」。

第二步：完整盘点现有证据体系（只读，不得凭文件名判断）
- 精读 tools\release-closeout-report.mjs：generateCloseoutDraft 的输入、它对批准批次摘要的核验、它如何读原始 journal、如何判定操作归属、如何汇总未执行与未通过项；renderCloseoutDraft 的输出结构；以及 acceptancePassed: null 的语义与它为什么保留。
- 精读 tools\release-preparation-evidence.mjs、tools\release-no-data-observation.mjs、tools\release-lifecycle-step.ps1 中与证据产生、封存、回读相关的部分。
- 读取 docs\release-pipeline-optimization-20261012\WPB-BASELINE.md 中关于证据能力的结论与缺口。
- 观察 docs\ 下现有发布记录的实际形态（参考 docs\历史记录\性能与发布\performance-five-production-20261006.md），弄清人工环节消耗在哪里。

第三步：设计扩展（不是重建）
针对现有体系的缺口，设计扩展项。必须覆盖以下四条要求：
1. 区分状态语义：回执必须能区分「失败 / 未执行 / 未知 / 已协调」。核实现有实现已覆盖哪些（closeout 的 failures / unresolved / notExecuted 分别对应什么），补齐缺失的。
2. 绑定关系：回执需绑定验证器版本、必需检查集合、候选与前驱。核实现有 preparation receipt 已绑定哪些，指出缺口。
3. 静态证据与动态现场观察分别管理：静态证据（指纹、字节摘要、manifest）只能证明输入未变；动态观察（进程身份、ready、当前版本、现场就绪）必须单独记录并标注观察时刻与观察方式。核实现有 release-no-data-observation.mjs 与 closeout 的 observedRuntime 覆盖到什么程度。
4. 明确边界表述：在设计与文档中写明"指纹一致只证明输入未变，不证明检查完整，也不证明现场仍然就绪"，并说明系统如何分别管理这两类信息。

第四步：实现
- 只做增量扩展，复用 release-closeout-report.mjs 与 release-preparation-evidence.mjs 的既有结构，不新建平行工具。
- 若确需新文件，必须先在设计文档中论证现有文件为何无法承载，并列出与现有工具的关系。
- 不得放宽、删除或跳过任何既有断言与检查。
- 不在回执或报告中写入原始业务数据、客户数据、凭据、令牌、密码或密钥；只允许指纹、计数、断言结果、时间戳与范围描述。在文档中写出禁止项与正反例。

第五步：验证
- 用现有真实回执或构造的合规输入运行扩展后的路径，确认输出合规且状态区分正确。
- 构造一次失败、一次未执行、一次未知、一次已协调，确认四态可区分。
- 构造一次静态指纹变化，确认判定失效。
- 人工检查输出不含原始业务数据、客户数据或凭据。
- 运行 npm run lint 与 git diff --check，两者必须干净。

明确不做：不把"验证类提交占比低于 10%"或任何提交计数作为效果指标。效果只按 T1/T2/T3 三个时间口径衡量（见方案第三节）。

禁止事项：不放宽任何既有断言；不修改发布生命周期脚本的主链语义；不执行发布、部署或迁移；写入 E 盘生产归档目录前先确认现状并说明。

交付：创建 codex/release-wp3-receipts-20261012 分支与独立 worktree，做一至三个聚焦提交并推送该分支。不合并 main。交付说明列出：现有体系盘点结论、扩展项与既有文件的关系、四态区分验证结果、静态/动态分离的实现方式、未执行的操作、需用户决定的归档根路径。
```

---

## WP-5 剩余可靠性缺口核实（只读）

- 风险：中，但本包只读。
- 修订点（对应第 6 点指正）：本包**只做核实，不做修复**，且**不必等 WP-4 完成**。同域修改串行即可，只读调查可先行。
- 现状：`tools/process-deadline.ps1` 已实现退出码读取与有界输出快照。
- 前置：WP-B 完成。

```
你是本仓库（D:\运营管理系统）的运行时可靠性调查 agent。本包只做只读核实，不修改任何文件。

第一步：阅读 AGENTS.md、docs\规范\验证与发布.md、运行与启动.md、系统架构.md。核验这些既有契约：
- 只有唯一 Worker 的 EnterMaintenance -KeepPostgres 才能持久声明应用维护。
- Stop/Restart 与桌面控制面板共用同一个系统互斥，拿不到锁时直接拒绝而不是交错执行。
- 只有 Worker 内部状态明确为 stale_or_invalid_receipt、受保护回执可验证且 supervisor 不存在时，唯一引擎才可通过既有精确回执删除函数清理该回执，并必须回读为 stopped；端口占用、身份不明、回执损坏、状态错误或健康异常均失败关闭。
- 一次顶层 Django Start 或 Stop 中，完整 runtime 后代 ACL 审计只执行一次；同进程子域只能复用绑定 PID、runtime 路径和部署清单 SHA-256 的本轮证据。

第二步：核实已有修复的覆盖范围
- 精读 tools\process-deadline.ps1：ExitCode 读取路径、有界输出快照（MaxOutputBytes）、失败代码分类（process_deadline_exhausted / output_limit / output_incomplete / exit_unavailable / process_transport_failed）、以及它对内核进程身份的保持方式。
- 确定：哪些历史故障形态已被它覆盖，哪些没有。逐条给出判据。
- 找出 tools\ 下所有调用或应当调用 process-deadline.ps1 的位置，核对是否已全部接入。未接入的即为缺口。
- 检查 tools\operations-system-control.ps1、operations-system-service.ps1 等包装脚本当前的退出码传递路径，确认是否仍存在"控制器已完成、外层外壳留尾、退出码不可采集"的形态。

第三步：核实剩余阻断
- 读取 docs\release-no-data-policy-20261010\REPORT.md 与其同目录文件，核实其自述的"原 AB 的 active 所有权与第 19 步 unknown 阻止新正式 plan/batch"是否仍成立，在第 WP-B 基线报告的基础上补充可靠性视角的判定。
- 读取 docs\历史记录\性能与发布\supervisor-exit-diagnostics-20260929.md、docs\运维\监控与恢复\worker-liveness-recovery.md、docs\历史记录\性能与发布\wrangler-self-check-stability-20260929.md、docs\历史记录\性能与发布\workerd-inspector-retention-fix-20260929.md，核对其中记录的问题哪些已被后续实现覆盖、哪些仍开放。
- 对还开放的项，给出证据边界（是"未复现"还是"已复现未修复"）。

第四步：生命周期锁
- 只读证据来源：docs\历史记录\性能与发布\product-overview-speed-production-20261005.md 记录的拒绝序列、tmp\system-service\ 下的 background.json 与各 *-2026*.stdout/stderr 日志、.runtime\ 下相关状态文件。
- 在代码中找出所有获取生命周期互斥或系统互斥的位置，画出获取顺序、持有范围、超时与释放路径，标出可能形成嵌套获取、跨进程持有或异常路径未释放的点。
- 目标：给出一个可复现的锁占用场景（在隔离环境复现），或一份明确说明为何在当前证据下不可复现的结论及其证据边界。不得用猜测填补证据空白。

第五步：输出
- 写入 docs\release-pipeline-optimization-20261012\WP5-RELIABILITY-GAPS.md，包含：已覆盖清单 / 剩余缺口清单（每项含证据、证据边界、影响、是否阻塞发布）/ 生命周期锁排查结论。
- 明确区分"已复现并已修复""已复现未修复""未复现""证据不足"。不得把未复现描述为已修复。

禁止事项：不修改任何文件（除本包报告）；不清锁；不强杀服务；不扩大超时；不执行生产维护、迁移、部署、服务停止或重启；不修改 .dev.vars；不连生产数据库。

交付：创建 codex/release-wp5-reliability-gaps-20261012 分支与独立 worktree，提交 WP5-RELIABILITY-GAPS.md，推送该分支。不合并 main。交付说明列出：已覆盖与剩余缺口的统计、生命周期锁结论、哪些项阻塞发布、建议的修复优先级与串行约束。
```

---

## WP-4 发布时序测量与重新设计

- 风险：**高**。触及发布流程语义。
- 修订点（对应第 2 点指正）：**先把时序测准，再谈重新设计**。区分 T1/T2/T3 三个口径。承认前备份与前恢复本就在维护窗口之前。
- 前置：WP-B、WP-1、WP-2 完成；WP-5 的只读核查已完成（避免与后续修复冲突）。
- 默认产出：只读分析 + 设计文档 + 隔离演练。**不执行任何生产维护。**

```
你是本仓库（D:\运营管理系统）的发布工程 agent。本包先测准时序，再设计改进。本包默认不执行任何生产维护、迁移或服务操作。

第零步：在动手前输出一份「方案确认请求」，列出你打算改动的文件、打算调整的阶段顺序、以及你认为需要发布工具所有者确认的三个最关键判断点。等待确认后再继续。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md、验证与发布.md、运行与启动.md、数据存储与迁移.md、docs\运维\部署与启动\startup-release-optimization.md、docs\历史记录\性能与发布\performance-five-production-20261006.md、docs\历史记录\性能与发布\product-overview-speed-production-20261005.md、docs\历史记录\性能与发布\bi-cockpit-production-20261006.md、docs\历史记录\自动化\吉客云\jackyun-5478-production-20261005.md。

第二步：重建真实时序（本包最重要的产出，先做这个）
从上述记录中提取每一次发布的完整时间戳，**严格区分阶段归属**，不得把维护窗口前后的阶段混入同一区间。以 docs\历史记录\性能与发布\performance-five-production-20261006.md 为例，原记录为：
- 前原 Backup 20:32:33—20:43:08 UTC（维护前）
- 首次 RestoreRehearsal 参数门禁失败 exit1；准确恢复 20:51:19—21:01:35 UTC（维护前）
- EnterMaintenance 21:08:07—21:11:25 UTC（维护开始）
- 停稳后一致性 probe 21:11:33—21:15:35 UTC（维护中）
- DeployApp 21:15:52—21:17:04 UTC（维护中）
- HardenAcl 21:17:34—21:18:00 UTC（维护中）
- Worker rotation apply 21:18:06—21:20:43 UTC（维护中）
- 后 Backup 21:21:31—21:30:48 UTC（维护中）
- 后 Verify 21:31:10—12 UTC（维护中）
- 后 RestoreRehearsal 21:31:24—21:41:08 UTC（维护中）
- ExitMaintenance 21:42:41—21:43:18 UTC（维护结束）
- Start 21:43:52—21:47:44 UTC（维护后）
- SystemStatus 21:50:26 UTC、VerifyStartup 21:51:10—14 UTC（交付核验）
对每一批发布产出：阶段 | 起止 | 是否在维护窗口内 | 实测耗时。**必须先算清哪些阶段本来就在维护窗口之前，不得把维护前的工作当作新增收益。**

第三步：按三个口径分别测量
- T1 总等待：用户批准上线 → 完整交付（含收尾报告）。起始点需从记录中找出批准时刻；若记录未含批准时刻，明确标注为证据缺口，不得估算。
- T2 业务不可用：应用停止 → 业务恢复可用（对应 EnterMaintenance 到 Start 完成后就绪）。
- T3 失败与补证：失败重试、补证、恢复消耗。需逐项列出（例如首次 RestoreRehearsal 的 exit1 与重跑、ExitMaintenance 与 Start 因锁占用被拒后的处置）。
三个口径分别给出实测值与证据出处。不得互相折算。

第四步：识别真实的改进空间
- 只有在第二步证明某阶段确实位于维护窗口内、且确实可以前置时，才把它列为候选。
- 对每个候选写出：它当前在窗口内的实测耗时、前置需要满足的条件、前置后如何保证验证与恢复保障不减弱、以及前置失败时的回退。
- 核实 Worker 在线准备与 Django PrepareApp 的现行位置：docs\运维\部署与启动\startup-release-optimization.md 第 36—38 行先列 PrepareApp、随后才列"经本次发布明确授权"，且正式采用记录第 63 行明确记载"Worker 在线准备及 Django PrepareApp 已提前完成"。**准备本就可以在批准前完成**，因此这部分不构成新增收益，应在设计中如实标注。
- 明确写出：本方案不承诺零停机；不减少任何完整性校验；准备专用内部校验不产生启动许可。

第五步：隔离演练（仅对确需改动的部分）
- 在隔离环境（独立连接、凭据、端口、存储命名空间；不使用生产 .dev.vars、不连生产 PostgreSQL）复现改动后的时序，记录真实耗时。
- 若无法完整复现，明确记录受阻点与原因，不得用估算冒充实测。
- 不得在运行中的生产 Worker 监听 dist 时原地构建。

第六步：授权清单
把需要用户授权才能执行的步骤单列成清单，标注每步前置条件、影响范围、回退方式与预计窗口时长。此清单只列出，不执行。

禁止事项：不执行生产维护、迁移、部署、服务停止或重启；不放宽任何门禁；不修改生产保护入口；不把在线准备描述为全程零停机；不修改 .dev.vars；不连生产数据库；不把维护前的工作算作维护窗口的收益。

交付：创建 codex/release-wp4-timing-20261012 分支与独立 worktree，提交 docs\release-pipeline-optimization-20261012\WP4-TIMING-ANALYSIS.md 与（如确需）设计文档，推送该分支。不合并 main。交付说明列出：重建的时序表、T1/T2/T3 三口径实测值、真实改进空间与已被证明不成立的改进项、隔离演练实测、授权清单、未执行的操作、仍不能承诺的时限。
```

---

## WP-5G 可靠性缺口修复（条件包）

- 风险：**高**。
- 触发条件：**仅当 WP-5 确认存在确需修复的缺口时启动**。若 WP-5 判定全部已被现有实现覆盖，本包不启动。
- 顺序：与 WP-4 触及同一批生命周期脚本，**必须串行**。建议先完成 WP-4 的设计确认，再决定两包的先后。
- 硬约束：不得通过清锁、强杀服务、扩大超时或放宽门禁来修复。

```
你是本仓库（D:\运营管理系统）的运行时可靠性修复 agent。本包只修复 WP-5 确认的剩余缺口。若 WP-5 报告未发现确需修复的缺口，本包不应启动。

第零步：读取 docs\release-pipeline-optimization-20261012\WP5-RELIABILITY-GAPS.md，确认待修复项清单。与用户确认修复范围后，输出改动计划并等待确认。

第一步：阅读 AGENTS.md、docs\规范\验证与发布.md、运行与启动.md、系统架构.md。核验与 WP-5 相同的既有契约，一条都不能违反。

第二步：修复
- 只针对 WP-5 确认的剩余缺口，逐项修复。每一项必须说明：原缺口、修复方式、为何不减弱原有保障。
- 优先复用 tools\process-deadline.ps1 的既有机制，不新造平行的进程管理实现。
- 任何改动都不得通过清锁、强杀服务、扩大超时或放宽门禁来实现。
- 锁语义与失败关闭语义必须保持或加强。

第三步：负向测试（必做）
- 对每个修复项构造负向测试：构造控制器真实失败，确认外层以非零退出码返回；构造子进程继承管道，确认外层不会无限挂住；锁相关修复需覆盖嵌套获取、跨进程持有、异常路径、超时边界、失败关闭。

第四步：回归
- 运行相关既有回归：至少覆盖 lifecycle、django-local-service 与 startup-release 相关测试文件，以及系统互斥相关的 PowerShell 行为测试。
- 运行 npm run lint 与 git diff --check，两者必须干净。

第五步：验证与限制
- 明确列出本轮结论的适用边界：哪些已复现并修复、哪些仍未复现、哪些证据缺失。
- 不得把未复现的问题描述为已修复。

禁止事项：不执行生产维护、迁移、部署、服务停止或重启；不清锁；不强杀服务；不扩大超时；不放宽任何完整性门禁；不修改 .dev.vars；不连生产数据库。

交付：创建 codex/release-wp5g-reliability-fix-20261012 分支与独立 worktree，做一至三个聚焦提交并推送该分支。不合并 main。交付说明列出：修复项清单、负向测试结果、回归结果、未执行的操作、仍需用户决定的语义问题。
```

---

# 七、执行顺序

```
第零波（强制前置，只读）
  WP-B  现状基线与覆盖缺口对照   ← 其余各包在它产出对照表前不启动施工

第一波（并行，只读或低风险）
  WP-0  Git 盘点（只读）
  WP-1  CI 基础设施与验证分级
  WP-5  剩余可靠性缺口核实（只读）   ← 不再等 WP-4
  注：WP-0 采集期间，其他 agent 不得改动 worktree，否则清单失效。

第二波
  WP-2  风险分级对齐现行分类器     ← 需 WP-B
  WP-3  证据体系扩展               ← 需 WP-B
  注：WP-2 与 WP-3 都往 docs\规范\验证与发布.md 写入。
      推荐先合 WP-2，WP-3 再基于已合入规范追加；或两包只出 patch，由用户合并。

第三波（需用户逐项确认后启动）
  WP-0G Git 治理                   ← 需 WP-0 清单 + 用户确认

第四波（高风险，串行）
  WP-4  发布时序测量与重新设计      ← 需 WP-B、WP-1、WP-2、WP-5
  WP-5G 可靠性缺口修复（条件包）    ← 需 WP-5 确认存在缺口；与 WP-4 同域，必须串行
```

**并发约束**：
- WP-4 与 WP-5G 触及同一批生命周期脚本，**不得并发**。
- WP-2 与 WP-3 共享 `docs/规范/验证与发布.md`，写入需串行。
- WP-0 采集期间，其他包不得改动 worktree（时间互斥，非文件互斥）。

# 八、合并与审批

**合并者是用户本人（或用户指定的人），不是各 agent。** 每段提示词均写明"不合并 main"。

| 动作 | 执行者 |
| --- | --- |
| 产出 `codex/release-*` 分支并推送 | 各 agent |
| 核验分支内容与证据 | 用户 |
| 合并到 main | 用户 |
| 推送 `origin/main` | 用户 |
| worktree / 分支清理 | 用户确认后由 WP-0G 执行 |

合并前建议检查：

```bash
git -C "<worktree路径>" log --oneline main..HEAD
```

确认提交范围只有本包文件。

```bash
git -C "<worktree路径>" diff --stat main..HEAD
```

确认改动面与声明范围一致，识别越界。

```bash
git -C "<worktree路径>" diff --check
```

空白与冲突标记检查。

**审批粒度**：WP-B、WP-0、WP-1、WP-2、WP-3、WP-5 为只读或低风险，产出后可集中审阅。WP-0G、WP-4、WP-5G 涉及不可逆操作或生产语义，须单独授权。**WP-4 与 WP-5G 采用"先设计后授权"**：agent 先出只读分析与设计，用户确认设计后再对具体动作授权，避免一开始就进入审批等待。

# 九、用户决策点

1. WP-B 对照表中各项的采用状态判定是否成立——特别是有争议的"已实现但未采用"。
2. CI 运行器由谁提供（本机自托管 / 其他）。这是 WP-1 的先决约束。
3. WP-2 的分级边界：哪些改动保留完整保障。
4. WP-3 回执的归档根路径（现有证据落在 `E:\codex-artifacts\`，本方案不自行创建或改变生产归档目录）。
5. WP-0 清单中每一项的最终处置方式。
6. WP-4 授权清单的执行时机与维护窗口安排。
7. WP-5G 是否启动、修复优先级、与 WP-4 的先后顺序。

# 十、方案边界

- 本文件为施工计划，**不产生任何生产部署、数据写入、服务操作或后续维护授权**。
- 文中所有实测数值均引用仓库既有记录并标注来源；本次未新增测量。
- 三态判定以 WP-B 的实际调查结论为准，本文件中的"已实现/未采用"表述为待核实状态。
- 各工作包提示词中的路径与命令需在执行时按当时实际状态复核；`docs\规范\开发与交付.md` 要求以当前代码与实际状态为事实来源。
- 收益目标以相对值表述，绝对值待 WP-B 建立基线后确定。

---

## 附录 A：v1 错误更正表

| # | v1 原文 | 实际情况 | 证据 |
| --- | --- | --- | --- |
| 1 | "发布前备份……与独立恢复演练……也被排在维护窗口之内" | 前备份 20:32:33—20:43:08、前恢复 20:51:19—21:01:35 均在 EnterMaintenance（21:08:07）之前 | `docs/历史记录/性能与发布/performance-five-production-20261006.md` |
| 2 | "C 级发布方式为 `-Action Restart -KeepBackend`" | 该命令只重启当前 exact release 的 Worker 子进程，返回原 ReleaseId/Sha256，无候选切换 | `tools/operations-system-service.ps1:285`、`tools/worker-local-service.ps1` |
| 3 | "WP-3 新增 report generator" | `tools/release-closeout-report.mjs` 已实现 generateCloseoutDraft 与 renderCloseoutDraft，并保留 acceptancePassed: null | `tools/release-closeout-report.mjs:95,194,181` |
| 4 | "WP-5 实现退出码可靠传递" | `tools/process-deadline.ps1` 已读取 $process.ExitCode 并返回，含失败代码分类 | `tools/process-deadline.ps1:170,184` |
| 5 | "C 级：前端展示、筛选、只读页面 → 无需数据库保障" | 现行分类器要求四轴同时成立；GET 查询与筛选事件被明确列为证据不足、保留 full | `tools/release-impact.mjs:356,390`；`docs/release-no-data-policy-20261010/REPORT.md` |
| 6 | "维护窗口约 40 分钟，可压到 6 分钟" | 混用了不同批次耗时；未区分 T1/T2/T3；前备份与前恢复本就在窗口前 | 同上第 1 条 |

所有代码证据固定于 `origin/main` 的 `b3c6018c`。
