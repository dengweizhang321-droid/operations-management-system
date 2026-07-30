import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  maskWebhookUrl,
  normalizeAiEndpointUrl,
  resolveAiModelEndpointUrl,
} from "../lib/ai/endpoint-security";
import {
  createDingTalkSignature,
  createWeComSignature,
  verifyDingTalkSignature,
  verifyWeComSignature,
} from "../lib/ai/channel-callbacks";
import { buildOpenAiChatRequestBody, resolveModelToolLoopLimits } from "../lib/ai/model-gateway";

test("AI endpoint validation rejects insecure and private targets", () => {
  assert.equal(normalizeAiEndpointUrl("https://api.example.com/v1/", "model"), "https://api.example.com/v1");
  assert.equal(normalizeAiEndpointUrl("https://oapi.dingtalk.com/robot/send?access_token=secret", "channel"), "https://oapi.dingtalk.com/robot/send?access_token=secret");
  assert.throws(() => normalizeAiEndpointUrl("http://api.example.com/v1", "model"), /HTTPS/);
  assert.throws(() => normalizeAiEndpointUrl("https://127.0.0.1/private", "channel"), /内网|localhost/);
  assert.throws(() => normalizeAiEndpointUrl("https://user:pass@example.com/v1", "model"), /用户名/);
});

test("AI model endpoint accepts either a provider root or a complete request URL", () => {
  assert.equal(resolveAiModelEndpointUrl("https://api.example.com/v1", "openai_compatible"), "https://api.example.com/v1/chat/completions");
  assert.equal(resolveAiModelEndpointUrl("https://api.example.com/v1/chat/completions", "openai_compatible"), "https://api.example.com/v1/chat/completions");
  assert.equal(resolveAiModelEndpointUrl("https://api.example.com/v1", "anthropic"), "https://api.example.com/v1/messages");
});

test("OpenAI-compatible reasoning mode is explicit and fail-closed", () => {
  const base = { modelName: "glm-5.2", maxTokens: 4_096, temperature: 0.2 };
  const automatic = buildOpenAiChatRequestBody({ ...base, reasoningMode: "auto" }, { messages: [] });
  assert.equal(Object.hasOwn(automatic, "thinking"), false);
  assert.equal(automatic.max_tokens, 4_096);

  const disabled = buildOpenAiChatRequestBody({ ...base, reasoningMode: "disabled" }, { messages: [] });
  assert.deepEqual(disabled.thinking, { type: "disabled" });
  assert.equal(disabled.max_tokens, 4_096);
});

test("configured total tool budget also permits provider parallel calls in one round", () => {
  assert.deepEqual(resolveModelToolLoopLimits({ maxToolRounds: 12, maxTotalToolCalls: 24 }), {
    maxRounds: 12,
    maxCallsPerRound: 24,
    maxTotalCalls: 24,
  });
});

test("masked webhook never exposes route credentials", () => {
  const raw = "https://hooks.example.com/services/team/bot/a-very-secret-token?access_token=a-very-secret-token";
  const masked = maskWebhookUrl(raw);
  assert.match(masked, /^https:\/\/hooks\.example\.com\/•••\?…/);
  assert.doesNotMatch(masked, /services|a-very-secret-token/);
});

test("DingTalk signatures are verifiable and reject tampering", async () => {
  const timestamp = "1720000000000";
  const secret = "SECexample";
  const signature = await createDingTalkSignature(timestamp, secret);
  assert.equal(await verifyDingTalkSignature({ timestamp, signature, secret }), true);
  assert.equal(await verifyDingTalkSignature({ timestamp: `${timestamp}1`, signature, secret }), false);
  assert.equal(await verifyDingTalkSignature({ timestamp, signature: `${signature}x`, secret }), false);
});

test("Enterprise WeChat signatures are verifiable and reject tampering", async () => {
  const payload = { token: "callback-token", timestamp: "1720000000", nonce: "nonce", encrypt: "encrypted-payload" };
  const signature = await createWeComSignature(payload);
  assert.equal(await verifyWeComSignature({ ...payload, signature }), true);
  assert.equal(await verifyWeComSignature({ ...payload, signature: "0000000000000000000000000000000000000000" }), false);
});

