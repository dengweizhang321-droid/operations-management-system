# 发布流水线工程化优化施工方案

- 方案日期：2026-10-12
- 依据：本次只读诊断（`docs/performance-review-20261008/REPORT.md`、各 `*_PRODUCTION_*.md` 采用记录、`docs/运维/部署与启动/startup-release-optimization.md`、`docs/规范/验证与发布.md`、Git 实测时间线）
- 方案性质：**施工计划**。本文件不执行任何操作，不含生产授权。各工作包由用户单独安排执行。

## 一、问题陈述

发布慢的根因不在机器时间，而在结构：仓库无 CI，所有门禁靠人工串行；无风险分级，文档改动与数据库迁移走同一条 12 阶段全量流程；发布证据以手写文档承载哈希，不可机器校验；发布准备被排在授权之后，导致维护窗口塞满本可在窗口外完成的工作。

实测基准（来自仓库既有记录，非本次新增测量）：

| 项 | 实测值 | 来源 |
| --- | --- | --- |
| 发布前在线 Backup | 14 分 16 秒 | `docs/历史记录/性能与发布/product-overview-speed-production-20261005.md` |
| 独立备份恢复演练 | 10 分 16 秒 | `docs/历史记录/性能与发布/performance-five-production-20261006.md` |
| 排空 + EnterMaintenance | 3 分 18 秒 | 同上 |
| Worker 在线准备 | 45.9–50.6 秒 | `docs/运维/部署与启动/startup-release-optimization.md` |
| 应用切换 + 复验 | 12.6 秒 | 同上 |
| 唯一 Start | 80.0 / 87.6 / 135.2 秒 | 吉客云 5478 / 9-21 采用 |
| ACL 全树审计（已优化后） | 9.2 秒 / 94,057 对象 | `docs/规范/运行与启动.md` |
| 维护窗口合计（估算） | 约 40 分钟 | 上述可并行项串行相加 |

结构与积压指标（本次 Git 实测，2026-10-12）：

| 指标 | 数值 |
| --- | --- |
| 近 30 天提交 | 1,763 |
| 近 30 天 merge 提交 | 403（23%） |
| 含 verify/audit/evidence/acceptance/recheck/repair 的提交 | 380（22%） |
| `docs/` 改动占比 | 19.3% |
| 本地 main 落后 origin/main | 159 个提交 |
| Git worktree 登记数 | 33（其中 20 个 detached HEAD） |
| 本地 / 远端分支 | 29 / 22 |
| 工具脚本 | 162 个，44,759 行；最大单文件 `tools/worker-local-release.mjs` 3,478 行 / 183 KB |
| 测试文件 | 527 |
| `docs/` 文件 | 1,084 |
| CI 配置 | 无（无 `.github` / `.gitlab-ci.yml` / `.circleci`） |

## 二、工作包拆分与依赖

| 包 | 名称 | 独立可并发 | 风险 | 依赖 |
| --- | --- | --- | --- | --- |
| WP-0 | 本地 Git 状态归位与 worktree 治理 | 是 | 低 | 无 |
| WP-1 | CI 基础设施与验证分级 | 是 | 低 | 无（建议在 WP-3 前完成） |
| WP-2 | 发布门禁风险分级与规范修订 | 是 | 低 | 无 |
| WP-3 | 验收回执机器化与文档瘦身 | 部分 | 中 | 弱依赖 WP-2（用语一致） |
| WP-4 | 维护窗口解耦与预准备前移 | 否 | 高 | 依赖 WP-1、WP-2 |
| WP-5 | 生命周期锁与退出码根因消除 | 否 | 高 | 与 WP-4 同域，须串行 |

并发建议：
- 第一波并发：WP-0、WP-1、WP-2（三者文件集基本不相交）。
- 第二波：WP-3（起草即可并发，但合入排在 WP-2 后）。
- 第三波：WP-4，然后 WP-5。WP-4 与 WP-5 触及同一批生命周期脚本，**必须串行**，且都必须先取得发布工具所有者的方案确认。

## 三、全局约束（每个工作包都必须遵守）

摘自 `AGENTS.md` 与 `docs/规范/开发与交付.md`，执行者须自行阅读原文：

1. 从最新 `main` 创建独立 `codex/<任务>-<日期>` 分支及独立 worktree；不在生产运行目录或主检出上开发。
2. 修改前检查 `git status`，工作区既有改动属于用户，不得覆盖、格式化、暂存或提交。
3. 只暂存本任务文件；推送前核验 `git diff --cached`。
4. **合并不等于上线**。方案与代码合入 `main` 不等于生产发布；生产迁移、服务重启、路由切换、自动化启用、数据写入仍须用户明确授权。
5. 未经用户在当前对话明确批准，不得停止、重启或中断本地服务；不得在 Worker 监听 `dist` 时原地构建。
6. 生产 Worker 只能经由 `tools/worker-local-service.ps1` 管理；禁止直接运行 Wrangler、旧 release、`dist` 或 `tools/start-local-worker.mjs`。
7. 测试使用临时目录、内存/临时 SQLite 与夹具；不得覆盖生产 runtime、release runtime、浏览器 profile、备份、审计或 `.dev.vars`。
8. 交付说明必须列出：变更内容、验证结果、提交与推送状态、未执行的部署/迁移/服务操作、仍需用户决定的风险。

