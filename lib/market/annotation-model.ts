import type { AppPrincipal } from "@/lib/auth/authorization";
import { aiConsumer } from "@/lib/django/ai-service";
import { decryptSecret } from "@/lib/ai/crypto";
import {
  loadAiEndpointSecurityContext,
  resolveAiModelEndpointUrl,
} from "@/lib/ai/endpoint-security";
import { buildOpenAiChatRequestBody, completeText, type AiTextModelRuntimeConfig } from "@/lib/ai/model-gateway";
import { AI_MODEL_TOOL_BUDGET_LIMITS } from "@/lib/ai/model-tool-budget";
import { fetchAnnotationImage } from "@/lib/market/annotation-image";
import type { AnnotationImageCacheReference } from "./annotation-cached-image";
import { digest, marketAiPriceTypes, parseVisionAnnotation, type VisionAnnotation } from "@/lib/market/annotation-types";
import { sanitizeAnnotationFailureMessage } from "./annotation-failure";

export type AnnotationModelConfig = {
  id: string; name: string; protocol: string; model_type: string; model_name: string;
  base_url: string; api_key_encrypted: string; status: string;
  timeout_ms?: number; max_tokens?: number; reasoning_mode?: string; temperature_milli?: number;
  max_tool_rounds?: number; max_total_tool_calls?: number;
};
type ModelRow = AnnotationModelConfig;
const DEFAULT_MODEL_TIMEOUT_MS = 60_000;
const VISION_ANNOTATION_TIMEOUT_MAX_MS = 90_000;
const MODEL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const VISION_ANNOTATION_OUTPUT_TOKEN_MAX = 600;
const VISION_PRICE_ONLY_OUTPUT_TOKEN_MAX = 320;
const VISION_PROBE_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAvSURBVFhH7c6hAQAACMOw/f/08BwAJqKmKmnSz7LHdQAAAAAAAAAAAAAAAAAAAANUDfhqnpuFxwAAAABJRU5ErkJggg==";

type PublicModel = { id: string; name: string; protocol: string; modelName: string };
export async function listAnnotationModels(principal?: AppPrincipal) {
  return (await aiConsumer<{ items: PublicModel[] }>(principal ?? (await (await import("@/lib/auth/authorization")).requireAppPrincipal()), { operation: "model-list", modelType: "vision" })).items.map(({ id, name, protocol, modelName }) => ({ id, name, protocol, modelName }));
}
export async function listPromptTextModels(principal?: AppPrincipal) {
  return (await aiConsumer<{ items: PublicModel[] }>(principal ?? (await (await import("@/lib/auth/authorization")).requireAppPrincipal()), { operation: "model-list", modelType: "text" })).items.map(({ id, name, protocol, modelName }) => ({ id, name, protocol, modelName }));
}
async function getModel(id: string, type: "vision" | "text", principal?: AppPrincipal, signal?: AbortSignal) {
  return (await aiConsumer<{ model: ModelRow }>(principal ?? (await (await import("@/lib/auth/authorization")).requireAppPrincipal()), { operation: "model-runtime", id, modelType: type, allowFallback: false }, { signal })).model;
}

export async function probeVisionModelConnection(model: AnnotationModelConfig): Promise<string> {
  const segments = ["红色", "其他"] as const;
  const image: LoadedImage = {
    kind: "image",
    source: "imgzone",
    url: "inline://vision-capability-probe",
    mimeType: "image/png",
    bytes: new Uint8Array(),
    base64: VISION_PROBE_IMAGE_BASE64,
  };
  const prompt = "请观察随请求发送的测试图片主色。segment 只能返回“红色”或“其他”；图片中没有商品价格，因此价格和价格区间返回 null，price_type 返回“无法判断”，并给出置信度和简短依据。不要根据文字猜测颜色。";
  const raw = model.protocol === "anthropic"
    ? await callAnthropicVision(model, prompt, segments, image)
    : await callOpenAiVision(model, prompt, segments, image, undefined, undefined, `market/probe/${crypto.randomUUID()}`);
  validateVisionOutput(raw, segments);
  const parsed = parseVisionAnnotation(raw, segments);
  if (parsed.segment !== "红色") throw new Error("模型接口可连接，但未能识别测试图片；请确认模型标识支持图片输入");
  return "图片识别成功";
}

