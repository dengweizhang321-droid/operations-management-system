import { logisticsDayAfter, logisticsHash, type JdLogisticsScope } from "./logistics-policy";

function fail(code: string): never { throw new Error(code); }
export type LogisticsSubmissionWindow = { submittedAt: string; observedAt: string };
export type LegacyLogisticsTask = { fingerprint: string; sourceName: string; text: string; rowIndex: number; rowCount: number | null; createdAt: string };
export function logisticsSourceTime(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value) ? `${value.replace(" ", "T")}+08:00` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+08:00)$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) fail("JD_LOGISTICS_TASK_TIME_INVALID");
  const local = new Date(Date.parse(normalized) + (normalized.endsWith("+08:00") ? 8 * 3600_000 : 0)).toISOString().slice(0, 19);
  if (local !== normalized.slice(0, 19)) fail("JD_LOGISTICS_TASK_TIME_INVALID");
  return normalized;
}
function inWindow(createdAt: string, window: LogisticsSubmissionWindow) {
  const start = Date.parse(window.submittedAt), end = Date.parse(window.observedAt), value = Date.parse(logisticsSourceTime(createdAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 20 * 60_000) fail("JD_LOGISTICS_TASK_WINDOW_INVALID");
  // Source createTime has seconds precision. Never grant minutes of tolerance.
  return value >= Math.floor(start / 1000) * 1000 && value <= Math.floor(end / 1000) * 1000;
}
function exactToken(text: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`).test(text);
}
/** Quantity, task state and mutable download actions never enter identity. */
export function legacyLogisticsTask(cells: string[], headers: string[], rowIndex: number): LegacyLogisticsTask {
  const column = (labels: string[]) => {
    const positions = headers.flatMap((header, index) => labels.includes(header.replace(/\s+/g, "")) ? [index] : []);
    if (positions.length > 1) fail("JD_LOGISTICS_LEGACY_TASK_HEADER_AMBIGUOUS");
    return positions.length ? cells[positions[0]]?.trim() ?? "" : "";
  };
  const taskId = column(["任务ID", "任务编号"]), name = column(["任务名称", "文件名称", "导出文件名称", "导出文件名"]);
  const createdAt = logisticsSourceTime(column(["创建时间", "任务创建时间", "生成时间", "申请时间", "导出时间"]));
  const query = column(["查询条件", "导出条件", "筛选条件"]);
  if (!taskId && (!name || !query)) fail("JD_LOGISTICS_LEGACY_TASK_IDENTITY_UNPROVEN");
  if (taskId && !/^[A-Za-z0-9._:-]{1,100}$/.test(taskId)) fail("JD_LOGISTICS_LEGACY_TASK_IDENTITY_UNPROVEN");
  const quantity = column(["数据条数", "导出数量", "总条数", "数量", "条数"]).replaceAll(",", "");
  return { fingerprint: taskId ? `legacy-id:${taskId}` : `legacy:${logisticsHash({ name, createdAt, query })}`,
    sourceName: name, text: [name, query, cells.join(" | ")].join(" | "), rowIndex, createdAt,
    rowCount: /^\d+$/.test(quantity) && Number.isSafeInteger(Number(quantity)) ? Number(quantity) : null };
}
export function exactTaskCandidates(tasks: LegacyLogisticsTask[], baseline: string[], sourceLabel: string, unit: string, start: string, end: string, window: LogisticsSubmissionWindow) {
  return tasks.filter(task => !baseline.includes(task.fingerprint) && task.sourceName === sourceLabel && exactToken(task.text, unit)
    && exactToken(task.text, start) && exactToken(task.text, end) && inWindow(task.createdAt, window));
}
export type JhLogisticsTask = {
  id: number; filesName: string; createTime: string; filesStatus: number;
  deptNo: string | null; sourceMenu: string; systemSource: string;
  filesUrl: string | null;
};
export type JhLogisticsTaskPage = { records: JhLogisticsTask[]; total: number; pages: number; pageNum: 1; pageSize: 10 };
export const jhLogisticsSourceMenus = { realtime_inventory: "仓储-实时库存监控", inventory_snapshot: "仓储监控-库存快照监控" } as const;
export function jhLogisticsExportRequest(scope: JdLogisticsScope): Record<string, unknown> {
  const kind = scope.sourceKind;
  if (kind !== "realtime_inventory" && kind !== "inventory_snapshot") fail("JD_LOGISTICS_JH_SOURCE_INVALID");
  return { deptNo: scope.businessUnitCode, storeCode: null, storeCodeList: null, goods: "", sellerGoodsSign: "", lasType: "NORMAL",
    categoryId: null, secondCategoryId: null, thirdCategoryId: null, stockQtyFilterZeroFlag: false, pageWareType: "2", pipeline: null,
    ...(kind === "realtime_inventory" ? { sortField: "", sortType: "" } : { earlyWarningType: null, dateType: "DAY", orderDateStart: scope.rangeStart,
      orderDateEnd: logisticsDayAfter(scope.rangeEnd, -1), startProvinceCode: null, startCityCode: null, separate: "1", saleOutQtyFilterZeroFlag: false }) };
}
export function jhLogisticsQueryRequest(scope: JdLogisticsScope) {
  return { ...jhLogisticsExportRequest(scope), pageNum: 1, pageSize: 10,
    ...(scope.sourceKind === "inventory_snapshot" ? { whStatus: 0, sortField: "", sortType: "" } : {}) };
}
export function jhLogisticsQueryTotal(value: unknown, request: unknown, scope: JdLogisticsScope) {
  if (logisticsHash(request) !== logisticsHash(jhLogisticsQueryRequest(scope))) fail("JD_LOGISTICS_JH_QUERY_SCOPE_MISMATCH");
  const payload = value as { success?: unknown; data?: { currPage?: unknown; total?: unknown; rows?: unknown } } | null;
  if (!payload || payload.success !== true || !payload.data || payload.data.currPage !== 1 || !Number.isSafeInteger(payload.data.total)
    || Number(payload.data.total) < 1 || Number(payload.data.total) > 20000 || !Array.isArray(payload.data.rows)) fail("JD_LOGISTICS_JH_QUERY_TOTAL_UNPROVEN");
  return Number(payload.data.total);
}
export function parseJhLogisticsTaskPage(value: unknown, request: unknown): JhLogisticsTaskPage {
  const payload = value as Record<string, unknown> | null, body = request as Record<string, unknown> | null;
  if (!body || body.pageNum !== 1 || body.pageSize !== 10 || Object.keys(body).some(key => !["pageNum", "pageSize"].includes(key))
    || !payload || payload.success !== true || !Array.isArray(payload.data) || payload.pageNum !== 1 || payload.pageSize !== 10
    || !Number.isSafeInteger(payload.total) || Number(payload.total) < 0 || !Number.isSafeInteger(payload.pages)
    || Number(payload.pages) !== Math.ceil(Number(payload.total) / 10) || payload.data.length !== Math.min(Number(payload.total), 10)) fail("JD_LOGISTICS_JH_TASK_PAGE_INCOMPLETE");
  const records = payload.data.map(raw => {
    const task = raw as Record<string, unknown>;
    if (!task || !Number.isSafeInteger(task.id) || Number(task.id) < 1 || typeof task.filesName !== "string" || task.filesName.length > 500
      || typeof task.createTime !== "string" || !Number.isSafeInteger(task.filesStatus)
      || task.deptNo !== null && (typeof task.deptNo !== "string" || !task.deptNo)
      || typeof task.sourceMenu !== "string" || typeof task.systemSource !== "string"
      || task.filesUrl !== null && (typeof task.filesUrl !== "string" || task.filesUrl.length > 8192)) fail("JD_LOGISTICS_JH_TASK_RECORD_INVALID");
    return { id: Number(task.id), filesName: task.filesName, createTime: logisticsSourceTime(task.createTime), filesStatus: Number(task.filesStatus),
      deptNo: task.deptNo as string | null, sourceMenu: task.sourceMenu, systemSource: task.systemSource, filesUrl: task.filesUrl as string | null };
  });
  if (new Set(records.map(task => task.id)).size !== records.length || records.some((task, index) => index > 0
    && (task.id >= records[index - 1].id || Date.parse(task.createTime) > Date.parse(records[index - 1].createTime)))) fail("JD_LOGISTICS_JH_TASK_ORDER_UNPROVEN");
  return { records, total: Number(payload.total), pages: Number(payload.pages), pageNum: 1, pageSize: 10 };
}
export function jhLogisticsTaskIdentity(task: JhLogisticsTask) {
  return logisticsHash({ id: task.id, filesName: task.filesName, createTime: task.createTime, deptNo: task.deptNo, sourceMenu: task.sourceMenu, systemSource: task.systemSource });
}
export function jhLogisticsFilenameMatches(task: JhLogisticsTask, scope: JdLogisticsScope) {
  const kind = scope.sourceKind;
  if (kind !== "realtime_inventory" && kind !== "inventory_snapshot") return false;
  const day = scope.rangeStart;
  const expected = kind === "realtime_inventory"
    ? `仓储-实时库存监控明细表${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`
    : `仓储监控-库存快照监控_分仓_${day.replaceAll("-", ".")}-${logisticsDayAfter(scope.rangeEnd, -1).replaceAll("-", ".")}`;
  return task.filesName.replace(/\.xlsx$/i, "") === expected && task.sourceMenu === jhLogisticsSourceMenus[kind] && task.systemSource === "数据看板";
}
/** The observed JH contract orders page one by descending ID and createTime.
 * A baseline-ID anchor proves the new prefix was not truncated at row ten. */
export function selectJhLogisticsTask(page: JhLogisticsTaskPage, baseline: JhLogisticsTaskPage, scope: JdLogisticsScope, window: LogisticsSubmissionWindow, boundId?: number) {
  const maxId = baseline.records[0]?.id ?? 0;
  if (page.total > page.records.length && !page.records.some(task => task.id <= maxId)) fail("JD_LOGISTICS_JH_NEW_TASK_PREFIX_TRUNCATED");
  const candidates = page.records.filter(task => task.id > maxId && !baseline.records.some(old => old.id === task.id)
    && jhLogisticsFilenameMatches(task, scope) && (task.deptNo === null || task.deptNo === scope.businessUnitCode) && inWindow(task.createTime, window));
  if (candidates.length > 1) fail("JD_LOGISTICS_DOWNLOAD_TASK_AMBIGUOUS");
  const selected = candidates[0];
  if (boundId !== undefined && (!selected || selected.id !== boundId)) fail("JD_LOGISTICS_DOWNLOAD_TASK_CHANGED");
  return selected;
}
export function jhLogisticsDownloadUrl(value: string | null) {
  if (!value || value.length > 8192) fail("JD_LOGISTICS_DOWNLOAD_URL_MISSING");
  const decoded = value.replaceAll("&amp;", "&");
  let url: URL;
  try { url = new URL(decoded); } catch { return fail("JD_LOGISTICS_DOWNLOAD_URL_REJECTED"); }
  if (url.origin !== "https://s3.cn-north-1.jdcloud-oss.com" || url.username || url.password || url.hash || !url.pathname || /[\r\n]/.test(decoded)) fail("JD_LOGISTICS_DOWNLOAD_URL_REJECTED");
  return decoded;
}
export type ProductLogisticsTask = { id: string; deptId: string; taskStatus: string; recordCount: number; successCount: number; createTime: string; shopSetHash: string; shopCount: number };
export function exactNumericId(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) fail("JD_LOGISTICS_PRODUCTS_TASK_ID_INVALID");
    return String(value);
  }
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) fail("JD_LOGISTICS_PRODUCTS_TASK_ID_INVALID");
  return value;
}
export function productLogisticsDepartmentId(businessUnitCode: string) {
  if (!/^EBU[1-9]\d{0,19}$/.test(businessUnitCode)) fail("JD_LOGISTICS_PRODUCTS_BUSINESS_UNIT_UNPROVEN");
  return businessUnitCode.slice(3);
}
export function productLogisticsExportTaskId(response: unknown, request: unknown, businessUnitCode: string) {
  const expected = [{ params: { status: 1, deptId: productLogisticsDepartmentId(businessUnitCode), deptNo: businessUnitCode } }];
  if (logisticsHash(request) !== logisticsHash(expected)) fail("JD_LOGISTICS_PRODUCTS_EXPORT_SCOPE_MISMATCH");
  const result = response as { success?: unknown; data?: unknown } | null;
  if (!result || result.success !== true) fail("JD_LOGISTICS_PRODUCTS_SUBMISSION_UNPROVEN");
  return exactNumericId(result.data);
}
export function productLogisticsQueryTotal(response: unknown, request: unknown, businessUnitCode: string) {
  const expected = [{ commonPageRequest: { iDisplayStart: 0, iDisplayLength: 10 }, params: { status: 1, deptId: productLogisticsDepartmentId(businessUnitCode), deptNo: businessUnitCode } }];
  if (logisticsHash(request) !== logisticsHash(expected)) fail("JD_LOGISTICS_PRODUCTS_QUERY_SCOPE_MISMATCH");
  const payload = response as { success?: unknown; data?: { iTotalRecords?: unknown; iTotalDisplayRecords?: unknown; aaData?: unknown } } | null;
  if (!payload || payload.success !== true || !payload.data || !Number.isSafeInteger(payload.data.iTotalRecords)
    || Number(payload.data.iTotalRecords) < 1 || Number(payload.data.iTotalRecords) > 20000 || !Array.isArray(payload.data.aaData)
    || payload.data.iTotalDisplayRecords !== payload.data.iTotalRecords || payload.data.aaData.length !== Math.min(10, Number(payload.data.iTotalRecords))) fail("JD_LOGISTICS_PRODUCTS_QUERY_TOTAL_UNPROVEN");
  return Number(payload.data.iTotalRecords);
}
export function productLogisticsDownloadAck(response: unknown, request: unknown, taskId: string) {
  if (!Array.isArray(request) || request.length !== 1 || !request[0] || typeof request[0] !== "object" || Array.isArray(request[0])
    || exactNumericId(request[0].taskId) !== taskId || logisticsHash(request) !== logisticsHash([{ taskId: request[0].taskId }])) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_TASK_MISMATCH");
  const payload = response as { code?: unknown; success?: unknown; data?: unknown } | null;
  if (!payload || payload.code !== 0 || payload.success !== true || exactNumericId(payload.data) !== taskId) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_TASK_MISMATCH");
  return logisticsHash({ taskId, code: 0, success: true });
}
export function productLogisticsDownloadAttachment(response: unknown, request: unknown, taskId: string) {
  if (!Array.isArray(request) || request.length !== 1 || !request[0] || typeof request[0] !== "object" || Array.isArray(request[0])) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_TASK_MISMATCH");
  const params = request[0] as Record<string, unknown>;
  if (Object.keys(params).some(key => !["downloadUrl", "id"].includes(key)) || exactNumericId(params.id) !== taskId || typeof params.downloadUrl !== "string"
    || !/^report\/shop_goods_task_list_report-[^/?#\\]+\.csv$/.test(params.downloadUrl) || params.downloadUrl.length > 500) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_TASK_MISMATCH");
  const payload = response as { code?: unknown; success?: unknown; data?: unknown } | null;
  if (!payload || payload.code !== 0 || payload.success !== true || typeof payload.data !== "string" || !payload.data.startsWith("//")) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_URL_UNPROVEN");
  const decoded = jhLogisticsDownloadUrl(`https:${payload.data}`), url = new URL(decoded);
  const expected = new URL(`/ka-admin-web/${params.downloadUrl}`, "https://s3.cn-north-1.jdcloud-oss.com").pathname;
  if (url.pathname !== expected || !url.pathname.startsWith("/ka-admin-web/report/") || !url.pathname.endsWith(".csv")) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_URL_UNPROVEN");
  return decoded;
}
export function parseProductLogisticsTaskPage(value: unknown, request: unknown, method = "POST") {
  if (method !== "POST" || !Array.isArray(request) || request.length !== 1 || !request[0] || typeof request[0] !== "object"
    || !Array.isArray(request[0].ids) || request[0].ids.length > 200) fail("JD_LOGISTICS_PRODUCTS_TASK_QUERY_MISMATCH");
  const ids = request[0].ids as unknown[];
  let canonicalIds: string[];
  try { canonicalIds = ids.map(exactNumericId); } catch { return fail("JD_LOGISTICS_PRODUCTS_TASK_QUERY_MISMATCH"); }
  if (new Set(canonicalIds).size !== ids.length) fail("JD_LOGISTICS_PRODUCTS_TASK_QUERY_MISMATCH");
  const pageSize = ids.length || 10;
  const expected = [{ ids, pageNo: 0, pageSize, taskNameList: ["店铺商品列表"], bizTypeList: ["111"] }];
  if (logisticsHash(request) !== logisticsHash(expected)) fail("JD_LOGISTICS_PRODUCTS_TASK_QUERY_MISMATCH");
  const payload = value as { success?: unknown; data?: { aaData?: unknown; iDisplayStart?: unknown; iDisplayLength?: unknown; iTotalRecords?: unknown } } | null;
  if (!payload || payload.success !== true || !payload.data || !Array.isArray(payload.data.aaData) || payload.data.iDisplayStart !== 0
    || payload.data.iDisplayLength !== pageSize || !Number.isSafeInteger(payload.data.iTotalRecords) || Number(payload.data.iTotalRecords) < payload.data.aaData.length
    || payload.data.aaData.length > pageSize || ids.length > 0 && Number(payload.data.iTotalRecords) !== payload.data.aaData.length) fail("JD_LOGISTICS_PRODUCTS_TASK_PAGE_INVALID");
  const seen = new Set<string>();
  for (const record of payload.data.aaData) {
    if (!record || typeof record !== "object" || Array.isArray(record)) fail("JD_LOGISTICS_PRODUCTS_TASK_PAGE_INVALID");
    const id = exactNumericId(record.id);
    if (seen.has(id) || ids.length > 0 && !canonicalIds.includes(id)) fail("JD_LOGISTICS_PRODUCTS_TASK_PAGE_INVALID");
    seen.add(id);
  }
  return payload.data.aaData as Array<Record<string, unknown>>;
}
export function selectProductLogisticsTask(records: Array<Record<string, unknown>>, taskId: string, scope: JdLogisticsScope, window: LogisticsSubmissionWindow): ProductLogisticsTask | undefined {
  const matching = records.filter(record => exactNumericId(record.id) === taskId);
  if (matching.length > 1) fail("JD_LOGISTICS_DOWNLOAD_TASK_AMBIGUOUS");
  const task = matching[0]; if (!task) return undefined;
  if (task.taskName !== "店铺商品列表" || String(task.bizType) !== "111" || exactNumericId(task.deptId) !== productLogisticsDepartmentId(scope.businessUnitCode)
    || typeof task.createTime !== "string" || !inWindow(task.createTime, window) || !["2", "3", "4"].includes(String(task.taskStatus)) || typeof task.taskStatus !== "string") fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH");
  const count = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fail("JD_LOGISTICS_PRODUCTS_TASK_COUNT_INVALID");
  let params: Record<string, unknown>;
  try { if (typeof task.taskParams !== "string") fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH"); params = JSON.parse(task.taskParams); } catch { return fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH"); }
  const allowed = ["shopGoodsShopIdList", "shopGoodsDeptId", "shopGoodsDeptNo", "shopGoodsYn", "shopGoodsStatus"];
  if (!params || Object.keys(params).some(key => !allowed.includes(key)) || params.shopGoodsStatus !== 1 || params.shopGoodsYn !== 1
    || exactNumericId(params.shopGoodsDeptId) !== productLogisticsDepartmentId(scope.businessUnitCode) || params.shopGoodsDeptNo !== scope.businessUnitCode
    || !Array.isArray(params.shopGoodsShopIdList) || !params.shopGoodsShopIdList.length || params.shopGoodsShopIdList.length > 2000) fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH");
  const shops = params.shopGoodsShopIdList.map(exactNumericId).sort();
  if (new Set(shops).size !== shops.length || !Number.isSafeInteger(task.successCount) || Number(task.successCount) < 0) fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH");
  return { id: taskId, deptId: String(task.deptId), taskStatus: task.taskStatus, recordCount: count(task.recordCount), successCount: Number(task.successCount),
    createTime: logisticsSourceTime(task.createTime), shopSetHash: logisticsHash(shops), shopCount: shops.length };
}
export function productLogisticsTaskCompleted(task: ProductLogisticsTask) {
  if (task.taskStatus === "4") fail("JD_LOGISTICS_PRODUCTS_EXPORT_TASK_FAILED");
  if (task.taskStatus === "3") return true;
  if (task.taskStatus !== "2") fail("JD_LOGISTICS_PRODUCTS_TASK_SCOPE_MISMATCH");
  return false;
}
export function flowLogisticsRequest(scope: JdLogisticsScope) {
  return [{ pledgeStockFlowDataType: null, source: "seller", deptRequest: { deptIdList: [productLogisticsDepartmentId(scope.businessUnitCode)] },
    goodsRequest: { goodsLevelNoList: [], goodsNoList: [], isvSkuList: [], sellerGoodsSignList: [] }, pledgeRequest: { pledgeSource: "", pledgeUserCodeList: [] },
    stockFlowRequest: { bizNoList: [], bizTypeList: [], endTime: `${scope.rangeEnd} 00:00:00`, startTime: `${scope.rangeStart} 00:00:00`, sellerBizNoList: [], stockStatusList: [], stockTypeList: [], pipelineList: [] },
    warehouseRequest: { warehouseIdList: [] }, logicStockFlowDataType: null, logicRequest: { factor1List: [], factor2List: [], factor3List: [], factor4List: [] },
    currentPage: 1, pageSize: 10, dateEnd: logisticsDayAfter(scope.rangeEnd, -1), dateStart: scope.rangeStart }];
}
export function assertFlowLogisticsRequest(request: unknown, scope: JdLogisticsScope) {
  if (scope.sourceKind !== "flow" || scope.warehouseCode || logisticsHash(request) !== logisticsHash(flowLogisticsRequest(scope))) fail("JD_LOGISTICS_FLOW_REQUEST_SCOPE_MISMATCH");
  return logisticsHash(request);
}
export function flowLogisticsQueryTotal(value: unknown, request: unknown, scope: JdLogisticsScope) {
  assertFlowLogisticsRequest(request, scope);
  const payload = value as { success?: unknown; data?: { code?: unknown; success?: unknown; total?: unknown; stockFlowDataList?: unknown } } | null;
  if (!payload || payload.success !== true || !payload.data || payload.data.success !== true || payload.data.code !== 200 || !Number.isSafeInteger(payload.data.total)
    || Number(payload.data.total) < 1 || Number(payload.data.total) > 20000 || !Array.isArray(payload.data.stockFlowDataList)
    || payload.data.stockFlowDataList.length !== Math.min(Number(payload.data.total), 10)) fail("JD_LOGISTICS_FLOW_QUERY_TOTAL_UNPROVEN");
  return Number(payload.data.total);
}
export function flowLogisticsAttachment(value: unknown, request: unknown, scope: JdLogisticsScope) {
  assertFlowLogisticsRequest(request, scope);
  const payload = value as { success?: unknown; data?: { code?: unknown; success?: unknown; type?: unknown; msg?: unknown } } | null;
  if (!payload || payload.success !== true || !payload.data || payload.data.success !== true || payload.data.code !== 200 || payload.data.type !== 1 || typeof payload.data.msg !== "string") fail("JD_LOGISTICS_FLOW_DIRECT_ATTACHMENT_UNPROVEN");
  let url: URL;
  try { url = new URL(payload.data.msg); } catch { return fail("JD_LOGISTICS_FLOW_ATTACHMENT_URL_REJECTED"); }
  if (url.origin !== "https://s3-ipv6.cn-north-1.jdcloud-oss.com" || !url.pathname.startsWith("/eclp-stock-back-oss/export/pub/stock_flow_")
    || !url.pathname.endsWith(".csv") || url.search || url.hash || url.username || url.password) fail("JD_LOGISTICS_FLOW_ATTACHMENT_URL_REJECTED");
  return url.href;
}
