# 守护状态异常：只读调查与隔离验证

2026-10-09。本轮使用实际安装的守护函数，分别进行正常只读 Status、现有状态文件核验和隔离子进程/状态组装实验。没有执行 Check/Recover、安装、启停、调度变更、通知、业务写入或生产故障注入。

结论：确认三处诊断/等待缺口——stdout EOF 等待没有共同期限；后续 supervisor 失败会丢失已成功的控制器状态；子进程与快照异常不保存阶段/退出/错误信息。当前持续 unprobed 的具体失败阶段和根因仍未知，不能把下面的隔离机制直接当作历史事故唯一原因。

## 实际代码与环境

受审 main 为 `0b450178`；本机正式 Worker 仍为 D5 / manifest `01590c56…`，supervisor 32284、workerd 4848。安装脚本 `D:/teruisi-runtime/operations-watchdog/operations-system-watchdog.ps1` SHA-256 为 `99593a800321569257bf8e31fdd64dda8b558f9bacdeed316ca7000a301c162a`，与本 main 源码逐字节一致。主工作区控制器及 Worker service 也与 main 对应文件物理字节相同；主工作区既有未提交内容未被修改。

计划任务实际使用 Codex bundled `pwsh.exe`，并非另一个假定的系统 PowerShell。原 Check 在子进程 PATH 前置同一执行器目录，controller 复验按相同方式设置本诊断进程的 PATH。函数加载使用 `-FunctionsOnly`，在原第 379 行即返回，不进入恢复/通知周期。相关摘要及现存状态见 [session-snapshot.json](evidence/session-snapshot.json)。

## 正常只读样本

时间为上海时间；每种方式仅一个样本。自然守护/业务任务继续运行，诊断自身有正常只读查询开销，没有注入额外并发压力；未采集足够 CPU、内存、SQL 锁/连接阶段数据，实际负载为未知。这里计时的是状态命令返回，不是网页新内容绘制或稳定 P95。

| 检查 | 开始 / 结束（2026-10-09） | 原耗时 | 调用方式与结果 |
| --- | --- | --- | --- |
| Django supervisor | 21:18:37–21:18:39 | 2798.899 ms | 原 PS5 只读传输；running/healthy/all_components_ready，[证据](evidence/supervisor-status-01.json) |
| Django supervisor | 21:19:46–21:19:48 | 2458.431 ms | 安装脚本原 Invoke-WatchScript / bundled PS7；成功，[证据](evidence/supervisor-watchdog-stage-01.json) |
| 完整控制器状态 | 21:21:08–21:22:01 | 53010.929 ms | 相同调度器执行器与 PATH、原 Invoke-WatchScript、默认 60 秒；Running/Ready/D5/12 true，[证据](evidence/controller-watchdog-stage-01.json) |
| Django AggregateStatus | 21:28:11–21:28:48 | 36908.992 ms | 原 PS5 只读传输；12 域就绪字段成功，[证据](evidence/aggregate-status-01.json) |
| Worker Status | 21:29:59–21:30:14 | 14866.570 ms | 原 PS5 只读传输；D5 exact_release，[证据](evidence/worker-status-01.json) |

这些不是同一次 controller 的分段探针；不同时间/传输方式不能直接相加为 53 秒的内部耗时构成。36.909 秒与 14.867 秒指出两条状态通路都有可观测等待，尚未量出每层 CPU/文件核验/HTTP/SQL 成本。53.011 秒接近 60 秒预算，但本次正常返回，不能称本次已发生 timeout。

21:42 的现存快照仍有 probeError / 全组 unprobed、4 HTTP 200；直接 Status 成功不能覆盖另一时间窗的失败。快照 at 与最后写入时间也不同，不能把 at 当成完整轮次已完成时间。

## W01：名义期限没有覆盖输出 EOF 等待（已在隔离复现）

