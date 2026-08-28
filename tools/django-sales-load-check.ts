import { createHash, createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENCY = 32;
const MAX_ROUNDS = 100;
const MAX_REQUESTS = 1_000;

export const loadCheckViews = ["full", "dashboard", "category"] as const;
export type LoadCheckView = (typeof loadCheckViews)[number];

export type LoadCheckConfig = {
  baseUrl: URL;
  startDate: string;
  endDate: string;
  concurrency: number;
  rounds: number;
  views: LoadCheckView[];
  timeoutMs: number;
  maxResponseBytes: number;
};

export type LoadCheckSample = {
  view: LoadCheckView;
  round: number;
  worker: number;
  durationMs: number;
  overviewCache: string | null;
  cacheControl: string | null;
  revision: string;
  jsonSha256: string;
  responseBytes: number;
};

export type LoadCheckStatistics = {
  requests: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type LoadCheckReport = {
  revision: string;
  samples: LoadCheckSample[];
  overall: LoadCheckStatistics;
  byView: Record<LoadCheckView, LoadCheckStatistics | null>;
};

type LoadCheckDependencies = {
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestId?: () => string;
  onSample?: (sample: LoadCheckSample) => void;
};

const principal = {
  email: "django-sales-load-check@internal.invalid",
  displayName: "Django Sales Load Check",
  role: "admin",
  scope: null,
} as const;

export class LoadCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadCheckError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx tools/django-sales-load-check.ts \\",
    "    --base-url <http-loopback-or-https-origin> \\",
    "    --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> \\",
    "    --concurrency <1-32> --rounds <1-100> \\",
    "    [--view full,dashboard,category] [--timeout-ms <1-30000>] \\",
    "    [--max-response-bytes <1-8388608>]",
    "",
    "TERUISI_DJANGO_INTERNAL_SECRET must be provided through the environment.",
  ].join("\n");
}

function exactPositiveInteger(raw: string, label: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(raw)) throw new LoadCheckError(`${label} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new LoadCheckError(`${label} must be between 1 and ${maximum}`);
  }
  return value;
}

function validIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

export function validateLoadCheckBaseUrl(raw: string): URL {
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new LoadCheckError("--base-url must be a valid URL");
  }
  if (value.username || value.password || value.search || value.hash || (value.pathname !== "/" && value.pathname !== "")) {
    throw new LoadCheckError("--base-url must be an origin without credentials, path, query, or fragment");
  }
  const hostname = value.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (value.protocol !== "https:" && !(value.protocol === "http:" && loopback)) {
    throw new LoadCheckError("--base-url must use HTTPS, except for exact localhost/127.0.0.1/[::1] loopback URLs");
  }
  return value;
}

function parseViews(raw: string): LoadCheckView[] {
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0 || values.some((value) => !loadCheckViews.includes(value as LoadCheckView))) {
    throw new LoadCheckError(`--view must contain only ${loadCheckViews.join(",")}`);
  }
  return values as LoadCheckView[];
}

export function parseLoadCheckArgs(argv: string[]): LoadCheckConfig {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") throw new LoadCheckError(usage());
    if (!flag?.startsWith("--")) throw new LoadCheckError(`unexpected argument: ${flag ?? ""}`);
    const allowed = new Set([
      "--base-url", "--start-date", "--end-date", "--concurrency", "--rounds", "--view",
      "--timeout-ms", "--max-response-bytes",
    ]);
    if (!allowed.has(flag)) throw new LoadCheckError(`unknown option: ${flag}`);
    if (values.has(flag)) throw new LoadCheckError(`option cannot be repeated: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new LoadCheckError(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }

  const required = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new LoadCheckError(`${flag} is required`);
    return value;
  };
  const startDate = required("--start-date");
  const endDate = required("--end-date");
  if (!validIsoDate(startDate) || !validIsoDate(endDate)) {
    throw new LoadCheckError("--start-date and --end-date must be valid YYYY-MM-DD dates");
  }
  if (startDate > endDate) throw new LoadCheckError("--start-date must not be after --end-date");

  const concurrency = exactPositiveInteger(required("--concurrency"), "--concurrency", MAX_CONCURRENCY);
  const rounds = exactPositiveInteger(required("--rounds"), "--rounds", MAX_ROUNDS);
  const views = parseViews(values.get("--view") ?? "full");
  if (concurrency * rounds * views.length > MAX_REQUESTS) {
    throw new LoadCheckError(`planned request count exceeds ${MAX_REQUESTS}`);
  }

  return {
    baseUrl: validateLoadCheckBaseUrl(required("--base-url")),
    startDate,
    endDate,
    concurrency,
    rounds,
    views,
    timeoutMs: values.has("--timeout-ms")
      ? exactPositiveInteger(required("--timeout-ms"), "--timeout-ms", MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
    maxResponseBytes: values.has("--max-response-bytes")
      ? exactPositiveInteger(required("--max-response-bytes"), "--max-response-bytes", MAX_RESPONSE_BYTES)
      : DEFAULT_MAX_RESPONSE_BYTES,
  };
}

