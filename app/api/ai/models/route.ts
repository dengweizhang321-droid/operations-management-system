import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  deleteAiModel,
  ensureAiAssistantSchema,
  listAiModels,
  testAiModelConnection,
  upsertAiModel,
  type AiModelInput,
} from "@/lib/ai/assistant-service";
import { getSalesDatabase } from "@/lib/sales/database";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(payload: JsonRecord, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(payload: JsonRecord, key: string): number | undefined {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function modelInputFromPayload(payload: JsonRecord): AiModelInput | null {
  const name = stringValue(payload, "name");
  const protocol = stringValue(payload, "protocol");
  const modelType = stringValue(payload, "modelType");
  const modelName = stringValue(payload, "modelName");
  const baseUrl = stringValue(payload, "baseUrl");
  if (!name || !protocol || !modelType || !modelName || !baseUrl) return null;
  return {
    id: stringValue(payload, "id"),
    name,
    protocol: protocol as AiModelInput["protocol"],
    modelType: modelType as AiModelInput["modelType"],
    modelName,
    baseUrl,
    apiKey: stringValue(payload, "apiKey"),
    status: (stringValue(payload, "status") ?? "enabled") as AiModelInput["status"],
    isDefaultTextModel: payload.isDefaultTextModel === true,
    timeoutMs: numberValue(payload, "timeoutMs"),
    maxTokens: numberValue(payload, "maxTokens"),
    reasoningMode: stringValue(payload, "reasoningMode") as AiModelInput["reasoningMode"],
    temperatureMilli: numberValue(payload, "temperatureMilli"),
    maxToolRounds: numberValue(payload, "maxToolRounds"),
    maxTotalToolCalls: numberValue(payload, "maxTotalToolCalls"),
  };
}

export async function GET() {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    return Response.json({ items: await listAiModels(db), principal }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取模型配置失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "id 不能为空" }, { status: 400 });
    const deleted = await deleteAiModel(id, getSalesDatabase());
    return Response.json({ ok: true, deleted });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "删除模型失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const parsed: unknown = await request.json().catch(() => null);
    if (!isRecord(parsed)) return Response.json({ error: "请求数据格式无效" }, { status: 400 });
    const action = stringValue(parsed, "action");
    const id = stringValue(parsed, "id");
    if (action === "test") {
      if (!id) return Response.json({ error: "缺少模型 id" }, { status: 400 });
      return Response.json(await testAiModelConnection(id, getSalesDatabase()), { headers: { "cache-control": "no-store" } });
    }
    const input = modelInputFromPayload(parsed);
    if (!input) return Response.json({ error: "模型信息不完整" }, { status: 400 });
    const item = await upsertAiModel(input, getSalesDatabase());
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "保存模型配置失败" }, { status: 500 });
  }
}
