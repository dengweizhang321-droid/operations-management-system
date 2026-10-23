# WP-3 发布证据体系补缺

日期：2026-10-12（Asia/Shanghai）。结论：**发现报告侧必要缺口，已有代码改动，不能以“无需代码改动”结项。** 仅扩展既有 `release-closeout-report.mjs` 和既有独立测试入口；没有新增产品模块、第二套证据系统或生命周期执行器。生产验收仍须人工/独立事实复核，所有生成结果保持 `acceptancePassed:null`。

## 固定基线、上游与交付

| 项目 | 固定 SHA / 关系 |
| --- | --- |
| baseSha | `b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354`，刷新 origin 后的最新 origin/main |
| 任务1 WP-B | `74c5e6330b88248c7ebcc778e32310c5b46631d3`；读取其 `WPB-BASELINE.md` |
| 任务3 WP-5 / WP-5G | `4968baedd7ac3fa0948258cdc854fd25045fe8cd`；读取 `WP5-RELIABILITY-GAPS.md`、`WP5-RELIABILITY-FIX.md` 和接口差异；产品修复 `2f21c238d2a4766caad547d08be63acab769ab08` |
| 任务4 WP-4 | `39feb86c7c51b9b8c99232840bf55ad1b0027a02`；读取时序分析及计时投影 |
| 本任务产品与测试提交 | `0ac64cefaa6e4398a24e578a33f25414e768d8bd` |
| 报告、证据及最终交付 SHA | 随后的独立文档提交；最终聊天给出远端回读的完整 SHA，避免文件自指 |

分支 `codex/release-wp3-receipts-20261012`，独立 worktree `D:/codex-isolated/release-wp3-receipts-20261012/运营管理系统`。未覆盖、暂存或提交主检出的既有改动；不合并 main、不删除工作树，由任务6统一集成。任务3已完成交付后才实施本补丁。

已遵守共享记忆 Home 协议，读偏好、长期目标、工作流、相关项目发布笔记及现存最近复盘；复盘目录只有一篇实质日记，不虚构第二篇。已读 AGENTS、README、开发与交付、安全与 AI 工具、验证与发布规范，以及最新 [FINAL_REPORT](../release-final-closeout-20261012/FINAL_REPORT.md)、原回读与回执。

三项上游仅作固定调查依赖，**本实现不依赖其尚未集成的新接口**。复用的 `safeProcessEvidence` 已在 base 中导出。任务3成功 JSON/CLI 保持，新增失败标识 `controlled_script_exit_unavailable` 及实际退出码文本属于其修复；本报告不推断该文本为重试许可，也不把任务3修复假定为 main 或生产已采用。

## 现有能力与必要缺口

| 核查项 | 已满足的能力，保留原实现 | 必要缺口与本次补齐 |
| --- | --- | --- |
| 失败、未执行、未知、协调 | 原操作最新状态与完整事件历史分别保存；失败不会因 reconcile 消失；未执行明确列出 | Markdown 将原失败/unknown/协调合为一个数量；事件投影漏掉原进程证据。改为三列，显示原失败与未知的安全进程投影，保留 exit1 和 timeoutType:null；协调记录仍保留原身份，不追认旧 exit0 |
| 验证器、必需检查集合 | 批次创建/验证已有 test hash、候选 source/artifact、必需检查门；collector 固定实现文件，准备会话不缓存测试完整性 | 收尾草稿未列封存要求/实际检查或核其绑定。现在核 test hash/source/artifact；列必需、记录、缺失集合；核 collector 封存摘要与文件声明；列批次协议和测试验证器版本。缺版本/前驱测试绑定明确未知，有字段却不匹配则拒绝 |
| 候选/前驱绑定 | 批次和准入已有精确 Worker plan 与前驱 binding；旧报告核候选 manifest | 旧版本投影可接收不相关前驱。可提供原 `planEvidence`，逐字节 SHA 同时绑定 batch.workerPlanSha256，并核候选 manifest/前驱 binding；版本回执四项身份须全部与原计划相同。没原计划仍列缺口，不猜版本 |
| 静态与动态 | `release-preparation-evidence` 每次全量重读完整 source/Node/npm/config；watch 只失效，内存会话 10分钟/24次；admission 原末观察年龄上限5秒 | 收尾 runtime 只有时间和组件数量，未标新鲜度。增加生成时刻、年龄、5秒窗、未知/未来/过期/窗内；范围固定 historical-observation-only，establishesCurrentReadiness 永远 false |
| 原字节 | 原 journal 连续序号、canonical 字节、previous/event hash、同批和时间单调；原回执/log/观察 sidecar SHA 及 receipt 对原 operation 的语义摘要绑定；输出 create-only | 增加可选原规格字节 `batchFileSha256` 与原计划字节核验。沿用原 safeRead，未放宽 ACL、重解析点、单链接或文件上限门禁 |
| 独立验收边界 | `acceptancePassed:null`；status 仅描述 journal，completed 仍须全部 passed 且无 cancelled；输出不写原 WAL | 完全保留。缺检查可形成缺口草稿，不能自动生成验收成功；给了互相冲突的绑定/坏字节就拒绝生成 |
| 完整交付与重复劳动 | 已有区间并集、协调跨度、completed 与 delivery 分开的计时和真实10-09离线样本 | 最新最终 V2 回执用 deliveredAt，旧生成器不能消费。显式 `format:final-delivery-v2` 核协议、原批准/完成时刻、操作/WAL数、必要验收对应 passed 事件，再记录 deliveredAt 和 supersedes。原回执无 batch digest 的局限另列 |