## 四、总体目标

| 项 | 现状 | 目标 | 由谁达成 |
| --- | --- | --- | --- |
| 维护窗口 | 约 40 分钟 | < 6 分钟 | WP-4（主）+ WP-1/2（前置） |
| 本地 main 落后 | 159 提交 | 0 | WP-0 |
| worktree 登记数 | 33 | < 5 | WP-0 |
| 首个自动化反馈 | 无 | < 8 分钟（L1） | WP-1 |
| 验证类提交占比 | 22% | < 10% | WP-3 |
| 发布证据形态 | 手写哈希 | 机器可读回执 | WP-3 |
| 已知发布中断缺陷 | 锁占用来源未定位 | 定位并加固 | WP-5 |

目标为期望值，不作为验收断言。各包的验收以各自判据为准。

---

# 五、工作包详述与可直接投喂的提示词

以下每节的「提示词」块可整段复制，作为独立 agent 的首条输入。每段均自包含，不依赖本对话上下文。

---

## WP-0 本地 Git 状态归位与 worktree 治理

- 风险：低。工作目录操作，不触及生产进程。
- 范围：`main` 与 `origin/main` 对齐；33 个 worktree 逐项判定并出清单；29 个本地分支/22 个远端分支的可清理项判定。
- 硬约束：**本包只产出清单与建议，不删任何分支、不移除任何 worktree**。移除须用户逐项确认。有未提交改动的 worktree（已知 `codex/startup-recovery-continuation-20261012` 3 处、`codex/startup-recovery-integration-20261012` 2 处）必须先保全。
- 已知需保全的提交锚点：`aeb2fc65`（worktree `bf14`）、`18d0cae6`（worktree `c198` / `ccf9` / `watchdog-native-census-20261012`）、`c24c8abf`、`b3c6018c`、`f0752ec2`、`c00edc8d`、`cb007f05`、`bc1d830b`、`6a715362`、`c6d1fad1`、`bc9eb01f`、`f08b3488`、`c1d89b29`、`f0752ec2`。
- 验收：产出一份机器可读清单（每项含：路径、分支或 detached SHA、是否已合入 `main`、未提交改动数、忽略文件情况、建议动作、阻塞原因）；并给出对齐 `main` 的可执行命令序列（尚未执行）。

```
你是本仓库（D:\运营管理系统）的工程维护 agent。本包只做只读调查并产出清单，不得删除分支、不得移除 worktree、不得改变任何生产状态。

第一步：阅读 D:\运营管理系统\AGENTS.md、README.md、docs\规范\开发与交付.md，以及 docs\规范\README.md。其中「本地 worktree 与分支清理」一节是本包的权威规则，逐条遵守。

第二步：只读采集
- git status --porcelain -b
- git worktree list --porcelain
- git branch -vv
- git branch -r
- git log --oneline origin/main..main 与 git rev-list --left-right --count main...origin/main
- 对每个 worktree：git -C <path> status --porcelain、git -C <path> log -1 --format='%H %ad %s' --date=iso、以及该 HEAD 是否已被 main 包含（git merge-base --is-ancestor <sha> main）。
- 对每个本地分支：是否已完整合入 main（git branch --merged main）、是否有同名远端分支、最后一次提交时间。

第三步：逐项判定，输出到 docs\release-pipeline-optimization-20261012\WP0-INVENTORY.md，表格列固定为：路径 | 分支或 detached SHA | 已合入 main | 未提交改动数 | 忽略文件情况 | 建议动作 | 阻塞原因。
建议动作只能取：可安全移除 / 需先保全提交 / 需先保全忽略文件 / 使用中不可动 / 身份不明不可动。
对「可安全移除」的项，必须证明：已完整合入 main、无未提交内容、无忽略文件、无进程占用该路径、无自动化或正式启动绑定。任一条不能证明就降级为「需先保全」。

第四步：给出主检出对齐 main 的命令序列，写入同一文件的「待执行命令」小节。命令必须逐条可复制，每条前用注释说明其作用与不可逆性。不要执行这些命令。

第五步：把清单摘要（计数、最需要用户决策的前 5 项）写入交付说明。

禁止事项：不执行 git worktree remove、git branch -D、git push --delete、git reset、git clean；不对任何 worktree 做 checkout 或切分支；不修改被调查 worktree 内的任何文件。

交付：创建 codex/release-wp0-git-inventory-20261012 分支与独立 worktree，在其中产出 WP0-INVENTORY.md，做一个聚焦提交并推送该分支。不合并 main。交付说明列出：采集到的事实、清单路径、未执行的操作、需要用户逐项确认的决策项。
```

