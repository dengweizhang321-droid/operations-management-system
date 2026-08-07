import { ensureAiAssistantSchema } from "@/lib/ai/assistant-service";
import { authenticateLocalAgent, claimLocalAnnotation, completeLocalAnnotation, runCloudAnnotationPump } from "@/lib/market/annotation-service";
import { getMarketDatabase } from "@/lib/market/database";
import { ensureAnnotationSchema } from "@/lib/market/annotation-schema";
import { AnnotationAgentError, annotationAgentErrorResponse } from "@/lib/market/annotation-agent-errors";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function POST(request: Request) {
  try {
    const db = getMarketDatabase();
    await Promise.all([ensureAiAssistantSchema(db), ensureAnnotationSchema(db)]);
    const agent = await authenticateLocalAgent(db, request.headers.get("authorization"));
    const parsed: unknown = await request.json().catch(() => null);
    if (!isRecord(parsed)) throw new AnnotationAgentError("bad_request");
    const body = parsed;
    const action = typeof body.action === "string" ? body.action : "claim";
    if (action === "heartbeat") return Response.json({ ok: true, agent: { id: agent.id, name: agent.name } });
    if (action === "claim") return Response.json({ ok: true, ...(await claimLocalAnnotation(db, agent)) }, { headers: { "cache-control": "no-store" } });
    // 后台泵只推进管理员已在页面上创建好的云端任务，自己不能建任务、不能选模型，
    // 因此 agent token 的影响面被限制在既有任务范围内，撤销 agent 即刻失效。
    if (action === "pump_cloud") {
      if (body.jobId !== undefined && typeof body.jobId !== "string") throw new AnnotationAgentError("bad_request");
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      return Response.json({ ok: true, ...(await runCloudAnnotationPump(db, { jobId: jobId || undefined })) }, { headers: { "cache-control": "no-store" } });
    }
    if (action === "complete") {
      if (typeof body.itemId !== "string" || !body.itemId.trim() || typeof body.leaseToken !== "string" || !body.leaseToken.trim()) throw new AnnotationAgentError("bad_request");
      return Response.json({ ok: true, result: await completeLocalAnnotation(db, agent, {
      itemId: body.itemId, leaseToken: body.leaseToken,
      result: body.result, error: typeof body.error === "string" ? body.error : undefined,
      imageSource: typeof body.imageSource === "string" ? body.imageSource : undefined, resolvedImageUrl: typeof body.resolvedImageUrl === "string" ? body.resolvedImageUrl : undefined,
      }) });
    }
    throw new AnnotationAgentError("bad_request");
  } catch (error) {
    const response = annotationAgentErrorResponse(error);
    return Response.json({ error: response.error }, { status: response.status, headers: { "cache-control": "no-store" } });
  }
}
