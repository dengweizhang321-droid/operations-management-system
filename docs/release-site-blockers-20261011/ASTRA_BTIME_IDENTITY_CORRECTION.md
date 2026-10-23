# btime 身份语义修正

2026-10-11；必要开发修复，不改原失败或旧QA包。当前冻结交接为 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUARD_CORE_HANDOFF_V3.json`。

主 agent 的真实管理员只读完整尝试用时16.202秒，在通过 implementation/native-CIM 阶段后失败：同 boot_id `4a67b065…`、PID1 starttime `122`、同 kernel，实际 btime `1791621407` 与冻结值 `1791621408` 不同。原证据 `PRIMARY_LIVE_REFERENCE_QUALIFICATION_FAILURE_V1.json`、runId `7c6b889d-8d74-4538-b92b-8d2414e1b925` 与旧35777包保留，不能追认为通过。

补充完整失败事实：该audit在抛出btime异常前还已记录四个CIM不稳unknown，不能称整体唯一阻断为btime。其SHA原因为 `CIM instance changed`，后续最小内核departure补证另见 `ASTRA_DEPARTURE_HANDOFF_AND_AGY7_8.md`；当前最终冻结为HANDOFF_V4，旧V3为过渡记录。

Linux 官方 proc 文档把 btime 定义为 Unix epoch 起的启动时间秒数。内核 `fs/proc/stat.c` 每次经 getboottime64 获取、应用 time namespace 偏移后打印秒数；`getboottime64` 的注释明确它返回 wall-time of boot，settimeofday 会影响其结果。因此它不适合做不可变实例标识。[proc 文档](https://docs.kernel.org/filesystems/proc.html)、[proc/stat 实现](https://github.com/torvalds/linux/blob/master/fs/proc/stat.c)、[timekeeping 实现](https://github.com/torvalds/linux/blob/master/kernel/time/timekeeping.c)

官方另明确 boot_id 首次生成后不变。本次身份仍要求固定 boot_id、PID1 starttime、osrelease 三字段精确相等，前后两次均核验；btime 必须是有界正整数字符串，保留 before/after/changed 诊断，但不参与身份等价、不使用误差窗口。[boot_id 文档](https://docs.kernel.org/admin-guide/sysctl/kernel.html#random)

这只纠正 btime 的语义角色，不证明本机这一秒究竟由哪次校时/偏移产生。Windows native FILETIME、CIM微秒关联、HCS RuntimeId/parent birth/命令hash、PID清单与namespace/mount约束都没放宽。collector仍原样采两次 btime，未改变原始输出；仅guest/host policy的数据结构和向上byte pins变更。成功audit会保存 `guest.btimeDiagnostic`。

验证 **106/106**，日志 `ASTRA_LIVE_GUARD_BTIME_TEST.log`：新增实际一秒差异、采样期间btime变化、非法/空/零/负/非整数字段，以及有btime变化时boot_id/PID1/namespace仍拒绝的反例。原host/native负例仍通过。host关联接收严格三字段guest identity，不接受把wall time作为替代字段。

未重新执行管理员采集、HCS或任何生产动作；还需新source绑定与真实只读QA。AGY6 timeout/空response不构成审查通过，本修复仍待真正独立复审。原pkg/source/f0/9e/6af和生产状态未改。
