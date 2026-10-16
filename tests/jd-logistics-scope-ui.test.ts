import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import type { JdLogisticsExportOptions } from "../lib/jd/logistics-policy";
import { prepareJdLogisticsSourceScope } from "../tools/jd-logistics-export";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
function options(sourceKind: JdLogisticsExportOptions["sourceKind"] = "shop_products"): JdLogisticsExportOptions {
  return { root: "unused", runId: "fixture", executionId: "fixture", operationId: "fixture", sourceKind,
    businessUnitCode: "EBU4418046540089", departmentId: "fixture", rangeStart: "2026-10-15", rangeEnd: "2026-10-16", warehouseCode: "",
    sourceStatus: "enabled", contractVersion: "jd-logistics-v1", downloadDirectory: "unused", assertOwner: async () => { throw new Error("scope preparation must not call business ownership or submission"); },
    store: { storeKey: "fixture", platform: "京东", enabled: true, accountLabel: "fixture", shopName: "fixture", shopId: "1",
      browser: { executablePath: "unused", userDataDir: "unused", profileName: "Default", profileDir: "unused", debugPort: 1, downloadDir: "unused" } } };
}
type Fixture = { kind?: "shop_products" | "realtime_inventory" | "inventory_snapshot"; expanded?: boolean; initialStatus?: string;
  fieldDelay?: number; optionDelay?: number; valueDelay?: number; panels?: number; duplicateOption?: boolean; duplicateField?: boolean;
  expanders?: number; disabledInput?: boolean; disabledOption?: boolean; wrongValue?: boolean; partial?: boolean;
  selectedTabs?: boolean; ariaDelay?: number; noAria?: boolean; duplicateTab?: boolean };
function html(f: Fixture = {}) {
  const kind = f.kind ?? "shop_products", product = kind === "shop_products", snapshot = kind === "inventory_snapshot";
  const status = product ? "商品状态" : "仓库状态", target = product ? "启用" : "全部";
  const statusField = `<div class="el-form-item"><label class="el-form-item__label">${status}：</label><input id="status" readonly ${f.disabledInput ? "disabled" : ""} value="${f.initialStatus ?? (product ? "全部" : "启用")}" onclick="openStatus(this)"></div>`;
  const tabs = product ? "" : [["C仓", "其他仓"], ["明细表", "汇总表"], ...(snapshot ? [["分仓", "不分仓"]] : [])].map((group, i) =>
    `<div class="tabs" data-group="${i}">${group.map((name, index) => `<div role="tab" style="display:inline-block;padding:8px" aria-selected="${f.selectedTabs ? index === 0 : index !== 0}" onclick="selectTab(this)">${name}</div>`).join("")}</div>`).join("");
  return `<html><body><script>window.effects={expand:0,input:0,option:0,tabs:0,query:0,export:0};</script>
    ${tabs}${f.duplicateTab ? '<div role="tab" aria-selected="false">C仓</div>' : ""}
    ${snapshot ? '<input placeholder="选择日期" value="2026-10-15">' : ""}
    <div class="el-form-item"><label class="el-form-item__label">所属事业部</label><input value="EBU4418046540089"></div>
    <div class="el-form-item"><label class="el-form-item__label">仓库</label><input value=""><input value=""></div>
    <div class="el-form-item"><label class="el-form-item__label">商品名称</label><input value="${f.partial ? "retained-partial-filter" : ""}"></div>
    ${product ? Array.from({ length: f.expanders ?? 1 }, () => '<span style="display:inline-block;padding:8px" onclick="expandAdvanced()">展开</span>').join("") : ""}
    <div id="advanced" style="display:${product && !f.expanded ? "none" : "block"}">${product || snapshot ? statusField + (f.duplicateField ? statusField : "") : ""}</div>
    <button onclick="window.effects.query++">查询</button><button onclick="window.effects.export++">导出</button>
    <script>
      function expandAdvanced(){window.effects.expand++;setTimeout(()=>document.querySelector('#advanced').style.display='block',${f.fieldDelay ?? 0});}
      function openStatus(input){window.effects.input++;setTimeout(()=>{
        for(let i=0;i<${f.panels ?? 1};i++){
          const panel=document.createElement('ul');panel.className='el-select-dropdown';panel.innerHTML=${JSON.stringify(`<li class="el-select-dropdown__item ${f.disabledOption ? "is-disabled" : ""}">${target}</li>` + (f.duplicateOption ? `<li class="el-select-dropdown__item">${target}</li>` : ""))};
          panel.querySelectorAll('li').forEach(option=>option.onclick=()=>{window.effects.option++;setTimeout(()=>{input.value=${JSON.stringify(f.wrongValue ? "WRONG" : target)};panel.remove();},${f.valueDelay ?? 0});});
          document.body.append(panel);
        }
      },${f.optionDelay ?? 0});}
      function selectTab(tab){window.effects.tabs++;${f.noAria ? "return;" : `setTimeout(()=>{tab.parentElement.querySelectorAll('[role=tab]').forEach(t=>t.setAttribute('aria-selected','false'));tab.setAttribute('aria-selected','true');},${f.ariaDelay ?? 0});`}}
    </script></body></html>`;
}
async function effects(page: Page) { return page.evaluate(() => (window as any).effects); }

