# S05d 普通权限 handoff 父子链修复：未通过并停止

2026-10-23。**本轮未达到“S05d 交接修复通过”，S05b 恢复未完成。** 完成历史取证、一次真实无业务诊断、必要私有检查及独立增量审查；最小拓扑候选未通过，已保全并撤回。第二个计划任务未使用，真实 control-prepare/control-adopt 及其他生产动作均未执行。保留的源码改进仅补齐诊断与失败证据，不宣称父子链缺陷已修复。

## 原失败与历史证据

原报告提交 `2304ac6f026da45cce91adec7411bc94ba9b1a3e`，已审源码基线 `a1750fd2d2395ab5f7e31789ee1b9566ceaa1697`。原 run `1d5123a6-ce79-4196-bc1d-ebe4e79b7637` 在真实 `readVerifiedHandoffParent` 的唯一直接子进程断言拒绝：父 11500 的集合为 `[31928,6392]`，期望只有 writer 6392。该检查位于 installer 导入和 native prepare 调用之前。

父 11500 创建于 `2026-10-23T09:59:06.6298820Z`；writer STARTED/CIM 创建时间 `09:59:10.0746230Z`，EXIT/Process.StartTime 保留更高精度 `09:59:10.0746237Z`。父与 writer 普通令牌、身份和父链检查在拒绝断言前已通过；原 native 查询快照没有持久化，不能把源码顺序推论称为独立原始进程快照。

历史 PID 31928 的创建时间、可执行路径、命令、用户及权限仍未知。Security 指定时窗没有 4688/4689；Sysmon 日志不存在；TaskScheduler 日志当前关闭且对应时窗没有事件。没有用当前同 PID 进程补认历史身份。子集合准确 CIM 观测时刻也未知；可靠原件区间是 STARTED `09:59:14.543Z` 至 RESULT `09:59:22.027Z`。helper 事件得到的更窄区间仅为关联推断。

历史取证原件：`D:/codex-artifacts/s05d-parent-chain-fix-20261023/historical-evidence.json`，SHA256 `fc1b100cfe113c00600f9b41b7f1c7c6289f6d86cf32307b56376c126768b135`。

此前 Hidden=false 同链成功仅覆盖 GetInstances 和私有诊断 Node，没有调用真实 handoff execute，不能证明本次父子检查通过。相关有效实例可见性结果直接复用，没有重做已解决的工作。

## 第一次无业务取证

诊断源码提交 `c7b88eaaee625d61101f79c77b34aa5e255a01a9`，run `8a9f0261-13ad-4ff3-9b1a-94357e97e450`，RUN SHA256 `1a84d90a1afcd6e2a073ecd7af7b50bef2bbaa96cb6114b7edb4ea6b27ef9e33`。prepare/register/run 各一次，未重放。全部运行材料位于固定仓库外目录 `D:/codex-artifacts/s05d-parent-chain-fix-20261023/retirement-handoff/runs/8a9f0261-13ad-4ff3-9b1a-94357e97e450/`。

真实父 50516 创建于 `10:26:16.7232380Z`，直接子集合 `[11012,25032]`。额外 11012 创建于 `10:26:17.0441730Z`，实际路径 `C:\WINDOWS\system32\conhost.exe`，命令摘要 `conhost.exe 0x4`；writer 25032 创建于 `10:26:20.9222440Z`。两者 SID/session/medium token 和二次同创建身份均完整，额外镜像文件摘要为 `e449bce01f275cd08f3d4e64bb73b3b43ae845a0dbdb3e6131426e66537705e5`。磁盘摘要只证明观测的文件字节，不单独证明已加载镜像。

主查询区间 `10:26:28.1347942Z–10:26:31.2750539Z`；二次身份区间 `10:26:31.8135998Z–10:26:33.2045726Z`。console 结果 `50516|42912,50516` 的窗口 owner 是父进程本身，不能用它认定 11012 的 console-host 角色。证据只确定本次固定启动结构确有额外系统镜像子进程，与唯一子进程规则不相容；不能追认历史 31928。

原唯一 children 断言保持，RESULT 在该处拒绝；实际 EXIT 为 1、outputComplete=true，直接退出于 `10:26:33.2528619Z`。native 没有到达，禁止材料目录不存在。独审实际核了38件 source/frozen pins及 RUN/PARENT/RESULT/EXIT/双日志摘要绑定。

外层 driver 在 startHandoff 返回后尝试 create-only 写 `first-run.json`，与既有描述符重名而 EEXIST/exit1。这是本轮新发现的外层回执命名缺陷，审查初次也未指出；原描述符没有覆盖，真实任务只启动一次。后续只将 action 输出名改为 `first-run-action.json`，不补造第一次成功回执、不重跑 first，不把外层失败等同未执行。