- 页面/操作：全局运行状态与守护的子进程检查；公共函数也被 DWS 调用复用，不仅服务探针。
- 原代码：`tools/operations-system-watchdog.ps1:40–54`。第 49 行只对直接进程 WaitForExit 设置期限；第 51 行 `ReadToEndAsync().GetAwaiter().GetResult()` 无剩余期限约束。stderr 同时异步读取但不消费诊断值，响应体上限在读取完之后才检查。
- 复现：运行 `tools/performance/runtime-watchdog-eof-replay.ps1`，原函数在本次临时 cwd 启动合成 child；child 输出小 JSON 后退出，合成 grandchild 继承 stdout 并存活 6 秒。实验期限为 2 秒，生产 60 秒参数未改。
- 预期：整次观察在共同期限内完成或明确结束为超时；实际：返回成功，整体 `7157.232 ms`，大于名义 2 秒；grandchild 已自然退出，未留下进程。见 [原始结果](evidence/watchdog-eof-replay.json)。没有 WaitForExit/EOF 分段计时，不能把全部 7.157 秒称为 EOF 阶段实测耗时。
- 影响：观察可能超过约定期限，延迟新快照和故障识别；历史长等待/启动包装器问题与此一致，但没有原管道继承见证，仍不能认定历史根因。
- 可信度：函数期限缺口高；历史事故归因未知。
- 最小方向：复用当前进程函数，为进程结束和 stdout/stderr 消费使用同一绝对期限；输出增量有界读取，保留直接退出与输出是否闭合的区别。只处理由该调用精确拥有的探针进程；不能杀服务树、伪造成功或自动重放写入/外发。DWS 送达未知仍必须按原 sending/unknown/sent 不重发。
- 回归：直接子进程正常/非零退出、后代继承 stdout/stderr、流超限、乱码/非 JSON、期限先后交错、清理、未确认外发、恢复预算与现有窗口隐藏规则。先用原 `tests/operations-system-watchdog.test.ps1`、`tests/watchdog-no-console.test.ps1` 及本次有界夹具验证候选；本轮没有更改这些生产函数。

## W02：后阶段失败抹掉已成功状态（已在隔离复现）

- 页面/操作：管理者/监控读取系统状态时，同组任一诊断失败可能将可确认的部分也显示未探测。
- 原代码：`tools/operations-system-watchdog.ps1:102–110`。Control 成功结果在 supervisor 成功后才赋到 snapshot；组件、release/PID 又在 monitor 文件读取后赋值。单一 catch 只置 probeError。
- 复现：`tools/performance/runtime-watchdog-retention-replay.ps1` 使用原 Get-WatchSnapshot 与已捕获的成功 Status DTO，外部 HTTP/端口、admission、monitor 都为隔离替身；4 条路径通过，[结果](evidence/watchdog-state-retention-replay.json)。Supervisor 失败时 Control 已成功却全组 unprobed/组件 0；monitor 失败时保留 Running/Ready/exact_release，但组件/release/PID 后续赋值缺失。不能把两种行为混为“所有后阶段失败都全组清空”。
- 预期与影响：各个已成功诊断应能独立呈现，并明确本轮哪个部分未知；现状妨碍定位且易使维护者重复等待。整体健康仍必须保持 false，未知权限/身份不能当作就绪。
- 可信度：赋值/错误呈现机制高；它是否解释某次真实快照，因历史阶段错误没有保存而未知。
- 最小方向：每个阶段独立存放本轮结果、identity、观察时间、成功/未知及安全错误码，再形成整体判断；不跨代复用旧健康，不改变恢复判定。
- 回归：Control/supervisor/monitor 分别失败、阶段迟到、文件原子替换/损坏、维护门与 fence 变化、错误后一轮恢复、成功子结果不被误称全部健康。现测试仅在预置 failures=2 时调用原 Get-WatchDecision 验证 alert_only，没有执行两轮 WatchCycle 或任何实际恢复。

## W03：失败原因不可追溯（代码缺口与隔离机制证实）

`Invoke-WatchProcess` 第 50 行把所有非零退出压为 operator_failed，未使用已读取的 stderr；快照第 110 行也不保存捕获异常。原 launcher 故意排空但不记录输出。因此原 probeError 不能区分 Control、supervisor、monitor、超时、解析、身份等来源，也不能从历史文件还原被丢弃的退出信息。

最小方向是在上述复用函数及阶段调用处增加阶段、开始/结束、名义期限、直接退出状态、输出闭合状态、固定错误分类和脱敏摘要，严格过滤 URL/正文/token/人员身份；不能简单把全部 stderr/配置抄进日志。该方向可与 W01/W02 一起做小范围候选。回归包括长错误/敏感字段、异常自身格式错误、告警去重、不自动重发未知外发与 current generation/fence 的精确匹配。

## 未验证与取证限制

- 持续失败的真实阶段/具体错误仍未知；本轮没有跑生产 Check/Recover，也未替换当前安装脚本来加探针。
- 一次 Win32_ProcessStopTrace 只读事件订阅被操作系统拒绝访问，未提权或换方式重试；没有建立订阅。自然子进程精确退出状态因此没有新证据，不能拿普通 CIM 消失推成 exit1 或 timeout。
- 未采 CPU、内存、文件读取/SQL 执行计划、连接锁等待共同时间窗，故不归因 n8n/AI/导入/备份。
- 探针 bootstrap 缺依赖与首次隔离夹具省略 State 参数的原失败保存在 [开发记录](evidence/probe-development-failures.json)。它们没有发起生产检查，不是运行版本故障；只修正诊断器引用及测试参数，没有放宽断言。
- 本轮两项隔离实验已独立只读复审；这是调查证据，不是修复后的回归或上线验收。
