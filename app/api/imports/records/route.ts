import { authorizationErrorResponse, requireAppPrincipal, requireUnrestrictedDataScope } from "@/lib/auth/authorization";
import { parsePositiveIntegerQuery, safeApiErrorResponse, PublicApiError } from "@/lib/http/api-error";
import { requestDjangoSalesService, SALES_IMPORTS_PATH } from "@/lib/django/sales-writer";
import { createDjangoFinanceService, FINANCE_IMPORTS_PATH } from "@/lib/django/finance-service";
import { createDjangoInventoryService, INVENTORY_IMPORTS_PATH } from "@/lib/django/inventory-service";
import { createDjangoErpReferenceService, ERP_REFERENCE_IMPORTS_PATH } from "@/lib/django/erp-reference-service";
import { createDjangoNetshopService, NETSHOP_IMPORTS_PATH } from "@/lib/django/netshop-service";
import { createDjangoCustomerService, CUSTOMER_SERVICE_IMPORTS_PATH } from "@/lib/django/customer-service";
import { createDjangoProductsService, PRODUCTS_IMPORTS_PATH } from "@/lib/django/products-service";
import { readImportRecordsPage } from "@/lib/imports/run-records-page";
import type { ImportRecordsPage } from "@/lib/imports/run-records-contract";

export async function GET(request: Request) {
  const deadline = new AbortController();
  const cancel = () => deadline.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timeout = setTimeout(cancel, 30_000);
  try {
    const principal = await requireAppPrincipal(["viewer", "analyst", "operator", "admin"]);
    requireUnrestrictedDataScope(principal, "导入运行记录");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => !["page", "pageSize", "source", "status"].includes(key) || params.getAll(key).length !== 1)) throw new PublicApiError(400, "invalid_request", "运行记录参数无效。");
    const page = parsePositiveIntegerQuery(params.get("page"), 1, "page", 10000);
    const size = parsePositiveIntegerQuery(params.get("pageSize"), 20, "pageSize", 100);
    const options = { signal: deadline.signal };
    const readers = [
      async (query: URLSearchParams) => requestDjangoSalesService<ImportRecordsPage>(principal, { method: "GET", path: SALES_IMPORTS_PATH, service: "reader", query }, options),
      async (query: URLSearchParams) => createDjangoFinanceService().request<ImportRecordsPage>(principal, { method: "GET", path: FINANCE_IMPORTS_PATH, service: "reader", query }, options),
      async (query: URLSearchParams) => createDjangoInventoryService().requestJson<ImportRecordsPage>(principal, { method: "GET", path: INVENTORY_IMPORTS_PATH, service: "reader", rawQuery: query.toString() }, options),
      async (query: URLSearchParams) => createDjangoErpReferenceService().requestJson<ImportRecordsPage>(principal, { method: "GET", path: ERP_REFERENCE_IMPORTS_PATH, service: "reader", rawQuery: query.toString() }, options),
      async (query: URLSearchParams) => createDjangoCustomerService().requestJson<ImportRecordsPage>(principal, { method: "GET", path: CUSTOMER_SERVICE_IMPORTS_PATH, service: "reader", rawQuery: query.toString() }, options),
      async (query: URLSearchParams) => createDjangoProductsService().requestJson<ImportRecordsPage>(principal, { method: "GET", path: PRODUCTS_IMPORTS_PATH, service: "reader", rawQuery: query.toString() }, options),
    ];
    // The existing netshop history is admin-only; do not widen it for this aggregate.
    if (principal.role === "admin") readers.push(async (query) => createDjangoNetshopService().request<ImportRecordsPage>(principal, { method: "GET", path: NETSHOP_IMPORTS_PATH, service: "reader", query }, options));
    const data = await readImportRecordsPage(readers.map((read) => async (domainPage, domainSize) => {
      const query = new URLSearchParams({ records: "1", page: String(domainPage), pageSize: String(domainSize), recordSource: params.get("source") || "", recordStatus: params.get("status") || "" });
      const result = await read(query);
      return { ...result.data, revision: "revision" in result && typeof result.revision === "string" ? result.revision : result.data.recordRevision ?? null };
    }), page, size);
    return Response.json({ ...data, errors: principal.role === "admin" ? [] : ["网店导入历史仅管理员可读取；当前列表仅包含获授权来源。"] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authorizationErrorResponse(error) ?? safeApiErrorResponse(error, "读取运行记录失败。", { headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
  }
}