---

## WP-1 CI 基础设施与验证分级

- 风险：低。新增 CI 配置与测试切片，不改动现有发布脚本。
- 现状事实：仓库无任何 CI 配置；Node v24.18.0，npm 11.16.0；`npm run test:unit` = `node --import tsx --test tests/*.test.ts`（527 个测试文件）；`npm run test` = `vinext build && test:unit && rendered-html`，即**测试绑定生产构建**，而 `docs/规范/验证与发布.md` 要求构建前检查 127.0.0.1:3000 是否被本项目占用。CI 必须绕开这条耦合。
- 范围：建立 L0–L3 四级验证、按业务域切片、提供 `npm run` 入口与 CI 工作流文件；**不在本包内运行全量构建，也不接管发布**。
- 硬约束：CI 运行器不得读取生产 `.dev.vars`、不得连接生产 PostgreSQL、不得占用 3000 端口、不得触发任何真实外部发送（n8n、机器人、Webhook、邮件、浏览器自动化一律禁用或指向测试接收端）。
- 验收：四级中至少 L0/L1 可在本机以单条命令复现；每级的判定判据写入文档；CI 工作流文件通过语法校验；给出各域测试切片与实测耗时。

```
你是本仓库（D:\运营管理系统）的 CI 工程 agent。本包只建立分级验证基础设施，不发布、不部署、不改业务代码。

第一步：阅读 AGENTS.md、README.md、docs\规范\开发与交付.md、docs\规范\验证与发布.md、docs\规范\前端与性能.md。特别核验「npm test 会先执行生产构建」「构建前必须检查 127.0.0.1:3000 是否被本项目服务占用」「测试优先使用临时目录、内存/临时 SQLite 和夹具」这几条既有约束，你的方案不得违反它们。

第二步：现状勘察（只读）
- 统计 tests\ 下的测试文件数与按文件名/目录可归入的业务域分布。
- 找出哪些测试会读取 .dev.vars、连接真实 PostgreSQL、或依赖 3000 端口 / dist。列出它们的文件名与判定依据。这些测试不得进入 L0–L2。
- 找出 docs\规范\验证与发布.md 已列出的最小回归入口（例如 startup-release-optimization.test.ts、django-local-service.test.ts、system-lifecycle-race.test.ts）以及 package.json 中现有的 test / test:unit / lint / check:backend-boundary / preview:isolated / preview:verify 脚本语义。
- 确认仓库当前确无 CI 配置（检查根目录是否存在 .github、.gitlab-ci.yml、.circleci、Jenkinsfile、azure-pipelines.yml）。

第三步：设计四级验证，写入 docs\release-pipeline-optimization-20261012\WP1-CI-DESIGN.md
- L0（目标 < 2 分钟）：git diff --check + lint + 受影响域的单元测试（不启动构建、不启服务）。
- L1（目标 < 8 分钟）：单业务域的接口/契约测试 + 前端组件测试，使用临时 SQLite 或内存夹具，不启生产 Worker。
- L2（目标 < 20 分钟）：跨域集成 + 真实浏览器 UI 探针（仓库已有大量 tools\verify-*-ui.mjs，复用它们，不得新造重复实现）。
- L3（按需）：全量 test:unit + 生产构建 + 隔离镜像冷启动验收，保持既有隔离要求。
每一级必须写明：命令、判定判据（退出码与断言）、允许触碰的资源、绝对禁止触碰的资源、超时。

第四步：实现
- 在 package.json 增加 verify:l0 / verify:l1 / verify:l2 脚本，按域参数化（例如 verify:l1 --domain sales）。这些脚本不得调用 vinext build。
- 增加按域切片的测试入口，域划分与 backend\ 下的所有权域一致（sales、finance、netshop、market、products、inventory、workflow、customer_service、erp_reference、bi、ai_assistant、access_control、system_backups、system_datasets、business_analysis）。
- 增加 CI 工作流文件，默认 L0 + L1，手动或标签触发 L2/L3。工作流不得引用生产密钥或生产数据库。
- 不要在 CI 中运行 npm test。

第五步：验证
- 逐级在本机实际运行，记录真实耗时与退出码。
- 对任一级做一次负向验证：故意失败一个断言，确认该级以非零退出码失败。
- 运行 npm run lint 与 git diff --check，两者必须干净。

禁止事项：不修改 .dev.vars；不启动 tools\worker-local-service.ps1；不运行 wrangler；不连接生产 PostgreSQL；不触发 n8n、钉钉机器人或任何外部发送；不修改既有发布脚本。

交付：创建 codex/release-wp1-ci-20261012 分支与独立 worktree，做一个或多至三个聚焦提交并推送该分支。不合并 main。交付说明列出：各级命令与实际耗时、切片映射、被排除的测试及排除理由、未执行的操作、需要用户决定的风险（例如 CI 运行器由谁提供）。
```

