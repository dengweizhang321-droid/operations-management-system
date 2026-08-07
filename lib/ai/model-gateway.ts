import { decryptSecret } from "@/lib/ai/crypto";
import { BoundedFetchError, fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import { resolveAiModelEndpointUrl } from "@/lib/ai/endpoint-security";
import { throwIfAiRequestCancelled } from "@/lib/ai/cancellation";
import { compatibleFallbackModels } from "@/lib/ai/model-resilience";
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

export const AI_MODEL_RETRY_LIMITS = {
  maxAttemptsPerModel: 3,
  baseDelayMs: 250,
  maximumDelayMs: 2_000,
  maximumRetryAfterMs: 5_000,
} as const;

export type ModelAttemptResult = {
  outcome: "succeeded" | "failed" | "cancelled";
  attempt: number;
  fallbackIndex: number;
  durationMs: number;
  retryable: boolean;
  retryDelayMs: number;
  errorCode?: string;
};

export type ModelAttemptObserver = {
  beforeAttempt?: (
    model: AiTextModelRuntimeConfig,
    attempt: number,
    fallbackIndex: number,
  ) => Promise<{ allowed: boolean; reason?: string; context?: unknown }>;
  afterAttempt?: (
    model: AiTextModelRuntimeConfig,
    result: ModelAttemptResult,
    context?: unknown,
  ) => Promise<void>;
};

export type ModelRetryPolicy = {
  maxAttemptsPerModel: number;
  baseDelayMs: number;
  maximumDelayMs: number;
  maximumRetryAfterMs: number;
};

export class AiModelRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "AiModelRequestError";
  }
}