export async function runVisionAnnotation(input: {
  principal?: AppPrincipal; modelId: string; promptBody: string; segments: readonly string[];
  skuCode: string; productName: string; brand: string; imageUrl: string; fixedSegment?: string;
  deadlineAt?: number; jobId?: string;
  imageContentSha256?: string; imageCache?: AnnotationImageCacheReference | null;
}): Promise<VisionAnnotation & { imageSource: "imgzone" | "n5" | "none"; resolvedImageUrl: string; rawDigest: string; timing: VisionAnnotationTiming }> {
  const startedAt = Date.now();
  const measuredAt = performance.now();
  const elapsed = (since: number) => Math.max(0, Math.round(performance.now() - since));
  const timing: VisionAnnotationTiming = { imageLoadMs: 0, imagePrepareMs: 0, modelCallMs: 0, totalMs: 0, inputBytes: 0 };
  const deadlineAt = Math.min(input.deadlineAt ?? startedAt + 140_000, startedAt + 140_000);
  const remaining = () => {
    const ms = Math.floor(deadlineAt - Date.now());
    if (ms <= 0) throw new Error("视觉任务处理超时");
    return ms;
  };
  try {
    const model = await getModel(input.modelId, "vision", input.principal, AbortSignal.timeout(Math.min(15_000, remaining())));
    const imageLoadStartedAt = performance.now();
    const { loadAnnotationImageWithRuntime } = await import("./annotation-image-runtime");
    const sourceImage = await loadAnnotationImageWithRuntime({ imageUrl: input.imageUrl, imageContentSha256: input.imageContentSha256, cache: input.imageCache, deadlineAt })
      .finally(() => { timing.imageLoadMs = elapsed(imageLoadStartedAt); });
    const imagePrepareStartedAt = performance.now();
    let preparationTimer: ReturnType<typeof setTimeout> | undefined;
    const image = await Promise.race([
      prepareAnnotationModelImage(sourceImage),
      new Promise<never>((_resolve, reject) => { preparationTimer = setTimeout(() => reject(new Error("图片处理超时")), remaining()); }),
    ]).finally(() => { if (preparationTimer) clearTimeout(preparationTimer); timing.imagePrepareMs = elapsed(imagePrepareStartedAt); });
    timing.inputBytes = image.bytes.byteLength;
    const fixedSegment = input.fixedSegment?.trim() ?? "";
    if (fixedSegment && !input.segments.includes(fixedSegment)) throw new Error("历史细分品类已失效，不能执行价格专用识别");
    const outputSegments = fixedSegment ? [fixedSegment] : input.segments;
    const text = `${fixedSegment ? priceOnlyAnnotationPrompt(fixedSegment) : `${input.promptBody}\n\n允许的细分品类：${input.segments.join("、")}`}\nSKU：${input.skuCode}\n商品名称：${input.productName}\n品牌：${input.brand || "未知"}\n必须返回主图中清晰可见且可作为完整商品售价的价格（人民币元，可带两位小数；没有则 null）、价格类型、价格区间最低/最高值（同样使用人民币元）、0到1置信度和简短证据。忽略销量、优惠券面额、补贴金额、划线原价及赠品价格；分期每期金额、定金、起售价和最低规格价必须如实标记，不能冒充完整商品售价。价格类型只能是：标准售价、到手价、券后价、起售价、价格区间、定金、分期金额、最低规格价格、无法判断、明确无标价。只有图片清晰完整且确定没有商品标价时才能返回“明确无标价”，价格及区间必须为 null、置信度至少 0.9 并给出图像证据；看不清、遮挡或不能确定时返回“无法判断”。`;
    const modelCallStartedAt = performance.now();
    let raw: unknown;
    try {
      raw = model.protocol === "anthropic"
        ? await callAnthropicVision(model, text, outputSegments, image, fixedSegment ? VISION_PRICE_ONLY_OUTPUT_TOKEN_MAX : VISION_ANNOTATION_OUTPUT_TOKEN_MAX, deadlineAt)
        : await callOpenAiVision(model, text, outputSegments, image, fixedSegment ? VISION_PRICE_ONLY_OUTPUT_TOKEN_MAX : VISION_ANNOTATION_OUTPUT_TOKEN_MAX, deadlineAt, input.jobId ? `market/job/${input.jobId}` : undefined);
    } finally {
      timing.modelCallMs = elapsed(modelCallStartedAt);
    }
    validateVisionOutput(raw, outputSegments);
    const parsed = parseVisionAnnotation(raw, outputSegments);
    timing.totalMs = elapsed(measuredAt);
    return {
      ...parsed,
      imageSource: image.source,
      resolvedImageUrl: image.url,
      rawDigest: digest(parsed.rawText),
      timing,
    };
  } catch (error) {
    timing.totalMs = elapsed(measuredAt);
    throw new VisionAnnotationExecutionError(error instanceof Error ? error.message : "视觉识别失败", timing, error);
  }
}

