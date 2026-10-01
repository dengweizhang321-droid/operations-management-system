import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createHash } from "node:crypto";
import ActualPanel from "../app/promotion-diagnostic-panel";
import { buildPromotionDiagnosticReport, promotionDiagnosticDisplayReport, promotionDiagnosticHtml, promotionDiagnosticXlsx, validateDiagnosticResponse, type DiagnosticPeriod, type PromotionDiagnosticReport } from "../lib/jd/promotion-diagnostic-report";
import type { DiagnosticWithRelations } from "../lib/jd/promotion-diagnostic-relations";

const revision = "12:abcdefabcdef", shopName = "志高商用设备旗舰店";
function period(startDate = "2026-09-20", owningRevision = revision): DiagnosticPeriod {
  const metrics = { spendCents: 1000, impressions: 100, clicks: 20, reportedOrderLines: 2, reportedGmvCents: 9000 };
  const owner = { batchId: "synthetic-batch", status: "completed", source: "jd_promotion", dataset: "ad", platform: "京东", shopName, dateMin: startDate, dateMax: startDate, rowCount: 1, warningCount: 0 };
  const group = (key: string) => [{ key, rowCount: 1, name: "ROAS来源名称", planId: "P1", skuId: "S1", keyword: "词甲", searchTerm: "搜索甲", metrics }];
  const groups = { plans: group('["P1","ROAS来源名称"]'), products: group('["S1"]'), keywords: group('["词甲"]'), searchTerms: group('["搜索甲"]'), keywordSku: group('["词甲","S1"]'), planSku: [{ ...group('["P1","S1"]')[0]!, planKey: '["P1","ROAS来源名称"]' }], planKeyword: [{ ...group('["P1","词甲"]')[0]!, planKey: '["P1","ROAS来源名称"]' }], searchTermSku: group('["搜索甲","S1"]') };
  return { schemaVersion: "jd-promotion-diagnostic-v1", identity: { platform: "京东", shopName }, period: { startDate, endDate: startDate }, sourceRevision: owningRevision, coverage: { requestedDates: [startDate], presentDates: [startDate], missingDates: [], complete: true, rowCount: 1, aggregateReconciled: true, batchOwnershipReconciled: true }, metricAvailability: { spendCents: { totalRows: 1, presentRows: 1, complete: true }, impressions: { totalRows: 1, presentRows: 1, complete: true }, clicks: { totalRows: 1, presentRows: 1, complete: true }, reportedOrderLines: { totalRows: 1, presentRows: 1, complete: true }, reportedGmvCents: { totalRows: 1, presentRows: 1, complete: true } }, sourceBatches: [{ date: startDate, batchIds: [owner.batchId], accountNicknames: ["合成账户"], accountPresentRows: 1, rowCount: 1, aggregateBatchId: owner.batchId, ownership: [owner], aggregateOwnership: owner }], summary: metrics, daily: [{ date: startDate, rowCount: 1, metrics }], groups, limitations: ["ROAS不是利润回报率"] };
}
test("optional ROI is a display alias; defaults, canonical roas keys, IDs and numeric cells remain exact", () => {
  const report = buildPromotionDiagnosticReport(period(), period("2026-09-19"));
  const before = structuredClone(report);
  assert.equal(promotionDiagnosticDisplayReport(report), report);
  assert.deepEqual(promotionDiagnosticXlsx(report), promotionDiagnosticXlsx(report, { ratioLabel: "ROAS" }));
  assert.equal(promotionDiagnosticHtml(report), promotionDiagnosticHtml(report, { ratioLabel: "ROAS" }));
  const roi = promotionDiagnosticDisplayReport(report, { ratioLabel: "ROI" });
  assert.equal(roi.tables.find(t => t.key === "summary")!.rows.find(r => r[0] === "归因ROI")![1], 9);
  for (const [i, table] of roi.tables.entries()) {
    assert.deepEqual(table.columns.map(c => c.key), report.tables[i]!.columns.map(c => c.key));
    assert.deepEqual(table.rows.map(row => row.filter(c => typeof c === "number")), report.tables[i]!.rows.map(row => row.filter(c => typeof c === "number")));
  }
  assert.ok(roi.tables.find(t => t.key === "plans")!.columns.some(c => c.key === "roasCurrent" && c.label.includes("ROI")));
  assert.equal(roi.tables.find(t => t.key === "plans")!.rows[0]![0], "ROAS来源名称");
  assert.deepEqual(report, before);
  assert.match(promotionDiagnosticHtml(report, { ratioLabel: "ROI" }), /归因ROI/);
  const files = unzipSync(promotionDiagnosticXlsx(report, { ratioLabel: "ROI" }));
  const summary = strFromU8(files["xl/worksheets/sheet1.xml"]!);
  assert.match(summary, /归因ROI/); assert.match(summary, />9<\/v>/);
});
test("diagnostic binding requires owning header/body/parent and exact shop/date, not another token kind", () => {
  const body = period(), expected = { shopName, startDate: "2026-09-20", endDate: "2026-09-20", expectedOwningRevision: revision };
  assert.equal(validateDiagnosticResponse(body, revision, expected), body);
  for (const header of [null, "13:bbbbbbbbbbbb", "a".repeat(64)]) assert.throws(() => validateDiagnosticResponse(body, header, expected));
  for (const values of [{ expectedOwningRevision: "13:bbbbbbbbbbbb" }, { shopName: "其他店" }, { startDate: "2026-09-19" }, { endDate: "2026-09-21" }]) assert.throws(() => validateDiagnosticResponse(body, revision, { ...expected, ...values }));
});

