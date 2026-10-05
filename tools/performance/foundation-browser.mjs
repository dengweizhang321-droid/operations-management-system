/** Actual Home + public shell, synthetic fail-closed GETs, dynamic loopback port. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, basename } from "node:path";

const root = process.cwd(), runtime = resolve(root, ".runtime/foundation-browser"), evidence = resolve(root, "docs/performance/foundation");
await mkdir(runtime, { recursive: true }); await mkdir(evidence, { recursive: true });
const entry = `
import React,{Suspense} from 'react';import {createRoot} from 'react-dom/client';
import Home from '@/app/page';import Boundary from '@/app/shell/module-error-boundary';
import Loading from '@/app/shell/module-loading-state';import {createReloadableLazy,resetReloadableLazyScope} from '@/app/shell/reloadable-lazy';
import '@/app/globals.css';import '@/app/shell/top-navigation.css';import '@/app/styles/shared-theme.css';
window.__foundation={calls:[]};window.fetch=async(input,init={})=>{
const url=new URL(input instanceof Request?input.url:String(input),location.href);const method=init.method||'GET';
window.__foundation.calls.push({path:url.pathname,method});
if(url.origin!==location.origin||method!=='GET')throw Error('Synthetic transport rejected');
if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
if(url.pathname==='/api/auth/me')return Response.json({user:{email:'synthetic@example.test',displayName:'Synthetic',role:'admin',scopeRestricted:false}});
return Response.json({error:'隔离夹具：来源未准备',code:'synthetic_source_pending'},{status:503});};
let attempts=0;const probe=createReloadableLazy('foundation-probe',async()=>{await new Promise(r=>setTimeout(r,120));if(++attempts===1)throw Error('Synthetic chunk failure');return {default:()=> <button type="button">后续操作</button>};});
const probeView=<><h1 id="global-page-title" tabIndex={-1}>合成公共工作区</h1><Boundary resetKey="probe" onRetry={()=>resetReloadableLazyScope('foundation-probe')} onOpenDashboard={()=>{}}><Suspense fallback={<Loading title="合成区域正在加载">独立区域</Loading>}><probe.Component/></Suspense></Boundary></>;
createRoot(document.body).render(location.pathname==='/probe.html'?probeView:<Home/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "foundation-entry.jsx", loader: "jsx" }, outdir: runtime, entryNames: "ui", chunkNames: "chunk-[hash]", bundle: true, splitting: true, format: "esm", platform: "browser", jsx: "automatic", conditions: ["style"], define: { "process.env.NODE_ENV": '"development"' }, tsconfig: resolve(root, "tsconfig.json"), metafile: true, logLevel: "warning" });
const outputs = Object.keys(bundle.metafile.outputs);
const entryOutput = outputs.find(path => bundle.metafile.outputs[path].entryPoint === "foundation-entry.jsx"); assert.ok(entryOutput);
const requested = [], errors = [], checks = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; form-action 'none'");
  if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
  const file = outputs.find(file => basename(file) === path.slice(1));
  if (file) {
    const data = await readFile(resolve(root, file)); requested.push({ file: basename(file), bytes: data.length });
    res.setHeader("Content-Type", file.endsWith("css") ? "text/css" : "text/javascript");
    if (file !== entryOutput && file.endsWith("js")) await new Promise(resolve => setTimeout(resolve, 100));
    res.end(data); return;
  }
  res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><script type="module" src="/${basename(entryOutput)}"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + "/?module=inventory");
  await page.waitForFunction(() => window.__foundation?.calls.some(call => call.path === "/api/inventory/overview"));
  const initialCalls = await page.evaluate(() => window.__foundation.calls);
  assert.ok(!initialCalls.some(call => /\/api\/(sales|products|market)\//.test(call.path))); checks.push("initial inventory does not fetch other three domain data");
  const initialResources = [...requested];
  for (const [label, expected] of [["销售分析", "/api/sales/summary"], ["库存管理", "/api/inventory/overview"], ["商品经营", "/api/products/summary"], ["市场分析", "/api/market/overview"]]) {
    const link = page.getByRole("link", { name: label, exact: true }).first(); await link.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(path => window.__foundation.calls.some(call => call.path === path), expected);
    await page.getByRole("heading", { name: label, exact: true }).first().waitFor();
    assert.ok(await page.locator("#primary-navigation").isVisible()); checks.push(`${label}: actual existing read + error UI keeps shell/keyboard navigation`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /打开.*导航|展开.*导航|打开菜单/ }).first().click();
  const drawer = page.locator("#primary-navigation"); await drawer.waitFor({ state: "visible" });
  await page.keyboard.press("Escape"); await page.waitForFunction(() => document.querySelector("#primary-navigation")?.getAttribute("aria-hidden") === "true"); checks.push("mobile drawer Escape closes and releases navigation");
  await page.screenshot({ path: resolve(evidence, "shell-mobile.png"), fullPage: true });
  const domainCalls = await page.evaluate(() => window.__foundation.calls);
  const probePage = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await probePage.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await probePage.goto(origin + "/probe.html");
  await probePage.getByRole("status").waitFor();
  const layout = await probePage.getByRole("status").evaluate(el => ({ height: el.getBoundingClientRect().height, minHeight: getComputedStyle(el).minHeight, spinnerHidden: el.querySelector(".state-spinner")?.getAttribute("aria-hidden") }));
  assert.equal(layout.minHeight, "160px"); assert.equal(layout.spinnerHidden, "true"); checks.push("real browser loading reserves 160px and exposes one status");
  await probePage.getByRole("alert").waitFor(); await probePage.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
  await probePage.getByRole("button", { name: "重试当前模块" }).focus(); await probePage.keyboard.press("Enter");
  await probePage.getByRole("button", { name: "后续操作" }).waitFor(); await probePage.waitForFunction(() => document.activeElement?.id === "global-page-title");
  checks.push("lazy rejection focuses boundary; keyboard retry resets import and restores page heading");
  await probePage.screenshot({ path: resolve(evidence, "loading-retry.png") });
  await writeFile(resolve(evidence, "browser.json"), JSON.stringify({ schema: "foundation-browser-v1", synthetic: true, checks, errors, layout, initialResources, allResources: requested, domainCalls,
    compiledBytes: Object.values(bundle.metafile.outputs).reduce((sum, value) => sum + value.bytes, 0),
    limitations: "Actual Home and shell compiled with esbuild development splitting, not production Worker. Four domain reads return deliberate 503 fixture errors; no domain success DTO equivalence or production render timing claim. Probe import delay is explicit synthetic only.",
  }, null, 2) + "\n");
  assert.equal(errors.length, 0, errors.join("\n")); console.log(`PASS ${checks.length} browser checks`);
} finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