export type VisionAnnotationTiming = {
  imageLoadMs: number;
  imagePrepareMs: number;
  modelCallMs: number;
  totalMs: number;
  inputBytes: number;
};

export class VisionAnnotationExecutionError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly failureCode?: string;
  constructor(message: string, readonly timing: VisionAnnotationTiming, cause?: unknown) {
    super(sanitizeAnnotationFailureMessage(message));
    this.name = "VisionAnnotationExecutionError";
    if (cause && typeof cause === "object") {
      if ("status" in cause) this.status = Number(cause.status);
      if ("retryAfterMs" in cause) this.retryAfterMs = Number(cause.retryAfterMs);
      if ("failureCode" in cause && typeof cause.failureCode === "string") this.failureCode = cause.failureCode;
    }
  }
}

export function visionAnnotationTiming(error: unknown): VisionAnnotationTiming {
  return error instanceof VisionAnnotationExecutionError
    ? error.timing
    : { imageLoadMs: 0, imagePrepareMs: 0, modelCallMs: 0, totalMs: 0, inputBytes: 0 };
}

export function priceOnlyAnnotationPrompt(segment: string) {
  return `该 SKU 的细分品类已经人工复核并正式入库，固定为“${segment}”。不要重新分类，只识别当前新主图价格；segment 必须原样返回“${segment}”。`;
}

async function prepareAnnotationModelImage<T extends LoadedImage>(image: T): Promise<T> {
  if ("optimizedForModel" in image && image.optimizedForModel) return image;
  try {
    const { optimizeAnnotationImageWithRuntime } = await import("@/lib/market/annotation-image-runtime");
    return await optimizeAnnotationImageWithRuntime(image);
  } catch {
    return image;
  }
}

export async function runPromptTextCompletion(modelId: string, instruction: string, principal?: AppPrincipal) {
  const model = await getModel(modelId, "text", principal);
  return completeText({
    model: textRuntimeModel(model),
    messages: [{ role: "user", content: instruction }],
  });
}

