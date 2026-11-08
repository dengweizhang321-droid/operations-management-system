# Pi/Pandas 隔离真实启动独立反审

2026-11-08。**本小任务通过：源码绑定、隔离真实启动及停止/资源恢复的增量复审均未发现阻断。** 本结论覆盖两个原 Runner、Pandas 容器自测及后续已记录的无 prompt Pi 会话生命周期，不等于 Windows 总控完整原生冷启动。初审时的待清理状态保留在外置 `REVIEW-RUNNERS-STAGE.md`，以下明确区分初始就绪与后续增量。

请求独立 `gpt-6-astra/high`，工具未独立回传实际底层型号及强度。本上下文未参与本次 Runner 实施；复用既读共享记忆和项目规范，补读运行启动及 AI 工具隔离边界。只读源码、非敏感绑定与现有回执，没有调用 WSL、控制进程、读取测试 secret 文件、访问生产或外发请求；仅写本报告和外置审查结果。

## 来源核验

固定应用提交 `557b497dc0fe42f3693a0c6c76320a4833b46b49`。独立读取该提交 Git blob 并复算：

- `RUNNER-SOURCE.json` 的 **71 个 Runner 成员**与该提交相应目录排除测试及缓存后的完整集合相同，全部 SHA-256 匹配，无缺项或多项。
- Pi **63 个镜像输入**聚合摘要为 `ebd8c75cb62b903e2d18ce297a08bf1e844f9ca71cb1423b1338ad54950ea478`，与 W11b 原 `IMAGE.json` 和本轮来源回执一致。原回执 `sourceCommit/sourceTree` 为 null，因此本轮绑定依据是重新核验最终 Git 输入字节及固定镜像 ID，不能倒称原镜像已按该 Git 提交构建。
- Pandas 原镜像回执的 Dockerfile、entrypoint 两个输入与该提交字节一致。复用固定 Pi 镜像 `sha256:dea9bb9e4a8a8f41865a10666981444d51ef52415c89e980af0c70e7219a5df2` 和 Pandas 镜像 `sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580`，本轮没有重新构建正式制品。
- 按原算法独立复算 Pi `source_digest=fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08`、Pandas `package_digest=5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`，与现有就绪回执一致。
- Linux harness SHA 与来源回执相同；Pandas bootstrap 的三行内容仅 import 原 server、设 `PORT=18139`、调用原 `main()`，其摘要与回执相同。检查器/启动器三份 Python 脚本 AST 解析通过。

独立结果与本轮输入摘要见 [AUDIT.json](D:/codex-artifacts/ai-repair-integration-20261108/review-runners/AUDIT.json)。该审查使用原件复核，没有将原执行回执称为独立运行结果。

## 资源边界和真实入口

`inspect-wsl.py` 先核 Windows WSL 注册表中发行版 `Codex-AI-Batch2-20261108` 的精确目录为 `D:/codex-isolated/ai-repair-batch2-20261108-wsl`。Linux 检查再次确认发行版名，记录四个旧试验 unit 的 inactive/MainPID=0、Docker inactive、两测试端口无监听及未发现原 Runner 进程；旧 rotation/unknown 意图逐文件摘要保留，未执行重放、删除或轮换。

启动固定在该专用发行版，以 `teruisi-pandas`、UID1000 执行。Linux harness 要求新建且不存在的 `/home/teruisi-pandas/codex-ai-integration-20261108`，以 0077 umask 建立独立 state/ledger/config/key；没有沿用生产或旧故障账本。密钥随机生成，Windows 交接只保存 CurrentUser DPAPI 密文；本审没有读取其内容。

Docker 使用 UID1000 的 `/run/user/1000/docker.sock`，Runner 原构造器仍校验私有文件/目录、socket 所有者、rootless、seccomp、cgroup v2/systemd、资源限额支持及固定镜像入口。子进程环境明确列举，不继承业务凭据、代理或供应商设置。Pi namespace 为 `pi-test-integration-20261108`，gateway 为测试回环 `127.0.0.1:19182`；初始就绪检查没有 Pi 会话；后续 Windows 接线创建并处置了两个隔离会话，均未发送 prompt 或调用模型。

Pi 使用原 `python -B -m pi_runner.server --config ... --port 19189`；Pandas 原 `server.main()` 通过上述端口 bootstrap 监听 18139。原服务端仍只绑定 loopback，HMAC、账本预留、原容器执行器和清理逻辑未替换为假返回。就绪回执记录两个真实进程的 PID、startTicks、UID 和完整 argv，均符合启动参数。Pandas 端口适配明确属于隔离接缝，不冒称其默认生产端口或总控入口已验证。

## 已证明的范围

1. **Pi Runner 真实就绪**：原 `client.command()` 使用随机 nonce/时间戳，禁止代理与重定向，校验响应 HMAC；原 health 会重新执行 Docker preflight。现有回执显示固定镜像、最终源码摘要、active/unresolved/unsafe unknown 为零。这份初始就绪回执本身没有证明新建 Pi 会话或运行 Agent 容器；后续实际会话增量见下节。全程未运行真实供应商任务。
2. **Pandas Broker 真实就绪**：原 probe 校验响应 HMAC、固定镜像、cleanupVerified 及严格 runner 源码摘要。
3. **Pandas 真实容器自测**：同一个原 probe 的 `self_test=True` 走原执行路径，将两行合成数据 1000 和 -200 在容器中求和；只有返回精确 800、正确 HMAC/镜像及 cleanupVerified 才产生现有通过回执。没有宿主 Python 替代计算，也没有业务数据或真实模型请求。

