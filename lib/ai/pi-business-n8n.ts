import type { AppPrincipal } from "@/lib/auth/authorization";
import { requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { createDjangoNetshopService, NETSHOP_PROMOTION_OVERVIEW_PATH } from "@/lib/django/netshop-service";
import { requestDjangoWorkflowJson } from "@/lib/django/workflow-service";
import { netshopOutletKey } from "@/lib/netshop/query-contract";
import { PublicApiError } from "@/lib/http/api-error";

const deny = () => new PublicApiError(403, "access_denied", "未登记的 Pi 补缺业务请求。");
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw deny(); return value as Record<string, unknown>; }

/** Internal signed transport only; neither endpoint nor workflow is model supplied. */
export async function piBusinessN8nDomain(body: Record<string, unknown>, principal: AppPrincipal, signal?: AbortSignal) {
  if (!["operator", "admin"].includes(principal.role) || body.kind !== "n8n_gap.run"
    || !["prepare", "execute", "observe", "capabilities"].includes(String(body.phase))
    || Object.keys(body).some(key => !["action", "phase", "kind", "arguments", "parameters", "targetVersion", "actionId", "dispatchToken"].includes(key))) throw deny();
  requireUnrestrictedDataScope(principal, "Pi 补缺执行");
  const { action: _action, ...payload } = body; void _action;
  return (await requestDjangoWorkflowJson<Record<string, unknown>>(principal,
    { method: "POST", path: "/api/workflow/pi-business-n8n", service: "writer", payload }, { signal,
      ...(typeof payload.actionId === "string" && payload.phase === "execute" ? { requestId: () => `pi-business:${payload.actionId}` } : {}),
    })).data;
}

/** The same formal product/promotion coverage used by the n8n business chain. */
export async function piBusinessN8nCoverage(body: Record<string, unknown>, principal: AppPrincipal, signal?: AbortSignal) {
  if (Object.keys(body).some(key => !["action", "shopName", "startDate", "endDate"].includes(key))) throw deny();
  requireUnrestrictedDataScope(principal, "Pi 补缺覆盖");
  const { shopName, startDate, endDate } = body;
  if (typeof shopName !== "string" || !shopName || shopName.length > 160 || typeof startDate !== "string" || typeof endDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw deny();
  const start = Date.parse(`${startDate}T00:00:00Z`), end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 6 * 86400000) throw deny();
  const query = new URLSearchParams({ platform: "天猫", outlet: netshopOutletKey("天猫", shopName), startDate, endDate });
  const result = await createDjangoNetshopService().request<Record<string, unknown>>(principal,
    { method: "GET", path: NETSHOP_PROMOTION_OVERVIEW_PATH, service: "reader", query }, { signal });
  const period = object(result.data.requestedPeriod), coverage = object(result.data.coverage);
  if (period.startDate !== startDate || period.endDate !== endDate || coverage.truncated === true) throw deny();
  const expected = Array.from({ length: (end - start) / 86400000 + 1 }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  const dates = (name: string) => {
    const value = coverage[name];
    if (!Array.isArray(value) || value.length > 7 || new Set(value).size !== value.length || !value.every(day => typeof day === "string" && expected.includes(day))) throw deny();
    return value as string[];
  };
  const productDailyDates = dates("productDailyDates"), promotionDates = dates("promotionDates");
  return { shopName, startDate, endDate, revision: result.revision, productDailyDates, promotionDates,
    productMissingDates: expected.filter(day => !productDailyDates.includes(day)), promotionMissingDates: expected.filter(day => !promotionDates.includes(day)), truncated: false };
}
