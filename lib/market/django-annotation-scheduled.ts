import type { AppPrincipal } from "@/lib/auth/authorization";
import { annotationCommand, annotationQuery, runClaimedDjangoMarketVisionTask } from "@/lib/market/django-annotation-runner";
import { dispatchAnnotationJobs, type AnnotationDispatchJob } from "@/lib/market/annotation-dispatch";

const INTERNAL_ANNOTATION_PRINCIPAL: AppPrincipal = {
  email: "market-annotation-runner@teruisi.internal",
  displayName: "市场云端标注执行器",
  role: "operator",
  scope: null,
};

/**
 * Imports that finished caching their images may enable automatic recognition. A cheap read-only
 * check runs every tick; the write command runs only when work is due. Nothing here may delay or
 * prevent dispatch of jobs that already exist, so every failure is swallowed.
 */
async function ensureAutoAnnotation() {
  try {
    const due = await annotationQuery<{ due?: boolean }>(
      INTERNAL_ANNOTATION_PRINCIPAL, "auto_annotation_due", {}, AbortSignal.timeout(3_000),
    );
    if (due.data.due !== true) return;
    await annotationCommand(
      INTERNAL_ANNOTATION_PRINCIPAL, { action: "ensure_auto_annotation" }, AbortSignal.timeout(20_000),
    );
  } catch {
    // The next scheduler tick re-evaluates from persisted state.
  }
}

export async function runScheduledDjangoMarketAnnotation(signal?: AbortSignal) {
  await ensureAutoAnnotation();
  const response = await annotationQuery<{ jobs: AnnotationDispatchJob[] }>(
    INTERNAL_ANNOTATION_PRINCIPAL, "dispatch", { limit: 5 },
  );
  if (!Array.isArray(response.data.jobs) || response.data.jobs.length > 5) throw new Error("Django 市场派发列表无效");
  const { resolveAiBackgroundPrincipal } = await import("@/lib/ai/background-principal");
  const dispatched = await dispatchAnnotationJobs<{ principal: AppPrincipal; coordinatorToken: string }>({
    jobs: response.data.jobs,
    signal,
    prepare: async (job) => {
      // The scheduler identity may coordinate the market queue, but may not
      // impersonate a user when requesting a paid model runtime from AI.
      const owner = await resolveAiBackgroundPrincipal(job.ownerEmail, "null");
      // A service/maintenance outage is not a change to the user's run intent.
      // No lease/model is started; the existing scheduler rechecks next round.
      if (!owner.ok && owner.retryable) return null;
      if (!owner.ok || !["operator", "admin"].includes(owner.principal.role) || owner.principal.scope !== null) {
        await annotationCommand(INTERNAL_ANNOTATION_PRINCIPAL, {
          action: "set_cloud_run_state", jobId: job.jobId, state: "paused",
          failureCode: "authorization_revoked", failureMessage: "标注任务发起账号或数据权限已变化",
        }, AbortSignal.timeout(5_000));
        return null;
      }
      const begun = await annotationCommand<{ coordinatorToken?: string }>(owner.principal, { action: "begin_dispatch", jobId: job.jobId }, AbortSignal.timeout(5_000));
      const coordinatorToken = begun.data.result.coordinatorToken;
      if (!coordinatorToken) return null;
      return { principal: owner.principal, coordinatorToken };
    },
    run: async (job, handle) => {
      const result = await runClaimedDjangoMarketVisionTask({ ...handle, jobId: job.jobId });
      return result.data.result;
    },
    release: async (job, handle) => {
      await annotationCommand(handle.principal, { action: "end_dispatch", jobId: job.jobId, coordinatorToken: handle.coordinatorToken }, AbortSignal.timeout(5_000));
    },
  });
  const remaining = await annotationQuery<{ jobs: AnnotationDispatchJob[] }>(INTERNAL_ANNOTATION_PRINCIPAL, "dispatch", { limit: 5 }, AbortSignal.timeout(5_000));
  return { ...dispatched, continueImmediately: !signal?.aborted && dispatched.jobCount > 0 && remaining.data.jobs.length > 0 };
}
