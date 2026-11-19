import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoCustomerServiceAutoAnalysisCandidates, type CustomerServiceAutoAnalysisCandidates, type CustomerServiceAutoAnalysisLane } from "@/lib/django/customer-service";
import { PublicApiError } from "@/lib/http/api-error";

export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_OWNER = "local-admin@teruisi.local";
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_DAILY_LIMIT = 800;
export const CUSTOMER_SERVICE_BACKLOG_ANALYSIS_DEFAULT_DAILY_LIMIT = 6000;
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE = 8;
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
  analyze?: (ids: number[], principal: AppPrincipal) => Promise<{ analyzed: number; requested: number; conflicts: number; failed: number }>;
};

type SkipReason = "disabled" | "owner_unavailable" | "owner_invalid" | "daily_limit" | "no_model" | "no_candidates" | "quota" | "model_unavailable";

export type CustomerServiceAutoAnalysisResult =
  | { skipped: SkipReason; analyzedToday?: number; lane?: CustomerServiceAutoAnalysisLane }
  | { analyzed: number; requested: number; conflicts: number; failed: number; pendingCount: number; lane: CustomerServiceAutoAnalysisLane };

/**
 * One bounded batch per scheduler tick. The "new" lane (first stored within 72 hours) goes first; only when it
 * has no candidates or has used its daily cap does the tick spend its single batch on the "backlog" lane.
 * Each lane has its own daily cap, counted from the lane-split analyzedToday* fields.
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

  const lanes: Array<{ lane: CustomerServiceAutoAnalysisLane; limit: number }> = [{ lane: "new", limit: settings.dailyLimit }];
  if (settings.backlogEnabled) lanes.push({ lane: "backlog", limit: settings.backlogDailyLimit });

  let skipped: CustomerServiceAutoAnalysisResult = { skipped: "no_candidates" };
  for (const { lane, limit } of lanes) {
    const candidates = await load(principal, CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE, AbortSignal.timeout(CANDIDATE_TIMEOUT_MS), lane);
    const analyzedToday = lane === "new" ? candidates.analyzedTodayNew : candidates.analyzedTodayBacklog;
    if (analyzedToday >= limit) { skipped = { skipped: "daily_limit", analyzedToday, lane }; continue; }
    const ids = candidates.ids.slice(0, Math.min(CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE, limit - analyzedToday));
    if (ids.length === 0) { skipped = { skipped: "no_candidates", lane }; continue; }

    const hasModel = await (dependencies.hasChatModel ?? (async (who: AppPrincipal) => {
      const { resolveChatModel } = await import("@/lib/ai/assistant-service");
      return Boolean(await resolveChatModel(who));
    }))(principal);
    if (!hasModel) return { skipped: "no_model" };

    try {
      const analyze = dependencies.analyze ?? (async (batch: number[], who: AppPrincipal) => {
        const { analyzeCustomerServiceConversations } = await import("@/lib/customer-service/analysis");
        return analyzeCustomerServiceConversations(batch, who);
      });
      const result = await analyze(ids, principal);
      const pendingCount = lane === "new" ? candidates.pendingCountNew : candidates.pendingCountBacklog;
      return { analyzed: result.analyzed, requested: result.requested, conflicts: result.conflicts, failed: result.failed, pendingCount, lane };
    } catch (error) {
      // Shared model quota exhausted or no text model configured: not a failure of this task.
      if (error instanceof PublicApiError && error.status === 429) return { skipped: "quota" };
      if (error instanceof PublicApiError && error.status === 503 && error.message.startsWith("尚未配置可用的文本模型")) return { skipped: "model_unavailable" };
      throw error;
    }
  }
  return skipped;
}
