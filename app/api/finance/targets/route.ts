import {
  deleteFinanceTarget,
  ensureFinanceSchema,
  getFinanceDatabase,
  getFinanceTargetOptions,
  listFinanceTargets,
  upsertFinanceTarget,
} from "@/lib/finance/database";
import type { FinanceTargetInput, FinanceTargetPeriodType } from "@/lib/finance/types";
import {
  authorizationErrorResponse,
  requireAppPrincipal,
} from "@/lib/auth/authorization";

function finiteInteger(value: unknown, field: string) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field}必须是非负整数`);
  return number;
}

function parseTarget(body: Record<string, unknown>): FinanceTargetInput {
  const periodType = String(body.periodType ?? "") as FinanceTargetPeriodType;
  const periodKey = String(body.periodKey ?? "").trim();
  if (!(["month", "year", "project"] as const).includes(periodType)) throw new Error("目标周期类型无效");
  if (periodType === "month" && !/^\d{4}-\d{2}$/.test(periodKey)) throw new Error("月度目标周期应为 YYYY-MM");
  if (periodType === "year" && !/^\d{4}$/.test(periodKey)) throw new Error("年度目标周期应为 YYYY");
  if (periodType === "project" && !periodKey) throw new Error("请输入项目名称");
  const shopName = String(body.shopName ?? "").trim();
  if (periodType !== "project" && !shopName) throw new Error("月度或年度目标必须选择店铺");
  return {
    id: typeof body.id === "string" ? body.id : undefined,
    periodType,
    periodKey,
    shopName: periodType === "project" ? "" : shopName,
    category: periodType === "project" ? "" : String(body.category ?? "").trim(),
    manager: String(body.manager ?? "").trim(),
    salesTargetCents: finiteInteger(body.salesTargetCents, "销售额目标"),
    profitTargetCents: finiteInteger(body.profitTargetCents, "利润目标"),
    smallMarginBps: finiteInteger(body.smallMarginBps, "小毛利率目标"),
    inventoryCleanupTargetCents: finiteInteger(body.inventoryCleanupTargetCents, "库存清理目标"),
    promotionFeeRatioBps: finiteInteger(body.promotionFeeRatioBps, "推广费占比目标"),
    stagnantInventoryTargetCents: finiteInteger(body.stagnantInventoryTargetCents, "呆滞库存目标"),
  };
}

export async function GET() {
  try {
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const [items, options] = await Promise.all([listFinanceTargets(db), getFinanceTargetOptions(db)]);
    return Response.json({ items, options });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "目标设置读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    const input = parseTarget(body);
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const item = await upsertFinanceTarget(db, { ...input, id: input.id || crypto.randomUUID() });
    return Response.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "目标保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "缺少目标 ID" }, { status: 400 });
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const deleted = await deleteFinanceTarget(db, id);
    return Response.json({ ok: true, deleted });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return Response.json({ error: error instanceof Error ? error.message : "目标删除失败" }, { status: 500 });
  }
}
