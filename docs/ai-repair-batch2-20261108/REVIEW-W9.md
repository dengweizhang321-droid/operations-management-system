# W9 独立反审

当前状态：**增量复核通过，无剩余 W9 阻断**（受审 W9 字节见文末 R1）。初审状态为需定向返修（2 项 P2），原发现与反例保留下文。2026-11-08；本次按用户逐小任务例外请求 `gpt-6-astra / high`，底层实际型号未由工具独立回传。审查者未参与实现、未转派、未修改应用源码或 Git；只写本报告与外置审查证据。未访问生产、未启动服务、未请求真实供应商或外发。

## 精确范围与证据

审查 `615506fa4fc5baff31b9c21eac744839676c0567` 相对父提交 `b3699853203be77e7ab82cd644eb962ca01626e6` 的 W9 差异；读取 W5 `ab8cb303` 对应原 ID、`PhaseTimer` 和调度依赖。W5 报告别名返修、W6R Broker/发布改动不纳入此审。

独立核验 `w9/SOURCE.json` 的 3 个源码文件、6 个原件与补丁摘要全部匹配；W9.patch SHA-256 为 `f8c6d4ed706c0197eaef0a22bc11b8e81eb405395b4aab35823cf7e098c27d46`。本树适用规范与 `origin/main=0c7d0feb` 对比无差异。已读取总方案 W9、REVIEW/EVIDENCE 对性能归因和原样本的限制。

- 原 SQLite 5/5 与私有 PG 5/5 日志核实；未重跑 PG、未把原件核验写成独立 PG 执行。
- 对照脚本抽取精确 W5 `workflow_tick`，其余代码共用本候选；相同图、模型配置、合成回复各 10 次，原函数 6 ticks、候选 4 ticks，每次 2 个 Agent、2 次模型、1 次人工批准。结论仅为减少调度调用次数，不能推出生产秒数或约 1005 秒历史样本的根因。
- 独立反例实际执行 2/2：外置 [脚本](D:/codex-artifacts/ai-repair-batch2-20261108/w9/astra_repro.py) 与 [日志](D:/codex-artifacts/ai-repair-batch2-20261108/w9/astra-repro.log)。显式内存 SQLite，合成用户和 provider；通过是成功复现下面缺陷，并非实现已通过。

## 阻断项

### W9-R1 — 结果未知的派发被投影成已知完成窗口（P2）

位置：`backend/ai_assistant/workflow_timing.py:38–43,60–68,78–89`；关联原语义 `workflows.py:469–475`。

触发：已预留 provider 后抛出 `provider_unavailable`（或其他导致 `_fail` 的不确定外部失败）。原 `_fail` 正确把 calling 派发置 `unknown`，同时将 `completed_at` 写为本地判未知时刻。新投影不读取 `state`，只看起止时间，因此返回 `unknownDispatches=0` 和非空 `providerDispatchUnionMs`；实际反例为 `unknown / completedAtExists=true / unknownDispatches=0 / providerDispatchUnionMs=2`。

影响：用户无法从新投影区分“收到了完成回执的窗口”与“直到本地判未知的观察窗口”。若通过较晚的失败/租约清理才判未知，该窗口还含未知等待；仅说明含本地开销不足以解释这个差别，容易误作已知供应商/派发耗时。此发现不表示发生重放，原 unknown 防重仍在。

最小修复：投影读取并保留派发状态，结果未知不能报为 `unknownDispatches=0`。可把未知项排除于完整已知窗口并返回 null，或单列明确命名的“预留至本地判未知”区间和状态；不要修改原账本，也不据此重试。provider 与 tool 的未知情况分别处理，覆盖真实 `_fail` 已填 `completed_at` 的路径。

### W9-R2 — 完成 child 后容量分支丢失父级进度保存（P2）

位置：`backend/ai_assistant/workflows.py:1077–1086,1133–1140`。

触发：旧 active child 已完成；同轮继续创建下一节点时，其他 Agent 已占满 owner 8 个（或全局 64 个）活动槽。候选先把 active 节点完成写入库并在内存清空 `row.current_node_key`，随后容量分支只保存 `updated_at` 就返回，跳过本来会执行的父级 version、current_node_key 与 `node_progressed` 事件保存。

