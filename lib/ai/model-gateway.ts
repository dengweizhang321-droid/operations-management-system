import { decryptSecret } from "@/lib/ai/crypto";
import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import { resolveAiModelEndpointUrl } from "@/lib/ai/endpoint-security";
import { throwIfAiRequestCancelled } from "@/lib/ai/cancellation";
import {
  ModelProtocolError,
  runAnthropicToolLoop,
  runOpenAiCompatibleToolLoop,
  type AnthropicMessagesResponse,
  type ConversationTextMessage,
  type OpenAiChatCompletionResponse,
  type ProviderToolDefinition,
  type ProviderToolCallMetadata,
  type ToolExecutionResult,
} from "@/lib/ai/tool-loop";

export type AiTextModelRuntimeConfig = {
  id: string;
  name: string;
  protocol: "openai_compatible" | "anthropic";
  modelName: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  timeoutMs: number;
  maxTokens: number;
  reasoningMode: "auto" | "disabled";
  temperature: number;
  maxToolRounds: number;
  maxTotalToolCalls: number;
};

export async function completeText(input: {
  model: AiTextModelRuntimeConfig;
  messages: ConversationTextMessage[];
  systemPrompt?: string;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfAiRequestCancelled(input.signal);
  const apiKey = await requireModelApiKey(input.model);
  return input.model.protocol === "anthropic"
    ? completeAnthropicText({ ...input, apiKey })
    : completeOpenAiText({ ...input, apiKey });
}

export async function completeTextWithTools(input: {
  model: AiTextModelRuntimeConfig;
  messages: ConversationTextMessage[];
  systemPrompt: string;
  tools: ProviderToolDefinition[];
  executeTool: (name: string, rawArguments: unknown, metadata: ProviderToolCallMetadata) => Promise<ToolExecutionResult>;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfAiRequestCancelled(input.signal);
  const apiKey = await requireModelApiKey(input.model);
  const limits = {
    maxRounds: input.model.maxToolRounds,
    maxCallsPerRound: Math.min(4, input.model.maxTotalToolCalls),
    maxTotalCalls: input.model.maxTotalToolCalls,
  };
  if (input.model.protocol === "anthropic") {
    return runAnthropicToolLoop({
      messages: input.messages,
      tools: input.tools,
      executeTool: input.executeTool,
      systemPrompt: input.systemPrompt,
      signal: input.signal,
      limits,
      request: async (body) => requestAnthropic(input.model, apiKey, body, input.signal),
    });
  }
  return runOpenAiCompatibleToolLoop({
    messages: input.messages,
    tools: input.tools,
    executeTool: input.executeTool,
    systemPrompt: input.systemPrompt,
    signal: input.signal,
    limits,
    request: async (body) => requestOpenAi(input.model, apiKey, body, input.signal),
  });
}

async function completeOpenAiText(input: {
  model: AiTextModelRuntimeConfig;
  messages: ConversationTextMessage[];
  systemPrompt?: string;
  signal?: AbortSignal;
  apiKey: string;
}): Promise<string> {
  const data = await requestOpenAi(input.model, input.apiKey, {
    messages: [
      ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
      ...input.messages,
    ],
  }, input.signal);
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function completeAnthropicText(input: {
  model: AiTextModelRuntimeConfig;
  messages: ConversationTextMessage[];
  systemPrompt?: string;
  signal?: AbortSignal;
  apiKey: string;
}): Promise<string> {
  const data = await requestAnthropic(input.model, input.apiKey, {
    ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
    messages: input.messages.map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.content }],
    })),
  }, input.signal);
  return (data.content ?? [])
    .map((block) => block.type === "text" ? block.text : "")
    .join("")
    .trim();
}

async function requestOpenAi(
  model: AiTextModelRuntimeConfig,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OpenAiChatCompletionResponse> {
  const { response, data: rawData } = await fetchBoundedJson({
    url: resolveAiModelEndpointUrl(model.baseUrl, "openai_compatible"),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildOpenAiChatRequestBody(model, body)),
    },
    timeoutMs: model.timeoutMs,
    signal,
  });
  const data = rawData as (OpenAiChatCompletionResponse & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(providerFailure("模型调用失败", response.status, data?.error?.message));
  if (!data) throw new ModelProtocolError("OpenAI-compatible 响应不是有效 JSON");
  return data;
}

export function buildOpenAiChatRequestBody(
  model: Pick<AiTextModelRuntimeConfig, "modelName" | "maxTokens" | "reasoningMode" | "temperature">,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    model: model.modelName,
    ...body,
    ...(model.reasoningMode === "disabled" ? { thinking: { type: "disabled" } } : {}),
    max_tokens: model.maxTokens,
    temperature: model.temperature,
  };
}

async function requestAnthropic(
  model: AiTextModelRuntimeConfig,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AnthropicMessagesResponse> {
  const { response, data: rawData } = await fetchBoundedJson({
    url: resolveAiModelEndpointUrl(model.baseUrl, "anthropic"),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model.modelName,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
        ...body,
      }),
    },
    timeoutMs: model.timeoutMs,
    signal,
  });
  const data = rawData as (AnthropicMessagesResponse & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(providerFailure("模型调用失败", response.status, data?.error?.message));
  if (!data) throw new ModelProtocolError("Anthropic 响应不是有效 JSON");
  return data;
}

async function requireModelApiKey(model: AiTextModelRuntimeConfig): Promise<string> {
  const apiKey = await decryptSecret(model.apiKeyEncrypted);
  if (!apiKey) throw new Error("模型 API Key 未配置");
  return apiKey;
}

function providerFailure(prefix: string, status: number, message?: string): string {
  const safeMessage = message
    ?.replace(/\s+/g, " ")
    .replace(/\b(sk-|key-)[A-Za-z0-9_-]{8,}\b/gi, "$1…")
    .replace(/(authorization\s*[:=]?\s*bearer\s+)\S+/gi, "$1…")
    .replace(/(api[_ -]?key\s*[:=]\s*)\S+/gi, "$1…")
    .slice(0, 160);
  return `${prefix}: ${status}${safeMessage ? ` · ${safeMessage}` : ""}`;
}
