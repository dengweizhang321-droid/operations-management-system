/** Synthetic React component verification; own loopback server and blank browser.
 * No production backend, database, profile, secrets, imports, or model calls.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = process.cwd(), run = resolve(root, ".runtime/foundation-ui"), evidence = "E:/codex-artifacts/netshop-scheme2-20260930/foundation/ui";
const port = 3130;
await mkdir(run, { recursive: true }); await mkdir(evidence, { recursive: true });
const entry = `
import React,{useCallback,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ShopView from '../../app/shop-module-view';
import {InsightFilterBar,InsightMetric,InsightComparison,InsightReadState,InsightListPagination,InsightSourceCoverage} from '../../app/netshop/shared/components';
import {useScopedRead,InsightReadError} from '../../app/netshop/shared/request-state';
import {syntheticInsightsContext,syntheticMetrics} from '../../lib/netshop/insights-fixtures';
import {parseShellLocation,serializeShellLocation,updateShopContextLocation,drillShopLocation,returnShopLocation,defaultStoreOverviewLocation} from '../../app/shell/navigation-contract';
import {defaultShopLocationContext} from '../../app/shell/shop-context';
import '../../app/globals.css';
window.__calls=[]; window.__reads={};
const stats={netSalesCents:10000,grossSalesCents:10000,refundAmountCents:0,costAmountCents:6000,grossProfitCents:4000,orderCount:10,lineCount:10,netQuantity:10,refundRate:0,grossMarginRate:.4,averageOrderValueCents:1000};
const availability=Object.fromEntries(['pageViews','visitors','searchImpressions','searchClicks','addCartCustomers','addCartQuantity','orderCustomers','orderQuantity','orderAmountCents','transactionOrders','transactionAmountCents','transactionQuantity','transactionCustomers','favorites','refundAmountCents','searchVisitors','searchTransactionCustomers'].map(k=>[k,{complete:true,reasonCode:null}]));
const item={id:'cross-page',platform:'京东',skuId:'cross-page',spuId:'cross-page',shopNames:['合成店A'],productName:'合成商品',productCode:'fixture',imageUrl:'',productUrl:'',category:'合成类目',dateMin:'2026-09-01',dateMax:'2026-09-01',dataDays:1,pageViews:200,visitors:100,transactionAmount:100,transactionAmountCents:10000,transactionCustomers:20,transactionQuantity:1,searchImpressions:100,searchClicks:10,searchClickRate:.1,addCartCustomers:5,addCartQuantity:10,orderCustomers:20,orderQuantity:1,orderAmount:100,orderAmountCents:10000,transactionOrders:20,favorites:0,refundAmountCents:0,searchVisitors:10,searchTransactionCustomers:2,uvValue:1,conversionRate:.2,fieldAvailability:availability};
const productSummary={...item,productCount:1};
function overview(query){
 const platform=query.get('platform')||'天猫', names=['合成店A','合成店B'],keys=names.map(n=>platform+'\\x1f'+n),units={payment:'CNY_CENT',visitors:'COUNT',customers:'COUNT',spend:'CNY_CENT',promotionPayment:'CNY_CENT',spendRate:'RATIO',conversion:'RATIO',roas:'MULTIPLE',averageOrder:'CNY_CENT',uvValue:'CNY_CENT',paidVisitors:'COUNT',freeVisitors:'COUNT',b2bRate:'RATIO'};
 const source=platform==='京东'?'jd_sku_daily':'tmall_product_daily',promo=platform==='京东'?'jd_promotion':'tmall_promotion';
 const amounts={payment:10000,visitors:100,customers:10,spend:2000,promotionPayment:4000,spendRate:.2,conversion:.1,roas:2};
 const metrics=Object.fromEntries(Object.entries(units).map(([k,unit])=>[k,{value:amounts[k]??null,unit,status:k in amounts?'available':'unavailable',reasonCode:k in amounts?null:'unverified_source',basis:['spend','promotionPayment','roas'].includes(k)?'platform_attributed':k in amounts?'product_day_sum':'unverified',sourceIds:k in amounts?[['spend','promotionPayment','roas'].includes(k)?promo:source]:[],aggregation:['conversion','spendRate','roas'].includes(k)?'ratio_of_sums':k in amounts?'sum':'source_value_only'}]));
 const selectedNames=query.get('view')==='shop'?[query.get('shopKey').split('\\x1f')[1]]:names,selectedKeys=selectedNames.map(n=>platform+'\\x1f'+n);
 const shopMetrics=Object.fromEntries(Object.entries(metrics).map(([k,m])=>[k,{...m,value:m.value!==null&&['CNY_CENT','COUNT'].includes(m.unit)?m.value/2:m.value}]));
 const activeMetrics=query.get('view')==='shop'?shopMetrics:metrics;
 const comparisons=Object.fromEntries(Object.keys(units).map(k=>[k,Object.fromEntries(['previous','yearAgo'].map(kind=>[kind,{value:null,method:units[k]==='RATIO'?'percentage_points':'relative_change',status:'unavailable',reasonCode:'incomplete_baseline'}]))]));
 const current={startDate:'2026-09-01',endDate:'2026-09-01',endExclusive:'2026-09-02',days:1}, previous={startDate:'2026-08-31',endDate:'2026-08-31',endExclusive:'2026-09-01',days:1},yearAgo={startDate:'2025-09-01',endDate:'2025-09-01',endExclusive:'2025-09-02',days:1};
 const row={...current,metrics:activeMetrics,comparisons,comparisonDates:{previous:null,yearAgo:null},comparisonValues:{previous:{payment:null,spend:null},yearAgo:{payment:null,spend:null}}};
 return {schemaVersion:'netshop-store-overview-v1',requestId:'synthetic-ui',scopeKey:'c'.repeat(64),overviewToken:'a'.repeat(64),sourceRevisions:{netshop:'1:aaaaaaaaaaaa',promotionManifest:'1:True'},filters:{platform,shopKeys:selectedKeys,periodKind:'custom',trendGrain:'day',detailGrain:'day'},periods:{timezone:'Asia/Shanghai',rule:'前一日',ruleVersion:'sales-period-v1',current,previous,yearAgo},freshness:[{sourceId:source,dataThrough:current.endDate},{sourceId:promo,dataThrough:current.endDate}],coverageBySource:Object.fromEntries([source,promo].map(s=>[s,{expectedShopDatePairs:selectedKeys.length,coveredShopDatePairs:selectedKeys.length,complete:true,missingByShop:[],truncated:false}])),summary:activeMetrics,comparisons,daily:[row],trend:[row],details:[row],detailPagination:{page:1,pageSize:5,total:1,hasMore:false},shopOptions:names.map((shopName,i)=>({shopName,shopKey:keys[i]})),shops:selectedNames.map((shopName,i)=>({shopName,shopKey:selectedKeys[i],metrics:shopMetrics,comparisons})),shopPagination:{page:1,pageSize:10,total:selectedKeys.length,hasMore:false},movingAverage:[{date:current.startDate,paymentCents:null}],annotations:[]};
}
window.fetch=async (input,options)=>{
 const url=new URL(String(input),location.origin),q=url.searchParams; window.__calls.push(url.pathname+'?'+q);
 let body;
 if(url.pathname==='/api/sales/summary') body={...stats,current:stats,previous:stats,yearAgo:stats,startDate:'2026-09-01',endDate:'2026-09-01',previousStartDate:'2026-08-31',previousEndDate:'2026-08-31',dataCutoffDate:'2026-09-01',daily:[{date:'2026-09-01',...stats}],previousDaily:[{date:'2026-08-31',...stats}],yearAgoDaily:[],trendTruncated:false,outlets:[{...stats,name:'合成店A',platform:'京东',groupKey:'京东\\x1f合成店A',shareRate:1}],platforms:[{...stats,name:'京东',platform:'京东',groupKey:'京东',shareRate:1}],filterOptions:{shops:[{key:'京东\\x1f合成店A',name:'合成店A',platform:'京东'}]},groupPagination:{outlets:{truncated:false},platforms:{truncated:false}}};
 else if(url.pathname==='/api/netshop/store-overview') body=overview(q);
 else if(url.pathname==='/api/netshop/products') body={snapshotToken:'d'.repeat(64),monetaryUnit:'cents',items:[],summary:{productCount:0,skuCount:0,spuCount:0},platforms:['京东','天猫'],shops:[],pagination:{page:1,pageSize:50,total:0,returned:0,truncated:false},latestBatch:null};
 else if(url.pathname==='/api/netshop/product-performance'){
   const baseline=q.get('startDate')!==(window.__currentStart||'2026-09-01'),exact=q.get('view')==='identities';
   if(baseline&&window.__baselineFailure) return Response.json({error:'合成基期读取失败 '+window.__baselineFailure},{status:window.__baselineFailure});
   const product={...item,productName:baseline?'合成基期商品':'合成本期 '+q.get('startDate'),...(baseline?{id:exact?'cross-page':'independent-ranked-other',transactionAmount:50,transactionAmountCents:5000,transactionCustomers:10,conversionRate:.1}: {})};
   body={snapshotToken:(baseline?'e':'f').repeat(64),sourceRevision:'1:aaaaaaaaaaaa',dimension:q.get('dimension')||'spu',dataset:(q.get('dimension')||'spu')+'_daily',requestedPeriod:{startDate:q.get('startDate'),endDate:q.get('endDate')},dateMin:q.get('startDate'),dataCutoffDate:q.get('endDate'),monetaryUnit:'cents',visitorAggregation:'product_day_sum',summary:{...productSummary,...(baseline?{transactionAmount:50,transactionAmountCents:5000,transactionCustomers:10,conversionRate:.1}: {})},summaryFieldAvailability:availability,coverage:{actualDates:[q.get('startDate')],missingDates:[],availableDateMin:'2026-08-31',availableDateMax:'2026-09-01',total:1,returned:1,truncated:false},platforms:['京东'],shops:[{platform:'京东',shopName:'合成店A',productCount:1}],daily:[],dailyPagination:{total:0,returned:0,truncated:false},items:[product],pagination:{page:1,pageSize:50,total:1,returned:1,truncated:false},...(exact?{pairing:'exact_identity',unmatched:[]}: {})};
 } else if(url.pathname.startsWith('/api/netshop/promotion-performance')) body={snapshotToken:'a'.repeat(64),monetaryUnit:'cents',requestedPeriod:{startDate:'2026-09-01',endDate:'2026-09-01'},dataCutoffDate:'2026-09-01',items:[],pagination:{page:1,pageSize:20,total:0,returned:0,truncated:false},summary:{productCount:0,spendCents:0,netTransactionAmountCents:0,grossTransactionAmountCents:0,platformPaymentAmountCents:10000,impressions:0,clicks:0,netOrders:0,favorites:0,cartQuantity:0,clickThroughRate:null,averageClickCostCents:null,roas:null,spendRate:0,promotionTransactionShare:0},coverage:{promotionDates:['2026-09-01'],productDailyDates:['2026-09-01'],intersectionDates:['2026-09-01'],missingProductDailyDates:[],missingPromotionDates:[],complete:true,expectedShopDatePairs:1,matchedShopDatePairs:1,missingByShop:[]},daily:[],dailyPagination:{total:0,returned:0,truncated:false},filterOptions:{shops:[],pagination:{total:0,returned:0,truncated:false}}};
 else return Response.json({error:'Synthetic fixture route unavailable'},{status:404});
 if(options?.signal?.aborted) throw new DOMException('Aborted','AbortError');
 return Response.json(body,{headers:{'X-Netshop-Data-Revision':'1:aaaaaaaaaaaa'}});
};
function Shared(){
 const [scope,setScope]=useState('A'),[loc,setLoc]=useState(()=>parseShellLocation(location.href));
 const load=useCallback(async signal=>{window.__reads[scope]=(window.__reads[scope]||0)+1; await new Promise(r=>setTimeout(r,scope==='A'?200:20));if(scope==='C')throw Error('合成范围C读取失败');if(scope==='D'&&window.__reads.D===1)throw new InsightReadError('insights_revision_changed','合成版本变化');return {label:'当前'+scope};},[scope]);
 const result=useScopedRead(scope,load),context=syntheticInsightsContext(), page=loc.shop?.page||1;
 const navigate=url=>{history.pushState(null,'',url);setLoc(parseShellLocation(url));};
 useEffect(()=>{const listener=()=>setLoc(parseShellLocation(location.href));addEventListener('popstate',listener);return()=>removeEventListener('popstate',listener)},[]);
 return <><h1>公共底座合成UI</h1><InsightFilterBar sticky={false}><label>店铺范围<select aria-label="合成范围" value={scope} onChange={e=>setScope(e.target.value)}>{['A','B','C','D'].map(s=><option key={s}>{s}</option>)}</select></label><label>商品搜索<input aria-label="合成搜索" value={loc.shop?.q||''} onChange={e=>navigate(updateShopContextLocation(location.href,{q:e.target.value}))}/></label></InsightFilterBar><div className="test-metrics">{Object.entries(syntheticMetrics).map(([key,metric])=><InsightMetric key={key} label={key} metric={metric}/>)}</div><InsightComparison value={{value:10,method:'percentage_points',status:'available',reasonCode:null}}/><div id="read-result">{result.data?.label||''}</div><InsightReadState status={result.status} error={result.error} onRetry={result.refresh}/><InsightSourceCoverage label="推广日" coverage={context.coverageBySource['jd_promotion:ad:京东:current']}/><div id="location">{loc.shop?.product?'详情 '+loc.shop.product.id:'列表 第'+page+'页'}</div><InsightListPagination pagination={{page,pageSize:20,total:52,returned:page===3?12:20,hasMore:page<3,truncated:false}} onPage={n=>navigate(updateShopContextLocation(location.href,{page:n}))}/><button id="drill" onClick={()=>navigate(drillShopLocation(location.href,'products',{platform:'京东',shopName:'合成店A',dimension:'spu',id:'47'},'daily'))}>进入商品47</button><button id="return" onClick={()=>navigate(returnShopLocation(location.href))}>返回列表</button></>;
}
function Legacy(){
 const [view,setView]=useState('outlets'),[options,setOptions]=useState(defaultStoreOverviewLocation),[period,setPeriod]=useState({start:'2026-09-01',end:'2026-09-01',kind:'custom'});
 window.__currentStart=period.start;
 return <><h1>旧五视图与01合成UI</h1><button id="probe-custom" onClick={()=>{window.__baselineFailure=0;setPeriod({start:'2026-09-03',end:'2026-09-04',kind:'custom'})}}>自定义9/3—4</button><button id="probe-rolling" onClick={()=>{window.__baselineFailure=0;setPeriod({start:'2026-09-03',end:'2026-09-04',kind:'rolling'})}}>滚动9/3—4</button><button id="probe-503" onClick={()=>{window.__baselineFailure=503;setPeriod({start:'2026-09-05',end:'2026-09-06',kind:'custom'})}}>新范围基期503</button><button id="probe-403" onClick={()=>{window.__baselineFailure=403;setPeriod({...period})}}>同范围基期403</button><button id="probe-401" onClick={()=>{window.__baselineFailure=401;setPeriod({start:'2026-09-07',end:'2026-09-08',kind:'custom'})}}>新范围基期401</button><ShopView range="自定义" customStartDate={period.start} customEndDate={period.end} moduleView={view} onModuleViewChange={setView} overview={options} onOverviewChange={setOptions} periodKind={period.kind} currentUser={{email:'synthetic@example.test',displayName:'合成用户',role:'admin',scope:null}} onNavigate={()=>{}} /></>;
}
createRoot(document.getElementById('root')).render(location.pathname==='/legacy'?<Legacy/>:<Shared/>);
`;
await writeFile(resolve(run, "entry.tsx"), entry);
await build({ entryPoints: [resolve(run, "entry.tsx")], bundle: true, outfile: resolve(run, "ui.js"), format: "esm", platform: "browser", conditions: ["style"], jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning" });
const server = createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'");
  if (path === "/ui.js" || path === "/ui.css") { res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css"); res.end(await readFile(resolve(run, path.slice(1)))); return; }
  if (path === "/" || path === "/legacy") { res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{margin:0;padding:16px;font-size:var(--font-size-body);background:var(--color-bg-page)}h1{font-size:20px}.test-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px;margin:16px 0}#root{max-width:1440px;margin:auto}select,input{font:inherit;max-width:160px}</style><div id="root"></div><script type="module" src="/ui.js"></script></html>'); return; }
  if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
  res.writeHead(404).end();
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
function check(name, condition) { checks.push({ name, passed: !!condition }); if (!condition) throw new Error(name); }
try {
  await page.goto(`http://127.0.0.1:${port}/?module=shop&view=products&period=custom&from=2026-09-01&to=2026-09-01`);
  await page.getByLabel("合成范围").selectOption("B"); await page.waitForTimeout(260);
  check("late A cannot overwrite B", await page.locator("#read-result").innerText() === "当前B");
  await page.getByLabel("合成范围").selectOption("C"); await page.getByRole("alert").waitFor();
  check("error C hides B", await page.locator("#read-result").innerText() === "");
  await page.getByLabel("合成范围").selectOption("D"); await page.getByText("来源版本已变化，请重新读取", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重新读取", exact: true }).click(); await page.getByText("当前D", { exact: true }).waitFor(); check("version retry recovers D", true);
  check("true zero distinct from missing", (await page.locator('[data-status="available"]').innerText()).includes("0 元") && (await page.locator('[data-status="unavailable"]').first().innerText()).includes("—"));
  check("filter region can disable sticky", await page.locator(".insights-filter-bar").evaluate(e => getComputedStyle(e).position) !== "sticky");
  check("shared pagination uses system 13px label role", await page.locator(".insights-pagination").evaluate(e => getComputedStyle(e).fontSize) === "13px");
  await page.getByRole("button", { name: "下一页", exact: true }).click(); await page.getByRole("button", { name: "下一页", exact: true }).click();
  check("page three next disabled", await page.getByRole("button", { name: "下一页", exact: true }).isDisabled());
  await page.locator("#drill").click(); check("exact product drill", (await page.locator("#location").innerText()) === "详情 47");
  await page.locator("#return").click(); check("return preserves page", (await page.locator("#location").innerText()) === "列表 第3页");
  await page.getByLabel("合成搜索").fill("47"); check("search resets page", (await page.locator("#location").innerText()) === "列表 第1页");
  await page.screenshot({ path: resolve(evidence, "shared-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  check("shared narrow width no page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(evidence, "shared-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`http://127.0.0.1:${port}/legacy`);
  const legacyBeforeBalanced = await page.evaluate(() => window.__calls.filter(c => c.startsWith('/api/sales/summary')).length);
  await page.getByRole("button", { name: "新视图", exact: true }).click(); await page.getByText("天猫经营概览", { exact: true }).waitFor();
  check("balanced active does not start new legacy sales reads", await page.evaluate(() => window.__calls.filter(c => c.startsWith('/api/sales/summary')).length) === legacyBeforeBalanced);
  check("balanced five main metric cards", await page.locator(".ov-metrics > .ov-metric").count() === 5);
  await page.waitForTimeout(100);
  check("balanced shop detail respects single-store scope", await page.getByText("店铺详情范围不一致", { exact: true }).count() === 0 && await page.locator(".ov-shop-body").count() === 1);
  await page.screenshot({ path: resolve(evidence, "balanced-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "旧视图", exact: true }).click(); await page.getByRole("tab", { name: "网店总览", exact: true }).waitFor();
  check("classic and balanced remain real switches", await page.getByRole("button", { name: "旧视图", exact: true }).getAttribute("aria-pressed") === "true");
  for (const label of ["店铺分析", "平台对比", "商品数据", "推广分析"]) {
    const salesBefore = await page.evaluate(() => window.__calls.filter(c => c.startsWith('/api/sales/summary')).length);
    await page.getByRole("tab", { name: label, exact: true }).click(); await page.waitForTimeout(180);
    check("legacy view mounts "+label, await page.getByRole("tab", { name: label, exact: true }).getAttribute("aria-selected") === "true");
    if (label === "商品数据" || label === "推广分析") check("inactive sales not read by "+label, await page.evaluate(() => window.__calls.filter(c => c.startsWith('/api/sales/summary')).length) === salesBefore);
  }
  await page.getByRole("tab", { name: "商品数据", exact: true }).click(); await page.waitForTimeout(100);
  const skuTab = page.getByRole("tab", { name: /SKU/ });
  if (await skuTab.count()) await skuTab.first().click(); else await page.getByRole("button", { name: /SKU/ }).first().click();
  await page.getByLabel("显示对比数据", { exact: true }).check();
  await page.waitForTimeout(350);
  check("product exact pairing request used", await page.evaluate(() => window.__calls.some(c => c.includes('view=identities'))));
  check("cross-rank current row has paired comparison", (await page.locator("body").innerText()).includes("100.0%"));
  check("conversion comparison uses percentage points", (await page.locator("body").innerText()).includes("个百分点"));
  await page.screenshot({ path: resolve(evidence, "products-pairing.png"), fullPage: true });
  await page.locator("#probe-custom").click(); await page.waitForTimeout(250);
  check("custom same-month reads previous corresponding dates", await page.evaluate(() => window.__calls.some(c => c.startsWith('/api/netshop/product-performance') && c.includes('startDate=2026-08-03') && c.includes('endDate=2026-08-04'))));
  await page.locator("#probe-rolling").click(); await page.waitForTimeout(250);
  check("rolling intent keeps previous equal-length dates", await page.evaluate(() => window.__calls.some(c => c.startsWith('/api/netshop/product-performance') && c.includes('startDate=2026-09-01') && c.includes('endDate=2026-09-02'))));
  await page.locator("#probe-503").click(); await page.waitForTimeout(250);
  check("current 200 baseline 503 retains trustworthy new scope", (await page.locator("body").innerText()).includes("合成本期 2026-09-05") && (await page.locator("body").innerText()).includes("比较读取失败"));
  check("baseline failure does not retain previous scope", !(await page.locator("body").innerText()).includes("合成本期 2026-09-03"));
  await page.screenshot({ path: resolve(evidence, "products-baseline-503.png"), fullPage: true });
  await page.locator("#probe-403").click(); await page.waitForTimeout(150); await page.getByRole("button", { name: "↻ 刷新", exact: true }).click(); await page.waitForTimeout(250);
  check("same-scope permission 403 clears current and comparison", !(await page.locator("body").innerText()).includes("合成本期 2026-09-05") && (await page.locator("body").innerText()).includes("合成基期读取失败 403"));
  await page.locator("#probe-401").click(); await page.waitForTimeout(250);
  check("new-scope permission 401 fails closed", !(await page.locator("body").innerText()).includes("合成本期 2026-09-07") && (await page.locator("body").innerText()).includes("合成基期读取失败 401"));
  check("no React runtime errors", errors.length === 0);
} finally {
  await writeFile(resolve(evidence, "result.json"), JSON.stringify({ fixture: "synthetic-react-v1", port, checks, errors, limitations: ["Component harness with synthetic API fixtures, not production data or a running Django/Worker combination", "Private blank headless Chrome; no shared profile or external connection"], requests: await page.evaluate(() => window.__calls ?? []).catch(() => []) }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ checks: checks.length, errors, evidence, server: "stopped", browser: "closed" }));