---

## WP-2 发布门禁风险分级与规范修订

- 风险：低。文档与规范修订。
- 现状事实：`docs/规范/验证与发布.md` 仅有一条分级萌芽（「仅文档变更无需运行生产构建」），而文档改动占近 30 天改动量的 19.3%。10 月 5–7 日的多数上线（筛选自动加载、下拉框布局稳定、客服工作流解析修复、广东仓看板）按风险属 C 或 B 级，却走了 A 级全量流程。
- 范围：在专题规范中建立 D/C/B/A 四级风险门禁，明确各级必需的验证、发布方式、备份要求与禁止项。
- 硬约束：只补写稳定规则，不复制正文；`AGENTS.md` 只允许维护开发约定与路径索引，**不得追加任何每日开发内容、发布流水或单次验收结果**；同一规则只保留一份正文。分级不得放宽任何安全门禁（鉴权、权限、敏感数据、ACL、迁移完整性）。
- 验收：规范中分级表完整、无重复正文、所有相对链接可达；给出 9 月 25 日至 10 月 8 日已发生的发布对照分级结果（哪些属于 C/B）。

```
你是本仓库（D:\运营管理系统）的规范维护 agent。本包只修改规范文档，不改任何代码、脚本或配置。

第一步：阅读 AGENTS.md、README.md、docs\规范\README.md、docs\规范\开发与交付.md、docs\规范\验证与发布.md、docs\规范\运行与启动.md、docs\规范\数据存储与迁移.md、docs\规范\安全与AI工具.md。注意 docs\规范\README.md 的「内容归属」要求：稳定规则只在所属专题维护一份正文，其他位置用链接引用；AGENTS.md 不得追加每日开发内容。

第二步：从既有记录中提取实际发布形态，只读参考这些文件的标题与结论段：docs\运维\部署与启动\startup-release-optimization.md、docs\历史记录\性能与发布\bi-cockpit-production-20261006.md、docs\历史记录\性能与发布\performance-five-production-20261006.md、docs\历史记录\性能与发布\product-overview-speed-production-20261005.md、docs\历史记录\自动化\吉客云\jackyun-5478-production-20261005.md、docs\历史记录\自动化\京东\jd-customer-service-release-20261007.md、docs\tmall-seven-day-gap-loop-20261008\、docs\shared-filter-layout-20261007\、docs\guangdong-plan-entry-20261006\。目标是弄清每一类改动当前实际走了哪些阶段，不要摘抄哈希与证据细节。

第三步：设计 D/C/B/A 四级门禁
- D：仅 docs\ 改动。判定：diff 不触及 docs\ 以外任何文件。
- C：前端展示、筛选、文案、只读页面调整，不改后端契约、不动 db、不动 worker 契约。发布方式为 Worker 热重启（tools\operations-system-service.ps1 -Action Restart -KeepBackend，目标 30 秒内），不执行 Django 备份与独立恢复演练。
- B：单业务域后端逻辑，无数据库迁移，不触及鉴权、权限、导入、自动化状态机、跨域契约。
- A：数据库迁移、鉴权与权限、敏感数据、导入与自动化状态机、跨域契约、Worker/Django 生命周期脚本本身。保持现行全量流程。
每一级必须明确写出：必需的验证、必需的备份与恢复演练、是否进入应用维护、允许的最小停机方式、绝对禁止的捷径、回退方式。
分级判定必须以文件路径与契约影响为准，不以提交信息措辞为准。任何一级都不得放宽鉴权、权限、敏感数据、ACL、迁移完整性与发布后回读的要求。

第四步：落笔
- 把分级表作为稳定规则写入 docs\规范\验证与发布.md 的相应位置，或经判断写入更合适的既有专题。只有一处正文。
- 在 docs\规范\开发与交付.md 与 docs\规范\运行与启动.md 中只添加指向该正文的链接，不复制内容。
- AGENTS.md 不得新增任何每日内容、发布流水或验收结果。若分级规则确实需要一个索引条目，只允许在既有「规范索引」表格中增改一行路径指向。
- 检查所有新增与改动的相对链接可达（逐条打开确认目标文件与锚点存在）。

第五步：对照验证
- 打开 docs\release-pipeline-optimization-20261012\PLAN.md 与本方案记录，把 2026-09-25 至 2026-10-08 期间已发生的发布逐一对照新分级，产出一张对照表写入 docs\release-pipeline-optimization-20261012\WP2-CLASSIFICATION-AUDIT.md，列出「按新分级应为哪级 / 当时实际走了哪些阶段 / 差异」。
- 明确指出哪些历史发布按新规则本可显著缩短，但不得因此改写任何历史采用记录。

禁止事项：不修改任何 .ts/.tsx/.mjs/.ps1/.py 文件；不修改 package.json；不执行发布、部署、迁移或服务操作；不复制正文到多处。

交付：创建 codex/release-wp2-release-gates-20261012 分支与独立 worktree，做一个聚焦提交并推送该分支。不合并 main。交付说明列出：改动文件清单、四级判据摘要、链接检查结果、对照审计路径、未执行的操作、仍需用户决定的分级边界。
```

