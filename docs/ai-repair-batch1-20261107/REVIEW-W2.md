# W2 独立反审

日期：2026-11-08。当前结论：**W2 源码增量复审通过，原 P1 已修复，无剩余已知源码阻断。** 最终干净候选的 G02 固定入口验证仍单列为未完成交付门槛，不能用本报告替代。下文保留首轮发现及证据，最新冻结与关闭依据见文末 R1。

## 身份、范围与冻结

- 按用户本批明确要求请求 Astra High 独立反审；审查上下文未参与方案或实现。工具未独立返回实际底层型号，不能据此声明已证实实际型号。
- 已读共享记忆启动协议、适用记忆、完整现行 AGENTS.md，以及模型分工、开发交付、架构、安全、验证发布的适用条款、G02 和 CI/profile 边界。记忆由根负责人统一维护。
- 基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`；冻结清单 `D:/codex-artifacts/ai-repair-batch1-20261107/pi/W2-SOURCE.json` 的 16 个文件摘要全部与工作树匹配。冻结差异 SHA-256：`5f1d7d4f002071ae41e59388d30ed5a213f33b2e635c3c7cb1c905867305645d`；Runner 来源摘要声明为 `f52624e07ce7f7d85e1b55bf5c77f7703a55c8448cab4b48da83711cb8cdf930`。
- 直接审阅 W2 Django/Runner/可信扩展/镜像构建/发布准备及续接差异、原件和必要直接依赖。W1 容量与删除主逻辑沿原独审结论，本轮只核 W2 共用恢复及 resumeHold 边界，不重复整项 W1。
- 未修改被审源码、未提交、未构建生产制品、未读取或操作生产 Pi 对象；新增内容仅本报告及工作树外的审查复现材料。

## 首轮 W2-R1：旧暂停环境的刷新会抹去恢复所需模型快照〔P1，已在 R1 关闭〕

**触发：** 旧版本 Runner 创建并暂停的环境尚无新 `workspace_values.localModel`。本次发布重启 Runner 后，`rebuild_unknown_references` 创建的新 `Session` 不具备旧进程内的 `effective_model` 和 `pi_state`。用户刷新工作区（也需要借此获得新登记的 `upgradePlans`），随后升级或唤醒。

**位置：** [Runner 重建](../../backend/pi_runner/server.py#L673)、[状态输出](../../backend/pi_runner/workspace.py#L455)、[thinking 输出](../../backend/pi_runner/workspace.py#L610)、[Django ingest 整体覆盖](../../backend/ai_assistant/pi_workspace.py#L338)、[新历史模型恢复函数](../../backend/ai_assistant/pi_workspace.py#L550)。

**实际行为：** 新 Session 的真实 `public_state` 返回 `effectiveModel: null`、`thinking.effective: null`；实际 Django `ingest` 把原有效模型快照整体覆盖。`_historical_local_model` 因此由有值变成 `None`，Runner 的 `local_restore_model(None)` 抛出 `workspace_local_model_unavailable`。旧镜像无本地恢复协议，升级目标又要求本地模型，用户仍无法沿正常页面流程恢复旧暂停环境。拒绝保全原壳，未观察到数据删除；这是恢复可用性阻断，不是越权漏洞。

**独立复现：** 外置 `pi/W2-review-repro.py` 和 `pi/W2-review-repro.log` 使用实际 `Session`、Runner SQLite、`public_state`、Django 私有内存 SQLite、`ingest`、`_historical_local_model` 与 `local_restore_model`。仅升级计划来源为合成；未连接 Docker 或生产。输出为 `beforeMetadataAvailable:true`、两个空快照字段、`afterMetadataAvailable:false`、`workspace_local_model_unavailable`。测试通过代表反例得到确认，不能记为修复通过。

**建议：** 在原权限与代际边界内保全可验证的被动模型/思考快照，避免将停止状态的空观测覆盖为“原模型不存在”；或安全复用当代原签名 create/控制证据恢复该快照。保留模型版本、scope、epoch/generation、有效 admission 校验，不从浏览器值补模型、不复活旧 capability。补齐旧账本无 `localModel` → Runner 重启 → 正常状态刷新 → Django 发起升级/唤醒的回归，并检查原参数、历史和新授权边界。

现有 `native-ecc97a39f941.json` 中原生测试手工把 `create_args` 的模型传给 Runner，证实有合法被动模型时升级工作，但绕开了上述 Django 刷新链，因此不能反证本问题。

## 其余核查结论

| 核查项 | 结论与依据 |
| --- | --- |
| 本地恢复与网关授权分离 | `runner-restore` 清空 JS capability；Runner `_bind_settings(None, …)` 清空网关；gateway_call 还要求活动 operation 及 gateway。新 operation 仍走原绑定。未发现旧凭据复活。 |
| admission 与模式 | Django 当前 principal/tree 重授权、Runner 精确 admission 对比及执行命令的 execute 检查保留。plan 可恢复本地只读状态，Bash 继续拒绝；不存在缺 admission 默认 execute。 |
| 模型、思考档与技能 | 新账本持久被动模型元数据，恢复校验实际 model/thinking 回读；技能仍按原版本和选择启动。不下调输出、上下文或任务时限。旧账本进入该链的缺口见 W2-R1。 |
| 历史与卷 | 共用恢复入口先核原壳/卷/历史；不确定失败保留 resumeHold、unknown 和原壳，默认 dispose 被围栏阻断。原生证据覆盖同历史、文件和技能保持；未重审 W1 全量删除协议。 |
| 镜像输入闭包 | 两个来源目录覆盖当前 Dockerfile 全部源码 COPY、构建器、runtime/package 锁及 bundled skills；下载资产由锁中的完整性摘要约束，base image 使用 digest。输入先读入同一份字节映射再摘要及构建。独立重算 63 文件输入摘要为 `ebd8c75cb62b903e2d18ce297a08bf1e844f9ca71cb1423b1338ad54950ea478`，与实际隔离镜像证明一致。 |
| 准备、发布与续接 | 镜像变化在 prepare-only 内构建；前后核冻结来源，PREPARING 先落盘，失败不重放；PREPARED 绑定镜像证明及原升级计划。deploy-only/续接只验证原证明，不构建。Runner-only 准备读取当时受管镜像并固定下来；旧无 selection 的非镜像包保持原语义。 |
| 证明缺失与漂移 | 独立 `W2-review-image-proof.mjs/.log` 的 7 项纯函数断言通过：正常、摘要篡改、tree 不匹配、selection 缺失、文件缺失、rename 旧路径识别、旧包兼容。可信生产者仍是冻结构建器及原文件/原生计划绑定；没有新增签名平台。 |
| 实际采用入口 | 发布器仍经 PreparePiUpgrade/PiUpgradeCheck 和原 UpgradePi，受管配置、权限、来源与计划检查保留。未修改 PS 控制器资格化字节。镜像-only 后续发布仍受既有 Runner 源码升级资格限制，不能声称已支持任意镜像热替换。 |

## 证据边界与交付门槛

- `W2-publisher.log`：118 项发布/续接编排夹具通过，外部原生动作是替身；不是 Windows 实际生命周期完成。
- `W2-isolated-image-proof.json`：实际隔离镜像 `sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d`、三项标签和输入摘要。sourceCommit/tree 为 null，符合“未合并测试候选”，不能当正式 PI-IMAGE/PREPARED。
- `W2-django-local-model.log`：2 项 SQLite 正例；不足以覆盖本次已复现的刷新链。
- `native-ecc97a39f941.json` 及对应日志：真实 rootless Docker/Pi 旧暂停环境升级、同历史及本地 Bash；模型响应/兼容计划注册为合成。日志有私有容器/卷清理记录。早期 `native-eca65643bedb.json` 的可复用证据仅按 PI.md 声明范围使用。
- `tests/publish-prepared-main.test.mjs` 同时被 `verify-release-candidate.mjs` 的多个 profile 引用；已核直接依赖。`W2-profile-fixtures.log` 与 `W2-profile-baseline.log` 均出现相同的既有 `Missing installed module: tools/publish-latest-main.mjs`，不将此当 W2 引入的缺陷，也不宣称相关 profile 全绿。
- **G02 未完成：** 本轮尚无最终干净候选的固定 `verify-release-candidate.mjs` 机器报告。根负责人已确认最终整合后执行；当前混合变更存在适配器不支持的已知可能，若拒绝须如实保留并处理适用兼容缺口，不能以 118 项编排、SHA 一致或 rootless Pi 测试替代。此项与 W2-R1 源码阻断分开记账。
- 正式 prepare、生产镜像采用、生产对象盘点、容量恢复及上线均未执行。本报告不授予这些动作。

## R1 增量复审与关闭依据

最新冻结清单为 `pi/W2-R1-SOURCE.json`，16 个源码/报告文件和所列 5 份证据摘要均独立核对一致。完整差异 SHA-256 为 `bd4141932f608cde723a565d5e9dd925d26faf0fd890fdd28527ec8c229e24c9`；相对首轮增量为 `0248027d34e712180c0e2eed0fce0f5cdac4141efdeceef860edacea6791aa39`；Runner 来源为 `fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08`。实际增量为 Django workspace、Runner upgrade、Django 定向测试及 PI.md；Runner workspace 与 server、镜像及发布器字节均与首轮一致，复用首轮相应结论。

- Django 在已验证的 stopped 状态中单独保存 `localModelSnapshot`。其绑定包含 owner、role、scope、selection、session、epoch/generation、modelId/version；要求同代、idle、无活动 operation 和合法工作区状态。空的停止观测不再抹去快照；当前模型配置仍须匹配冻结版本及被动参数。
- 快照不伪装成实时 `effectiveModel`，也不通过 workspace_record 或 public 投影泄露；发送 wake/upgrade 前重查当前 session、principal/tree admission 和模型绑定。首轮本地恢复与 operation 网关分离保持。
- 独立外置回归 `W2-R1-review-regression.py/.log` 将首轮真实源码反例改为修复断言，并运行直接相关的 2 项仓库用例，共 3 项通过。重复空 poll 后模型仍可恢复，实时 UI 仍空且没有私有快照；额外 owner/selection 变化拒绝，原用例覆盖 epoch/generation/scope/role/frozen 和实际签名控制中的模型版本拒绝。使用私有 SQLite，Docker 物理边界为替身。
- `W2-R1-real-django.py` 及 v3 日志经过直接审阅和摘要核对：Windows Django 走实际签名 HTTP；私有 WSL Broker 重启后返回空模型，Django poll 取得新计划，再经真实旧容器/卷克隆升级及 Django wake 完成，未签发新 capability，原生 ID、模型和思考档保持。兼容计划为隔离合成证明，未连接真实模型供应商；该测试不等于完整 Windows 生产发布生命周期。原命名空间的 2 容器、2 卷和私有目录清理回执已核对。
- 空历史升级增量先用现有 `record_stop_history` 获取实际原会话/文件存在及零消息证明，再比较升级前后真实 `get_messages` 摘要。只有原历史为空且新会话也零消息时才容许 Pi 临时 ID 变化；已有历史仍要求原 ID 及历史摘要一致。`native-ea3f4e91d0cd.json` 与原日志补证已有落盘历史的真实升级通过、清理完成。没有改动 W1 删除/保卷、resumeHold 或默认 dispose 围栏，不需重开 W1 整项审查。

**处置：关闭 W2-R1。** 首轮失败证据及作者两次真实返修失败原件保持，不回填为成功；首轮镜像/发布器结论继续有效。无新增生产动作或源码修改。G02 固定候选入口及其混合载荷适配缺口仍由根负责人在最终冻结后按真实结果单列处理；源码复审通过不代表可合并或已经具备正式制品。
