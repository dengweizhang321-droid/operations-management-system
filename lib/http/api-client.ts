import { ApiError } from "@/lib/http/api-error";
import { observeDuration, observeServerTiming, type PerformanceObserver } from "./performance";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type RequestJsonInit = Omit<RequestInit, "body"> & {
  body?: BodyInit | JsonValue;
};

type ErrorPayload = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isNativeBody(value: unknown): value is BodyInit {
  if (typeof value === "string") return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof FormData !== "undefined" && value instanceof FormData) return true;
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    return true;
  }
  if (typeof ArrayBuffer !== "undefined") {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  }
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return true;
  }
  return false;
}

function prepareBody(
  body: RequestJsonInit["body"],
  headers: Headers,
): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isNativeBody(body)) return body;
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(body);
}

function parseErrorPayload(value: unknown): ErrorPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ErrorPayload;
}

function errorMessage(payload: ErrorPayload | null, status: number): string {
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  return `请求失败（${status}）`;
}

export type ObservedJsonOptions = {
  fetcher?: typeof fetch;
  maxBytes: number;
  observe?: PerformanceObserver;
  signal?: AbortSignal | null;
};

async function readJson(response: Response, options?: ObservedJsonOptions): Promise<unknown> {
  const bodyStarted = options?.observe ? performance.now() : 0;
  const text = options ? await readLimitedText(response, options.maxBytes, options.signal) : await response.text();
  if (options?.observe) observeDuration(options.observe, "browser.body", performance.now() - bodyStarted);
  if (!text.trim()) return undefined;
  const decodeStarted = options?.observe ? performance.now() : 0;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiError({
      status: response.status,
      code: "invalid_json_response",
      message: "服务器返回的数据格式不正确",
      cause,
    });
  } finally {
    if (options?.observe) observeDuration(options.observe, "browser.decode", performance.now() - decodeStarted);
  }
}

async function readLimitedText(response: Response, maxBytes: number, signal?: AbortSignal | null) {
  const rejectSize = () => new ApiError({ status: response.status, code: "response_too_large", message: "服务器响应超过读取上限" });
  if (Number(response.headers.get("content-length")) > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    throw rejectSize();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const item = await reader.read();
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw rejectSize();
      }
      text += decoder.decode(item.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { signal?.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export async function requestJson<T = unknown>(
  input: RequestInfo | URL,
  init: RequestJsonInit = {},
): Promise<T> {
  return executeJson<T>(input, init);
}

/** Explicit bounded transport; legacy requestJson retains its original defaults. */
export async function requestJsonObserved<T = unknown>(input: RequestInfo | URL, init: RequestJsonInit, options: ObservedJsonOptions): Promise<T> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 16 * 1024 * 1024) throw new TypeError("invalid response byte limit");
  return executeJson<T>(input, init, options);
}

async function executeJson<T>(input: RequestInfo | URL, init: RequestJsonInit, options?: ObservedJsonOptions): Promise<T> {
  const signal = init.signal ?? options?.signal;
  if (options && signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");

  const body = prepareBody(init.body, headers);
  let response: Response;
  const headersStarted = options?.observe ? performance.now() : 0;
  try {
    response = await (options?.fetcher ?? fetch)(input, {
      ...init,
      ...(options ? { signal } : {}),
      body,
      headers,
      credentials: init.credentials ?? "same-origin",
      cache: init.cache ?? "no-store",
    });
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: "网络请求失败",
      cause,
    });
  }

  if (options?.observe) {
    observeDuration(options.observe, "browser.headers", performance.now() - headersStarted);
    observeServerTiming(response.headers.get("server-timing"), options.observe);
  }
  if (options && signal?.aborted) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const payload = await readJson(response, options ? { ...options, signal } : undefined);
  if (!response.ok) {
    const errorPayload = parseErrorPayload(payload);
    throw new ApiError({
      status: response.status,
      code:
        typeof errorPayload?.code === "string" && errorPayload.code.trim()
          ? errorPayload.code.trim()
          : `http_${response.status}`,
      message: errorMessage(errorPayload, response.status),
      details: errorPayload?.details,
    });
  }

  return payload as T;
}
