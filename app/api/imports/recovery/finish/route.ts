import { GET as readRecovery } from "../route";
import { requireAppPrincipal, requireUnrestrictedDataScope, authorizationErrorResponse } from "@/lib/auth/authorization";
import { syncLatestInventoryProjection } from "@/lib/products/inventory-projection-sync";
import { reconcileNewProductCodesAfterImport } from "@/lib/workflow/new-product-learning";
import { safeApiErrorResponse } from "@/lib/http/api-error";

/** Continue idempotent adjunct work after a proven publication. No raw upload,
 * normalized import, claim, or business batch replacement is performed here. */
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const principal = await requireAppPrincipal(["admin"]);
    requireUnrestrictedDataScope(principal, "导入恢复收尾", "导入");
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "query"
      || typeof (body as { query?: unknown }).query !== "string" || (body as { query: string }).query.length > 2048) return Response.json({ error: "恢复收尾身份无效" }, { status: 400, headers });
    const query = new URLSearchParams((body as { query: string }).query);
    if (query.get("recovery") !== "result") return Response.json({ error: "必须核验精确已提交结果" }, { status: 400, headers });
    const url = new URL("/api/imports/recovery", request.url); url.search = query.toString();
    const before = await readRecovery(new Request(url, { signal: request.signal }));
    if (!before.ok) return before;
    const proven = await before.json() as { status: string; batch?: Record<string, unknown>; outcomes?: string[] };
    if (proven.status !== "committed_current" || !proven.batch) return Response.json({ ok: false, status: "rejected", message: "原批次当前未通过有效性核验，保留历史成功事实并停止。" }, { status: 409, headers });
    const moduleKey = query.get("module");
    const adjunct = moduleKey === "inventory" ? { inventoryProjection: await syncLatestInventoryProjection(principal, { signal: request.signal }) }
      : moduleKey === "products" ? { newProductLearning: await reconcileNewProductCodesAfterImport(principal, String(proven.batch.id), request.signal) } : {};
    if (adjunct.newProductLearning && adjunct.newProductLearning.status !== "completed") return Response.json({ ok: false, status: "rejected", code: "adjunct_pending", message: "货品批次已提交，新品关联尚未完成；请等待或核查新品关联服务及原批次。" }, { status: 409, headers });
    const after = await readRecovery(new Request(url, { signal: request.signal }));
    if (!after.ok) return after;
    const current = await after.json() as typeof proven;
    if (current.status !== "committed_current" || current.batch?.id !== proven.batch.id) return Response.json({ ok: false, status: "rejected", message: "附属处理后原范围已被新批次替代，请核查当前结果。" }, { status: 409, headers });
    return Response.json({ ok: true, status: current.outcomes?.includes("duplicate") ? "duplicate" : "imported",
      batch: current.batch, warnings: current.batch?.warnings ?? [], recoveredPublication: true, ...adjunct }, { headers });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "原批次已保留，附属处理尚未完成。", { headers });
  }
}
