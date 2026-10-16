import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Reuse the installed local DOM test library; no n8n service, DB or business data is read.
const { JSDOM, VirtualConsole } = createRequire("C:/Users/86137/AppData/Roaming/npm/node_modules/n8n/package.json")("jsdom");
const states = ["stockout", "replenish", "insufficient_evidence", "in_transit_cover", "slow_turnover", "no_sales", "healthy"];
const counts = () => Object.fromEntries(["all", ...states].map(state => [state, 0]));
const metricFields = ["onHandQuantity", "availableQuantity", "lockedQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales7dQuantity", "sales30dQuantity", "turnoverDays", "stockoutAvailableDays30d", "availableDays", "availableWithTransitDays", "nativeTurnover30d", "suggestedReplenishmentQuantity"];
const metrics = () => ({ ...Object.fromEntries(metricFields.map(key => [key, null])), metricQualifications: {}, qualifications: [], warningState: "unconfigured", inventoryHealthState: "insufficient_evidence", inventoryHealthReasons: [], healthCounts: counts(), hasStockout: false, hasReplenishmentNeed: false });
const matrix = (healthState = "all") => ({ layout: "product", salesWindow: 30, healthState, healthCounts: { ...counts(), all: 100, stockout: 42, replenish: 58 }, healthFilterCounts: { ...counts(), all: 100, stockout: 42, replenish: 63 }, columns: [], items: [], total: healthState === "stockout" ? 42 : 100, page: 1, pageSize: 25, summary: { monitoredCount: 100, qualifiedCount: 0, stockoutRiskCount: 0 }, totals: metrics(), coverageWarnings: [], notificationAvailable: false });
const code = build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './app/jd-logistics-cwarehouse-view';const root=createRoot(document.getElementById('app'));window.mount=props=>root.render(React.createElement(Workspace,props));window.unmount=()=>root.unmount();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "local-next-link", setup(api) { api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "test" })); api.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}", resolveDir: process.cwd(), loader: "js" })); } }] }).then(result => result.outputFiles[0].text);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(5); } throw new Error(`Timed out: ${label}`); }
const response = (data, status = 200) => Response.json(status === 200 ? { success: true, data: { contractVersion: "jd-logistics-v1", mode: "live", ...data } } : { success: false, error: data }, { status });
async function fixture() {
  const options = { departments: ["SYNTHETIC", "OTHER"].map(id => ({ id, name: id, businessUnitCode: id, revision: 1, warehousePreferences: [] })), warehouses: [], monitorWarehouses: ["W1", "W2"].map(key => ({ key: `code:${key}`, departmentId: "SYNTHETIC", name: key, code: key })) };
  const calls = [], pending = [], errors = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "file:///D:/synthetic-preferences.html?module=inventory&view=inbound&jdTab=monitor&jdDepartment=SYNTHETIC", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.fetch = async (input, init = {}) => {
    const url = new URL(String(input), "https://virtual.invalid"), method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    if (method === "PATCH") return new Promise(resolve => pending.push({ body: JSON.parse(init.body), resolve }));
    if (url.searchParams.get("operation") === "options") return response(structuredClone(options));
    const base = matrix(url.searchParams.get("healthState") ?? "all");
    return response({ ...base, salesWindow: Number(url.searchParams.get("salesWindow")), total: 2, page: 1, items: ["A", "B"].map(goodsCode => ({ ...metrics(), id: goodsCode, goodsCode, goodsName: goodsCode, details: [], detailCount: 0, detailsComplete: true, summary: metrics(), cells: [] })) });
  };
  const props = { currentUser: { id: "admin", role: "admin", scope: null } };
  w.eval(await code); w.mount(props);
  await until(() => w.document.querySelector('[data-goods-code="A"]'), "matrix");
  return { w, calls, pending, options, props, close: async () => { w.unmount(); await pause(10); assert.deepEqual(errors, []); w.close(); } };
}
function button(f, label) { const node = [...f.w.document.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(node, label); return node; }
function drag(f, handle, target) {
  const event = new f.w.Event("dragstart", { bubbles: true }); Object.defineProperty(event, "dataTransfer", { value: { setData() {} } }); handle.dispatchEvent(event);
  target.dispatchEvent(new f.w.Event("dragover", { bubbles: true, cancelable: true })); target.dispatchEvent(new f.w.Event("drop", { bubbles: true, cancelable: true }));
}
test("warehouse Dialog saves drag order, alias and switch; rejected CAS preserves draft", async () => {
  const f = await fixture();
  try {
    button(f, "仓库设置").click(); await until(() => f.w.document.querySelector('[role="dialog"]'), "warehouse dialog");
    const input = f.w.document.querySelector('[aria-label="W2的自定义名称"]');
    Object.getOwnPropertyDescriptor(f.w.HTMLInputElement.prototype, "value").set.call(input, "优先仓"); input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
    f.w.document.querySelector('[aria-label="W1显示开关"]').click();
    drag(f, f.w.document.querySelector('[aria-label="拖动W2"]'), f.w.document.querySelectorAll('.jd-monitor-warehouse-row')[0]);
    await until(() => f.w.document.querySelector('.jd-monitor-warehouse-row').textContent.includes("W2"), "warehouse drag");
    button(f, "保存仓库设置").click(); await until(() => f.pending.length === 1, "save request");
    assert.deepEqual(f.pending[0].body.warehousePreferences, [{ warehouseKey: "code:W2", enabled: true, displayName: "优先仓" }, { warehouseKey: "code:W1", enabled: false, displayName: "" }]);
    assert.equal(f.pending[0].body.expectedRevision, 1);
    f.pending[0].resolve(response("设置已变化，请刷新后重试", 409));
    await until(() => f.w.document.querySelector('[role="dialog"] [role="alert"]'), "CAS conflict");
    assert.equal(f.w.document.querySelector('[aria-label="W2的自定义名称"]').value, "优先仓");
    assert.equal(f.w.document.querySelector('[aria-label="W1显示开关"]').checked, false);
  } finally { await f.close(); }
});
test("downward product drag saves after target; late success refreshes revision across scope change", async () => {
  const f = await fixture();
  try {
    drag(f, f.w.document.querySelector('[aria-label="拖动A排序"]'), f.w.document.querySelector('[data-goods-code="B"]'));
    await until(() => f.pending.length === 1, "product move");
    assert.deepEqual(f.pending[0].body.productMove, { goodsCode: "A", targetGoodsCode: "B", placement: "after" });
    const url = new URL(f.w.location.href); url.searchParams.set("jdSalesWindow", "7"); f.w.history.pushState(null, "", url.href); f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
    await until(() => f.calls.some(call => call.url.searchParams.get("salesWindow") === "7"), "changed scope");
    f.options.departments[0].revision = 2;
    f.pending[0].resolve(response({ ...f.options.departments[0] }));
    await until(() => !button(f, "仓库设置").disabled, "new revision available");
    await pause(30); button(f, "仓库设置").click(); await until(() => f.w.document.querySelector('[role="dialog"]'), "dialog after move");
    button(f, "保存仓库设置").click(); await until(() => f.pending.length === 2, "second save");
    assert.equal(f.pending[1].body.expectedRevision, 2);
    f.pending[1].resolve(response({ ...f.options.departments[0], revision: 3 }));
    await until(() => !f.w.document.querySelector('[role="dialog"]'), "dialog closed");
    f.props.currentUser = { id: "viewer", role: "viewer", scope: null }; f.w.mount({ ...f.props });
    await until(() => button(f, "仓库设置").disabled, "viewer cannot configure");
    assert.equal(f.w.document.querySelector('[aria-label="拖动A排序"]'), null);
  } finally { await f.close(); }
});
