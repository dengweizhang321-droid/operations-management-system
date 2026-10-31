# Windows Claude–Haiku–Codex 适配交付记录

日期：2026-10-31。基线：`cf019212dbcfa1d7aea3a0ddb11bdc78612bb6e2`（本轮 fetch 后 main 与 origin/main 相同）。候选分支：`codex/claude-haiku-bridge-20261031`。

用户明确原 `E:/微软文件/OneDrive/桌面/codex-dev.md` 属于同事、系统不同，要求按本机适配。原文件保留。使用方法见 [README](README.md)。

## 范围与关键选择

- 项目级 Haiku 包装定义、Windows Python 桥接器、包装代理命令 hook；不修改用户级 Claude/Codex 配置，不开启实验性 Teams。
- Claude Lead 写任务并判断结果；Haiku 机械转交；Codex CLI 请求 `gpt-6.1-sol/high`。请求模型不等于已独立确认实际模型。
- 控制目录与目标工作树分离；新任务要求同仓库注册的干净 `codex/*` worktree。运行后取得 Git 共用目录中的目标锁，并重新核验分支、首轮 HEAD/干净状态。控制命令用每 RUN 锁避免同时续做。
- 每轮保留任务原文、输入摘要、参数、事件、最终回复、退出回执与机械 Git 摘要；只通过精确 UUID 续接成功结束的 CLI 回合，不使用最近会话、不自动重试。
- 后台 worker 使用 Windows Job Object 约束子进程生命周期，精确 PID/创建时间辨识 owner；取消请求与已结束状态分开报告。目标锁旁保留 run/round 占用记录，只有确认 Job 中仅剩 worker 后才清除；未确认清理时阻止后续运行，不自动解锁。
- hook 只是限制包装代理的 shell 语法和工具，不是 OS 沙箱，不对同用户其他进程作防篡改保证。CLI 使用 workspace-write；权限不足交回，不自行扩大权限。
- 原同事项目的 Mac 路径、其他 backend、`board.py`、不读规范、绕过参数与长等待已删除。合并、制品、上线仍依照本项目本人逐步授权规则，不进入这条开发桥接。

## 必要检查

- Python 3.14 `py_compile`：桥接器与 hook 语法通过。
- 桥接器 `--help` 与 `doctor`：入口可加载，实际找到本机 Windows Python、原生 codex.exe、项目 Git 共用目录，未启动模型。
- 本机 `codex -a never -c notify=[] -c sandbox_mode=... exec resume --help`：入口接受全局配置及 resume 子命令形式；模型调用未发生。
- 官方 Claude Hooks 当前文档确认 command/args 与 `${CLAUDE_PROJECT_DIR}` 形式；Claude CLI 版本为 2.1.295。未实测 Haiku 会话中的 hook 执行。
- Git 差异空白检查、三份任务 Markdown 的相对链接及修改后的 Python 语法检查通过；独立静态审查结论见下节。

没有运行真实 Claude/Haiku/Codex 任务、业务接口、功能测试、生产服务动作或发布。账户登录有效性、模型可用性、真实 Windows 进程取消及端到端消息交回尚未经真实运行确认；不能把静态检查称为链路已启用或实际跑通。

## 独立审查

按模型分工，由 `gpt-6-astra/high` 新上下文提供提示词与最小生命周期契约建议；由另一 `gpt-6.1-sol/high` 新上下文静态审查实际候选。实际模型由宿主请求参数指定，未另取底层供应商证明。

独立审查指出 Windows worker 死亡与 Job 后代清理未必同步，不能仅靠 worker 退出释放独占。已按最小修正增加共享工作树占用记录：模型进程启动前落盘，清理无法确认时报告 `CLEANUP_UNKNOWN` 并保留；结果先落盘，再在持锁且无后代时删除自己的记录。最后修正旧 RUN 不得因同工作树的新 RUN 占用记录而误报未知：核对 fence 的 run/round 后才影响本轮状态。审查者增量复审确认原阻断和显示问题均已闭合，当前无剩余发现。这是静态结论，不是运行测试结果。

## 发布范围与后续

本次全部改动属于 AI 开发辅助工具和文档，没有 Worker/Django 应用源码、依赖、数据库 migration 或生产发布器改动。无需应用制品、迁移或生产上线。

候选实现提交 `00e697f0309ae90ec027988d53169bf092a336a8` 已完成开发检查与推送。用户于 2026-10-31 明确要求“帮我合并到main”；本次授权仅执行合并、推送及远端核验，合并结果以本次 Git 合并提交和远端 main 记录为准。使用说明同步为主项目 `D:/运营管理系统` 入口，复用前轮代码检查与独立复审，不重复功能验证。未改动用户级 agents，原主工作区已有未跟踪文件保持。源码合并不代表真实模型链路已跑通。
