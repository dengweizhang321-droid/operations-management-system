import type { AppPrincipal } from "@/lib/auth/authorization";
import { PublicApiError } from "@/lib/http/api-error";

export const salesBackendModes = ["legacy", "shadow", "django"] as const;
export type SalesBackendMode = (typeof salesBackendModes)[number];

export const SALES_GATEWAY_RESPONSE_HEADER_ALLOWLIST = [
  "content-type",
  "retry-after",
  "x-sales-data-revision",
  "x-sales-overview-cache",
  "x-sales-source-revision",
] as const;

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const encoder = new TextEncoder();

type RuntimeEnvironment = Record<string, string | undefined>;

export type SalesGatewayConfig = {
  mode: SalesBackendMode;
  djangoBaseUrl?: string;
  internalSecret?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type SalesReadGatewayOptions = {
  request: Request;
  principal: AppPrincipal;
  legacy: () => Promise<Response>;
  expectedRevision?: string;
  readCurrentRevision?: () => Promise<string>;
  config?: SalesGatewayConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestId?: () => string;
};

type ShadowResult = "match" | "mismatch" | "comparison_skipped" | "upstream_error";

class SalesGatewayUpstreamError extends PublicApiError {
  readonly shadowResult: Extract<ShadowResult, "mismatch" | "upstream_error">;

  constructor(shadowResult: SalesGatewayUpstreamError["shadowResult"]) {
    super(503, "service_unavailable", "Django 销售服务暂时不可用，请稍后重试。");
    this.name = "SalesGatewayUpstreamError";
    this.shadowResult = shadowResult;
  }
}

export type SalesGatewaySignatureInput = {
  secret: string;
  principal: AppPrincipal;
  method: string;
  path: string;
  rawQuery: string;
  timestamp: number;
  requestId: string;
};

function serviceUnavailable(): PublicApiError {
  return new SalesGatewayUpstreamError("upstream_error");
}

function configurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 销售服务配置不完整。",
  );
}

export function salesGatewayConfigFromEnvironment(
  environment: RuntimeEnvironment,
): SalesGatewayConfig {
  const rawMode = environment.TERUISI_SALES_BACKEND?.trim().toLowerCase();
  const mode = rawMode === undefined || rawMode === ""
    ? "legacy"
    : salesBackendModes.find((candidate) => candidate === rawMode);
  if (!mode) throw configurationUnavailable();

  return {
    mode,
    djangoBaseUrl: environment.TERUISI_DJANGO_SALES_BASE_URL?.trim() || undefined,
    internalSecret: environment.TERUISI_DJANGO_INTERNAL_SECRET || undefined,
    timeoutMs: parseBoundedInteger(
      environment.TERUISI_DJANGO_SALES_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: parseBoundedInteger(
      environment.TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
    ),
  };
}

async function loadRuntimeConfig(): Promise<SalesGatewayConfig> {
  let workerEnvironment: RuntimeEnvironment = {};
  try {
    const cloudflare = await import("cloudflare:workers");
    workerEnvironment = cloudflare.env as unknown as RuntimeEnvironment;
  } catch {
    // Unit tests and non-Worker tooling can use process.env or inject config.
  }
  const processEnvironment = globalThis.process?.env as RuntimeEnvironment | undefined;
  const value = (key: string) => workerEnvironment[key] ?? processEnvironment?.[key];
  return salesGatewayConfigFromEnvironment({
    TERUISI_SALES_BACKEND: value("TERUISI_SALES_BACKEND"),
    TERUISI_DJANGO_SALES_BASE_URL: value("TERUISI_DJANGO_SALES_BASE_URL"),
    TERUISI_DJANGO_INTERNAL_SECRET: value("TERUISI_DJANGO_INTERNAL_SECRET"),
    TERUISI_DJANGO_SALES_TIMEOUT_MS: value("TERUISI_DJANGO_SALES_TIMEOUT_MS"),
    TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES: value("TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES"),
  });
}

function parseBoundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[1-9]\d*$/.test(value.trim())) throw configurationUnavailable();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw configurationUnavailable();
  return parsed;
}

function normalizeConfig(config: SalesGatewayConfig): Required<Pick<SalesGatewayConfig, "mode" | "timeoutMs" | "maxResponseBytes">> & SalesGatewayConfig {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!salesBackendModes.includes(config.mode) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw configurationUnavailable();
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw configurationUnavailable();
  }
  return { ...config, timeoutMs, maxResponseBytes };
}

function normalizeDjangoBaseUrl(value: string | undefined): URL {
  if (!value) throw configurationUnavailable();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationUnavailable();
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw configurationUnavailable();
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
  if (parsed.protocol === "http:" && !isLoopback) throw configurationUnavailable();
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw configurationUnavailable();
  return parsed;
}

function requireSecret(value: string | undefined): string {
  if (!value || encoder.encode(value).byteLength < 32) throw configurationUnavailable();
  return value;
}

function rawQueryFromUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return "";
  const fragmentStart = url.indexOf("#", queryStart + 1);
  return url.slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalPrincipal(principal: AppPrincipal): string {
  return JSON.stringify({
    email: principal.email,
    displayName: principal.displayName,
    role: principal.role,
    scope: principal.scope === null
      ? null
      : {
          warehouses: principal.scope.warehouses,
          channels: principal.scope.channels,
          platforms: principal.scope.platforms,
        },
  });
}

