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

test("AI assistant routes, callbacks, UI, and migrations are wired", async () => {
  const [page, chatRoute, modelsRoute, channelsRoute, webhookRoute, service, visionModel, callbackMigration, visionMigration, guide] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/models/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/channels/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/webhooks/[channelId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/assistant-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_ai_channel_callbacks.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0030_ai_vision_model_capability.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/AI_ASSISTANT_SETUP.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /新增模型配置/);
  assert.match(page, /视觉识别（读取图片）/);
  assert.match(page, /测试图片识别/);
  assert.doesNotMatch(page, /\{ value: "image"/);
  assert.match(page, /新增聊天渠道/);
  assert.match(page, /webhookUrlMasked/);
  assert.match(chatRoute, /requireConversationAccess/);
  assert.match(modelsRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(channelsRoute, /deleteAiChannel/);
  assert.match(webhookRoute, /verifyWeComSignature/);
  assert.match(webhookRoute, /recordAiChannelCallbackEvent/);
  assert.match(service, /redirect: "manual"/);
  assert.match(service, /response\.status >= 300 && response\.status < 400/);
  assert.match(service, /callback_token_encrypted/);
  assert.match(service, /PRAGMA table_info\(ai_channels\)/);
  assert.match(service, /ALTER TABLE ai_channels ADD COLUMN receiver_id/);
  assert.match(service, /probeVisionModelConnection\(model\)/);
  assert.match(service, /WHERE model_type = 'image'/);
  assert.match(service, /const testStillApplies = Boolean\(existing\)/);
  assert.match(visionModel, /VISION_PROBE_IMAGE_BASE64/);
  assert.match(visionModel, /未能识别测试图片/);
  assert.match(callbackMigration, /ai_channel_callback_events/);
  assert.match(visionMigration, /SET\s+`model_type` = 'vision'/);
  assert.match(guide, /AI_SECRET_ENCRYPTION_KEY/);
  assert.match(guide, /仅文本请求成功不能证明模型支持主图识别/);
});
