# AGY 完整恢复复审事实核定

真实同会话 `d154e0e3-9d9b-4439-a580-49b627cb5670` 的 V2 非空回复审阅了 67,123 字符输入；10 份被审源码 SHA 与当前文件一致。模型没有提出具体新增阻断。完整 prompt、stream、call 与 response 原件归档；会话累计 duration/usage 不作为本次耗时。

首次 V1 stream 输入缺少 AGY 要求的 `event` 字段，0 turn／空 response，是协议失败，不是复审。随后的短协议探测被本地 15 秒界限结束，不能当成功审查。正确 `event:user` 的完整 V2 才获得非空意见。

以下模型过强表述不采纳：

- “彻底解决父子退出竞争”：V3 只闭合私有复现及已验证同句柄的自然退出；晚退出和其它无法确认的变化仍可能保守 unknown。
- “杜绝门禁悬空／刚性重置”：失败分支只能 create-only 创建或验证本次门；权限、I/O、外部门变化等仍可使 containment 失败，代码保留这一事实。没有无条件重置或删除门。
- “双锁锁闭全流程”：原 rotation 与 watchdog 锁仅约束遵循它们的参与者，不是全 OS 排他；其它旧 Status actor 的有限观察也不是连续不存在证明。
- “任何阶段失败都写围栏”：preflight 尚未尝试修改时保持现场不变；只有修改阶段被尝试后才走失败围栏。

Supervisor 普通角色真实分支只做读，旧 PID receipt 前后 absent，没有业务 HTTP/SQL；其 stopped 状态不是 Ready。356 只是本地 pending outbox 文件数。模型意见不授予生产批准，不能替代同实例动作前复核、实际恢复、自然快照和原七项验收。