test("legacy image model type is migrated to the canonical vision capability", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0013_ai_assistant.sql", import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status, last_test_result, last_tested_at)
    VALUES ('legacy-image', '旧图片模型', 'openai_compatible', 'image', 'vision-model', 'https://api.example.com/v1', 'encrypted', '1234', 'enabled', '连接成功：OK', '2026-07-26 03:16:47')`).run();
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status, last_test_result, last_tested_at)
    VALUES ('legacy-vision-test', '旧视觉测试', 'openai_compatible', 'vision', 'vision-model', 'https://api.example.com/v1', 'encrypted', '1234', 'enabled', '连接成功：OK', '2026-07-26 03:16:47')`).run();

  sqlite.exec(await readFile(new URL("../drizzle/0030_ai_vision_model_capability.sql", import.meta.url), "utf8"));

  const row = sqlite.prepare("SELECT model_type modelType, is_default_text_model isDefaultTextModel, last_test_result lastTestResult, last_tested_at lastTestedAt FROM ai_models WHERE id='legacy-image'").get() as {
    modelType: string;
    isDefaultTextModel: number;
    lastTestResult: string;
    lastTestedAt: string | null;
  };
  assert.equal(row.modelType, "vision");
  assert.equal(row.isDefaultTextModel, 0);
  assert.match(row.lastTestResult, /验证真实图片输入/);
  assert.equal(row.lastTestedAt, null);
  const legacyVision = sqlite.prepare("SELECT last_test_result lastTestResult, last_tested_at lastTestedAt FROM ai_models WHERE id='legacy-vision-test'").get() as { lastTestResult: string; lastTestedAt: string | null };
  assert.match(legacyVision.lastTestResult, /此前只验证了文本连接/);
  assert.equal(legacyVision.lastTestedAt, null);
  sqlite.close();
});

