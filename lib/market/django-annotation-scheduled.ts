import type { AppPrincipal } from "@/lib/auth/authorization";
import { runClaimedDjangoMarketVisionTask } from "@/lib/market/django-annotation-runner";

const INTERNAL_ANNOTATION_PRINCIPAL: AppPrincipal = {
  email: "market-annotation-runner@teruisi.internal",
  displayName: "市场云端标注执行器",
  role: "operator",
  scope: null,
};

export async function runScheduledDjangoMarketAnnotation() {
  const result = await runClaimedDjangoMarketVisionTask({
    principal: INTERNAL_ANNOTATION_PRINCIPAL,
  });
  const payload = result.data.result;
  const processedCount = Number(payload.processedCount ?? 0);
  const failedCount = Number(payload.failedCount ?? 0);
  return {
    idle: processedCount === 0 && failedCount === 0,
    processedCount,
    failedCount,
    failureCode: typeof payload.failureCode === "string" ? payload.failureCode : "",
  };
}
