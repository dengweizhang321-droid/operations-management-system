import { requireAppPrincipal } from "@/lib/auth/authorization";
import { requireAiExpectedVersionBody, resumeAiWorkflowRun } from "@/lib/ai/agent-workflows";
import { getSalesDatabase } from "@/lib/sales/database";
import {
  aiJsonResponse,
  aiRouteErrorResponse,
  readAiJsonObject,
  requireAiId,
  requireAiSameOriginWrite,
} from "@/app/api/ai/route-helpers";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    requireAiSameOriginWrite(request);
    const principal = await requireAppPrincipal(["admin", "operator", "analyst"]);
    const params = await context.params;
    const runId = requireAiId(params.runId, "runId");
    const expectedVersion = requireAiExpectedVersionBody(await readAiJsonObject(request));
    return aiJsonResponse({ item: await resumeAiWorkflowRun(runId, expectedVersion, principal, getSalesDatabase()) });
  } catch (error) {
    return aiRouteErrorResponse(error, "恢复 AI 工作流失败");
  }
}
