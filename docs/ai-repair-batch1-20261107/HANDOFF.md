# 第一批到第二批交接

状态：2026-11-08 第一批开发、必要检查、专项验证、逐小任务 Astra 反审及负责人集成已完成，可以按已授权顺序创建第二批聊天。第一批仍未合并 main 或上线，不把完成开发当作生产采用。

## 开发来源和交付状态

- 第一批开工时已 fetch 的 `origin/main`：`0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。
- 第一批分支：`codex/ai-repair-batch1-20261107`；工作树：`D:/codex-worktrees/ai-repair-batch1-20261107`。
- 已推送完整受检代码提交：`5d9090b7ef54a2937efe9cfe8556262ccb835294`，tree `40bc87ada55e8fff9fae8628a3add38619280107`。应用功能源码冻结在 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82`，其后 G02 只加离线兼容验证代码。
- 小包提交：W7 `74061295`（测试类型补正 `cb741e62`），W4 `e268b287`，W6a `7caf36f0`，W3 `79ac59cd`，W1/W2 `eee39f9d`，G02 `5d9090b7`。随后仅任务文档收尾，最终分支 HEAD 由新聊天首条交接及 `D:/codex-artifacts/ai-repair-batch1-20261107/DELIVERY.json` 给出。
- 收口时再次 fetch，`origin/main` 仍为 `0c7d0feb`；下一批必须在开工时重新核对，不能把这一观察当永久状态。
- 当前未合并 main、未准备正式应用制品、未上线、未清理生产旧容器；主工作区既有改动保留。
- 原已审施工方案：`D:/codex-worktrees/ai-repair-plan-20261107/docs/ai-repair-plan-20261107/PLAN.md`，方案提交 `492e54bd0e2d408548efc6b918ee9cae216c306f`；同目录 REVIEW.md、EVIDENCE.md。

## 下一批范围和依赖

第二批只做 W5（模型失败分层、报告模型选择）、W6b（依据诊断修复 pandas 与商品日完整导出）、W8（钉钉投递阶段和回执）、W9（DAG 等待分解及有证据的局部提速）。第三批 W10/W11/W12 另用新的批次聊天。