const exportBaseline = (value: DiagnosticPeriod) => ({ identity: value.identity, period: value.period, sourceRevision: value.sourceRevision, coverage: value.coverage });
const embeddedReport = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="report">([\s\S]*?)<\/script>/)![1]!) as PromotionDiagnosticReport;
const provenanceRow = (html: string, label: string) => embeddedReport(html).tables.at(-1)!.rows.find(row => row[0] === label)!;
test("default export bytes exactly preserve the pre-provenance baseline", () => {
  const report = buildPromotionDiagnosticReport(period(), period("2026-09-19"));
  const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  // Captured from committed 43bdf332 before this optional implementation.
  assert.equal(sha(promotionDiagnosticHtml(report)), "b7122ed46eb2f592f1283021ce4a15d558ccf531d27bd8c200b9de3221b3b5f8");
  assert.equal(sha(promotionDiagnosticXlsx(report)), "a9dbc6e028440bbf7a6ac2fa780a446315e18973eeba59f846e9ab62ef0a02ba");
  assert.equal(promotionDiagnosticHtml(report), promotionDiagnosticHtml(report, { includeProvenance: false }));
  assert.deepEqual(promotionDiagnosticXlsx(report), promotionDiagnosticXlsx(report, { includeProvenance: false }));
});
test("opt-in HTML and real XLSX ZIP append owning trace while every original cell/sheet remains exact", () => {
  const current = period(), baseline = period("2026-09-19"), report = buildPromotionDiagnosticReport(current, baseline), before = structuredClone(report);
  const options = { ratioLabel: "ROI" as const, includeProvenance: true, baselineProvenance: exportBaseline(baseline) };
  const html = promotionDiagnosticHtml(report, options), basicHtml = promotionDiagnosticHtml(report, { ratioLabel: "ROI" });
  assert.deepEqual(embeddedReport(html).tables.slice(0, -1), embeddedReport(basicHtml).tables);
  assert.match(html, /<section id="export-provenance"><h2>范围与来源<\/h2>/);
  const visibleTrace = html.match(/<section id="export-provenance">([\s\S]*?)<\/section>/)![1]!;
  for (const value of [revision, "jd_promotion", "sourceRevision", "非snapshotToken", shopName, "2026-09-19", "2026-09-20", "aggregateReconciled", "batchOwnershipReconciled", "非利润回报率或增量效果"]) assert.ok(visibleTrace.includes(value), value);
  assert.deepEqual(provenanceRow(html, "来源读取状态"), ["来源读取状态", "已读取本期报告", "已读取基期来源"]);
  assert.deepEqual(provenanceRow(html, "实际来源行数"), ["实际来源行数", 1, 1]);
  const legacy = unzipSync(promotionDiagnosticXlsx(report, { ratioLabel: "ROI" })), enhanced = unzipSync(promotionDiagnosticXlsx(report, options));
  for (let i = 1; i <= report.tables.length; i++) assert.deepEqual(enhanced[`xl/worksheets/sheet${i}.xml`], legacy[`xl/worksheets/sheet${i}.xml`]);
  assert.deepEqual(enhanced["xl/styles.xml"], legacy["xl/styles.xml"]);
  assert.match(strFromU8(enhanced["xl/workbook.xml"]!), /<sheet name="范围与来源"/);
  const trace = strFromU8(enhanced[`xl/worksheets/sheet${report.tables.length + 1}.xml`]!);
  assert.match(trace, /12:abcdefabcdef/); assert.match(trace, /jd_promotion/); assert.match(trace, /2026-09-19/);
  assert.match(trace, /归因订单金额÷推广花费/); assert.match(trace, /空串与null/);
  assert.deepEqual(report, before);
});
test("baseline evidence is explicitly unknown when absent, actual when read but incomplete, and cannot fake comparable scope/version", () => {
  const current = period(), comparable = buildPromotionDiagnosticReport(current, period("2026-09-19"));
  for (const baselineProvenance of [undefined, null]) {
    const html = promotionDiagnosticHtml(comparable, { includeProvenance: true, baselineProvenance });
    assert.match(String(provenanceRow(html, "实际统计期间")[2]), /未知/);
    assert.match(String(provenanceRow(html, "netshop拥有方修订（sourceRevision，非snapshotToken）")[2]), /未知/);
    assert.match(String(provenanceRow(html, "已有来源日期")[2]), /未知/);
    assert.notEqual(provenanceRow(html, "实际来源行数")[2], 0);
  }
  const partial = period("2026-09-19");
  partial.coverage = { ...partial.coverage, presentDates: [], missingDates: ["2026-09-19"], rowCount: 0, complete: false };
  partial.sourceBatches = []; partial.summary = Object.fromEntries(Object.keys(partial.summary).map(key => [key, null])) as DiagnosticPeriod["summary"];
  partial.daily = [{ date: "2026-09-19", rowCount: 0, metrics: partial.summary }];
  for (const field of Object.values(partial.metricAvailability)) Object.assign(field, { totalRows: 0, presentRows: 0, complete: false });
  for (const key of Object.keys(partial.groups) as Array<keyof DiagnosticPeriod["groups"]>) partial.groups[key] = [];
  const report = buildPromotionDiagnosticReport(current, partial);
  assert.equal(report.previousPeriod, null); assert.equal(report.comparisonAvailable, false);
  const html = promotionDiagnosticHtml(report, { includeProvenance: true, baselineProvenance: exportBaseline(partial) });
  assert.deepEqual(provenanceRow(html, "实际统计期间"), ["实际统计期间", "2026-09-20 至 2026-09-20", "2026-09-19 至 2026-09-19"]);
  assert.deepEqual(provenanceRow(html, "缺少来源日期"), ["缺少来源日期", "无（日期列表为空）", "2026-09-19"]);
  assert.equal(provenanceRow(html, "实际来源行数")[2], 0); assert.equal(provenanceRow(html, "日期覆盖完整")[2], "不完整");
  const baseline = exportBaseline(period("2026-09-19"));
  for (const invalid of [{ ...baseline, identity: { platform: "天猫", shopName } }, { ...baseline, identity: { platform: "京东", shopName: "其他店" } }, { ...baseline, sourceRevision: "a".repeat(64) }, { ...baseline, sourceRevision: "13:bbbbbbbbbbbb" }, { ...baseline, period: { startDate: "2026-09-18", endDate: "2026-09-18" } }]) assert.throws(() => promotionDiagnosticXlsx(comparable, { includeProvenance: true, baselineProvenance: invalid }), /基期导出追溯/);
  assert.throws(() => promotionDiagnosticHtml({ ...comparable, sourceRevision: "a".repeat(64) }, { includeProvenance: true }), /拥有方修订/);
});
test("trace leaves original empty-string/null blanks, whitespace and true zero exactly intact", () => {
  const report = buildPromotionDiagnosticReport(period());
  report.tables.push({ key: "syntheticNulls", title: "合成原值", note: "测试原空值", columns: [{ key: "value", label: "原值", kind: "text" }], rows: [[""], [null], [" "], [0], [-1]] });
  const basic = unzipSync(promotionDiagnosticXlsx(report)), enhanced = unzipSync(promotionDiagnosticXlsx(report, { includeProvenance: true }));
  const key = `xl/worksheets/sheet${report.tables.length}.xml`;
  assert.deepEqual(enhanced[key], basic[key]);
  const xml = strFromU8(enhanced[key]!); assert.match(xml, /xml:space="preserve"> <\/t>/); assert.match(xml, /<v>0<\/v>/); assert.match(xml, /<v>-1<\/v>/);
  assert.deepEqual(embeddedReport(promotionDiagnosticHtml(report, { includeProvenance: true })).tables[report.tables.length - 1]!.rows, [[""], [null], [" "], [0], [-1]]);
});