function requireSecret(environment: Record<string, string | undefined>): string {
  const secret = environment.TERUISI_DJANGO_INTERNAL_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new LoadCheckError("TERUISI_DJANGO_INTERNAL_SECRET must contain at least 32 UTF-8 bytes");
  }
  return secret;
}

function targetFor(config: LoadCheckConfig, view: LoadCheckView): URL {
  const path = view === "category" ? "/api/sales/category-analysis" : "/api/sales/summary";
  const target = new URL(path, config.baseUrl);
  if (view !== "category") target.searchParams.set("range", "custom");
  target.searchParams.set("startDate", config.startDate);
  target.searchParams.set("endDate", config.endDate);
  if (view === "dashboard") target.searchParams.set("view", "dashboard");
  if (view === "category") {
    target.searchParams.set("page", "1");
    target.searchParams.set("pageSize", "100");
  }
  return target;
}

function signedHeaders(secret: string, target: URL, timestamp: number, requestId: string): Headers {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
    throw new LoadCheckError("generated request identity is invalid");
  }
  const principalBase64 = Buffer.from(JSON.stringify(principal), "utf8").toString("base64url");
  const canonical = [
    "v1",
    String(timestamp),
    requestId,
    "GET",
    target.pathname,
    target.search.slice(1),
    EMPTY_BODY_SHA256,
    principalBase64,
  ].join("\n");
  const signature = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return new Headers({
    accept: "application/json",
    "x-teruisi-content-sha256": EMPTY_BODY_SHA256,
    "x-teruisi-principal": principalBase64,
    "x-teruisi-request-id": requestId,
    "x-teruisi-signature": `v1=${signature}`,
    "x-teruisi-timestamp": String(timestamp),
  });
}

