# W1 独立反审

2026-11-08。**最终增量结论：W1 通过，无剩余阻断；R1 已关闭，Q1 已核实并关闭。** 以下保留初审发现及证据，返修结论见末节。请求角色为独立 `gpt-6-astra` / `high`；工具未提供可独立确认的底层型号。审查者未参与实现，只读被审源码，未提交、合并、发布或操作生产。

## 冻结范围与证据

- 工作树 `D:/codex-worktrees/ai-repair-batch1-20261107`，HEAD `e268b28761ae4ada958455344c0dfbb37d2ae4f8`，原基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。
- `D:/codex-artifacts/ai-repair-batch1-20261107/pi/SOURCE.json` 所列 11 文件 SHA-256 已逐一独立复算，全部一致；审查只覆盖 W1 及直接共享恢复入口，W2 另作独立专审。完整跟踪差异读自 `SOURCE.diff`，新增维护命令和测试直接读取。
- 读取当前主线 AGENTS、模型分工、开发交付、架构、安全、验证发布适用条款、共享记忆及原 PLAN/REVIEW。用户本次逐小任务 Astra 独审覆盖一般 Sol 分工规则。
- 既有 `pg-tests.log` / `pg-launcher.log`：5 项通过，私有 PostgreSQL 与真实本地签名 HTTP，Docker 回执合成。`native-eca65643bedb.json` 及三个日志：真实 rootless Docker / Pi 1.3.0，模型响应合成；升级前驱保护谓词为合成阳性。日志保留各精确 namespace 清理回执。没有把这些证据称为生产整链验证。
- 独立补验：真实 `Broker.execute` → `start_stopped` → `Session.start` 与私有 SQLite，只有 Docker inspect 边界合成；复现 W1-R1。原件为 `pi/W1-legacy-rejection-repro.json`。本轮未重跑整包、未读取生产 Pi 对象。

## 已复现阻断 W1-R1：旧镜像的确定拒绝使环境进入 unknown

**优先级 P1；本次直接回归。** 触发条件：已有 `stopped` 环境的原镜像缺少 `teruisi.pi.native-capabilities=1`，下一合法 operation 沿 `create` 恢复。`server.py:983` 先将环境持久化为 `creating`，随后 `Session.start` 在 `server.py:168` 返回 `workspace_native_image_upgrade_required`；`start_stopped` 的通用异常处理再执行 `session.fail('workspace_resume_unknown')`。

独立复现结果：仅执行 image inspect，没有 start/create Docker 效果，但内存和 `sessions.status` 均成为 `unknown`；同一 create 的 `commands.status` 却是 `rejected`，错误仍为 `workspace_native_image_upgrade_required`。Django transport/worker 继续把该错误当确定拒绝正常收尾；后续 Runner workspace upgrade 又会被 `workspace_unknown_fenced` 拒绝。旧实现直接在 stopped 状态调用 `start()`，能力检查失败前没有这次新增的 creating/unknown 状态变更。

这既破坏双方状态一致性，也堵住旧镜像原有升级路径。另一个直接相关场景是 Django ready 的旧壳：回收目前仅在 `requireLocalRestore=True` 时查本地恢复能力，可能先删除不具备原生恢复能力的旧壳，再在重建后发现不兼容。此后已有真实效果，不能把整轮降格为纯粹的未执行拒绝。

**修复要求：** 将可判定的原镜像资格检查放到 creating / 外壳重建之前；无效果拒绝保持 stopped 和明确可升级状态。回收准入必须证明原镜像的恢复通路，或明确拒绝并保留原壳。若已经创建/启动或发生其他不确定效果，保留 unknown，不通过改错误名单掩盖。补 stopped 旧镜像、回收旧镜像两个定向反例，并复核 Django 确定拒绝与 Runner 状态一致；无需重跑整包。

## 待核风险 W1-Q1：旧空会话没有 stoppedHistory

`Session.start`（`server.py:183` 起）只有在 `stoppedHistory` 精确证明原 Pi 会话为空时，才允许恢复后临时原生 ID 改变。旧版停止路径不会写该新字段，但可能已有 `currentSessionId` 和尚未实际写出的 `sessionFile` 路径。若这种历史空会话在新版本下恢复产生新 ID，就会报 `workspace_history_identity_changed` 并进入 unknown；当前回收未前置排除此情况。

