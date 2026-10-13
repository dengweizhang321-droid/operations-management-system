# OpenCode Go 稳定会话头

2026-10-13（Asia/Shanghai）。用户要求修复 OpenCode Go、生产上线及真实测试，随后提供 18:35:15 的供应商拒绝截图。原测试 HTTP 400 / inference_failed、供应商显示 11ms、非流式；这些字段不能单独证明密钥失效或具体参数原因。

[官方 Go 文档](https://opencode.ai/docs/go/)要求客户端发送自有 User-Agent 和每个对话稳定的 x-opencode-session。第一轮 User-Agent 修复已采用，但真实连接仍失败。本轮补充会话头，并用同一保存模型继续验收；不以文档要求直接断定旧 HTTP 400 根因。

## 源码与验证

- 开发从最新 main 8b0a8b7a 继续，源码 a7423963 已推远端 main。独立正式候选以当前已采用来源 04329d8f 为底，仅应用本次四文件增量，提交 c1df9357；没有把 main 中其他未采用改动带入生产。
- provider 共同 JSON/SSE 请求入口仅向精确 OpenCode Go 来源和路径添加会话头；聊天按 conversation ID、Agent 按 execution ID 绑定稳定的命名空间 SHA-256 标识，ContextVar 在正常或异常结束后恢复。独立探针/单次调用生成 UUID。原始内部标识、问题正文、用户身份和密钥不写入会话头。
- 89 项 AI 配置/传输/流式/能力/领域回归：88 通过、1 跳过；另 19 项数据集聊天与工具预算回归通过；Django check、无迁移 dry-run、完整 backend 编译和 diff 检查通过。验证会话稳定、不同会话隔离、嵌套与失败恢复、独立测试唯一、其他来源/路径不增加头，以及原 JSON/SSE/鉴权/拒绝不重发合同。
- 正式候选四文件与上述被测文件 SHA 相同。按原 Copy-ApplicationTree 的安装投影规则，逐文件比对当前安装 backend：仅 provider.py、chat.py、workflows.py 和 test_opencode_configuration.py 改变，其他安装字节和全部迁移相同。第一次未套安装投影、将源码 tests 目录纳入时的比较失败保留，不称生产缺失测试文件为缺陷。
- Git 完整增量范围计划 93e5fae7b6d7a57af7905e83468ab288195b8b6b5f9282af7cd99cb39c76cc85：仅 Django、无迁移、无未知路径，不重复 Worker 打包或切换版本。

## 准备与发布记录

当前 E 盘备份 daily-20261013T051108Z-77715d3b35da 经原 Verify 复验 completed，manifest b2bc4142950291ff369fa723550fef6f0aaafedb3c0b8932d609414a4d8ed893，未改变服务状态、未新建备份或执行恢复。

原 PrepareApp 完成，ID 6cc0d6d1f77245b08e7a8826f38faebb，receipt 0e368f32d70d38caeebbb2420bdc96b53c0801704642d3b2b8ee0cee8ff3527c，候选 manifest 08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92，绑定当前前驱 52f0d18a6f0f9c5b9bf78f98fd8bc55747eb83f6f86e6bfd599d0a105db8de12。

发布采用原 rotation 互斥及原生命周期操作，独立 create-only started/process/completion 证据，公共绝对期限、失败保全、不自动重放；适配器与已采用适配器相比仅机械替换候选 Django 脚本路径。维护 ID db9caa954a6b412f83074d6b9a40bce0，保留 PostgreSQL。

首次进入维护在 Worker 已停止后退出非零，应用尚未切换。独立核验管理员环境查不到 pwsh，原 Stop 未进入 Django action 日志、各 Django PID 回执与 AI 原进程保持、Worker 控制回执已不存在、3000/5791 无监听，原维护/排空标识持同一 ID。保留 unknown/首次失败；续接只为本次管理员进程补充已安装且逐 SHA 验证的 bundled PowerShell 7 路径，同一原维护 ID 与未改变的候选/前驱继续，未改系统 PATH 或降低控制器门禁。

原始日志、范围与准备/发布材料位于 D:/codex-artifacts/opencode-go-session-20261013。最终安装、健康和供应商测试结果以本目录 PRODUCTION.md 为准；不能仅凭源码/准备或维护进入成功宣布上线或连接成功。
