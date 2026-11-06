# OpenAI Responses 本地历史适配

模型设置中选择 OpenAI 兼容，再将“OpenAI 请求协议”设为 Responses。实际端点须支持 `/responses`。Skill 提炼还需显式声明支持正文 JSON Schema。现有未选 Responses 的模型继续走原协议。

Django 在每轮发送系统指令和本地构造的 input。请求固定 `store: false`，不传 conversation 或 previous_response_id。工具结果以 call_id 与原调用配对，需推理连续性时在本地传递加密 reasoning item。业务历史由现行 TERUISI 会话、作业和权限机制管理。应用不请求供应商托管会话、后台任务、文件搜索或平台写工具。此设置表达客户端请求，不代替供应商自身的数据保留政策。

支持文本、视觉输入、登记工具、结构化正文和公开文字 SSE；终态不完整的工具调用、未知输出项、流片段与终态不一致会报错。市场标注的独立 Worker 适配器不使用 Responses 模型，避免误走聊天补全。无生产模型配置变更或外部模型调用。

官方语义依据：[Responses 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) · [会话状态](https://developers.openai.com/api/docs/guides/conversation-state)。

验证使用模拟供应商和隔离应用库。新增五项协议回归覆盖无供应商会话、加密推理及工具回放、视觉与 schema、公开流终态、拒绝托管工具和截断调用、旧配置兼容。