实测：返回 `waiting_capacity`、第一节点 `completed`、下一节点无 job，但父 `current_node_key='first'` 且 `version=2→2`。原串行流程会在本轮完成 child 观测并保存父状态，下一轮才进入容量检查。

影响：容量等待期间父级仍指向已经完成的节点，本次实际节点进展没有对应父版本和事件；读取/按版本控制的消费者得到不一致的进度。未观察到重复模型调用，此项不宣称会越过容量或审批。

最小修复：在同轮观测 child 已发生且容量不足时，仍原子持久化这次父进度、清空 active key、递增版本并写原进度事件；保持无后继创建、容量限制、租约和权限不变。容量释放后继续只建一个后继；未发生新观测的普通容量轮询不必重复制造进度事件。

## 其余结论及复核边界

同轮推进仍使用原 mutation 和当前 principal 校验；queued/running child 返回等待，retryable child 暂停，失败/取消 child 不推进，human_review 停点仍独立，特殊并行经营分支位于改动前返回。新推进本身不调用 provider、不改变并发上限、模型参数或后台调度配置。

详情查询按已有 workflow/节点/child 关联限界，24 jobs、481/961 探测上限及区间并集避免把并行努力时间相加；列表不增加该查询。原 claim 日志沿 W5 原请求标识输出，单调耗时未并入账本墙钟。源码与现有原件支持上述有限结论，不替代生产、真实模型或真实并发负载验收。

修复后仅回本独立上下文增量复核这两项与直接影响；不要求重复全仓检查或扩展监控平台。本报告不授权合并、制品准备或上线。

## R1 增量复核通过（2026-11-08）

受审提交 `f64a8cca65b6a77b8c4a800725eff0dc1f5b19bc`，仅复核其中相对 `615506fa` 的三个 W9 源码/测试文件及说明，不纳入中间 W5 提交或并行 G02/Broker/发布工具改动。`SOURCE-r1.json` 的 3 个源码摘要、3 个原件摘要和 `W9-r1.patch` 摘要全部独立匹配；增量补丁 SHA-256 为 `1d28beb3491229fa67f6c9e13dea673e7aecccbdca882c6e8cc3b48c59c1042f`。

- **W9-R1 已关闭：** 查询显式读取 provider/tool `state`，只有 `succeeded/failed` 的有效起止才进入完整已知窗口；calling/unknown 即使有本地 completed_at 仍计未知。原真实 `_fail` 合成触发重放后返回 `unknownDispatches=1`、`providerDispatchUnionMs=null`；另确认 calling 搭配非空 completed_at 仍保持未知。原账本与防重机制未改。
- **W9-R2 已关闭：** 仅本轮确实观测 completed child 时，容量分支保存父级 clear key、version 和原进度事件。原反例实测 currentNodeKey=null、version 2→3、后继 0 个；下一轮容量仍满时不增版本、不重复事件。释放一个占用后只建 1 个后继，再轮询仍只有 1 个，等待 agent 执行；完成事件总数 1。

独立执行 [astra_r1_verify.py](D:/codex-artifacts/ai-repair-batch2-20261108/w9/astra_r1_verify.py) 的 2 项修复断言通过，[日志](D:/codex-artifacts/ai-repair-batch2-20261108/w9/astra-r1-verify.log) 已保留；显式内存 SQLite、合成 provider、无真实外发。执行者 SQLite 6/6、私有 PG 2/2 受影响用例仅核对原件，不计为审查者独立 PG 执行。

正常容量与成功回执分支没有新的调度改动，原 10 对样本 6→4 tick 的结果可按原 `615506fa` 字节复用；未重跑、未改写样本绑定、未声称真实延迟改善。其余初审已核结论在未改范围内复用，无需全仓或生产复验。

本次仅关闭两项 W9 缺陷。请求模型仍为 `gpt-6-astra / high`、实际底层型号未独立回传。报告和外置回执由审查者更新，无应用源码/Git/生产操作，不构成合并、制品或上线授权。