function textRuntimeModel(model: ModelRow): AiTextModelRuntimeConfig {
  return {
    id: model.id,
    name: model.name,
    protocol: model.protocol === "anthropic" ? "anthropic" : "openai_compatible",
    modelName: model.model_name,
    baseUrl: model.base_url,
    apiKeyEncrypted: model.api_key_encrypted,
    timeoutMs: boundedModelSetting(model.timeout_ms, 20_000, 3_000, 120_000),
    maxTokens: boundedModelSetting(model.max_tokens, 4_096, 128, 8_192),
    reasoningMode: model.protocol !== "anthropic" && model.reasoning_mode === "disabled" ? "disabled" : "auto",
    temperature: boundedModelSetting(model.temperature_milli, 200, 0, 1_000) / 1_000,
    maxToolRounds: boundedModelSetting(model.max_tool_rounds, AI_MODEL_TOOL_BUDGET_LIMITS.defaultRounds, 1, AI_MODEL_TOOL_BUDGET_LIMITS.maximumRounds),
    maxTotalToolCalls: boundedModelSetting(model.max_total_tool_calls, AI_MODEL_TOOL_BUDGET_LIMITS.defaultTotalCalls, 1, AI_MODEL_TOOL_BUDGET_LIMITS.maximumTotalCalls),
  };
}

function boundedModelSetting(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : fallback;
}

type LoadedImage = Extract<Awaited<ReturnType<typeof fetchAnnotationImage>>, { kind: "image" }>;
type ModelErrorEnvelope = { error?: string | { message?: unknown; code?: unknown; type?: unknown }; message?: unknown };

function modelErrorDetail(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const envelope = data as ModelErrorEnvelope;
  const error = envelope.error;
  const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : typeof envelope.message === "string" ? envelope.message : "";
  const code = typeof error === "object" && error && typeof error.code === "string" ? error.code : "";
  const detail = [code, message].filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
  return sanitizeAnnotationFailureMessage(detail, 180);
}

function visionFailure(message: string, failureCode: "model_configuration" | "model_response", validationCode?: string) {
  // Codes are fixed at the validation sites; never include a returned field value.
  return Object.assign(new Error(message + (validationCode ? ` [validation_code=${validationCode}]` : "")), { failureCode });
}

function confirmedConfigurationError(status: number, detail: string) {
  if (status === 401 || status === 403) return true;
  if (status !== 400 && status !== 404 && status !== 422) return false;
  // A rejected image/content can be specific to one item. Only explicit model,
  // required session, or unsupported request-option diagnostics stop the job.
  return /(?:missing|required|invalid).{0,45}x-opencode-session|x-opencode-session.{0,45}(?:missing|required|invalid)/i.test(detail)
    || /\b(?:model_not_found|unsupported_model|invalid_model)\b/i.test(detail)
    || /(?:model.{0,35}(?:does not exist|not found|not supported|unsupported))|(?:(?:unsupported|not supported|unknown|unrecognized|unavailable|not available).{0,35}(?:response_format|json_schema|thinking|reasoning_effort))|(?:(?:response_format|json_schema|thinking|reasoning_effort).{0,35}(?:unsupported|not supported|not allowed|unavailable|not available))/i.test(detail);
}

function modelCallError(kind: "文本" | "视觉", status: number, data: unknown, retryAfter: string | null = null) {
  const detail = modelErrorDetail(data);
  const hint = status === 429
    ? "模型供应商限流或额度不足，请稍后重试并检查额度"
    : status === 400
      ? "请求被接口拒绝，请核对请求参数及模型兼容性"
      : "请检查模型服务状态和接口配置";
  const parsed = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter ?? "") - Date.now();
  return Object.assign(new Error(`${kind}模型调用失败（状态码 ${status}：${detail || hint}）`), {
    status, retryAfterMs: Number.isFinite(parsed) ? Math.min(300_000, Math.max(0, parsed)) : 0,
    ...(confirmedConfigurationError(status, detail) ? { failureCode: "model_configuration" } : {}),
  });
}

function visionSessionHeaders(endpointUrl: string, sessionIdentity?: string) {
  const endpoint = new URL(endpointUrl);
  if (endpoint.origin !== "https://opencode.ai" || endpoint.pathname !== "/zen/go/v1/chat/completions") return {};
  if (!sessionIdentity || sessionIdentity.length > 200) throw visionFailure("视觉模型配置缺少有效的服务端任务会话标识", "model_configuration");
  // Same opaque SHA session convention as Django AI provider.conversation_session.
  // Job/probe namespaces distinguish honest task identities from connection tests.
  return { "User-Agent": "xiaote-market/1.0", "x-opencode-session": digest(`xiaote/session/v1/${sessionIdentity}`) };
}