## 保留的最小修改与真实覆盖

源码仅改两件原有文件，代码提交为 `c7b88eaaee625d61101f79c77b34aa5e255a01a9`：

- `preparation-retirement-handoff.mjs` 增加冻结 RUN 绑定的固定仓库外诊断模式。复用原 Task、普通权限、源码 commit/tree/clean、完整 source/frozen closure、真实进程与父链检查；在唯一 children 断言前保存查询时间、完整子身份、文件读取和二次身份观察。诊断成功分支在任何 native import 之前返回，并有独立 native 边界断言。诊断回执不得通过 native 完成判据。
- `preparation-retirement-handoff-runner.ps1` 只在诊断 RUN 的真实 EXIT 中增加 DIAGNOSTIC 摘要绑定。直接进程退出、输出 EOF、日志摘要及原 one-shot 规则保留。

没有修改生产唯一 writer 断言，没有 PID/进程名白名单，没有扩大权限、删除父子链门禁或增加固定 sleep。外部 driver 和所有临时脚本、运行输出均位于 `D:/codex-artifacts/s05d-parent-chain-fix-20261023/`；Git 仅纳入源码和最终报告/证据索引。

| 实际检查层 | 本轮结果 |
| --- | --- |
| 冻结 RUN、系统 PowerShell/Node、host/runner、当前 config/控制代际绑定 | 第一诊断真实执行通过 |
| 当前源码 HEAD/tree/clean、38件 source/frozen installer 闭包 | 第一诊断真实执行通过；独审复核原件摘要 |
| 真实普通令牌、同一用户/session、Task 定义/ACL、Running/唯一实例 | 第一诊断真实执行通过；未重做旧可见性实验 |
| 真实 `readVerifiedHandoffParent` 的 writer/父创建身份、路径、命令、令牌及固定任务命令 | 已实际进入，并通过至 children 断言之前 |
| 唯一直接子进程断言 | **实际拒绝 `[11012,25032]`，未通过** |
| 此后诊断尾部一致性、DIAGNOSTIC 成功回执、完整前置链成功 | **未取得**；纯 validator 检查不能替代现场正例 |
| native prepare/adopt、installer 调用及其他生产动作 | **零调用**；真实失败发生在 native 前，诊断入口另有硬断开 |

因此第一任务证明的是完整真实入口的拒绝与取证能力，不是完整前置链通过。没有拿 GetInstances、内部替身或文件摘要代替真实父链成功。

## 未通过的拓扑候选及停止原因

曾尝试仅在 runner 启动 Node 前规范自身启动结构：证明 console 客户端仅自身，核定最多一个现存直接子进程的完整身份与打开的 Process.Handle，拒绝后裔；只对自身调用 FreeConsole，在单一 2 秒单调预算内等待该句柄自然退出，重新确认零 children 后才允许原 Node 启动。最终唯一 writer 检查保持。

必要私有检查发现该候选前提没有成立：真实 API 已显示 `ConsoleClients=[]`，但同创建身份的额外子进程仍存在，2 秒 WaitForExit 正确拒绝。此反例运行于高权限私有 helper，仅 token 读取使用显式 medium 替身，其余 console/CIM/handle/wait 均真实；它**不是普通权限计划任务正例**，不改变实际权限或制造 handoff 回执。实际令牌版本先正确拒绝高权限；共享 console 私有调用也在 detach 前拒绝。没有延长预算、kill 或以第二任务试错。

