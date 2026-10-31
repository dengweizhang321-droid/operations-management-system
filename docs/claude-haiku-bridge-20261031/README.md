# Claude Lead、Haiku 与 Codex 的 Windows 对接

本方案将同事的 `codex-dev.md` 适配到本机 Windows 和 TERUISI 项目。Claude 主会话负责拆解与判断，Haiku 包装子代理转交派工单，独立 Codex CLI 会话在另一棵 `codex/*` worktree 开发。它不连接现有桌面聊天，不继承该聊天上下文。

本轮源码位于独立候选分支，未合并、未更改用户级 Claude/Codex 配置、未启动真实模型任务。检查与限制见 [交付记录](REPORT.md)。

## 适配文件

- [Haiku 代理定义](../../.claude/agents/codex-dev.md)：Claude 按项目级 agent 发现规则加载。
- [桥接器](../../.claude/scripts/codex_teammate.py)：Python 标准库实现，原生 Windows，`start/status/wait/verify/resume/stop`。
- [命令限制 hook](../../.claude/hooks/guard_codex_wrapper.py)：只允许本定义对应桥接器的固定参数形式，正常 Claude 权限判断继续生效。

同事的原文件保持原样。删除 Mac 路径、`python3`、其他后端、`board.py`、守卫绕过参数、`allow-main`、600秒长等及未经本机确认的消息投递假设。Haiku 也读取本项目规定的记忆与规范，不沿用“不读规范”。

## 使用前提

1. 本机已有 Python 3.14、Codex CLI 0.166.0、Claude Code 2.1.295。桥接器从已安装 npm 包定位原生 `codex.exe`，不借 shell 执行 `.cmd/.ps1`。`python` 应解析到真实 Windows Python；`doctor` 会打印实际路径。
2. 从含上述三个文件的**桥接根目录**启动 Claude Code，使 `${CLAUDE_PROJECT_DIR}` 指向这里。当前候选根目录为 `D:/codex-worktrees/claude-haiku-bridge-20261031`。在 Claude 的 `/agents` 查看 `codex-dev` 是否加载；已有会话可能需要重新加载或重启。
3. 先采用普通命名子代理。无需为本链路开启实验性 Agent Teams；如果你原本已使用 Teams，Lead 可据客户端实际能力协调包装代理，不能凭文档宣称 Teams 已开启。
4. Codex 使用当前登录与用户配置，但请求模型固定为项目 routine 映射 `gpt-6.1-sol`、`high`，初次与续做均显式使用 `workspace-write` 和非交互拒绝升级。包装代理的 `model: haiku` 与 Codex 的模型是两个独立配置。未运行真实请求，账户权限、模型可用性及实际返回型号尚未确认。

## Lead 的派工步骤

Lead 先按项目规范从最新 main 建立**另一棵**独立干净工作树及 `codex/*` 分支；已有未提交内容的树不能开启新 RUN。桥接器不代替 Lead fetch、创建工作树、合并或清理。桥接根目录与目标工作树分开，避免执行者修改正在运行的控制脚本。

Lead 把 UTF-8 派工单写入桥接根目录 `.runtime/codex-bridge/inbox/`，每次补充另写新文件，不在聊天里让 Haiku自行整理。派工单至少写：原始需求、工作树、允许修改范围、输入材料路径、完成条件、检查边界、明确排除的生产动作。不要放密钥或原始客户数据。

在当前候选目录做只读环境发现：

```powershell
python "D:/codex-worktrees/claude-haiku-bridge-20261031/.claude/scripts/codex_teammate.py" doctor
```

然后让 Claude Lead 使用项目代理 `codex-dev`，把 SCRIPT、WT、TASK 三个绝对路径交给它。具体命令模板见 [代理定义](../../.claude/agents/codex-dev.md)。输入路径须使用正斜杠，不得包含 shell 展开符；不支持带引号等特殊符号的路径。

Git 共用管理目录中的 `codex-bridge-locks` 持有同一目标工作树互斥；它只能协调本桥接的运行，不能阻止人或其他未接入程序同时改文件。Lead 仍须保证工作树归属独占。

## 回合、证据与取消

每个 RUN 的证据在 `.runtime/codex-bridge/runs/<RUN>/round-NNN/`，已被仓库现有 `.runtime/` 忽略规则覆盖，不提交。

| 文件 | 用途 |
| --- | --- |
| `task.md` / `prompt.txt` | Lead 原文与附带固定项目边界的实际输入 |
| `request.json` / `invocation.json` | 输入摘要、精确会话、参数与请求模型；不记录凭据 |
| `events.jsonl` / `stderr.log` | CLI 原始输出，按需局部查看，不整体贴入对话或提交 |
| `last.md` | Codex 最终回复原文 |
| `result.json` / `verification.json` | 运行回执与机械 Git 核对 |

`DONE` 要求退出码 0、有效 session UUID、完成事件、无失败事件及最终回复文件，并确认精确 worker 已结束。它只代表 CLI 回合结束；【待答】、任务是否完整实现、功能是否正确须分别判断。`verify` 列事实而不判断自然语言声明真假，也不做业务测试。

`STARTING/RUNNING/FINALIZING` 返回 3；`DONE` 返回 0；`FAILED/CANCELED/BLOCKED/INTERRUPTED/CLEANUP_UNKNOWN` 返回 1；命令/身份检查错误返回 2。无回执的 worker 消失标作 `INTERRUPTED`，结果未知，禁止自动 resume。启动身份还没落盘时为 `STARTING`；若启动报错后一直保持该状态，Lead 查看 worker.log，不自行重放。仅 `DONE` 允许用记录的 UUID 续做；无自动重试或跨 RUN 恢复。

Windows 隐藏 worker 在启动 Codex 前把自己放入 Job Object，子进程继承该容器；worker 退出时清理其中尚存子进程。若容器建立失败，不启动 Codex。`stop` 写入本轮取消请求，由持有进程的 worker 处理，不按名字或裸 PID 杀进程；这属于进程取消，不是业务回滚。状态读取用 PID 加创建时间防止误认复用 PID。

因为 Windows 进程结束与后代终止并不保证同时完成，桥接器还在 Git 共用目录 `codex-bridge-locks/*.owner.json` 保存本 RUN 的工作树占用记录。只有在仍持有目标锁、确认 Job 中只剩 worker 自身时才删除自己的记录。取消或异常后无法确认子进程清理，会报告 `CLEANUP_UNKNOWN` 并保留记录；后续新 RUN 也拒绝该工作树。由 Lead 人工核验旧运行、工作树与全部相关进程后再处理占用记录；桥接器没有自动清理或强制续跑入口。强制取消后因此可能需要人工收尾，这是本版的明确限制。

本桥接不托管长期服务。CLI 回合结束后仍存活的该轮子进程会被结束，因此不要派工让它启动需要持续存活的预览、数据库或服务。

## 授权与交付边界

本链路只用于开发/修复和结果核对。合 main、准备制品、上线各阶段仍分别由用户放行并走项目原入口，不能把 Lead 的派工或 Haiku 的消息当用户授权。权限边界由项目规范、Claude 权限和 Codex 沙箱共同约束；hook 不是 OS 安全边界，也不证明不可被同用户其他进程篡改。

workspace-write 如果阻止读取必要资料、写共用 Git 管理目录、提交或推送，应交回具体阻塞；不自动追加共享目录写权限或改为 unrestricted。本次不改变生产代码、数据库、服务和自动导入。

## 官方参考

- [Claude Code 子代理](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [OpenAI Codex 非交互运行与精确会话续接](https://learn.chatgpt.com/docs/non-interactive-mode)
