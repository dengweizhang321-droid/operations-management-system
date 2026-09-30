import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { unzipSync, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ActualPanel from "../app/promotion-diagnostic-panel";
import { buildPromotionDiagnosticReport, promotionDiagnosticDisplayReport, promotionDiagnosticHtml, promotionDiagnosticXlsx, validateDiagnosticResponse, type DiagnosticPeriod } from "../lib/jd/promotion-diagnostic-report";
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
const Panel = (await import("data:text/javascript;base64,"+Buffer.from(panelBuild.outputFiles[0].text).toString("base64"))).default as (props: { shopName: string; startDate: string; endDate: string; allowPaidModel?: boolean; ratioLabel?: "ROI" | "ROAS"; expectedOwningRevision?: string }) => Element;
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
  const oldFetch = globalThis.fetch, r = renderer(); let release: ((response: Response) => void) | undefined, signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => { signal = options?.signal ?? undefined; return new Promise(resolve => { release = resolve; }); };
  try {
    r.render(props); await r.flush(); let tree = r.render(props); const load = button(tree, "生成当前周期诊断").props.onClick as () => void; load();
    r.render({ ...props, expectedOwningRevision: "13:bbbbbbbbbbbb" }); await r.flush(); assert.equal(signal?.aborted, true);
    release!(Response.json(period(), { headers: { "X-Netshop-Data-Revision": revision } })); await new Promise(resolve => setImmediate(resolve));
    tree = r.render({ ...props, expectedOwningRevision: "13:bbbbbbbbbbbb" }); assert.equal(text(tree).includes("可查看的表与建议"), false);
  } finally { r.cleanup(); globalThis.fetch = oldFetch; }
});
test("baseline 401/403 or owning-revision drift cannot be swallowed as comparison unavailable", async () => {
  const oldFetch = globalThis.fetch;
  try {
    for (const failure of [401, 403, "revision"] as const) {
      const r = renderer(); globalThis.fetch = async input => {
        const from = new URL(String(input), "http://synthetic.test").searchParams.get("startDate")!;
        return from === props.startDate ? Response.json(period(from), { headers: { "X-Netshop-Data-Revision": revision } }) : failure === "revision" ? Response.json(period(from, "13:bbbbbbbbbbbb"), { headers: { "X-Netshop-Data-Revision": "13:bbbbbbbbbbbb" } }) : Response.json({ error: "没有权限" }, { status: failure });
      };
      r.render(props); await r.flush(); const tree = r.render(props); (button(tree, "生成当前周期诊断").props.onClick as () => void)(); await new Promise(resolve => setImmediate(resolve));
      const final = r.render(props); assert.equal(text(final).includes("诊断未生成"), true); assert.equal(text(final).includes("可查看的表与建议"), false); r.cleanup();
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
  assert.match(source, /promotionDiagnosticHtml\(report, \{ ratioLabel \}\)/); assert.match(source, /promotionDiagnosticXlsx\(report, \{ ratioLabel \}\)/);
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