function deepSeekGoJsonMode(endpointUrl: string, modelName: string) {
  const endpoint = new URL(endpointUrl);
  return endpoint.origin === "https://opencode.ai"
    && endpoint.pathname === "/zen/go/v1/chat/completions"
    && modelName === "deepseek-v4.1-flash";
}

type OpenAiVisionEnvelope = { error?: unknown; choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }> };

async function callOpenAiVision(model: ModelRow, text: string, segments: readonly string[], image: LoadedImage | null, outputTokenCap?: number, deadlineAt?: number, sessionIdentity?: string) {
  const endpointSecurityContext = await loadAiEndpointSecurityContext();
  const endpointUrl = visionEndpoint(model, "openai_compatible", endpointSecurityContext);
  const key = await visionApiKey(model);
  if (!key) throw new Error("视觉模型 API Key 未配置");
  const schema = annotationJsonSchema(segments);
  // Explicit provider capability selection, never a POST fallback/replay.
  // DeepSeek chat JSON mode accepts json_object; local strict validation below
  // still owns all field/type/enum/null constraints.
  const jsonMode = deepSeekGoJsonMode(endpointUrl, model.model_name);
  const technicalOutput = jsonMode
    ? `\n\n技术输出协议：只返回一个严格 JSON 对象，不要 Markdown、推理文字或额外字段。结果必须符合以下 JSON Schema：${JSON.stringify(schema)}`
    : "";
  const content: Array<Record<string, unknown>> = [{ type: "text", text: text + technicalOutput }];
  if (image) content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" } });
  const { response, data } = await fetchJsonLimited<OpenAiVisionEnvelope>(endpointUrl, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...visionSessionHeaders(endpointUrl, sessionIdentity) },
    body: JSON.stringify(buildOpenAiChatRequestBody({
      modelName: model.model_name, temperature: 0,
      maxTokens: Math.min(boundedModelSetting(model.max_tokens, VISION_ANNOTATION_OUTPUT_TOKEN_MAX, 128, 1_600), outputTokenCap ?? VISION_ANNOTATION_OUTPUT_TOKEN_MAX),
      // Annotation extraction has its own fixed reasoning policy; saved settings
      // and other AI functions retain their configured reasoning behavior.
      reasoningMode: "disabled",
    }, {
      messages: [{ role: "user", content }],
      response_format: jsonMode ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "market_sku_annotation", strict: true, schema } },
    })),
  }, visionRequestTimeout(model, deadlineAt));
  if (!response.ok) throw modelCallError("视觉", response.status, data, response.headers.get("retry-after"));
  if (data?.error) throw visionFailure(`视觉模型响应包含供应商错误：${modelErrorDetail(data) || "未产生识别结果"}`, confirmedConfigurationError(400, modelErrorDetail(data)) ? "model_configuration" : "model_response");
  if (!Array.isArray(data?.choices) || data.choices.length !== 1) throw visionFailure("视觉模型响应 choices 无效", "model_response", "choices_count");
  const choice = data.choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw visionFailure("视觉模型响应 choice 无效", "model_response", "choice_shape");
  if (choice.finish_reason === "length") throw visionFailure("视觉模型输出截断（finish_reason=length）", "model_response", "output_truncated");
  if (choice.finish_reason !== "stop") throw visionFailure("视觉模型响应缺少正常完成状态", "model_response", "finish_reason");
  if (!choice.message || choice.message.refusal) throw visionFailure("视觉模型响应未提供可用正文", "model_response", "message_unavailable");
  const contentValue = choice.message.content;
  const answer = typeof contentValue === "string" ? contentValue : Array.isArray(contentValue)
    && contentValue.every((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    ? contentValue.map((part) => part.text).join("") : "";
  if (!answer.trim()) throw visionFailure("视觉模型响应正文为空", "model_response", "empty_response");
  return answer;
}

async function callAnthropicVision(model: ModelRow, text: string, segments: readonly string[], image: LoadedImage | null, outputTokenCap?: number, deadlineAt?: number) {
  const endpointSecurityContext = await loadAiEndpointSecurityContext();
  const endpointUrl = visionEndpoint(model, "anthropic", endpointSecurityContext);
  const key = await visionApiKey(model);
  if (!key) throw new Error("视觉模型 API Key 未配置");
  const content: Array<Record<string, unknown>> = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } });
  content.push({ type: "text", text });
  const { response, data } = await fetchJsonLimited<{ error?: unknown; stop_reason?: unknown; content?: Array<{ type?: string; name?: string; input?: unknown }> }>(endpointUrl, {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model.model_name, max_tokens: Math.min(boundedModelSetting(model.max_tokens, VISION_ANNOTATION_OUTPUT_TOKEN_MAX, 128, 1_600), outputTokenCap ?? VISION_ANNOTATION_OUTPUT_TOKEN_MAX), messages: [{ role: "user", content }],
      tools: [{ name: "submit_market_sku_annotation", description: "提交结构化识别结果", input_schema: annotationJsonSchema(segments) }],
      tool_choice: { type: "tool", name: "submit_market_sku_annotation" },
    }),
  }, visionRequestTimeout(model, deadlineAt));
  if (!response.ok) throw modelCallError("视觉", response.status, data, response.headers.get("retry-after"));
  if (data?.error) throw visionFailure(`Anthropic 视觉模型响应包含供应商错误：${modelErrorDetail(data) || "未产生识别结果"}`, confirmedConfigurationError(400, modelErrorDetail(data)) ? "model_configuration" : "model_response");
  if (data?.stop_reason === "max_tokens") throw visionFailure("Anthropic 视觉模型输出截断（stop_reason=max_tokens）", "model_response", "output_truncated");
  if (data?.stop_reason !== "tool_use" || !Array.isArray(data.content)) throw visionFailure("Anthropic 视觉模型响应缺少正常工具完成状态", "model_response", "stop_reason");
  const tools = data.content.filter((part) => part?.type === "tool_use");
  const tool = tools[0];
  if (tools.length !== 1 || tool?.name !== "submit_market_sku_annotation" || !tool.input) throw visionFailure("Anthropic 视觉模型没有返回唯一结构化工具结果", "model_response", "tool_result");
  return tool.input;
}