export async function createSalesGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (method !== "GET" || !input.path.startsWith("/api/sales/")) throw configurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw configurationUnavailable();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) throw configurationUnavailable();

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw configurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    EMPTY_SHA256,
    principal,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  return new Headers({
    accept: "application/json",
    "x-teruisi-content-sha256": EMPTY_SHA256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) throw serviceUnavailable();
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw serviceUnavailable();
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isJsonContentType(value: string | null): boolean {
  return typeof value === "string" && /^(?:application\/json|application\/[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(value);
}

function copyAllowlistedHeaders(source: Headers): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of SALES_GATEWAY_RESPONSE_HEADER_ALLOWLIST) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function responseWithHeaders(response: Response, additions: HeadersInit = {}): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  for (const [name, value] of new Headers(additions)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchDjangoResponse(
  options: SalesReadGatewayOptions,
  config: ReturnType<typeof normalizeConfig>,
): Promise<Response> {
  const baseUrl = normalizeDjangoBaseUrl(config.djangoBaseUrl);
  const secret = requireSecret(config.internalSecret);
  const requestUrl = new URL(options.request.url);
  const path = requestUrl.pathname;
  const rawQuery = rawQueryFromUrl(options.request.url);
  if (!path.startsWith("/api/sales/")) throw configurationUnavailable();
  const requestId = (options.requestId ?? (() => crypto.randomUUID()))();
  const timestamp = Math.floor((options.now ?? Date.now)() / 1_000);
  const headers = await createSalesGatewayAuthHeaders({
    secret,
    principal: options.principal,
    method: options.request.method,
    path,
    rawQuery,
    timestamp,
    requestId,
  });
  const target = new URL(`${path}${rawQuery ? `?${rawQuery}` : ""}`, baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    const upstream = await (options.fetchImpl ?? fetch)(target, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if ((upstream.status >= 300 && upstream.status < 400) || upstream.status === 401 || upstream.status === 404 || (upstream.status >= 500 && upstream.status !== 503)) {
      await upstream.body?.cancel();
      throw serviceUnavailable();
    }
    if (upstream.status >= 200 && upstream.status < 300) {
      const dataRevision = upstream.headers.get("x-sales-data-revision");
      const sourceRevision = upstream.headers.get("x-sales-source-revision");
      if (!options.expectedRevision || dataRevision === null || sourceRevision === null) {
        await upstream.body?.cancel();
        throw new SalesGatewayUpstreamError("upstream_error");
      }
      if (dataRevision !== options.expectedRevision || sourceRevision !== options.expectedRevision) {
        await upstream.body?.cancel();
        throw new SalesGatewayUpstreamError("mismatch");
      }
    }
    const bytes = await readBoundedBody(upstream, config.maxResponseBytes);
    const bodyForbidden = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
    let parsedBody: unknown = null;
    if (!bodyForbidden) {
      if (!isJsonContentType(upstream.headers.get("content-type")) || bytes.byteLength === 0) throw serviceUnavailable();
      try {
        parsedBody = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch {
        throw serviceUnavailable();
      }
    }
    if (upstream.status === 503) {
      const code = parsedBody && typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>).code
        : null;
      if (code !== "sales_overview_revision_changed") throw serviceUnavailable();
    }
    if (upstream.status >= 200 && upstream.status < 300 && options.readCurrentRevision) {
      let currentRevision: string;
      try {
        currentRevision = await options.readCurrentRevision();
      } catch {
        throw new SalesGatewayUpstreamError("upstream_error");
      }
      if (currentRevision !== options.expectedRevision) {
        throw new SalesGatewayUpstreamError("mismatch");
      }
    }
    const body = bodyForbidden
      ? null
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyAllowlistedHeaders(upstream.headers),
    });
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    if (timedOut || controller.signal.aborted) throw serviceUnavailable();
    throw serviceUnavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function compareJsonResponses(left: Response, right: Response, maximum: number): Promise<Exclude<ShadowResult, "upstream_error">> {
  if (left.status !== right.status) return "mismatch";
  try {
    const [leftBytes, rightBytes] = await Promise.all([
      readBoundedBody(left, maximum),
      readBoundedBody(right, maximum),
    ]);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const leftJson = JSON.parse(decoder.decode(leftBytes)) as unknown;
    const rightJson = JSON.parse(decoder.decode(rightBytes)) as unknown;
    return stableJson(leftJson) === stableJson(rightJson) ? "match" : "mismatch";
  } catch {
    return "comparison_skipped";
  }
}

/**
 * Routes call this only after authenticating and validating their public query contract.
 * A Django cutover never falls back to D1; shadow mode is the only mode that keeps the
 * legacy response while comparing bounded JSON without logging either payload.
 */
export async function routeSalesReadRequest(options: SalesReadGatewayOptions): Promise<Response> {
  const config = normalizeConfig(options.config ?? await loadRuntimeConfig());
  if (config.mode === "legacy") {
    return responseWithHeaders(await options.legacy(), { "x-teruisi-sales-backend": "legacy" });
  }
  if (config.mode === "django") {
    return responseWithHeaders(await fetchDjangoResponse(options, config), { "x-teruisi-sales-backend": "django" });
  }

  const shadowRequest = fetchDjangoResponse(options, config)
    .then((response) => ({ response, shadowResult: null }))
    .catch((error: unknown) => ({
      response: null,
      shadowResult: error instanceof SalesGatewayUpstreamError ? error.shadowResult : "upstream_error" as const,
    }));
  const legacy = await options.legacy();
  const shadow = await shadowRequest;
  const result: ShadowResult = shadow.response === null
    ? shadow.shadowResult ?? "upstream_error"
    : await compareJsonResponses(legacy.clone(), shadow.response.clone(), config.maxResponseBytes);
  return responseWithHeaders(legacy, {
    "x-teruisi-sales-backend": "legacy",
    "x-teruisi-sales-shadow-result": result,
  });
}