test("product and JH scope setup shares the real DOM preparation entry without query/export", { skip: !existsSync(chrome), timeout: 45000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking"] });
  t.after(() => browser.close());
  async function pageFor(f: Fixture) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => route.abort());
    const page = await context.newPage(); await page.setContent(html(f)); return page;
  }
  await t.test("collapsed product controls expand once and wait for delayed field, options and selected value", async () => {
    const page = await pageFor({ fieldDelay: 120, optionDelay: 120, valueDelay: 120 });
    try {
      const scopeHash = await prepareJdLogisticsSourceScope(page, options()); assert.match(scopeHash, /^[a-f0-9]{64}$/);
      assert.equal(await page.locator("#status").inputValue(), "启用");
      assert.equal(await prepareJdLogisticsSourceScope(page, options()), scopeHash);
      assert.deepEqual(await effects(page), { expand: 1, input: 1, option: 1, tabs: 0, query: 0, export: 0 });
    } finally { await page.context().close(); }
  });
  await t.test("an already-expanded enabled product field never toggles or reopens its dropdown", async () => {
    const page = await pageFor({ expanded: true, initialStatus: "启用" });
    try {
      await prepareJdLogisticsSourceScope(page, options());
      assert.deepEqual(await effects(page), { expand: 0, input: 0, option: 0, tabs: 0, query: 0, export: 0 });
    } finally { await page.context().close(); }
  });
  for (const [name, fixture, error] of [
    ["duplicate expanders", { expanders: 2 }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["duplicate product fields", { expanded: true, duplicateField: true }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["multiple delayed dropdown panels", { expanded: true, panels: 2, optionDelay: 120 }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["duplicate target options", { expanded: true, duplicateOption: true }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["disabled input", { expanded: true, disabledInput: true }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["disabled target option", { expanded: true, disabledOption: true }, "PRODUCT_STATUS_CONTROL_AMBIGUOUS"],
    ["a selected value that does not match", { expanded: true, wrongValue: true }, "ENABLED_PRODUCT_SCOPE_MISMATCH"],
    ["a retained nonempty partial filter", { expanded: true, initialStatus: "启用", partial: true }, "PARTIAL_SCOPE_FILTER"],
  ] as const) await t.test(`${name} refuses before any query/export`, async () => {
    const page = await pageFor(fixture);
    try {
      await assert.rejects(prepareJdLogisticsSourceScope(page, options()), new RegExp(`JD_LOGISTICS_${error}`));
      const actions = await effects(page); assert.equal(actions.query, 0); assert.equal(actions.export, 0);
      assert.ok(actions.expand <= 1); assert.ok(actions.input <= 1); assert.ok(actions.option <= 1);
      if (!fixture.wrongValue) assert.equal(actions.option, 0);
    } finally { await page.context().close(); }
  });
  for (const kind of ["realtime_inventory", "inventory_snapshot"] as const) await t.test(`${kind} explicitly selects the observed tabs from different initial tabs and waits for aria`, async () => {
    const page = await pageFor({ kind, ariaDelay: 120, optionDelay: 120, valueDelay: 120 });
    try {
      await prepareJdLogisticsSourceScope(page, options(kind));
      for (const name of ["C仓", "明细表", ...(kind === "inventory_snapshot" ? ["分仓"] : [])]) assert.equal(await page.getByRole("tab", { name, exact: true }).getAttribute("aria-selected"), "true");
      if (kind === "inventory_snapshot") assert.equal(await page.locator("#status").inputValue(), "全部");
      assert.deepEqual(await effects(page), { expand: 0, input: kind === "inventory_snapshot" ? 1 : 0, option: kind === "inventory_snapshot" ? 1 : 0,
        tabs: kind === "inventory_snapshot" ? 3 : 2, query: 0, export: 0 });
    } finally { await page.context().close(); }
  });
  await t.test("correct JH tabs and warehouse status are idempotent", async () => {
    const page = await pageFor({ kind: "inventory_snapshot", selectedTabs: true, initialStatus: "全部" });
    try {
      await prepareJdLogisticsSourceScope(page, options("inventory_snapshot"));
      assert.deepEqual(await effects(page), { expand: 0, input: 0, option: 0, tabs: 0, query: 0, export: 0 });
    } finally { await page.context().close(); }
  });
  for (const [name, f, error] of [
    ["duplicate tabs", { kind: "realtime_inventory", duplicateTab: true }, "REALTIME_GRANULARITY_MISMATCH"],
    ["aria never confirms selection", { kind: "realtime_inventory", noAria: true }, "REALTIME_GRANULARITY_MISMATCH"],
    ["warehouse dropdown panels are ambiguous", { kind: "inventory_snapshot", selectedTabs: true, panels: 2 }, "WAREHOUSE_STATUS_CONTROL_AMBIGUOUS"],
    ["warehouse selected value is wrong", { kind: "inventory_snapshot", selectedTabs: true, wrongValue: true }, "WAREHOUSE_STATUS_NOT_ALL"],
  ] as const) await t.test(`JH ${name} refuses`, async () => {
    const page = await pageFor(f);
    try {
      await assert.rejects(prepareJdLogisticsSourceScope(page, options(f.kind)), new RegExp(`JD_LOGISTICS_${error}`));
      const actions = await effects(page); assert.equal(actions.query, 0); assert.equal(actions.export, 0); assert.ok(actions.tabs <= 1);
      assert.ok(actions.input <= 1); assert.ok(actions.option <= 1);
    } finally { await page.context().close(); }
  });
});
