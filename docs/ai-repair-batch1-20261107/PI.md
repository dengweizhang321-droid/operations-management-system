# 第一批 Pi：W1 容量与保留环境，W2 唤醒

日期：2026-11-08（上海）。共同施工基线为 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`。本页记录隔离候选及原始证据；独立反审、合并、正式制品、部署和生产维护分别记账。未读取或改动本轮生产 Pi 对象。

## W1：回收外壳并保留历史

- [Django 签名传输](../../backend/ai_assistant/pi_transport.py)、[派发与 worker](../../backend/ai_assistant/pi_worker.py)、[初始化及 reset](../../backend/ai_assistant/pi_workspace.py)：仅当前 create 的 nonce 签名、HTTP 400、精确 `{"error":"session_limit"}` 同时匹配才作为确定的未创建。派发保存原完成拒绝，worker/同步 init 结束本次 operation，释放 lease/capability，不动旧 unknown。reset 已发生代际切换时，回执明确保留切换效果及替代环境未创建。超时、错 nonce、含混正文和原 unknown 仍保留。
- [内部维护入口](../../backend/ai_assistant/management/commands/pi_reclaim_stopped.py) 和 [Django 联合核对](../../backend/ai_assistant/pi_workspace.py)：`pi_reclaim_stopped --session <id>` 观察一个候选；维护方另获精确授权后，才可用 `--apply --request-id <id> --container-id <full-id> --image <sha256:id> --volume <name> --last-seq <seq>`。入口不进网页或公共 API，不按批自动执行。Django 核对当代会话、操作、派发、控制、交互/活动和权限，再原子预留维护控制；相同原 ID 只读原回执，内容变更不重发。
- [Runner shell 生命周期](../../backend/pi_runner/server.py) 与 [控制账本](../../backend/pi_runner/workspace.py)：Runner 独立核对停止/活动、未决账本、完整 Docker ID、镜像、卷和受保护升级前驱。持久记录删除意图后，仅对完整 ID 执行非强制 `rm`；核对外壳消失、原卷身份未变且没有其他容器引用，保存停止及保留卷标记。原卷、代际、权限、seq、原回执保留。中断/不明保留原意图和未知，禁止重放。复建仍计物理名额，沿同原身份、卷及镜像完成；不以空卷恢复。已有文件的 Pi 原生 ID/路径必须一致；从未写入历史的空白 Pi 进程可以重新分配临时原生 ID，Django/Runner 工作区身份保持。
- 已自动休眠、Django 原为 ready 的工作区在成功回收后维持该工作区状态，下一次合法 operation 可在保留镜像重建。若 Django 原为 paused，必须具备无 capability 唤醒能力才准回收。否则不删除，避免原历史可读但没有恢复通路。此前记录的 8 个已退出容器只是历史现场；本轮未逐项盘点，不能据此认定今天容量或有可回收对象。
- W1 反审返修先核验原镜像能力，再写 creating 或执行任何 Docker 启动与外壳删除。不兼容镜像的确定拒绝保留 stopped 和原壳。跨越创建/启动边界后的失败保留 unknown。回收和复建用只读、有界的原卷探针核对已登记的原生历史路径。旧账本未记录空会话证明时，只有原路径不存在、原运行序号为零且控制账本没有历史写者才接纳空会话。已使用但无法验证原历史的环境保留原壳。
- 恢复过程中原壳、卷或历史核验失败时，Runner 同事务保留恢复围栏并撤销本地网关绑定。已尝试启动的容器只按原完整身份停止，原壳继续保留供核对。Django 的默认清理不能删除处于该围栏或原回收意图中的外壳。

## W2：恢复本地绑定

- [Runner 的本地与 operation 绑定](../../backend/pi_runner/server.py)、[唤醒控制](../../backend/pi_runner/workspace.py) 和 [Django 唤醒证明](../../backend/ai_assistant/pi_workspace.py) 共享 W1 的恢复入口。唤醒只带当代 admission，复用 Runner 账本里的已验证模型/思考档及已选技能；Django 校验原控制、代际和当前准入后才标 ready。无活跃 operation 时不签发 capability。Runner 本地恢复清除内存网关字段，旧 capability 不复活；新 operation 仍经原授权才接入模型/系统工具。计划模式、旧 admission、权限撤销及不确定恢复继续失败关闭。
- 镜像标签 `teruisi.pi.local-restore=1` 与可信扩展的 `/runner-restore` 配套，后者只接收本地 model/admission/thinking。旧镜像的唤醒保留明确兼容性拒绝。已暂停的旧工作区可使用原登记升级计划，Runner 先核实原停止状态、剩余名额和原卷历史，再启动旧容器读取原生状态，沿原保护前驱及克隆卷流程完成升级。Django 用已签名的有效模型/思考状态与冻结模型版本构造被动元数据。新容器恢复本地权限所需的元数据无凭据，旧 operation 的 capability 不复活。缺少证明、计划、名额或原镜像资格时保留原壳。 [镜像](../../containers/pi-agent/Dockerfile) [可信扩展](../../containers/pi-agent/gateway-extension.mjs) [工作区升级](../../backend/pi_runner/upgrade_linux.py)
- 固定发布器根据完整差异的路径两端识别镜像输入变化。在合并授权后的 `--prepare-only` 阶段用冻结来源运行现有镜像构建器，记录 `PI-IMAGE.json` 中的源码 commit/tree、实际构建输入摘要、镜像 ID 和三项标签。原生 `PreparePiUpgrade`、`PiUpgradeCheck` 使用这个 ID，`PREPARED.json` 绑定其回执。发布和原尝试续接读取同包证明。只改变 Runner 源码的准备使用原受管配置里的当前镜像，避免退回旧固定镜像。旧格式准备包继续按旧条件读取。镜像输入变化仍须符合原生 Runner 源码升级资格。 [发布准备](../../tools/publish-prepared-main.mjs) [发布续接](../../tools/publish-main-resume.mjs) [构建器](../../containers/pi-agent/build_image.py)
- W2 反审返修将已核验的模型和思考档保存在 Django 工作区的私有快照中。旧 Runner 重启后签名状态里的空值不会覆盖该快照。控制发送前重新核对原账号、角色、数据范围、会话代际和冻结模型版本。升级还把原容器的空历史证明传入克隆环境。只有原文件确实不存在且两侧历史内容一致时，才允许空会话的临时原生标识变化。

## 隔离验证与边界

证据根目录：`D:/codex-artifacts/ai-repair-batch1-20261107/pi/`。`SOURCE.json`/`SOURCE.diff` 保留首轮候选；最终应用与工具冻结以 `W2-R1-SOURCE.json` 为准，原 W1 和 W2 各轮增量清单继续保留。两个独立 Astra 的源码审查均通过，G02 最终候选入口结果由负责人单列，不以源码审查替代。

| 验证层 | 结果和原件 |
| --- | --- |
| 私有 PostgreSQL + 合成边界 | `pg-launcher.log` / `pg-tests.log`：5 项通过。实际本地签名 HTTP + Django worker/init；校验 nonce/HTTP 状态/正文反例。真实 PostgreSQL 事务竞争中，已预留回收挡住新 prompt 与第二次维护，成功后再接受新请求。Docker 边界在这组用合成回执。 |
| SQLite + 合成边界 | `django-lifecycle-v2.log`：4 项通过，作为早期定向证据；`django-wake.log` 为后续直接唤醒单项，覆盖终态 init 无 capability 及当前 admission 绑定。 |
| rootless Docker + 真实 Pi 1.3.0 | `native-eca65643bedb.json` 及对应三个命名空间日志，3 项通过：满额拒绝、真实外壳回收、Broker 重启、两路竞争只占一个名额、同卷/模型/思考档/技能/文件/历史保持、旧 capability 字段不保留、后续新 operation 独立接入；删除响应丢失保留 unknown；计划模式/旧准入拒绝、升级前驱保护分支（保护谓词用合成阳性）及缺卷禁止重建。容器内运行 Python/npm/uv 版本探测和保留文件；本轮未重复执行真实依赖下载/安装。模型响应为合成夹具。 |
| 镜像及语法 | `isolated-image.json` / `isolated-image.log`：专项测试镜像 `sha256:235e65ce8998a3b8ccede114733d90f7433801a74159b2229844c1ea9cd1eeba`，构建、扩展导入、Python 语法和差异检查完成。此镜像只是隔离测试工件。 |
| W1 反审增量 | `W1-R1-isolated-ledger.log` 的 3 项通过，使用实际 Broker/SQLite 与合成 Docker 边界。两个确定拒绝没有 Docker 启动或删除，跨启动边界故障保留 unknown。`native-f89f8b50777d.json` 使用旧镜像和旧账本形状复验空会话回收及复建、已使用但无法验证历史时保留原壳。`native-6aea9cb17b5c.json` 在候选镜像重跑一名额回收/唤醒正例。 |
| W2 镜像与历史恢复增量 | `W2-publisher.log` 的发布准备与续接 118 项通过，编排外部边界为合成夹具。`W2-isolated-image-proof.json` 对应真实隔离构建的镜像 `sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d`，包含三个要求标签。`W2-django-local-model.log` 的两项 SQLite 测试通过，核对冻结版本和无 capability 唤醒。`native-ecc97a39f941.json` 使用旧镜像、候选镜像及真实隔离 Docker/Pi，通过旧暂停环境升级、保留前驱、历史一致、本地 Bash 和无网关绑定检查。注册计划为隔离夹具，升级中的历史、文件与运行时检查为真实，模型回应为合成。 |
| 候选验证器 profile | 两份发布器测试也被候选验证器的 profile 引用。另行运行直接步骤和 profile 夹具时，显式 PrepareApp 清单用例报告缺少 `tools/publish-latest-main.mjs`，从精确基线归档复跑仍是同一缺项。相关原件为 `W2-profile-fixtures.log` 和 `W2-profile-baseline.log`。这组夹具与隔离镜像构建、生产控制器资格分别记账。 |
| W2 反审返修 | `W2-R1-django-signed-v3.log` 的两项隔离检查通过，覆盖真实 Broker 账本重建、实际签名 HTTP、Django 刷新及升级和唤醒控制。版本不匹配的请求保持停止，Runner 本地物理动作使用替身。`W2-R1-real-django-v3.log` 通过 Windows Django、签名 HTTP、私有 WSL Broker 真实重启、空状态刷新、真实 Docker/Pi 克隆升级和 Django 唤醒。此夹具的旧会话为零消息，保持原生 ID、模型与思考档，未发放网关 capability。带已落盘历史的容器升级也通过直接增量复验，见 `native-ea3f4e91d0cd.json`。两次早期真实失败原件保留在 `W2-R1-real-django.log`、`W2-R1-real-django-v2.log` 及相应私有日志。 |

每次真实容器夹具均使用新 `pi-test-w1w2-…` 命名空间；日志尾记录逐个核标签后清理该次容器、卷和私有目录，复查无残留。保留早期失败原件和清理回执。未使用真实模型凭据，未声称生产整链验证、生产容量恢复或发布完成。