W6a 首批仅交付 Worker/Django 外层诊断。原 Broker 内部阶段诊断改变源码摘要、会导致现有 AI 启动探针拒绝旧 Broker；现有发布器没有 Pandas 轮换，不能只发布应用。已按独立 [窄拆包方案](PANDAS-ADOPTION-PLAN.md) 恢复 Broker 全部 8 个运行 Python 文件至 `0c7d0feb` 原字节，摘要 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`。未降低探针或清理防重账本。

后续候选完整保全于 `D:/codex-artifacts/ai-repair-batch1-20261107/metrics/w6a-broker-deferred/MANIFEST.json`，含可从基线还原的补丁、源码及原审查/测试；它是未采用材料，不能直接覆盖下一批源码或生产。第二批 W6 须同时接续 Broker 内层诊断和明确的专用受控轮换设计，按该方案第 5 节补 root-owned release/unit 与 UID1000 服务的准备、CAS、回执和恢复边界；不可冒用 Pi 执行器、重跑 create-only 安装器、接受任意旧摘要或绕过原发布入口。

下一批从当时最新 main 建独立 `codex/*` 分支及工作树。W6b 明确依赖本批 W6a 诊断；W5/W8 与本批 W3 通用传输接线存在直接依赖/冲突可能；必须读取最终变更和测试接口。不得默默把本批未合并成果叠入新分支，必须先列明开发来源和仍待用户决定的合并状态。无依赖部分可按已有授权推进。

如新聊天已由应用建立合规 worktree，核验后直接复用，不另建第二个批次工作树。本批工作树与分支因未合并且为证据/依赖来源而保留。新的负责人与原统筹聊天协调范围，不在第一批工作树继续写第二批代码。

保留现有确定性分析、pandas 容器、Pi 沙箱和模型配置，不重建平台，不静默改变模型或上下文、输出、thinking、超时。`netshop_product_daily` 和 `sales_category` 原失败分别追踪；不能把分页缺口声称为两次共同根因。旧 unknown 请求和钉钉消息不重放。

## 已有效授权和仍需决定的动作

用户已授权方案内三批开发及对应必要/专项验证，要求每个小任务由 Astra High 独立反审；返修交原 Astra 增量复核，不能以自审、Sol 或最终总审替代。尊重并发槽，唯一负责人管理共享文件与集成，原聊天负责整体统筹。

第一批结束后只创建下一批一个本项目聊天，首条交接携带本文件、报告和有效授权；不能在第一批聊天展开后续批次，也不提前创建第三批。后续批次同样独立工作树和分支。

开发及反审期间仅提交/推送开发分支。用户需对具体交付另行明确授权 main 合并；该授权同时包含从最终合并提交准备制品。上线仍须另授。当前没有 main 合并、正式制品准备、上线、生产容器清理、默认模型/生产配置修改、生产业务写入、新增长期调度或新增外发动作授权。

已有专项测试授权仅按原对象、用途、次数使用，不重复询问同范围，也不扩大外部作用。供应商账户能力、生产维护或用户选择构成真实缺项时，先备齐可审材料，再针对缺项请求决定，并继续独立工作。

## 审查与验证入口

证据根为 `D:/codex-artifacts/ai-repair-batch1-20261107/`。所有失败、反例、旧候选与后续通过分别保留，不能用后来的通过覆盖历史。

| 包 | 仓库报告/独审 | 原件入口 |
| --- | --- | --- |
| W1/W2 | [PI.md](PI.md)、[W1](REVIEW-W1.md)、[W2](REVIEW-W2.md) | `pi/W1-REVIEW.json`、`pi/W2-REVIEW.json`、`pi/W2-R1-SOURCE.json`；PG、真实隔离 Docker 与 Windows Django 签名连线各自分层 |
| W3 | [CHAT.md](CHAT.md)、[独审](REVIEW-W3.md) | `chat/W3-REVIEW.json`、`chat/W3-source.json`；私有 PG9、Django37、Node41、独审交互7 |
| W4 | [W4.md](W4.md)、[独审](REVIEW-W4.md) | `chat/W4-REVIEW.json`；Django10、独立函数7；W3 对直接流已复测 |
| W7 | [W7.md](W7.md)、[独审](REVIEW-W7.md) | `metrics/W7-REVIEW.json`；Worker58、Django1；后续测试类型补正15及原审复核 |
| W6a | [实施](METRICS-DIAGNOSTICS.md)、[独审](REVIEW-W6A.md) | `metrics/W6A-REVIEW.json`、`metrics/W6A-SPLIT-FREEZE.json`；Worker3、Django25，Broker原字节未变 |
| G02 | [实施](G02-IMPLEMENTATION.md)、[独审](REVIEW-G02.md) | `candidate-compatibility-g02-v1/REPORT.json`、`G02-REVIEW.json`、`G02-FINAL-REVIEW-BINDINGS.json` |

G02 原报告 SHA-256 `182ff5ac263d820f4d84410ddd484d09d65ebe08db93bdcef82ac27a658149c0`，绑定受检 `5d9090b7`。四项实际检查退出0，私有包完整性和真实PS入口通过，限定 Pi 原生 main 两次启动/签名健康/SIGTERM/同账本重启已闭合，验证工作树清理成功；完整 Windows 栈 `nativeColdStart=false`、`publicationPerformed=false`。该 profile 只认本批精确字节，不可用于放行第二批任意改动，也不等于生产制品。

完整差异计划为 Worker+Django full，另含 Pi Runner/镜像及发布接线，无 migration、无锁文件或生产模型配置变更。原件 `release-scope.json` 保留原应用差异，收口完整计划为 `release-scope-final.json`；后加 G02 离线检查保持同一组件范围。合并时必须对当时最新 main 重新核冲突和实际新增字节，未变输入的证据直接复用。

## 已知限制和生产决定

- TypeScript 基线与候选167条逐项一致，无新增；n8n摘要边界及旧inventory清单各有一项已证明基线同红，不属于本次整改。详见 [CHECKS.md](CHECKS.md)。本批G02精确适配已关闭其覆盖缺口，不代表全仓CI全绿。
- 生产8个exited是旧现场，本轮没有逐对象生产盘点或清理，没有证明当前容量恢复。精确处置需要实际对象清单/恢复材料及用户单独决定。
- 未新增真实供应商或投递动作；取消不承诺供应商停止。历史模型/消息unknown不得换请求身份重放。真实模型自主派工、剩余Skill整链等历史缺口不因本批通过自动关闭。
- W6a只覆盖外层诊断，Broker内层与受控轮换以及两个来源各自根因仍是第二批工作；不得把商品日分页缺口说成两来源共同根因。
- 仅第一批提交/推送已经授权。main合并、正式制品准备、上线和生产维护均尚未执行；用户需要针对本批具体结果另行明确合并授权，上线再另授。
