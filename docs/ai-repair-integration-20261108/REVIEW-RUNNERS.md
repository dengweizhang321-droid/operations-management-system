# Pi/Pandas 隔离真实启动独立反审

2026-11-08。**当前阶段通过：源码绑定、隔离启动方法及已有就绪证据未发现阻断；停止与资源恢复尚待最终回执复审。** 不能据此声明整项验证已收尾，也不能称为 Windows 总控完整原生冷启动。

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

Docker 使用 UID1000 的 `/run/user/1000/docker.sock`，Runner 原构造器仍校验私有文件/目录、socket 所有者、rootless、seccomp、cgroup v2/systemd、资源限额支持及固定镜像入口。子进程环境明确列举，不继承业务凭据、代理或供应商设置。Pi namespace 为 `pi-test-integration-20261108`，gateway 为测试回环 `127.0.0.1:19182`；本轮没有 Pi 会话，因此没有触发模型调用。

Pi 使用原 `python -B -m pi_runner.server --config ... --port 19189`；Pandas 原 `server.main()` 通过上述端口 bootstrap 监听 18139。原服务端仍只绑定 loopback，HMAC、账本预留、原容器执行器和清理逻辑未替换为假返回。就绪回执记录两个真实进程的 PID、startTicks、UID 和完整 argv，均符合启动参数。Pandas 端口适配明确属于隔离接缝，不冒称其默认生产端口或总控入口已验证。

## 已证明的范围

1. **Pi Runner 真实就绪**：原 `client.command()` 使用随机 nonce/时间戳，禁止代理与重定向，校验响应 HMAC；原 health 会重新执行 Docker preflight。现有回执显示固定镜像、最终源码摘要、active/unresolved/unsafe unknown 为零。这里没有新建 Pi 会话、运行 Agent 容器或真实供应商任务，不能称这些已在本轮完成。
2. **Pandas Broker 真实就绪**：原 probe 校验响应 HMAC、固定镜像、cleanupVerified 及严格 runner 源码摘要。
3. **Pandas 真实容器自测**：同一个原 probe 的 `self_test=True` 走原执行路径，将两行合成数据 1000 和 -200 在容器中求和；只有返回精确 800、正确 HMAC/镜像及 cleanupVerified 才产生现有通过回执。没有宿主 Python 替代计算，也没有业务数据或真实模型请求。

审查原件：[启动脚本](D:/codex-artifacts/ai-repair-integration-20261108/run-runners.py)、[Linux harness](D:/codex-artifacts/ai-repair-integration-20261108/runner-linux.py)、[启动前状态](D:/codex-artifacts/ai-repair-integration-20261108/WSL-BEFORE.json)、[来源](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-SOURCE.json)、[就绪](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-READY.json)。stderr 现有内容为 WSL localhost 代理映射提示，没有 Python traceback；本轮子进程环境和 Pi client 禁用继承代理，不能将该提示解释为功能成功或失败的唯一依据。

## 待补的停止与恢复证据

本轮 Runner 有意继续运行以供另一 Windows 子任务绑定。已审脚本会在 STOP/有界保持结束后，对仍存活进程复验 PID/startTicks/UID/argv，再按相反顺序发 SIGTERM、等待退出；随后检查空容器、此 namespace 无卷、两端口可重新绑定并移除临时 keys。**这些是尚待观察的计划路径，不是已完成事实。**

最终增量复审需读取真实 `RUNNER-STOP.json` 及资源收尾回执，核原进程退出、端口、容器/namespace 卷、Linux 与 Windows 临时 key 移除、旧意图摘要保留，并区分 Docker/发行版是已恢复启动前停止状态还是有明确后续依赖仍保留。不得以现有 Pandas 单次容器 cleanupVerified 替代整体资源收尾。

本轮没有调用 Windows `operations-system-control.ps1` 完整总控及其受管生产根约束，也没有验证整个 Windows 应用栈冷启动。后续 Django/Worker 接线和组合 G02 属于各自独立小任务；本报告只覆盖两个原 Runner 进程及 Pandas 容器自测的上述实际范围。当前没有源码或方法必须返修的问题，最终清理未闭合前保持阶段完成表述。
