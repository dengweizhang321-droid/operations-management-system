import type { AppPrincipal } from "@/lib/auth/authorization";
import { PublicApiError } from "@/lib/http/api-error";

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
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const encoder = new TextEncoder();

type RuntimeEnvironment = Record<string, string | undefined>;

export type SalesGatewayConfig = {
  djangoBaseUrl?: string;
  internalSecret?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type SalesGatewaySignatureInput = {
  secret: string;
  principal: AppPrincipal;
  method: string;
  path: string;
  rawQuery: string;
  bodySha256?: string;
  timestamp: number;
  requestId: string;
};

function serviceUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 销售服务暂时不可用，请稍后重试。",
  );
}

function configurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 销售服务配置不完整。",
  );
}

function financeConfigurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 财务服务配置不完整。",
  );
}

function netshopConfigurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 网店服务配置不完整。",
  );
}

function marketConfigurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 市场服务配置不完整。",
  );
}

function productsConfigurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 商品经营服务配置不完整。",
  );
}

function inventoryConfigurationUnavailable(): PublicApiError {
  return new PublicApiError(
    503,
    "service_unavailable",
    "Django 库存服务配置不完整。",
  );
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[1-9]\d*$/.test(value.trim())) throw configurationUnavailable();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw configurationUnavailable();
  return parsed;
}

export function salesGatewayConfigFromEnvironment(
  environment: RuntimeEnvironment,
): SalesGatewayConfig {
  return {
    djangoBaseUrl:
      environment.TERUISI_DJANGO_SALES_READER_BASE_URL?.trim()
      || environment.TERUISI_DJANGO_SALES_BASE_URL?.trim()
      || undefined,
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
    TERUISI_DJANGO_SALES_READER_BASE_URL: value("TERUISI_DJANGO_SALES_READER_BASE_URL"),
    TERUISI_DJANGO_SALES_BASE_URL: value("TERUISI_DJANGO_SALES_BASE_URL"),
    TERUISI_DJANGO_INTERNAL_SECRET: value("TERUISI_DJANGO_INTERNAL_SECRET"),
    TERUISI_DJANGO_SALES_TIMEOUT_MS: value("TERUISI_DJANGO_SALES_TIMEOUT_MS"),
    TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES: value("TERUISI_DJANGO_SALES_MAX_RESPONSE_BYTES"),
  });
}

function normalizeConfig(config: SalesGatewayConfig): Required<SalesGatewayConfig> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw configurationUnavailable();
  }
  if (
    !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes <= 0
    || maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw configurationUnavailable();
  }
  return {
    djangoBaseUrl: config.djangoBaseUrl ?? "",
    internalSecret: config.internalSecret ?? "",
    timeoutMs,
    maxResponseBytes,
  };
}

