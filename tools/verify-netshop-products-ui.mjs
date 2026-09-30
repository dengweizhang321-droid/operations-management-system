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
const evidenceParent = process.env.NETSHOP_PRODUCTS_UI_EVIDENCE_ROOT ?? "E:/codex-artifacts/netshop-scheme2-20261001/products/ui";
const role = process.env.NETSHOP_PRODUCTS_UI_ROLE ?? "P-ui-author";
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
import ProductsColumn from '../../app/netshop/products/ProductsColumn';
import {productMetricKeys,extraMetricKeys} from '../../app/netshop/products/contract';
import {compareMetrics} from '../../lib/netshop/insights-contract';
import {resolveNetshopPeriods} from '../../lib/netshop/periods';
import {parseShellLocation,serializeShellLocation,updateShopContextLocation,drillShopLocation,returnShopLocation} from '../../app/shell/navigation-contract';
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
window.__calls=[];window.__mode='ready';window.__revision=1;window.__revisionErrors=0;window.__baseline503=false;window.__navigation=null;
const addDay=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const days=w=>Array.from({length:w.days},(_,i)=>addDay(w.startDate,i));
function apiContext(query){
 const platforms=query.getAll('platform').length?query.getAll('platform').sort():['京东','天猫'];
 const shops=query.getAll('outlet').length?query.getAll('outlet').sort():platforms.map(p=>p+'\\u001f合成店A');
 const dimension=query.get('dimension')||'spu',periodKind=query.get('periodKind')||'custom';
 const periods=resolveNetshopPeriods(query.get('startDate'),query.get('endDate'),periodKind);
 const scope={platforms,shopKeys:shops,dimension,periodKind};
 const sourceRevisions=[{domain:'netshop',kind:'owning_revision',scopeKey:'a'.repeat(64),revision:window.__revision+':aaaaaaaaaaaa'}];
 const coverageBySource={},capabilities=[],freshness=[];
 for(const p of platforms){
  sourceRevisions.push({domain:'netshop',kind:p+':promotionManifest',scopeKey:'a'.repeat(64),revision:'absent'});
  for(const shop of shops.filter(s=>s.startsWith(p+'\\u001f')))for(const kind of ['product','promotion'])sourceRevisions.push({domain:'netshop',kind:p+':'+kind+':'+shop,scopeKey:'a'.repeat(64),revision:kind==='product'?String(window.__revision):'absent'});
  const sources=p==='京东'?['jd_sku_daily:'+dimension+'_daily:京东','jd_promotion:ad:京东']:['tmall_product_daily:spu_daily:天猫','tmall_promotion:promotion_daily:天猫'];
  for(const sourceId of sources){
   const promotion=sourceId.includes('promotion');freshness.push({sourceId,dataThrough:promotion?null:periods.current.endDate});
   for(const kind of ['current','previous','yearAgo']){
    const sourceShops=shops.filter(s=>s.startsWith(p+'\\u001f')),expected=sourceShops.length*periods[kind].days,coverageRef=sourceId+':'+kind;
    coverageBySource[coverageRef]={expectedShopDatePairs:expected,coveredShopDatePairs:promotion?0:expected,complete:!promotion&&expected>0,missingByShop:promotion?sourceShops.map(shopKey=>({shopKey,dates:days(periods[kind])})):[],truncated:false};
    for(const field of promotion?['spend','attributedPayment']:['payment','visitors','customers','quantity','addCartCustomers'])capabilities.push({sourceId,period:kind,field,coverageRef,presentShopDatePairs:promotion?0:expected,status:promotion?'unavailable':'available',reasonCode:promotion?'no_records':null});
   }
  }
 }
 return {schemaVersion:'netshop-insights-v1',requestId:'synthetic-product-ui',scopeKey:'a'.repeat(64),snapshotToken:String(window.__revision%10).repeat(64),requestedScope:{...scope,shopKeys:query.getAll('outlet').sort()},effectiveScope:scope,periods,calendar:days(periods.current).map((date,i)=>({date,previous:i<periods.previous.days?addDay(periods.previous.startDate,i):null,yearAgo:i<periods.yearAgo.days?addDay(periods.yearAgo.startDate,i):null})),sourceRevisions,coverageBySource,capabilities,freshness,limitations:['合成UI API，不是实际来源验收','客户和访客为商品×日累计']};
}
function wireMetric(value,unit='COUNT',basis='product_day_sum',reason=null,source='jd_sku_daily:spu_daily:京东'){
 return {value,unit,status:reason?'unavailable':'available',reasonCode:reason,basis,sourceIds:[source],aggregation:unit==='RATIO'?'ratio_of_sums':'sum',coverageRef:source+':current',...(unit==='RATIO'&&!reason?{numerator:value*100,denominator:100}:{})};
}
function coreMetrics(payment=4800000){return Object.fromEntries(productMetricKeys.map(key=>[key,key==='payment'?wireMetric(payment,'CNY_CENT'):key==='refundPayment'?wireMetric(0,'CNY_CENT'):key==='conversion'?wireMetric(.02,'RATIO'):key==='addCartRate'?wireMetric(.05,'RATIO'):wireMetric(key==='visitors'?100:key==='customers'?2:1)]));}
function pairs(metrics){return Object.fromEntries(productMetricKeys.map(key=>[key,{previous:window.__baseline503?{value:null,method:metrics[key].unit==='RATIO'?'percentage_points':'relative_change',status:'unavailable',reasonCode:'incomplete_baseline'}:compareMetrics(metrics[key],coreMetrics(4000000)[key]),yearAgo:compareMetrics(metrics[key],coreMetrics(4500000)[key])}]));}
function table(query,detail=false){return {q:query.get('q')||'',category:query.get('category')||'',sort:query.get('sort')||'payment_desc',page:Number(query.get('page')||1),pageSize:Number(query.get('pageSize')||20),...(detail?{section:query.get('section')||'overview',source:query.get('source')||'platform'}:{})};}
function pagination(query,total,returned){const page=Number(query.get('page')||1),pageSize=Number(query.get('pageSize')||20);return {page,pageSize,total,returned,hasMore:(page-1)*pageSize+returned<total,truncated:false};}
function metadata(){return {summaryScope:'global_category_filtered',tableSearchScope:'identity_title_code_only',categoryBasis:'source_label_only',priceBasis:'transaction_mean',limitations:['合成来源；推广与ERP映射未具备','类目仅来源标签，不是跨平台字典']};}
function extras(){return Object.fromEntries(extraMetricKeys.map(key=>[key,key==='searchClickRate'?wireMetric(.1,'RATIO'):key==='orderPayment'||key==='visitorValue'?wireMetric(50000,'CNY_CENT'):wireMetric(10)]));}
function unmapped(){return {status:'unmapped',method:'unverified',sourceId:null,version:null,code:null,effectiveFrom:null,effectiveTo:null,reasonCode:'unmapped'};}
function linked(keys,basis){return Object.fromEntries(keys.map(key=>[key,wireMetric(null,key==='largeMarginRate'?'RATIO':key==='roas'?'MULTIPLE':key==='clicks'||key==='returnQuantity'?'COUNT':'CNY_CENT',basis,'unmapped')]));}
function row(context,id){const [platform,shopName]=context.effectiveScope.shopKeys[0].split('\\u001f'),metrics=coreMetrics(id==='P01'?4800000:1000000);return {identity:{platform,shopName,dimension:context.effectiveScope.dimension,id},title:'合成商品 '+id,category:'合成类目',imageUrl:null,metrics,comparisons:pairs(metrics),baselineMetrics:{previous:coreMetrics(4000000),yearAgo:coreMetrics(4500000)}};}
function envelope(query,detail=false){const context=apiContext(query);return {schemaVersion:'netshop-product-insights-v1',context,sectionToken:String(window.__revision%10).repeat(64),tableScope:table(query,detail),joinedSourceRevisions:context.sourceRevisions,consistency:'revision_vector_checked'};}
function baselines(){return {previous:window.__baseline503?{state:'error',data:null,code:'service_unavailable',message:'合成基期503'}:{state:'ready',data:coreMetrics(4000000)},yearAgo:{state:'ready',data:coreMetrics(4500000)}};}
function insights(query){
 const env=envelope(query),all=Array.from({length:42},(_,i)=>row(env.context,'P'+String(i+1).padStart(2,'0')));
 const search=query.get('q')||'',filtered=all.filter(item=>!search||item.title.includes(search)||item.identity.id.includes(search));
 const page=Number(query.get('page')||1),pageSize=Number(query.get('pageSize')||20),items=filtered.slice((page-1)*pageSize,page*pageSize),p=pagination(query,filtered.length,items.length),metrics=coreMetrics(42000000);
 const count=n=>wireMetric(n),share=n=>wireMetric(n,'RATIO');
 return {...env,sections:{summary:metrics,comparisons:pairs(metrics),items,pagination:p,baselineReads:baselines(),counts:{dataProducts:count(42),tradedProducts:count(42)},growth:{state:'ready',data:{collection:'paired_full_set_before_pagination',items,pagination:p}},structure:{collection:'complete_global_filter_set',denominator:metrics.payment,top5Payment:wireMetric(5000000,'CNY_CENT'),top10Payment:wireMetric(10000000,'CNY_CENT'),top5Share:share(.12),top10Share:share(.24),categories:[{label:'合成类目',payment:metrics.payment,share:share(1),products:count(42)}],priceBands:[{label:'成交均价1000元以上',payment:metrics.payment,share:share(1),products:count(42)}],categoryBasis:'source_label_only',priceBasis:'transaction_mean',classification:{continuous:count(42),newlyTraded:count(0),noLongerTraded:count(0),unknownBaseline:count(0)},qualification:{current:42,paired:42,missingPrevious:0,missingYearAgo:0,incomplete:0}},efficiency:{metrics:extras(),rules:{id:'synthetic-minimum-visitors',minimumVisitors:100,maximumConversion:.03,requireComplete:true},watchlist:items,pagination:p,scanned:42,qualified:42},dataQuality:{counts:{missingImage:count(42),missingCode:count(0),missingCategory:count(0),conflict:count(0),stale:count(0),unmapped:count(42)},staleAfterDays:30,basis:'current_snapshot'},metadata:metadata()}};
}
function detail(query){
 const env=envelope(query,true),[platform,shopName,dimension,id]=JSON.parse(query.get('productIdentity')),performance=row(env.context,id),source=query.get('source')||'platform';
 const sourceMetrics=source==='platform'?{...coreMetrics(),...extras()}:source==='promotion'?linked(['spend','attributedPayment','roas','clicks'],'platform_attributed'):linked(['netSales','cost','largeMarginRate','orderMargin','returnAmount','returnQuantity'],'erp_net_sales');
 const all=days(env.context.periods.current).map(date=>({date,source,metrics:sourceMetrics})),page=Number(query.get('page')||1),size=Number(query.get('pageSize')||20),items=all.slice((page-1)*size,page*size);
 const daily={source,items,pagination:pagination(query,all.length,items.length),definitions:['合成API字段；平台、归因及ERP分开','缺源不填零'],startDate:env.context.periods.current.startDate,endDate:env.context.periods.current.endDate,sourceRevisions:env.context.sourceRevisions};
 return {...env,identity:{platform,shopName,dimension,id},sections:{performance,baselineReads:baselines(),catalog:{state:'ready',data:null},promotion:{state:'ready',data:{metrics:linked(['spend','attributedPayment','roas','clicks'],'platform_attributed'),mapping:unmapped(),attributionWindow:null}},erp:{state:'ready',data:{metrics:linked(['netSales','cost','largeMarginRate','orderMargin','returnAmount','returnQuantity'],'erp_net_sales'),mapping:unmapped()}},extras:extras(),daily:{state:'ready',data:daily},trends:{state:'ready',data:daily},skuContribution:{status:'unavailable',reasonCode:'unverified_source',basis:'historical_relation',relationVersion:null,items:[],pagination:{page:1,pageSize:20,total:0,returned:0,hasMore:false,truncated:false}},metadata:metadata()}};
}
function catalog(query){
 const platform=query.get('platform')||'京东',shopName=(query.get('outlet')||platform+'\\u001f合成店A').split('\\u001f')[1],search=query.get('q')||'',all=Array.from({length:42},(_,i)=>({platform,shopName,spuId:'SPU'+(i+1),skuId:'SKU'+(i+1),productCode:'CODE'+(i+1),productName:'目录合成商品 '+(i+1),imageUrl:i===0?'/api/netshop/product-images/'+'f'.repeat(64):'',saleAttribute:'合成规格',category:'合成类目',brand:'合成品牌',price:10,priceCents:1000,totalInventory:12,availableInventory:10,status:'上架',productUrl:'',createdAt:'2026-09-01',snapshotDate:'2026-09-01',costPriceCents:null,netSalesCents:null,grossMarginRate:null,refundRate:null,salesMatched:false}));
 const filtered=all.filter(item=>!search||item.productName.includes(search)||item.skuId.includes(search)||item.spuId.includes(search)),page=Number(query.get('page')||1),size=Number(query.get('pageSize')||20),items=filtered.slice((page-1)*size,page*size);
 return {snapshotToken:'c'.repeat(64),batch:{fileName:'synthetic-catalog.xlsx',snapshotDate:'2026-09-01',rowCount:42,completedAt:'2026-09-01'},summary:{totalSkus:42,onSaleSkus:42,totalInventory:504,availableInventory:420},shops:[{platform,shopName,snapshotDate:'2026-09-01',completedAt:'2026-09-01'}],sales:{periodStart:query.get('startDate'),periodEnd:query.get('endDate'),dataCutoffDate:query.get('endDate'),platform},items,pagination:{page,pageSize:size,total:filtered.length,returned:items.length,truncated:false}};
}
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.href);if(!url.pathname.startsWith('/api/netshop/'))return originalFetch(input,init);
 window.__calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),outlets:url.searchParams.getAll('outlet')});
 const query=url.searchParams;
 if(window.__mode==='forbidden')return new Response(JSON.stringify({code:'access_denied',error:'合成权限403'}),{status:403});
 if(window.__revisionErrors>0){window.__revisionErrors--;return new Response(JSON.stringify({code:'insights_revision_changed',error:'合成版本变化'}),{status:409});}
 const response=url.pathname.endsWith('/detail')?detail(query):url.pathname==='/api/netshop/products'?catalog(query):insights(query);
 await new Promise(resolve=>setTimeout(resolve,(query.get('outlet')||'').endsWith('合成店A')?80:5));
 return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json','X-Netshop-Data-Revision':window.__revision+':aaaaaaaaaaaa'}});
};
function Harness(){
 const [locationState,setLocationState]=useState(()=>parseShellLocation('/?module=shop&view=products&period=custom&from=2026-09-01&to=2026-09-01&shopPlatform='+encodeURIComponent('京东')+'&shopOutlet='+encodeURIComponent('京东\\u001f合成店A')));
 const navigate=url=>{history.pushState(null,'',url);setLocationState(parseShellLocation(url));};
 React.useEffect(()=>{const listener=()=>setLocationState(parseShellLocation(location.href));addEventListener('popstate',listener);return()=>removeEventListener('popstate',listener)},[]);
 const period=locationState.period.kind==='custom'?locationState.period:{from:'2026-09-01',to:'2026-09-01'};
 const change=patch=>navigate(updateShopContextLocation(serializeShellLocation(locationState),patch));
 const probe=(mode,date)=>{window.__mode=mode;window.__baseline503=mode==='baseline';change({product:null,section:'',q:'',page:1});navigate(serializeShellLocation({...locationState,period:{kind:'custom',from:date,to:date},shop:{...locationState.shop,product:null,section:'',q:'',page:1}}));};
 return <><p>完整 ProductsColumn 合成 API / 真实 shell 导航；作者验证。</p><div><button id="probe-baseline" onClick={()=>probe('baseline','2026-09-02')}>新范围基期503</button><button id="probe-forbidden" onClick={()=>probe('forbidden','2026-09-03')}>新范围403</button><button id="probe-ready" onClick={()=>probe('ready','2026-09-01')}>恢复本期</button><button id="probe-version" onClick={()=>{window.__revisionErrors=1;window.__revision++;}}>一次版本变化</button><button id="probe-changing" onClick={()=>{window.__revisionErrors=10;}}>持续版本变化</button><button id="probe-a" onClick={()=>change({outlets:['京东\\u001f合成店A'],product:null})}>范围A</button><button id="probe-b" onClick={()=>change({outlets:['京东\\u001f合成店B'],product:null})}>范围B</button><button id="probe-tmall-catalog" onClick={()=>change({platforms:['天猫'],outlets:['天猫\\u001f合成店A'],dimension:'spu',product:null,section:'catalog',q:'',page:1})}>天猫SKU目录</button></div><ProductsColumn startDate={period.from} endDate={period.to} periodKind={period.intent||'custom'} context={locationState.shop} currentUser={{email:'synthetic@example.test',displayName:'合成用户',role:'admin',roleLabel:'管理员'}} onContextChange={change} onModuleViewChange={()=>{}} onDrill={(view,product,section)=>navigate(drillShopLocation(serializeShellLocation(locationState),view,product,section))} onReturn={()=>navigate(returnShopLocation(serializeShellLocation(locationState)))} onApplyPeriod={(start,end,intent)=>navigate(serializeShellLocation({...locationState,period:{kind:'custom',from:start,to:end,intent}}))} onNavigate={(key,source)=>{window.__navigation={key,source}}}/></>;
}
createRoot(document.getElementById('root')).render(location.pathname==='/primitives'?<App/>:<Harness/>);
`;
await writeFile(resolve(runtime, "entry.tsx"), entry, { flag: "wx" });
await build({ entryPoints: [resolve(runtime, "entry.tsx")], bundle: true, outfile: resolve(runtime, "ui.js"), format: "esm", platform: "browser", conditions: ["style"], jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning" });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'");
  if (path === "/ui.js" || path === "/ui.css") { response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css"); response.end(await readFile(resolve(runtime, path.slice(1)))); return; }
  if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
  if (/^\/api\/netshop\/product-images\/[a-f0-9]{64}$/.test(path)) { response.setHeader("Content-Type", "image/svg+xml"); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#d3ddd7"/><text x="12" y="36" fill="#396149">fixture</text></svg>'); return; }
  if (path !== "/" && path !== "/primitives") { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/html;charset=utf-8");
  response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{margin:0;padding:12px}#root{max-width:1440px;margin:auto}</style><div id="root"></div><script type="module" src="/ui.js"></script></html>');
});
let browser;
const checks = [], errors = [];
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await writeEvidence("resource.json", { role, runId, port, pid: process.pid, root, evidence, synthetic: true, status: "running" });
  browser = await chromium.launch({ executablePath: process.env.NETSHOP_UI_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/primitives`);
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
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await check("full column mounts with frozen seven columns and no duplicate system header", async () => { await page.getByRole("heading", { name: "商品经营明细", exact: true }).waitFor(); assert.equal(await page.locator('[aria-label="系统主导航"]').count(), 0); for (const label of ["平台销售额（元）", "销量（件）", "访客累计", "转化率", "加购率", "同比（销售额）", "环比（销售额）"]) await page.getByRole("columnheader", { name: label, exact: true }).waitFor(); assert.equal(await page.locator(".np-table tbody tr").count(), 20); });
  await page.screenshot({ path: resolve(evidence, "balanced-performance-desktop.png"), fullPage: true });
  for (const width of [390, 320]) await check(`balanced performance viewport ${width} preserves content`, async () => { await page.setViewportSize({ width, height: 900 }); const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions)); await page.screenshot({ path: resolve(evidence, `balanced-performance-${width}.png`), fullPage: true }); });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await check("contribution and traffic topics consume whole-set server metadata", async () => { await page.getByRole("button", { name: "贡献增长", exact: true }).click(); await page.getByRole("heading", { name: "增长与下降贡献", exact: true }).waitFor(); await page.getByLabel("商品明细排序").selectOption("decline_desc"); await page.getByRole("heading", { name: "商品经营明细", exact: true }).waitFor(); assert.ok(await page.evaluate(() => window.__calls.some(call => call.query.sort === "decline_desc"))); await page.getByRole("button", { name: "流量效率", exact: true }).click(); await page.getByRole("heading", { name: "流量与成交效率", exact: true }).waitFor(); await page.getByText(/完整扫描 42 个，命中 42 个/).waitFor(); await page.getByRole("button", { name: "经营概览", exact: true }).click(); });
  const summaryPayment = () => page.locator(".np-metric").filter({ has: page.locator(".insights-metric > span", { hasText: /^平台销售额$/ }) }).first().locator("strong").textContent();
  await check("table search is server-side and does not change complete summary", async () => { const before = await summaryPayment(); await page.getByLabel("表内搜索商品名称、ID或商家码").fill("P41"); await page.getByText("合成商品 P41", { exact: true }).waitFor(); assert.equal(await page.locator(".np-table tbody tr").count(), 1); assert.equal(await summaryPayment(), before); const calls = await page.evaluate(() => window.__calls); assert.ok(calls.some(call => call.query.q === "P41" && call.query.page === "1")); });
  await check("page/column state survives exact product drill and shell return", async () => { await page.getByLabel("表内搜索商品名称、ID或商家码").fill(""); await page.getByText("合成商品 P01", { exact: true }).waitFor(); await page.getByRole("button", { name: "下一页", exact: true }).click(); await page.getByText("合成商品 P21", { exact: true }).waitFor(); await page.getByLabel("访客 / 转化 / 加购", { exact: true }).uncheck(); assert.equal(await page.getByRole("columnheader", { name: "访客累计", exact: true }).count(), 0); await page.getByRole("button", { name: "详情", exact: true }).first().click(); await page.getByRole("heading", { name: "两期经营成绩", exact: true }).waitFor(); assert.ok(await page.evaluate(() => window.__calls.some(call => call.path.endsWith("/detail") && JSON.parse(call.query.productIdentity)[3] === "P21" && call.outlets.length === 1))); await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click(); await page.getByText("合成商品 P21", { exact: true }).waitFor(); assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), false); assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2"); });
  await check("detail reads each typed source and discloses unverified historical SKU", async () => { await page.getByRole("button", { name: "详情", exact: true }).first().click(); await page.getByRole("button", { name: "逐日明细", exact: true }).click(); await page.getByRole("heading", { name: "平台经营逐日明细", exact: true }).waitFor(); await page.getByRole("columnheader", { name: "加购客户累计", exact: true }).waitFor(); await page.getByLabel("单品明细来源").selectOption("erp"); await page.getByRole("heading", { name: "ERP经营逐日明细", exact: true }).waitFor(); await page.getByRole("columnheader", { name: "ERP货品成本", exact: true }).waitFor(); assert.ok(await page.evaluate(() => window.__calls.some(call => call.path.endsWith("/detail") && call.query.section === "daily" && call.query.source === "erp"))); await page.getByRole("button", { name: "历史SKU贡献", exact: true }).click(); await page.getByText("历史SKU归属尚未具备", { exact: true }).waitFor(); await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click(); await page.getByText("合成商品 P21", { exact: true }).waitFor(); });
  await check("ordinary baseline 503 retains reliable current while comparison is empty", async () => { await page.locator("#probe-baseline").click(); await page.getByText(/环比来源读取失败：合成基期503/).waitFor(); await page.getByText("合成商品 P01", { exact: true }).waitFor(); assert.equal(await summaryPayment(), "420,000 元"); assert.equal(await page.locator(".np-table tbody tr").count(), 20); });
  await check("403 clears all prior performance values and rows", async () => { await page.locator("#probe-forbidden").click(); await page.getByRole("alert").filter({ hasText: "合成权限403" }).waitFor(); assert.equal(await page.locator(".np-table tbody tr").count(), 0); assert.equal(await page.getByText("420,000 元", { exact: true }).count(), 0); });
  await page.locator("#probe-ready").click(); await page.getByText("合成商品 P01", { exact: true }).waitFor();
  await check("version change triggers one complete bounded reload", async () => { const before = await page.evaluate(() => window.__calls.length); await page.locator("#probe-version").click(); await page.getByRole("button", { name: "刷新本范围", exact: true }).click(); await page.getByText("合成商品 P01", { exact: true }).waitFor(); const calls = await page.evaluate(() => window.__calls.slice(-2)); assert.equal(await page.evaluate(() => window.__calls.length) - before, 2); assert.equal(calls[1].query.snapshotToken, undefined); });
  await check("continuous version changes stop after two attempts", async () => { const before = await page.evaluate(() => window.__calls.length); await page.locator("#probe-changing").click(); await page.getByRole("button", { name: "刷新本范围", exact: true }).click(); await page.getByText("来源版本已变化，请重新读取", { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__calls.length) - before, 2); await page.evaluate(() => { window.__revisionErrors = 0; }); await page.getByRole("button", { name: "重新读取", exact: true }).click(); await page.getByText("合成商品 P01", { exact: true }).waitFor(); });
  await check("fast shop changes display only the final exact shop", async () => { await page.locator("#probe-a").click(); await page.locator("#probe-b").click(); await page.getByText("合成商品 P01", { exact: true }).waitFor(); await new Promise(resolve => setTimeout(resolve, 180)); assert.ok((await page.locator(".np-table tbody tr").first().textContent()).includes("合成店B")); });
  await check("directory images/search/page/readonly SKU records are retained", async () => { await page.locator("#probe-tmall-catalog").click(); await page.getByRole("heading", { name: "货品档案", exact: true }).waitFor(); await page.getByText("目录合成商品 1", { exact: true }).waitFor(); await page.getByRole("button", { name: "图片浏览", exact: true }).click(); assert.equal(await page.locator(".np-gallery-item").count(), 20); await page.getByRole("button", { name: "切换表格", exact: true }).click(); await page.getByRole("button", { name: "目录资料", exact: true }).first().click(); await page.getByText("天猫SKU仅具备目录资料，不能以此生成SKU日经营、趋势或历史SKU贡献。", { exact: true }).waitFor(); const before = await page.evaluate(() => window.__calls.length); await page.getByRole("button", { name: "查看SPU经营", exact: true }).click(); await page.getByRole("heading", { name: "两期经营成绩", exact: true }).waitFor(); const calls = await page.evaluate(() => window.__calls.slice(-1)); assert.equal(JSON.parse(calls[0].query.productIdentity)[2], "spu"); assert.ok(await page.evaluate(() => window.__calls.length) > before); });
  await check("import navigation uses the existing shell callback without business writes", async () => { await page.getByRole("button", { name: "数据导入", exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.__navigation), { key: "import", source: "tmall_product_daily" }); });
  await check("original period picker preserves rolling intent in actual requests", async () => { await page.getByRole("button", { name: "选择商品统计期间", exact: true }).click(); await page.getByLabel("自定义统计周期").waitFor(); await page.getByRole("button", { name: "近7天", exact: true }).click(); await page.getByRole("button", { name: "确定", exact: true }).click(); await page.getByRole("heading", { name: "两期经营成绩", exact: true }).waitFor(); assert.ok(await page.evaluate(() => window.__calls.some(call => call.query.periodKind === "rolling" && call.query.startDate !== call.query.endDate))); });
  await page.screenshot({ path: resolve(evidence, "full-column-desktop.png"), fullPage: true });
  for (const width of [390, 320]) await check(`full column viewport ${width} does not overflow`, async () => { await page.setViewportSize({ width, height: 900 }); const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions)); await page.screenshot({ path: resolve(evidence, `full-column-${width}.png`), fullPage: true }); });
  assert.deepEqual(errors, []);
  await writeEvidence("result.json", { role, synthetic: true, runId, checks, errors, status: "passed", scriptAuthor: "P-ui", independentReviewConclusion: null, limitations: ["Full ProductsColumn with synthetic API and real shell navigation helpers", "No live source, Worker/Django end-to-end or PostgreSQL validation"] });
  process.stdout.write(`${JSON.stringify({ evidence, runId, checks: checks.length, errors, status: "passed" })}\n`);
} catch (error) {
  await writeEvidence("failure.json", { role, runId, checks, errors, status: "failed", error: error.message });
  throw error;
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await writeEvidence("shutdown.json", { role, runId, browserClosed: true, serverClosed: !server.listening });
}
