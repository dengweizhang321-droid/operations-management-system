import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const stats = { grossSalesCents: 10000, netSalesCents: 9900, costAmountCents: 5000, grossProfitCents: 4900, refundAmountCents: 100, orderCount: 1, lineCount: 1, netQuantity: 1, averageOrderValueCents: 9900, grossMarginRate: 4900/9900, refundRate: .01 };
function summary(url: string, token = "a".repeat(64), revision = "1:1") {
  const q=new URL(url).searchParams;
  const items=[0,1].map(i=>({productCode:`S-${i}`,productName:`合成商品 ${i}`,brand:"合成品牌",supplierName:"合成供应商",specification:"合成规格",category:"合成品类",outlets:[],netQuantity:1,grossSalesCents:10000,refundAmountCents:100,netSalesCents:9900,costCents:5000,feeCents:100,grossProfitCents:4900,grossMarginRate:4900/9900,refundRate:.01,shippingRate:0,averageSalePriceCents:9900,averageCostCents:5000,observedFeeRate:.01,availableQuantity:null,stockValueCents:null,knownStockValueCents:null,costCoverageRate:null}));
  return {projection:"full",snapshotToken:token,salesSourceRevision:revision,hasSales:true,range:"custom",sync:{salesWindowStart:q.get("startDate"),salesThrough:q.get("endDate"),requestedStartDate:q.get("startDate"),requestedEndDate:q.get("endDate"),dataStartDate:"2026-09-01",dataCutoffDate:"2026-09-30",inventoryAsOf:null,latestSalesFile:"synthetic"},sort:{by:q.get("sortBy")??"netSalesCents",direction:"desc"},pagination:{page:1,pageSize:50,total:2,returned:2,totalPages:1,truncated:false},items,filters:{platforms:[],shops:[],categories:[]},filtersApplied:{platforms:[],shops:[],query:"",categories:[],marginBands:[]},metrics:{skuCount:2,grossSalesCents:20000,netSalesCents:19800,grossProfitCents:9800,grossMarginRate:4900/9900,lossSkuCount:0,stockedSkuCount:0,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:2}}};
}
function detail(url: string, quantity=1) {
  const q=new URL(url).searchParams;
  return {range:"custom",startDate:q.get("startDate"),endDate:q.get("endDate"),current:{...stats,netQuantity:quantity},channels:[],outlets:[],platforms:[],daily:[{date:q.get("startDate"),...stats}],filters:{productCodes:[q.get("productCodes")]}};
}
async function pending(page:Page,n:number) { await page.waitForFunction(n=>(window as unknown as {pending:unknown[]}).pending.length>=n,n); }
async function url(page:Page,i:number) { return page.evaluate(i=>(window as unknown as {pending:{url:string}[]}).pending[i].url,i); }
async function reply(page:Page,i:number,body:unknown,status=200,revision="1:1") { await page.evaluate(({i,body,status,revision})=>(window as unknown as {pending:{resolve:(r:Response)=>void}[]}).pending[i].resolve(new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","x-sales-data-revision":revision,"x-sales-source-revision":revision}})),{i,body,status,revision}); }
async function fixture() {
  const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import View from './app/product-module-view';function App(){const[start,setStart]=useState('2026-09-01'),[tab,setTab]=useState('overview');return <><button onClick={()=>setStart('2026-09-02')}>改日期</button><View range="自定义" customStartDate={start} customEndDate="2026-09-30" moduleView={tab} onModuleViewChange={setTab}/></>};createRoot(document.getElementById('root')).render(<App/>);`,loader:"tsx",resolveDir:fileURLToPath(new URL("../",import.meta.url))},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'}});
  const browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",r=>r.fulfill({contentType:"text/html",body:'<div id="root"></div>'}));await page.goto("https://products-detail-fixture.invalid/");
  await page.evaluate(()=>{const s=window as unknown as {pending:{url:string;resolve:(r:Response)=>void}[]};s.pending=[];window.fetch=((url:unknown)=>new Promise(resolve=>s.pending.push({url:String(new URL(String(url),location.href)),resolve}))) as typeof fetch;});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await pending(page,1);await reply(page,0,summary(await url(page,0)));await page.locator(".product-cell").first().waitFor();return {browser,page,errors};
}

test("detail hides old periods synchronously, rejects late/error responses and recovers",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);await reply(page,1,detail(await url(page,1),111));
    await page.getByText("111 件",{exact:true}).waitFor();
    await page.getByRole("button",{name:"改日期",exact:true}).click();await pending(page,3);
    assert.equal(await page.getByText("111 件",{exact:true}).count(),0);
    await page.getByText("等待当前范围的商品快照",{exact:true}).waitFor();
    await reply(page,2,summary(await url(page,2)));await pending(page,4);
    await reply(page,3,{error:"合成新日期失败"},503);await page.getByText("合成新日期失败",{exact:true}).waitFor();
    assert.equal(await page.getByText("111 件",{exact:true}).count(),0);
    await page.getByRole("button",{name:"重新加载",exact:true}).click();await pending(page,5);
    await page.getByRole("button",{name:/返回商品经营/}).click();await page.getByRole("button",{name:"详情",exact:true}).last().click();await pending(page,6);
    await reply(page,5,detail(await url(page,5),222));await page.getByText("222 件",{exact:true}).waitFor();
    await reply(page,4,detail(await url(page,4),999));assert.equal(await page.getByText("999 件",{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("same-range refresh reads detail, retains success on failure and enforces source version",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);await reply(page,1,detail(await url(page,1),111));await page.getByText("111 件",{exact:true}).waitFor();
    await page.getByRole("button",{name:/同步数据/}).click();await pending(page,4);
    const requests=[await url(page,2),await url(page,3)];assert.equal(requests.filter(u=>u.includes("/api/sales/summary")).length,1);
    for (const i of [2,3]) await reply(page,i,(await url(page,i)).includes("/api/products/")?summary(await url(page,i)):{error:"合成同范围失败"},(await url(page,i)).includes("/api/products/")?200:503);
    await page.getByText("详情刷新失败",{exact:true}).waitFor();assert.equal(await page.getByText("111 件",{exact:true}).count(),1);
    await page.getByRole("button",{name:"重试",exact:true}).click();await pending(page,5);
    await reply(page,4,detail(await url(page,4),999),200,"2:1");await page.getByText(/销售版本不一致/).waitFor();assert.equal(await page.getByText("999 件",{exact:true}).count(),0);
    await page.getByRole("button",{name:/同步数据/}).click();await pending(page,7);
    for (const i of [5,6]) await reply(page,i,(await url(page,i)).includes("/api/products/")?summary(await url(page,i),"b".repeat(64),"2:1"):detail(await url(page,i),888),200,"2:1");
    await pending(page,8);await reply(page,7,detail(await url(page,7),333),200,"2:1");await page.getByText("333 件",{exact:true}).waitFor();assert.equal(await page.getByText("111 件",{exact:true}).count(),0);assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("calculator uses validated first-page data, local inputs and tab reentry without another aggregate",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("tab",{name:"毛利测算",exact:true}).click();await page.getByText("预计单件收益",{exact:true}).waitFor();
    const fields=page.locator('.calculator-fields input[type="number"]');
    await fields.nth(0).fill("100");await fields.nth(1).fill("40");await fields.nth(2).fill("10");await fields.nth(3).fill("5");
    await page.waitForFunction(()=>Number(document.querySelector('.calculator-result strong')?.textContent?.replace(/[^0-9.-]/g,''))===45);
    await page.getByRole("tab",{name:"商品经营",exact:true}).click();await page.getByRole("tab",{name:"毛利测算",exact:true}).click();
    assert.equal(await fields.nth(0).inputValue(),"100");assert.equal(await page.evaluate(()=>(window as unknown as {pending:unknown[]}).pending.length),1);
    await fields.nth(0).fill("0");await page.getByText("请输入成交价",{exact:true}).waitFor();
    await fields.nth(0).fill("10");await page.getByText("该方案预计亏损",{exact:true}).waitFor();assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("cancelled detail followed by empty coverage releases refresh and rejects its late response",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);
    await page.getByRole("button",{name:"改日期",exact:true}).click();await pending(page,3);
    const empty=summary(await url(page,2));empty.sync.salesWindowStart=null;empty.sync.salesThrough=null;
    empty.items=[];empty.pagination={page:1,pageSize:50,total:0,returned:0,totalPages:0,truncated:false};
    empty.metrics={skuCount:0,grossSalesCents:0,netSalesCents:0,grossProfitCents:0,grossMarginRate:0,lossSkuCount:0,stockedSkuCount:0,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:0}};
    await reply(page,2,empty);await page.getByText("当前统计周期没有销售覆盖",{exact:true}).waitFor();
    assert.equal(await page.locator('.product-refresh').isEnabled(),true);
    await reply(page,1,detail(await url(page,1),999));assert.equal(await page.getByText("999 件",{exact:true}).count(),0);assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("malformed dates, wrong specification and invalid amounts fail locally before chart rendering",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);
    for (let i=1;i<=4;i++) {
      const body=detail(await url(page,i));
      if(i===1)Reflect.deleteProperty(body.daily[0],'date');
      if(i===2)body.daily[0].date='2026-09-31';
      if(i===3)body.filters.productCodes=['OTHER'];
      if(i===4)body.current.netSalesCents=NaN;
      await reply(page,i,body);await page.getByText(/响应与当前统计周期不一致或字段无效/).waitFor();
      assert.equal(await page.locator('.product-detail-kpi-grid').count(),0);
      if(i<4){await page.getByRole('button',{name:'重新加载',exact:true}).click();await pending(page,i+2);}
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
