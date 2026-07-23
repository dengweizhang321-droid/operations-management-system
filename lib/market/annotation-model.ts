import { decryptSecret } from "@/lib/ai/crypto";
import { resolveAiModelEndpointUrl } from "@/lib/ai/endpoint-security";
import { fetchAnnotationImage } from "@/lib/market/annotation-image";
import type { MarketDatabase } from "@/lib/market/database";
import { digest, parseVisionAnnotation, type VisionAnnotation } from "@/lib/market/annotation-types";

type ModelRow = { id: string; name: string; protocol: "openai_compatible" | "anthropic"; model_type: string; model_name: string; base_url: string; api_key_encrypted: string; status: string };
const MODEL_TIMEOUT_MS = 90_000;
const MODEL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

export async function listAnnotationModels(db: MarketDatabase) {
  const rows = await db.prepare("SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, status FROM ai_models WHERE status = 'enabled' AND model_type = 'vision' ORDER BY updated_at DESC").all<ModelRow>();
  return (rows.results ?? []).map(({ id, name, protocol, model_name }) => ({ id, name, protocol, modelName: model_name }));
}

export async function listPromptTextModels(db: MarketDatabase) {
  const rows = await db.prepare("SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, status FROM ai_models WHERE status = 'enabled' AND model_type = 'text' ORDER BY is_default_text_model DESC, updated_at DESC").all<ModelRow>();
  return (rows.results ?? []).map(({ id, name, protocol, model_name }) => ({ id, name, protocol, modelName: model_name }));
}

async function getModel(db: MarketDatabase, id: string, type: "vision" | "text") {
  const row = await db.prepare("SELECT id, name, protocol, model_type, model_name, base_url, api_key_encrypted, status FROM ai_models WHERE id = ? AND status = 'enabled' AND model_type = ? LIMIT 1").bind(id, type).first<ModelRow>();
  if (!row) throw new Error(`所选 ${type === "vision" ? "视觉" : "文本"} 模型不存在或未启用`);
  return row;
}

export async function runVisionAnnotation(input: {
  db: MarketDatabase; modelId: string; promptBody: string; segments: readonly string[];
  skuCode: string; productName: string; brand: string; imageUrl: string;
}): Promise<VisionAnnotation & { imageSource: "imgzone" | "n5" | "none"; resolvedImageUrl: string; rawDigest: string }> {
  const model = await getModel(input.db, input.modelId, "vision");
  const image = input.imageUrl ? await fetchAnnotationImage(input.imageUrl) : { kind: "no-image" as const, reason: "invalid_url" as const, message: "没有图片地址" };
  const text = `${input.promptBody}\n\n允许的细分品类：${input.segments.join("、")}\nSKU：${input.skuCode}\n商品名称：${input.productName}\n品牌：${input.brand || "未知"}\n必须返回细分品类、主图明确展示的价格（人民币分；没有则 null）、0到1置信度和简短依据。`;
  const raw = model.protocol === "anthropic"
    ? await callAnthropicVision(model, text, input.segments, image.kind === "image" ? image : null)
    : await callOpenAiVision(model, text, input.segments, image.kind === "image" ? image : null);
  const parsed = parseVisionAnnotation(raw, input.segments);
  return {
    ...parsed,
    imageSource: image.kind === "image" ? image.source : "none",
    resolvedImageUrl: image.kind === "image" ? image.url : "",
    rawDigest: digest(parsed.rawText),
  };
}

