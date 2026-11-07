# Runner 升级失败诊断修复

本文件记录 2026-11-07 通用 WAL 修复中的 Windows / WSL 诊断部分，属于开发候选。未修改生产运行目录、服务、制品或历史失败记录；主负责人统一安排独立 Astra 反审和交付。

## 改动与边界

[`tools/pi_agent_upgrade_runtime.py`](../../tools/pi_agent_upgrade_runtime.py) 原来把 Linux 非零退出和顶层异常统一变成 `pi_source_upgrade_failed_closed`，原 Linux 原因随捕获的 stderr 丢失。现在保留原 `error`、`message` 和失败退出，在 JSON 中增加 `diagnostic`：

- `stage` 区分 `linux_apply` 等实际动作、`linux_input`、`wsl_transport`、`wsl_response` 与 Windows 本地校验。
- `reason` 只允许本文件明确列出的静态错误码；受控异常链最多保留 3 个安全原因。非白名单异常、系统调用异常和超时映射成固定类别，绝不输出异常文本、命令参数、路径、stdout、stderr 或 traceback。
- `directExitCode` 是 WSL 进程实际退出码；传输超时和启动失败为 `null`，不能据此推定 Linux 操作没有发生。

Linux 传输代码生成单条结构化 stderr 诊断。Windows 仅在 stderr 不超过 4 KiB、恰有一条标记诊断、字段类型和动作一致时接受；WSL 文本警告被丢弃。重复、畸形、超限、未知错误码均报告 `linux_failure_unknown`。即使 stdout 声称成功，非零进程退出仍失败；零退出但同时存在合法失败诊断也作为响应未知拒绝。

正常成功回执字段保持不变。失败诊断不会重试、改 intent、发布 Windows 配置或写成功回执。现有未完成操作仍由原状态核对流程处理。

## 隔离验证

[`tests/pi-upgrade-runtime-diagnostics.test.py`](../../tests/pi-upgrade-runtime-diagnostics.test.py) 通过 13 项测试（Python 3.12）：实际私有 Python 子进程执行生产 `LINUX` 包装字符串，仅 UID 和被导入 dispatch 模块使用合成夹具，WSL transport 在 Windows 端用该子进程实际结果替代。

覆盖 WAL 错误码、拒绝候选的受控异常链、敏感异常/系统调用输出不泄漏、WSL warning、非零退出与伪成功冲突、超时中的部分成功输出、畸形/多条/超限诊断、零退出与失败诊断冲突、正常成功兼容及实际 CLI 拒绝路径的 JSON 与 exit 1。每项失败只调用一次 transport。

命令：`py -3.12 tests/pi-upgrade-runtime-diagnostics.test.py`。语法编译与 `git diff --check` 通过。Windows 原有 `WindowsSourceUpgradeReceiptTests` 也通过，覆盖响应丢失、文件碎片及同一 CurrentUser DPAPI 所属保持。此诊断测试不声称覆盖真实 WSL / systemd 的完整升级生命周期；该证据由核心修复和独立隔离演练提供。

执行子代理由主代理继承模型，工具回执未独立报告实际底层型号；本文件不将自身核对称为独立反审。
