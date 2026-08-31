import { requireAppPrincipal } from "@/lib/auth/authorization";
import { getAiSpaceJob } from "@/lib/ai/space";
import { getSalesDatabase } from "@/lib/sales/database";
import { aiJsonResponse, aiRouteErrorResponse, requireAiId } from "@/app/api/ai/route-helpers";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await requireAppPrincipal();
    const params = await context.params;
    const id = requireAiId(params.jobId, "jobId");
    return aiJsonResponse({ item: await getAiSpaceJob(id, principal, getSalesDatabase()) });
  } catch (error) {
    return aiRouteErrorResponse(error, "读取 AI 空间任务失败");
  }
}