---

## WP-3 验收回执机器化与文档瘦身

- 风险：中。新增脚本，不改既有验收语义。
- 现状事实：近 30 天 380 个提交（22%）含 verify/audit/evidence/acceptance/recheck/repair 字样；发布证据以手写哈希誊写为主（如 `docs\历史记录\性能与发布\performance-five-production-20261006.md` 中「非作者对完整对象逐项独立比较，而不是仅比较总体 hash」——人力在做脚本该做的事）；`docs\` 已 1,084 个文件。
- 范围：统一验收回执 schema 与生成器；改造若干既有 verify 脚本使其输出回执；提供从回执渲染发布报告的模板。
- 软依赖：WP-2 的级别用语。若 WP-2 未完成，回执 schema 中的等级字段留空并标注，不阻塞本包。
- 硬约束：回执必须只含指纹、断言结果、退出码、时间戳与范围描述；**禁止写入原始客户数据、订单行、凭据、令牌、密码或密钥**（`docs\规范\安全与AI工具.md` 与 `开发与交付.md` 的文档维护要求）。改造既有脚本时不得放宽或删除任何断言。
- 验收：至少两个既有 verify 脚本产出合规回执；模板可从回执生成一份示例报告；对输入指纹变化能正确判定失效。

```
你是本仓库（D:\运营管理系统）的工程自动化 agent。本包把人工誊写的发布证据改为机器可读回执，并给出由回执渲染报告的模板。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md（尤其「文档与长期信息维护」）、docs\规范\安全与AI工具.md、docs\规范\验证与发布.md。核验「禁止记录密码、令牌、个人敏感信息或原始客户数据」这条硬约束。

第二步：现状勘察（只读）
- 列出 tools\ 下已有验收/校验脚本，重点阅读：tools\verify-guangdong-ui.mjs、tools\verify-guangdong-plan-ui.mjs、tools\verify-market-query-ui.mjs、tools\verify-netshop-comparison-ui.mjs、tools\bi-cockpit-live-audit.ps1、tools\bi-cockpit-live-audit.py、tools\release-payload-retention.mjs、tools\verify-guangdong-monitor.py、tools\check-django-production-boundary.mjs。
- 观察它们当前的输出形态：是打印文本、写 JSON、还是写日志。
- 观察 docs\ 下现有发布记录如何誊写哈希（参考 docs\历史记录\性能与发布\product-overview-speed-production-20261005.md、docs\历史记录\性能与发布\performance-five-production-20261006.md 的格式），弄清人工环节具体消耗在哪里。

第三步：设计回执 schema
字段至少包含：receiptVersion、task（任务目录名）、level（D/C/B/A，WP-2 未完成则留空字符串并在 warnings 标注）、sourceFingerprints（候选 SHA、部署清单 SHA-256、release manifest 等，键值对）、checks（每项含 id、description、passed、exitCode、durationMs）、artifacts（回执自身、日志、截图的相对路径）、startedAt、finishedAt、overallExitCode、warnings、limitations。
schema 设计必须保证：任何原始业务数据、客户数据、凭据、令牌、密码、密钥都不得进入回执。只允许指纹、计数、断言结果、时间戳与范围描述。在 schema 文档中显式写出这条禁止项与一段正反例。

第四步：实现
- 新增 tools\release-receipt.mjs，提供创建、追加检查项、计算 sourceFingerprints、写出回执（默认写 E:\codex-artifacts\<task>\receipt.json —— 先只读确认该根目录存在与用途，不存在则在文档中提出替代路径并请用户决定，不要自行创建生产目录）。
- 提供 --verify 模式：给定回执与当前 sourceFingerprints，判定回执是否仍然有效（输入变化即失效），以非零退出码表示失效。
- 改造至少两个既有 verify 脚本，使其调用回执生成器输出合规回执。改造过程中不得放宽、删除或跳过任何原有断言。
- 新增 tools\render-release-report.mjs：从回执与一份 Markdown 模板生成发布报告草稿，模板中包含「结论」与「未决风险」两个必须人工填写的段落，明确机器不代填。报告不得包含哈希誊写以外的自由叙述。

第五步：验证
- 对改造后的两个脚本各运行一次，确认回执写入且 schema 合规。
- 构造一次断言失败，确认回执的 overallExitCode 非零且失败项被记录。
- 构造一次 sourceFingerprints 变化，确认 --verify 判定失效并返回非零。
- 用 render-release-report.mjs 从真实回执生成一份示例报告，人工检查其中不含原始业务数据、客户数据或凭据。
- 运行 npm run lint 与 git diff --check，两者必须干净。

