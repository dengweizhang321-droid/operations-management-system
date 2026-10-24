# 2026-10-24 夜间施工：按审查第 4 节重排执行

用户 2026-10-24 认可[发布慢因与施工方案审查](../施工/发布慢因与施工方案审查.md#4-按缩短时间最多重排建议未采用)第 4 节重排并授权今晚执行 S05d、S05b、S05、S08、S16；新分支从 `codex/release-process-review-20261024`（`a6cc9fcd`）拉出，不合入 main。用户未调整沙箱设置。

## 结论

- 代码三单已在分支 `codex/release-rework-20261024` 提交（草稿仓库，早上由脚本推送）：S05d `24dd52ac`、S08 `c35de78e`、S16 `22193950`，文档为其后的提交。沙箱内能运行的直接相关测试均通过，个别失败都是沙箱限制且与基线相同；起子进程的测试沙箱内无法运行，已列入早上推送脚本，未通过前不推送。
- S05b、S05 未执行。原因不是代码阻断，而是沙箱不能在真实仓库提交、不能推送、不能以普通用户运行 installer 和发布入口；control installer 又要求干净的已提交控制源码。按代码核对，正常路径上没有会拒绝新字节的断言（见 [S05B-RUNBOOK](S05B-RUNBOOK.md#s05b-代码阻断核对只读代码2026-10-24)）。
- 队列现状未变：85 张票全有终态，a3d53227 仍是唯一未收敛的 unknown，自 10-22 15:30 起阻塞。今晚没有写队列、控制包、配置或任何生产目录。
- 10-24 早上第一次运行推送脚本，因 3 个新失败中止，未推送。根因是生产者资格固定字节，已修复并换新分支头，见[早上推送脚本中止与修复](#2026-10-24-早上推送脚本中止与修复)；用户重新双击同一个 `1-检查并推送.bat` 即可。

## 逐单结果

| 单号 | 今晚结果 | 提交 / 文件 | 状态 |
| --- | --- | --- | --- |
| S05d（扩大为通用机制） | ①确定未动生产的准备失败写结构化终态：原生 prepare-only 失败写 `teruisi-native-preparation-failure-v1` 记录，控制侧严格校验后记带 dispatch 绑定的 failed；消费者在调用原生前的拒绝记 `rejected-before-native`。②准备阶段 unknown：期限加 15 分钟、无任何上线阶段标记、轮换锁空闲、无 resolution 时写 `abandoned/<dispatchId>.json`，原 unknown 字节不动，同一目标改用 `<base>-r2` 新目录；上线阶段 unknown 仍阻塞。发布入口拒绝已退休包 | `24dd52ac`：`tools/main-prebuild-queue.mjs`、`publish-latest-main.mjs`、`publish-main.mjs`、`publish-prepared-main.mjs`，新测试 `main-prebuild-queue-abandonment`、`publish-main-preparation-failure`，扩展 `publish-prepared-main`；审查修复 `b7db5541`（控制分支 `d1b60496`）：放弃判定移到准入之后；10-24 早上生产者资格修复 `54b3aa0d`（控制分支 `01b0fc5f`） | 代码已提交；早上脚本因新失败中止，已修复，沙箱外测试待重跑；独审 v1 意见已处理，待复审；待 S05b 采用 |
| S08 + 发布工具冻结与解耦 | 新增经测试约束的仅控制包集合，目前可证明 2 个文件；只改它们时 scope `control-only`、components 为空；其他变更集输出逐字节不变；写出冻结规则 | `c35de78e`：`tools/release-scope-plan.mjs`，新测试 `release-scope-control-only` | 代码已提交；沙箱外测试待早上脚本；独审 v1 意见已处理，待复审；分类器待 S09 采用 |
| S16 | 首尾段分项计时（仅日志，作用顺序逐项比对不变）；docs/tests/demos 排除、同进程哈希复用、依赖硬链接三项按证据不实施，给出设计与待确认事项 | `22193950`：`tools/worker-local-release-rotation.mjs`，新测试 `worker-preparation-timing`；分析见 [S16-ANALYSIS](S16-ANALYSIS.md) | 进行中：计时已提交，待随真实发布取数；其余候选待确认 |
| S05b | 写出早上执行手册和准备脚本；未 prepare、未 adopt | [S05B-RUNBOOK](S05B-RUNBOOK.md) | 待执行（转用户早上） |
| S05 | 候选与批次分析：候选 36668589（B1），生产 4059afea 到候选为完整 Worker+Django，新旧分类器结果相同；S08/S16 不在本批 | [S05-CANDIDATE](S05-CANDIDATE.md) | 阻塞（待 S05b 采用） |

各提交身份 `Codex <codex@openai.com>`，父链 `a6cc9fcd` ← `24dd52ac` ← `c35de78e` ← `22193950` ← `606aee50`（文档）← `8eaded4b`（文档）← `b7db5541`（S05d 审查修复）← `087a8348`（审查处理文档）← `54b3aa0d`（生产者资格修复，cherry-pick 自控制分支）← 早上中止记录文档提交（分支头，即含本段的提交）。控制分支 `codex/release-rework-20261024-control`：`a6cc9fcd` ← `24dd52ac` ← `d1b60496`（cherry-pick 自 `b7db5541`）← `01b0fc5f`（生产者资格修复，分支头 `01b0fc5ff7aaf0e44d7c9192f498ed6637970709`）。两个分支都从 `codex/release-process-review-20261024`（`a6cc9fcd`）拉出，均不合入 main。（逐单表中的状态词初稿写为“通过”，独审 v1 指出早于沙箱外测试与审查，已更正；早上脚本通过且复审无阻断后再改。）

### S05d 兼容性要点

- 新队列叶 `abandoned/` 懒创建；队列根的现有读者只枚举 tickets/dispatches/results/resolutions，生产根下已有 runner 日志，新叶不会被拒。对生产队列只读运行新版 `readPreparationQueueInventory`：85 票、33 dispatch，abandonments 0，退休集合为空，a3d53227 符合放弃条件（采用后、有新票、轮换锁空闲时）。
- 不加 abandonment 选项时队列行为与原来一致，原有测试结果与基线相同。
- 已知限制：`preparation-retirement-entry.mjs` 固定了 publish-latest-main/publish-main 字节，只影响个案退休流程，正常路径不用；`preparation-producer-qualification.mjs` 固定了 publish-prepared-main 等 3 个生产者文件字节，个案退休流程和管理员 resolution 的写入与校验都用它（初稿写“只影响个案退休流程”，有误，10-24 早上已更正并重新资格化，见[早上推送脚本中止与修复](#2026-10-24-早上推送脚本中止与修复)）；`-rN` 分支名不被 ref 栅栏正则匹配，进程内仍由 `assertRetirementAdmission` 把关；发布与检查两种模式都在开始前读取并完整校验整个队列清单以推导退休包（发布模式持队列锁，但 `submitPreparation` 不取队列锁；检查模式不持锁），并发提交的半写票、被改动的退休包 invocation 结果文件或孤立放弃记录都会让入口在开始前失败关闭，不会误发布；表现与处理见 [S05B-RUNBOOK](S05B-RUNBOOK.md#6-s05准备与发布) 第 3 条。

### S08 仅控制包分类

只改下表“仅控制包”文件（可另带 docs/tests）时不触发约 27 分钟的应用准备；其余 31 个控制包成员仍按完整处理，没有放宽为 tools/** 轻量。

| 类别 | 路径 | 判定 | 应用准备 |
| --- | --- | --- | --- |
| 文档/离线测试 | docs/、README.md、AGENTS.md、tests/ | non-production | 不触发 |
| 仅控制包（已证明） | tools/main-prebuild-hook.mjs、tools/main-prebuild-status.mjs | control-only，components []，另记 controlOnly 字段与原因“仅控制包:路径” | 不触发，只经控制包采用（S09） |
| 共享控制/原生 | 其余 31 个 controlFiles 及 publish-main*.mjs、publish-prepared-main.mjs、worker-local-release*.mjs、release-batch* 等原生工具 | full | 完整 Worker+Django |
| Worker | app/、components/、public/、styles/、app/api/、worker/ | worker | 仅 Worker |
| Django | backend/<域>/ | django（migrations 另走迁移） | 仅 Django |
| 共享依赖/运行配置 | lib/、package*.json、tsconfig、wrangler、vite/vinext/eslint 配置、backend 运行配置、config/、*.ps1/*.bat/*.cmd、install-main-prebuild.mjs | full | 完整 |
| 未知 | 其他路径；大小写不同的路径；仅控制文件改名后的新路径 | full | 完整 |

闭包证据由 `tests/release-scope-control-only.test.mjs` 强制：两项都在 controlFiles 中；从 publish-main.mjs、publish-prepared-main.mjs 及被控制包以外文件点名的控制文件出发按保守字面量规则传递遍历，两项不可达，且 frozen-main-source、main-schema-release、publish-main-progress 等已知共享文件必须在闭包内；tools/、backend/、app/、lib/、worker/、config/ 等目录中除控制包成员和 install-main-prebuild.mjs、verify-release-candidate.mjs 外无文件点名它们。hook 与 status 只从 bundleRoot 运行。

采用方式：分类器本身是共享控制文件，只有 S09 采用含 `c35de78e` 的控制包后才生效；S05d 改了原生发布工具，首个带它们的批次仍需完整准备。当前收益窄：生产 48 个包中 12 个的范围含这两个文件，但都混有其他代码，按新规则仍为完整。

冻结规则（已写入 [S08](../施工/S08.md)）：控制工具改动集中成批经 S09 一次采用；原生发布工具改动只随真实应用发布合入；新增仅控制文件须同时列入 controlFiles 与 controlOnlyTools 并通过测试；共享文件改为仅控制须先切断非控制引用并另行审查。

### S16 摘要

首段 339 秒、尾段 384 秒的主体按代码对照是“前驱完整自校验”（一次非复用准备 5 次）和 5 次源码身份采样，不是复制或编译；一次前驱自校验推断约 150 至 185 秒，待新计时核实。最大候选是减少前驱复验次数（D-1 去掉被 P5 支配的 P4，D-2 中间边界改轻量），需改受保护 verifier，须先取实数再单独审查。详见 [S16-ANALYSIS](S16-ANALYSIS.md)。

## 测试

沙箱内（`run-test.ps1`，管道名经预加载改到 `\\.\pipe\LOCAL\`）：

| 文件 | 结果 | 说明 |
| --- | --- | --- |
| main-prebuild-queue-abandonment（新） | 13/13，审查修复后 14/14（两个分支各跑一次） | 去掉标记检查和 failed 跳过后 4 项失败；撤回准入顺序修复后新增项失败 |
| release-scope-control-only（新） | 5/5 | 把非仅控制文件加入集合后 2 项失败 |
| worker-preparation-timing（新） | 6/6 | 去掉两个包装后 1 项失败 |
| publish-prepared-main | 58/58 | 含新增断言 |
| main-prebuild-queue-v2 | 10/11 | 与基线相同；失败项起子 node，沙箱限制 |
| main-prebuild-generation-rejection | 6/6 | |
| main-prebuild-status | 14/14 | |
| publish-main-completed | 4/4 | |
| main-prebuild-eligibility、main-dependency-selected-admission、main-schema-selected-admission | 4/4、2/2、2/2 | |
| release-scope-plan | 9/9 | 跳过起 git 的 1 项 |
| preparation-retirement-scope / -admission / -inventory-concurrency | 2/3、1/3、0/4 | 沙箱临时目录 realpath EPERM；scope 在基线上相同 |

超时或无法运行（起子进程或需 tsx）：publish-latest-main、publish-main-preparation-failure、publish-main-step、preparation-resolution、preparation-missing-failure-audit、preparation-superseded-resolution、main-publication-readiness、main-prebuild-hook、main-control-upgrade、preparation-retirement-entry/-ref/-collector/-integration、fixed-native-abandonment、fixed-schema-rejection、fixed-cache-rejection、fixed-cleaned-preparation、fixed-admin-resolution、verify-release-candidate、pi150-forward-recovery、native-391-control、start-timing、tests/worker-local-release-rotation.test.ts、tests/worker-local-release.test.ts。全部在早上脚本中于沙箱外运行。原生失败记录路径另在临时副本中直接运行 `node tools/publish-main.mjs` 手工核过：prepare-only 退出 1 写出有效记录并被控制侧接受，deploy-only 与越界路径不写。所有改动的 .mjs 均通过 `node --check`。

早上脚本（`1-检查并推送.bat`/`push-rework.ps1`、`2-S05b-准备控制包.bat`/`s05b-prepare.ps1`，位于 `D:\运营管理系统\.codex-tmp\rework-20261024\`）：BAT 内容仅 ASCII，ps1 为带 BOM 的 UTF-8，PowerShell 5.1 解析错误 0；脚本本身未执行。推送脚本的白名单与 `git diff --name-only a6cc9fcd HEAD` 逐项相同（26 个文件）；独审 v1 后改为两个分支各一份白名单并要求完全相等，另固定两个分支头（见[独立审查 v1 处理](#独立审查-v1-处理)）。其测试辅助函数单独在沙箱内用 release-scope-control-only 核过：进程内隔离时 5/5 计数解析正确；默认隔离在沙箱内挂起时，限时终止 20 秒内返回（沙箱内 taskkill 自身会挂起，已改为有界等待加直接结束父进程）。

## 今晚遇到的环境限制

- `D:\codex-worktrees\*`、`D:\codex-isolated\*` 对沙箱只读；可写的只有工作区。
- 真实仓库的 reference-transaction hook 需要 Git 自带 msys `sh.exe`，沙箱内启动即失败（0xC0000022），所以不能在真实仓库建分支或提交。
- github.com 不可达，不能 fetch/push，origin/main 只能看本地视图 36668589。
- node 不能起子进程（git、cmd、powershell 都挂起），起子进程的测试只能延后。
- 命名管道只能在 `\\.\pipe\LOCAL\` 下创建；测试经预加载改名，产品代码保持真实管道名。
- 沙箱内 realpath 对生产目录返回 EPERM，installer 的发布包普查无法预跑。

做法：在 `D:\运营管理系统\.codex-tmp\rework-20261024\repo` 建草稿仓库（objects/info/alternates 指向真实仓库对象库），在其中提交；早上脚本把分支取入真实仓库并推送。

## 需要用户执行的动作（按顺序）

1. 双击 `D:\运营管理系统\.codex-tmp\rework-20261024\1-检查并推送.bat`：白名单核对、取入真实仓库本地、建工作树、沙箱外测试、通过后 `push -u`。不动 main，不涉及生产。10-24 早上第一次运行已中止且未推送；修复后仍双击同一文件：脚本把上次已取入的本地分支和工作树从 `087a8348`/`d1b60496` 只按快进升级到新分支头（其他值不覆盖并中止），测试时给工作树临时接入依赖，结束后移除。
2. 双击 `2-S05b-准备控制包.bat`：建控制源码工作树（`01b0fc5f`，控制分支；原为 `d1b60496`）并 prepare，不采用。
3. 手工输入脚本 2 打印的 `--adopt` 命令：生产控制采用（S05b）。
4. 双击生产目录的 `准备main.bat`：新消费者写 a3d53227 放弃记录，并把 36668589 准备到 `-r2` 新目录（约 28 分钟）。
5. 制品 prepared 后双击 `发布main.bat`：S05 上线（约 20 分钟，含维护窗口）。
6. 以后：用户决定把分支合入 main，再走 S09（采用 S08 分类器的控制包）与 S17（S16 计时取数与结算）。

细节、风险与可逆性见 [S05B-RUNBOOK](S05B-RUNBOOK.md)。

## 遗留与未完成

- S05b、S05 未执行，原因见上；不能写成已采用或已上线。
- 早上脚本中只有 1 个已知预期失败，不阻断推送但会显示：`start-timing` 中“publication receipts and lifecycle gates remain outside this candidate”（按候选的守卫，只要分支改了队列/发布工具就会触发，不是行为回归），只允许该 1 个测试以 doesNotMatch 断言失败。`preparation-retirement-collector` 必须通过。（初稿另把 collector 列为已知预期失败，理由是“个案退休流程已被通用放弃机制取代”，判断有误：同一字节固定也用于管理员 resolution，10-24 早上 preparation-resolution 等因此新失败；已更正，见[早上推送脚本中止与修复](#2026-10-24-早上推送脚本中止与修复)。）其他失败只有每个失败测试在 a6cc9fcd 基线上都以同名失败才记为既有问题；超时、缺依赖包、无法解析都中止推送。
- 控制源码选控制分支 `01b0fc5f`（初稿为 24dd52ac，独审 v1 后为 `d1b60496`）而非全部改动分支，是为了不提前采用 S08 分类器（S09 未授权）；用户若决定同批采用，换用全部改动分支上的 `54b3aa0d`（原写 `b7db5541`）。
- S16 其余三项未实施，待新计时与独立审查；S09、S17、S06/S07 未动。
- installer 的发布包普查、全局 hooksPath、首次退休协议采用分支只能在早上实测。
- 模型分工：今晚使用的子代理工具不能指定模型 ID 或推理强度，[任务模型分工](../规范/任务模型分工.md)的映射无法显式套用；独立审查由本功能之后的单独审查上下文执行。

## 独立审查 v1 处理

审查文件：任务目录 `2026-10-24-045813-review.md`（a6cc9fcd..8eaded4b），结论 NEEDS_CHANGES。逐项处理如下，复审待进行。

| 序 | 问题 | 处理 |
| --- | --- | --- |
| 1 | 已知预期失败按输出子串匹配过宽；两侧同因环境失败会被当既有问题放行 | 已修：`push-rework.ps1` 每个测试文件另写 JUnit 结果，按失败测试逐个核对。start-timing 只允许“publication receipts and lifecycle gates remain outside this candidate”这 1 个测试以 doesNotMatch 断言失败（失败数恰为 1）；collector 每个失败都必须带“Fixture must pin actual reviewed producer bytes”（10-24 早上已撤销 collector 这条，改为必须通过）。既有问题须本次每个失败测试在基线上都以同名失败；超时、缺模块（ERR_MODULE_NOT_FOUND 等）、非零退出却无可解析失败都中止推送。判定函数用 9 份构造的 JUnit 样例在沙箱内核过（预期与非预期各类均判对）。有既有问题时脚本提示改状态词前须逐个确认 |
| 2 | S05d、S08 状态写“通过”早于验证 | 已改：S05d.md、S08.md、BOARD、本报告逐单表改为“代码已提交；沙箱外测试待早上脚本；独审 v1 意见已处理，待复审”，并注明初稿措辞。早上脚本通过且复审无阻断后再改 |
| 3 | 放弃判定早于 `admitPreparation` | 已修：`drainPreparationQueue` 先调用准入，通过后才评估放弃；准入失败时不探测轮换锁、不写放弃记录，照旧按原 dispatch 写 blocked。提交 `b7db5541`（全部改动分支）与 `d1b60496`（控制分支，cherry-pick，`tools/main-prebuild-queue.mjs` 字节相同）。新增测试“abandonment is evaluated only after ordinary preparation admission; a rejected host writes no abandonment record”，撤回修复后该项失败；两个分支上 main-prebuild-queue-abandonment 均 14/14、main-prebuild-generation-rejection 6/6、main-prebuild-queue-v2 10/11（与基线相同的起子进程项），控制分支另跑 main-prebuild-status 14/14、publish-prepared-main 58/58 |
| 4 | 发布入口新增对队列完整性的依赖 | 写明影响，未改代码：本报告 S05d 兼容性要点与手册第 6 步第 3 条说明发布与检查两种模式、失败表现与处理。未把发布侧改为只读部分清单，理由：退休集合依赖 failed 终态的 dispatch 绑定与结果文件哈希、放弃记录与原 unknown 的绑定，跳过票与结果的完整校验会让退休集合不可信；当前失败都是开始前失败关闭，重试或按原字节放回文件即可恢复 |
| 5 | 回退旧控制包读不了新终态 | 已写入手册第 4 步回退段：新代际写出带 dispatch 的 failed 后旧代际整份清单不可读，旧代际不读 `abandoned/`，a3d53227 会重新阻塞；回退不能恢复准备，只能向前修复。S05d.md 同步 |
| 6 | 查看打包状态不识别退休包 | 已写入手册第 6 步：两者不一致时以 发布main.bat 为准。未改 `main-prebuild-status.mjs`（属于状态工具改动，超出本轮范围） |
| 7 | 推送头与控制提交未绑定审查 | 已修：`push-rework.ps1` 固定两个分支头，不等即中止；校验控制分支含 `24dd52ac`、不含 S08 提交 `c35de78e`、两分支在 tools/ 下只差 S08/S16 两个文件；两份白名单要求与各自变更集完全相等；两个分支一起取入真实仓库、一起 `push --atomic -u`。`s05b-prepare.ps1` 改为要求 `origin/codex/release-rework-20261024-control` 恰为 `d1b60496` 并以它建控制工作树（10-24 早上改为 `01b0fc5f`）；手册同步 |
| 8 | 退休包只增不减 | 已在 S05d.md 与手册记待办：在 S18 或后续单中定保留期与清理办法，只清已放弃且永不消费的包，保留放弃记录与原 unknown。今晚不实现 |

早上脚本：`push-rework.ps1`、`s05b-prepare.ps1` 仍为带 BOM 的 UTF-8，PowerShell 5.1 解析错误 0，未执行；两个 BAT 未改。推送脚本对控制分支另跑 32 个 S05d 相关测试文件，所以早上耗时约为原来的两倍。

## 2026-10-24 早上推送脚本中止与修复

用户双击 `1-检查并推送.bat`，两个分支已取入真实仓库本地并建好工作树，第 5 步测试后中止，未推送，未动 main 与生产。日志：`D:\运营管理系统\.codex-tmp\rework-20261024\morning-tests-20261024-084540\SUMMARY.txt`。

| 测试 | 两个分支结果 | 分类 | 处理 |
| --- | --- | --- | --- |
| preparation-resolution | 6/10 失败 | 新失败（基线通过） | 根因同下，已修 |
| preparation-superseded-resolution | 6/9 失败 | 新失败（基线通过） | 根因同下，已修 |
| preparation-retirement-integration | 1/1 失败 | 新失败（基线通过） | 根因同下，已修 |
| preparation-retirement-collector | 19/20 失败 | 被当作已知预期放行（错误） | 根因同下，已修，改为必须通过 |
| main-control-upgrade、worker-local-release.test.ts | 缺 `typescript`/`esbuild` 包 | 环境失败 | 测试工作树是新建的，没有 node_modules；脚本改为接入依赖 |
| fixed-schema-rejection、main-publication-readiness | 各 1 项缺模块文件 | 被归为环境失败 | 按代码阅读是基线既有问题，改由基线复跑判定，见下 |
| fixed-admin-resolution | 2 项 `pwsh.exe` 失败 | 既有问题（基线同名失败） | 不变 |
| start-timing | 1 项 | 已知预期 | 不变 |

根因：`tools/preparation-producer-qualification.mjs` 固定了 3 个生产者文件（publish-prepared-main、worker-local-release-rotation、worker-local-release）的字节。它不只用于个案退休：管理员 resolution 的写入与 `validateStaticProof` 校验也要求 packet 的生产者字节属于已资格化闭包，否则报“Unqualified preparation producer code”。preparation-resolution 与 preparation-superseded-resolution 用当前仓库字节构造 packet；S05d 改了 publish-prepared-main.mjs，S16 改了 rotation（只在全部改动分支），所以失败。collector 与 integration 的夹具复制当前仓库字节并断言“Fixture must pin actual reviewed producer bytes”，同样失败。此前“只影响个案退休流程”“collector 是已知预期失败”“该测试在基线已失败”三处说法有误，已在本报告、[S16-ANALYSIS](S16-ANALYSIS.md#7-已知限制)和手册原句处标注更正。

修复（控制分支 `01b0fc5f`，全部改动分支 cherry-pick 为 `54b3aa0d`，修复文件两边字节相同）：

- 生产者资格文件保留版本串与第一个闭包（f641685b，个案退休对 a3d53227 历史 packet 仍用它），追加 S05d 闭包与 S05d+S16 闭包；未知代码代际仍失败关闭。理由：核对 diff，S05d 只在写出不变的 FAILED-<uuid>.json 后给内存中的错误对象加字段，S16 只加 stdout 计时行，FAILED 字节、形状与 packet 文件集合不变。
- 新增 `tests/fixtures/reviewed-producer-f641685b/` 保存 3 个文件的原审查字节（与 a6cc9fcd 的 blob 相同），collector 测试与退休夹具辅助改为从这里读取，固定字节断言不变；`.gitattributes` 加一行 `-text`。
- 未改 resolution、退休资格与 collector 工具，也未改 preparation-resolution 两个测试，保留这道绊线：以后再改生产者文件仍须重新资格化。

沙箱内核对：进程内确认两个分支的当前生产者字节分别属于新增闭包、第一个闭包未变、夹具哈希等于第一个闭包；preparation-resolution 前 7 项通过（含早上失败的 6 项），其余起子进程项超时；publish-prepared-main 58/58、main-prebuild-queue-abandonment 14/14、worker-preparation-timing 6/6 等通过；superseded、collector、integration 在沙箱内超时，以早上脚本重跑为准。对生产队列只读运行新工具：9 份历史 resolution 均可读，未写入。

推送脚本的改动：

- 固定新分支头；本地已存在的分支和工作树只在等于 `087a8348`（全部改动分支）或 `d1b60496`（控制分支）时按快进升级，检出该分支的工作树须停在旧提交且无已跟踪改动；其他值不覆盖并中止。
- 测试前给各测试工作树（含基线工作树）建 node_modules 目录联接，指向 `D:\运营管理系统\.codex-tmp\rework-20261024\deps-8ec00f`（离线依赖目录 `dependencies-8ec00f` 的副本，package-lock sha256 `8ec00f80…` 与分支一致）；结束或中止时只删除脚本自己建的联接，不递归删除。
- collector 移出已知预期失败，start-timing 规则不变。
- 环境失败只认无法解析的依赖包；缺的是绝对或相对路径的模块文件时，按普通失败进入基线复跑。fixed-schema-rejection（测试复制的控制文件清单缺 `preparation-retirement-admission.mjs`）和 main-publication-readiness（候选包清单缺 `publish-main-step.mjs`）按代码阅读在 a6cc9fcd 已同样失败，两者都还没有通过；是既有问题还是新失败，由用户机器上的基线复跑决定。

新分支身份：控制分支头 `01b0fc5ff7aaf0e44d7c9192f498ed6637970709`（`d1b60496` 加 1 个提交），S05b 改用它；全部改动分支头为含本节的文档提交，父提交 `54b3aa0d77d433b7999ead15384b80798657687c`。控制分支仍不含 `c35de78e`，两分支在 tools/ 下仍只差 `release-scope-plan.mjs`、`worker-local-release-rotation.mjs`。

## 证据

- 分支提交与差异：草稿仓库 `git log a6cc9fcd..HEAD`、`git diff --name-only a6cc9fcd HEAD`。
- 队列：`D:\codex-isolated\main-manual-release-20261016\prebuild-queue-v2\`（tickets 85、dispatches 33、results 85、resolutions 9，无 abandoned），只读。
- 控制：`CONTROL-INSTALLATION.json`（installId ade68625…，bundle 83e4158f…，2026-10-22T00:54:17Z），只读。
- 生产：`PUBLISHED-MAIN.json`（4059afea…，2026-10-22T05:34:48.011Z），只读。