这是源码支持的历史兼容风险，本轮未独立运行旧 ledger + 真实 Pi 反例，**不冒称已复现第二个缺陷**。请原实现者用旧版可产生的空会话账本核实；确认存在时，应补可靠的空历史证明或拒绝回收、保留原恢复路径，不能放宽真实历史身份校验或使用空卷兜底。

## 逐项判断

| 要求 | 结论 | 依据 / 限制 |
| --- | --- | --- |
| 当前 nonce 签名 + HTTP 400 + 精确 session_limit 正文 | 通过 | transport 精确字节判断，错 nonce、状态、额外/重复正文反例保留 unknown；现有真实 HTTP 证据匹配 |
| worker / 同步 init 确定容量拒绝收尾 | 通过 | create dispatch 完成拒绝、无 prompt/model 派发才清 lease/capability；旧 unknown 不重写；reset 单独保留代际切换事实 |
| 独立精确维护、默认不 apply | 通过 | CLI 必须显式 apply 和完整 ID/image/volume/seq；公开控制白名单没有 reclaim_stopped；普通 create 不自动回收 |
| Django 与 Runner 联合排除活动/unknown/frozen/未决 | 通过 | 两侧准入及账本检查；Django 事务预留控制挡 prompt 和第二维护；Runner 未决活动和升级账本另核 |
| 升级 retained predecessor 保护 | 通过（代码与合成分支） | 复用真实 retained_reference 谓词，删除前检查；测试仅合成阳性，不声称真实升级前驱演练 |
| 精确删除及保卷、未知不重放 | 通过 | rm 完整 ID、非 force；先持久化 reclaimIntent；原卷身份/占用/外壳消失复核；完成标记与回执同事务；真实丢响应用例保 unknown |
| Broker 重启与 maxSessions 并发限制 | 通过 | 持久 retainedShell 加载；新建/重建/回收共用 broker 锁，按物理容器计数；真实一名额竞争与满额 wake 拒绝 |
| 原 volume/image/seq/代际与历史保持；缺卷/冲突不空卷恢复 | 通过（新镜像正例） | 保留绑定、卷 SHA 与独占引用；缺卷失败关闭；真实文件/历史恢复。旧镜像例外见 R1，旧空会话见 Q1 |
| 旧镜像恢复与两侧确定拒绝一致 | **阻断 W1-R1** | 独立复现确定拒绝和 unknown 并存，升级通路被封 |
| 生产 8 个 exited 的清理结论 | 不在本轮执行范围 | 仅历史现场，本轮无逐项生产盘点、无回收授权或清理 |

已将 R1 及 Q1 交根负责人和原 `pi_core`。后续仅审返修增量及直接影响，其他已审通过项在冻结内容未变化时复用。

## 2026-11-08 返修增量复核

**W1 通过。** 复核绑定 `pi/W1-R1-SOURCE.json`：12 个列明文件摘要、`W1-R1-SOURCE.diff` 摘要 `dc7d2dee45143709add579bb4cf8e2e4b30422ae91d2daae4970511faff5a0f8`、Runner 原生来源摘要 `7c6d17b76ce0b3b3ae1471109531fefb45035f58747b2bc3a7f0c3904a35f49b` 均独立复算一致。复核时 HEAD 为 `7caf36f05c2b239add960f559ec9642f0fb3a6f3`；审核对象仍是精确未提交源码摘要。此次仅覆盖 R1、Q1 及直接调用影响，不重新审 W2 发布镜像接线。

