import { requireAppPrincipal } from "@/lib/auth/authorization";
import { cancelAiSpaceJob } from "@/lib/ai/space";
import { getSalesDatabase } from "@/lib/sales/database";
import {
  aiJsonResponse,
  aiRouteErrorResponse,
  requireAiId,
  requireAiSameOriginWrite,
} from "@/app/api/ai/route-helpers";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    requireAiSameOriginWrite(request);
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const params = await context.params;
    const id = requireAiId(params.jobId, "jobId");
    return aiJsonResponse({ item: await cancelAiSpaceJob(id, principal, getSalesDatabase()) });
  } catch (error) {
    return aiRouteErrorResponse(error, "取消 AI 空间任务失败");
  }
}
