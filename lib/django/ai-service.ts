import type { AppPrincipal } from "@/lib/auth/authorization";
import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import { PublicApiError } from "@/lib/http/api-error";

type Environment = Record<string, string | undefined>;
const encoder = new TextEncoder();
const ENTITY = "[A-Za-z0-9_-]{1,160}";
const PUBLIC_PATH = new RegExp(`^/api/ai/(?:models|channels|conversations|chat(?:/cancel)?|memories(?:/${ENTITY})?|sandbox|agent-jobs(?:/${ENTITY}(?:/(?:cancel|resume))?)?|workflow-runs(?:/${ENTITY}(?:/(?:cancel|resume)|/nodes/${ENTITY}/review)?)?|artifacts/${ENTITY}|space/(?:meta|profiles|templates|jobs(?:/${ENTITY}(?:/cancel)?)?|assets(?:/${ENTITY}(?:/content)?)?))$`);
export const AI_INTERNAL_PATHS = new Set(["/api/ai/consumer", "/api/ai/scheduler"]);

export async function aiEnvironment(): Promise<Environment> {
  let worker: Environment = {};
  try { worker = (await import("cloudflare:workers")).env as unknown as Environment; } catch { /* Node tests. */ }
  return { ...(globalThis.process?.env ?? {}), ...worker };
}

export function isPublicAiPath(path: string) { return PUBLIC_PATH.test(path); }

function unavailable() { return new PublicApiError(503, "service_unavailable", "Django AI 服务暂时不可用。"); }
function hex(value: ArrayBuffer) { return Array.from(new Uint8Array(value), v => v.toString(16).padStart(2, "0")).join(""); }
export async function aiSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer));
}
function b64(value: string) { return btoa(String.fromCharCode(...encoder.encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

export async function aiHeaders(input: { secret: string; principal: AppPrincipal; method: string; path: string; query: string; body: string; requestId: string; timestamp?: number }) {
  if (encoder.encode(input.secret).length < 32 || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)
    || !input.path.startsWith("/api/ai/") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(input.method)) throw unavailable();
  const principal = b64(JSON.stringify({ email: input.principal.email, displayName: input.principal.displayName, role: input.principal.role, scope: input.principal.scope }));
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const digest = await aiSha256(input.body);
  const canonical = ["v1", timestamp, input.requestId, input.method, input.path, input.query, digest, principal].join("\n");
  const key = await crypto.subtle.importKey("raw", encoder.encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  return new Headers({ "content-type": "application/json; charset=utf-8", accept: "application/json", "x-teruisi-principal": principal, "x-teruisi-timestamp": timestamp, "x-teruisi-request-id": input.requestId, "x-teruisi-content-sha256": digest, "x-teruisi-signature": `v1=${signature}` });
}

export async function requestDjangoAi<T>(principal: AppPrincipal, input: {
  path: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; query?: URLSearchParams; payload?: Record<string, unknown>; service?: "reader" | "writer";
}, options: { environment?: Environment; fetchImpl?: typeof fetch; signal?: AbortSignal; requestId?: string } = {}): Promise<{ data: T; status: number; revision: string; replayed: boolean }> {
  if (!isPublicAiPath(input.path) && !AI_INTERNAL_PATHS.has(input.path) && !new RegExp(`^/api/ai/callback/${ENTITY}$`).test(input.path)) throw unavailable();
  const environment = options.environment ?? await aiEnvironment();
  const method = input.method ?? "GET";
  const service = input.service ?? (method === "GET" && !input.path.startsWith("/api/ai/artifacts/") ? "reader" : "writer");
  const endpoint = environment[service === "reader" ? "TERUISI_DJANGO_AI_READER_BASE_URL" : "TERUISI_DJANGO_AI_WRITER_BASE_URL"];
  let base: URL;
  try { base = new URL(endpoint ?? ""); } catch { throw unavailable(); }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/"
    || base.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
    || environment.TERUISI_DJANGO_AI_READER_BASE_URL === environment.TERUISI_DJANGO_AI_WRITER_BASE_URL) throw unavailable();
  const body = input.payload === undefined ? "" : JSON.stringify(input.payload);
  if (encoder.encode(body).length > 1024 * 1024 || method === "GET" && body) throw new PublicApiError(413, "payload_too_large", "AI 请求超过内部传输上限。");
  const query = input.query?.toString() ?? "";
  const headers = await aiHeaders({ secret: environment.TERUISI_DJANGO_INTERNAL_SECRET ?? "", principal, method, path: input.path, query, body, requestId: options.requestId ?? crypto.randomUUID() });
  try {
    const result = await fetchBoundedJson({ url: new URL(input.path + (query ? `?${query}` : ""), base).toString(), init: { method, headers, ...(body ? { body } : {}), cache: "no-store" }, timeoutMs: input.path === "/api/ai/chat" ? 300_000 : input.path === "/api/ai/scheduler" ? 220_000 : input.payload?.operation === "analysis-reply" || input.payload?.action === "test" ? 130_000 : 40_000, maxBytes: /\/content$/.test(input.path) ? 9 * 1024 * 1024 : 2 * 1024 * 1024, fetcher: options.fetchImpl, signal: options.signal });
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data) || !/application\/json/i.test(result.response.headers.get("content-type") ?? "")) throw unavailable();
    if (!result.response.ok) {
      const error = result.data as { error?: string; code?: string };
      if (![400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499, 503].includes(result.response.status)) throw unavailable();
      const status = result.response.status === 401 ? 403 : result.response.status === 405 ? 400 : result.response.status;
      const codes = new Set(["invalid_request", "access_denied", "not_found", "conflict", "version_conflict", "payload_too_large", "rate_limited", "ai_chat_not_dispatched", "ai_chat_result_unknown", "ai_request_cancelled", "service_unavailable"]);
      throw new PublicApiError(status as PublicApiError["status"], (codes.has(error.code ?? "") ? error.code : status === 503 ? "service_unavailable" : status === 403 ? "access_denied" : "invalid_request") as PublicApiError["code"], error.error ?? "AI 请求失败。");
    }
    const revision = result.response.headers.get("x-ai-revision") ?? "";
    if (!/^(?:0|[1-9]\d{0,18})$/.test(revision)) throw unavailable();
    return { data: result.data as T, status: result.response.status, revision, replayed: result.response.headers.get("x-teruisi-write-replay") === "1" };
  } catch (error) { if (error instanceof PublicApiError) throw error; throw unavailable(); }
}

export async function aiConsumer<T>(principal: AppPrincipal, payload: Record<string, unknown>, options: Parameters<typeof requestDjangoAi>[2] = {}) {
  const read = ["model-runtime", "model-list", "knowledge", "memory-recall", "analysis-describe"].includes(String(payload.operation));
  return (await requestDjangoAi<T>(principal, { path: "/api/ai/consumer", method: "POST", payload, service: read ? "reader" : "writer" }, options)).data;
}

export async function wakeAiQueue(queue: "agent" | "workflow" | "space") {
  return (await requestDjangoAi({ email: "ai-scheduler@teruisi.internal", displayName: "AI scheduler", role: "operator", scope: null }, { path: "/api/ai/scheduler", method: "POST", payload: { queue } })).data;
}
