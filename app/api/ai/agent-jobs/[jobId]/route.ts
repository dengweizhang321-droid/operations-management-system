import { requireAppPrincipal } from "@/lib/auth/authorization";
import { getAiAgentJob } from "@/lib/ai/agent-workflows";
import { getSalesDatabase } from "@/lib/sales/database";
import { aiJsonResponse, aiRouteErrorResponse, requireAiId } from "@/app/api/ai/route-helpers";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await requireAppPrincipal();
    const params = await context.params;
    const jobId = requireAiId(params.jobId, "jobId");
    return aiJsonResponse({ item: await getAiAgentJob(jobId, principal, getSalesDatabase()) });
  } catch (error) {
    return aiRouteErrorResponse(error, "读取 AI Agent 任务失败");
  }
}
