# 已停用诊断 worktree 清理独审

2026-10-23。基线 `e79781186d51e1cbe5ebb69f98b5f964fafd39ed`。已读共享 Home、本树完整 AGENTS 及现行开发与交付的普通 worktree 清理要求；同上下文 v3 与其余未变规范复用。用户本轮明确授权保全后移除这棵已停用普通诊断工作树及登记，再验证原阻点；不要求再次确认。独审不修改被审脚本、不自行清理、不运行现场验证。

目标仅 `D:/codex-worktrees/s05d-handoff-staging-diagnostic-20261023`。只删除 44 项会留下原同源检出，故本轮边界为：保全全部未跟踪诊断原件和 tracked HEAD 的可恢复内容，清除已保全的精确未跟踪叶及空目录，clean 后用无 force 的原生 `git worktree remove` 移除该检出与登记。不是移动 4 个正式来源，不删除其 branch/main，不改生产 config、控制安装、hook、queue，不采用、重启或封存。

## 已核归属与占用证据

已读目标旧 REPORT/REVIEW：目标按 main 366 原生 git worktree 创建，仅作无业务 handoff/staging 诊断，原件和脚本均在其 diagnostics/docs；旧 b8 诊断 Task 按精确实例/进程身份及退出前置清理。现有事实不把普通 worktree 因缺少聊天归属而推定受管，也不允许伪造/移除归属标记。

已读 [bindings.json](bindings.json) 与 [只读收集脚本](check-bindings.ps1)：314 个 Task 含 hidden/子目录，exec action 的 path/arguments/workingDirectory 及可解码 EncodedCommand 均作目标路径匹配；旧 b8 Task 不存在，记录 process/service/task 直接引用均为空。此为本次目标的限定占用证据，不泛称全机没有其它任务。

## 保全及执行材料结论

**限定清理执行审查通过，可由主负责人运行本次已审脚本。** [remove-preserved-worktree.ps1](remove-preserved-worktree.ps1) 实际 SHA 为 `91ded16f780affd63297a9699a11b79b33ab361522d5572ccd986af91ca66c7a`；[preserve.py](preserve.py) 为 `99d9cf2b382923d0638e14ffd9ffad474a09d12b7efbe8a506e5da8c2f1e6325`。结论只绑定该实际脚本及保全材料；尚不表示清理或后续 fresh closure/CAS 已发生。

已核 [preservation.json](preservation.json) 与固定 backup 的 MANIFEST 原字节，SHA 均为 `ae9192d5d975530718f69e79ad9347db15d4b5da4f29ccedd3d5dbbc40ca455e`。backup 为 `D:/codex-artifacts/s05d-diagnostic-cleanup-20261023/preserved-3f15a48b-c867-473e-95df-5875dda958db`。44 路径唯一、逐项等于原 blocker 的 44 清单，共 274,879 字节；独审逐件读副本核 SHA/长度，零差异。未改变原来源，不丢弃两次先前失败材料。

tracked HEAD 保全为 167,034,880 字节 tar，实际 SHA `9f51422aba873b9eb0d8ed428657cca6018a7ebaf9cb4a35bd4f614d5e010897` 与 manifest 一致。已审保全代码按 HEAD 的 9,653 个 blob 完整清单逐 entry 核 Git OID，核无遗漏/未知成员，不只验 tar 自身摘要。实际 5 个 BAT 具显式 `text=set/eol=crlf`，仅允许 CRLF→LF 后精确匹配原 blob OID，具体项保存在 `archive.qualifiedCheckoutTransforms`；不是放宽其它内容差异。既有同一 tar 复用时仍完整重核，没有为通过重新打包或改原文件。

保全初始在 Windows Python 的 path/handle ctime 视图差异处安全停止。最终实现跨 API 仍严格比较 dev/ino/size/mtime/nlink；path lstat 前后完整签名与 handle fstat 前后完整签名各自必须相同，两种签名均存 manifest，源与副本再核全字节 SHA。没有把不同 API 的 ctime 硬比，也没有放松各自区间的变化检查。保全物理成员集精确为 tracked+44+.git，拒绝 reparse/未知实体；ignored 空，tracked clean 且 index 全 H。

删除脚本的必要门禁已核：

