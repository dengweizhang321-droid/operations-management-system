import { randomUUID } from "node:crypto";

import { ensureAuthorizationSchema, type AppPrincipal } from "@/lib/auth/authorization";
import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import { createDingTalkSignature } from "@/lib/ai/channel-callbacks";
import { maskWebhookUrl, normalizeAiEndpointUrl, resolveAiModelEndpointUrl } from "@/lib/ai/endpoint-security";
import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import {
  executeRegisteredToolCall,
  getAnthropicTools,
  getOpenAiTools,
  type AiToolExecutionContext,
} from "@/lib/ai/tool-registry";
import { recordAiToolAudit } from "@/lib/ai/tool-audit";
import {
  ModelProtocolError,
  runAnthropicToolLoop,
  runOpenAiCompatibleToolLoop,
  type AnthropicMessagesResponse,
  type ConversationTextMessage,
  type OpenAiChatCompletionResponse,
} from "@/lib/ai/tool-loop";

export {
  runAnthropicToolLoop,
  runOpenAiCompatibleToolLoop,
  ToolLoopLimitError,
} from "@/lib/ai/tool-loop";
import { getSalesDatabase, type SalesDatabase } from "@/lib/sales/database";

export { maskWebhookUrl, normalizeAiEndpointUrl } from "@/lib/ai/endpoint-security";

export const aiModelProtocols = ["openai_compatible", "anthropic"] as const;
export type AiModelProtocol = (typeof aiModelProtocols)[number];
export const aiModelTypes = ["text", "image", "vision"] as const;
export type AiModelType = (typeof aiModelTypes)[number];
export const aiModelStatuses = ["enabled", "disabled"] as const;
export type AiModelStatus = (typeof aiModelStatuses)[number];
export const aiChannelKinds = ["dingtalk_group_bot", "dingtalk_app", "wechat_work_group_bot", "wechat_work_app"] as const;
export type AiChannelKind = (typeof aiChannelKinds)[number];
export type AiChannelStatus = "enabled" | "disabled";

