# S05b handoff 实例可见性：最小诊断方案

2026-10-23；仅咨询，未运行任务。原 `c6be141b-9f7a-488a-9671-f97807c26458` 的 RUN SHA 为 `b3381f4f57277171d4667e2945c9bc389c4c10531bfaf7406b90fe39f171982e`；普通 PARENT、完整 stderr、直接 EXIT=1 与冻结 host 的固定执行顺序，已由独审核定本次拒绝发生在 native control-prepare 调用前。原 `attempted-unknown-no-replay`、run/task/host 和全部失败原件不改、不重放。

## 一个临时空任务，一次运行

1. root 新建唯一临时 Task/私有输出目录，使用原注册与 `RunEx` 路径，principal 固定同交互用户、LogonType 3、RunLevel 0、同 session；无触发、无重试、单实例。显式设置 **owner=该用户 SID、该 SID read+execute，保留 BA/SYSTEM 所需访问**，通过 Task Scheduler COM 回读实际 owner/DACL。记录自动增加的 ACE，不伪称权限恰为 RX。不改根 task folder、原 c6 或业务任务；权限不允许就停。
2. 唯一动作是冻结的空诊断程序，复现 `Task → PowerShell → Node → PowerShell COM 查询`；使用原 Node/PowerShell，禁止导入生产配置、handoff execute、installer 或任何业务模块。只写私有证据：各层自身 token（SID/session/integrity/elevation）、PID/创建时间/父 PID、精确 task path/definition/SDDL、GetInstances 的 Count/可见 InstanceGuid/State。显式保存 COM collection 再读 Count/Item(1)，同时记录原表达式结果/HRESULT，避免空值或 PowerShell 展开误判。
3. root 在调用 `RunEx` 时保存返回实例标识；空任务存活的同一短窗口，由已有高权限 root 只读查询该精确任务，与实际普通查询子进程对照同一个 InstanceGuid。普通侧可在立即、约 250ms、1s、3s 做少量采样，随后短暂保持供对照，整个动作 **30 秒内自行退出**。不用 Stop/kill 终止其它进程，不循环启动。直接退出与输出完整性分别记录；仅在已确认退出、任务定义仍相同时清理临时 Task，证据保留。

Microsoft 说明 [GetInstances](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-getinstances) 会按调用者安全上下文过滤实例，[任务 ACL](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-setsecuritydescriptor) 可通过原生 COM 设置。**文档不证明本次 FR/BA-owner 是根因**；普通父进程 token 也不能代替实际 COM 查询进程 token。

## 结果与止点

- 普通侧和高侧均看到唯一、相同、等于 [RunEx 返回实例](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-runex) 的 GUID，且普通查询 token 正确：支持显式 owner/RX 配置在该拓扑可用；不能声称已分别证明 owner/ACE 因果。可把修复限于新 handoff 注册及执行时的 owner/DACL 绑定与回读，仍要求 `instances===1`；一次必要私有检查与原 Sol 增量独审，不扩工程。
- 仅延迟后可见：记录确切时间。若采用有限等待，只能在 STARTED 前重新观察同一已启动实例，最终仍须唯一身份匹配；超时或多实例拒绝，绝不再次 RunEx。
- 高侧可见而普通侧持续 0、双方都无法对应实例，或 token/COM 返回含糊：**停在诊断结果，不接受 0、不继续 prepare、不新建 broker**。若后续要继续，则必须改变 handoff 启动观测协议，建立 RunEx 的具体实例与冻结 run、真实 action/PARENT 子进程链的可信对应；仅 state 4、自报 PID/GUID 不够。这是另一个需具体证据和独审的窄修改，当前不实施。after-logon 没有此次 RunEx 回执，不能套用。

## 修复后的新 run 不是通用 unknown 重试

复用已独审核定的 c6 **前 native 调用拒绝**结论及原摘要绑定，不再以缺文件作证明、不重审整条 S05d；config/CONTROL-INSTALLATION/hook 未变和目标目录不存在只作旁证。修复检查与增量独审通过后，root 以新代码、新冻结 host、新 run/task 做一次 control-prepare，记录前 run 与有限资格摘要，重核当前代际/config/目标材料路径及原 native 门禁。原 c6 不消费第二次，原 unknown 不改写。新 run 在 STARTED 后失败或结果不明时，仍按原 no-replay 停止，不能继承 c6 的前调用资格。本页直接交 root 执行有限诊断，无例行二次规划。
