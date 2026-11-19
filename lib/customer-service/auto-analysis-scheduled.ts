import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoCustomerServiceAutoAnalysisCandidates, type CustomerServiceAutoAnalysisCandidates, type CustomerServiceAutoAnalysisLane } from "@/lib/django/customer-service";
import { PublicApiError } from "@/lib/http/api-error";

export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_OWNER = "local-admin@teruisi.local";
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_DAILY_LIMIT = 800;
export const CUSTOMER_SERVICE_BACKLOG_ANALYSIS_DEFAULT_DAILY_LIMIT = 6000;
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE = 8;
/** Parallel model batches per tick; matches BACKGROUND_ANALYSIS_SLOTS in backend/ai_assistant/views.py. */
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_MAX_PARALLEL_BATCHES = 3;
/** Parallel batches while people are likely at work (08:00-24:00 Asia/Shanghai): leaves writer threads for interactive requests. */
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DAYTIME_PARALLEL_BATCHES = 2;

/**
 * Parallel batches for a tick at `now`: all MAX_PARALLEL_BATCHES between 00:00 and 08:00 Shanghai time,
 * DAYTIME_PARALLEL_BATCHES otherwise. Shanghai has no daylight saving, so the offset is a fixed +8 h.
 */
export function backgroundParallelism(now: Date) {
  const shanghaiHour = (now.getUTCHours() + 8) % 24;
  return shanghaiHour < 8 ? CUSTOMER_SERVICE_AUTO_ANALYSIS_MAX_PARALLEL_BATCHES : CUSTOMER_SERVICE_AUTO_ANALYSIS_DAYTIME_PARALLEL_BATCHES;
}
const CANDIDATE_TIMEOUT_MS = 5_000;

type RuntimeEnvironment = Record<string, unknown>;

export type CustomerServiceAutoAnalysisSettings = {
  enabled: boolean;
  owner: string;
  /** Daily cap of the "new" lane (conversations first stored within 72 hours). */
  dailyLimit: number;
  backlogEnabled: boolean;
  /** Daily cap of the "backlog" lane (every other never-analyzed conversation). */
  backlogDailyLimit: number;
};

function positiveLimit(value: unknown, fallback: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[1-9]\d{0,8}$/.test(text) ? Number(text) : fallback;
}

export function customerServiceAutoAnalysisSettings(environment: RuntimeEnvironment): CustomerServiceAutoAnalysisSettings {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const off = ["off", "false", "0"];
  return {
    enabled: !off.includes(text(environment.CUSTOMER_SERVICE_AUTO_ANALYSIS).toLowerCase()),
    owner: text(environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_OWNER) || CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_OWNER,
    dailyLimit: positiveLimit(environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT, CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_DAILY_LIMIT),
    backlogEnabled: !off.includes(text(environment.CUSTOMER_SERVICE_BACKLOG_ANALYSIS).toLowerCase()),
    backlogDailyLimit: positiveLimit(environment.CUSTOMER_SERVICE_BACKLOG_ANALYSIS_DAILY_LIMIT, CUSTOMER_SERVICE_BACKLOG_ANALYSIS_DEFAULT_DAILY_LIMIT),
  };
}

export async function readCustomerServiceAutoAnalysisSettings(): Promise<CustomerServiceAutoAnalysisSettings> {
  let workerEnvironment: RuntimeEnvironment = {};
  try {
    workerEnvironment = (await import("cloudflare:workers")).env as unknown as RuntimeEnvironment;
  } catch {
    // Tests and local tools fall back to process.env.
  }
  const processEnvironment = (globalThis as typeof globalThis & { process?: { env?: RuntimeEnvironment } }).process?.env ?? {};
  return customerServiceAutoAnalysisSettings({ ...processEnvironment, ...workerEnvironment });
}

type BackgroundPrincipalResult =
  | { ok: true; principal: AppPrincipal }
  | { ok: false; retryable?: boolean };

export type CustomerServiceAutoAnalysisDependencies = {
  settings?: () => Promise<CustomerServiceAutoAnalysisSettings>;
  resolvePrincipal?: (owner: string) => Promise<BackgroundPrincipalResult>;
  loadCandidates?: (principal: AppPrincipal, limit: number, signal: AbortSignal, lane: CustomerServiceAutoAnalysisLane) => Promise<CustomerServiceAutoAnalysisCandidates>;
  hasChatModel?: (principal: AppPrincipal) => Promise<boolean>;
  now?: () => Date;
  analyze?: (ids: number[], principal: AppPrincipal, options: { background: true }) => Promise<{ analyzed: number; requested: number; conflicts: number; failed: number }>;
};

type SkipReason = "disabled" | "owner_unavailable" | "owner_invalid" | "daily_limit" | "no_candidates" | "no_model" | "quota" | "model_unavailable";

export type CustomerServiceAutoAnalysisResult =
  | { skipped: SkipReason; analyzedToday?: number; lane?: CustomerServiceAutoAnalysisLane }
  | {
    analyzed: number; requested: number; conflicts: number; failed: number;
    /** Capped pending count of the first dispatched batch's lane. */
    pendingCount: number; lane: CustomerServiceAutoAnalysisLane;
    /** Batches dispatched this tick, and how many of them were rejected (quota, unavailable or error). */
    batches: number; rejectedBatches: number;
  };

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * One scheduler tick dispatches up to backgroundParallelism(now) batches of at most BATCH_SIZE conversations,
 * in parallel. The "new" lane (first stored within 72 hours) is filled first; the remaining batch slots go
 * to the "backlog" lane. Each lane has its own daily cap, counted from the lane-split analyzedToday* fields,
 * and the ids of all batches are disjoint. A failing batch never affects the others.
 *
 * Ticks cannot overlap: the local trigger supervisor starts the next tick only after the previous one
 * (which awaits this function) has finished, so at most that many model calls are in flight.
 */
