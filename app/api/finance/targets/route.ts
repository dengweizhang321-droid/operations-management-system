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
  requireUnrestrictedDataScope,
} from "@/lib/auth/authorization";
import { parsePositiveIntegerQuery, PublicApiError, requirePositiveSafeIntegerNumber, safeApiErrorResponse } from "@/lib/http/api-error";

const MAX_FINANCE_TARGET_AMOUNT_CENTS = 10_000_000_000_000;

function finiteInteger(value: unknown, field: string, maximum = MAX_FINANCE_TARGET_AMOUNT_CENTS) {
  const number = value === undefined ? 0 : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new PublicApiError(400, "invalid_request", `${field}必须是范围内的 JSON 非负安全整数`);
  }
  return number;
}

function parseTarget(body: Record<string, unknown>): FinanceTargetInput {
  const periodType = String(body.periodType ?? "") as FinanceTargetPeriodType;
  const periodKey = String(body.periodKey ?? "").trim();
  if (!(["month", "year", "project"] as const).includes(periodType)) throw new PublicApiError(400, "invalid_request", "目标周期类型无效");
  if (periodType === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new PublicApiError(400, "invalid_request", "月度目标周期应为真实的 YYYY-MM");
  if (periodType === "year" && !/^(19|20|21)\d{2}$/.test(periodKey)) throw new PublicApiError(400, "invalid_request", "年度目标周期应为 YYYY");
  if (periodType === "project" && (!periodKey || periodKey.length > 100)) throw new PublicApiError(400, "invalid_request", "请输入不超过 100 字的项目名称");
  const shopName = String(body.shopName ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  if (periodType !== "project" && (!shopName || shopName.length > 100)) throw new PublicApiError(400, "invalid_request", "月度或年度目标必须选择有效店铺");
  if (periodType !== "project" && (!platform || platform.length > 100)) throw new PublicApiError(400, "invalid_request", "月度或年度目标必须选择有效平台");
  if (body.id !== undefined && typeof body.id !== "string") throw new PublicApiError(400, "invalid_request", "目标 ID 必须为字符串");
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (id.length > 128) throw new PublicApiError(400, "invalid_request", "目标 ID 长度超出限制");
  if (!id && body.expectedVersion !== undefined) throw new PublicApiError(400, "invalid_request", "新建目标不能携带 expectedVersion");
  const expectedVersion = id ? requirePositiveSafeIntegerNumber(body.expectedVersion, "expectedVersion") : undefined;
  const category = periodType === "project" ? "" : String(body.category ?? "").trim();
  const manager = String(body.manager ?? "").trim();
  if (category.length > 100) throw new PublicApiError(400, "invalid_request", "品类名称不能超过 100 字");
  if (manager.length > 120) throw new PublicApiError(400, "invalid_request", "负责人不能超过 120 字");
  return {
    id: id || undefined,
    expectedVersion,
    periodType,
    periodKey,
    platform: periodType === "project" ? "" : platform,
    shopName: periodType === "project" ? "" : shopName,
    category,
    manager,
    salesTargetCents: finiteInteger(body.salesTargetCents, "销售额目标"),
    profitTargetCents: finiteInteger(body.profitTargetCents, "利润目标"),
    smallMarginBps: finiteInteger(body.smallMarginBps, "小毛利率目标", 10_000),
    inventoryCleanupTargetCents: finiteInteger(body.inventoryCleanupTargetCents, "库存清理目标"),
    promotionFeeRatioBps: finiteInteger(body.promotionFeeRatioBps, "推广费占比目标", 10_000),
    stagnantInventoryTargetCents: finiteInteger(body.stagnantInventoryTargetCents, "呆滞库存目标"),
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "经营目标");
    const params = new URL(request.url).searchParams;
    const page = parsePositiveIntegerQuery(params.get("page"), 1, "page", 10_000);
    const pageSize = parsePositiveIntegerQuery(params.get("pageSize"), 50, "pageSize", 100);
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const [targets, options] = await Promise.all([
      listFinanceTargets(db, {
        page,
        pageSize,
      }),
      getFinanceTargetOptions(db),
    ]);
    return Response.json({ ...targets, options }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "目标设置读取失败。", { headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "经营目标", "修改");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400, headers: { "cache-control": "no-store" } });
    const input = parseTarget(body);
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const item = await upsertFinanceTarget(db, { ...input, id: input.id || crypto.randomUUID() });
    return Response.json({ ok: true, item }, { status: input.id ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "目标保存失败。", { headers: { "cache-control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "经营目标", "删除");
    const params = new URL(request.url).searchParams;
    const id = params.get("id")?.trim();
    if (!id) return Response.json({ error: "缺少目标 ID" }, { status: 400, headers: { "cache-control": "no-store" } });
    const expectedVersionValue = params.get("expectedVersion");
    if (expectedVersionValue === null) throw new PublicApiError(400, "invalid_request", "缺少 expectedVersion");
    const expectedVersion = parsePositiveIntegerQuery(expectedVersionValue, 1, "expectedVersion");
    const reason = params.get("reason") ?? "";
    const db = getFinanceDatabase();
    await ensureFinanceSchema(db);
    const deleted = await deleteFinanceTarget(db, id, expectedVersion, principal.email, reason);
    return Response.json({ ok: true, ...deleted }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) return authResponse;
    return safeApiErrorResponse(error, "目标删除失败。", { headers: { "cache-control": "no-store" } });
  }
}
