# S05d 续研：退休、对账、封存路线可行性

日期：2026-10-23（上海时间）。用户授权设计并验证可行性。本轮交付独立方案、源码调查、有限现场元数据、隔离反例与独立审查，**没有执行退休、封存、恢复或控制采用**。

## 结论

**路线有条件可行，但当前脚本不能直接组合成安全恢复操作。** 可以用新建立的执行隔离边界替代缺失的历史 PID 退出证明；不必证明 a3 当时零作用。但必须同时证明旧执行已经不能继续、旧入口不能再次写入、旧工件不能再被消费，并将边界建立时已有的作用完整分类。

已经否决的简化方案是“更换控制包/写新标记 + 取得旧锁 + 重启 + 封存旧票”。旧执行器可能已越过检查点，旧原生入口及消费者也不都检查新代际/标记。仅保留 unknown 并改名为 sealed 不能补足这些条件。

**本轮研究完成不表示 S05d 恢复能力通过。S05d、S05b 仍阻塞。** 本轮没有可交付现场执行的 sealer 或退休控制包，不能开始 S05b。

## 设计落点与最小后续范围

[独立方案](PLAN.md)把未来协议分为两个边界：退休旧执行，以及持久阻断再入与消费。完整退休可以覆盖无法逐一归属的本机旧进程；封存可保守覆盖所有相关旧候选，而不强行给每个残片编造 dispatch 归属。原 unknown、失败和原件继续保留，原目标不得换 request 重放。

优先验证的下一实现范围是**受支持旧入口的封闭与消费撤销适配器**，而不是先写封存命令：

1. 给出有限入口/对象清单，证明正常误调用旧 source/native 工具不能再准备或采用旧集合，包括下一次维护窗口。
2. 在旧 native 寻址规则下保全并隔离候选，已消费、在用或归属/引用不明的对象不得搬动；新候选仅通过新的受控准入进入。移出目录本身不是全局消费撤销证明。
3. 验证对现有普通权限入口、源码/运行包完整性、DPAPI、严格 ACL 和启动路径的兼容；不能为挡旧 PrepareApp 同时破坏现有 Start/Verify。
4. 只有上述屏障有真实实现及正反例，才实现同锁对账、create-only 封存、崩溃恢复和新工作准入。无法闭合则停止，不靠“操作员别运行旧脚本”代替程序保证。

如果受支持执行面无法这样封闭，限定部署域的对象权限/能力隔离是另一个充分候选，可能需要独立受控身份或 broker。它不是唯一已证明的解，也不是本轮已批准的实施范围；现有普通 SID、ACL 和身份门禁可能需要兼容改造，成本明显高于补一条 decision。不得为了单次故障默认改造全机权限。

未来完整退休/切换可能需要维护窗口；当前没有可据以承诺停机分钟数的实施或测量。本轮没有影响吉客云、n8n、运行服务或计划任务。

## 关键证据

| 核查 | 已证明的内容 | 仍不能证明 |
| --- | --- | --- |
| 真实旧 publisher 隔离调用 | 新进入者被 PREPARING 拒绝；已越检查点的旧调用无视新标记，仍写 worker-plan/PREPARED | 新标记能让旧执行退休 |
| 私有锁/子进程及原件反例 | 旧锁释放不消灭仍可写的后裔；前后相同 SHA 可漏掉中间变化；旧 reader 拒绝未知 decision | 三次空帧、双快照或新 decision 名字构成恢复凭据 |
| 原生源码调查 | Worker 先产生共享候选再落 packet 计划；Django direct PrepareApp 不自带 service mutex；旧 DeployApp 无本次封存/目标消费否定绑定 | 缺 packet 计划意味着没有共享工件，或在线拒绝等于未来维护时也拒绝 |
| 控制采用源码 | 原 adopt 不要求先 resolve a3，可按既有锁序安装新 reader | adopt 的控制进程观察等于完整旧后裔退休 |
| 固定准备任务 | 采样 state=3、instances=0，仍 enabled、allowDemandStart；action 与安装记录相符 | 以后不会再运行或没有遗留子进程 |
| 入口执行记录 | a3 时间窗有 hook/consume 的 PID、创建时间、命令摘要及同 bundle 记录 | 它们直接绑定 a3 子树并证明整树退出 |
| 暂存区 | 5 个非空目录；其中一份 marker 与 a3 内容树相同 | 唯一 dispatch 归属、可删除或没有其他消费 |

本案范围按精确请求收窄：Worker+Django、无 migration、无 schemaRelease、无 Pi Runner 源码变化，正常 producer 不进入 Pi upgrade。依据见 [请求范围](request-scope.json)、[实施者独立核查](a3-request-closure.json)。一般工具具备 Pi/WSL 能力，不意味着 a3 已执行这些作用；未知依赖脚本的边界则仍须按直接调用证据判断，不能将 npm offline 当全进程网络隔离。

详见 [FEASIBILITY.md](FEASIBILITY.md) 与 [source-evidence.json](source-evidence.json)。本轮选定源码匹配不等于整个应用/依赖完整资格化，也没有做全仓功能测试、完整构建或实际恢复试运行。

私有临时文件实验还确认：修改该文件 DACL 后，新的写句柄被拒绝，但之前已打开的写句柄仍可写；原 DACL 已恢复且临时目录已清理，生产 ACL 未变。见 [private-acl-check.json](private-acl-check.json)。因此权限切换需要与旧执行/句柄退休配合，不能单独充当退休证明。文件授权以各对象自己的安全描述符为准，根目录权限摘要不能代替全部子项核验；对象 owner 的改权能力也需计入边界。[Microsoft 文件访问规则](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)、[对象 owner 权限](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object)。

## 证据与独审

- [PLAN.md](PLAN.md)：新证明目标、封闭域、状态机、锁序、崩溃/重入、候选分类、采用顺序及 go/no-go。
- [FEASIBILITY.md](FEASIBILITY.md)：真实调用图、旧门禁、作用顺序、反例及验证上限。
- [REVIEW.md](REVIEW.md)：新上下文独立审查；设计可行与生产就绪分开。
- [native-metadata.json](native-metadata.json)、[file-metadata.json](file-metadata.json)、[staging-markers.json](staging-markers.json)：有界只读现场投影，明确未覆盖的载荷/进程/消费域。
- [document-check.json](document-check.json)：最终差异、链接、源码未改、原队列及直接原件保全核对。

规划请求 Astra High；源码/隔离边界工作请求 Sol XHigh；独审使用新的 Sol XHigh 上下文。升级仅用于并发、部分效果与跨代恢复边界；工具没有另行提供实际底层型号证明。上一轮 S05c/S05d 有效事实复用，不重做已通过事项。

## Git 与执行边界

远端 main 与已有 origin/main 都为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`，通过 ls-remote 核对，无 fetch。先核 reference-transaction hook 只处理 origin/main 变化，再从该基线创建 `codex/s05d-retirement-feasibility-20261023` 和独立 worktree，快进复用 `3abdc6e9`；不修改原 S05d 交付记录。

本轮只提交推送独立分支，不推进 main；生产 tools、原两个 decision、控制包清单均不改。本轮 worktree 保留用于审阅，主工作区已有改动保留。没有执行控制采用、队列协调、dispatch、制品准备、服务/任务/进程控制、重启、数据库写入或生产封存。隔离检查只操作自己创建的临时对象。

停止点：设计验证报告已交付；现场退休屏障、再入/消费隔离实现、完整对账及最终动态准入都尚未完成。后续先补上述最小适配器可实现性，不跳到生产封存或 S05b。