type MockPrincipal = { email: string; role: string; scope: unknown };
const globals = globalThis as typeof globalThis & { __diagPrincipals?: MockPrincipal[]; __diagResult?: unknown; __diagRevision?: string | null; __diagCalls?: number; __diagHookRenderer?: HookRenderer };
const routeBuild = await build({ entryPoints: ["app/api/netshop/promotion-diagnostic/route.ts"], bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "diagnostic-owned-route-mocks", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
  builder.onResolve({ filter: /^@\/lib\/django\/netshop-service$/ }, () => ({ path: "service", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "auth" ? `
    export class AuthorizationError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
    export async function requireAppPrincipal(roles){if(JSON.stringify(roles)!=='["admin"]')throw Error('admin gate missing');const p=globalThis.__diagPrincipals.shift();if(!p||p.role!=='admin')throw new AuthorizationError(403,'access_denied','没有权限');return p;}
    export function authorizationErrorResponse(error){return error instanceof AuthorizationError?Response.json({error:error.message,code:error.code},{status:error.status}):null;}` : `
    export const NETSHOP_PROMOTION_DIAGNOSTIC_PATH='/api/netshop/promotion-diagnostic';
    export function createDjangoNetshopService(){return {request:async(p,input,options)=>{if(input.method!=='GET'||input.service!=='reader'||!options.signal)throw Error('unsafe reader');globalThis.__diagCalls++;return {data:globalThis.__diagResult,revision:globalThis.__diagRevision};}};}` }));
} }] });
const route = await import("data:text/javascript;base64,"+Buffer.from(routeBuild.outputFiles[0].text).toString("base64")) as { GET(request: Request): Promise<Response> };
const admin: MockPrincipal = { email: "synthetic@example.test", role: "admin", scope: null };
const routeUrl = "http://127.0.0.1/api/netshop/promotion-diagnostic?"+new URLSearchParams({ platform: "京东", outlet: "京东\u001f"+shopName, startDate: "2026-09-20", endDate: "2026-09-20" });
function resetRoute() { globals.__diagPrincipals = [admin, admin]; globals.__diagResult = period(); globals.__diagRevision = revision; globals.__diagCalls = 0; }
test("GET forwards the owning revision and rejects mismatched body/header or withdrawn principal", async () => {
  resetRoute(); const response = await route.GET(new Request(routeUrl)); assert.equal(response.status, 200); assert.equal(response.headers.get("X-Netshop-Data-Revision"), revision); assert.equal(response.headers.get("cache-control"), "no-store");
  for (const header of [null, "13:bbbbbbbbbbbb"]) { resetRoute(); globals.__diagRevision = header; assert.equal((await route.GET(new Request(routeUrl))).status, 409); }
  resetRoute(); globals.__diagPrincipals = [admin, { ...admin, scope: { platforms: ["天猫"], channels: [], warehouses: [] } }]; assert.equal((await route.GET(new Request(routeUrl))).status, 403);
  resetRoute(); globals.__diagPrincipals = [{ ...admin, role: "viewer" }]; assert.equal((await route.GET(new Request(routeUrl))).status, 403); assert.equal(globals.__diagCalls, 0);
});
test("GET keeps exact single-JD scope and 31-day cap", async () => {
  for (const url of [routeUrl+"&platform=京东", routeUrl.replace("platform=%E4%BA%AC%E4%B8%9C", "platform=%E5%A4%A9%E7%8C%AB"), routeUrl.replace("endDate=2026-09-20", "endDate=2026-10-21"), routeUrl+"&expectedOwningRevision="+revision]) { resetRoute(); assert.equal((await route.GET(new Request(url))).status, 400); assert.equal(globals.__diagCalls, 0); }
});

