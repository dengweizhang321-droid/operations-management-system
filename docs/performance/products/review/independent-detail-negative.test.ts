import assert from "node:assert/strict";
import test from "node:test";
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
  const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import View from './app/product-module-view';function App(){const[start,setStart]=useState('2026-09-01'),[tab,setTab]=useState('overview');return <><button onClick={()=>setStart('2026-09-02')}>改日期</button><View range="自定义" customStartDate={start} customEndDate="2026-09-30" moduleView={tab} onModuleViewChange={setTab}/></>};createRoot(document.getElementById('root')).render(<App/>);`,loader:"tsx",resolveDir:fileURLToPath(new URL("../../../../",import.meta.url))},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'}});
  const browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",r=>r.fulfill({contentType:"text/html",body:'<div id="root"></div>'}));await page.goto("https://products-detail-fixture.invalid/");
  await page.evaluate(()=>{const s=window as unknown as {pending:{url:string;resolve:(r:Response)=>void}[]};s.pending=[];window.fetch=((url:unknown)=>new Promise(resolve=>s.pending.push({url:String(new URL(String(url),location.href)),resolve}))) as typeof fetch;});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await pending(page,1);await reply(page,0,summary(await url(page,0)));await page.locator(".product-cell").first().waitFor();return {browser,page,errors};
}

test("independent: aborted detail followed by no-coverage scope must release refresh",{timeout:30000},async()=>{
  const {browser,page}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);
    await page.getByRole("button",{name:"改日期",exact:true}).click();await pending(page,3);
    const empty=summary(await url(page,2)); empty.items=[]; empty.pagination={page:1,pageSize:50,total:0,returned:0,totalPages:0,truncated:false};
    empty.sync.salesWindowStart=null;empty.sync.salesThrough=null;empty.metrics={skuCount:0,grossSalesCents:0,netSalesCents:0,grossProfitCents:0,grossMarginRate:0,lossSkuCount:0,stockedSkuCount:0,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:0}};
    Reflect.set(empty.metrics,"grossMarginRate",null);
    await reply(page,2,empty);await page.getByText("当前统计周期没有销售覆盖",{exact:true}).waitFor();
    assert.equal(await page.locator('.product-refresh').isDisabled(),false,"new empty scope must not leave detail busy forever");
  }finally{await browser.close();}
});

test("independent: malformed daily date must not reach shared trend rendering",{timeout:30000},async()=>{
  const {browser,page,errors}=await fixture();try {
    await page.getByRole("button",{name:"详情",exact:true}).first().click();await pending(page,2);
    const bad=detail(await url(page,1));Reflect.deleteProperty(bad.daily[0],"date");await reply(page,1,bad);
    await page.waitForTimeout(200);assert.deepEqual(errors,[],"malformed date should fail the owned decoder before charts");
    await page.getByText("规格详情加载失败",{exact:true}).waitFor();
  }finally{await browser.close();}
});

test("independent: owned detail decoder preserves legitimate null/zero and rejects identity/numeric/date faults",async()=>{
  const {validateProductDetail}=await import('../../../../lib/products/detail-contract');
  const request='https://fixture.invalid/api/sales/summary?startDate=2026-09-01&endDate=2026-09-30&productCodes=S-0';
  const fixture=detail(request,0);
  const valid={...fixture,current:{...fixture.current,averageOrderValueCents:null,grossMarginRate:null}};
  assert.equal(validateProductDetail(valid as never,'S-0','2026-09-01','2026-09-30'),valid);
  for(const malformed of [
    {...fixture,filters:{productCodes:['S-1']}},
    {...fixture,endDate:'2026-09-29'},
    {...fixture,daily:[{...fixture.daily[0],date:'2026-02-30'}]},
    {...fixture,daily:[{...fixture.daily[0],date:'2026-10-01'}]},
    {...fixture,daily:[{...fixture.daily[0],netSalesCents:'9900'}]},
    {...fixture,current:{...fixture.current,netSalesCents:Number.MAX_SAFE_INTEGER+1}},
    {...fixture,platforms:[{...stats,name:'test',groupKey:'test',platform:'test',shareRate:Infinity}]},
    {...fixture,outlets:null},
  ]){
    assert.throws(()=>validateProductDetail(malformed as never,'S-0','2026-09-01','2026-09-30'));
  }
});