async function readBoundedJson(response: Response, maximum: number): Promise<{ value: unknown; bytes: number }> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !/^(?:application\/json|application\/[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(contentType)) {
    await response.body?.cancel();
    throw new LoadCheckError("response content-type is not JSON");
  }
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    if (!/^\d+$/.test(declaredRaw)) {
      await response.body?.cancel();
      throw new LoadCheckError("response content-length is invalid");
    }
    if (Number(declaredRaw) > maximum) {
      await response.body?.cancel();
      throw new LoadCheckError(`response exceeds ${maximum} bytes`);
    }
  }
  if (!response.body) throw new LoadCheckError("response body is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new LoadCheckError(`response exceeds ${maximum} bytes`);
    }
    chunks.push(result.value);
  }
  if (total === 0) throw new LoadCheckError("response body is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { value: JSON.parse(text) as unknown, bytes: total };
  } catch {
    throw new LoadCheckError("response body is not valid UTF-8 JSON");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function sample(
  config: LoadCheckConfig,
  view: LoadCheckView,
  round: number,
  worker: number,
  secret: string,
  dependencies: LoadCheckDependencies,
): Promise<LoadCheckSample> {
  const target = targetFor(config, view);
  const timestamp = Math.floor((dependencies.now ?? Date.now)() / 1_000);
  const requestId = (dependencies.requestId ?? (() => `load-check-${randomUUID()}`))();
  const headers = signedHeaders(secret, target, timestamp, requestId);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const started = performance.now();
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(target, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new LoadCheckError(`${view} request returned HTTP ${response.status}`);
    }
    const dataRevision = response.headers.get("x-sales-data-revision");
    const sourceRevision = response.headers.get("x-sales-source-revision");
    if (!dataRevision || dataRevision !== sourceRevision || !/^\d+:\d+$/.test(dataRevision)) {
      await response.body?.cancel();
      throw new LoadCheckError(`${view} response revision headers are missing or inconsistent`);
    }
    const body = await readBoundedJson(response, config.maxResponseBytes);
    const durationMs = performance.now() - started;
    return {
      view,
      round,
      worker,
      durationMs: Number(durationMs.toFixed(2)),
      overviewCache: response.headers.get("x-sales-overview-cache"),
      cacheControl: response.headers.get("cache-control"),
      revision: dataRevision,
      jsonSha256: createHash("sha256").update(stableJson(body.value), "utf8").digest("hex"),
      responseBytes: body.bytes,
    };
  } catch (error) {
    if (timedOut || controller.signal.aborted) throw new LoadCheckError(`${view} request timed out after ${config.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Number((sorted[index] ?? 0).toFixed(2));
}

function statistics(samples: LoadCheckSample[]): LoadCheckStatistics {
  const durations = samples.map((value) => value.durationMs).sort((left, right) => left - right);
  return {
    requests: durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: Number((durations.at(-1) ?? 0).toFixed(2)),
  };
}

export async function runLoadCheck(config: LoadCheckConfig, dependencies: LoadCheckDependencies = {}): Promise<LoadCheckReport> {
  const secret = requireSecret(dependencies.environment ?? process.env);
  const samples: LoadCheckSample[] = [];
  const expectedDigest = new Map<LoadCheckView, string>();
  let expectedRevision: string | null = null;

  for (const view of config.views) {
    for (let round = 1; round <= config.rounds; round += 1) {
      const batch = await Promise.all(Array.from(
        { length: config.concurrency },
        (_, index) => sample(config, view, round, index + 1, secret, dependencies),
      ));
      for (const result of batch) {
        const digest = expectedDigest.get(view);
        if (digest !== undefined && digest !== result.jsonSha256) {
          throw new LoadCheckError(`${view} JSON digest changed during the load check`);
        }
        expectedDigest.set(view, result.jsonSha256);
        if (expectedRevision !== null && expectedRevision !== result.revision) {
          throw new LoadCheckError(`revision changed during the load check: ${expectedRevision} -> ${result.revision}`);
        }
        expectedRevision = result.revision;
        samples.push(result);
        dependencies.onSample?.(result);
      }
    }
  }
  if (expectedRevision === null || samples.length === 0) throw new LoadCheckError("load check produced no samples");

  return {
    revision: expectedRevision,
    samples,
    overall: statistics(samples),
    byView: Object.fromEntries(loadCheckViews.map((view) => {
      const selected = samples.filter((sampleValue) => sampleValue.view === view);
      return [view, selected.length > 0 ? statistics(selected) : null];
    })) as Record<LoadCheckView, LoadCheckStatistics | null>,
  };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some((value) => value === "--help" || value === "-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const config = parseLoadCheckArgs(process.argv.slice(2));
  const report = await runLoadCheck(config, {
    onSample(sampleValue) {
      process.stdout.write(`${JSON.stringify({ type: "sample", ...sampleValue })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify({
    type: "summary",
    baseUrl: config.baseUrl.origin,
    startDate: config.startDate,
    endDate: config.endDate,
    views: config.views,
    concurrency: config.concurrency,
    rounds: config.rounds,
    revision: report.revision,
    overall: report.overall,
    byView: report.byView,
  })}\n`);
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (directEntry === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