- 固定唯一 target、backup 与 manifest SHA，要求实际路径和全部祖先无 reparse；相对路径不得 rooted/含上跳，解析后必须留在目标树内。
- 删除前重核两份 manifest、tracked tar 摘要、锁、HEAD、tracked diff、ignored 和精确 44 集合；先完整核全 44 的源/副本长度及摘要，再重采 process/service/Task 绑定，任一不符拒绝。
- 每叶再核源摘要，使用单 shell 的 `Remove-Item -LiteralPath`，不递归删除；仅对三个精确诊断目录确认空后 `Directory.Delete(false)`。
- clean 后调用原生 `git worktree remove`，无 force，不删除 branch/main；随后检查目标路径和 Git 登记均消失。它不会调用生产控制、Task 启停、来源封存或其它正式源动作。

## 实际清理回执

已读 [cleanup-result.json](cleanup-result.json)：主负责人于 2026-10-23T07:32:16Z 完成 44 个已保全诊断文件的精确删除，随后原生 worktree remove 无 force，`worktreeAbsent=true`、`registrationAbsent=true`；保留分支 `codex/s05d-handoff-staging-diagnostic-20261023`，backup 与 manifest 绑定不变。**本次限定诊断树清理已实际成功**，不再记为待执行。

本审只读脚本、原件与 backup，没有自行删除或操作 Task。新鲜全局 closure/CAS 将由后续固定入口取得，旧拒绝原件继续保留；本次只闭合这一工作树实例，不把物理移除等同全局闭包或整个发布稳定性通过。主负责人继续稳定性工程，控制采用与退休各自门禁不由清理回执替代。

## 稳定性增量方案审查

已读 [STABILITY-PLAN.md](STABILITY-PLAN.md)，关键边界可行，直接交实施，不要求再规划或增加审批。以下必要约束已反馈实施；实际增量结论见下一节。

- 前置分类与正式 collector 共用实际字节/完整 Git 规则；same HEAD 附加文件与真正 missing 分开报告。名称、诊断用途、HEAD、收尾回执或缓存都不是排除许可；前置后新登记、恢复 alias 或内容变化仍须末次拒绝。
- CAS 的四槽对全批对象共享，首错停止领取，全部已启动只读操作 settle/drain 后才能抛错或退出；超时也不能留下后台读取或提前成功。合并属性读取限同一检查点，完整 bigint 身份/链接/纳秒字段、realpath/reparse、目录成员、junction/linkText 及全部对象最后 CAS 均保留；跨动作首尾复验不能合并。
- 共同实现与计时不能把实际必需的 closure、全部 snapshot、ordinary/Task、boot/ref/native、adoption/original 或写前尾检移出窗口，不重置或放宽原 40/60 秒起点。只读缺普通写者、锁或实际 native 资格时，必须明确 partial/exclusions，不可签发可供后续写者消费的 proof，也不能声称完整生产准入。
- 固定诊断输出根位于源码树外、闭包冻结，不能加入任意生产路径/命令或新 dispatch。生命周期回执不授予 collector 豁免或 unknown 重试；handoff 与 controlFiles 不在本次修改范围。既有未受影响证据复用，只补触及边界的私有检查，现场等固定入口完成后取得一次新鲜结果。

## 稳定性限定实现增量结论

**本次限定实现与必要私有边界检查通过，可冻结提交后运行一次固定 CLI 的 preflight 模式。** 这不是全部稳定性目标或完整生产准入通过；实际新鲜 closure/组合成本及未取得的写者资格须按结果继续区分。当前实际生产叶如下，结论绑定这些字节：

最终 [stability-pins.json](stability-pins.json) 实际 SHA `ba5c8b26efa5527ede3d28cc9fe6b73e79919d812be33ab864c7cb5c34490434`；独审逐项核其中 18 件原字节摘要及长度，零差异。

| 文件 | SHA256 |
| --- | --- |
| preparation-retirement-fs.mjs | `8befa5711ac354aa92c089c60cbf431d6d1e38d698bcbd2555177234a40aed62` |
| preparation-retirement-archive.mjs | `1fef3adbc1c1c6f4eee7f6a182ea8ccc525870eac00e5b3ad76d3a6f70b10230` |
| preparation-retirement-collector.mjs | `07a9a0989748d74260dc73c88c62a0c9cc4c01b7038c6395130901559ca3479e` |
| preparation-retirement.mjs | `19c223ae82a6af8752b843d300f35d58365753509e5bac7383241f5ee5b0274b` |
| preparation-retirement-diagnostic.mjs | `122dcacd2bd8bd16b79fa93e0c4353c983689ed9764bbbd1f4bd7792e1a75d9b` |

来源分类把原登记/packet/fixed-root 规则前移至 native chain/release 大扫描前，继续使用实际字节及完整 Git 成员资格；same HEAD 的 extra/missing 分开报告，`changedCount=null` 表示共同字节尚未完整核验。多项结构化 blocker 保留在错误回执。原最终 entry 资格、完整登记集合及动态 CAS 未删除；没有用途、名称或收尾回执豁免。