export async function completeText(input: {
  model: AiTextModelRuntimeConfig;
  fallbackModels?: readonly AiTextModelRuntimeConfig[];
  messages: ConversationTextMessage[];
  systemPrompt?: string;
  signal?: AbortSignal;
  observer?: ModelAttemptObserver;
  retryPolicy?: Partial<ModelRetryPolicy>;
}): Promise<string> {
  throwIfAiRequestCancelled(input.signal);
  const keys = modelKeyResolver();
  const fallbacks = compatibleFallbackModels(input.model, input.fallbackModels);
  const response = await executeModelRequestWithResilience({
    primaryModel: input.model,
    fallbackModels: fallbacks,
    signal: input.signal,
    observer: input.observer,
    retryPolicy: input.retryPolicy,
    request: async (model) => model.protocol === "anthropic"
      ? requestAnthropic(model, await keys.get(model), {
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        messages: input.messages.map((message) => ({
          role: message.role,
          content: [{ type: "text", text: message.content }],
        })),
      }, input.signal)
      : requestOpenAi(model, await keys.get(model), {
        messages: [
          ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
          ...input.messages,
        ],
      }, input.signal),
  });
  if (input.model.protocol === "anthropic") {
    const data = response as AnthropicMessagesResponse;
    return (data.content ?? []).map((block) => block.type === "text" ? block.text : "").join("").trim();
  }
  const data = response as OpenAiChatCompletionResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function completeTextWithTools(input: {
  model: AiTextModelRuntimeConfig;
  fallbackModels?: readonly AiTextModelRuntimeConfig[];
  messages: ConversationTextMessage[];
  systemPrompt: string;
  tools: ProviderToolDefinition[];
  executeTool: (name: string, rawArguments: unknown, metadata: ProviderToolCallMetadata) => Promise<ToolExecutionResult>;
  signal?: AbortSignal;
  observer?: ModelAttemptObserver;
  retryPolicy?: Partial<ModelRetryPolicy>;
}): Promise<string> {
  throwIfAiRequestCancelled(input.signal);
  const keys = modelKeyResolver();
  const fallbacks = compatibleFallbackModels(input.model, input.fallbackModels);
  const limits = resolveModelToolLoopLimits(input.model);
  if (input.model.protocol === "anthropic") {
    return runAnthropicToolLoop({
      messages: input.messages,
      tools: input.tools,
      executeTool: input.executeTool,
      systemPrompt: input.systemPrompt,
      signal: input.signal,
      limits,
      request: async (body) => executeModelRequestWithResilience({
        primaryModel: input.model,
        fallbackModels: fallbacks,
        signal: input.signal,
        observer: input.observer,
        retryPolicy: input.retryPolicy,
        request: async (model) => requestAnthropic(model, await keys.get(model), body, input.signal),
      }),
    });
  }
  return runOpenAiCompatibleToolLoop({
    messages: input.messages,
    tools: input.tools,
    executeTool: input.executeTool,
    systemPrompt: input.systemPrompt,
    signal: input.signal,
    limits,
    request: async (body) => executeModelRequestWithResilience({
      primaryModel: input.model,
      fallbackModels: fallbacks,
      signal: input.signal,
      observer: input.observer,
      retryPolicy: input.retryPolicy,
      request: async (model) => requestOpenAi(model, await keys.get(model), body, input.signal),
    }),
  });
}

export function resolveModelToolLoopLimits(
  model: Pick<AiTextModelRuntimeConfig, "maxToolRounds" | "maxTotalToolCalls">,
) {
  return {
    maxRounds: model.maxToolRounds,
    // A provider may efficiently request several independent reads in one
    // response. Do not impose the former fixed limit of four; the configured
    // total-call budget, runtime duration, per-tool caps and cancellation still
    // provide bounded execution and loop protection.
    maxCallsPerRound: model.maxTotalToolCalls,
    maxTotalCalls: model.maxTotalToolCalls,
  };
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
  if (!response.ok) throw providerRequestError(response, data?.error?.message);
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
  if (!response.ok) throw providerRequestError(response, data?.error?.message);
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

export async function executeModelRequestWithResilience<T>(input: {
  primaryModel: AiTextModelRuntimeConfig;
  fallbackModels?: readonly AiTextModelRuntimeConfig[];
  request: (model: AiTextModelRuntimeConfig) => Promise<T>;
  signal?: AbortSignal;
  observer?: ModelAttemptObserver;
  retryPolicy?: Partial<ModelRetryPolicy>;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}): Promise<T> {
  const policy = normalizeRetryPolicy(input.retryPolicy);
  const models = [input.primaryModel, ...compatibleFallbackModels(input.primaryModel, input.fallbackModels)];
  let lastError: unknown = new AiModelRequestError("model_unavailable", "没有可用的兼容模型");
  for (let fallbackIndex = 0; fallbackIndex < models.length; fallbackIndex += 1) {
    const model = models[fallbackIndex];
    for (let attempt = 1; attempt <= policy.maxAttemptsPerModel; attempt += 1) {
      throwIfAiRequestCancelled(input.signal);
      const before = await safeBeforeAttempt(input.observer, model, attempt, fallbackIndex);
      if (!before.allowed) {
        lastError = new AiModelRequestError(before.reason ?? "model_circuit_open", "模型熔断器尚未恢复", undefined, true);
        break;
      }
      const startedAt = performance.now();
      try {
        const result = await input.request(model);
        await safeAfterAttempt(input.observer, model, {
          outcome: "succeeded",
          attempt,
          fallbackIndex,
          durationMs: Math.max(0, Math.trunc(performance.now() - startedAt)),
          retryable: false,
          retryDelayMs: 0,
        }, before.context);
        return result;
      } catch (error) {
        lastError = error;
        const failure = classifyModelRequestError(error);
        const cancelled = failure.code === "model_request_cancelled";
        const canRetry = failure.retryable && !cancelled && attempt < policy.maxAttemptsPerModel;
        const retryDelayMs = canRetry ? retryDelay(failure.retryAfterMs, attempt, policy) : 0;
        await safeAfterAttempt(input.observer, model, {
          outcome: cancelled ? "cancelled" : "failed",
          attempt,
          fallbackIndex,
          durationMs: Math.max(0, Math.trunc(performance.now() - startedAt)),
          retryable: failure.retryable,
          retryDelayMs,
          errorCode: failure.code,
        }, before.context);
        if (cancelled || !failure.retryable) throw error;
        if (!canRetry) break;
        await (input.sleep ?? sleepWithCancellation)(retryDelayMs, input.signal);
      }
    }
  }
  throw lastError;
}

export function classifyModelRequestError(error: unknown): {
  code: string;
  retryable: boolean;
  retryAfterMs: number;
} {
  if (error instanceof AiModelRequestError) {
    return { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof BoundedFetchError) {
    return {
      code: error.code === "cancelled" ? "model_request_cancelled" : `model_${error.code}`,
      retryable: error.code === "timeout",
      retryAfterMs: 0,
    };
  }
  if (error instanceof TypeError) return { code: "model_network_error", retryable: true, retryAfterMs: 0 };
  if (error instanceof ModelProtocolError) return { code: "model_protocol_error", retryable: false, retryAfterMs: 0 };
  return { code: "model_request_failed", retryable: false, retryAfterMs: 0 };
}

function providerRequestError(response: Response, message?: string) {
  const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return new AiModelRequestError(
    `model_http_${response.status}`,
    providerFailure("模型调用失败", response.status, message),
    response.status,
    retryable,
    parseRetryAfter(response.headers.get("retry-after")),
  );
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function normalizeRetryPolicy(input?: Partial<ModelRetryPolicy>): ModelRetryPolicy {
  return {
    maxAttemptsPerModel: boundedInteger(input?.maxAttemptsPerModel, AI_MODEL_RETRY_LIMITS.maxAttemptsPerModel, 1, 3),
    baseDelayMs: boundedInteger(input?.baseDelayMs, AI_MODEL_RETRY_LIMITS.baseDelayMs, 0, 2_000),
    maximumDelayMs: boundedInteger(input?.maximumDelayMs, AI_MODEL_RETRY_LIMITS.maximumDelayMs, 0, 5_000),
    maximumRetryAfterMs: boundedInteger(input?.maximumRetryAfterMs, AI_MODEL_RETRY_LIMITS.maximumRetryAfterMs, 0, 10_000),
  };
}

function retryDelay(retryAfterMs: number, attempt: number, policy: ModelRetryPolicy) {
  const exponential = Math.min(policy.maximumDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const boundedRetryAfter = Math.min(policy.maximumRetryAfterMs, Math.max(0, retryAfterMs));
  const base = Math.max(exponential, boundedRetryAfter);
  const jitter = base > 0 ? Math.trunc(Math.random() * Math.max(1, Math.min(250, base / 4))) : 0;
  return Math.min(Math.max(policy.maximumDelayMs, policy.maximumRetryAfterMs), base + jitter);
}

async function sleepWithCancellation(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  throwIfAiRequestCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancelled);
      resolve();
    }, delayMs);
    const cancelled = () => {
      clearTimeout(timer);
      reject(new BoundedFetchError("cancelled", "模型请求已取消"));
    };
    signal?.addEventListener("abort", cancelled, { once: true });
  });
}

function modelKeyResolver() {
  const cache = new Map<string, Promise<string>>();
  return {
    get(model: AiTextModelRuntimeConfig) {
      const existing = cache.get(model.id);
      if (existing) return existing;
      const value = requireModelApiKey(model);
      cache.set(model.id, value);
      return value;
    },
  };
}

async function safeBeforeAttempt(
  observer: ModelAttemptObserver | undefined,
  model: AiTextModelRuntimeConfig,
  attempt: number,
  fallbackIndex: number,
) {
  if (!observer?.beforeAttempt) return { allowed: true };
  try {
    return await observer.beforeAttempt(model, attempt, fallbackIndex);
  } catch {
    return { allowed: true };
  }
}

async function safeAfterAttempt(
  observer: ModelAttemptObserver | undefined,
  model: AiTextModelRuntimeConfig,
  result: ModelAttemptResult,
  context?: unknown,
) {
  if (!observer?.afterAttempt) return;
  await observer.afterAttempt(model, result, context).catch(() => undefined);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const candidate = Number.isSafeInteger(value) ? Number(value) : fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}