禁止事项：不在回执或报告中写入原始客户数据、订单明细、凭据、令牌、密码或密钥；不放宽任何既有断言；不修改发布生命周期脚本；不执行发布、部署或迁移；不写入 E 盘生产归档目录以外的任何生产路径（E 盘写入前先确认现状并说明）。

交付：创建 codex/release-wp3-receipts-20261012 分支与独立 worktree，做一个或多至三个聚焦提交并推送该分支。不合并 main。交付说明列出：回执 schema 摘要与禁止项正反例、被改造的脚本、示例报告路径、验证结果与退出码、未执行的操作、需要用户决定的归档根路径。
```

---

## WP-4 维护窗口解耦与预准备前移

- 风险：**高**。触及发布生命周期脚本与生产操作顺序。
- 现状事实：`docs\运维\部署与启动\startup-release-optimization.md` 已实现 `plan --prepare-online` 与 `PrepareApp`（只准备候选、不动生产，合计约 1 分钟）；但流程要求准备排在「经本次发布明确授权」之后，且发布前备份（14 分 16 秒）与独立恢复演练（10 分 16 秒）也被排在维护窗口之内。维护窗口合计约 40 分钟，其中真正需要停业务的只有排空 → EnterMaintenance（3 分 18 秒）→ DeployApp（12.6 秒）→ ExitMaintenance → Start（约 100 秒）。
- 范围：把候选预准备与发布前备份/恢复演练从维护窗口内移到窗口外；窗口内只保留不可并行的最小动作。
- 前置门槛：本包**必须**先取得发布工具所有者的方案确认，并依赖 WP-1、WP-2 已合入。**本包默认只产出方案与离线演练，不执行任何生产维护。**
- 硬约束：不得放宽 `docs\规范\验证与发布.md` 中任何门禁——维护声明必须仍由唯一 Worker 的 `EnterMaintenance -KeepPostgres` 持久声明；`PrepareApp` 收据必须仍绑定前驱和完整候选指纹；`DeployApp` 必须在维护中复验并切换；失败关闭语义不得削弱；不得承诺零停机。
- 验收：给出精确的新旧阶段时序对照表（含每一项移出窗口的理由与安全性论证）；在隔离环境完成一次演练并记录真实耗时；明确列出需要用户授权才能执行的步骤。

```
你是本仓库（D:\运营管理系统）的发布工程 agent。本包目标是把可并行的发布阶段移出维护窗口。**本包默认不执行任何生产维护、迁移或服务操作。**

第零步：在动手前先输出一份「方案确认请求」，列出你打算改动的文件、打算调整的阶段顺序、以及你认为需要发布工具所有者确认的三个最关键判断点。等待确认后再继续实现。

第一步：阅读 AGENTS.md、docs\规范\开发与交付.md、docs\规范\验证与发布.md、docs\规范\运行与启动.md、docs\规范\数据存储与迁移.md、docs\运维\部署与启动\startup-release-optimization.md 全文。核验这些既有契约，你的方案一条都不能违反：
- 只有已采用的 plan --prepare-online 准备候选，必须复验原生效链、已安装入口与前驱精确进程，不能提前改生产保护入口或发放启动许可。
- Django PrepareApp 收据绑定前驱和完整候选指纹；DeployApp 仍在维护中复验并切换。
- 应用维护仅通过唯一 Worker 的 EnterMaintenance -KeepPostgres 持久声明；普通维护继续完整停机。
- 当前本机正式 Worker 只能由 tools\worker-local-service.ps1 解析并管理不可变 effective head。

第二步：建立精确的现状时序
只读阅读 docs\历史记录\性能与发布\product-overview-speed-production-20261005.md、docs\历史记录\性能与发布\performance-five-production-20261006.md、docs\历史记录\性能与发布\bi-cockpit-production-20261006.md、docs\历史记录\自动化\吉客云\jackyun-5478-production-20261005.md 中记录的实际阶段与时间戳（在线 Backup 20:34:15–20:48:31；恢复演练 20:51:19–21:01:35；EnterMaintenance 21:08:07–21:11:25；后 Backup 21:21:56；Verify 21:23:04；Start 80.0/87.6/135.2 秒）。
产出一张时序表：阶段 | 实测耗时 | 是否必须停业务 | 当前所处的窗口位置。

第三步：设计目标时序，写入 docs\release-pipeline-optimization-20261012\WP4-WINDOW-DESIGN.md
- 窗口外（生产运行中即可完成）：候选构建与完整校验、plan --prepare-online、PrepareApp 及收据绑定、发布前备份、独立恢复演练（复用既有隔离端口与工具）、应用排空的前置只读核查。
- 窗口内（必须停业务）：进入 EnterMaintenance -KeepPostgres → DeployApp -PreparedAppId ... -PreparedAppSha256 ...（实测 12.6 秒）→ HardenAcl → Worker apply → 精确 ID 的 ExitMaintenance → 唯一 Worker Start（约 100 秒）。
- 目标：窗口内合计 < 6 分钟。
对每一项移出窗口的动作，必须写出安全性论证：为什么在生产运行状态下执行它不会改变生产生效版本、不会产生业务副作用、其证据在窗口内如何被重新确认。
必须明确写出：本方案不承诺零停机；不减少任何完整性校验；准备专用内部校验不产生启动许可。