export type AiModelRecord = {
  id: string;
  name: string;
  protocol: AiModelProtocol;
  modelType: AiModelType;
  modelName: string;
  baseUrl: string;
  apiKeySuffix: string;
  isDefaultTextModel: boolean;
  status: AiModelStatus;
  lastTestResult: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiChannelRecord = {
  id: string;
  name: string;
  kind: AiChannelKind;
  status: AiChannelStatus;
  sendEnabled: boolean;
  callbackEnabled: boolean;
  /** Never expose the usable webhook URL to the browser. */
  webhookUrlMasked: string;
  callbackTokenMasked: string;
  aesKeyMasked: string;
  receiverId: string;
  lastTestResult: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationRecord = {
  id: string;
  title: string;
  modelId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AiModelInput = {
  id?: string;
  name: string;
  protocol: AiModelProtocol;
  modelType: AiModelType;
  modelName: string;
  baseUrl: string;
  apiKey?: string;
  status: AiModelStatus;
  isDefaultTextModel?: boolean;
};

export type AiChannelInput = {
  id?: string;
  name: string;
  kind: AiChannelKind;
  status: AiChannelStatus;
  sendEnabled: boolean;
  callbackEnabled: boolean;
  /** Required for a new channel; blank on an edit preserves the existing value. */
  webhookUrl?: string;
  /** DingTalk signing secret or the provider callback token. */
  callbackToken?: string;
  /** Enterprise WeChat EncodingAESKey when an inbound callback is enabled. */
  aesKey?: string;
  /** Enterprise WeChat CorpID / suite ID used to validate the decrypted envelope. */
  receiverId?: string;
};

export type AiChannelSecret = {
  id: string;
  kind: AiChannelKind;
  status: AiChannelStatus;
  sendEnabled: boolean;
  callbackEnabled: boolean;
  webhookUrl: string;
  callbackTokenEncrypted: string;
  callbackTokenSuffix: string;
  aesKeyEncrypted: string;
  aesKeySuffix: string;
  receiverId: string;
};

type AiModelRow = {
  id: string;
  name: string;
  protocol: string;
  model_type: string;
  model_name: string;
  base_url: string;
  api_key_encrypted: string;
  api_key_suffix: string;
  is_default_text_model: number;
  status: string;
  last_test_result: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
};

type AiChannelRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  send_enabled: number;
  callback_enabled: number;
  webhook_url: string;
  callback_token_encrypted: string;
  callback_token_suffix: string;
  aes_key_encrypted: string;
  aes_key_suffix: string;
  receiver_id: string;
  last_test_result: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
};

type AiConversationRow = {
  id: string;
  title: string;
  model_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type AiConversationMessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS ai_models (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('openai_compatible', 'anthropic')),
    model_type TEXT NOT NULL CHECK (model_type IN ('text', 'image', 'vision')),
    model_name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_key_suffix TEXT NOT NULL DEFAULT '',
    is_default_text_model INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
    last_test_result TEXT,
    last_tested_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_models_default_text_uq
    ON ai_models (is_default_text_model)
    WHERE is_default_text_model = 1 AND status = 'enabled' AND model_type = 'text'`,
  `CREATE INDEX IF NOT EXISTS ai_models_status_idx
    ON ai_models (status, model_type, updated_at)`,
  `CREATE TABLE IF NOT EXISTS ai_channels (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('dingtalk_group_bot', 'dingtalk_app', 'wechat_work_group_bot', 'wechat_work_app')),
    status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
    send_enabled INTEGER NOT NULL DEFAULT 0,
    callback_enabled INTEGER NOT NULL DEFAULT 0,
    webhook_url TEXT NOT NULL DEFAULT '',
    callback_token_encrypted TEXT NOT NULL DEFAULT '',
    callback_token_suffix TEXT NOT NULL DEFAULT '',
    aes_key_encrypted TEXT NOT NULL DEFAULT '',
    aes_key_suffix TEXT NOT NULL DEFAULT '',
    receiver_id TEXT NOT NULL DEFAULT '',
    last_test_result TEXT,
    last_tested_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_channels_status_idx
    ON ai_channels (status, kind, updated_at)`,
  `CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    model_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_conversations_creator_updated_idx
    ON ai_conversations (created_by, updated_at)`,
  `CREATE TABLE IF NOT EXISTS ai_conversation_messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_conversation_messages_conversation_idx
    ON ai_conversation_messages (conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_system_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ai_channel_callback_events (
    id TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, event_key)
  )`,
  `CREATE INDEX IF NOT EXISTS ai_channel_callback_events_received_idx
    ON ai_channel_callback_events (channel_id, received_at)`,
] as const;

const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();
const MODEL_REQUEST_TIMEOUT_MS = 20_000;
const CHANNEL_REQUEST_TIMEOUT_MS = 15_000;
const MAX_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 12_000;

export async function ensureAiAssistantSchema(db: SalesDatabase = getSalesDatabase()): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;

  const setup = ensureAuthorizationSchema(db)
    .then(() => db.batch(schemaStatements.map((statement) => db.prepare(statement))))
    .then(async () => {
      const columns = await db.prepare("PRAGMA table_info(ai_channels)").all<{ name: string }>();
      const names = new Set((columns.results ?? []).map((column) => column.name));
      if (!names.has("receiver_id")) {
        await db.prepare("ALTER TABLE ai_channels ADD COLUMN receiver_id TEXT NOT NULL DEFAULT ''").run();
      }
    })
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReadyByDatabase.delete(key);
      throw error;
    });

  schemaReadyByDatabase.set(key, setup);
  return setup;
}

export async function listAiModels(db: SalesDatabase = getSalesDatabase()): Promise<AiModelRecord[]> {
  await ensureAiAssistantSchema(db);
  const rows = await db.prepare(
    `SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, is_default_text_model,
            status, last_test_result, last_tested_at, created_at, updated_at
     FROM ai_models
     ORDER BY is_default_text_model DESC, status DESC, updated_at DESC`,
  ).all<AiModelRow>();
  return (rows.results ?? []).map(mapAiModelRecord);
}

export async function upsertAiModel(input: AiModelInput, db: SalesDatabase = getSalesDatabase()): Promise<AiModelRecord> {
  await ensureAiAssistantSchema(db);
  const normalized = normalizeAiModelInput(input);
  const id = normalized.id ?? `ai-model-${randomUUID()}`;
  const existing = normalized.id ? await getAiModelSecretById(id, db) : null;
  const apiKeyEncrypted = normalized.apiKey ? await encryptSecret(normalized.apiKey) : existing?.api_key_encrypted ?? "";
  const apiKeySuffix = normalized.apiKey ? maskSuffix(normalized.apiKey) : existing?.api_key_suffix ?? "";
  if (normalized.isDefaultTextModel && normalized.modelType === "text" && normalized.status === "enabled") {
    await db.prepare("UPDATE ai_models SET is_default_text_model = 0 WHERE model_type = 'text'").run();
  }
  await db.prepare(
    `INSERT INTO ai_models (id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, is_default_text_model, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       protocol = excluded.protocol,
       model_type = excluded.model_type,
       model_name = excluded.model_name,
       base_url = excluded.base_url,
       api_key_encrypted = excluded.api_key_encrypted,
       api_key_suffix = excluded.api_key_suffix,
       is_default_text_model = excluded.is_default_text_model,
       status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(id, normalized.name, normalized.protocol, normalized.modelType, normalized.modelName, normalized.baseUrl, apiKeyEncrypted, apiKeySuffix, normalized.isDefaultTextModel ? 1 : 0, normalized.status).run();
  const row = await getAiModelSecretById(id, db);
  if (!row) throw new Error("模型配置保存后无法读取");
  return mapAiModelRecord(row);
}

export async function deleteAiModel(id: string, db: SalesDatabase = getSalesDatabase()): Promise<boolean> {
  await ensureAiAssistantSchema(db);
  const result = await db.prepare("DELETE FROM ai_models WHERE id = ?").bind(id).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function listAiChannels(db: SalesDatabase = getSalesDatabase()): Promise<AiChannelRecord[]> {
  await ensureAiAssistantSchema(db);
  const rows = await db.prepare(
    `SELECT id, name, kind, status, send_enabled, callback_enabled, webhook_url, callback_token_encrypted, callback_token_suffix,
            aes_key_encrypted, aes_key_suffix, receiver_id, last_test_result, last_tested_at, created_at, updated_at
     FROM ai_channels
     ORDER BY updated_at DESC`,
  ).all<AiChannelRow>();
  return (rows.results ?? []).map(mapAiChannelRecord);
}

export async function upsertAiChannel(input: AiChannelInput, db: SalesDatabase = getSalesDatabase()): Promise<AiChannelRecord> {
  await ensureAiAssistantSchema(db);
  const normalized = normalizeAiChannelInput(input);
  const id = normalized.id ?? `ai-channel-${randomUUID()}`;
  const existing = normalized.id ? await getAiChannelSecretById(id, db) : null;
  if (normalized.id && !existing) throw new Error("渠道配置不存在");
  const webhookUrl = normalized.webhookUrl ? normalizeAiEndpointUrl(normalized.webhookUrl, "channel") : existing?.webhookUrl ?? "";
  const requiresWebhook = normalized.kind === "dingtalk_group_bot" || normalized.kind === "wechat_work_group_bot" || normalized.sendEnabled;
  if (!webhookUrl && requiresWebhook) throw new Error("启用发送或配置群机器人时必须填写 Webhook 地址");
  const callbackTokenEncrypted = normalized.callbackToken ? await encryptSecret(normalized.callbackToken) : existing?.callbackTokenEncrypted ?? "";
  const aesKeyEncrypted = normalized.aesKey ? await encryptSecret(normalized.aesKey) : existing?.aesKeyEncrypted ?? "";
  const callbackTokenSuffix = normalized.callbackToken ? maskSuffix(normalized.callbackToken) : existing?.callbackTokenSuffix ?? "";
  const aesKeySuffix = normalized.aesKey ? maskSuffix(normalized.aesKey) : existing?.aesKeySuffix ?? "";
  const receiverId = normalized.receiverId || existing?.receiverId || "";
  await db.prepare(
    `INSERT INTO ai_channels (id, name, kind, status, send_enabled, callback_enabled, webhook_url, callback_token_encrypted, callback_token_suffix, aes_key_encrypted, aes_key_suffix, receiver_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       status = excluded.status,
       send_enabled = excluded.send_enabled,
       callback_enabled = excluded.callback_enabled,
       webhook_url = excluded.webhook_url,
       callback_token_encrypted = excluded.callback_token_encrypted,
       callback_token_suffix = excluded.callback_token_suffix,
       aes_key_encrypted = excluded.aes_key_encrypted,
       aes_key_suffix = excluded.aes_key_suffix,
       receiver_id = excluded.receiver_id,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(id, normalized.name, normalized.kind, normalized.status, normalized.sendEnabled ? 1 : 0, normalized.callbackEnabled ? 1 : 0, webhookUrl, callbackTokenEncrypted, callbackTokenSuffix, aesKeyEncrypted, aesKeySuffix, receiverId).run();
  const row = await getAiChannelRowById(id, db);
  if (!row) throw new Error("渠道配置保存后无法读取");
  return mapAiChannelRecord(row);
}

export async function deleteAiChannel(id: string, db: SalesDatabase = getSalesDatabase()): Promise<boolean> {
  await ensureAiAssistantSchema(db);
  const result = await db.prepare("DELETE FROM ai_channels WHERE id = ?").bind(id).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function getAiChannelSecretById(id: string, db: SalesDatabase = getSalesDatabase()): Promise<AiChannelSecret | null> {
  const row = await getAiChannelRowById(id, db);
  if (!row) return null;
  return {
    id: row.id,
    kind: asChannelKind(row.kind),
    status: asChannelStatus(row.status),
    sendEnabled: Boolean(row.send_enabled),
    callbackEnabled: Boolean(row.callback_enabled),
    webhookUrl: row.webhook_url,
    callbackTokenEncrypted: row.callback_token_encrypted,
    callbackTokenSuffix: row.callback_token_suffix,
    aesKeyEncrypted: row.aes_key_encrypted,
    aesKeySuffix: row.aes_key_suffix,
    receiverId: row.receiver_id,
  };
}

export async function listAiConversations(principal: AppPrincipal, db: SalesDatabase = getSalesDatabase()): Promise<AiConversationRecord[]> {
  await ensureAiAssistantSchema(db);
  const rows = await db.prepare(
    "SELECT id, title, model_id, created_by, created_at, updated_at FROM ai_conversations ORDER BY updated_at DESC",
  ).all<AiConversationRow>();
  return (rows.results ?? [])
    .map(mapConversationRecord)
    .filter((row) => principal.role === "admin" || row.createdBy === principal.email);
}

export async function createConversation(title: string, createdBy: string, modelId: string | null, db: SalesDatabase = getSalesDatabase()): Promise<string> {
  await ensureAiAssistantSchema(db);
  const id = `ai-conv-${randomUUID()}`;
  await db.prepare("INSERT INTO ai_conversations (id, title, model_id, created_by) VALUES (?, ?, ?, ?)")
    .bind(id, normalizeText(title, "新对话", 120), modelId, createdBy).run();
  return id;
}

export async function appendConversationMessage(conversationId: string, role: "user" | "assistant", content: string, db: SalesDatabase = getSalesDatabase()): Promise<string> {
  await ensureAiAssistantSchema(db);
  const normalizedContent = normalizeText(content, "", MAX_MESSAGE_LENGTH);
  if (!normalizedContent) throw new Error("消息不能为空");
  const id = `ai-msg-${randomUUID()}`;
  await db.batch([
    db.prepare("INSERT INTO ai_conversation_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").bind(id, conversationId, role, normalizedContent),
    db.prepare("UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(conversationId),
  ]);
  return id;
}

export async function requireConversationAccess(conversationId: string, principal: AppPrincipal, db: SalesDatabase = getSalesDatabase()): Promise<AiConversationRecord> {
  await ensureAiAssistantSchema(db);
  const row = await db.prepare("SELECT id, title, model_id, created_by, created_at, updated_at FROM ai_conversations WHERE id = ? LIMIT 1")
    .bind(conversationId).first<AiConversationRow>();
  if (!row) throw new Error("对话不存在");
  const conversation = mapConversationRecord(row);
  if (principal.role !== "admin" && conversation.createdBy !== principal.email) throw new Error("无权访问该对话");
  return conversation;
}

export async function listConversationMessages(conversationId: string, principal: AppPrincipal, db: SalesDatabase = getSalesDatabase()): Promise<AiConversationMessage[]> {
  await requireConversationAccess(conversationId, principal, db);
  return listConversationMessagesInternal(conversationId, db);
}

export async function recordAiChannelCallbackEvent(input: { channelId: string; eventKey: string; payloadDigest: string }, db: SalesDatabase = getSalesDatabase()): Promise<boolean> {
  await ensureAiAssistantSchema(db);
  const result = await db.prepare(
    `INSERT INTO ai_channel_callback_events (id, channel_id, event_key, payload_digest)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id, event_key) DO NOTHING`,
  ).bind(`ai-event-${randomUUID()}`, input.channelId, input.eventKey.slice(0, 300), input.payloadDigest.slice(0, 128)).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function resolveChatModel(db: SalesDatabase = getSalesDatabase()): Promise<AiModelRow | null> {
  await ensureAiAssistantSchema(db);
  const defaultModel = await db.prepare(
    "SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, is_default_text_model, status, last_test_result, last_tested_at, created_at, updated_at FROM ai_models WHERE model_type = 'text' AND status = 'enabled' AND is_default_text_model = 1 LIMIT 1",
  ).first<AiModelRow>();
  if (defaultModel) return defaultModel;
  return db.prepare(
    "SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, is_default_text_model, status, last_test_result, last_tested_at, created_at, updated_at FROM ai_models WHERE model_type = 'text' AND status = 'enabled' ORDER BY updated_at DESC LIMIT 1",
  ).first<AiModelRow>();
}

export async function testAiModelConnection(modelId: string, db: SalesDatabase = getSalesDatabase()): Promise<{ ok: true; message: string }> {
  const model = await getAiModelSecretById(modelId, db);
  if (!model) throw new Error("模型不存在");
  try {
    if (!model.base_url || !model.api_key_encrypted) throw new Error("模型地址或 API Key 未配置");
    const reply = model.protocol === "anthropic"
      ? await callAnthropicModel(model, [{ role: "user", content: "仅回复 OK" }])
      : await callOpenAiCompatibleModel(model, [{ role: "user", content: "仅回复 OK" }]);
    await setModelTestResult(modelId, `连接成功：${reply.slice(0, 80)}`, db);
    return { ok: true, message: "模型连接成功" };
  } catch (error) {
    await setModelTestResult(modelId, `连接失败：${safeErrorMessage(error)}`, db);
    throw error;
  }
}

export async function sendAiChannelText(channelId: string, content: string, db: SalesDatabase = getSalesDatabase()): Promise<{ ok: true; message: string }> {
  const channel = await getAiChannelSecretById(channelId, db);
  if (!channel) throw new Error("渠道不存在");
  if (channel.status !== "enabled") throw new Error("渠道已停用");
  if (!channel.sendEnabled) throw new Error("渠道未启用消息发送");
  if (channel.kind !== "dingtalk_group_bot" && channel.kind !== "wechat_work_group_bot") {
    throw new Error("当前仅支持钉钉和企业微信的群机器人 Webhook 发送；应用型渠道需补充应用凭据后启用");
  }

  let endpoint = normalizeAiEndpointUrl(channel.webhookUrl, "channel");
  const text = normalizeText(content, "", 4_000);
  if (!text) throw new Error("发送内容不能为空");
  if (channel.kind === "dingtalk_group_bot" && channel.callbackTokenEncrypted) {
    const secret = await decryptSecret(channel.callbackTokenEncrypted);
    if (secret) {
      const timestamp = Date.now().toString();
      const signedUrl = new URL(endpoint);
      signedUrl.searchParams.set("timestamp", timestamp);
      signedUrl.searchParams.set("sign", await createDingTalkSignature(timestamp, secret));
      endpoint = signedUrl.toString();
    }
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text } }),
  }, CHANNEL_REQUEST_TIMEOUT_MS);
  const responseText = await response.text();
  const providerResult = parseProviderResult(responseText);
  if (!response.ok || !isSuccessfulChannelResponse(providerResult)) {
    throw new Error(`渠道调用失败${providerErrorSuffix(response.status, providerResult)}`);
  }
  return { ok: true, message: "渠道消息已发送" };
}

export async function testAiChannelConnection(channelId: string, db: SalesDatabase = getSalesDatabase()): Promise<{ ok: true; message: string }> {
  try {
    const result = await sendAiChannelText(channelId, "TERUISI AI 助理渠道连接测试", db);
    await setChannelTestResult(channelId, "连接成功", db);
    return result;
  } catch (error) {
    await setChannelTestResult(channelId, `连接失败：${safeErrorMessage(error)}`, db);
    throw error;
  }
}

export async function generateAssistantReply(input: {
  prompt: string;
  principal: AppPrincipal;
  conversationId: string;
  model: AiModelRow;
  requestId?: string;
  surface?: AiToolExecutionContext["surface"];
}, db: SalesDatabase = getSalesDatabase()): Promise<string> {
  const startedAt = Date.now();
  const requestId = input.requestId ?? `ai-chat-${randomUUID()}`;
  const surface = input.surface ?? "ai_chat";
  try {
    const messages = await listConversationMessagesInternal(input.conversationId, db, 24);
    const toolContext: AiToolExecutionContext = {
      principal: input.principal,
      requestId,
      surface,
    };
    const reply = input.model.protocol === "anthropic"
      ? await callAnthropicModelWithTools(input.model, messages, toolContext)
      : await callOpenAiCompatibleModelWithTools(input.model, messages, toolContext);
    if (!reply) throw new Error("模型未返回内容");
    await appendConversationMessage(input.conversationId, "assistant", reply, db);
    await recordAiToolAudit({
      requestId,
      actorEmail: input.principal.email,
      actorRole: input.principal.role,
      surface,
      toolName: "chat_message",
      arguments: { prompt: input.prompt.slice(0, 240) },
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      result: { reply },
    });
    return reply;
  } catch (error) {
    await recordAiToolAudit({
      requestId,
      actorEmail: input.principal.email,
      actorRole: input.principal.role,
      surface,
      toolName: "chat_message",
      arguments: { prompt: input.prompt.slice(0, 240) },
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: "ai_model_error",
    });
    throw error;
  }
}

export async function generateConfiguredAnalysisReply(input: {
  prompt: string;
  principal: AppPrincipal;
  requestId: string;
  auditArguments: Record<string, unknown>;
}, db: SalesDatabase = getSalesDatabase()): Promise<string> {
  const startedAt = Date.now();
  const model = await resolveChatModel(db);
  if (!model) throw new Error("尚未配置可用的文本模型");
  const auditBase = {
    requestId: input.requestId,
    actorEmail: input.principal.email,
    actorRole: input.principal.role,
    surface: "customer_service_ai",
    toolName: "analyze_customer_service_conversations",
    arguments: input.auditArguments,
  } as const;
  await recordAiToolAudit({ ...auditBase, status: "started", durationMs: 0 });
  try {
    const messages = [{ role: "user" as const, content: input.prompt }];
    const reply = model.protocol === "anthropic"
      ? await callAnthropicModel(model, messages)
      : await callOpenAiCompatibleModel(model, messages);
    if (!reply) throw new Error("模型未返回分析结果");
    await recordAiToolAudit({ ...auditBase, status: "succeeded", durationMs: Date.now() - startedAt, result: { returned: 1, modelId: model.id, responseCharacters: reply.length } });
    return reply;
  } catch (error) {
    await recordAiToolAudit({ ...auditBase, status: "failed", durationMs: Date.now() - startedAt, errorCode: "customer_service_analysis_failed" });
    throw error;
  }
}

async function getAiModelSecretById(id: string, db: SalesDatabase): Promise<AiModelRow | null> {
  await ensureAiAssistantSchema(db);
  return db.prepare(
    "SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, api_key_suffix, is_default_text_model, status, last_test_result, last_tested_at, created_at, updated_at FROM ai_models WHERE id = ? LIMIT 1",
  ).bind(id).first<AiModelRow>();
}

async function getAiChannelRowById(id: string, db: SalesDatabase): Promise<AiChannelRow | null> {
  await ensureAiAssistantSchema(db);
  return db.prepare(
    "SELECT id, name, kind, status, send_enabled, callback_enabled, webhook_url, callback_token_encrypted, callback_token_suffix, aes_key_encrypted, aes_key_suffix, receiver_id, last_test_result, last_tested_at, created_at, updated_at FROM ai_channels WHERE id = ? LIMIT 1",
  ).bind(id).first<AiChannelRow>();
}

async function listConversationMessagesInternal(conversationId: string, db: SalesDatabase, limit?: number): Promise<AiConversationMessage[]> {
  await ensureAiAssistantSchema(db);
  const rows = limit
    ? await db.prepare(
      "SELECT id, conversation_id, role, content, created_at FROM ai_conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
    ).bind(conversationId, limit).all<AiConversationMessageRow>()
    : await db.prepare(
      "SELECT id, conversation_id, role, content, created_at FROM ai_conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC",
    ).bind(conversationId).all<AiConversationMessageRow>();
  const mapped = (rows.results ?? []).map(mapConversationMessage);
  return limit ? mapped.reverse() : mapped;
}

async function callOpenAiCompatibleModel(model: AiModelRow, messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<string> {
  const apiKey = await decryptSecret(model.api_key_encrypted);
  if (!apiKey) throw new Error("模型 API Key 未配置");
  const { response, data: rawData } = await fetchBoundedJson({
    url: resolveAiModelEndpointUrl(model.base_url, "openai_compatible"),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model.model_name, messages, temperature: 0.2 }),
    },
    timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
  });
  const data = rawData as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`模型调用失败: ${response.status}${data?.error?.message ? ` · ${data.error.message.slice(0, 160)}` : ""}`);
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callOpenAiCompatibleModelWithTools(
  model: AiModelRow,
  messages: ConversationTextMessage[],
  context: AiToolExecutionContext,
): Promise<string> {
  const apiKey = await decryptSecret(model.api_key_encrypted);
  if (!apiKey) throw new Error("模型 API Key 未配置");
  return runOpenAiCompatibleToolLoop({
    messages,
    tools: getOpenAiTools(context.principal),
    executeTool: (name, rawArguments) => executeRegisteredToolCall(name, rawArguments, context),
    request: async (body) => {
      const { response, data: rawData } = await fetchBoundedJson({
        url: resolveAiModelEndpointUrl(model.base_url, "openai_compatible"),
        init: {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: model.model_name, ...body, temperature: 0.2 }),
        },
        timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
      });
      const data = rawData as (OpenAiChatCompletionResponse & { error?: { message?: string } }) | null;
      if (!response.ok) throw new Error(`模型调用失败: ${response.status}${data?.error?.message ? ` · ${data.error.message.slice(0, 160)}` : ""}`);
      if (!data) throw new ModelProtocolError("OpenAI-compatible 响应不是有效 JSON");
      return data;
    },
  });
}

async function callAnthropicModel(model: AiModelRow, messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<string> {
  const apiKey = await decryptSecret(model.api_key_encrypted);
  if (!apiKey) throw new Error("模型 API Key 未配置");
  const { response, data: rawData } = await fetchBoundedJson({
    url: resolveAiModelEndpointUrl(model.base_url, "anthropic"),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: model.model_name,
        max_tokens: 512,
        messages: messages.map((message) => ({ role: message.role, content: [{ type: "text", text: message.content }] })),
      }),
    },
    timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
  });
  const data = rawData as { content?: Array<{ text?: string }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`模型调用失败: ${response.status}${data?.error?.message ? ` · ${data.error.message.slice(0, 160)}` : ""}`);
  return data?.content?.map((item) => item.text ?? "").join("").trim() || "";
}

async function callAnthropicModelWithTools(
  model: AiModelRow,
  messages: ConversationTextMessage[],
  context: AiToolExecutionContext,
): Promise<string> {
  const apiKey = await decryptSecret(model.api_key_encrypted);
  if (!apiKey) throw new Error("模型 API Key 未配置");
  return runAnthropicToolLoop({
    messages,
    tools: getAnthropicTools(context.principal),
    executeTool: (name, rawArguments) => executeRegisteredToolCall(name, rawArguments, context),
    request: async (body) => {
      const { response, data: rawData } = await fetchBoundedJson({
        url: resolveAiModelEndpointUrl(model.base_url, "anthropic"),
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: model.model_name, max_tokens: 1_024, ...body }),
        },
        timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
      });
      const data = rawData as (AnthropicMessagesResponse & { error?: { message?: string } }) | null;
      if (!response.ok) throw new Error(`模型调用失败: ${response.status}${data?.error?.message ? ` · ${data.error.message.slice(0, 160)}` : ""}`);
      if (!data) throw new ModelProtocolError("Anthropic 响应不是有效 JSON");
      return data;
    },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("接口地址返回了重定向，请填写最终的 HTTPS 接口地址");
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("连接超时，请检查平台地址和网络");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAiModelInput(input: AiModelInput): Required<Omit<AiModelInput, "id" | "apiKey">> & Pick<AiModelInput, "id" | "apiKey"> {
  const protocol = asModelProtocol(input.protocol);
  const modelType = asModelType(input.modelType);
  const status = asModelStatus(input.status);
  const name = normalizeText(input.name, "", MAX_NAME_LENGTH);
  const modelName = normalizeText(input.modelName, "", MAX_NAME_LENGTH);
  if (!name || !modelName) throw new Error("模型名称和模型标识不能为空");
  const apiKey = input.apiKey?.trim() || undefined;
  return {
    id: optionalId(input.id),
    name,
    protocol,
    modelType,
    modelName,
    baseUrl: normalizeAiEndpointUrl(input.baseUrl, "model"),
    apiKey,
    status,
    isDefaultTextModel: Boolean(input.isDefaultTextModel),
  };
}

function normalizeAiChannelInput(input: AiChannelInput): Required<Omit<AiChannelInput, "id" | "webhookUrl" | "callbackToken" | "aesKey" | "receiverId">> & Pick<AiChannelInput, "id" | "webhookUrl" | "callbackToken" | "aesKey" | "receiverId"> {
  const name = normalizeText(input.name, "", MAX_NAME_LENGTH);
  if (!name) throw new Error("渠道名称不能为空");
  const kind = asChannelKind(input.kind);
  const status = asChannelStatus(input.status);
  const supportsWebhookSend = kind === "dingtalk_group_bot" || kind === "wechat_work_group_bot";
  if (input.sendEnabled && !supportsWebhookSend) throw new Error("当前应用型渠道仅支持安全回调，不支持通过 Webhook 主动发送");
  if (input.callbackEnabled && kind !== "wechat_work_app") throw new Error("当前仅支持企业微信应用回调；钉钉和企业微信机器人用于主动发送消息");
  return {
    id: optionalId(input.id),
    name,
    kind,
    status,
    sendEnabled: Boolean(input.sendEnabled),
    callbackEnabled: Boolean(input.callbackEnabled),
    webhookUrl: input.webhookUrl?.trim() || undefined,
    callbackToken: input.callbackToken?.trim() || undefined,
    aesKey: input.aesKey?.trim() || undefined,
    receiverId: normalizeText(input.receiverId ?? "", "", 160) || undefined,
  };
}

function mapAiModelRecord(row: AiModelRow): AiModelRecord {
  return {
    id: row.id,
    name: row.name,
    protocol: asModelProtocol(row.protocol),
    modelType: asModelType(row.model_type),
    modelName: row.model_name,
    baseUrl: row.base_url,
    apiKeySuffix: row.api_key_suffix,
    isDefaultTextModel: Boolean(row.is_default_text_model),
    status: asModelStatus(row.status),
    lastTestResult: row.last_test_result,
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAiChannelRecord(row: AiChannelRow): AiChannelRecord {
  return {
    id: row.id,
    name: row.name,
    kind: asChannelKind(row.kind),
    status: asChannelStatus(row.status),
    sendEnabled: Boolean(row.send_enabled),
    callbackEnabled: Boolean(row.callback_enabled),
    webhookUrlMasked: maskWebhookUrl(row.webhook_url),
    callbackTokenMasked: row.callback_token_suffix || "未配置",
    aesKeyMasked: row.aes_key_suffix || "未配置",
    receiverId: row.receiver_id,
    lastTestResult: row.last_test_result,
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationRecord(row: AiConversationRow): AiConversationRecord {
  return { id: row.id, title: row.title, modelId: row.model_id, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapConversationMessage(row: AiConversationMessageRow): AiConversationMessage {
  return { id: row.id, conversationId: row.conversation_id, role: row.role === "assistant" ? "assistant" : "user", content: row.content, createdAt: row.created_at };
}

function asModelProtocol(value: unknown): AiModelProtocol {
  if (aiModelProtocols.includes(value as AiModelProtocol)) return value as AiModelProtocol;
  throw new Error("模型协议无效");
}

function asModelType(value: unknown): AiModelType {
  if (aiModelTypes.includes(value as AiModelType)) return value as AiModelType;
  throw new Error("模型类型无效");
}

function asModelStatus(value: unknown): AiModelStatus {
  if (aiModelStatuses.includes(value as AiModelStatus)) return value as AiModelStatus;
  throw new Error("模型状态无效");
}

function asChannelKind(value: unknown): AiChannelKind {
  if (aiChannelKinds.includes(value as AiChannelKind)) return value as AiChannelKind;
  throw new Error("渠道类型无效");
}

function asChannelStatus(value: unknown): AiChannelStatus {
  if (value === "enabled" || value === "disabled") return value;
  throw new Error("渠道状态无效");
}

function normalizeText(value: string, fallback: string, limit: number): string {
  const text = value.trim().replace(/\s+/g, " ").slice(0, limit);
  return text || fallback;
}

function optionalId(value: string | undefined): string | undefined {
  const id = value?.trim();
  if (!id) return undefined;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("配置 ID 格式无效");
  return id;
}

function maskSuffix(value: string): string {
  return value ? `••••${value.slice(-4)}` : "";
}

async function setModelTestResult(id: string, result: string, db: SalesDatabase): Promise<void> {
  await db.prepare("UPDATE ai_models SET last_test_result = ?, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(result.slice(0, 300), id).run();
}

async function setChannelTestResult(id: string, result: string, db: SalesDatabase): Promise<void> {
  await db.prepare("UPDATE ai_channels SET last_test_result = ?, last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(result.slice(0, 300), id).run();
}

function parseProviderResult(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isSuccessfulChannelResponse(result: Record<string, unknown> | null): boolean {
  if (!result) return true;
  if (typeof result.errcode === "number") return result.errcode === 0;
  if (typeof result.code === "number") return result.code === 0 || result.code === 200;
  if (typeof result.success === "boolean") return result.success;
  return true;
}

function providerErrorSuffix(status: number, result: Record<string, unknown> | null): string {
  const message = result && typeof result.errmsg === "string" ? result.errmsg : result && typeof result.message === "string" ? result.message : "";
  return `（HTTP ${status}${message ? ` · ${message.slice(0, 160)}` : ""}）`;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "未知错误").replace(/\s+/g, " ").slice(0, 220);
}
