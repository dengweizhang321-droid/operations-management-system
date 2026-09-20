import { setTimeout as delay } from "node:timers/promises";

import { fetchAnnotationImage } from "../lib/market/annotation-image";
import { marketAiPriceTypes, parseVisionAnnotation } from "../lib/market/annotation-types";

type AgentTask = {
  itemId: string; jobId: string; skuCode: string; productName: string; brand: string; sourceImageUrl: string;
  promptBody: string; segments: string[]; recognitionMode?: "full" | "price_only"; fixedSegment?: string | null; localModelName: string; inferenceConcurrency?: number; leaseToken: string;
};
type AgentClaim = { task: AgentTask | null; workerConcurrency?: number };

const siteUrl = requiredEnv("TERUISI_SITE_URL").replace(/\/$/, "");
const token = requiredEnv("TERUISI_ANNOTATION_AGENT_TOKEN");
const ollamaUrl = normalizeLocalOllamaUrl(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
const once = process.argv.includes("--once");
const pollMs = Math.max(1_000, Math.min(60_000, Number(argument("--poll-ms") || 5_000)));
const OLLAMA_TIMEOUT_MS = 120_000;
const OLLAMA_RESPONSE_MAX_BYTES = 1024 * 1024;

async function workerRequest(body: Record<string, unknown>) {
  const response = await fetch(siteUrl + "/api/market/annotations/worker", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body), redirect: "manual",
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(String(payload?.error || ("agent API HTTP " + response.status)));
  return payload ?? {};
}

async function claim(): Promise<AgentClaim> {
  const payload = await workerRequest({ action: "claim" });
  return {
    task: (payload.task && typeof payload.task === "object" ? payload.task : null) as AgentTask | null,
    workerConcurrency: Number(payload.workerConcurrency),
  };
}

async function infer(task: AgentTask) {
  const image = task.sourceImageUrl ? await fetchAnnotationImage(task.sourceImageUrl) : null;
  const content = task.promptBody + "\n\n允许的细分品类：" + task.segments.join("、") + "\nSKU：" + task.skuCode + "\n商品名称：" + task.productName + "\n品牌：" + (task.brand || "未知") + "\n只输出 JSON：segment、image_price_cents（人民币分或null）、price_type、price_low_cents、price_high_cents、confidence（0到1）、reason。";
  const { response, payload } = await fetchOllamaJson(ollamaUrl + "/api/chat", {
    method: "POST", headers: { "content-type": "application/json" }, redirect: "manual",
    body: JSON.stringify({
      model: task.localModelName, stream: false, options: { temperature: 0 },
      messages: [{ role: "user", content, ...(image?.kind === "image" ? { images: [image.base64] } : {}) }],
      format: { type: "object", additionalProperties: false, properties: {
        segment: { type: "string", enum: task.segments }, image_price_cents: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        price_type: { type: "string", enum: marketAiPriceTypes },
        price_low_cents: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        price_high_cents: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" },
      }, required: ["segment", "image_price_cents", "price_type", "price_low_cents", "price_high_cents", "confidence", "reason"] },
    }),
  });
  if (!response.ok) throw new Error("Ollama 调用失败（状态码 " + response.status + "）");
  const result = parseVisionAnnotation(payload?.message?.content || "", task.segments);
  return { result: { segment: result.segment, image_price_cents: result.imagePriceCents, price_type: result.priceType, price_low_cents: result.priceLowCents, price_high_cents: result.priceHighCents, confidence: result.confidenceBps / 10_000, reason: result.reason }, imageSource: image?.kind === "image" ? image.source : "none", resolvedImageUrl: image?.kind === "image" ? image.url : "" };
}

async function fetchOllamaJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared.trim()) || Number(declared) > OLLAMA_RESPONSE_MAX_BYTES)) throw new Error("Ollama 响应超过安全上限");
    const bytes = await readLimitedBody(response, OLLAMA_RESPONSE_MAX_BYTES);
    let payload: { message?: { content?: string } } | null = null;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)) as { message?: { content?: string } }; }
    catch { if (response.ok) throw new Error("Ollama 响应不是有效 JSON"); }
    return { response, payload };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Ollama 调用超时");
    if (error instanceof Error && error.message.startsWith("Ollama ")) throw error;
    throw new Error("Ollama 本地连接失败");
  } finally { clearTimeout(timer); }
}

async function readLimitedBody(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Ollama 响应超过安全上限");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw new Error("Ollama 响应超过安全上限"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function processTask(task: AgentTask) {
  try {
    const output = await infer(task);
    await workerRequest({ action: "complete", itemId: task.itemId, leaseToken: task.leaseToken, ...output });
    process.stdout.write("completed " + task.itemId + " " + task.skuCode + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "local inference failed";
    await workerRequest({ action: "complete", itemId: task.itemId, leaseToken: task.leaseToken, error: message.slice(0, 800) }).catch(() => undefined);
    process.stderr.write("failed " + task.itemId + ": " + message + "\n");
  }
}

async function main() {
  if (once) {
    const claimed = await claim();
    if (claimed.task) await processTask(claimed.task);
    return;
  }
  const active = new Set<Promise<void>>();
  let workerConcurrency = 1;
  while (true) {
    while (active.size < workerConcurrency) {
      const claimed = await claim();
      workerConcurrency = boundedConcurrency(claimed.workerConcurrency, workerConcurrency);
      if (!claimed.task) break;
      const pending = processTask(claimed.task).finally(() => active.delete(pending));
      active.add(pending);
    }
    if (active.size) await Promise.race(active);
    else await delay(pollMs);
  }
}

function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error("Missing environment variable " + name); return value; }
function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function boundedConcurrency(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 50 ? Number(value) : fallback;
}
function normalizeLocalOllamaUrl(value: string) {
  const url = new URL(value);
  if (!(["localhost", "127.0.0.1", "::1"].includes(url.hostname)) || !["http:", "https:"].includes(url.protocol)) throw new Error("OLLAMA_BASE_URL must point to localhost");
  return url.toString().replace(/\/$/, "");
}

void main().catch((error) => { process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n"); process.exitCode = 1; });