function visionEndpoint(model: ModelRow, protocol: "openai_compatible" | "anthropic", context: Awaited<ReturnType<typeof loadAiEndpointSecurityContext>>) {
  try { return resolveAiModelEndpointUrl(model.base_url, protocol, context); }
  catch { throw visionFailure("视觉模型配置的接口地址未通过安全校验", "model_configuration"); }
}

async function visionApiKey(model: ModelRow) {
  try { return await decryptSecret(model.api_key_encrypted); }
  catch { throw visionFailure("视觉模型配置的 API Key 无法解密", "model_configuration"); }
}

function visionRequestTimeout(model: ModelRow, deadlineAt?: number) {
  const remaining = deadlineAt === undefined ? VISION_ANNOTATION_TIMEOUT_MAX_MS : Math.floor(deadlineAt - Date.now());
  if (remaining <= 0) throw new Error("视觉任务处理超时");
  return Math.min(remaining, boundedModelSetting(model.timeout_ms, DEFAULT_MODEL_TIMEOUT_MS, 3_000, 120_000), VISION_ANNOTATION_TIMEOUT_MAX_MS);
}

function validateVisionOutput(raw: unknown, segments: readonly string[]) {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw visionFailure("视觉模型没有返回严格 JSON", "model_response", "invalid_json"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw visionFailure("视觉模型结果必须是 JSON 对象", "model_response", "object_shape");
  const record = value as Record<string, unknown>;
  const required = ["segment", "image_price_yuan", "price_type", "price_low_yuan", "price_high_yuan", "confidence", "reason"];
  if (Object.keys(record).length !== required.length || required.some((key) => !Object.hasOwn(record, key))) throw visionFailure("视觉模型结果字段与严格 schema 不一致", "model_response", "schema_fields");
  if (typeof record.segment !== "string" || !segments.includes(record.segment)) throw visionFailure("视觉模型品类枚举无效", "model_response", "segment_enum");
  if (typeof record.price_type !== "string" || !(marketAiPriceTypes as readonly string[]).includes(record.price_type)) throw visionFailure("视觉模型价格类型无效", "model_response", "price_type_enum");
  for (const key of ["image_price_yuan", "price_low_yuan", "price_high_yuan"]) {
    const price = record[key];
    if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) throw visionFailure("视觉模型价格必须是数字或 null", "model_response", key === "image_price_yuan" ? "image_price_value" : key === "price_low_yuan" ? "price_low_value" : "price_high_value");
  }
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) throw visionFailure("视觉模型 confidence 类型或范围无效", "model_response", "confidence_value");
  if (typeof record.reason !== "string") throw visionFailure("视觉模型证据类型无效", "model_response", "reason_type");
  if (record.price_type === "明确无标价") {
    if ([record.image_price_yuan, record.price_low_yuan, record.price_high_yuan].some((price) => price !== null)) throw visionFailure("明确无标价缺少充分证据或价格不为空", "model_response", "no_price_not_null");
    if (record.confidence < 0.9 || !record.reason.trim()) throw visionFailure("明确无标价缺少充分证据或价格不为空", "model_response", "no_price_evidence");
  }
}

