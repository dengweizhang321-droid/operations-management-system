# 市场 AI 标注第一轮阻断修复：视觉适配子任务 B

共同开发基线：`b8cbdd435e12970d572328978f352f5ce1605830`。独立分支：`codex/market-ai-blockers-vision-20261014`。本报告仅记录 B 的源码和隔离测试交付；总控负责组合候选、真实模型账本、完整数据库链路、合并与制品。

## 修改与共享契约

- Django runner 把服务端领取返回的 `task.jobId` 传入 `runVisionAnnotation` 的内部 `jobId` 参数。仅精确 `https://opencode.ai/zen/go/v1/chat/completions` 使用会话头，SHA-256 输入为 `xiaote/session/v1/market/job/<jobId>`，客户端为真实应用标识 `xiaote-market/1.0`。同计划跨图片/尝试稳定，不同计划隔离；配置测试使用独立 `market/probe/<UUID>` 命名空间，任务身份缺失时拒绝发送，不伪造计划。
- OpenAI 请求直接复用现有 `buildOpenAiChatRequestBody` 和端点安全解析。仅市场视觉抽取指定 `reasoningMode=disabled`，保留 A 的 600、B 的 320 token 上限；原配置行、通用助理参数和文本 Prompt 生成参数不变。Anthropic 保留一个强制结构化工具，不开启思考。
- A 仍一图一次同时分类和价格；B 仍只提供固定分类和价格抽取提示。完整响应必须满足正常结束状态、非空正文、唯一结果、严格 JSON 与 schema 字段/类型、分类和价格枚举、显式 null、置信度及“明确无标价”证据校验。原图片哈希读取/回退保护保持。
- HTTP 200 本身不再认作成功。OpenAI `finish_reason=length`、非 `stop`、空正文、错误信封和异常 choices 被拒绝；Anthropic `max_tokens`、非 `tool_use`、错误或多个工具结果被拒绝。
- 已确认缺会话、无效模型、结构化输出/思考参数不支持、无效安全端点或凭据配置错误映射现有 `model_configuration`。普通 400、单图错误、429 和已完整收到的暂态 HTTP 故障分别分类；HTTP 200 内明确协议拒绝也按配置错误处理。
- 已进入 POST 但请求/响应流中断、超时或因响应安全上限未完整读取，采用现有 `inference_result_unknown` / `failureKind=unknown`；不重发模型请求。完整读取后的空正文、输出 token 截断及 schema 无效属于已知无效 `model_response`。数据库回写只重用同一结果与幂等请求 ID；存储失败不重新推理，不降格成识别失败。
- 公共 `complete_task` 字段未增加：成功使用 `result.timing`；失败使用顶层 `error/failureCode/failureKind/retryAfterMs/timing`。内部错误包装保留明确 failureCode、HTTP status 和 Retry-After。timing 仍为五个已有键，成功/失败阶段都记录单调时钟耗时；理由最长 300 字符，供应商详情最长 180，隐藏凭据、URL 和内联图片。

没有修改 `backend/market/`、`lib/ai/`、正式分类字典、已保存 Prompt 或模型配置。

## 当前验证

首版 `8c20c4d7` 的以下命令在 B worktree 执行，结果 **126 tests / 126 pass / 0 fail / 0 skipped**，完整输出见 [定向测试](evidence/targeted-tests.log)，源码摘要见 [源绑定](evidence/source-binding.json)。后续真实对照引出的协议补修见文末。

```powershell
node --import tsx --test tests/market-vision-adapter.test.ts tests/market-annotation-runner.test.ts tests/market-annotation-dispatch.test.ts tests/market-annotation-cached-image.test.ts tests/market-annotation.test.ts
npx eslint lib/market/annotation-model.ts lib/market/annotation-failure.ts lib/market/django-annotation-runner.ts tests/market-vision-adapter.test.ts tests/market-annotation-runner.test.ts tests/market-annotation.test.ts
git diff --check
```

范围 lint 与差异空白检查通过。新增测试走实际 `runVisionAnnotation`、实际共同请求 builder 与端点解析，在取图、配置读取、解密、HTTP transport 边界使用合成替身，捕获真正适配器生成的请求；不是仅调用通用连接测试。覆盖 A/B 单图单调用、稳定会话和隔离、精确端点限制、配置不变、思考关闭、严格响应/价格/null、协议错误与普通400区分、限流、已发出未知结果、响应上限、阶段 timing、Anthropic 工具结果，以及 runner 的失败/timing 信封。现有缓存测试另覆盖实际哈希变化拒绝和安全回退；现有 dispatch/runner 测试覆盖回写确认丢失且不再次调用模型。

首轮新增用例暴露两项错误：英文 image 诊断未被分类；“图片身份已变化”先命中了授权失败正则。已调整图像诊断优先级，且已知 429 仍先按限流处理。首轮失败保留在工具执行记录，未把之后通过回填为首次通过。

## 未执行和剩余问题

B 子任务真实付费模型调用 **0 次**。没有生产读取配置之外的真实模型请求、生产 ANALYZE、正式任务恢复、正式标注写入、服务操作、main 合并、制品准备或部署。真实适配和完整数据库链路须由总控在绑定最终候选的隔离样本验证；本测试不宣称生产吞吐或分类业务准确率。

净水 Prompt 规则与正式分类枚举的业务冲突保持原状，建议业务确认唯一字典后再统一规则和金标样本。创建计划批量查询优化留第二轮。完整响应异常是已知失败；不能完整读回则保持未知隔离，剩余授权额度不用于自动重放未知请求。

## 真实对照后的 JSON Mode 补修

总控以组合候选实际适配器发出 12 次隔离样本请求，均得到明确 HTTP 400，新增有效结果为 0，既有账本累计 32/50。供应商给出 `invalid_request_error` 和 `This response_format type is unavailable now`，首版分类未识别该诊断，落为 `annotation_failed`。这些失败保持原记录，不能用先前历史成功替代本候选通过；原私有 trace 保留在总控的受限证据目录，不复制样本数据至仓库。

补修把字段明确不可用（`unavailable` / `not available`）归为 `model_configuration`，同样覆盖 HTTP 200 错误信封。普通单图、未知 400 和限流分类保留。

[DeepSeek 官方 JSON Mode](https://api-docs.deepseek.com/guides/json_mode/) 指定 Chat Completions 的 `response_format.type=json_object`，并要求输入明确指示 JSON 格式。基于该协议与本次实际拒绝，仅当精确 OpenCode Go Chat Completions endpoint 与 `model_name=deepseek-v4.1-flash` 同时匹配时，适配器直接选择 JSON-object。单次请求临时附加技术 JSON 输出/schema 约束；B 的 schema 仍只有一个固定分类。正式保存的业务 Prompt、字典和模型配置不改。其他路由或模型保持 json_schema；不做协议失败后的自动回退，不重发原模型请求。

供应商 JSON-object 只约束 JSON 语法，本地严格 schema 字段、分类枚举、价格类型、数字/null、置信度、正常结束与空正文校验继续执行。技术协议适配不代表分类业务准确率验收。

补修版定向 **129 tests / 129 pass / 0 fail / 0 skipped**，范围 ESLint、`git diff --check` 通过。[当前定向日志](evidence/json-mode-targeted-tests.log)和[当前源绑定](evidence/json-mode-source-binding.json)独立保留，首版证据不覆盖。新增实际适配器测试捕获精确模式选择、其他 route/model 维持 schema、A/B 技术 schema 约束和上述 unavailable 的暂停分类。B 仍发出真实模型请求 0 次；本补修组合候选的真实模型结果由总控另行记录。