第四步：离线演练
- 在隔离环境（独立连接、凭据、端口、存储命名空间；不使用生产 .dev.vars、不连生产 PostgreSQL）复现新时序，记录每个阶段的真实耗时。
- 若无法完整复现，明确记录受阻点与原因，不得用估算冒充实测。
- 不得在运行中的生产 Worker 监听 dist 时原地构建。

第五步：把需要用户授权才能执行的步骤单列成一份清单，标注每步的前置条件、影响范围、回退方式和预计窗口时长。此清单只列出，不执行。

禁止事项：不执行生产维护、迁移、部署、服务停止或重启；不放宽任何门禁；不修改生产保护入口；不把在线准备描述为全程零停机；不修改 .dev.vars；不连生产数据库。

交付：创建 codex/release-wp4-window-20261012 分支与独立 worktree，提交 docs\release-pipeline-optimization-20261012\WP4-WINDOW-DESIGN.md 及必要的脚本改动，推送该分支。不合并 main。交付说明列出：新旧时序对照、移出窗口的安全性论证、离线演练实测耗时、授权清单、未执行的操作、你认为仍不能承诺的时限。
```

---

## WP-5 生命周期锁与退出码根因消除

- 风险：**高**。触及生命周期并发语义，且与 WP-4 同域。
- 现状事实：两次已被记录但未定位的发布中断缺陷：
  1. 生命周期锁占用来源未定位 —— `docs\历史记录\性能与发布\product-overview-speed-production-20261005.md`：ExitMaintenance 因生命周期锁占用被拒，维护 marker 保持；随后 Start 因 maintenance active 被拒；未清锁、未强杀服务、未扩大超时。
  2. 外层采集外壳退出码未传递 —— 同文档记录作者修正外壳传递 `LASTEXITCODE`；`docs\历史记录\自动化\吉客云\jackyun-5478-production-20261005.md` 与 `docs\运维\部署与启动\startup-release-optimization.md` 均出现「原 Start 控制器 34652 完成全部启动阶段，顶层计时 79.997 秒；外层采集外壳 35728 留尾」「原 Start 控制器退出码未采集，不能记为 exit 0」。
- 相关既有诊断（须一并阅读）：`docs\历史记录\性能与发布\supervisor-exit-diagnostics-20260929.md`、`docs\运维\监控与恢复\worker-liveness-recovery.md`、`docs\历史记录\性能与发布\wrangler-self-check-stability-20260929.md`、`docs\历史记录\性能与发布\workerd-inspector-retention-fix-20260929.md`、`docs\运维\部署与启动\startup-release-optimization.md`。
- 范围：定位锁占用的真实来源；加固外层外壳的退出码与句柄传递，使控制器真实退出码可被可靠采集。
- 顺序：必须在 WP-4 合入之后进行，不得与之并发。
- 硬约束：不得通过清锁、强杀服务、扩大超时或放宽门禁来「修复」。锁语义与失败关闭语义必须保持或加强。
- 验收：给出可复现的锁占用场景；给出根因结论或明确判定为不可复现并说明证据边界；退出码传递有负向测试覆盖。

```
你是本仓库（D:\运营管理系统）的运行时可靠性 agent。本包只排查并加固两个已知缺陷：生命周期锁占用来源未定位，以及外层采集外壳的退出码未可靠传递。与 WP-4 同域，必须串行执行，不得与发布窗口改造并发。

第零步：先输出一份排查计划与假设清单，列出你打算用哪些只读证据来区分各个候选根因。等待确认后再深入。

第一步：阅读 AGENTS.md、docs\规范\验证与发布.md、docs\规范\运行与启动.md、docs\规范\系统架构.md。核验这些既有契约：
- 只有唯一 Worker 的 EnterMaintenance -KeepPostgres 才能持久声明应用维护。
- Stop/Restart 与桌面控制面板共用同一个系统互斥，拿不到锁时直接拒绝而不是交错执行。
- 只有 Worker 内部状态明确为 stale_or_invalid_receipt、受保护回执可验证且 supervisor 不存在时，唯一引擎才可通过既有精确回执删除函数清理该回执，并必须回读为 stopped；端口占用、身份不明、回执损坏、状态错误或健康异常均失败关闭。
- 一次顶层 Django Start 或 Stop 中，完整 runtime 后代 ACL 审计只执行一次；同进程子域只能复用绑定 PID、runtime 路径和部署清单 SHA-256 的本轮证据。