type Element = { type: string | symbol; props: { children?: unknown; [key: string]: unknown } };
type HookRenderer = { index: number; values: unknown[]; pending: Array<{ index: number; callback: () => (() => void) | undefined; deps: unknown[] }>; effects: Map<number, { deps: unknown[]; cleanup?: () => void }> };
const panelBuild = await build({ entryPoints: ["app/promotion-diagnostic-panel.tsx"], bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "no-dom-no-network-hook-mocks", setup(builder) {
  builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "fixture" }));
  builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: "jsx", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "jsx" ? `export const Fragment=Symbol.for('fragment');export function jsx(type,props){return{type,props};}export const jsxs=jsx;` : `
    const current=()=>globalThis.__diagHookRenderer;
    export function useState(initial){const r=current(),i=r.index++;if(!(i in r.values))r.values[i]=typeof initial==='function'?initial():initial;return[r.values[i],v=>r.values[i]=typeof v==='function'?v(r.values[i]):v];}
    export function useRef(initial){const r=current(),i=r.index++;if(!(i in r.values))r.values[i]={current:initial};return r.values[i];}
    export function useMemo(fn){current().index++;return fn();}
    export function useLayoutEffect(callback,deps){const r=current(),i=r.index++,old=r.effects.get(i);if(!old||deps.some((d,n)=>d!==old.deps[n]))r.pending.push({index:i,callback,deps});}export const useEffect=useLayoutEffect;` }));
} }] });
const Panel = (await import("data:text/javascript;base64,"+Buffer.from(panelBuild.outputFiles[0].text).toString("base64"))).default as (props: { shopName: string; startDate: string; endDate: string; allowPaidModel?: boolean; ratioLabel?: "ROI" | "ROAS"; expectedOwningRevision?: string; onReadInvalidated?: (code: string, message: string) => void; includeExportProvenance?: boolean }) => Element;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const e = node as Element; return [e, ...elements(e.props.children)];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : "";
}
function renderer() {
  const r: HookRenderer = { index: 0, values: [], pending: [], effects: new Map() }; globals.__diagHookRenderer = r;
  return { render(props: Parameters<typeof Panel>[0]) { r.index = 0; return Panel(props); }, async flush() { for (const e of r.pending.splice(0)) { r.effects.get(e.index)?.cleanup?.(); const cleanup = e.callback(); r.effects.set(e.index, { deps: e.deps, cleanup }); } await Promise.resolve(); }, cleanup() { for (const effect of r.effects.values()) effect.cleanup?.(); } };
}
const props = { shopName, startDate: "2026-09-20", endDate: "2026-09-20", expectedOwningRevision: revision };
const button = (tree: Element, label: string) => elements(tree).find(e => e.type === "button" && text(e) === label)!;
test("scope/revision change aborts in-flight read and late response cannot publish old report", async () => {
  const invalidations: string[] = [];
  const liveProps = { ...props, onReadInvalidated: (code: string) => { invalidations.push(code); } };
  const oldFetch = globalThis.fetch, r = renderer(); let release: ((response: Response) => void) | undefined, signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => { signal = options?.signal ?? undefined; return new Promise(resolve => { release = resolve; }); };
  try {
    r.render(liveProps); await r.flush(); let tree = r.render(liveProps); const load = button(tree, "生成当前周期诊断").props.onClick as () => void; load();
    r.render({ ...liveProps, expectedOwningRevision: "13:bbbbbbbbbbbb" }); await r.flush(); assert.equal(signal?.aborted, true);
    release!(Response.json(period(), { headers: { "X-Netshop-Data-Revision": revision } })); await new Promise(resolve => setImmediate(resolve));
    tree = r.render({ ...props, expectedOwningRevision: "13:bbbbbbbbbbbb" }); assert.equal(text(tree).includes("可查看的表与建议"), false);
    assert.deepEqual(invalidations, []);
  } finally { r.cleanup(); globalThis.fetch = oldFetch; }
});
test("baseline 401/403 or owning-revision drift cannot be swallowed as comparison unavailable", async () => {
  const oldFetch = globalThis.fetch;
  try {
    for (const failure of [401, 403, "revision"] as const) {
      const invalidations: string[] = [];
      const invalidatingProps = { ...props, onReadInvalidated: (code: string) => { invalidations.push(code); } };
      const r = renderer(); globalThis.fetch = async input => {
        const from = new URL(String(input), "http://synthetic.test").searchParams.get("startDate")!;
        return from === props.startDate ? Response.json(period(from), { headers: { "X-Netshop-Data-Revision": revision } }) : failure === "revision" ? Response.json(period(from, "13:bbbbbbbbbbbb"), { headers: { "X-Netshop-Data-Revision": "13:bbbbbbbbbbbb" } }) : Response.json({ error: "没有权限" }, { status: failure });
      };
      r.render(invalidatingProps); await r.flush(); const tree = r.render(invalidatingProps); (button(tree, "生成当前周期诊断").props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
      const final = r.render(props); assert.equal(text(final).includes("诊断未生成"), true); assert.equal(text(final).includes("可查看的表与建议"), false); r.cleanup();
      assert.deepEqual(invalidations, [failure === "revision" ? "promotion_diagnostic_binding_changed" : "access_denied"]);
    }
  } finally { globalThis.fetch = oldFetch; }
});
function focusedPeriod(from: string) {
    const value = period(from) as DiagnosticWithRelations, combined = Object.fromEntries(Object.entries(value.summary).map(([key, n]) => [key, Number(n)*2])) as DiagnosticPeriod["summary"];
    value.summary = combined; value.coverage.rowCount = 2; value.daily[0]!.rowCount = 2; value.daily[0]!.metrics = combined;
    for (const field of Object.values(value.metricAvailability)) { field.presentRows = 2; field.totalRows = 2; }
    for (const group of Object.values(value.groups)) { group[0]!.rowCount = 2; group[0]!.metrics = combined; }
    for (const batch of value.sourceBatches) { batch.rowCount = 2; batch.accountPresentRows = 2; batch.ownership[0]!.rowCount = 2; batch.aggregateOwnership.rowCount = 2; }
    value.groups.plans = [{ ...value.groups.plans[0]!, rowCount: 1, metrics: { spendCents: 1000, impressions: 100, clicks: 20, reportedOrderLines: 0, reportedGmvCents: 500 } }, { key: '["P2","计划乙"]', planId: "P2", name: "计划乙", rowCount: 1, metrics: { spendCents: 1000, impressions: 100, clicks: 20, reportedOrderLines: 4, reportedGmvCents: 17500 } }];
    value.groups.planSku = value.groups.plans.map(g => ({ ...g, key: JSON.stringify([g.planId, "S1"]), planKey: g.key, skuId: "S1" }));
    value.groups.planKeyword = value.groups.plans.map(g => ({ ...g, key: JSON.stringify([g.planId, "词甲"]), planKey: g.key, keyword: "词甲" }));
    return value;
}

test("allowPaidModel false disables the button and its callable handler makes zero POSTs", async () => {
  const oldFetch = globalThis.fetch, r = renderer(); let posts = 0;
  globalThis.fetch = async (input, options) => { if (options?.method === "POST") { posts++; throw Error("A must never dispatch paid call"); } const from = new URL(String(input), "http://synthetic.test").searchParams.get("startDate")!; return Response.json(focusedPeriod(from), { headers: { "X-Netshop-Data-Revision": revision } }); };
  try {
    const blocked = { ...props, allowPaidModel: false, ratioLabel: "ROI" as const };
    r.render(blocked); await r.flush(); let tree = r.render(blocked); (button(tree, "生成当前周期诊断").props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve)); tree = r.render(blocked);
    assert.ok(text(tree).includes("归因ROI"));
    const actions = elements(tree).find(e => e.type === "button" && e.props.role === "tab" && text(e) === "调整建议")!; (actions.props.onClick as () => void)(); tree = r.render(blocked);
    const actionReport = buildPromotionDiagnosticReport(focusedPeriod(props.startDate), focusedPeriod("2026-09-19"));
    const actionIndex = actionReport.actions.findIndex(action => action.target);
    assert.ok(actionIndex >= 0);
    const evidenceButtons = elements(tree).filter(e => e.type === "button" && text(e) === "定位");
    (evidenceButtons[actionIndex]!.props.onClick as () => void)();
    tree = r.render(blocked);
    const paid = button(tree, "用现有模型解释此对象"); assert.ok(paid); assert.equal(paid.props.disabled, true); await (paid.props.onClick as () => Promise<void>)(); await new Promise(resolve => setImmediate(resolve)); assert.equal(posts, 0);
  } finally { r.cleanup(); globalThis.fetch = oldFetch; }
});
test("legacy range guards and export alias calls stay explicit in the panel", async () => {
  const source = await readFile("app/promotion-diagnostic-panel.tsx", "utf8");
  assert.match(source, /days < 1 \|\| days > 7/); assert.match(source, /allowPaidModel = true/); assert.match(source, /ratioLabel = "ROAS"/);
  assert.match(source, /includeExportProvenance = false/); assert.match(source, /promotionDiagnosticHtml\(report, exportOptions\)/); assert.match(source, /promotionDiagnosticXlsx\(report, exportOptions\)/);
  assert.match(source, /\} : \{ ratioLabel \}, \[includeExportProvenance/);
  assert.match(source, /async function interpretFocused\(\) \{\s*if \(!allowPaidModel/); assert.match(source, /current\.sourceRevision/);
});
test("parent revision change aborts mocked AI and stale enabled handler cannot bypass paid disable", async () => {
  const oldFetch = globalThis.fetch, r = renderer(); let postCount = 0, aiSignal: AbortSignal | undefined, releaseAi: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input, options) => {
    if (options?.method === "POST") { postCount++; aiSignal = options.signal ?? undefined; return new Promise(resolve => { releaseAi = resolve; }); }
    const from = new URL(String(input), "http://synthetic.test").searchParams.get("startDate")!;
    return Response.json(focusedPeriod(from), { headers: { "X-Netshop-Data-Revision": revision } });
  };
  try {
    r.render(props); await r.flush(); let tree = r.render(props); (button(tree, "生成当前周期诊断").props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve)); tree = r.render(props);
    const actions = elements(tree).find(e => e.type === "button" && e.props.role === "tab" && text(e) === "调整建议")!; (actions.props.onClick as () => void)(); tree = r.render(props);
    const actionReport = buildPromotionDiagnosticReport(focusedPeriod(props.startDate), focusedPeriod("2026-09-19")), actionIndex = actionReport.actions.findIndex(action => action.target);
    (elements(tree).filter(e => e.type === "button" && text(e) === "定位")[actionIndex]!.props.onClick as () => void)(); tree = r.render(props);
    const enabled = button(tree, "用现有模型解释此对象"); assert.equal(enabled.props.disabled, false);
    const staleClick = enabled.props.onClick as () => void; staleClick(); await Promise.resolve(); assert.equal(postCount, 1);
    const next = { ...props, allowPaidModel: false, expectedOwningRevision: "13:bbbbbbbbbbbb" };
    r.render(next); await r.flush(); assert.equal(aiSignal?.aborted, true);
    staleClick(); await Promise.resolve(); assert.equal(postCount, 1, "captured old enabled callback must not start another mock POST");
    releaseAi!(Response.json({ sourceRevision: revision, interpretation: {} })); await new Promise(resolve => setImmediate(resolve));
    const final = r.render(next); assert.equal(text(final).includes("可查看的表与建议"), false); assert.equal(text(final).includes("规则与单模型解释"), false);
  } finally { r.cleanup(); globalThis.fetch = oldFetch; }
});
test("real React server markup stays warning-free and cannot dispatch reads or models", () => {
  const errors: unknown[][] = [], original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const html = renderToStaticMarkup(createElement(ActualPanel, { ...props, allowPaidModel: false, ratioLabel: "ROI" }));
    assert.match(html, /独立1—7天报告/); assert.equal(errors.length, 0);
  } finally { console.error = original; }
});