function annotationJsonSchema(segments: readonly string[]) {
  return { type: "object", additionalProperties: false, properties: {
    segment: { type: "string", enum: segments }, image_price_yuan: { anyOf: [{ type: "number", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
    price_type: { type: "string", enum: ["标准售价", "到手价", "券后价", "起售价", "价格区间", "定金", "分期金额", "最低规格价格", "无法判断", "明确无标价"] },
    price_low_yuan: { anyOf: [{ type: "number", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
    price_high_yuan: { anyOf: [{ type: "number", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" },
  }, required: ["segment", "image_price_yuan", "price_type", "price_low_yuan", "price_high_yuan", "confidence", "reason"] };
}

async function fetchJsonLimited<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw visionFailure("模型接口禁止重定向", "model_configuration");
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared.trim()) || Number(declared) > MODEL_RESPONSE_MAX_BYTES)) throw Object.assign(new Error("模型响应未完整读取，声明大小无效或超过安全上限，推理结果未知"), { failureCode: "inference_result_unknown" });
    const bytes = await readBodyLimited(response, MODEL_RESPONSE_MAX_BYTES);
    let data: T | null = null;
    try { data = JSON.parse(new TextDecoder().decode(bytes)) as T; } catch {
      if (response.ok) throw visionFailure("模型响应不是有效 JSON", "model_response", "response_json");
    }
    return { response, data };
  } catch (error) {
    if (error && typeof error === "object" && "failureCode" in error) throw error;
    // POST is never replayed. Missing acknowledgement cannot prove that model
    // inference did not happen; isolate the current lease's unknown result.
    throw Object.assign(new Error(controller.signal.aborted ? "模型请求已发出但调用超时，推理结果未知" : "模型请求已发出但未完整收到响应，推理结果未知"), { failureCode: "inference_result_unknown" });
  } finally { clearTimeout(timer); }
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw Object.assign(new Error("模型响应超过安全上限，推理结果未知"), { failureCode: "inference_result_unknown" });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw Object.assign(new Error("模型响应未完整读取且超过安全上限，推理结果未知"), { failureCode: "inference_result_unknown" }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
