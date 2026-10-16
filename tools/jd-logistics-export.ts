import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { connect } from "node:net";
import type { Browser, BrowserContext, Download, Frame, Page, Response } from "playwright-core";
import { withJdChromiumRunLock, defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { jdBrowserLaunchMode } from "../lib/jd/browser-mode";
import { JD_LOGISTICS_MAX_FILE_BYTES, parseJdLogisticsWorkbook } from "../lib/inventory/jd-logistics-workbook";
import { launchDedicatedChrome, closeChromeBrowser, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { writeJsonDurable } from "../lib/jackyun/json-file";
import { jdLogisticsSourceUrls, logisticsHash, logisticsDayAfter, jdLogisticsContractVersion,
  type JdLogisticsExportOptions, type JdLogisticsExportResult } from "../lib/jd/logistics-policy";
import { jhLogisticsDownloadUrl, jhLogisticsTaskIdentity, parseJhLogisticsTaskPage, selectJhLogisticsTask,
  parseProductLogisticsTaskPage, productLogisticsExportTaskId, productLogisticsQueryTotal, selectProductLogisticsTask,
  assertFlowLogisticsRequest, flowLogisticsAttachment, flowLogisticsQueryTotal,
  jhLogisticsExportRequest, jhLogisticsQueryRequest, jhLogisticsQueryTotal,
  productLogisticsDownloadAck, productLogisticsDownloadAttachment,
  type JhLogisticsTask, type JhLogisticsTaskPage } from "../lib/jd/logistics-source-tasks";
import { assertLogisticsEnabledProducts } from "../lib/jd/logistics-manifest";
export { exactTaskCandidates } from "../lib/jd/logistics-source-tasks";

type Surface = Page | Frame;
export type LogisticsExportManifest = {
  version: 2; identity: string; stage: "baseline" | "submitting" | "submitted" | "downloaded";
  runId: string; executionId: string; operationId: string; baseline: string[];
  observedBusinessUnitCode: string; submittedAt?: string; taskIdentity?: string;
  filePath?: string; rawFileHash?: string; byteSize?: number; result?: JdLogisticsExportResult;
  expectedRowCount?: number; fullScopeHash?: string;
  requestEvidence?: { observedBusinessUnitCode: string; requestedAt: string; requestHash: string; attachmentHash?: string };
  taskEvidence?: { id: number; taskBusinessUnitCode: string | null; bindingMode: "fresh_request_and_unique_task"; immutableHash: string };
  sourceStatus?: "enabled"; productTaskEvidence?: { id: string; deptId: string; taskStatus: string; recordCount: number; successCount: number; createTime: string };
  directRequestId?: string;
  queryEvidence?: { requestHash: string; total: number; observedAt: string };
};
const sources = {
  flow: { frame: /scsw\.jdl\.com\/stockBusiness\/warehouseInventoryRunningQuery(?:New)?/, heading: "仓库库存流水", report: "库存流水" },
  shop_products: { frame: /scsw\.jdl\.com\/storeGoods\/list/, heading: "店铺商品", report: "店铺商品" },
  realtime_inventory: { frame: /kadashboard\.jdl\.com\/Storage\/RealInventory/, heading: "实时库存", report: "实时库存" },
  inventory_snapshot: { frame: /kadashboard\.jdl\.com\/Storage\/OfflineInventorySmall/, heading: "库存快照", report: "库存快照" },
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jhDownloadCenter = "https://jh.jdl.com/#/downloadCenterVev";
const jhListEndpoint = "https://jh.jdl.com/api/downloadFileCenter/listPage";
const jhExportEndpoints = { realtime_inventory: "https://kaweb.jdl.com/storage/realtimeStock/exportDetail", inventory_snapshot: "https://kaweb.jdl.com/integration/storage/stock/exportDetail" } as const;
const jhQueryEndpoints = { realtime_inventory: "https://kaweb.jdl.com/storage/realtimeStock/listPageDetail", inventory_snapshot: "https://kaweb.jdl.com/integration/storage/stock/listPageDetail" } as const;
const productExportEndpoint = "https://api.jdl.com/goodsApi/exportShopGoodsList";
const productQueryEndpoint = "https://api.jdl.com/goodsApi/queryShopGoodsList";
const productTaskEndpoint = "https://api.jdl.com/exportTaskApi/queryExportTaskByPage";
const productDownloadEndpoint = "https://api.jdl.com/exportTaskApi/download";
const productAttachmentEndpoint = "https://api.jdl.com/exportTaskApi/getExportDownloadUrl";
const flowQueryEndpoint = "https://api.jdl.com/bsc/batchStock/queryStockFlowList";
const flowExportEndpoint = "https://api.jdl.com/bsc/batchStock/exportStockFlow";
function fail(code: string): never { throw new Error(code); }
export async function logisticsDebugPortClosed(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (closed: boolean) => { socket.destroy(); resolve(closed); };
    socket.setTimeout(1500, () => finish(false));
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
  });
}
export function logisticsExportIdentity(options: JdLogisticsExportOptions) {
  return logisticsHash({ runId: options.runId, executionId: options.executionId, operationId: options.operationId,
    sourceKind: options.sourceKind, departmentId: options.departmentId, businessUnitCode: options.businessUnitCode,
    rangeStart: options.rangeStart, rangeEnd: options.rangeEnd, warehouseCode: options.warehouseCode,
    contractVersion: options.contractVersion, sourceStatus: options.sourceKind === "shop_products" ? options.sourceStatus ?? "unverified" : "source_default", store: options.store });
}
async function visibleText(surface: Surface) { return surface.locator("body").innerText({ timeout: 15_000 }); }
async function uniqueButton(surface: Surface, name: RegExp | string) {
  const button = surface.getByRole("button", { name, exact: typeof name === "string" }).filter({ visible: true });
  if (await button.count() !== 1 || !await button.isEnabled()) fail("JD_LOGISTICS_CONTROL_AMBIGUOUS");
  return button;
}
async function businessSurface(page: Page, kind: JdLogisticsExportOptions["sourceKind"]): Promise<Surface> {
  const rule = sources[kind];
  for (let attempt = 0; attempt < 45; attempt++) {
    const frames = page.frames().filter(frame => rule.frame.test(frame.url()));
    if (frames.length === 1 && await frames[0].locator("body").isVisible().catch(() => false)) return frames[0];
    if (frames.length > 1) fail("JD_LOGISTICS_BUSINESS_FRAME_AMBIGUOUS");
    const text = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    if (/验证码|扫码登录|短信验证|安全验证|密码登录/.test(text)) fail("JD_LOGISTICS_LOGIN_REQUIRED");
    await page.waitForTimeout(400);
  }
  return fail("JD_LOGISTICS_BUSINESS_FRAME_NOT_READY");
}
export async function waitForJdLogisticsIdentity(readVisibleCodes: () => Promise<string[]>, codes: Set<string>, expected: string,
  waitForNext: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 250))) {
  // A visible iframe body can precede its hydrated department field. Missing
  // evidence may wait; a different or ambiguous identity never does.
  for (let attempt = 0; attempt < 40; attempt++) {
    const shown = [...new Set(await readVisibleCodes())];
    const observed = shown.length ? shown : [...codes];
    if (observed.length > 1 || observed.length === 1 && observed[0] !== expected) fail("JD_LOGISTICS_BUSINESS_UNIT_MISMATCH");
    if (observed.length === 1) return observed[0];
    if (attempt < 39) await waitForNext();
  }
  return fail("JD_LOGISTICS_BUSINESS_UNIT_NOT_READY");
}
async function identity(surface: Surface, codes: Set<string>, expected: string) {
  return waitForJdLogisticsIdentity(async () => {
    const text = await visibleText(surface);
    const values = await surface.locator("input:visible:not([type=password])").evaluateAll(elements => elements.map(e => (e as HTMLInputElement).value));
    return (`${text}\n${values.join("\n")}`).match(/\bEBU[A-Za-z0-9]+\b/g) ?? [];
  }, codes, expected);
}
async function setInputDate(surface: Surface, placeholder: string, value: string) {
  const input = surface.getByPlaceholder(placeholder, { exact: true });
  if (await input.count() !== 1) fail("JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS");
  await input.fill(value); await input.press("Tab");
  if (await input.inputValue() !== value) fail("JD_LOGISTICS_DATE_READBACK_FAILED");
}
async function visibleRangeDates(surface: Surface, start: string, end: string, openPlaceholder: string) {
  const trigger = surface.getByPlaceholder(openPlaceholder, { exact: true });
  if (await trigger.count() !== 1) fail("JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS");
  await trigger.click();
  const picker = surface.locator(".el-date-range-picker:visible");
  if (await picker.count() !== 1) fail("JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS");
  const left = picker.locator(".el-date-range-picker__content.is-left");
  const month = async () => {
    const text = (await left.locator(".el-date-range-picker__header").innerText()).replace(/\s+/g, " ");
    const found = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(text);
    if (!found || Number(found[2]) < 1 || Number(found[2]) > 12) fail("JD_LOGISTICS_CALENDAR_MONTH_NOT_VERIFIED");
    return Number(found[1]) * 12 + Number(found[2]) - 1;
  };
  for (const date of [start, end]) {
    const target = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
    for (let step = 0; await month() !== target; step++) {
      const current = await month();
      if (step >= 24 || Math.abs(current - target) > 24) fail("JD_LOGISTICS_CALENDAR_RANGE_EXCEEDS_LIMIT");
      const button = picker.locator(current < target ? "button.el-icon-arrow-right" : "button.el-icon-arrow-left").filter({ visible: true });
      if (await button.count() !== 1 || !await button.isEnabled()) fail("JD_LOGISTICS_CALENDAR_MONTH_CONTROL_AMBIGUOUS");
      await button.click();
      const expected = current + (current < target ? 1 : -1);
      for (let attempt = 0; await month() !== expected; attempt++) {
        if (attempt >= 10) fail("JD_LOGISTICS_CALENDAR_MONTH_READBACK_FAILED");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const cell = left.locator("td.available:not(.prev-month):not(.next-month)").filter({ hasText: new RegExp(`^\\s*${Number(date.slice(8, 10))}\\s*$`) });
    if (await cell.count() !== 1) fail("JD_LOGISTICS_CALENDAR_DAY_AMBIGUOUS");
    await cell.click();
  }
}
async function setScope(surface: Surface, options: JdLogisticsExportOptions) {
  if (options.warehouseCode) fail("JD_LOGISTICS_WAREHOUSE_FILTER_NOT_VERIFIED");
  if (options.sourceKind === "flow") {
    await visibleRangeDates(surface, options.rangeStart, logisticsDayAfter(options.rangeEnd, -1), "起始时间");
    if (await surface.getByPlaceholder("起始时间", { exact: true }).inputValue() !== options.rangeStart
      || await surface.getByPlaceholder("结束时间", { exact: true }).inputValue() !== logisticsDayAfter(options.rangeEnd, -1)) fail("JD_LOGISTICS_DATE_READBACK_FAILED");
    await options.assertOwner(); await (await uniqueButton(surface, "查询")).click();
  } else if (options.sourceKind === "inventory_snapshot") {
    if (logisticsDayAfter(options.rangeStart) !== options.rangeEnd) fail("JD_LOGISTICS_SNAPSHOT_SINGLE_DAY_REQUIRED");
    const date = surface.getByPlaceholder("选择日期", { exact: true });
    if (await date.inputValue() !== options.rangeStart) await setInputDate(surface, "选择日期", options.rangeStart);
    if (await surface.getByRole("tab", { name: "C仓", exact: true }).getAttribute("aria-selected") !== "true"
      || await surface.getByRole("tab", { name: "明细表", exact: true }).getAttribute("aria-selected") !== "true"
      || await surface.getByRole("tab", { name: "分仓", exact: true }).getAttribute("aria-selected") !== "true") fail("JD_LOGISTICS_SNAPSHOT_GRANULARITY_MISMATCH");
  } else if (options.sourceKind === "realtime_inventory") {
    if (await surface.getByRole("tab", { name: "C仓", exact: true }).getAttribute("aria-selected") !== "true"
      || await surface.getByRole("tab", { name: "明细表", exact: true }).getAttribute("aria-selected") !== "true") fail("JD_LOGISTICS_REALTIME_GRANULARITY_MISMATCH");
  }
}
export type LogisticsScopeReadback = { label: string; values: string[]; checked: boolean };
export function assertLogisticsFullScope(controls: LogisticsScopeReadback[], options: Pick<JdLogisticsExportOptions, "sourceKind" | "businessUnitCode" | "rangeStart" | "rangeEnd">) {
  if (!controls.length || controls.length > 100) fail("JD_LOGISTICS_SCOPE_READBACK_UNAVAILABLE");
  for (const control of controls) {
    if (control.checked) fail("JD_LOGISTICS_PARTIAL_SCOPE_FILTER");
    const values = control.values.filter(value => value.trim());
    if (/事业部/.test(control.label)) continue; // Separately bound by unique visible identity and the actual export request.
    for (const value of values) {
      if (value === "全部") continue;
      if (options.sourceKind === "shop_products" && /商品状态/.test(control.label) && value === "启用") continue;
      if (/日期|时间/.test(control.label) && [options.rangeStart, logisticsDayAfter(options.rangeEnd, -1)].includes(value)) continue;
      fail("JD_LOGISTICS_PARTIAL_SCOPE_FILTER");
    }
  }
  if (options.sourceKind === "shop_products" && !controls.some(control => /商品状态/.test(control.label) && control.values.length === 1 && control.values[0] === "启用")) fail("JD_LOGISTICS_ENABLED_PRODUCT_SCOPE_MISMATCH");
  if (options.sourceKind === "inventory_snapshot" && !controls.some(control => /仓库状态/.test(control.label) && control.values.length === 1 && control.values[0] === "全部")) fail("JD_LOGISTICS_WAREHOUSE_STATUS_NOT_ALL");
  return logisticsHash(controls);
}
async function fullScopeReadback(surface: Surface, options: JdLogisticsExportOptions) {
  const controls = await surface.locator(".el-form-item:visible").evaluateAll(items => items.map(item => {
    const visible = (element: Element) => (element as HTMLElement).offsetWidth > 0 || (element as HTMLElement).offsetHeight > 0;
    const inputs = [...item.querySelectorAll("input:not([type=password]):not([type=hidden]),textarea")].filter(visible) as HTMLInputElement[];
    return { label: item.querySelector(".el-form-item__label")?.textContent?.replace(/\s+/g, "").trim() ?? "",
      values: inputs.filter(input => !["checkbox", "radio"].includes(input.type)).map(input => input.value.trim())
        .concat(inputs.filter(input => input.type === "radio" && input.checked).map(input => input.closest("label")?.innerText.trim() ?? "unverified_radio")),
      checked: inputs.some(input => input.type === "checkbox" && input.checked) };
  }));
  return assertLogisticsFullScope(controls, options);
}
async function selectAllWarehouseStatus(surface: Surface, options: JdLogisticsExportOptions) {
  if (options.sourceKind !== "inventory_snapshot") return;
  const field = surface.locator(".el-form-item:visible").filter({ has: surface.locator(".el-form-item__label", { hasText: /^\s*仓库状态\s*[:：]?\s*$/ }) });
  if (await field.count() !== 1) fail("JD_LOGISTICS_WAREHOUSE_STATUS_CONTROL_AMBIGUOUS");
  const input = field.locator("input:visible");
  if (await input.count() !== 1) fail("JD_LOGISTICS_WAREHOUSE_STATUS_CONTROL_AMBIGUOUS");
  if (await input.inputValue() !== "全部") {
    await input.click();
    const option = surface.locator(".el-select-dropdown__item:visible").filter({ hasText: /^\s*全部\s*$/ });
    if (await option.count() !== 1) fail("JD_LOGISTICS_WAREHOUSE_STATUS_CONTROL_AMBIGUOUS");
    await option.click();
  }
  if (await input.inputValue() !== "全部") fail("JD_LOGISTICS_WAREHOUSE_STATUS_NOT_ALL");
}
async function selectEnabledProductStatus(surface: Surface) {
  const field = surface.locator(".el-form-item:visible").filter({ has: surface.locator(".el-form-item__label", { hasText: /^\s*商品状态\s*[:：]?\s*$/ }) });
  if (await field.count() !== 1) fail("JD_LOGISTICS_PRODUCT_STATUS_CONTROL_AMBIGUOUS");
  const input = field.locator("input:visible");
  if (await input.count() !== 1) fail("JD_LOGISTICS_PRODUCT_STATUS_CONTROL_AMBIGUOUS");
  if (await input.inputValue() !== "启用") {
    await input.click(); const option = surface.locator(".el-select-dropdown__item:visible").filter({ hasText: /^\s*启用\s*$/ });
    if (await option.count() !== 1) fail("JD_LOGISTICS_PRODUCT_STATUS_CONTROL_AMBIGUOUS");
    await option.click();
  }
  if (await input.inputValue() !== "启用") fail("JD_LOGISTICS_ENABLED_PRODUCT_SCOPE_MISMATCH");
}
async function sourceRowCount(surface: Surface) {
  const counts = [...new Set([...(await visibleText(surface)).matchAll(/共\s*([\d,]+)\s*条/g)].map(match => Number(match[1].replaceAll(",", ""))))];
  if (counts.length !== 1 || !Number.isSafeInteger(counts[0]) || counts[0] < 1 || counts[0] > 20000) fail("JD_LOGISTICS_SOURCE_ROW_COUNT_UNPROVEN");
  return counts[0];
}
async function stableSourceRows(page: Page, surface: Surface, options: JdLogisticsExportOptions, expected: number, scopeHash: string) {
  let stable = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    let count: number | undefined;
    try { count = await sourceRowCount(surface); } catch { /* Initial Vue render may still show the preceding count. */ }
    if (count === expected && await fullScopeReadback(surface, options) === scopeHash) stable++; else stable = 0;
    if (stable >= 2) return;
    await page.waitForTimeout(200);
  }
  fail("JD_LOGISTICS_SOURCE_COUNT_UNSTABLE");
}
export function assertJhExportRequest(body: unknown, options: JdLogisticsExportOptions) {
  const expected = jhLogisticsExportRequest(options);
  if (!body || typeof body !== "object" || Array.isArray(body) || logisticsHash(body) !== logisticsHash(expected)) fail("JD_LOGISTICS_EXPORT_REQUEST_SCOPE_MISMATCH");
  return logisticsHash(expected);
}
function watchJhFreshQuery(page: Page, options: JdLogisticsExportOptions) {
  const kind = options.sourceKind;
  if (kind !== "realtime_inventory" && kind !== "inventory_snapshot") fail("JD_LOGISTICS_JH_SOURCE_INVALID");
  const requestHash = logisticsHash(jhLogisticsQueryRequest(options));
  let ready = false, closed = false;
  let resolve!: (value: { requestHash: string; total: number; observedAt: string }) => void, reject!: (error: Error) => void;
  const promise = new Promise<{ requestHash: string; total: number; observedAt: string }>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => undefined);
  const timer = setTimeout(() => reject(new Error("JD_LOGISTICS_JH_FRESH_QUERY_UNPROVEN")), 45000);
  const observe = (response: Response) => {
    if (closed || response.url() !== jhQueryEndpoints[kind] || response.request().method() !== "POST") return;
    void (async () => {
      const request = response.request().postDataJSON();
      if (logisticsHash(request) !== requestHash) return; // The default enabled-warehouse query is not the declared all-warehouse snapshot.
      if (response.status() !== 200) fail("JD_LOGISTICS_JH_FRESH_QUERY_UNPROVEN");
      const raw = await response.text(); if (Buffer.byteLength(raw) > 2 * 1024 * 1024) fail("JD_LOGISTICS_JH_FRESH_QUERY_UNPROVEN");
      const total = jhLogisticsQueryTotal(JSON.parse(raw), request, options);
      if (!closed) { ready = true; clearTimeout(timer); resolve({ requestHash, total, observedAt: new Date().toISOString() }); }
    })().catch(() => reject(new Error("JD_LOGISTICS_JH_FRESH_QUERY_UNPROVEN")));
  };
  page.on("response", observe);
  return { promise, ready: () => ready, close: () => { closed = true; clearTimeout(timer); page.off("response", observe); } };
}
async function readJhTaskPage(page: Page, options: JdLogisticsExportOptions) {
  await options.assertOwner();
  const pending = page.waitForResponse(response => response.url() === jhListEndpoint && response.request().method() === "POST", { timeout: 20000 });
  void pending.catch(() => undefined);
  if (page.url() === jhDownloadCenter) await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  else await page.goto(jhDownloadCenter, { waitUntil: "domcontentloaded", timeout: 30000 });
  const response = await pending;
  if (response.status() !== 200) fail("JD_LOGISTICS_JH_TASK_LIST_UNAVAILABLE");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 256 * 1024) fail("JD_LOGISTICS_JH_TASK_LIST_TOO_LARGE");
  let payload: unknown, body: unknown;
  try { payload = JSON.parse(raw); body = response.request().postDataJSON(); } catch { return fail("JD_LOGISTICS_JH_TASK_LIST_INVALID"); }
  return parseJhLogisticsTaskPage(payload, body);
}
export async function downloadJhLogisticsFile(page: Page, rawUrl: string | null, target: string) {
  const url = jhLogisticsDownloadUrl(rawUrl);
  const session = await page.context().newCDPSession(page);
  let blocked = false;
  const gate = (event: { requestId: string; request: { url: string } }) => {
    void (async () => {
      if (new URL(event.request.url).origin !== "https://s3.cn-north-1.jdcloud-oss.com") {
        blocked = true; await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
      } else await session.send("Fetch.continueRequest", { requestId: event.requestId });
    })().catch(() => { blocked = true; });
  };
  session.on("Fetch.requestPaused", gate);
  try {
    // CDP Request-stage interception also sees redirect requests before the
    // browser connects. A final-URL check alone would be too late.
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] });
    const pending = page.waitForEvent("download", { timeout: 45000 }); void pending.catch(() => undefined);
    const navigation = page.goto(url, { waitUntil: "commit", timeout: 45000 }).catch(error => {
      if (!/net::ERR_ABORTED|Download is starting/i.test(error instanceof Error ? error.message : "")) fail("JD_LOGISTICS_BROWSER_DOWNLOAD_NAVIGATION_FAILED");
      return null;
    });
    const [file] = await Promise.all([pending, navigation]);
    if (blocked || new URL(file.url()).origin !== "https://s3.cn-north-1.jdcloud-oss.com" || await file.failure()) fail("JD_LOGISTICS_BROWSER_DOWNLOAD_FAILED");
    await file.saveAs(target);
  } catch { fail("JD_LOGISTICS_BROWSER_DOWNLOAD_FAILED"); }
  finally { session.off("Fetch.requestPaused", gate); await session.send("Fetch.disable").catch(() => undefined); await session.detach().catch(() => undefined); }
}
async function clickExport(surface: Surface, options: JdLogisticsExportOptions) {
  await options.assertOwner();
  const buttonName = options.sourceKind === "flow" ? "导出" : options.sourceKind === "shop_products" ? "批量导出商品" : "下载报表";
  await (await uniqueButton(surface, buttonName)).click();
  if (options.sourceKind === "inventory_snapshot") {
    const dialog = surface.getByRole("dialog", { name: "按周期导出" });
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    const start = dialog.getByPlaceholder("开始日期", { exact: true });
    await visibleRangeDates(surface, options.rangeStart, options.rangeStart, "开始日期");
    if (await start.inputValue() !== options.rangeStart || await dialog.getByPlaceholder("结束日期", { exact: true }).inputValue() !== options.rangeStart) fail("JD_LOGISTICS_DATE_READBACK_FAILED");
    await options.assertOwner(); await (await uniqueButton(surface, /^导\s*出$/)).click();
  }
}
export async function awaitJhLogisticsTask(options: {
  baseline: JhLogisticsTaskPage; scope: JdLogisticsExportOptions; submittedAt: string;
  readPage: () => Promise<JhLogisticsTaskPage>; persistBound: (task: JhLogisticsTask) => Promise<void>;
  assertOwner: () => Promise<void>; now?: () => Date; wait?: () => Promise<void>; attempts?: number;
}) {
  const now = options.now ?? (() => new Date());
  let bound: JhLogisticsTask | undefined;
  for (let attempt = 0; attempt < (options.attempts ?? 90); attempt++) {
    await options.assertOwner();
    const page = await options.readPage();
    const candidate = selectJhLogisticsTask(page, options.baseline, options.scope, { submittedAt: options.submittedAt, observedAt: now().toISOString() }, bound?.id);
    if (candidate) {
      if (bound && jhLogisticsTaskIdentity(candidate) !== jhLogisticsTaskIdentity(bound)) fail("JD_LOGISTICS_DOWNLOAD_TASK_CHANGED");
      if (!bound) { bound = candidate; await options.persistBound(bound); }
      if (candidate.filesStatus === 100) {
        const fresh = selectJhLogisticsTask(await options.readPage(), options.baseline, options.scope,
          { submittedAt: options.submittedAt, observedAt: now().toISOString() }, bound.id);
        if (!fresh || fresh.filesStatus !== 100 || jhLogisticsTaskIdentity(fresh) !== jhLogisticsTaskIdentity(bound)) fail("JD_LOGISTICS_DOWNLOAD_TASK_CHANGED");
        jhLogisticsDownloadUrl(fresh.filesUrl); return fresh;
      }
    }
    await (options.wait ?? (() => new Promise(resolve => setTimeout(resolve, 1000))))();
  }
  return fail("JD_LOGISTICS_DOWNLOAD_TASK_NOT_CONFIRMED");
}
async function observedJhExport(page: Page, surface: Surface, options: JdLogisticsExportOptions) {
  const kind = options.sourceKind;
  if (kind !== "realtime_inventory" && kind !== "inventory_snapshot") return fail("JD_LOGISTICS_JH_SOURCE_INVALID");
  const endpoint = jhExportEndpoints[kind];
  const requests: Array<{ request: ReturnType<Response["request"]>; at: string }> = [];
  const record = (request: ReturnType<Response["request"]>) => {
    if (request.url() === endpoint && request.method() === "POST") requests.push({ request, at: new Date().toISOString() });
  };
  page.on("request", record);
  const pending = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST", { timeout: 30000 });
  void pending.catch(() => undefined);
  try {
    await clickExport(surface, options);
    const response = await pending;
    if (requests.length !== 1 || requests[0].request !== response.request() || response.status() !== 200) fail("JD_LOGISTICS_EXPORT_SUBMISSION_UNPROVEN");
    const requestHash = assertJhExportRequest(response.request().postDataJSON(), options);
    const raw = await response.text(); if (Buffer.byteLength(raw) > 64 * 1024) fail("JD_LOGISTICS_EXPORT_SUBMISSION_UNPROVEN");
    let payload: { data?: unknown }; try { payload = JSON.parse(raw); } catch { return fail("JD_LOGISTICS_EXPORT_SUBMISSION_UNPROVEN"); }
    if (payload.data !== true) fail("JD_LOGISTICS_EXPORT_SUBMISSION_UNPROVEN");
    return { observedBusinessUnitCode: options.businessUnitCode, requestedAt: requests[0].at, requestHash };
  } finally { page.off("request", record); }
}
async function exportJhSource(page: Page, options: JdLogisticsExportOptions, manifestPath: string, identityHash: string, navigate: () => Promise<Surface>, observedCodes: Set<string>) {
  const first = await readJhTaskPage(page, options), baseline = await readJhTaskPage(page, options);
  if (logisticsHash(first.records.map(jhLogisticsTaskIdentity)) !== logisticsHash(baseline.records.map(jhLogisticsTaskIdentity))
    || first.total !== baseline.total) fail("JD_LOGISTICS_TASK_BASELINE_UNSTABLE");
  const fresh = watchJhFreshQuery(page, options);
  let surface: Surface, fullScopeHash: string, count: number, observedBusinessUnitCode: string;
  let queryEvidence: { requestHash: string; total: number; observedAt: string };
  try {
    observedCodes.clear(); surface = await navigate();
    observedBusinessUnitCode = await identity(surface, observedCodes, options.businessUnitCode);
    await selectAllWarehouseStatus(surface, options); await setScope(surface, options);
    fullScopeHash = await fullScopeReadback(surface, options);
    // The response observer was installed before navigation. Realtime may
    // legitimately satisfy it through its one fresh initial query.
    if (!fresh.ready()) { await options.assertOwner(); await (await uniqueButton(surface, "查询")).click(); }
    queryEvidence = await fresh.promise; count = queryEvidence.total;
    await stableSourceRows(page, surface, options, count, fullScopeHash);
  } finally { fresh.close(); }
  const manifest: LogisticsExportManifest = { version: 2, identity: identityHash, stage: "baseline", runId: options.runId, executionId: options.executionId,
    operationId: options.operationId, baseline: baseline.records.map(task => String(task.id)), observedBusinessUnitCode, expectedRowCount: count, fullScopeHash, queryEvidence };
  await writeJsonDurable(manifestPath, manifest); await options.assertOwner();
  manifest.stage = "submitting"; manifest.submittedAt = new Date().toISOString(); await writeJsonDurable(manifestPath, manifest);
  // Only this browser's one actual source export response can advance the intent.
  manifest.requestEvidence = await observedJhExport(page, surface, options);
  manifest.stage = "submitted"; await writeJsonDurable(manifestPath, manifest);
  const selected = await awaitJhLogisticsTask({ baseline, scope: options, submittedAt: manifest.requestEvidence.requestedAt,
    readPage: () => readJhTaskPage(page, options), assertOwner: options.assertOwner, persistBound: async task => {
      manifest.taskIdentity = `jh:${task.id}`;
      manifest.taskEvidence = { id: task.id, taskBusinessUnitCode: task.deptNo, bindingMode: "fresh_request_and_unique_task", immutableHash: jhLogisticsTaskIdentity(task) };
      await writeJsonDurable(manifestPath, manifest);
    } });
  await options.assertOwner();
  const filePath = path.join(options.downloadDirectory, "source.xlsx");
  await downloadJhLogisticsFile(page, selected.filesUrl, filePath);
  const bytes = new Uint8Array(await readFile(filePath));
  if (!bytes.length || bytes.length > JD_LOGISTICS_MAX_FILE_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail("JD_LOGISTICS_DOWNLOAD_NOT_XLSX");
  const collectedAt = manifest.requestEvidence.requestedAt;
  const rows = parseJdLogisticsWorkbook(bytes, options.sourceKind, options.businessUnitCode, { collectedAt, allowDeclaredBusinessUnit: true });
  if (rows.length !== count) fail("JD_LOGISTICS_EXPORT_ROW_COUNT_NOT_CONFIRMED");
  const result: JdLogisticsExportResult = { filePath, taskIdentity: manifest.taskIdentity!, complete: true, browserClosed: true, collectedAt,
    sourceAsOf: options.rangeStart, identityEvidence: { observedBusinessUnitCode, observedAt: collectedAt,
      sourceUrl: jdLogisticsSourceUrls[options.sourceKind], storeKey: options.store.storeKey },
    scope: { sourceKind: options.sourceKind, departmentId: options.departmentId, businessUnitCode: options.businessUnitCode,
      rangeStart: options.rangeStart, rangeEnd: options.rangeEnd, warehouseCode: options.warehouseCode }, contractVersion: options.contractVersion };
  manifest.filePath = filePath; manifest.rawFileHash = digest(bytes); manifest.byteSize = bytes.length;
  return { manifest, result };
}
function productTaskQueue(page: Page) {
  let closed = false;
  const queued: Array<Array<Record<string, unknown>> | Error> = [];
  let waiting: ((value: Array<Record<string, unknown>> | Error) => void) | undefined;
  const publish = (value: Array<Record<string, unknown>> | Error) => {
    if (closed) return;
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(value); }
    else if (queued.length < 32) queued.push(value);
    else { queued.length = 0; queued.push(new Error("JD_LOGISTICS_PRODUCTS_TASK_QUEUE_OVERFLOW")); }
  };
  const observe = (response: Response) => {
    if (response.url() !== productTaskEndpoint || response.request().method() !== "POST") return;
    void (async () => {
      if (response.status() !== 200) fail("JD_LOGISTICS_PRODUCTS_TASK_LIST_UNAVAILABLE");
      const raw = await response.text(); if (Buffer.byteLength(raw) > 512 * 1024) fail("JD_LOGISTICS_PRODUCTS_TASK_LIST_TOO_LARGE");
      publish(parseProductLogisticsTaskPage(JSON.parse(raw), response.request().postDataJSON()));
    })().catch(() => publish(new Error("JD_LOGISTICS_PRODUCTS_TASK_LIST_UNVERIFIED")));
  };
  page.on("response", observe);
  return { close: () => { closed = true; page.off("response", observe); }, next: async () => {
    const value = queued.shift() ?? await new Promise<Array<Record<string, unknown>> | Error>(resolve => {
      const timeout = setTimeout(() => { waiting = undefined; resolve(new Error("JD_LOGISTICS_PRODUCTS_TASK_NOT_CONFIRMED")); }, 30000);
      waiting = value => { clearTimeout(timeout); resolve(value); };
    });
    if (value instanceof Error) throw value; return value;
  } };
}
function productDownloadWatch(page: Page, context: BrowserContext) {
  const files = new Set<Download>(); const pages = new Set<Page>(); let closed = false;
  const record = (file: Download) => { if (!closed) files.add(file); };
  const attach = (candidate: Page) => { if (!closed && !pages.has(candidate)) { pages.add(candidate); candidate.on("download", record); } };
  const popup = (candidate: Page) => attach(candidate);
  const contextPage = (candidate: Page) => { void candidate.opener().then(opener => { if (opener === page) attach(candidate); }).catch(() => undefined); };
  attach(page); page.on("popup", popup); context.on("page", contextPage);
  return { close: () => { closed = true; page.off("popup", popup); context.off("page", contextPage); for (const candidate of pages) candidate.off("download", record); },
    take: async () => {
      const deadline = Date.now() + 45000;
      while (!files.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (files.size !== 1) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_AMBIGUOUS");
      return [...files][0];
    }, assertUnique: () => { if (files.size !== 1) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_AMBIGUOUS"); } };
}
function productDownloadProof(context: BrowserContext) {
  const records: Array<{ endpoint: "ack" | "url"; request: unknown; response: unknown }> = [];
  let closed = false, invalid = false;
  const observe = (response: Response) => {
    const endpoint = response.url() === productDownloadEndpoint ? "ack" : response.url() === productAttachmentEndpoint ? "url" : null;
    if (!endpoint || response.request().method() !== "POST" || closed) return;
    void (async () => {
      if (response.status() !== 200) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_UNAVAILABLE");
      const raw = await response.text(); if (Buffer.byteLength(raw) > 64 * 1024) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_UNAVAILABLE");
      if (!closed) {
        if (records.length >= 32) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_UNAVAILABLE");
        records.push({ endpoint, request: response.request().postDataJSON(), response: JSON.parse(raw) });
      }
    })().catch(() => { invalid = true; });
  };
  context.on("response", observe);
  return { close: () => { closed = true; context.off("response", observe); records.length = 0; }, take: async (taskId: string) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (invalid) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_UNAVAILABLE");
      const matching = records.filter(record => Array.isArray(record.request) && record.request.length === 1 && record.request[0]
        && (record.endpoint === "ack" ? record.request[0].taskId === taskId : record.request[0].id === taskId));
      const ack = matching.filter(record => record.endpoint === "ack"), attachment = matching.filter(record => record.endpoint === "url");
      if (ack.length > 1 || attachment.length > 1) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_AMBIGUOUS");
      if (ack.length === 1 && attachment.length === 1) {
        const ackHash = productLogisticsDownloadAck(ack[0].response, ack[0].request, taskId);
        const url = productLogisticsDownloadAttachment(attachment[0].response, attachment[0].request, taskId);
        return { url, bindingHash: logisticsHash({ taskId, ackHash, attachmentHash: logisticsHash(url) }) };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_PROOF_MISSING");
  } };
}
async function exportEnabledProducts(page: Page, context: BrowserContext, surface: Surface, options: JdLogisticsExportOptions, manifestPath: string, identityHash: string, observedCodes: Set<string>) {
  if (options.sourceStatus !== "enabled") fail("JD_LOGISTICS_ENABLED_PRODUCT_SCOPE_MISMATCH");
  await selectEnabledProductStatus(surface); const fullScopeHash = await fullScopeReadback(surface, options);
  await options.assertOwner();
  const queryPending = page.waitForResponse(response => response.url() === productQueryEndpoint && response.request().method() === "POST", { timeout: 30000 }); void queryPending.catch(() => undefined);
  await (await uniqueButton(surface, "查询")).click(); const queryResponse = await queryPending;
  if (queryResponse.status() !== 200) fail("JD_LOGISTICS_PRODUCTS_QUERY_TOTAL_UNPROVEN");
  const queryRaw = await queryResponse.text(); if (Buffer.byteLength(queryRaw) > 2 * 1024 * 1024) fail("JD_LOGISTICS_PRODUCTS_QUERY_TOTAL_UNPROVEN");
  const queryTotal = productLogisticsQueryTotal(JSON.parse(queryRaw), queryResponse.request().postDataJSON(), options.businessUnitCode);
  const expectedRowCount = queryTotal; await stableSourceRows(page, surface, options, expectedRowCount, fullScopeHash);
  const observedBusinessUnitCode = await identity(surface, observedCodes, options.businessUnitCode);
  const manifest: LogisticsExportManifest = { version: 2, identity: identityHash, stage: "baseline", runId: options.runId, executionId: options.executionId,
    operationId: options.operationId, baseline: [], observedBusinessUnitCode, sourceStatus: "enabled", expectedRowCount, fullScopeHash,
    queryEvidence: { requestHash: logisticsHash(queryResponse.request().postDataJSON()), total: queryTotal, observedAt: new Date().toISOString() } };
  await writeJsonDurable(manifestPath, manifest); await options.assertOwner();
  const tasks = productTaskQueue(page), downloads = productDownloadWatch(page, context), attachmentProof = productDownloadProof(context);
  const requests: Array<{ request: ReturnType<Response["request"]>; at: string }> = [];
  const record = (request: ReturnType<Response["request"]>) => { if (request.url() === productExportEndpoint && request.method() === "POST") requests.push({ request, at: new Date().toISOString() }); };
  page.on("request", record);
  const responsePending = page.waitForResponse(response => response.url() === productExportEndpoint && response.request().method() === "POST", { timeout: 30000 }); void responsePending.catch(() => undefined);
  try {
    manifest.stage = "submitting"; manifest.submittedAt = new Date().toISOString(); await writeJsonDurable(manifestPath, manifest);
    await clickExport(surface, options); const response = await responsePending;
    if (requests.length !== 1 || requests[0].request !== response.request() || response.status() !== 200) fail("JD_LOGISTICS_PRODUCTS_SUBMISSION_UNPROVEN");
    const raw = await response.text(); if (Buffer.byteLength(raw) > 64 * 1024) fail("JD_LOGISTICS_PRODUCTS_SUBMISSION_UNPROVEN");
    const taskId = productLogisticsExportTaskId(JSON.parse(raw), response.request().postDataJSON(), options.businessUnitCode);
    const collectedAt = requests[0].at;
    manifest.requestEvidence = { observedBusinessUnitCode, requestedAt: collectedAt, requestHash: logisticsHash(response.request().postDataJSON()) };
    manifest.taskIdentity = `products:${taskId}`; manifest.stage = "submitted"; await writeJsonDurable(manifestPath, manifest);
    let selected: ReturnType<typeof selectProductLogisticsTask>;
    for (let attempt = 0; attempt < 20; attempt++) {
      await options.assertOwner();
      const candidate = selectProductLogisticsTask(await tasks.next(), taskId, options, { submittedAt: collectedAt, observedAt: new Date().toISOString() });
      if (candidate?.taskStatus === "2") { selected = candidate; break; }
    }
    if (!selected || selected.recordCount !== expectedRowCount) fail("JD_LOGISTICS_PRODUCTS_TASK_COUNT_MISMATCH");
    manifest.productTaskEvidence = selected; await writeJsonDurable(manifestPath, manifest);
    const binding = await attachmentProof.take(taskId);
    manifest.requestEvidence.attachmentHash = binding.bindingHash; await writeJsonDurable(manifestPath, manifest);
    const file = await downloads.take();
    if (new URL(file.url()).href !== new URL(binding.url).href || await file.failure()) fail("JD_LOGISTICS_PRODUCTS_DOWNLOAD_TASK_MISMATCH");
    const filePath = path.join(options.downloadDirectory, "source.csv"); await file.saveAs(filePath); downloads.assertUnique();
    const bytes = new Uint8Array(await readFile(filePath));
    const rows = parseJdLogisticsWorkbook(bytes, "shop_products", options.businessUnitCode, { collectedAt, allowDeclaredBusinessUnit: true }); assertLogisticsEnabledProducts(rows);
    if (rows.length !== expectedRowCount) fail("JD_LOGISTICS_EXPORT_ROW_COUNT_NOT_CONFIRMED");
    const result: JdLogisticsExportResult = { filePath, taskIdentity: manifest.taskIdentity, complete: true, browserClosed: true, collectedAt, sourceStatus: "enabled",
      sourceAsOf: options.rangeStart, identityEvidence: { observedBusinessUnitCode, observedAt: collectedAt, sourceUrl: jdLogisticsSourceUrls.shop_products, storeKey: options.store.storeKey },
      scope: { sourceKind: options.sourceKind, departmentId: options.departmentId, businessUnitCode: options.businessUnitCode, rangeStart: options.rangeStart, rangeEnd: options.rangeEnd, warehouseCode: options.warehouseCode }, contractVersion: options.contractVersion };
    manifest.filePath = filePath; manifest.rawFileHash = digest(bytes); manifest.byteSize = bytes.length;
    return { manifest, result };
  } finally { page.off("request", record); tasks.close(); downloads.close(); attachmentProof.close(); }
}
async function exportFlowSource(page: Page, context: BrowserContext, surface: Surface, options: JdLogisticsExportOptions, manifestPath: string, identityHash: string, observedCodes: Set<string>) {
  await visibleRangeDates(surface, options.rangeStart, logisticsDayAfter(options.rangeEnd, -1), "起始时间");
  if (await surface.getByPlaceholder("起始时间", { exact: true }).inputValue() !== options.rangeStart
    || await surface.getByPlaceholder("结束时间", { exact: true }).inputValue() !== logisticsDayAfter(options.rangeEnd, -1)) fail("JD_LOGISTICS_DATE_READBACK_FAILED");
  const fullScopeHash = await fullScopeReadback(surface, options); await options.assertOwner();
  const pendingQuery = page.waitForResponse(response => response.url() === flowQueryEndpoint && response.request().method() === "POST", { timeout: 30000 }); void pendingQuery.catch(() => undefined);
  await (await uniqueButton(surface, "查询")).click(); const queryResponse = await pendingQuery;
  if (queryResponse.status() !== 200) fail("JD_LOGISTICS_FLOW_QUERY_TOTAL_UNPROVEN");
  const queryRaw = await queryResponse.text(); if (Buffer.byteLength(queryRaw) > 2 * 1024 * 1024) fail("JD_LOGISTICS_FLOW_QUERY_TOTAL_UNPROVEN");
  const expectedRowCount = flowLogisticsQueryTotal(JSON.parse(queryRaw), queryResponse.request().postDataJSON(), options);
  await stableSourceRows(page, surface, options, expectedRowCount, fullScopeHash);
  const observedBusinessUnitCode = await identity(surface, observedCodes, options.businessUnitCode);
  const manifest: LogisticsExportManifest = { version: 2, identity: identityHash, stage: "baseline", runId: options.runId, executionId: options.executionId,
    operationId: options.operationId, baseline: [], observedBusinessUnitCode, expectedRowCount, fullScopeHash, directRequestId: randomUUID(),
    queryEvidence: { requestHash: logisticsHash(queryResponse.request().postDataJSON()), total: expectedRowCount, observedAt: new Date().toISOString() } };
  await writeJsonDurable(manifestPath, manifest); await options.assertOwner();
  const downloads = productDownloadWatch(page, context), requests: Array<{ request: ReturnType<Response["request"]>; at: string }> = [];
  const record = (request: ReturnType<Response["request"]>) => { if (request.url() === flowExportEndpoint && request.method() === "POST") requests.push({ request, at: new Date().toISOString() }); };
  page.on("request", record);
  const pending = page.waitForResponse(response => response.url() === flowExportEndpoint && response.request().method() === "POST", { timeout: 30000 }); void pending.catch(() => undefined);
  try {
    manifest.stage = "submitting"; manifest.submittedAt = new Date().toISOString(); await writeJsonDurable(manifestPath, manifest);
    await options.assertOwner(); await (await uniqueButton(surface, "导出")).click(); const response = await pending;
    if (response.status() !== 200 || requests.length !== 1 || response.request() !== requests[0].request) fail("JD_LOGISTICS_FLOW_SUBMISSION_UNPROVEN");
    const raw = await response.text(); if (Buffer.byteLength(raw) > 64 * 1024) fail("JD_LOGISTICS_FLOW_SUBMISSION_UNPROVEN");
    const attachment = flowLogisticsAttachment(JSON.parse(raw), response.request().postDataJSON(), options);
    const collectedAt = requests[0].at, requestHash = assertFlowLogisticsRequest(response.request().postDataJSON(), options);
    manifest.requestEvidence = { observedBusinessUnitCode, requestedAt: collectedAt, requestHash, attachmentHash: logisticsHash(attachment) };
    manifest.taskIdentity = `direct:${logisticsHash({ requestId: manifest.directRequestId, requestHash, attachmentHash: manifest.requestEvidence.attachmentHash })}`;
    manifest.stage = "submitted"; await writeJsonDurable(manifestPath, manifest);
    const file = await downloads.take();
    if (new URL(file.url()).href !== attachment || await file.failure()) fail("JD_LOGISTICS_FLOW_ATTACHMENT_DOWNLOAD_MISMATCH");
    const filePath = path.join(options.downloadDirectory, "source.csv"); await file.saveAs(filePath); downloads.assertUnique();
    const bytes = new Uint8Array(await readFile(filePath));
    const rows = parseJdLogisticsWorkbook(bytes, "flow", options.businessUnitCode, { collectedAt });
    if (rows.length !== expectedRowCount) fail("JD_LOGISTICS_EXPORT_ROW_COUNT_NOT_CONFIRMED");
    const result: JdLogisticsExportResult = { filePath, taskIdentity: manifest.taskIdentity, complete: true, browserClosed: true, collectedAt,
      identityEvidence: { observedBusinessUnitCode, observedAt: collectedAt, sourceUrl: jdLogisticsSourceUrls.flow, storeKey: options.store.storeKey },
      scope: { sourceKind: "flow", departmentId: options.departmentId, businessUnitCode: options.businessUnitCode, rangeStart: options.rangeStart, rangeEnd: options.rangeEnd, warehouseCode: options.warehouseCode }, contractVersion: options.contractVersion };
    manifest.filePath = filePath; manifest.rawFileHash = digest(bytes); manifest.byteSize = bytes.length;
    return { manifest, result };
  } finally { page.off("request", record); downloads.close(); }
}
export async function exportJdLogistics(options: JdLogisticsExportOptions): Promise<JdLogisticsExportResult> {
  if (options.contractVersion !== jdLogisticsContractVersion || !path.isAbsolute(options.root)
    || !/^[A-Za-z0-9._:-]{1,100}$/.test(options.operationId) || !options.store.enabled) fail("JD_LOGISTICS_EXPORT_OPTIONS_INVALID");
  if (options.sourceKind === "shop_products" && options.sourceStatus !== "enabled") fail("JD_LOGISTICS_ENABLED_PRODUCT_SCOPE_MISMATCH");
  const directory = path.resolve(options.downloadDirectory);
  const root = path.resolve(options.root);
  if (directory === root || directory === path.parse(directory).root) fail("JD_LOGISTICS_EXPORT_DIRECTORY_INVALID");
  await mkdir(directory, { recursive: true });
  const manifestPath = path.join(directory, "export-manifest.json");
  const identityHash = logisticsExportIdentity(options);
  let previous: LogisticsExportManifest | undefined;
  try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous) {
    if (previous.version !== 2 || previous.identity !== identityHash || previous.stage !== "downloaded" || !previous.result || !previous.rawFileHash) fail("JD_LOGISTICS_EXPORT_UNRESOLVED_NO_RESUBMIT");
    if (path.resolve(previous.result.filePath) !== path.join(directory, options.sourceKind === "shop_products" || options.sourceKind === "flow" ? "source.csv" : "source.xlsx")) fail("JD_LOGISTICS_EXPORT_REUSE_PATH_MISMATCH");
    const bytes = new Uint8Array(await readFile(previous.result.filePath));
    if (digest(bytes) !== previous.rawFileHash || bytes.length !== previous.byteSize) fail("JD_LOGISTICS_EXPORT_REUSE_HASH_MISMATCH");
    return previous.result;
  }
  return withJdChromiumRunLock(`jd-logistics:${options.runId}:${options.operationId}`, async () => {
    let browser: Browser | null = null; let owned = false; let result: JdLogisticsExportResult | undefined;
    let manifest: LogisticsExportManifest | undefined;
    try {
      await options.assertOwner();
      if (!(await stat(options.store.browser.profileDir)).isDirectory()) fail("JD_LOGISTICS_PROFILE_MISSING");
      const child = await launchDedicatedChrome({ executablePath: options.store.browser.executablePath,
        profileDirectory: options.store.browser.userDataDir, profileName: options.store.browser.profileName,
        port: options.store.browser.debugPort, startUrl: "about:blank", ...jdBrowserLaunchMode(false) });
      owned = !!child;
      if (!owned) fail("JD_LOGISTICS_BROWSER_NOT_OWNED");
      await waitForChrome(options.store.browser.debugPort); browser = await connectPlaywrightBrowser(options.store.browser.debugPort);
      const context = browser.contexts()[0]; if (!context) fail("JD_LOGISTICS_BROWSER_CONTEXT_MISSING");
      const page = await context.newPage(); const observedCodes = new Set<string>();
      page.on("request", request => {
        if (request.url() === productQueryEndpoint && request.method() === "POST") {
          try {
            const body = request.postDataJSON(), params = Array.isArray(body) && body.length === 1 ? body[0]?.params : undefined;
            if (typeof params?.deptNo === "string" && /^EBU[1-9]\d{0,19}$/.test(params.deptNo) && params.deptId === params.deptNo.slice(3)) observedCodes.add(params.deptNo);
          } catch { /* An unobserved RPC shape is never synthesized from options. */ }
          return;
        }
        if (!/^https:\/\/kaweb\.jdl\.com\/(?:integration\/storage|storage\/realtimeStock)\//.test(request.url())) return;
        try { const data = request.postDataJSON(); if (typeof data?.deptNo === "string") observedCodes.add(data.deptNo); } catch { /* non-business request is not identity evidence */ }
      });
      const navigate = async () => { await page.goto(jdLogisticsSourceUrls[options.sourceKind], { waitUntil: "domcontentloaded", timeout: 60000 }); return businessSurface(page, options.sourceKind); };
      const business = await navigate();
      await identity(business, observedCodes, options.businessUnitCode);
      if (options.sourceKind === "realtime_inventory" || options.sourceKind === "inventory_snapshot") {
        const exported = await exportJhSource(page, options, manifestPath, identityHash, navigate, observedCodes);
        manifest = exported.manifest; result = exported.result;
      } else if (options.sourceKind === "shop_products") {
        const exported = await exportEnabledProducts(page, context, business, options, manifestPath, identityHash, observedCodes);
        manifest = exported.manifest; result = exported.result;
      } else {
        const exported = await exportFlowSource(page, context, business, options, manifestPath, identityHash, observedCodes);
        manifest = exported.manifest; result = exported.result;
      }
    } finally {
      await browser?.close().catch(() => undefined);
      if (owned) {
        try {
          await closeChromeBrowser(options.store.browser.debugPort);
          if (!await logisticsDebugPortClosed(options.store.browser.debugPort)) fail("JD_LOGISTICS_BROWSER_CLEANUP_FAILED");
        } catch { fail("JD_LOGISTICS_BROWSER_CLEANUP_FAILED"); }
      }
    }
    if (!result || !manifest) return fail("JD_LOGISTICS_EXPORT_RESULT_MISSING");
    manifest.stage = "downloaded"; manifest.result = result; await writeJsonDurable(manifestPath, manifest);
    return result;
  }, defaultJdChromiumRunLockDirectory(options.root));
}
