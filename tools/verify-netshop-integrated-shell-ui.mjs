/** I author integration probe: mounts the real Home and its sole browser history.
 * A blank headless browser, dynamic loopback port, synthetic transport only.
 * This tool is reusable by Q, but its author's run is not independent review. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = process.cwd();
const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID()}`;
const role = process.env.NETSHOP_INTEGRATED_UI_ROLE || "I-harness-author";
const parent = resolve(process.env.NETSHOP_INTEGRATED_UI_EVIDENCE_ROOT || "E:/codex-artifacts/netshop-scheme2-20261001/integrated-shell-ui");
if (!/^E:[\\/]/i.test(parent)) throw new Error("Integrated UI evidence must use its external E drive directory");
const evidence = resolve(parent, runId), runtime = resolve(evidence, "browser");
await mkdir(parent, { recursive: true }); await mkdir(evidence); await mkdir(runtime);
const save = (name, value) => writeFile(resolve(evidence, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), { flag: "wx" });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const source = { head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), dirty: git("status", "--porcelain"), root, role, runId, synthetic: true };
await save("source-before.json", source);
const layoutSource = await readFile(resolve(root, "app/layout.tsx"), "utf8");
const layoutStyles = [...layoutSource.matchAll(/^import ["'](\.\/[^"']+\.css)["'];/gm)].map(match => `app/${match[1].slice(2)}`);
assert.deepEqual(layoutStyles, ["app/globals.css", "app/shell/top-navigation.css", "app/styles/shared-theme.css"], "Review the actual layout when its global stylesheet list changes");
assert.match(layoutSource, /<html lang="zh-CN">\s*<body>/, "Review the actual layout when its html/body wrapper attributes change");
const entry = layoutStyles.map(path => `import '@/${path}';`).join("\n") + `
import React from 'react';import {createRoot} from 'react-dom/client';
import Home from '@/app/page';import {installIntegratedTransport} from '@/tests/fixtures/netshop-integrated-shell-ui/bootstrap.mjs';
import {netshopColumnCapabilities,netshopColumnModules} from '@/app/netshop/shared/module-slots';
installIntegratedTransport();window.__integratedModules={products:!!netshopColumnModules.products,promotion:!!netshopColumnModules.promotion,exactPromotion:netshopColumnCapabilities.supportsPromotionProductDrill};
createRoot(document.body).render(<Home/>);`;
const checks = [], errors = [], consoleErrors = [], blockedNetwork = [];
let browser, server, page;
const check = async (name, fn) => { await fn(); checks.push(name); process.stdout.write(`PASS ${name}\n`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "integrated-entry.jsx", loader: "jsx" }, bundle: true, outfile: resolve(runtime, "ui.js"), format: "esm", platform: "browser", conditions: ["style"], jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, tsconfig: resolve(root, "tsconfig.json"), logLevel: "warning", metafile: true });
  const inputs = [];
  for (const path of Object.keys(bundle.metafile.inputs)) {
    if (path.includes("node_modules") || path === "integrated-entry.jsx") continue;
    const content = await readFile(resolve(root, path));
    inputs.push({ path, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  }
  for (const path of ["app/layout.tsx", "tools/verify-netshop-integrated-shell-ui.mjs", "tools/verify-netshop-products-ui.mjs"]) { const data = await readFile(resolve(root, path)); inputs.push({ path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }); }
  await save("compile-source.json", { ...source, sourceAfterCompile: git("rev-parse", "HEAD"), inputs, entry, layoutStyles, layoutWrapper: { html: { lang: "zh-CN" }, body: {} }, productionSourceModified: false });
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><script type="module" src="/ui.js"></script></body></html>';
  server = createServer(async (req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'");
    if (!["GET", "HEAD"].includes(req.method)) { blockedNetwork.push({ path: req.url, method: req.method }); res.writeHead(405).end(); return; }
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (["/ui.js", "/ui.css"].includes(path)) { res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css"); res.end(await readFile(resolve(runtime, path.slice(1)))); return; }
    if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (/^\/api\/netshop\/product-images\/[a-f0-9]{64}$/.test(path)) { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#d3ddd7"/><text x="12" y="36">synthetic</text></svg>'); return; }
    if (path !== "/") { blockedNetwork.push({ path, method: req.method }); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end(html);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await save("resource.json", { ...source, pid: process.pid, origin, evidence, status: "running", paidProduction: false });
  browser = await chromium.launch({ executablePath: process.env.NETSHOP_UI_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    blockedNetwork.push({ path: url.pathname, method: route.request().method(), reason: "external-network" });
    return route.abort("blockedbyclient");
  });
  page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) consoleErrors.push(message.text()); });
  const query = new URLSearchParams({ module: "shop", view: "products", period: "custom", from: "2026-09-01", to: "2026-09-01", shopPlatform: "京东", shopOutlet: "京东\u001f合成店A" });
  await page.goto(`${origin}/?${query}`);
  await check("real Home mounts the registered ProductsColumn with one real system navigation", async () => {
    await page.getByRole("heading", { name: "商品经营明细", exact: true }).waitFor();
    assert.equal(await page.getByRole("navigation", { name: "主导航", exact: true }).count(), 1);
    for (const label of ["网店分析", "AI 对话", "AI 助理"]) assert.ok(await page.getByRole("link", { name: label, exact: false }).count() >= 1);
    assert.equal(await page.locator("[data-column='products']").count(), 1);
    assert.equal(await page.locator(".np-table tbody tr").count(), 20);
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "payment_desc");
  });
  await check("complete real layout CSS positions desktop navigation above the workspace and freezes tabs below it", async () => {
    const geometry = () => page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { navigation: rect("#primary-navigation"), masthead: rect(".shell-masthead"), workspace: rect(".workspace"), tabs: rect(".module-stage .subnav"), workspaceMarginLeft: getComputedStyle(document.querySelector(".workspace")).marginLeft, stickyOffset: parseFloat(getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--app-sticky-offset")) };
    });
    const initial = await geometry();
    assert.ok(Math.abs(initial.masthead.y) <= 1, JSON.stringify(initial));
    assert.ok(initial.navigation.y >= initial.masthead.y && initial.navigation.bottom <= initial.masthead.bottom + 1, JSON.stringify(initial));
    assert.ok(initial.navigation.width > initial.navigation.height * 3, JSON.stringify(initial));
    assert.equal(initial.workspaceMarginLeft, "0px"); assert.ok(Math.abs(initial.workspace.x) <= 1, JSON.stringify(initial));
    assert.ok(initial.workspace.y >= initial.masthead.bottom - 1, JSON.stringify(initial));
    assert.ok(initial.tabs.y >= initial.masthead.bottom - 1, JSON.stringify(initial));
    assert.ok(Math.abs(initial.stickyOffset - initial.masthead.height) <= 1, JSON.stringify(initial));
    await page.evaluate(() => window.scrollTo(0, 180)); await delay(80);
    const scrolled = await geometry();
    assert.ok(Math.abs(scrolled.masthead.y) <= 1, JSON.stringify(scrolled));
    assert.ok(Math.abs(scrolled.tabs.y - scrolled.masthead.bottom) <= 1, JSON.stringify(scrolled));
    await save("desktop-layout-geometry.json", { initial, scrolled, layoutStyles });
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await check("real shell binds sort, columns and second-page product identity", async () => {
    await page.getByLabel("商品明细排序").selectOption("visitors_desc");
    await page.getByLabel("访客 / 转化 / 加购", { exact: true }).uncheck();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    await page.getByRole("button", { name: "详情", exact: true }).first().click();
    await page.getByRole("heading", { name: "两期经营成绩", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => history.state?.["teruisi.shop.presentation.v1"]?.principalKey.includes("integrated-a@example.test")));
    const detail = await page.evaluate(() => window.__integrated.calls.filter(c => c.path.endsWith("/detail")).at(-1));
    assert.equal(JSON.parse(new URLSearchParams(detail.query).get("productIdentity"))[3], "P21");
  });
  await check("source selection uses actual detail consumer and typed source", async () => {
    await page.getByRole("button", { name: "逐日明细", exact: true }).click();
    await page.getByLabel("单品明细来源").selectOption("erp");
    await page.getByRole("heading", { name: "ERP经营逐日明细", exact: true }).waitFor();
    const request = await page.evaluate(() => window.__integrated.calls.filter(c => c.path.endsWith("/detail")).at(-1));
    assert.equal(new URLSearchParams(request.query).get("source"), "erp");
  });
  await check("real list-detail-whole-store promotion-detail-list preserves a flat return", async () => {
    await page.getByRole("button", { name: "推广关联", exact: true }).click();
    if (!await page.evaluate(() => window.__integratedModules.exactPromotion)) assert.equal(await page.getByRole("button", { name: "查看对应商品推广", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "查看店铺推广", exact: true }).click();
    await page.getByRole("tab", { name: "推广分析", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "promotion");
    assert.equal(new URL(page.url()).searchParams.has("shopProduct"), false);
    assert.equal(new URL(page.url()).searchParams.has("shopReturnOrigin"), true);
    // M3's actual classic promotion has no return control. Browser history is the real return path.
    await page.goBack(); await page.getByRole("button", { name: "← 返回商品列表", exact: true }).waitFor();
    await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click();
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2");
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "visitors_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), false);
  });
  await check("browser back and forward use Home's popstate with exact detail", async () => {
    await page.goBack(); await page.getByRole("button", { name: "← 返回商品列表", exact: true }).waitFor();
    await page.goForward(); await page.getByText("合成商品 P21", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2");
  });
  await check("account mismatch discards bound presentation hints", async () => {
    await page.evaluate(() => sessionStorage.setItem("integrated-user", "B"));
    await page.reload(); await page.getByText("合成商品 P21", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "payment_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), true);
  });
  await check("unbound address navigation discards shared preferences", async () => {
    const address = page.url(); await page.goto(`${origin}/`); await page.goto(address);
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "payment_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), true);
  });
  await check("actual shop-scope change resets bound preferences and pagination", async () => {
    await page.getByLabel("商品明细排序").selectOption("visitors_desc");
    await page.getByLabel("访客 / 转化 / 加购", { exact: true }).uncheck();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    await page.getByRole("button", { name: "商品店铺", exact: true }).click();
    await page.getByRole("listbox", { name: "商品店铺选项", exact: true }).getByRole("button", { name: "清空", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByText("合成商品 P01", { exact: true }).waitFor();
    const params = new URL(page.url()).searchParams;
    assert.equal(params.has("shopOutlet"), false); assert.ok(!params.has("shopPage") || params.get("shopPage") === "1");
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "payment_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), true);
  });
  await check("actual period picker preserves rolling intent and resets old page/return/prefs", async () => {
    await page.getByLabel("商品明细排序").selectOption("visitors_desc");
    await page.getByLabel("访客 / 转化 / 加购", { exact: true }).uncheck();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    await page.getByRole("button", { name: "选择商品统计期间", exact: true }).click();
    await page.getByLabel("自定义统计周期", { exact: true }).getByRole("button", { name: "近7天", exact: true }).click();
    await page.getByLabel("自定义统计周期", { exact: true }).getByRole("button", { name: "确定", exact: true }).click();
    await page.getByText("合成商品 P01", { exact: true }).waitFor();
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get("from"), "2026-09-25"); assert.equal(params.get("to"), "2026-10-01");
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "payment_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), true);
    assert.equal(params.has("shopReturnOrigin"), false); assert.equal(params.has("shopProduct"), false);
    const request = await page.evaluate(() => window.__integrated.calls.filter(c => c.path === "/api/netshop/product-insights").at(-1));
    assert.equal(new URLSearchParams(request.query).get("periodKind"), "rolling");
  });
  await check("search and clear use the real list callback and reset only its page", async () => {
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByText("合成商品 P21", { exact: true }).waitFor();
    await page.getByLabel("表内搜索商品名称、ID或商家码").fill("P41");
    await page.getByText("合成商品 P41", { exact: true }).waitFor();
    assert.equal(await page.locator(".np-table tbody tr").count(), 1);
    await page.getByLabel("表内搜索商品名称、ID或商家码").fill("");
    await page.getByText("合成商品 P01", { exact: true }).waitFor();
    assert.equal(await page.locator(".np-table tbody tr").count(), 20);
  });
  await page.evaluate(() => window.scrollTo(0, 0)); await delay(80);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.screenshot({ path: resolve(evidence, "root-products-desktop.png"), fullPage: true });
  for (const width of [390, 320]) await check(`real shell viewport ${width} contains overflow`, async () => {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); await delay(80);
    const d = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(d.scroll <= d.client + 1, JSON.stringify(d));
    assert.equal(await page.locator("#primary-navigation").evaluate(element => getComputedStyle(element).display), "none");
    const menu = page.getByRole("button", { name: "打开主导航", exact: true });
    assert.equal(await menu.isVisible(), true);
    const glyph = await menu.locator("span").evaluate(element => ({ display: getComputedStyle(element).display, text: element.textContent, width: element.getBoundingClientRect().width, fontSize: parseFloat(getComputedStyle(element).fontSize) }));
    assert.notEqual(glyph.display, "none"); assert.equal(glyph.text, "☰"); assert.ok(glyph.width > 0 && glyph.fontSize >= 16, JSON.stringify(glyph));
    await menu.click(); await page.locator('#primary-navigation[role="dialog"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "关闭主导航", exact: true }).click();
    await page.locator("#primary-navigation").waitFor({ state: "hidden" });
    await page.screenshot({ path: resolve(evidence, `root-products-${width}.png`), fullPage: true });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check("real 01 classic/balanced switches and all legacy column entries remain", async () => {
    await page.getByRole("tab", { name: "网店总览", exact: true }).click();
    await page.getByRole("button", { name: "旧视图", exact: true }).waitFor();
    await page.getByRole("button", { name: "新视图", exact: true }).click();
    await page.getByRole("button", { name: "旧视图", exact: true }).click();
    for (const name of ["店铺分析", "平台对比", "推广分析", "商品表现"]) { await page.getByRole("tab", { name, exact: true }).click(); await page.getByRole("tab", { name, exact: true, selected: true }).waitFor(); }
    await page.getByRole("heading", { name: "商品经营明细", exact: true }).waitFor();
  });
  await check("no unknown transport, external service, write API, interpretation or paid model dispatched", async () => {
    const telemetry = await page.evaluate(() => window.__integrated);
    await save("transport.json", telemetry);
    assert.deepEqual(telemetry.writeAttempts, []); assert.deepEqual(telemetry.paidAttempts, []); assert.deepEqual(telemetry.blocked, []); assert.deepEqual(blockedNetwork, []);
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  });
  await save("result.json", { ...source, checks, errors, consoleErrors, blockedNetwork, status: "passed", completedScope: "M3 real Home synthetic navigation probe", authorExecution: role === "I-harness-author", independentReviewConclusion: null, pending: ["M4 actual A registered list/detail/return controls and Owner-A complete transport", "Full legacy and 01 metric/source fixtures"], limitations: ["Only synthetic Owner-P transport plus actual Home/ShopView/ProductsColumn; no live source, backend, database, or paid model validation", "M3 unregistered A uses its actual classic whole-store entry; M4 exact-product and actual A return-control chain remains pending", "Classic/01 entries mounted on explicit synthetic source-pending errors; no full legacy/01 metric proof"] });
  process.stdout.write(`${JSON.stringify({ evidence, checks: checks.length, status: "passed", sourceHead: source.head })}\n`);
} catch (error) {
  if (page) { await save("transport-failed.json", await page.evaluate(() => window.__integrated).catch(() => null)); await save("dom-failed.txt", await page.locator("body").innerText().catch(() => "")); await page.screenshot({ path: resolve(evidence, "failed.png"), fullPage: true }).catch(() => {}); }
  await save("failure.json", { ...source, checks, errors, consoleErrors, blockedNetwork, error: error.message, status: "failed" });
  process.stderr.write(`Evidence: ${evidence}\n`); throw error;
} finally {
  if (browser) await browser.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await save("source-after.json", { head: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain"), sourceHeadChanged: source.head !== git("rev-parse", "HEAD") });
  await save("shutdown.json", { browserClosed: true, serverClosed: !server?.listening, noProductionProcessesTouched: true });
}