Microsoft 的 [FreeConsole 文档](https://learn.microsoft.com/en-us/windows/console/freeconsole)只规定 console 关联的解除，未承诺某一 conhost PID 在指定时间内退出。[GetConsoleProcessList](https://learn.microsoft.com/en-us/windows/console/getconsoleprocesslist)列的是附着客户端，[GetConsoleWindow](https://learn.microsoft.com/en-us/windows/console/getconsolewindow)也不提供足以用于本门禁的 console-server 角色证明。本轮没有找到可直接采用的受支持关联方法；不把“未找到”写成 Windows 内部不存在关联信息。

定向咨询亦不支持把无窗口等同无 console host。新固定 GUI launcher、DETACHED_PROCESS 及标准句柄方案只属于后续研究方向；按[创建 console 的官方语义](https://learn.microsoft.com/en-us/windows/console/creation-of-a-console)，进程还可能随后分配 console。它会增加可执行制品、冻结闭包与 launcher→PowerShell→writer 的完整祖先链，明显扩大本轮范围，且没有真实正例。因此按用户要求停止，未消耗第二次任务。详见仓库外 [TOPOLOGY-CONSULT.md](D:/codex-artifacts/s05d-parent-chain-fix-20261023/TOPOLOGY-CONSULT.md)。

未通过的两叶实际字节已在 `unproven-topology/tools/` 保全并逐件校验。可恢复的 `unproven-topology-exact.patch` SHA256 为 `66ee693fd9f87118b76c0c738eb226f29d05beebc4b713cbe4b83fac17037f25`；恢复前 reverse-check、恢复后 apply-check 均通过。初版 PowerShell 序列化 patch 未通过检查，原样保留且明确不能作为恢复依据。仅将本任务未提交的两叶恢复为 c7；没有撤回生产或修改他人工作区。

## 必要检查、独审与证据

- 保留代码的6项既有定向检查通过，覆盖 run/phase、普通身份、固定环境、Task 不变量、native 完成判据及 PS5/PS7 runner 解析。6项私有代码检查通过，其中包括真实 PS5 查询解析及 C# 编译；没有注册 Task。
- 17项纯 schema/completion 检查通过，包含错误 phase/root/afterLogon、缺 EXIT、摘要漂移、native 回执混入、exit1、不完整输出和抬权等拒绝。仅使用内存夹具，不产生运行回执。
- Node 语法及 `git diff --check` 通过；候选拓扑仅解析通过，实际私有行为失败，不能列为修复通过。不运行全仓测试、退休档案扫描或旧实例可见性验证。
- 同一独立 `gpt-6.1-sol/high` 上下文审核诊断隔离、真实 first 原件、未通过候选的撤回及最终结论，详见 [REVIEW.md](REVIEW.md)。未解决的 Windows 具体问题另由 `gpt-6-astra/high` 定向咨询；咨询不替代独审。工具未独立回显实际模型，以上为请求模型。

固定原件和摘要入口见 [evidence-index.json](evidence-index.json)；实现收口详见仓库外 [IMPLEMENTATION-STOP.md](D:/codex-artifacts/s05d-parent-chain-fix-20261023/IMPLEMENTATION-STOP.md)。原始输出不复制到 Git。

## 任务收尾与下一次真实准备条件

只创建并运行一个新独立诊断 Task。`2026-10-23T10:36:25.0192753Z` 的限定只读观察为 Ready、instances=0，记录中的父/两个子 PID 当时均不存在；这是当前静止观察，不补认历史身份或正常退出。由于额外子进程正常退出未独立持久化，诊断 Task 和 ACL 保留，没有清理。第二个 Task 未创建、未运行。

**准确缺口：** 历史31928身份无法恢复；当前尚无严格伴随角色证明或已验证替代启动拓扑；没有修复后的完整真实 `readVerifiedHandoffParent` 成功、尾部冻结绑定及无业务完整前置链成功证据。

下一次真实 control-prepare 至少仍需：

1. 另行明确授权扩大启动器/严格角色研究范围，先取得可审的最小方案、相应代码与直接检查及独审；不能使用本轮未用的任务次数自动试新方案。
2. 在 native 硬断开的新诊断中取得真实全链成功，绑定最终干净源码、完整冻结闭包、Task 定义/ACL、普通令牌、全部实际祖先和唯一 writer；未知保持拒绝。
3. 依原协议核清三次旧失败的退出、迟到作用与再入边界并保留 unknown/no-replay 原件；本轮不授予重放资格，也没有证明历史31928身份。
4. 获得新的真实 control-prepare 授权，并即时满足实际 config/控制代际、干净冻结来源、输出目录、唯一实例和原所有动态门禁。只有 native prepare 成功及真实 EXIT/材料绑定齐全后，才有条件另按授权考虑 adopt。

上述条件未完成前不执行真实准备。即使以后 S05d 修复通过或控制包采用成功，也不能等同 S05b 退休、封存及队列恢复完成。

## Git 与停止边界

通过 ls-remote 核远端 main 为 `36668589cab03d5d2d9d98383fb58eeb19c391ee`，所需对象已存在；独立 `codex/s05d-parent-chain-fix-20261023` worktree 从该 main 建立并受控快进到完整 a175 基线。未 fetch、未推进 main/origin/main。原 hook 仅响应 refs/remotes/origin/main 的变化，独立任务分支提交不会触发准备。

三次旧失败 `c6be141b-9f7a-488a-9671-f97807c26458`、`28a038c6-34ae-482b-9855-965cf0adc307`、`1d5123a6-ce79-4196-bc1d-ebe4e79b7637` 及原件/Task/ACL 保留。没有准备或采用控制包、准备应用、恢复队列、关闭/移动来源、重启、封存或上线。S05d 修复结论与 S05b 恢复完成必须分别报告。
