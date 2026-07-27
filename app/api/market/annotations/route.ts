import { ensureAiAssistantSchema } from "@/lib/ai/assistant-service";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { getMarketDatabase } from "@/lib/market/database";
import { ensureAnnotationSchema } from "@/lib/market/annotation-schema";
import {
  activatePromptVersion, commitAnnotationItems, commitSelectedAnnotationItems, createAnnotationJob, createLocalAgent, createPromptVersion,
  createValidationRun, deletePromptVersion, generatePromptVersion, getAnnotationWorkspace, markAnnotationsAsGold,
  revokeLocalAgent, runNextCloudAnnotation, runNextValidation, setFilteredAnnotationSelection, updateAnnotationItems,
} from "@/lib/market/annotation-service";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (body: JsonRecord, key: string) => typeof body[key] === "string" ? body[key] as string : "";
const texts = (body: JsonRecord, key: string) => Array.isArray(body[key]) ? (body[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];
const integerParam = (params: URLSearchParams, key: string, fallback: number) => {
  const value = params.get(key);
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${key} 必须是整数`);
  return Number(value);
};
const publicError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  if (/\b(SQL|D1_|constraint|UNIQUE|no such|database|column|table)\b/i.test(error.message)) return fallback;
  return error.message.slice(0, 400);
};

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal();
    const db = getMarketDatabase();
    await Promise.all([ensureAiAssistantSchema(db), ensureAnnotationSchema(db)]);
    const params = new URL(request.url).searchParams;
    const payload = await getAnnotationWorkspace(db, {
      jobId: params.get("jobId")?.trim() || undefined,
      aggregateJobs: params.get("aggregateJobs") === "1",
      itemCategory: params.get("itemCategory")?.trim() || undefined,
      itemCategories: params.getAll("itemCategory"),
      q: params.get("q")?.trim() || undefined,
      page: integerParam(params, "page", 1), pageSize: integerParam(params, "pageSize", 30),
      itemPage: integerParam(params, "itemPage", 1), itemPageSize: integerParam(params, "itemPageSize", 20),
      itemSegment: params.get("itemSegment")?.trim() || undefined,
      storageStatus: params.get("storageStatus") === "committed" ? "committed" : params.get("storageStatus") === "pending" ? "pending" : undefined,
      recognitionSource: params.get("recognitionSource") === "ai" ? "ai" : params.get("recognitionSource") === "non_ai" ? "non_ai" : undefined,
      includeAgents: principal.role === "admin",
    });
    return Response.json({ ...payload, principal }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return Response.json({ error: publicError(error, "读取 SKU AI 标注工作台失败") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed: unknown = await request.json().catch(() => null);
    if (!record(parsed)) return Response.json({ error: "请求数据必须是 JSON 对象" }, { status: 400 });
    const action = text(parsed, "action");
    const adminActions = new Set(["commit", "commit_selected", "activate_prompt", "rollback_prompt", "delete_prompt", "create_agent", "revoke_agent", "mark_gold"]);
    const principal = await requireAppPrincipal(adminActions.has(action) ? ["admin"] : ["operator", "admin"]);
    const db = getMarketDatabase();
    await Promise.all([ensureAiAssistantSchema(db), ensureAnnotationSchema(db)]);
    let result: unknown;
    switch (action) {
      case "create_job": result = await createAnnotationJob(db, { category: text(parsed, "category"), promptVersionId: text(parsed, "promptVersionId"), executor: text(parsed, "executor"), modelId: text(parsed, "modelId") || undefined, localModelName: text(parsed, "localModelName") || undefined, limit: Number(parsed.limit ?? 500) }, principal); break;
      case "run_next": result = await runNextCloudAnnotation(db, text(parsed, "jobId")); break;
      case "review": {
        if (!Array.isArray(parsed.updates) || !parsed.updates.every(record)) throw new Error("updates 必须是对象数组");
        result = await updateAnnotationItems(db, text(parsed, "jobId"), parsed.updates.map((item) => ({ id: text(item, "id"), version: Number(item.version), segment: text(item, "segment"), imagePriceCents: item.imagePriceCents, priceType: text(item, "priceType"), priceLowCents: item.priceLowCents, priceHighCents: item.priceHighCents, selected: item.selected === true })), principal); break;
      }
      case "commit": result = await commitAnnotationItems(db, { jobId: text(parsed, "jobId"), candidateIds: texts(parsed, "candidateIds"), idempotencyKey: text(parsed, "idempotencyKey") }, principal); break;
      case "commit_selected": result = await commitSelectedAnnotationItems(db, { jobId: text(parsed, "jobId") || undefined, aggregateJobs: parsed.aggregateJobs === true, category: text(parsed, "category") || undefined, categories: texts(parsed, "categories"), idempotencyKey: text(parsed, "idempotencyKey") }, principal); break;
      case "select_filtered": result = await setFilteredAnnotationSelection(db, {
        jobId: text(parsed, "jobId") || undefined, aggregateJobs: parsed.aggregateJobs === true, category: text(parsed, "category") || undefined, categories: texts(parsed, "categories"), selected: parsed.selected === true,
        itemSegment: text(parsed, "itemSegment") || undefined,
        storageStatus: text(parsed, "storageStatus") === "committed" ? "committed" : text(parsed, "storageStatus") === "pending" ? "pending" : undefined,
        recognitionSource: text(parsed, "recognitionSource") === "ai" ? "ai" : text(parsed, "recognitionSource") === "non_ai" ? "non_ai" : undefined,
      }, principal); break;
      case "create_prompt": result = await createPromptVersion(db, { category: text(parsed, "category"), segments: parsed.segments, promptBody: text(parsed, "promptBody"), parentId: text(parsed, "parentId") || undefined, source: "manual", changeNote: text(parsed, "changeNote") }, principal); break;
      case "generate_prompt": result = await generatePromptVersion(db, { textModelId: text(parsed, "textModelId"), category: text(parsed, "category"), segments: parsed.segments, parentId: text(parsed, "parentId") || undefined, mode: "generate", changeNote: text(parsed, "changeNote") }, principal); break;
      case "evolve_prompt": {
        const prompt = await generatePromptVersion(db, { textModelId: text(parsed, "textModelId"), category: text(parsed, "category"), segments: parsed.segments, parentId: text(parsed, "parentId"), mode: "evolve", changeNote: text(parsed, "changeNote") }, principal);
        const validation = await createValidationRun(db, { candidatePromptId: prompt.id, modelId: text(parsed, "visionModelId"), sampleCount: Number(parsed.sampleCount ?? 50), seed: text(parsed, "seed") || undefined }, principal);
        result = { prompt, validation };
        break;
      }
      case "create_validation": result = await createValidationRun(db, { candidatePromptId: text(parsed, "promptId"), modelId: text(parsed, "modelId"), sampleCount: Number(parsed.sampleCount ?? 50), seed: text(parsed, "seed") || undefined }, principal); break;
      case "run_validation_next": result = await runNextValidation(db, text(parsed, "runId")); break;
      case "activate_prompt": result = await activatePromptVersion(db, { promptId: text(parsed, "promptId"), explicitOverride: parsed.explicitOverride === true, reason: text(parsed, "reason") }, principal); break;
      case "rollback_prompt": result = await activatePromptVersion(db, { promptId: text(parsed, "promptId"), explicitOverride: true, reason: text(parsed, "reason"), rollback: true }, principal); break;
      case "delete_prompt": result = await deletePromptVersion(db, text(parsed, "promptId"), principal); break;
      case "mark_gold": result = await markAnnotationsAsGold(db, texts(parsed, "annotationIds"), principal); break;
      case "create_agent": result = await createLocalAgent(db, text(parsed, "name"), principal); break;
      case "revoke_agent": result = await revokeLocalAgent(db, text(parsed, "agentId")); break;
      default: return Response.json({ error: "不支持的标注操作" }, { status: 400 });
    }
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return Response.json({ error: publicError(error, "SKU AI 标注操作失败") }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