`verification.checkInventoryComplete` 只判断封存声明内的检查名齐全及 declared status，不表示检查实际重新运行、验证器当前已采用或要求策略经独立复审。collector 文件摘要是原封存声明的安全投影，不重建历史执行文件。两个真实旧批次没有测试验证器版本及测试级前驱来源字段；本补丁明确缺口，**不为旧批次制造这些元数据**。

精读的 `release-no-data-observation.mjs` 仍要求列举资源实际被页面消费、固定 DOM/style、权限拒绝、两帧自然观察。f15 的 lazy CSS 曾由有限批准补证闭合；本次不改观察器、不自动让所有 CSS 合同通过。`release-lifecycle-step.ps1` 的 engineEvidence、unknown失败回执、实际退出码和原完整后置门只被消费，没有修改可靠性/生命周期主链。准备复用路径此前 missing-parent 资格未闭合；本轮选名的指纹测试通过不关闭该缺口或启用缓存。

任务4 P2 指出 f15 completed→完整交付562.184秒、10-09收尾1466.9857309秒，并要求采用既有离线草稿。这里消除原失败进程证据、版本/检查表和 V2 交付时刻的手工重抄需求；**没有安装阶段自动报告 hook**，也没有把这些历史收尾跨度当作已节省时间。报告的生产消费/完整交付记录仍由任务6决定接入，不能为写报告重放生命周期。

## 最小接口扩展与兼容合同

原 CLI 不变：

```powershell
node tools/release-closeout-report.mjs <offline-input.json> <new-output-directory>
```

原 input 与 `teruisi-release-closeout-draft-v1` 保持；新增字段为附加投影，不改变既有 status/acceptancePassed/operations/failures 语义。旧输入能继续生成；新增未知证据在 evidenceGaps 表达，旧输入给了矛盾封存证据则拒绝。

| 输入/输出 | 合同 |
| --- | --- |
| input.batchFileSha256 | 可选，绑定原规格文件字节；与原 approvedSha256 的批次语义摘要分开 |
| input.planEvidence | `{path,sha256}`，原文件 SHA 还必须等于封存 workerPlanSha256；不是调用 plan、当前链或准入工具 |
| input.deliveryEvidence.format | 可选 `final-delivery-v2`，兼容现有最终 V2 原回执；旧 completedAt/deliveryCompletedAt 路径保留 |
| report.verification / planIdentity | 原封存声明、精确计划和缺失/不匹配结果；不重新定义 requirementsForImpact 或 release-batch 门禁 |
| report.observedRuntime.freshness | 生成时刻评估的观察年龄；即使窗内也不授当前现场执行许可 |
| report.delivery / generatedAt | 分别保留原必要验收、batch completed、完整 delivery 及草稿生成时刻。不能用 generatedAt 造材料/push/记忆完成时刻 |
| generateCloseoutDraft 第二参数 now | 只供合成测试注入时钟，CLI 不从 input 接受这项能力 |

新增文件只有本报告、`evidence-wp3` 的本任务输入/验证摘要/测试日志和局部 `.gitattributes`。现有产品模块已经合理承载全部逻辑，故未新增产品文件。任务证据不能写进稳定 AGENTS/规范或覆盖旧归档；局部属性只对本目录 log 禁文本规范化与空白检查、JSON 禁换行规范化，保护原验证输出字节，不修改仓库全局规则。

## 合成验证与原件只读兼容性

| 验证范围 | 结果与证据 |
| --- | --- |
| 新扩展12项＋既有独立收尾9项 | **21/21通过**，[日志](evidence-wp3/tests-final.log)；区分 failed/not-executed/unknown/reconcile、缺检查、source/artifact/前驱漂移、验证器版本/文件摘要不匹配、候选/前驱错配、batch/plan字节变更、过期/未来/未知观察、V2错误交付和无对应必要验收事件 |
| 固定 base 反例 | [原输出](evidence-wp3/baseline-tests-final.log)12项未满足新报告合同；包含旧字段缺失与旧不拒错配，不能称12个独立生产缺陷。仅重定向报告模块与测试的相对 import 到本地 base 副本，没有生命周期运行 |
| 原准备指纹选名回归 | **6/6通过**，[日志](evidence-wp3/static-drift.log)；完整 input 内容漂移、同批范围及后置复验；不宣称全缓存测试通过 |
| 原收尾计时与字节选名回归 | **3/3通过**，[日志](evidence-wp3/existing-closeout.log)；重叠计时、未完成批次、原 journal 与原 unknown 保留 |
| 初轮夹具失败 | 首次20项19通过/1失败，[原输出](evidence-wp3/first-fixture-failure.log)：合成缺 checkedAt 用例错误写出 undefined JSON；修夹具为省略字段后通过，不删首失败或归因产品 |
| 本包 lint / Node语法 / diff | 两个改动代码文件 eslint exit0，[日志](evidence-wp3/changed-lint.log)；Node --check、git diff --check及暂存差异复核通过。未扩大运行全仓lint/全量单测或生产构建，不覆盖任务3保留的全仓lint失败 |
| CLI create-only | [结果](evidence-wp3/cli-create-only.json)：首次生成成功；再次指定同目录 exit1，三份已有输出字节不变 |
| 原件与输出脱敏 | 112份最终归档大小/SHA、80 WAL原链、各提供回执/log/sidecar/计划原字节复验；生成后再核原件相同。只投影白名单字段，不复制回执原业务正文、原客户行或配置内容；合成敏感正文不出现在 JSON/Markdown |