export async function runScheduledCustomerServiceAnalysis(
  dependencies: CustomerServiceAutoAnalysisDependencies = {},
): Promise<CustomerServiceAutoAnalysisResult> {
  const settings = await (dependencies.settings ?? readCustomerServiceAutoAnalysisSettings)();
  if (!settings.enabled) return { skipped: "disabled" };

  const owner = await (dependencies.resolvePrincipal ?? (async (email: string) => {
    const { resolveAiBackgroundPrincipal } = await import("@/lib/ai/background-principal");
    return resolveAiBackgroundPrincipal(email, "null");
  }))(settings.owner);
  // A service outage is not a change of authorization; the next tick retries.
  if (!owner.ok && owner.retryable) return { skipped: "owner_unavailable" };
  if (!owner.ok || !["operator", "admin"].includes(owner.principal.role) || owner.principal.scope !== null) {
    console.error("customer service auto analysis skipped: owner account is invalid or has a restricted data scope");
    return { skipped: "owner_invalid" };
  }
  const principal = owner.principal;
  const load = dependencies.loadCandidates ?? ((who, limit, signal, lane) =>
    requestDjangoCustomerServiceAutoAnalysisCandidates(who, limit, { signal }, lane));

  const parallelism = backgroundParallelism((dependencies.now ?? (() => new Date()))());
  const lanes: Array<{ lane: CustomerServiceAutoAnalysisLane; limit: number }> = [{ lane: "new", limit: settings.dailyLimit }];
  if (settings.backlogEnabled) lanes.push({ lane: "backlog", limit: settings.backlogDailyLimit });

  const planned: Array<{ lane: CustomerServiceAutoAnalysisLane; ids: number[]; pendingCount: number }> = [];
  const taken = new Set<number>();
  let skipped: CustomerServiceAutoAnalysisResult = { skipped: "no_candidates" };
  for (const { lane, limit } of lanes) {
    const slots = parallelism - planned.length;
    if (slots <= 0) break;
    const wanted = slots * CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE;
    const candidates = await load(principal, wanted, AbortSignal.timeout(CANDIDATE_TIMEOUT_MS), lane);
    const analyzedToday = lane === "new" ? candidates.analyzedTodayNew : candidates.analyzedTodayBacklog;
    if (analyzedToday >= limit) { skipped = { skipped: "daily_limit", analyzedToday, lane }; continue; }
    // A conversation can cross the 72 h boundary between the two lane reads; never plan it twice.
    const ids = candidates.ids.filter((id) => !taken.has(id)).slice(0, Math.min(wanted, limit - analyzedToday));
    if (ids.length === 0) { skipped = { skipped: "no_candidates", lane }; continue; }
    const pendingCount = lane === "new" ? candidates.pendingCountNew : candidates.pendingCountBacklog;
    for (const batch of chunk(ids, CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE)) planned.push({ lane, ids: batch, pendingCount });
    for (const id of ids) taken.add(id);
  }
  if (planned.length === 0) return skipped;

  const hasModel = await (dependencies.hasChatModel ?? (async (who: AppPrincipal) => {
    const { resolveChatModel } = await import("@/lib/ai/assistant-service");
    return Boolean(await resolveChatModel(who));
  }))(principal);
  if (!hasModel) return { skipped: "no_model" };

  const analyze = dependencies.analyze ?? (async (batch: number[], who: AppPrincipal, options: { background: true }) => {
    const { analyzeCustomerServiceConversations } = await import("@/lib/customer-service/analysis");
    return analyzeCustomerServiceConversations(batch, who, options);
  });
  const settled = await Promise.allSettled(planned.map((batch) => analyze(batch.ids, principal, { background: true })));

  const total = { analyzed: 0, requested: 0, conflicts: 0, failed: 0 };
  let fulfilled = 0;
  let quota = false;
  let unexpected: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      fulfilled += 1;
      total.analyzed += outcome.value.analyzed;
      total.requested += outcome.value.requested;
      total.conflicts += outcome.value.conflicts;
      total.failed += outcome.value.failed;
      continue;
    }
    const error = outcome.reason;
    // Shared model quota exhausted or no text model configured: not a failure of this task.
    if (error instanceof PublicApiError && error.status === 429) quota = true;
    else if (error instanceof PublicApiError && error.status === 503 && error.message.startsWith("尚未配置可用的文本模型")) continue;
    else if (unexpected === null) unexpected = error;
  }
  const rejectedBatches = settled.length - fulfilled;
  if (fulfilled === 0) {
    if (unexpected !== null) throw unexpected;
    return { skipped: quota ? "quota" : "model_unavailable" };
  }
  // Other batches succeeded: report their work and keep the odd failure visible in the log.
  if (unexpected !== null) console.error(`customer service auto analysis: ${rejectedBatches} of ${settled.length} batches failed: ${unexpected instanceof Error ? unexpected.message.slice(0, 200) : "unknown error"}`);
  return { ...total, pendingCount: planned[0]!.pendingCount, lane: planned[0]!.lane, batches: settled.length, rejectedBatches };
}
