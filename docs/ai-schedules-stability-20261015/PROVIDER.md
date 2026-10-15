# 模型工具闭环与脱敏诊断候选

日期：2026-10-15。工作分支 `codex/ai-schedules-stability`，开发基线 `a105f7fb0c20c1d6fc22580adf2c609f061a225e`。本节仅记录模型适配、能力测试和固定监控的可信聊天接缝；尚未提交、合并或生产采用。请求执行模型 `gpt-6.1-sol/xhigh`；工具没有返回可独立核验的实际底层型号。

## 查证与证据边界

- 今天两次故障已有证据只能定位到非流式第二轮响应解析/协议校验，原始响应未留存，不能确认具体坏字段或将供应商问题作为已确定根因。
- 原解析器对可选 `tool_calls: null` 报错；已用完整合成 HTTP 与 SSE 回合复现并窄修为“无工具调用”。数组、对象、函数成员、参数 JSON、调用边界、流式终止等其他异常继续失败关闭。OpenCode 仓库的[公开响应示例](https://github.com/anomalyco/opencode/issues/43712)包含该形态，这不证明今天 DeepSeek 响应也具有同一形态。
- 既有 `retain_reasoning=True` 已在请求内回传工具轮推理。新增合成测试同时验证 OpenAI 兼容协议的 `reasoning_content` 和 Anthropic thinking/signature 回传，推理不进入能力记录或新诊断。
- [OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)要求客户端 UA、稳定会话以及类似 coding-agent 的请求。原精确端点请求头继续保留；业务分析渠道适用性仍需管理员结合实际渠道协议判断，本轮没有通过改请求伪装渠道用途。

## 实现

- 适配版本常量：`backend/ai_assistant/provider_contract.py` 的 `PROVIDER_ADAPTER_VERSION=2026-10-15-tool-roundtrip-v1`。`InvalidProviderResponse` 保留外层 `invalid_provider_response`，仅增加固定的 `stage/reason/protocol/responseMode/adapterVersion`；没有正文、推理、参数、任意响应键或凭据。传输区分 JSON/UTF-8/根结构/SSE content-type，消息层区分 choices、message、content、工具与参数，流式层区分事件、增量、终止和缺失工具调用。聊天失败审计接入该诊断。
- `POST /api/ai/models` 的 `action=test` 增加 `testMode=connection|tool_roundtrip_json|tool_roundtrip_sse`。默认仍是普通连接；网页新增两个独立闭环按钮与状态，普通连接不认证工具能力。
- 闭环使用唯一合成工具：第一轮必须请求它；返回值含第一轮结束后新生成的随机答案；第二轮须完整原样回答该值，不能再调用工具或截断。没有业务工具执行、查询或投递。JSON 与 SSE 分开测试、分开保存，不自动重试失败或未知模型 POST。
- 两个模型请求保持同一 OpenCode 会话，逐次复核管理员、当前配置版本、派发预算并记录审计。共用配置的任务时限。既有高输出、长上下文、长时限和自由参数不变；配置轮数不足以完成两轮时拒绝宣称闭环通过。
- 能力结果复用 `AiModels.last_test_result`，保存版本化 JSON，不新增表或字段。`model_record.capabilityProbe` 分别提供普通连接、`nonStreaming` 和 `sse` 的通过/失败/未验证/过期状态。模型配置版本或实际参数指纹、适配版本变化即过期；测试期间配置变化不能把结果绑定到新配置。
- 模型删除保护包含所有显式定时任务绑定（含停用任务）及 queued/running/ready/sending 的运行快照模型。快照取文本 ID 后比较，支持普通 ID 列表和模型子查询。已结束历史运行身份继续保留。
- `chat.answer(..., scheduled_analysis={facts,systemPrompt})` 是仅可信内部参数，要求独立钉钉会话、`conversationId=None`。仅本轮事实进入 frames；固定模式不取中央目录、不重查 freshness、不自主选工具，保留原 receipt、预算、审计和权限。该字段不可从公开 body 注入。固定模式返工具调用、截断、空正文或渠道超限均不形成内容就绪；空响应不自动追加付费 finalization。
- 正式模型调用前后均在 AI mutation 外显式执行 `live(receipt.id)`，因此非流式后台调用也复验调度/渠道 guard，包含 reservation 后发生撤销的边界。

## 合成验证

隔离 PostgreSQL 端口 `55468`；仅使用既有 Python 解释器，不读取生产连接/凭据，不改 runtime。socket/TLS/HTTP 被受控替身替代，真实 JSON/SSE 解析、tool frames、配置 API、权限、预算与持久化代码实际执行。

1. 62 项通过，标签：`ai_assistant.test_provider_roundtrip`、`ai_assistant.test_opencode_configuration`、`ai_assistant.test_streaming.ProviderStreamTests`、`ai_assistant.test_provider_endpoint_contract`、`ai_assistant.test_model_capabilities`。覆盖 JSON/SSE × OpenAI/Anthropic 完整闭环、请求头与推理回传、非法第二轮不重放、脱敏诊断、普通文本不能冒充闭环、独立结果、版本失效/测试中配置变化、非管理员拒绝、固定模式独立事实/receipt 去重/撤销与不完整输出失败。日志：[provider-targeted-tests.log](evidence/provider-targeted-tests.log)。
2. 活动快照 ID 改为文本投影后，针对该用例和 `ai_assistant.test_management_controls` 再跑 8 项通过（含一个重复用例）。覆盖模型子查询、ready 运行引用和原历史删除/默认/CAS/活动任务保护。日志：[model-reference-regression.log](evidence/model-reference-regression.log)。
3. AI 设置 TSX 的 esbuild 解析和 `git diff --check` 通过；完整浏览器交互及构建由主交付统一验证。
4. 最后将工具参数被动校验失败的 stage 明确为 `tool_calls`，并增加 NaN、超过深度和原型键负例。`manage.py test ai_assistant.test_provider_roundtrip.ProviderRoundtripWireTests` 的 6 项纯合成传输测试通过（其中 5 项与上轮重复），无数据库访问。日志转录：[provider-argument-bounds-tests.txt](evidence/provider-argument-bounds-tests.txt)。
5. 独立审查追加核验 JSON 终止声明：当前代码在归一化可选 null 后，`finish_reason=tool_calls` 且实际调用为空时以固定 `missing_tool_calls` 失败，不能把正文当成最终结果。补充缺省、null、空数组三种负例，同时验证三种形态的 `finish_reason=stop` 均正常返回；每次均只有一次模型请求。纯合成传输与 SSE 原有解析回归共 17 项通过，无数据库访问。日志：[provider-terminal-boundary-tests.log](evidence/provider-terminal-boundary-tests.log)。本轮未修改主代理在途的配置保护实现。

首轮未执行到测试，因在途 schedule 迁移与已有 0082 形成双叶，已由主代理调整为 0083 继承最新迁移。后续两轮夹具失败分别为错误 target_type、Mock 可变参数断言，以及 TestCase 外层事务令 guard 不执行；修正为有效夹具、派发时深拷贝与 TransactionTestCase 后通过。旧失败日志保留在本 worktree `.runtime/ai-pg-*`，没有将它们改写为通过。

真实 OpenCode/DeepSeek 的非流式与 SSE 能力本轮均**未验证**；任何合成通过都不写入生产模型的能力状态。本轮没有供应商请求、生产配置写入、真实外发、部署或生产迁移。今天第二轮故障的具体响应原因仍须未来经授权的一次新能力测试及脱敏诊断确认，不能重放旧 unknown 请求。