第二步：缺陷一——生命周期锁占用
只读证据来源：docs\历史记录\性能与发布\product-overview-speed-production-20261005.md 记录的拒绝序列、tmp\system-service\ 下的 background.json 与各 *-2026*.stdout/stderr 日志、.runtime\ 下相关状态文件、以及所有实现系统互斥与生命周期锁的脚本（重点 tools\operations-system-control.ps1、tools\operations-system-service.ps1、tools\worker-local-service.ps1、tools\django-local-service.ps1、tools\django-runtime-supervisor.ps1）。
在代码中找出所有获取生命周期互斥或系统互斥的位置，画出获取顺序、持有范围、超时与释放路径，标出可能形成嵌套获取、跨进程持有或异常路径未释放的点。
目标产出：一个可复现的锁占用场景（在隔离环境复现），或一份明确说明为何在当前证据下不可复现的结论及其证据边界。不得用猜测填补证据空白。

第三步：缺陷二——外层采集外壳退出码
复现「控制器已完成、外层外壳留尾、退出码不可采集」的形态。核验后续修正是否完整覆盖了所有同类外壳（检查 tools\ 下所有以文件标准流启动子进程并等待的包装脚本，包括 operations-system-control.ps1、operations-system-service.ps1 以及各 *-production* 采集类脚本）。
加固要求：真实退出码必须可靠传递；子进程持有输出句柄导致的留尾必须有有界等待与明确判定；成功外壳不得冒充操作成功。此修正必须附负向测试：构造控制器真实失败，确认外壳以非零退出码返回；构造子进程继承管道，确认外壳不会无限挂住。

第四步：加固与验证
- 任何改动都不得通过清锁、强杀服务、扩大超时或放宽门禁来实现。
- 为锁语义新增负向测试：嵌套获取、跨进程持有、异常路径、超时边界、失败关闭。
- 运行相关既有回归：至少覆盖 lifecycle、django-local-service 与 startup-release 相关的测试文件，以及系统互斥相关的 PowerShell 行为测试。
- 运行 npm run lint 与 git diff --check，两者必须干净。

第五步：验证与限制
- 明确列出本轮结论的适用边界：哪些场景已复现并修复，哪些仍未复现，哪些证据缺失。
- 不得把未复现的问题描述为已修复。

禁止事项：不执行生产维护、迁移、部署、服务停止或重启；不清锁；不强杀服务；不扩大超时；不放宽任何完整性门禁；不修改 .dev.vars；不连生产数据库。

交付：创建 codex/release-wp5-lock-exitcode-20261012 分支与独立 worktree，做一个或多至三个聚焦提交并推送该分支。不合并 main。交付说明列出：锁获取路径图、复现场景或不可复现结论及其证据边界、退出码加固内容与负向测试结果、未执行的操作、仍需用户决定的语义问题。
```

---

## 六、执行顺序与并发建议

```
第一波（并发）
  WP-0  Git 状态归位与 worktree 治理   → 只出清单，等用户逐项确认后再移除
  WP-1  CI 基础设施与验证分级
  WP-2  发布门禁风险分级与规范修订

第二波
  WP-3  验收回执机器化与文档瘦身      → 可与第一波尾部重叠起草，合入排在 WP-2 后

第三波（串行，且都需先取得发布工具所有者确认）
  WP-4  维护窗口解耦与预准备前移
  WP-5  生命周期锁与退出码根因消除
```

CP 冲突提示：WP-0 触及主检出与全部 worktree，其余各包在独立 worktree 内工作，文件集基本不相交。WP-4 与 WP-5 触及同一批生命周期脚本，**不得并发**。

## 七、用户决策点清单

以下事项方案不代为决定，执行时须由用户明确：

1. WP-0 清单中每一项 worktree 与分支的最终处置（本方案只出建议）。
2. CI 运行器由谁提供（本机自托管 / 其他）。仓库无 CI 现状，`package.json` 的 `test` 脚本绑定生产构建与 3000 端口，这是先决约束。
3. WP-3 回执的归档根路径（现有证据落在 `E:\codex-artifacts\`，本方案不自行创建或改变生产归档目录）。
4. WP-2 的四级边界：哪些改动算 C、哪些必须 A。建议先把 2026-09-25 至 2026-10-08 的既有发布对照一遍再定稿。
5. WP-4 的授权清单执行时机与维护窗口安排。
6. WP-5 若判定为不可复现，是否接受以防御性加固替代根因修复。

## 八、本方案的边界

- 本文件为施工计划，**不产生任何生产部署、数据写入、服务操作或后续维护授权**。
- 文中所有实测数值均引用仓库既有记录，标注了来源；本次未新增测量。
- 各工作包提示词中的路径与命令需在执行时按当时实际状态复核；`docs\规范\开发与交付.md` 要求以当前代码与实际状态为事实来源。
- 目标数值（维护窗口 < 6 分钟等）为工程期望，不是验收断言；验收以各工作包自身列出的判据为准。