- **R1 关闭。** `Session.image_labels()` 在 `start_stopped` 进入 creating 前执行，回收也在 reclaimIntent / rm 之前执行；新建环境在创建卷前检查。能力不足时保留 stopped 与原壳，仍可进入原升级流程。跨创建/启动边界后的异常改为 `workspace_resume_unknown` / `session_create_unknown`，不会因内部异常恰好同名而误映射确定拒绝。原 Django transport/worker 确定拒绝路径未改，初审相关证据可复用。
- **独立定向重跑通过。** 审查者执行 `python -B -m unittest -v pi_runner.test_retained_lifecycle.LegacyImageRejectionTests`，3 项通过（0.107 秒）。真实 Broker 与私有 SQLite、合成 Docker inspect；证明旧镜像 create 拒绝没有 start 效果且双方账本状态一致、旧壳不被回收、跨启动边界的同码错误仍为 unknown。不将该合成边界测试称作真实旧镜像运行。
- **Q1 关闭。** 新 `verify_stopped_history` 复用受限只读原卷探针，核原登记路径；原有历史继续严格绑定 native ID / 文件路径。无新式停止证明的旧空会话仅在零运行 seq 且无历史写控制时接纳；已使用但缺失原登记历史则在回收意图前明确拒绝。探针使用 readonly、volume-nocopy、无网络和非特权用户，原卷先由既有身份检查核验。
- **真实旧镜像证据匹配。** `native-f89f8b50777d.json` 与对应日志使用 `sha256:87e41e7e4d646d779eba8b552a213d5356c4afa935d42dbb618d19fab7e15956`、旧账本形状，完成空会话回收、Broker 重启与原卷重建；使用后将历史注册路径指向缺失文件的负例明确拒绝且保留原壳、没有 reclaimIntent。旧镜像可能复用初始 `conversation` ID，因此初审的 ID 变化风险仍属于条件假设，最终判断不依赖 ID 必须变化。该证据是旧镜像配合候选 Broker 的隔离兼容验证，不是旧 Broker 全流程重放或生产验证。
- **受影响正例复用/核查。** `native-6aea9cb17b5c.json` 与日志的候选镜像一名额竞争、回收、重启、同卷历史与文件恢复通过；两份真实容器日志均有精确 namespace 清理回执。模型仍为合成响应。其余初审已通过项在未变更边界内继续通过。

最终逐项状态覆盖上表旧“阻断 W1-R1”：旧镜像确定拒绝一致性改为通过，原 volume/image/seq/代际与历史保持的旧镜像例外已关闭。没有新的生产盘点或清理授权，生产 8 个 exited 历史对象仍不能据此默认删除。W2 后续共享文件若再变更，只对实际相关增量更新绑定与复核。

## 2026-11-08 最后共享交叉增量复核

**W1 继续通过，无新增阻断；R1、Q1 维持关闭。** 本节仅核 W2 共享修改对 W1 生命周期的影响，不代替另一个独立上下文对完整 W2 和发布器的专审。

- 冻结绑定更新为 `pi/W2-SOURCE.json`。四个共享源码文件和 `test_retained_lifecycle.py` 的当前摘要均独立匹配；相对已审 R1 的 `W1-W2-shared-increment.diff` 摘要为 `903c18fee40e5214248f3bc67742ad6f62d8b55bfd144fa4a37a461bff8f0d37`，独立复算一致。Runner 原生摘要 `f52624e07ce7f7d85e1b55bf5c77f7703a55c8448cab4b48da83711cb8cdf930` 匹配。复核时 HEAD `cb741e6252acfc1b288b2699e6551f7947c88793`；审核仍绑定实际候选文件字节。
- 镜像资格预检、容量锁与物理名额限制、保卷回收准入、原历史证明没有被放宽。回收调用不接收 W2 的 fallback model；R1 的无效果确定拒绝仍在 creating/rm 前返回。Q1 的零运行 seq / 无历史写者及原路径检查继续适用。升级新增 broker 锁与物理名额检查也未绕过 W1 回收保护。
- 恢复时原卷/原壳/历史无法验证，或跨启动边界失败，会先以同一 SQLite 事务持久化原身份 `resumeHold` 和 unknown，并撤销网关。已尝试启动的分支只在完整既有 inspect 契约验证后，以原完整容器 ID 请求 stop；验证或 stop 失败不宣告停止成功，不删除原壳或清除 unknown。
- 默认 dispose 在任何清理效果前拒绝 `resumeHold` / `reclaimIntent`，堵住 Django freeze 随后删除待核壳的路径。重启加载会保留带 resumeHold 的 unknown，即使物理外壳缺席也不当作可新建；没有新增清 hold、重放删除或恢复授权的自动路径。
- 审查者独立重跑 `LegacyImageRejectionTests`，4 项通过（0.129 秒，实际 Broker/私有 SQLite、合成 Docker）。另独立验证真实 `preserve_resume_failure`、SQLite 重开、`rebuild_unknown_references`、`execute`，合成 inspect/stop 丢响应：仅请求原完整 ID stop，持久 hold 和网关撤销保留；缺壳加载仍 unknown；create 与 dispose 均拒绝且无 Docker 重放。原件 `pi/W1-shared-review-repro.json`。这些不是实际 Docker 停止故障演练，未扩写为生产证明。

原始三层审查记录及反例保留。没有源码修改、提交、生产读取、停止或删除；本次通过不授权生产清理。
