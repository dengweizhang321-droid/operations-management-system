import type { AppPrincipal } from "@/lib/auth/authorization";
import { requestDjangoCustomerServiceAutoAnalysisCandidates, type CustomerServiceAutoAnalysisCandidates } from "@/lib/django/customer-service";
import { PublicApiError } from "@/lib/http/api-error";

export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_OWNER = "local-admin@teruisi.local";
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_DAILY_LIMIT = 480;
export const CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE = 8;
const CANDIDATE_TIMEOUT_MS = 5_000;

type RuntimeEnvironment = Record<string, unknown>;

export type CustomerServiceAutoAnalysisSettings = { enabled: boolean; owner: string; dailyLimit: number };

export function customerServiceAutoAnalysisSettings(environment: RuntimeEnvironment): CustomerServiceAutoAnalysisSettings {
  const switchValue = typeof environment.CUSTOMER_SERVICE_AUTO_ANALYSIS === "string" ? environment.CUSTOMER_SERVICE_AUTO_ANALYSIS.trim().toLowerCase() : "";
  const ownerValue = typeof environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_OWNER === "string" ? environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_OWNER.trim() : "";
  const limitValue = typeof environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT === "string" ? environment.CUSTOMER_SERVICE_AUTO_ANALYSIS_DAILY_LIMIT.trim() : "";
  const limit = /^[1-9]\d{0,8}$/.test(limitValue) ? Number(limitValue) : CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_DAILY_LIMIT;
  return {
    enabled: !["off", "false", "0"].includes(switchValue),
    owner: ownerValue || CUSTOMER_SERVICE_AUTO_ANALYSIS_DEFAULT_OWNER,
    dailyLimit: limit,
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
  loadCandidates?: (principal: AppPrincipal, limit: number, signal: AbortSignal) => Promise<CustomerServiceAutoAnalysisCandidates>;
  hasChatModel?: (principal: AppPrincipal) => Promise<boolean>;
  analyze?: (ids: number[], principal: AppPrincipal) => Promise<{ analyzed: number; requested: number; conflicts: number; failed: number }>;
};

export type CustomerServiceAutoAnalysisResult =
  | { skipped: "disabled" | "owner_unavailable" | "owner_invalid" | "daily_limit" | "no_model" | "no_candidates" | "quota" | "model_unavailable"; analyzedToday?: number }
  | { analyzed: number; requested: number; conflicts: number; failed: number; pendingCount: number };

/** One bounded batch per scheduler tick. Only never-analyzed conversations from recent imports are selected. */
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

  const candidates = await (dependencies.loadCandidates ?? ((who, limit, signal) =>
    requestDjangoCustomerServiceAutoAnalysisCandidates(who, limit, { signal })))(
    principal, CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE, AbortSignal.timeout(CANDIDATE_TIMEOUT_MS),
  );
  if (candidates.analyzedToday >= settings.dailyLimit) return { skipped: "daily_limit", analyzedToday: candidates.analyzedToday };
  const ids = candidates.ids.slice(0, Math.min(CUSTOMER_SERVICE_AUTO_ANALYSIS_BATCH_SIZE, settings.dailyLimit - candidates.analyzedToday));
  if (ids.length === 0) return { skipped: "no_candidates" };

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
    return { analyzed: result.analyzed, requested: result.requested, conflicts: result.conflicts, failed: result.failed, pendingCount: candidates.pendingCount };
  } catch (error) {
    // Shared model quota exhausted or no text model configured: not a failure of this task.
    if (error instanceof PublicApiError && error.status === 429) return { skipped: "quota" };
    if (error instanceof PublicApiError && error.status === 503 && error.message.startsWith("尚未配置可用的文本模型")) return { skipped: "model_unavailable" };
    throw error;
  }
}
