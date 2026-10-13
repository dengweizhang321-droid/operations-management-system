# Agnes 流式统计尾帧兼容修复

2026-10-13（Asia/Shanghai）。用户报告“模型流式响应无效或未完整结束，本次请求未自动重试”。截图和原对话元数据都指向默认“特能志 · 文本分析” / agnes-2.5-flash，不是 OpenCode Go；不更换密钥或默认模型。

## 复现与原因

原公开模型连接探针以 JSON 返回文本连接成功；使用同一配置、新 clientRequestId 和独立通用提示词的网页流式诊断，在收到三个 delta 后 failure，errorCode=invalid_provider_response。用户旧请求和诊断失败记录保持，不重发结果未确认的旧请求。

随后使用原受保护 AI 运行环境、实际公开接口确认的管理员 principal、原 dispatch_budget 与追加式 model_stream_diagnostic 审计，执行一次独立通用流式探针。仅在诊断进程内观察原 ProviderStream，未修改服务器代码；只保存白名单结构字段、枚举和计数，不保存密钥、模型正文、推理或工具参数，也未复制生产凭据至开发目录。

结构轨迹明确显示：正常内容 delta → finish_reason=stop → 单 choice、空 delta、finish_reason=null、usage 对象。当前 openai() 在 reason 已设置后无条件拒绝单 choice，因此把纯用量统计尾帧当成追加生成内容；原标准空 choices 用量帧已支持。不是账户或模型名称问题，也不把通用 SSE 错误解释为网络已断开。

## 修复与验证

仅在已经收到合法终止原因后，允许单 choice / 空 delta / null finish_reason / usage 对象的纯统计帧，保留原 finish_reason、正文、推理和工具调用。仍要求 [DONE] 与完整 UTF-8；结束后文字、推理、工具参数、重复终止原因、无 usage 的选择帧和缺失结束标记继续拒绝。没有新增自动重试、JSON 回退或模型名称启发式。

原 Stream、传输、OpenCode、工具预算及 AI 领域回归 90 项：89 通过、1 跳过。新增测试覆盖真实统计尾帧、工具调用保留、缺 [DONE] 和结束后非法内容的拒绝。Django check、迁移 dry-run 无变化、backend 编译和差异检查通过。开发后远端另有无关发布工具/吉客云提交，正常合并到最新 main，没有改写历史；AI 修复字节不变。

在独立诊断进程中，仅加载开发解析器、其余沿用同一安装环境和相同通用提示词，真实供应商返回完整成功：8280ms、6 个公共文字字符、usage 尾帧后收到 [DONE]、done=true、finish_reason=stop、pendingBytes=0。此为开发解析器的真实协议验证，不冒充已安装服务或网页多轮经营问数验收；不重复用户的“昨天销售”旧请求。

源码提交 658b453d58d11703bcea50dfceb7b30458bdaf5c，经 978706c0cbb775e2d452200e2f2ba26da0a6875e 合并到远端 main。精确正式候选 c4cc438baa5876e333476fc31a04878651058670 基于当前安装来源 c1df9357，只增加 parser 与其回归测试两文件，逐文件安装投影核对其他 backend 与全部迁移不变，不夹带 main 中吉客云或发布工具候选。

## 交付与采用范围

范围计划 3b2ed3f17c84e489b7cf3aa19c80ff41c444e20d8d3f3216c41c21b9f1e8aafd：仅 Django、无 migration、无未知路径。当前正式前驱 manifest 08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92。

候选准备在生产在线期间执行原 PrepareApp，没有维护、停止、部署、迁移、默认模型修改或旧请求重放。准备收据与最后状态见同目录 CANDIDATE.md。正式采用须取得本次流式修复上线授权，沿原唯一生命周期控制器短时应用维护、保留 PostgreSQL，恢复常态普通用户运行与监控方式；上线检查用新独立流式请求，原未知请求保留。

证据保存在 D:/codex-artifacts/agnes-stream-20261013：STRUCTURE.json 为旧解析失败结构，PATCHED_STRUCTURE.json 为新解析真实成功结构；原诊断与回归日志均保留。没有保存真实经营数据、API 密钥或供应商回复正文。
