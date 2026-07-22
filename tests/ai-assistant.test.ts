import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  maskWebhookUrl,
  normalizeAiEndpointUrl,
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

test("AI assistant routes, callbacks, UI, and migrations are wired", async () => {
  const [page, chatRoute, modelsRoute, channelsRoute, webhookRoute, service, callbackMigration, guide] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/models/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/channels/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/webhooks/[channelId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/assistant-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_ai_channel_callbacks.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/AI_ASSISTANT_SETUP.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /新增模型配置/);
  assert.match(page, /新增聊天渠道/);
  assert.match(page, /webhookUrlMasked/);
  assert.match(chatRoute, /requireConversationAccess/);
  assert.match(modelsRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(channelsRoute, /deleteAiChannel/);
  assert.match(webhookRoute, /verifyWeComSignature/);
  assert.match(webhookRoute, /recordAiChannelCallbackEvent/);
  assert.match(service, /redirect: "error"/);
  assert.match(service, /callback_token_encrypted/);
  assert.match(callbackMigration, /ai_channel_callback_events/);
  assert.match(guide, /AI_SECRET_ENCRYPTION_KEY/);
});
