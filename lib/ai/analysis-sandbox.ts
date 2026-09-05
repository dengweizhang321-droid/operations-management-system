import type { AppPrincipal } from "@/lib/auth/authorization";
import { aiConsumer } from "@/lib/django/ai-service";
export const describeAiAnalysisDatasets = (principal: AppPrincipal) => aiConsumer<Record<string, unknown>>(principal, { operation: "analysis-describe" });
export const runAndRecordAiAnalysisPlan = (input: unknown, principal: AppPrincipal, requestId: string) => aiConsumer<Record<string, unknown>>(principal, { operation: "analysis-plan", input }, { requestId });
