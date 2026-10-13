# OpenCode Go 请求头修复

日期：2026-10-13（Asia/Shanghai）。用户提供 HTTP 400 截图及成功请求中的 `User-Agent: xiaote/1.0`，要求补充该请求头。

## 变更

开发基线为远端 main `85fa56a0f97d3cd322a4581c0ce4277baaa9b1e3`，源码提交为 `c785e25376f1701c428df0f324929165bd0c94f6`。开发位于独立 `codex/opencode-go-user-agent` 分支与受管 worktree；主工作区原有改动未覆盖。

在 [Django 模型网关](../../backend/ai_assistant/provider.py) 的共同请求入口，针对经过原端点校验的精确 origin `https://opencode.ai` 及 API 根路径 `/zen/go/v1` 附加 `User-Agent: xiaote/1.0`。既有 `/zen/go` 规范化后同样适用。连接测试、普通对话、工具调用轮次和流式对话均复用该入口；OpenAI 兼容和 Anthropic 两种协议保留原鉴权头。

其他供应商、OpenCode Zen 的非 Go 路径及类似路径保持既有请求头。没有增加任意请求头配置、修改模型参数或持久化数据。

## 验证与审查

- 隔离 Python 3.12 venv 安装仓库固定 `backend/requirements.txt`；数据库为内存 SQLite，网络与密钥均为合成替身。
- `manage.py test ai_assistant.test_opencode_configuration ai_assistant.test_transport ai_assistant.test_streaming ai_assistant.test_model_capabilities ai_assistant.tests --noinput --verbosity 1`：87 项，86 通过、1 跳过、0 失败。
- 新增回归经过真实 `bounded_json` / `bounded_sse` 控制流，到 `HTTPConnection.request` 接缝核对最终请求头、路径、原鉴权和媒体类型；覆盖根路径规范化、主机名大小写、两种协议、SSE 正文、其他来源/路径不受影响以及 HTTP 400 不自动重发。实际公网连接未调用。
- `manage.py check`：无问题；`manage.py makemigrations --check --dry-run`：无变化；全 backend `compileall`：通过；`git diff --check`：通过。
- 按源码调用链复核：模型测试使用 `provider.probe → turn`，聊天和工作流继续复用 `provider.turn`。新增头位于 JSON/SSE 分支之前，不改变鉴权、DNS/精确 origin、TLS、响应上限、取消、期限或付费 POST 不自动重试的保护。

首次使用已有旧 venv 时因缺少 cryptography 在加载阶段失败，未执行测试；随后改用独立 venv。初轮 40 项中两例因测试把显式 `:443` 当作现有默认白名单来源而失败，已按原精确 origin 合同纠正夹具，没有放宽产品校验。最终 87 项结果不回写早期失败。

本次只有 Django 后端代码及文档变化，按照 [验证与发布规范](../规范/验证与发布.md) 的范围分类完成 Django 验证，未重复运行 Worker 构建/全仓前端测试。

## 交付与采用边界

开发增量机器计划：`D:/codex-artifacts/opencode-go-user-agent-20261013/development-delta-plan.json`，SHA `59efb5a05f93d5f933721d5afef8e45647f4e9a62aa797c11e9e02a6c5e0ee74`。分类仅 Django、无迁移、未知路径为空。其基线是开发 main，不能替代当前正式前驱到最终候选的完整发布计划。

隔离源码 ZIP 为 `D:/codex-artifacts/opencode-go-user-agent-20261013/django-source.zip`，SHA-256 `a5d4694f32a90ecd09fbdf46caafc6d232c38d4ead87d15710fee07a17683acb`，绑定源码提交 `c785e253`；它是离线源码归档，不是正式 PrepareApp 收据或部署许可。回归原日志保存在同目录 `ai-regression.log`。

交付到远端 main 后仅代表源码已修复。未执行 PrepareApp、生产部署、迁移、服务启停、真实模型调用或真实配置写入；本次未验证生产 HTTP 400 已消失。正式采用仍须按当前实际前驱准备精确范围，不顺带采用其他 main 候选，并取得对应上线授权。
