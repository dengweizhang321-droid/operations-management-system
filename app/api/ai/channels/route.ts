import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import {
  deleteAiChannel,
  ensureAiAssistantSchema,
  listAiChannels,
  sendAiChannelText,
  testAiChannelConnection,
  upsertAiChannel,
  type AiChannelInput,
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

function channelInputFromPayload(payload: JsonRecord): AiChannelInput | null {
  const name = stringValue(payload, "name");
  const kind = stringValue(payload, "kind");
  if (!name || !kind) return null;
  return {
    id: stringValue(payload, "id"),
    name,
    kind: kind as AiChannelInput["kind"],
    status: (stringValue(payload, "status") ?? "enabled") as AiChannelInput["status"],
    sendEnabled: payload.sendEnabled === true,
    callbackEnabled: payload.callbackEnabled === true,
    webhookUrl: stringValue(payload, "webhookUrl"),
    callbackToken: stringValue(payload, "callbackToken"),
    aesKey: stringValue(payload, "aesKey"),
    receiverId: stringValue(payload, "receiverId"),
  };
}

export async function GET() {
  try {
    await requireAppPrincipal(["admin"]);
    const db = getSalesDatabase();
    await ensureAiAssistantSchema(db);
    return Response.json({ items: await listAiChannels(db) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "读取渠道配置失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "id 不能为空" }, { status: 400 });
    const deleted = await deleteAiChannel(id, getSalesDatabase());
    return Response.json({ ok: true, deleted });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "删除渠道失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const parsed: unknown = await request.json().catch(() => null);
    if (!isRecord(parsed)) return Response.json({ error: "请求数据格式无效" }, { status: 400 });
    const action = stringValue(parsed, "action");
    const id = stringValue(parsed, "id");
    const db = getSalesDatabase();
    if (action === "test") {
      if (!id) return Response.json({ error: "缺少渠道 id" }, { status: 400 });
      return Response.json(await testAiChannelConnection(id, db), { headers: { "cache-control": "no-store" } });
    }
    if (action === "send") {
      const text = stringValue(parsed, "text");
      if (!id || !text) return Response.json({ error: "缺少渠道 id 或消息内容" }, { status: 400 });
      return Response.json(await sendAiChannelText(id, text, db), { headers: { "cache-control": "no-store" } });
    }
    const input = channelInputFromPayload(parsed);
    if (!input) return Response.json({ error: "渠道信息不完整" }, { status: 400 });
    const item = await upsertAiChannel(input, db);
    return Response.json({ item }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const auth = authorizationErrorResponse(error);
    if (auth) return auth;
    return Response.json({ error: error instanceof Error ? error.message : "保存渠道配置失败" }, { status: 500 });
  }
}
