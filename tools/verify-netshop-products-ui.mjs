/** P UI author verification using a unique loopback server and clean, temporary
 * browser. Synthetic API responses only; no production profile or services. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = process.cwd();
const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID()}`;
const evidenceParent = "E:/codex-artifacts/netshop-scheme2-20261001/products/ui";
await mkdir(evidenceParent, { recursive: true });
const evidence = resolve(evidenceParent, runId), runtime = resolve(root, ".runtime", `products-ui-${runId}`);
await mkdir(evidence); await mkdir(runtime, { recursive: true });
const writeEvidence = (name, value) => writeFile(resolve(evidence, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), { flag: "wx" });
const entry = `
import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProductsMetric,ProductsPanel,ProductPicture,MetricCell,CompareCell} from '../../app/netshop/products/ProductsPrimitives';
import {ProductsTrend} from '../../app/netshop/products/ProductsCharts';
import {useScopedRead} from '../../app/netshop/shared/request-state';
import {InsightReadState} from '../../app/netshop/shared/components';
import '../../app/globals.css';
import '../../app/netshop/products/products.css';
const metric=(value,reason=null)=>({value,unit:'CNY_CENT',status:reason?'unavailable':'available',reasonCode:reason,basis:'product_day_sum',sourceIds:['synthetic-platform'],aggregation:'sum',coverageRef:'synthetic:current'});
const comparison=reason=>({value:null,method:'relative_change',status:'unavailable',reasonCode:reason});
function App(){
 const [scope,setScope]=useState('A');
 const load=useCallback(async signal=>{await new Promise(r=>setTimeout(r,scope==='A'?160:10));if(scope==='D')throw Error('合成读取失败');return {scope};},[scope]);
 const read=useScopedRead(scope,load);
 return <main className="netshop-products"><h1>均衡经营台 · 合成UI验证</h1><p>本页仅为P作者合成UI，不接生产API。</p><label>合成范围<select aria-label="合成范围" value={scope} onChange={e=>setScope(e.target.value)}>{['A','B','C','D'].map(s=><option key={s}>{s}</option>)}</select></label><p id="read-scope">{read.data?.scope}</p><InsightReadState status={read.status} error={read.error} onRetry={read.refresh}/><div className="np-metrics"><ProductsMetric label="真实零销售額" metric={metric(0)}/><ProductsMetric label="缺字段" metric={metric(null,'missing_field')}/><ProductsMetric label="缺日" metric={metric(null,'missing_day')}/><ProductsMetric label="未关联" metric={metric(null,'unmapped')}/></div><ProductsPanel title="商品经营明细" note="金额为整数分除以100"><div className="np-table-wrap"><table className="np-table"><thead><tr><th>商品图/名称</th><th>平台销售额（元）</th><th>销量（件）</th><th>访客累计</th><th>转化率</th><th>加购率</th><th>同比（销售额）</th><th>环比（销售额）</th></tr></thead><tbody><tr><td><ProductPicture title="合成商品" url={null}/></td><td><MetricCell metric={metric(12345)}/></td><td>1</td><td>100</td><td>2%</td><td>5%</td><td><CompareCell comparison={comparison('negative_baseline')}/></td><td><CompareCell comparison={comparison('zero_denominator')}/></td></tr></tbody></table></div><CompareCell comparison={{value:1.5,method:'percentage_points',status:'available',reasonCode:null}}/></ProductsPanel><ProductsPanel title="按已读取日期显示趋势"><ProductsTrend label="平台销售额" points={[{date:'2026-09-01',metric:metric(100)},{date:'2026-09-02',metric:metric(null,'missing_day')},{date:'2026-09-03',metric:metric(200)}]}/></ProductsPanel></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
await writeFile(resolve(runtime, "entry.tsx"), entry, { flag: "wx" });
await build({ entryPoints: [resolve(runtime, "entry.tsx")], bundle: true, outfile: resolve(runtime, "ui.js"), format: "esm", platform: "browser", conditions: ["style"], jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning" });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'");
  if (path === "/ui.js" || path === "/ui.css") { response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css"); response.end(await readFile(resolve(runtime, path.slice(1)))); return; }
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  if (path !== "/") { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{margin:0;padding:12px}#root{max-width:1440px;margin:auto}</style><div id="root"></div><script type="module" src="/ui.js"></script></html>');
});
let browser;
const checks = [], errors = [];
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await writeEvidence("resource.json", { role: "P-ui", runId, port, pid: process.pid, root, evidence, synthetic: true, status: "running" });
  browser = await chromium.launch({ executablePath: process.env.NETSHOP_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const check = async (name, callback) => { await callback(); checks.push(name); };
  await check("zero and missing states remain distinct", async () => { await page.getByText("0 元", { exact: true }).waitFor(); await page.getByText("来源缺少字段", { exact: true }).first().waitFor(); await page.getByText("未关联", { exact: true }).first().waitFor(); });
  await check("money is cents to yuan and seven default table fields exist", async () => { await page.getByText("123.45 元", { exact: true }).waitFor(); for (const label of ["平台销售额（元）", "销量（件）", "访客累计", "转化率", "加购率", "同比（销售额）", "环比（销售额）"]) await page.getByRole("columnheader", { name: label, exact: true }).waitFor(); });
  await check("zero/negative baselines and percentage points display", async () => { await page.getByText("基期为负", { exact: true }).waitFor(); await page.getByText("分母为零", { exact: true }).waitFor(); await page.getByText("+1.50 个百分点", { exact: true }).waitFor(); });
  await check("missing images have no invented photo", async () => { await page.getByText("缺少主图", { exact: true }).waitFor(); assert.equal(await page.locator(".np-thumb img").count(), 0); });
  await check("missing chart day breaks curve", async () => { assert.equal(await page.locator(".np-chart polyline").count(), 2); await page.getByText("2/3 个有值日期", { exact: false }).waitFor(); });
  await check("quick scope switches reject late ignored-abort response", async () => { await page.getByLabel("合成范围").selectOption("A"); await page.getByLabel("合成范围").selectOption("B"); await page.locator("#read-scope").filter({ hasText: /^B$/ }).waitFor(); await page.getByLabel("合成范围").selectOption("C"); await page.locator("#read-scope").filter({ hasText: /^C$/ }).waitFor(); await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(await page.locator("#read-scope").textContent(), "C"); });
  await check("ordinary read error is not business empty", async () => { await page.getByLabel("合成范围").selectOption("D"); await page.getByRole("alert").filter({ hasText: "当前范围读取失败" }).waitFor(); assert.equal(await page.locator("#read-scope").textContent(), ""); });
  await page.screenshot({ path: resolve(evidence, "desktop.png"), fullPage: true });
  for (const width of [390, 320]) await check(`viewport ${width} keeps overflow within table`, async () => { await page.setViewportSize({ width, height: 900 }); const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions)); await page.screenshot({ path: resolve(evidence, `narrow-${width}.png`), fullPage: true }); });
  assert.deepEqual(errors, []);
  await writeEvidence("result.json", { role: "P-ui", synthetic: true, runId, checks, errors, status: "passed", authorIndependent: false, limitations: ["Pure presentation harness; full ProductsColumn/API not mounted yet", "No live source or PostgreSQL validation"] });
  process.stdout.write(`${JSON.stringify({ evidence, runId, checks: checks.length, errors, status: "passed" })}\n`);
} catch (error) {
  await writeEvidence("failure.json", { role: "P-ui", runId, checks, errors, status: "failed", error: error.message });
  throw error;
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await writeEvidence("shutdown.json", { role: "P-ui", runId, browserClosed: true, serverClosed: !server.listening });
}
