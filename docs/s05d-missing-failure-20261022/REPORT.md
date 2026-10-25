# S05d · 缺失失败回执的有限恢复调查与隔离交付

任务始于 2026-10-22，交付日期为 2026-10-23（上海时间）。**S05d 保持阻塞；S05b 不具备进入条件。** 本次没有形成可安全追加 resolution 的第三恢复分支。交付独立规划、只读诊断及拒绝边界检查，不将它们称为恢复能力就绪。

## 结论与已证明事实

- 最新远端 `main` 经 `git ls-remote` 核对为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`，与已有 `origin/main` 一致。B1 已合入，不重复合并；S05c 已通过，直接复用 `a6eb508d` 文档和证据。
- 本机 reference-transaction hook 只处理已提交的 `refs/remotes/origin/main` 变化；其余引用在读配置、控制准入及提交准备票之前返回。本次没有 fetch、更新 main 引用、关闭或绕过 hook。独立 worktree 从该 main 建立，再快进纳入 S05c 文档提交。
- 原 dispatch `a3d53227-8976-4762-8be6-6f8c28107b5b`、request `2c90e2a2-24c1-4dc1-9811-ae7c4888a6e8`、target `36668589…` 和原 `unknown` 仍保留。任务目录内的 PREPARING/source-binding 及相关原件摘要与 S05c 一致；12 件直接相关原件摘要复核结果见 [evidence.json](evidence.json)。这不是新一次完整现场恢复准入。
- 原 `failed-cleaned-before-plan` 依赖唯一 FAILED、process_timeout、原进程及成功 treeCleanup；`superseded-by-later-publication` 依赖 PREPARED、计划及后继消费链。a3 两者均不适用，条件和历史读取代码不改。
- 原 `runPublisher` 只将子进程退出信息变成错误字符串；现有 a3 原件没有可验证的完整原 actor 身份、后裔退休证明。进度 state 明确 `diagnosticOnly`，不能代替退出回执。缺 PREPARED/worker-plan 也不能排除先于它们生成的候选产物。
- 本机本次启动为 `2026-10-17T14:43:44.500Z`，早于 a3，无法提供事后完整启动周期屏障。TaskScheduler Operational 当前未启用；限定 `2026-10-22T07:10Z–07:32Z`、上限 100 条的查询未取得事件。未命中不证明当时没有执行。

## 为何不启用第三分支

第三分支需要分别证明原操作身份、产生作用的范围，以及原执行已不可能继续产生迟到作用。旧 cleaned collector 的三文件 producer qualification、当前进程普查和产物枚举不能单独完成这三项证明。把 FAILED 改为可选，或允许操作者提交一份自填“已清理”JSON，会把未知效果包装成成功证据。

独立规划讨论了两类可能的正面退休凭据：原执行身份及受控后裔闭合的原始记录；或者经完整启动事件、原任务实例与原控制代际共同绑定的启动周期屏障。后者仅是未来候选规则，仍须排除持久任务、外部执行和后续消费，不是“重启一次即可恢复”。当前没有据此执行重启或新增取证服务。

[PLAN.md](PLAN.md) 给出适用条件、拒绝条件、待证明的产物/消费闭包和采用顺序。必要凭据来源与完整闭包尚未成立，因此本轮没有实现可写第三 decision，也没有为具体 dispatch 加白名单。原 unknown 不改为 FAILED、SUCCESS 或已恢复。

## 隔离交付与使用边界

具体入口、参数、合成检查和源码边界见 [IMPLEMENTATION.md](IMPLEMENTATION.md)；独立规则及增量审查见 [REVIEW.md](REVIEW.md)。诊断入口仅用于绑定已有原件和暴露缺口，不能创建恢复请求、观察、ACK、resolution 或准备任务。它既不是 recovery writer，也不是控制采用材料。

真实参数兼容已只读核验：首次调用因原 request 缺可选 `sourceTree` 而被诊断器误拒绝；[原失败记录](a3-readonly-audit-first-rejection.json)保留。修复真实 schema 并完成独立增量复核后，仅重读一次 a3，返回 `MISSING_FAILURE_BLOCKED`、`recoveryEligible=false`、`resolutionWritten=false`，见 [a3只读输出](a3-readonly-audit.json)。该输出枚举 packet 非 source 文件 6 件；其中 publication 仍只有 PREPARING/source-binding，两者口径不同，不代表外部产物已盘清。

隔离检查：初版修正后新增 9 项通过，原两条 decision 的既有合成正例 2 项通过；真实 schema 修正后只复核直接相关的 3 项及语法，未重跑旧完整套件。记录见 [checks.json](checks.json)、[schema-fix-checks.json](schema-fix-checks.json)。最终原件保全、链接、diff 和源码证据绑定见 [document-check.json](document-check.json)；这些检查通过只证明本次诊断交付，不满足恢复验收。

未来真正的恢复实现必须进入原控制包的完整依赖清单，先验证与原两个 decision、历史证据、队列 reader 和原目标禁止重放规则兼容，再按原控制代际/CAS/锁序采用；之后才能以新鲜现场证据走原 writer/独立 observer/最终复验。**本次没有候选恢复控制包可供 S05b 采用**，不能通过安装只读诊断工具解除阻塞。

a3 当前仍缺：可信原执行身份及其退休/迟到作用屏障；覆盖实际 producer 全部可能输出及消费位置的证据；原/现控制代际及执行身份的完整准入绑定；同锁观察窗口和最终动态复验。原件本身未留下的信息可能无法事后补回，不能承诺仅补一张表即可放行。

## 模型与范围

按 `2026-10-15-v3` 分工，请求 Astra High 独立规划，Sol XHigh 负责涉及部分完成/并发边界的隔离实现，另一个新上下文 Sol XHigh 独立审查。工具未额外证明实际底层型号，以上为请求配置。审查者不参与实现；修正后只复核增量。

没有执行控制采用、现场队列协调/恢复、新生产 dispatch、制品准备、服务启停、计划任务变更、数据库写入或应用上线；没有运行全仓测试或为测量启动完整构建。日志持续落盘和宿主隔离没有扩入本轮，未用 `0xC000013A` 归因用户关窗。

## Git 与停止点

开发分支：`codex/s05d-missing-failure-20261022`；worktree：`D:/codex-worktrees/s05d-missing-failure-20261022`。仅提交并推送本分支，不合 main，不触发自动准备。主检出用户改动保留；未合并工作树保留用于审阅。最终提交与远端状态在本次交付消息记录。

本次到 S05d 隔离调查交付为止。S05d 未通过，S05b 继续阻塞；没有继续下一施工单。
