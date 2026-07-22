import {
  appendConversationMessage,
  createConversation,
  generateAssistantReply,
  resolveChatModel,
} from "@/lib/ai/assistant-service";
import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { ensureMarketSchema, getMarketDatabase, getMarketOverview } from "@/lib/market/database";
import { ensureNetshopSchema } from "@/lib/netshop/database";
import { ensureSalesSchema } from "@/lib/sales/database";

type MarketAiRequest = {
  question?: string;
  query?: string;
  categories?: string[];
  scopes?: string[];
  brands?: string[];
  startDate?: string;
  endDate?: string;
};

function safeList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["operator", "admin"]);
    const body = await request.json().catch(() => null) as MarketAiRequest | null;
    if (!body) return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    const db = getMarketDatabase();
    await Promise.all([ensureMarketSchema(db), ensureNetshopSchema(db), ensureSalesSchema(db)]);
    const overview = await getMarketOverview(db, {
      query: body.query?.trim() || undefined,
      categories: safeList(body.categories),
      scopes: safeList(body.scopes),
      brands: safeList(body.brands),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(body.startDate ?? "") ? body.startDate : undefined,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(body.endDate ?? "") ? body.endDate : undefined,
    });
    if (!overview.summary.productCount) return Response.json({ error: "当前筛选范围没有市场数据，请先导入榜单或 SKU 数据" }, { status: 400 });
    const model = await resolveChatModel(db);
    if (!model) return Response.json({ error: "请先在 AI 助理中启用一个默认文本模型" }, { status: 409 });
    const topItems = overview.items.slice(0, 12).map((item) => ({
      rank: item.rank,
      sku: item.skuCode,
      name: item.productName,
      brand: item.brand,
      category: item.category,
      marketGmvCents: item.gmvCents,
      visitors: item.visitors,
      conversionBps: item.conversionBps,
      ownProduct: item.isOwn,
      ownSalesCents: item.ownSalesCents,
    }));
    const question = body.question?.trim().slice(0, 1200) || "请总结市场机会、竞品风险与下一步运营动作";
    const prompt = [
      "你是 TERUISI 电商运营系统的市场分析助手。仅依据下面的真实导入数据回答，不要编造缺失指标。",
      "金额单位为人民币分，转化率单位为基点（100 基点=1%）。请用中文输出：结论、依据、建议三个部分。",
      `用户问题：${question}`,
      `筛选数据范围：${overview.dataRange.startDate ?? "未知"} 至 ${overview.dataRange.endDate ?? "未知"}`,
      `汇总：${JSON.stringify(overview.summary)}`,
      `头部商品：${JSON.stringify(topItems)}`,
    ].join("\n");
    const conversationId = await createConversation(`市场分析：${question.slice(0, 36)}`, principal.email, model.id, db);
    await appendConversationMessage(conversationId, "user", prompt, db);
    const answer = await generateAssistantReply({ prompt, principal, conversationId, model }, db);
    return Response.json({ ok: true, answer, conversationId, dataRange: overview.dataRange });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "AI 市场分析失败" }, { status: 500 });
  }
}