审查原件：[启动脚本](D:/codex-artifacts/ai-repair-integration-20261108/run-runners.py)、[Linux harness](D:/codex-artifacts/ai-repair-integration-20261108/runner-linux.py)、[启动前状态](D:/codex-artifacts/ai-repair-integration-20261108/WSL-BEFORE.json)、[来源](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-SOURCE.json)、[就绪](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-READY.json)。stderr 现有内容为 WSL localhost 代理映射提示，没有 Python traceback；本轮子进程环境和 Pi client 禁用继承代理，不能将该提示解释为功能成功或失败的唯一依据。

## 后续 Pi 会话与精确卷清理

核读 `windows/runner-binding.py`、原 `ai_assistant.pi_transport.command()` 及两份 `DJANGO-RUNNERS.json`。Windows 隔离 Django 使用原 HMAC 传输，只有测试端口和私有签名配置被接入；原传输校验响应 HMAC、状态及 operation/owner/conversation/epoch/generation/seq 绑定后，才返回给 harness。最终回执记录 create/state 均为 idle、固定镜像与 1.3.0 excel-report 包、零 pendingGatewayRequests，以及签名核验后的 disposed。没有 prompt/model 请求，因此不外推真实推理或 Skill 执行效果。

`windows/attempt-04/DJANGO-RUNNERS.json` 保留原 `AssertionError`，同时有真实签名 disposed 回执；最终 `windows/DJANGO-RUNNERS.json` 补齐 create/state/dispose。两份记录分别对应两个不同工作空间，不以最终成功覆盖首次失败。

`cleanup-pi-volumes.py` 只接受本任务 windows 目录下回执，要求 disposed 且 signatureVerified；以两份 workspace 的固定 namespace/name 推导精确两个卷。专用发行版、UID1000、namespace 下容器为空、实际卷集合恰等于预期、逐卷 namespace/名字相符且无容器挂载后，才执行非强制 volume rm，并回查 namespace 无卷。独立按两份原回执推导的卷名与 `PI-VOLUME-CLEANUP.json.removedVolumes` 全部相同，无额外清理对象。dispose 本身保留卷，不能把后续明确清理说成 dispose 自动删卷。

## 停止与资源恢复增量复核

- `RUNNER-STOP.json.source` 与原 `RUNNER-READY.json` 完全一致，绑定原 PID/startTicks/UID/argv。已审 harness 在 SIGTERM 前复验存活进程身份，两原 main 实际退出均为 0；停止回执记录测试端口可重新绑定、容器为空、namespace 卷为空、Linux 临时 keys 已移除。
- `finish-runners.py` 读取并要求该真实成功停止回执，再重用原限定只读检查。独立比较 `WSL-BEFORE.json` 与 `WSL-AFTER-OBSERVED.json`：**四个旧 unit 的状态逐字段一致，24 个旧 rotation/intent 文件的路径及 SHA-256 完全一致**；测试端口无监听、Runner 进程列表为空、Docker MainPID=0/inactive。
- Linux 两个临时 key 的不存在由原只读检查回执证明；本审另仅检查 Windows 两个精确 key 路径不存在，没有读取任何 key 内容。两个新测试 ledger 的摘要已记录，源码、账本与旧故障意图继续保留。
- 最终 `RUNNER-CLEANUP.json` 为 retained_stopped：专用测试 Docker 已恢复 inactive，测试发行版已停止，`wsl --list --running --quiet` 的原观察仍列出生产 `TERUISI-Pandas`。该项只证明生产发行版仍在运行，不是生产业务健康验收；没有对生产发行版执行命令。

保留 [首次停后检查失败](D:/codex-artifacts/ai-repair-integration-20261108/cleanup-inspection-attempt1.stderr)：长期宿主退出后 Docker socket 不存在，额外只读 `docker ps -aq` 返回非零。没有把失败改成空结果，也没有为了补查而重启 Docker 或重放动作。最终容器/卷为空采用 `PI-VOLUME-CLEANUP.json` 与 `RUNNER-STOP.json` 中宿主退出前实际成功的观察，再结合后续 inactive/发行版停止证明；**不声称停后重新查询 Docker 成功**。此已解释的只读补查失败不否定此前成功清理，也不从失败本身推断无残留。

原件：[停止回执](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-STOP.json)、[精确卷清理](D:/codex-artifacts/ai-repair-integration-20261108/PI-VOLUME-CLEANUP.json)、[最终资源恢复](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-CLEANUP.json)、[后续限定观察](D:/codex-artifacts/ai-repair-integration-20261108/WSL-AFTER-OBSERVED.json)、[独立增量核验](D:/codex-artifacts/ai-repair-integration-20261108/review-runners/CLEANUP-AUDIT.json)。增量核验保存所有上述新原件、清理脚本及两次会话回执的 SHA-256。

本审增量全程只读，没有再次启动 WSL、调用 Docker、控制进程或执行清理。71 个源文件及镜像输入没有变化，复用前审有效绑定，不重复启动。没有本小任务待返修问题或待清理资源；保留测试源和账本是有意保全，不作为删除对象。Windows 总控完整冷启动、其他 Windows 接线及组合 G02 的完成判定仍由各自报告负责，不因本收尾通过自动扩大结论。
