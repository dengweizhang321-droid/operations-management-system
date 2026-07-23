import { ensureAiAssistantSchema } from "@/lib/ai/assistant-service";
import { authenticateLocalAgent, claimLocalAnnotation, completeLocalAnnotation } from "@/lib/market/annotation-service";
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