function normalizeDjangoBaseUrl(value: string): URL {
  if (!value) throw configurationUnavailable();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationUnavailable();
  }
  if (
    !/^https?:$/.test(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
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

function requireSecret(value: string): string {
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
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  if (
    !["GET", "POST", "PUT", "DELETE"].includes(method)
    || !input.path.startsWith("/api/sales/")
  ) {
    throw configurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase()
    ?? (method === "GET" ? EMPTY_SHA256 : "");
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw configurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw configurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw configurationUnavailable();
  }

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
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

/** Finance keeps a separate service URL and process role while reusing only
 * the signed principal-envelope protocol. The sales signer above deliberately
 * remains restricted to /api/sales/. */
export async function createFinanceGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (
    !["GET", "POST", "DELETE"].includes(method)
    || !input.path.startsWith("/api/finance/")
  ) {
    throw financeConfigurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase()
    ?? (method === "GET" || method === "DELETE" ? EMPTY_SHA256 : "");
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw financeConfigurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw financeConfigurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw financeConfigurationUnavailable();
  }

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw financeConfigurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

/** Netshop has isolated reader/writer processes but shares the exact signed
 * principal-envelope protocol. Keep the path guard domain-specific so a
 * correctly signed request cannot be replayed into another Django app. */
export async function createNetshopGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (
    !["GET", "POST", "PUT"].includes(method)
    || !input.path.startsWith("/api/netshop/")
  ) {
    throw netshopConfigurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase()
    ?? (method === "GET" ? EMPTY_SHA256 : "");
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw netshopConfigurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw netshopConfigurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw netshopConfigurationUnavailable();
  }

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw netshopConfigurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

/** Market is an independent Django authority. A domain-specific path guard
 * prevents a valid market envelope from being replayed into another app. */
export async function createMarketGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (method !== "POST" || !input.path.startsWith("/api/market/")) {
    throw marketConfigurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw marketConfigurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw marketConfigurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw marketConfigurationUnavailable();
  }

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw marketConfigurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

/** Product operations has isolated reader/writer processes and accepts both
 * JSON and raw chunk requests. Keep its signature path guard domain-specific. */
export async function createProductsGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (
    !["GET", "POST", "PUT"].includes(method)
    || !input.path.startsWith("/api/products/")
  ) {
    throw productsConfigurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase()
    ?? (method === "GET" ? EMPTY_SHA256 : "");
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw productsConfigurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw productsConfigurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw productsConfigurationUnavailable();
  }

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw productsConfigurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

/** Inventory has isolated reader/writer processes and accepts JSON plus raw
 * upload chunks. PATCH is restricted to the replenishment writer endpoint. */
export async function createInventoryGatewayAuthHeaders(
  input: SalesGatewaySignatureInput,
): Promise<Headers> {
  const method = input.method.toUpperCase();
  if (
    !["GET", "POST", "PUT", "PATCH"].includes(method)
    || !input.path.startsWith("/api/inventory/")
  ) {
    throw inventoryConfigurationUnavailable();
  }
  const bodySha256 = input.bodySha256?.trim().toLowerCase()
    ?? (method === "GET" ? EMPTY_SHA256 : "");
  if (!/^[a-f0-9]{64}$/.test(bodySha256)) throw inventoryConfigurationUnavailable();
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw inventoryConfigurationUnavailable();
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw inventoryConfigurationUnavailable();
  }

  const principalBytes = encoder.encode(canonicalPrincipal(input.principal));
  if (principalBytes.byteLength > 16_384) throw inventoryConfigurationUnavailable();
  const principal = base64Url(principalBytes);
  const canonical = [
    "v1",
    String(input.timestamp),
    input.requestId,
    method,
    input.path,
    input.rawQuery,
    bodySha256,
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
    "x-teruisi-content-sha256": bodySha256,
    "x-teruisi-principal": principal,
    "x-teruisi-request-id": input.requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(input.timestamp),
  });
}

export async function salesGatewayBodySha256(body: Uint8Array): Promise<string> {
  const input = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer;
  return hex(await crypto.subtle.digest("SHA-256", input));
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw serviceUnavailable();
  }
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
  return typeof value === "string"
    && /^(?:application\/json|application\/[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(value);
}

function copyAllowlistedHeaders(source: Headers): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of SALES_GATEWAY_RESPONSE_HEADER_ALLOWLIST) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function routeDjangoSalesReadRequest(options: {
  request: Request;
  principal: AppPrincipal;
  config?: SalesGatewayConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestId?: () => string;
}): Promise<Response> {
  const config = normalizeConfig(options.config ?? await loadRuntimeConfig());
  const baseUrl = normalizeDjangoBaseUrl(config.djangoBaseUrl);
  const secret = requireSecret(config.internalSecret);
  const requestUrl = new URL(options.request.url);
  const path = requestUrl.pathname;
  const rawQuery = rawQueryFromUrl(options.request.url);
  if (options.request.method !== "GET" || !path.startsWith("/api/sales/")) {
    throw configurationUnavailable();
  }
  const headers = await createSalesGatewayAuthHeaders({
    secret,
    principal: options.principal,
    method: "GET",
    path,
    rawQuery,
    timestamp: Math.floor((options.now ?? Date.now)() / 1_000),
    requestId: (options.requestId ?? (() => crypto.randomUUID()))(),
  });
  const target = new URL(`${path}${rawQuery ? `?${rawQuery}` : ""}`, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const upstream = await (options.fetchImpl ?? fetch)(target, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (
      (upstream.status >= 300 && upstream.status < 400)
      || upstream.status === 401
      || upstream.status === 404
      || upstream.status >= 500
    ) {
      await upstream.body?.cancel();
      throw serviceUnavailable();
    }
    if (upstream.status >= 200 && upstream.status < 300) {
      const dataRevision = upstream.headers.get("x-sales-data-revision");
      const sourceRevision = upstream.headers.get("x-sales-source-revision");
      if (dataRevision === null || sourceRevision === null || dataRevision !== sourceRevision) {
        await upstream.body?.cancel();
        throw serviceUnavailable();
      }
    }
    const bytes = await readBoundedBody(upstream, config.maxResponseBytes);
    const bodyForbidden = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
    if (!bodyForbidden) {
      if (!isJsonContentType(upstream.headers.get("content-type")) || bytes.byteLength === 0) {
        throw serviceUnavailable();
      }
      try {
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw serviceUnavailable();
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
    throw serviceUnavailable();
  } finally {
    clearTimeout(timeout);
  }
}
