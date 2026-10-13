# OpenCode Go 生产采用复验

日期：2026-10-13（Asia/Shanghai）。用户在本聊天明确要求生产发布上线。

核对发现，另一轮 [AI 生产发布](../ai-release-blockers-20261013/PRODUCTION.md) 已包含本次 `User-Agent: xiaote/1.0` 修复。因此本轮完成当前安装和运行状态复验，没有重复部署或重启服务。

## 当前安装与运行证据

- 正式 Django `app/deployment.json` 的 SHA-256 为 `52f0d18a6f0f9c5b9bf78f98fd8bc55747eb83f6f86e6bfd599d0a105db8de12`，部署时间为上海 18:00:26；与原生产报告一致。
- 已安装 `backend/ai_assistant/provider.py` 的 SHA-256 为 `f6a1e6bb9c32ca99e948d5238ce51d2c45344b40c67e42c8921ab12c9412c069`；与该部署记录的 sourceRoot 文件逐字节相同。将 CRLF 规范为 LF 后，完整文件与本聊天审查过的源码提交 `c785e25376f1701c428df0f324929165bd0c94f6` 相同，确认 Go 精确来源/路径的共同 JSON/SSE 入口包含指定请求头。
- AI reader/writer 的实际进程 StartTime 与受控 PID 回执 creationDate 对应，分别为上海 18:10:43/18:10:44，晚于安装切换。当前 `8111/8112 /health/ready` 均返回 HTTP 200；3000 首页返回 HTTP 200。
- 当前 Worker 为 `20261013T091815Z-878966319497c4bd`。自然监控在上海 18:29:10 与 18:30:22 两次完成，均为 `healthy=true`、Worker `exact_release`、backend `Ready`、supervisor `healthy`，12 组件全部就绪，live/ready/homepage/helper 四个 HTTP 探针均为 200。

初次读取的 18:26:35 监控结果为 `healthy=false`，原观察保留，不追认为成功；上述后续健康观察不证明此前异常原因。另两次探测错误地请求了 Worker 不存在的 `/health/live` 与 `/health/ready`，返回 404；正式健康入口采用监控原四探针，独立 AI 健康访问使用 Django 8111/8112，不把错误路径 404 当服务故障。

## 范围与限制

[开发回归](REPORT.md) 的 87 项结果继续适用于同一 provider 源码；本轮只增加安装/运行复验，没有修改产品代码，没有重复 Worker/Django 打包、PrepareApp、切换、数据库备份/恢复或迁移，也没有真实配置写入、调度修改或外部发送。

未调用真实 OpenCode 推理接口，不能将安装和健康验收表述为真实供应商 HTTP 400 已消失。生产模型连接需要用已保存的实际模型执行独立连接验收，结果尚未验证。

复验原件保存在 `D:/codex-artifacts/opencode-go-user-agent-20261013/production-installation-verification.json` 与 `production-health-verification.json`。本记录仅关闭本次请求头修复的生产采用状态，不延伸其他候选或历史生产授权。

## 18:35 用户授权的真实模型连接测试

用户随后要求测试，并询问是否需要重新配对。通过原公开 `POST /api/ai/models`、同源保护和已保存的 OpenCode Go 配置执行一次 `action=test`，未读取或输出明文密钥、未编辑模型参数。上海 18:35:13 发起，18:35:16 完成，耗时 3536 毫秒：公开接口 HTTP 503，脱敏错误为“模型服务返回 HTTP 400，请检查 AI 助理中的模型配置与服务状态。”没有自动重试，`lastTestResult` / `lastTestedAt` 仍为空。因此请求头已安装与真实连接成功必须分开，当前实际连接仍失败。

只读核对配置：模型 `deepseek-v4.1-flash`、API 根 `https://opencode.ai/zen/go/v1`，与[官方 Go 接口表](https://opencode.ai/docs/go/)一致。官方同时说明每个对话应发送稳定 `x-opencode-session`；当前已安装 provider/transport 没有发送此头。这是后续兼容性诊断线索，尚未通过供应商原错误码或只改变该头的对照请求确认它就是本次 HTTP 400 根因。API 的脱敏错误也不能证明已有密钥/订阅有效或失效，暂不要求用户重新配对或替换密钥。

本轮没有追加供应商请求、修改配置、实施新代码或再次上线。原始脱敏回执保存在 `D:/codex-artifacts/opencode-go-user-agent-20261013/live-provider-test.json`。尚需定位供应商拒绝原因；此节取代上一节“真实连接未测试”的当前状态，保留此前时间点记录。
