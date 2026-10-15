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
const options = { departments: [{ id: "SYNTHETIC", name: "合成事业部", businessUnitCode: "SYNTHETIC-BU", revision: 17, stockoutThresholdDays: null, replenishmentCycleDays: 30 }], warehouses: [], scopeRevisions: [] };
const code = build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './app/jd-logistics-cwarehouse-view';const root=createRoot(document.getElementById('app'));window.mount=props=>root.render(React.createElement(Workspace,props));window.unmount=()=>root.unmount();`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "local-next-link", setup(api) { api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "test" })); api.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}", resolveDir: process.cwd(), loader: "js" })); } }] }).then(result => result.outputFiles[0].text);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(5); } throw new Error(`Timed out: ${label}`); }
const response = (data, status = 200) => Response.json(status === 200 ? { success: true, data: { contractVersion: "jd-logistics-v1", mode: "live", ...data } } : { success: false, error: data }, { status });
async function fixture({ fileSnapshot = false, holdAll = false } = {}) {
  const errors = [], calls = [], pending = [];
  const vc = new VirtualConsole(); vc.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "file:///D:/synthetic-health.html?module=inventory&view=inbound&jdTab=monitor&jdDepartment=SYNTHETIC&jdPage=3", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window; w.Response = Response; w.Request = Request; w.Headers = Headers;
  w.fetch = (input, init = {}) => {
    const url = new URL(String(input), "https://virtual.invalid"), method = init.method ?? "GET", operation = url.searchParams.get("operation");
    assert.equal(url.pathname, "/api/inventory/jd-logistics");
    const call = { method, operation, url, signal: init.signal, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
    if (method !== "GET") return new Promise(resolve => pending.push({ ...call, resolve }));
    if (operation === "options") return Promise.resolve(response(structuredClone(options)));
    if (operation === "inventory_monitor") {
      if (holdAll && url.searchParams.get("healthState") === "all") return new Promise(resolve => pending.push({ ...call, resolve }));
      return Promise.resolve(response({ ...matrix(url.searchParams.get("healthState")), page: Number(url.searchParams.get("page")) }));
    }
    throw new Error(`Unexpected operation ${operation}`);
  };
  const props = { currentUser: { id: "synthetic-admin", role: "admin", scope: null }, fileSnapshot, fileCycleDays: 30, fileCycleOptions: [7, 30, 60] };
  w.eval(await code); w.mount(props);
  await until(() => calls.some(call => call.operation === "inventory_monitor"), "initial monitor request");
  return { w, calls, pending, props, close: async () => { w.unmount(); await pause(10); assert.deepEqual(errors, []); w.close(); } };
}
function button(f, text) { const value = [...f.w.document.querySelectorAll("button")].find(node => node.textContent === text); assert.ok(value, text); return value; }
function healthTab(f, state) { const labels = { stockout: "缺货", replenish: "补货", all: "全部" }; return [...f.w.document.querySelectorAll('[aria-label="库存健康筛选"] button')].find(node => node.querySelector("span")?.textContent === labels[state]); }

for (const outcome of ["success", "error"]) test(`health scope aborts old request and rejects delayed ${outcome} while using server tab counts`, async () => {
  const f = await fixture({ holdAll: true });
  try {
    healthTab(f, "stockout").click();
    await until(() => healthTab(f, "stockout")?.getAttribute("aria-selected") === "true" && healthTab(f, "replenish")?.querySelector("strong")?.textContent === "63", "new health response");
    assert.equal(new URL(f.w.location.href).searchParams.get("jdHealth"), "stockout");
    assert.equal(new URL(f.w.location.href).searchParams.get("jdPage"), "1");
    assert.ok(f.calls.some(call => call.operation === "inventory_monitor" && call.url.searchParams.get("healthState") === "stockout" && call.url.searchParams.get("page") === "1"));
    assert.ok(f.pending.length > 0); assert.ok(f.pending.every(call => call.signal.aborted));
    for (const old of f.pending) old.resolve(outcome === "success" ? response(matrix("all")) : response("SYNTHETIC_OLD_HEALTH_ERROR", 409));
    await pause(40);
    assert.equal(healthTab(f, "stockout").querySelector("strong").textContent, "42");
    assert.equal(healthTab(f, "replenish").querySelector("strong").textContent, "63");
    assert.doesNotMatch(f.w.document.body.textContent, /SYNTHETIC_OLD_HEALTH_ERROR/);
    const before = f.calls.length; healthTab(f, "stockout").click(); await pause(15); assert.equal(f.calls.length, before);
  } finally { await f.close(); }
});

test("file cycle Dialog applies only the local callback without submit or PATCH", async () => {
  const f = await fixture({ fileSnapshot: true }); const applied = []; let submits = 0;
  try {
    f.props.currentUser = { id: "synthetic-viewer", role: "viewer", scope: null };
    f.props.onFileCycleChange = days => { applied.push(days); f.props.fileCycleDays = days; f.w.mount({ ...f.props }); };
    f.w.mount({ ...f.props });
    await until(() => !button(f, "库存周转设置").disabled, "local cycle enabled");
    f.w.document.addEventListener("submit", event => { submits += 1; event.preventDefault(); event.stopImmediatePropagation(); }, true);
    button(f, "库存周转设置").click();
    await until(() => f.w.document.querySelector('[role="dialog"] select'), "local Dialog select");
    const select = f.w.document.querySelector('[role="dialog"] select'); select.value = "60"; select.dispatchEvent(new f.w.Event("change", { bubbles: true }));
    await until(() => button(f, "应用本地试算").disabled === false, "local cycle valid");
    assert.equal(button(f, "应用本地试算").type, "button"); button(f, "应用本地试算").click();
    await until(() => f.w.document.body.textContent.includes("当前 60 天"), "local cycle applied");
    assert.deepEqual(applied, [60]); assert.equal(submits, 0); assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
    assert.equal(f.w.document.querySelector('[role="dialog"]'), null);
  } finally { await f.close(); }
});

test("formal cycle save keeps the existing admin CAS payload and discards a delayed role-change success", async () => {
  const f = await fixture();
  try {
    button(f, "库存周转设置").click(); await until(() => f.w.document.querySelector('[role="dialog"] form'), "formal cycle Dialog");
    f.w.document.querySelector('[role="dialog"] form').dispatchEvent(new f.w.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => f.pending.length === 1, "cycle PATCH");
    assert.deepEqual(f.pending[0].body, { operation: "settings", departmentId: "SYNTHETIC", expectedRevision: 17, replenishmentCycleDays: 30 });
    f.w.mount({ ...f.props, currentUser: { id: "synthetic-viewer", role: "viewer", scope: null } });
    await until(() => button(f, "库存周转设置").disabled, "viewer committed");
    let previous = -1, quiet = 0; for (let i = 0; i < 100 && quiet < 15; i++) { await pause(5); quiet = f.calls.length === previous ? quiet + 1 : 0; previous = f.calls.length; } assert.ok(quiet >= 15); const before = f.calls.length; f.pending[0].resolve(response({ saved: true })); await pause(40);
    assert.doesNotMatch(f.w.document.body.textContent, /库存周转周期已保存/); assert.equal(f.w.document.querySelector('[role="dialog"]'), null); assert.equal(f.calls.length, before);
  } finally { await f.close(); }
});


test("changed formal cycle resets the filtered second page while preserving health and scope", async () => {
  const f = await fixture();
  try {
    const url = new URL(f.w.location.href);
    for (const [key, value] of Object.entries({ jdHealth: "replenish", jdPage: "2", jdQuery: "SYNTHETIC-MODEL", jdWarehouse: "name:SYNTHETIC-WH" })) url.searchParams.set(key, value);
    f.w.history.pushState({}, "", url.href); f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
    await until(() => f.calls.some(call => call.operation === "inventory_monitor" && call.url.searchParams.get("healthState") === "replenish" && call.url.searchParams.get("page") === "2"), "filtered page two");
    button(f, "库存周转设置").click(); await until(() => f.w.document.querySelector('[role="dialog"] input'), "cycle Dialog");
    const input = f.w.document.querySelector('[role="dialog"] input');
    Object.getOwnPropertyDescriptor(f.w.HTMLInputElement.prototype, "value").set.call(input, "7");
    input.dispatchEvent(new f.w.Event("input", { bubbles: true }));
    f.w.document.querySelector('[role="dialog"] form').dispatchEvent(new f.w.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => f.pending.length === 1, "changed cycle PATCH");
    assert.equal(f.pending[0].body.replenishmentCycleDays, 7);
    f.pending[0].resolve(response({ saved: true }));
    await until(() => f.calls.some(call => call.operation === "inventory_monitor" && call.url.searchParams.get("healthState") === "replenish" && call.url.searchParams.get("page") === "1"), "cycle refresh page one");
    const current = new URL(f.w.location.href);
    assert.equal(current.searchParams.get("jdPage"), "1"); assert.equal(current.searchParams.get("jdHealth"), "replenish");
    assert.equal(current.searchParams.get("jdQuery"), "SYNTHETIC-MODEL"); assert.equal(current.searchParams.get("jdWarehouse"), "name:SYNTHETIC-WH");
    const query = f.calls.filter(call => call.operation === "inventory_monitor").at(-1).url.searchParams;
    assert.equal(query.get("q"), "SYNTHETIC-MODEL"); assert.equal(query.get("warehouseKey"), "name:SYNTHETIC-WH");
  } finally { await f.close(); }
});