定向命令如下。选名避免启动真实浏览器/业务接口/旧 Status、R2或数据库测试；Node依赖仅在独立 worktree 用 `npm ci --ignore-scripts --no-audit --no-fund` 安装。

```powershell
node --test --test-name-pattern='WP3|independent: (completion|receipt|incomplete|interrupted|source/version|independent runtime|report can|observation sidecar|report CLI)' tests/release-closeout-independent.test.mjs
node --test --test-name-pattern='same-batch content|content change invalidates|evidence checked before' tests/release-fastpath-evidence.test.mjs
node --test --test-name-pattern='timing unions|uncompleted batch|offline report' tests/release-acceptance-closeout.test.mjs
npx eslint tools/release-closeout-report.mjs tests/release-closeout-independent.test.mjs
```

[只读离线验证摘要](evidence-wp3/offline-verification.json)固定各原件 SHA、输入 SHA、原链头、输出 SHA 和实际保留的缺口。两份输入为 [10-09](evidence-wp3/historical-1009-input.json)、[f15](evidence-wp3/first-adoption-f15-input.json)。完整 JSON/Markdown 仅输出在本 worktree 的 `tmp/wp3/historical-1009-delivered`、`tmp/wp3/first-adoption-f15-delivered`；原 E 盘归档未覆盖。任务6可用上述 CLI 和输入生成新的隔离目录，不能对原归档使用输出参数。

- **10-09**：原批次 `8f6ed5ef…`；完整交付10021661ms维持旧生成器的毫秒截断，原回执更精细值仍在原件；提供的8份原回执与日志/观察sidecar均原 SHA 及原 operation 绑定通过。新计划回读闭合候选/前驱，历史 runtime 标过期，不宣称现在就绪。
- **f15**：原批次 `f15d06a1…`；80 WAL、19项最新 passed，六次 unknown 及一条 admission-failed保持；Backup原外层exit1、timeoutType:null不改。V2 T1 **71525160ms / 19小时52分5.160秒**，与任务4一致；necessary/completed/delivery分开。原112归档生成前后SHA相同。
- **f15输入范围**：本次没有提供 backup-pre/restore-installed 的原回执、独立运行观察和精确源码提交回执，生成器如实列缺口；这表示本次离线输入不全，不能推断历史验收失败或原件不存在。没有拿最终19passed或独立Root摘要顶替这些证据，也没有读取业务dump/客户数据来补齐。

## 静态/动态边界、集成注意与未测收益

静态指纹用于证明所消费的原文件和封存声明一致。必需检查名、原执行结果、验证器版本、候选/前驱身份分别评估；指纹一致不自动证明检查完整。运行观察保留自身 checkedAt，与生成时刻比较且永远标历史范围；不能复用它替代动作边界的原新鲜准入、进程身份/维护/排空检查。

完整交付 V2 原件没有 batch digest，本补丁仅核原批准、完成、操作/WAL计数及对应必要验收事件，并显式列 `delivery-receipt-lacks-batch-digest`。原回执 supersedes 得以保留，不把 V1 覆盖掉；没有伪造新的材料/push/记忆分项完成回执。独立验收不是本次离线生成的产物。

任务6只集成本分支两次聚焦提交；无需先 cherry-pick任务3新接口才能使用本模块。仍需核最终组合字节、附加输出字段的消费者及候选/生产采用边界；task3失败标识的专用解码若未来需要，应按其固定提交合同另审，当前不依赖。`acceptancePassed:null`、原失败、未测和缺口不能被集成消费者自动改成成功。

收益按证据完整性和状态表达验收。本轮没有生产配对计时，**没有已测净省分钟数、T2停机改善或常态发布收益**；没有以提交数计提速。报告自动 hook、完整材料/Git/记忆分项回执、旧测试验证器版本补录资格、缓存missing-parent、lazy CSS合同及其他未安全复现进程族保持未测/待核，不能由本次通过覆盖。

本次未执行生产启停、部署、迁移、备份/恢复、调度变更、业务写入或真实外发；没有调用 Status/Panel、健康接口或看门狗任务。工作树及隔离输出保留供任务6审查，最终 SHA 以远端同名分支回读为准。
