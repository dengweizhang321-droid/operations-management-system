# S05d 父子链任务独立增量审查

2026-10-23。审查者未参与方案或实现，未修改被审代码，未创建、运行或清理 Task，未重复现场或功能检查。请求角色 `gpt-6.1-sol/high`；工具没有独立回显实际模型。已读取共享记忆启动入口、相关记忆、项目完整 AGENTS/README 及开发交付、模型分工、运行启动、验证发布和关联专题；本次始终使用同一独立审查上下文。

**结论：保留的诊断隔离边界、真实取证及失败止步结论通过；S05d 父子链修复未通过、未完成。** 第二个无业务 Task 未使用。没有真实 control-prepare/control-adopt、应用准备、队列恢复、来源关闭/移动、服务启停、seal 或上线。本结论不授予后续尝试或生产采用。

## 审查范围和冻结来源

基线为 `a1750fd2d2395ab5f7e31789ee1b9566ceaa1697`。实际保留提交为 `c7b88eaaee625d61101f79c77b34aa5e255a01a9`，源码树 `D:/codex-worktrees/s05d-parent-chain-fix-20261023`。最终独立读取 HEAD、status 和相对 c7 差异，确认 HEAD=c7、工作树干净、没有残留未通过拓扑增量。两叶实际摘要：

- `tools/preparation-retirement-handoff.mjs`：`223cc6560e99a906343a2f1b9220c89fc24ab8ea4567a4c651d51ea4cf1b232b`。
- `tools/preparation-retirement-handoff-runner.ps1`：`7454869466ff050758be0c0b6239632289fce396191a01949d22b14f5fc2b1e9`。

完整相对 a175 两叶差异及外部固定 driver 已审。诊断 RUN 只允许固定仓库外根、control-prepare、afterLogon=false 和禁止 native 输出路径；RUN/冻结 host/runner、配置前像、来源 commit/tree/clean、38 件 source/frozen closure 保持绑定。真实 executeHandoff 保留实际普通 token、Task 定义/ACL、唯一实例及父子链检查，并真正调用 readVerifiedHandoffParent。诊断在 native import 前 return，另有明确 native guard；原唯一 children 断言未放宽。DIAGNOSTIC 与 native RESULT 分离，native completion 拒绝 diagnostic；runner 只对真实退出记录增绑定诊断文件摘要。console 取证仅改变查询 helper 自身附着，不发控制事件或终止进程。首 Task 前的两次静态增量审查允许的仅是这一无业务取证边界。

已核 `private-checks-final.mjs/.json` 的六项检查及 PS5 解析/C# 编译证据、`diagnostic-validator-checks.mjs/.json` 的17个纯内存 schema/completion 用例。它们不是运行回执，也不证明完整前置成功；独审未重跑。

## 原失败与首个真实诊断

原 run `1d5123a6-ce79-4196-bc1d-ebe4e79b7637` 在父11500 的 children `[31928,6392]` 与唯一 writer6392 不符处拒绝。历史额外 PID31928 的创建时间、路径、命令及令牌仍未知；未用当前同 PID 进程补认，未推定其为 conhost。`historical-evidence.json` 实核 SHA 为 `fc1b100cfe113c00600f9b41b7f1c7c6289f6d86cf32307b56376c126768b135`。历史 helper 事件只能提供关联区间，原生快照未保存及 parent engine-stop 不等于 OS 退出的限制均保留。

此前 Hidden=false 的3/3、8/8实例正例只覆盖私有诊断 Node 和 GetInstances 查询，没有执行真实 handoff execute；不能据此宣称父子门禁已覆盖。

唯一新现场 run 为 `8a9f0261-13ad-4ff3-9b1a-94357e97e450`，RUN SHA `1a84d90a1afcd6e2a073ecd7af7b50bef2bbaa96cb6114b7edb4ea6b27ef9e33`。已直接读取 RUN、PARENT-OBSERVATION、STARTED、PARENT、RESULT、EXIT，独立核 RUN 摘要、38件来源/冻结 pins，以及 EXIT 对 PARENT/RESULT/双日志的摘要绑定；全部相符。禁止 native 材料目录和 DIAGNOSTIC 均不存在。

真实父50516 创建于 `10:26:16.7232380Z`，children 为额外11012与 writer25032。11012 创建于 `10:26:17.0441730Z`，路径 `C:\WINDOWS\system32\conhost.exe`；writer 创建于 `10:26:20.9222440Z`。两者完整命令、SID/session1、medium8192/非提升及二次相同创建身份均保存。主观察 `10:26:28.1347942Z–10:26:31.2750539Z`，二次身份观察 `10:26:31.8135998Z–10:26:33.2045726Z`。镜像文件 SHA 只证明所读文件字节。console 返回 `50516|42912,50516` 的 HWND owner 是父本身，不能作为11012角色证明，更不能追认31928。

真实 RESULT 在保留的唯一 children 断言拒绝，EXIT=1、outputComplete=true，直接退出于 `10:26:33.2528619Z`。native import/prepare 未到达。当前取证足以确定本次固定拓扑确有额外子进程阻断唯一writer规则；不产生任何伴随进程白名单。

外部 driver 将 descriptor 与 run 动作输出都命名 first-run.json；startHandoff 已返回后，create-only 写动作输出以 EEXIST/exit1失败。初次静态审查也漏掉此命名缺陷，现明确记录。原 descriptor 未覆盖，原请求和运行回执保留，没有重放或补造成功。后续差异仅将动作输出命名为 `<stage>-<action>-action.json`；此窄修未产生第二次现场运行。

## 未通过候选与准确止步

未通过候选尝试 runner 自身 FreeConsole、绑定额外进程 handle、原2秒共同期限内等待自然退出，并要求新鲜零child才启动Node。私有原件 `native-startup-function-token-seam.json` 和 `-inspect.json` 均记录该候选拒绝：无附着 console clients 后，同一创建身份 conhost 子进程仍超过期限存活。实际调用者是高权限，只有 token读取 seam替换为 medium；console/CIM/handle/wait为真实 API。此证据足以否定该候选的有限退出假设，不是普通权限 Task 正例，也未证明其内部原因。

咨询提出的 GUI launcher/DETACHED_PROCESS/新祖先链尚未验证，会扩大固定 Task、冻结闭包和身份契约范围。因此停止、保留第二次 allowance，符合当前范围；不能用加长等待、kill、名称/路径/hash白名单替代证明。完整 native 前置成功仍没有取得，S05d 与 S05b 均不能报告完成。

候选两叶完整字节已保全于 `unproven-topology/tools/`，独立核 preservation.json 中两件长度与 SHA 全匹配。精确 full-index patch SHA 实核 `66ee693fd9f87118b76c0c738eb226f29d05beebc4b713cbe4b83fac17037f25`；已读取 reverse-check=0 原记录。早先行序列化 patch 的 reverse-check失败保持，不作为恢复依据。最终代码已实际回到上述 c7 两叶摘要，未通过候选没有混入保留源码。

`first-readonly-quiescence.json` 仅证明一次 Ready/0实例与原采样PID当前不存在，不证明额外进程正常退出。首诊断 Task/ACL及全部原件继续保留，没有以该观察清理。旧 c6be141b、28a038c6、1d5123a6 的 run/Task/ACL/unknown 同样保留。

本次通过的是诊断安全边界和据证停止；失败、未知、未测及外层错误均未被改写。报告交付不得写成修复成功、控制包已准备/采用、或可继续 S05b。