test("panel opt-in exports actual baseline evidence or explicit unread state using synthetic Blobs only", async () => {
  const oldFetch = globalThis.fetch, createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  const descriptors = new Map(["document", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const blobs: Blob[] = []; let posts = 0;
  URL.createObjectURL = value => { assert.ok(value instanceof Blob); blobs.push(value); return "blob:synthetic-export"; };
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ click() {}, href: "", download: "" }) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout(callback: () => void) { callback(); return 0; } } });
  try {
    for (const baseline503 of [false, true]) {
      const r = renderer(); const exportProps = { ...props, allowPaidModel: false, ratioLabel: "ROI" as const, includeExportProvenance: true };
      globalThis.fetch = async (input, options) => {
        if (options?.method === "POST") { posts++; throw Error("No model or write request admitted"); }
        const date = new URL(String(input), "http://synthetic.test").searchParams.get("startDate")!;
        return baseline503 && date !== props.startDate ? Response.json({ error: "合成基期503" }, { status: 503 }) : Response.json(period(date), { headers: { "X-Netshop-Data-Revision": revision } });
      };
      try {
        r.render(exportProps); await r.flush(); const first = r.render(exportProps); (button(first, "生成当前周期诊断").props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
        const tree = r.render(exportProps); assert.equal(button(tree, "导出 HTML").props.disabled, false);
        (button(tree, "导出 HTML").props.onClick as () => void)(); (button(tree, "导出 XLSX").props.onClick as () => void)();
        const html = await blobs.at(-2)!.text(), files = unzipSync(new Uint8Array(await blobs.at(-1)!.arrayBuffer()));
        assert.match(html, /<h2>范围与来源<\/h2>/); assert.equal(provenanceRow(html, "netshop拥有方修订（sourceRevision，非snapshotToken）")[1], revision);
        assert.match(strFromU8(files["xl/workbook.xml"]!), /<sheet name="范围与来源"/);
        if (baseline503) { assert.match(String(provenanceRow(html, "实际统计期间")[2]), /未读成功.*未知/); assert.notEqual(provenanceRow(html, "实际来源行数")[2], 0); }
        else { assert.equal(provenanceRow(html, "实际统计期间")[2], "2026-09-19 至 2026-09-19"); assert.equal(provenanceRow(html, "netshop拥有方修订（sourceRevision，非snapshotToken）")[2], revision); }
      } finally { r.cleanup(); }
    }
    assert.equal(posts, 0);
  } finally {
    globalThis.fetch = oldFetch; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