export async function runPromptTextCompletion(db: MarketDatabase, modelId: string, instruction: string) {
  const model = await getModel(db, modelId, "text");
  const key = await decryptSecret(model.api_key_encrypted);
  if (!key) throw new Error("文本模型 API Key 未配置");
  if (model.protocol === "anthropic") {
    const { response, data } = await fetchJsonLimited<{ content?: Array<{ type?: string; text?: string }> }>(resolveAiModelEndpointUrl(model.base_url, "anthropic"), {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model.model_name, max_tokens: 1800, messages: [{ role: "user", content: instruction }] }),
    });
    if (!response.ok) throw new Error(`文本模型调用失败（状态码 ${response.status}）`);
    return data?.content?.map((part) => part.text ?? "").join("").trim() || "";
  }
  const { response, data } = await fetchJsonLimited<{ choices?: Array<{ message?: { content?: string } }> }>(resolveAiModelEndpointUrl(model.base_url, "openai_compatible"), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model.model_name, temperature: 0.2, messages: [{ role: "user", content: instruction }] }),
  });
  if (!response.ok) throw new Error(`文本模型调用失败（状态码 ${response.status}）`);
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

type LoadedImage = Extract<Awaited<ReturnType<typeof fetchAnnotationImage>>, { kind: "image" }>;

async function callOpenAiVision(model: ModelRow, text: string, segments: readonly string[], image: LoadedImage | null) {
  const key = await decryptSecret(model.api_key_encrypted);
  if (!key) throw new Error("视觉模型 API Key 未配置");
  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  if (image) content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" } });
  const { response, data } = await fetchJsonLimited<{ choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }>(resolveAiModelEndpointUrl(model.base_url, "openai_compatible"), {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model.model_name, temperature: 0, messages: [{ role: "user", content }],
      response_format: { type: "json_schema", json_schema: { name: "market_sku_annotation", strict: true, schema: annotationJsonSchema(segments) } },
    }),
  });
  if (!response.ok) throw new Error(`视觉模型调用失败（状态码 ${response.status}）`);
  const contentValue = data?.choices?.[0]?.message?.content;
  return typeof contentValue === "string" ? contentValue : contentValue?.map((part) => part.text ?? "").join("") || "";
}

async function callAnthropicVision(model: ModelRow, text: string, segments: readonly string[], image: LoadedImage | null) {
  const key = await decryptSecret(model.api_key_encrypted);
  if (!key) throw new Error("视觉模型 API Key 未配置");
  const content: Array<Record<string, unknown>> = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } });
  content.push({ type: "text", text });
  const { response, data } = await fetchJsonLimited<{ content?: Array<{ type?: string; name?: string; input?: unknown }> }>(resolveAiModelEndpointUrl(model.base_url, "anthropic"), {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: model.model_name, max_tokens: 800, messages: [{ role: "user", content }],
      tools: [{ name: "submit_market_sku_annotation", description: "提交结构化识别结果", input_schema: annotationJsonSchema(segments) }],
      tool_choice: { type: "tool", name: "submit_market_sku_annotation" },
    }),
  });
  if (!response.ok) throw new Error(`视觉模型调用失败（状态码 ${response.status}）`);
  const tool = data?.content?.find((part) => part.type === "tool_use" && part.name === "submit_market_sku_annotation");
  if (!tool?.input) throw new Error("Anthropic 视觉模型没有返回结构化工具结果");
  return tool.input;
}

function annotationJsonSchema(segments: readonly string[]) {
  return { type: "object", additionalProperties: false, properties: {
    segment: { type: "string", enum: segments }, image_price_cents: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" },
  }, required: ["segment", "image_price_cents", "confidence", "reason"] };
}

async function fetchJsonLimited<T>(url: string, init: RequestInit): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error("模型接口禁止重定向");
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared.trim()) || Number(declared) > MODEL_RESPONSE_MAX_BYTES)) throw new Error("模型响应超过安全上限");
    const bytes = await readBodyLimited(response, MODEL_RESPONSE_MAX_BYTES);
    let data: T | null = null;
    try { data = JSON.parse(new TextDecoder().decode(bytes)) as T; } catch {
      if (response.ok) throw new Error("模型响应不是有效 JSON");
    }
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("模型调用超时");
    if (error instanceof Error && /^(模型接口禁止重定向|模型响应超过安全上限|模型响应不是有效 JSON)/.test(error.message)) throw error;
    throw new Error("模型接口网络错误");
  } finally { clearTimeout(timer); }
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("模型响应超过安全上限");
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
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw new Error("模型响应超过安全上限"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