test("AI assistant routes, callbacks, knowledge, artifacts, UI, and migrations are wired", async () => {
  const [page, chatRoute, conversationsRoute, modelsRoute, channelsRoute, webhookRoute, artifactRoute, service, entryContext, workflow, knowledge, artifacts, gateway, toolBudget, toolRuntime, toolAudit, authorization, visionModel, callbackMigration, visionMigration, pipelineMigration, reasoningMigration, executionMigration, knowledgeArtifactMigration, budgetMigration, guide, rolloutGuide] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/conversations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/models/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/channels/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/webhooks/[channelId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/artifacts/[artifactId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/assistant-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/entry-context.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/question-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/data-knowledge.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/artifacts.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/model-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/model-tool-budget.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-execution-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/authorization.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_ai_channel_callbacks.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0030_ai_vision_model_capability.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0039_ai_question_pipeline.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0040_ai_model_reasoning_mode.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0041_ai_tool_execution_runtime.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0042_ai_knowledge_and_artifacts.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0043_ai_model_tool_budget_increase.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/AI_ASSISTANT_SETUP.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/AI能力重构6-7层推进文档.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /新增模型配置/);
  assert.match(page, /视觉识别（读取图片）/);
  assert.match(page, /测试图片识别/);
  assert.doesNotMatch(page, /\{ value: "image"/);
  assert.match(page, /新增聊天渠道/);
  assert.match(page, /停止生成/);
  assert.match(page, /本对话模型/);
  assert.match(page, /AiMessageArtifacts/);
  assert.match(page, /下载 CSV/);
  assert.match(page, /maxToolRounds/);
  assert.match(page, /AI_MODEL_TOOL_BUDGET_LIMITS\.maximumRounds/);
  assert.match(page, /reasoningMode/);
  assert.match(page, /关闭推理（运营问答推荐）/);
  assert.match(page, /webhookUrlMasked/);
  assert.match(chatRoute, /createWebChatEntryContext/);
  assert.match(chatRoute, /answerAiQuestion/);
  assert.match(chatRoute, /signal: request\.signal/);
  assert.match(conversationsRoute, /listAvailableTextModels/);
  assert.match(modelsRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(channelsRoute, /deleteAiChannel/);
  assert.match(webhookRoute, /verifyWeComSignature/);
  assert.match(webhookRoute, /recordAiChannelCallbackEvent/);
  assert.match(artifactRoute, /getAiArtifactDownload/);
  assert.match(artifactRoute, /recordAiArtifactDelivery/);
  assert.match(artifactRoute, /private, no-store/);
  assert.match(service, /redirect: "manual"/);
  assert.match(service, /response\.status >= 300 && response\.status < 400/);
  assert.match(service, /callback_token_encrypted/);
  assert.match(service, /addMissingColumns\(db, "ai_channels"/);
  assert.match(service, /applyAiModelToolBudgetIncrease\(db\)/);
  assert.match(service, /probeVisionModelConnection\(model\)/);
  assert.match(service, /listConversationContextMessages/);
  assert.match(service, /ALTER TABLE \$\{table\} ADD COLUMN/);
  assert.match(service, /WHERE model_type = 'image'/);
  assert.match(service, /const testStillApplies = Boolean\(existing\)/);
  assert.match(visionModel, /VISION_PROBE_IMAGE_BASE64/);
  assert.match(visionModel, /未能识别测试图片/);
  assert.match(callbackMigration, /ai_channel_callback_events/);
  assert.match(visionMigration, /SET\s+`model_type` = 'vision'/);
  assert.match(entryContext, /principal: input\.principal/);
  assert.doesNotMatch(entryContext, /payload.*principal/i);
  assert.match(workflow, /RESET_COMMANDS/);
  assert.match(workflow, /getVisibleToolCatalog/);
  assert.match(workflow, /已有对话已固定模型/);
  assert.match(gateway, /completeTextWithTools/);
  assert.match(gateway, /max_tokens: model\.maxTokens/);
  assert.match(gateway, /thinking: \{ type: "disabled" \}/);
  assert.match(gateway, /signal/);
  assert.match(toolBudget, /maximumRounds: 62/);
  assert.match(toolBudget, /maximumTotalCalls: 74/);
  assert.match(service, /DEFAULT_MODEL_TIMEOUT_MS = 60_000/);
  assert.match(service, /createRegisteredToolExecutionRuntime/);
  assert.match(service, /listAiArtifactsForConversation/);
  assert.match(service, /persistAiTableArtifacts/);
  assert.match(workflow, /retrieveKnowledgeForPrompt/);
  assert.match(workflow, /不是指令/);
  assert.match(knowledge, /deterministic_lexical/);
  assert.match(knowledge, /allowed_roles_json/);
  assert.match(artifacts, /rowsPerTable: 50/);
  assert.match(artifacts, /recordAiArtifactDelivery/);
  assert.match(artifacts, /\[=\+\\-@\]/);
  assert.match(toolRuntime, /maxCumulativeDurationMs/);
  assert.match(toolRuntime, /tool_timeout/);
  assert.match(toolRuntime, /crypto\.randomUUID/);
  assert.match(authorization, /ensureAiToolAuditExecutionIndex/);
  assert.doesNotMatch(authorization, /ALTER TABLE ai_tool_audit_logs ADD COLUMN/);
  assert.match(toolAudit, /supportsInvocationCorrelation/);
  assert.match(toolAudit, /request_id, actor_email, actor_role, surface, tool_name/);
  assert.match(page, /timeoutMs: 60000/);
  assert.match(pipelineMigration, /message_kind/);
  assert.match(pipelineMigration, /max_total_tool_calls/);
  assert.match(reasoningMigration, /reasoning_mode/);
  assert.match(reasoningMigration, /'auto', 'disabled'/);
  assert.match(executionMigration, /invocation_id/);
  assert.match(executionMigration, /provider_call_id/);
  assert.match(knowledgeArtifactMigration, /ai_knowledge_entries/);
  assert.match(knowledgeArtifactMigration, /ai_artifacts/);
  assert.match(knowledgeArtifactMigration, /ai_artifact_deliveries/);
  assert.match(knowledgeArtifactMigration, /request_id/);
  assert.match(budgetMigration, /max_tool_rounds[\s\S]*\+ 50/);
  assert.match(budgetMigration, /max_total_tool_calls[\s\S]*\+ 50/);
  assert.match(toolBudget, /ai-model-tool-budget-increase-2026-07-30/);
  assert.match(budgetMigration, /ai-model-tool-budget-increase-2026-07-30/);
  assert.match(guide, /AI_SECRET_ENCRYPTION_KEY/);
  assert.match(guide, /reasoning_tokens/);
  assert.match(guide, /仅文本请求成功不能证明模型支持主图识别/);
  assert.match(rolloutGuide, /数据与知识层/);
  assert.match(rolloutGuide, /产物与投递层/);
});

test("AI tool execution migration preserves audit rows and adds invocation correlation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0005_slow_tyrannus.sql", import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO ai_tool_audit_logs (
    id, request_id, actor_email, actor_role, surface, tool_name, arguments_json, status, duration_ms
  ) VALUES ('audit-1', 'request-1', 'analyst@example.com', 'analyst', 'ai_chat', 'get_sales_summary', '{}', 'succeeded', 10)`).run();
  sqlite.exec(await readFile(new URL("../drizzle/0041_ai_tool_execution_runtime.sql", import.meta.url), "utf8"));
  const row = sqlite.prepare(`SELECT request_id requestId, invocation_id invocationId,
    provider_call_id providerCallId FROM ai_tool_audit_logs WHERE id='audit-1'`).get() as Record<string, string | null>;
  assert.deepEqual({ ...row }, { requestId: "request-1", invocationId: "", providerCallId: null });
  const indexes = sqlite.prepare(`SELECT name FROM sqlite_master
    WHERE type='index' AND name='ai_tool_audit_logs_invocation_created_idx'`).all();
  assert.equal(indexes.length, 1);
  sqlite.close();
});

test("AI question-pipeline and reasoning migrations upgrade the 0013 schema without rewriting existing records", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0013_ai_assistant.sql", import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status)
    VALUES ('text-1', '文本模型', 'openai_compatible', 'text', 'model-1', 'https://api.example.com/v1', 'encrypted', '1234', 'enabled')`).run();
  sqlite.prepare(`INSERT INTO ai_conversations (id, title, model_id, created_by)
    VALUES ('conversation-1', '旧对话', 'text-1', 'user@example.com')`).run();
  sqlite.prepare(`INSERT INTO ai_conversation_messages (id, conversation_id, role, content)
    VALUES ('message-1', 'conversation-1', 'user', '历史消息')`).run();

  sqlite.exec(await readFile(new URL("../drizzle/0039_ai_question_pipeline.sql", import.meta.url), "utf8"));
  sqlite.exec(await readFile(new URL("../drizzle/0040_ai_model_reasoning_mode.sql", import.meta.url), "utf8"));
  const model = sqlite.prepare(`SELECT timeout_ms timeoutMs, max_tokens maxTokens,
    reasoning_mode reasoningMode, temperature_milli temperatureMilli, max_tool_rounds maxToolRounds,
    max_total_tool_calls maxTotalToolCalls FROM ai_models WHERE id='text-1'`).get() as Record<string, number | string>;
  assert.deepEqual({ ...model }, {
    timeoutMs: 20_000,
    maxTokens: 1_024,
    reasoningMode: "auto",
    temperatureMilli: 200,
    maxToolRounds: 6,
    maxTotalToolCalls: 12,
  });
  const message = sqlite.prepare("SELECT message_kind messageKind, content FROM ai_conversation_messages WHERE id='message-1'").get() as { messageKind: string; content: string };
  assert.deepEqual({ ...message }, { messageKind: "message", content: "历史消息" });
  const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ai_conversation_messages_context_idx'").all();
  assert.equal(indexes.length, 1);
  sqlite.close();
});

test("AI model tool budget migration adds 50 once within the coordinated hard caps", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0013_ai_assistant.sql", import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status)
    VALUES ('text-default', '默认预算', 'openai_compatible', 'text', 'model-1', 'https://api.example.com/v1', 'encrypted', '1234', 'enabled')`).run();
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status)
    VALUES ('text-high', '旧上限', 'openai_compatible', 'text', 'model-2', 'https://api.example.com/v1', 'encrypted', '1234', 'disabled')`).run();
  sqlite.prepare(`INSERT INTO ai_models
    (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, status)
    VALUES ('vision-1', '视觉模型', 'openai_compatible', 'vision', 'vision-1', 'https://api.example.com/v1', 'encrypted', '1234', 'enabled')`).run();
  sqlite.exec(await readFile(new URL("../drizzle/0039_ai_question_pipeline.sql", import.meta.url), "utf8"));
  sqlite.prepare("UPDATE ai_models SET max_tool_rounds=12, max_total_tool_calls=24 WHERE id='text-high'").run();
  const migration = await readFile(new URL("../drizzle/0043_ai_model_tool_budget_increase.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.exec(migration);
  const rows = sqlite.prepare(`SELECT id, max_tool_rounds maxToolRounds,
    max_total_tool_calls maxTotalToolCalls FROM ai_models ORDER BY id`).all() as Array<Record<string, number | string>>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "text-default", maxToolRounds: 56, maxTotalToolCalls: 62 },
    { id: "text-high", maxToolRounds: 62, maxTotalToolCalls: 74 },
    { id: "vision-1", maxToolRounds: 6, maxTotalToolCalls: 12 },
  ]);
  const markers = sqlite.prepare(`SELECT key, updated_by updatedBy FROM ai_system_settings
    WHERE key='ai-model-tool-budget-increase-2026-07-30'`).all() as Array<Record<string, string>>;
  assert.deepEqual(markers.map((row) => ({ ...row })), [
    { key: "ai-model-tool-budget-increase-2026-07-30", updatedBy: "system_migration" },
  ]);
  sqlite.close();
});