全部 snapshot CAS 复用同一四槽池，未按对象叠加四槽；完整 snapshot 仍逐对象新读。首错/取消/期限到达后停止领取，已取得操作全部结束再抛错。目录、叶、junction 的原检查顺序及完整字段、目录成员和 linkText 核验保留；没有跨调用缓存、抽样或硬链接去重。此次选择保留原 lstat/realpath 顺序，通过有界并发优化，未为减少调用而合并不同检查点。

独审发现的 falsy throw 漏洞已改为独立 `failed` 标记，既有 drain 检查实际改用 `throw undefined`，仍须拒绝且不领取后续任务。共同 40 秒计时包含 before、closure、全部 snapshot、fresh 与 tail；成功分项写入 preflight/最终 seal 证据，失败附带实际 measurement 进入原 blocked 回执。SEALED 前原 60 秒 witness 新鲜度检查保留，没有改门禁或起点。reader 仍当次全读、最后统一复验；本次没有以 receipt 缓存替代它。

固定 [诊断入口](../../tools/preparation-retirement-diagnostic.mjs) 仅在计算的仓库外私有 UUID 根写入冻结代码、原件和回执，检查与所有来源/runtime 不重叠；冻结原工具闭包及自身递归 local imports，不复制整个项目。缺少 frozen import 即拒绝，无回仓库 fallback。parent 的 `sha(canonical(run))` 与 RUN 落盘的 canonical 原字节相同；execute 在 collector 前 create-only 写 ATTEMPT，重入拒绝。其 EXIT 明确不是业务完成，status/RESULT 始终不签发准入或恢复许可。

原“20 分钟只在 progress/end 检查”已修为固定 owned-child watchdog：19 分钟通过绑定 RUN SHA 的 IPC 请求取消，流式 chunk/调度停止领取并 drain；20 分钟只对自身 ChildProcess handle 终止 Node，不按进程名或任意 PID 清理。WATCHDOG 持久记录 blocked/unknown，强制终止不声称 read drain。新入口没有增加 Task 或业务阶段。closeout 现比较完整 untracked 数组及 tracked 成员摘要、ignored 声明；同一未跟踪目录内新增文件也返回 blocked/currentWorkspace。ignored 明示仅 matching-paths、目录内容未盘点；没有合格占用/应用归属 provider 时不签发 ready-to-remove，不自动删除或豁免来源。

只读组合捕获实际 identity、Task、boot、native、ref、adoption/original 观察与拒绝，结果固定为 `diagnostic-partial`，明确没有 writer locks、冻结 retirement intent 及 source-close 后退休证明；缺 ordinary 等条件另列 rejected/exclusions。即使只读计算结束、EXIT 0 或耗时满足阈值，也不能认定 ordinary/native 完整准入通过，不能把观察结果留给下一轮写者当 proof。

## 已核私有证据及未完成范围

已读取检查源码及原始输出，未重跑：

- [final-direct-checks.txt](final-direct-checks.txt)：8/8、exit 0、19.918 秒；包含诊断隔离/缺 import、收尾状态与目录内迟到成员、owned watchdog 正常取消/强制未知、原私有 integration，以及四对象 CAS/共享四槽 drain/期限取消/完整计时。其实际摘要为 `707f306baf44423b6a7bca10a321aa4c9e53a7f274295b5e5953dff4756c1dfb`；命令见 [JSON](final-direct-checks.json)。integration 的 OS/boot/census 为原私有替身，不证明现场已退休。
- 来源前置两项复用 [stability-checks-2.txt](stability-checks-2.txt) 的 6/6、5.603 秒批次中对应结果：same HEAD extra/missing 在 native release 前拒绝，真实区别来源保持通过，collection 后新增登记由最终 CAS 拒绝；不是此次重新执行了 6 项。
- 原 handoff Hidden=false 同链现场正例及未受影响的包结构证据继续复用，不新增 Task/全仓检查。现有生产模块只增同路径命名导入，controlFiles 与 handoff 未改；standalone 新入口的独立冻结加载已由上述私有缺 import 反例覆盖。

本阶段尚无新固定 CLI 的实际完整只读结果，不能预填性能余量或全局 closure 已闭合。常规队列反复调用 retired reader 的成本正在另项定点评估，未列为本增量已解决；不把本次清理或子项通过写成整个发布流程已认证。仍无 main 合并、控制采用、新 dispatch、4 正式源移动、boot 或上线。
