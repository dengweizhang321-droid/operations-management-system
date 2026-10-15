import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import type { ProductSummaryFullResponse } from "../lib/products/summary";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
function response(url: string, total = 55, token = "a".repeat(64)) {
  const q = new URL(url).searchParams, page = Number(q.get("page") ?? 1), size = 50;
  const items = Array.from({length:Math.min(size,Math.max(0,total-(page-1)*size))},(_,i)=>({
    productKind:(q.get("productKind")??undefined) as "single"|"combo"|undefined,components:q.get("productKind")==="combo"?[{productCode:"CHILD-A",productName:"合成子件甲",quantity:2,sales:null},{productCode:"CHILD-B",productName:"合成子件乙",quantity:1,sales:null}]:[],productCode:`S-${(page-1)*size+i}`,productName:`合成商品 ${(page-1)*size+i}`,brand:"合成品牌",supplierName:"合成供应商",specification:"合成规格",category:"合成类目",outlets:[],
    netQuantity:1,grossSalesCents:10000,refundAmountCents:100,netSalesCents:9900,costCents:5000,feeCents:100,grossProfitCents:4900,grossMarginRate:4900/9900,refundRate:.01,shippingRate:null,averageSalePriceCents:9900,averageCostCents:5000,observedFeeRate:.01,availableQuantity:null,stockValueCents:null,knownStockValueCents:null,costCoverageRate:null,
  }));
  const full:ProductSummaryFullResponse={projection:"full",productKind:(q.get("productKind")??undefined) as "single"|"combo"|undefined,snapshotToken:token,salesSourceRevision:"1:1",hasSales:true,range:"custom",
    sync:{salesWindowStart:q.get("startDate"),salesThrough:q.get("endDate"),requestedStartDate:q.get("startDate"),requestedEndDate:q.get("endDate"),dataStartDate:"2026-09-01",dataCutoffDate:"2026-09-30",inventoryAsOf:null,latestSalesFile:"synthetic"},
    sort:{by:(q.get("sortBy")??"netSalesCents") as ProductSummaryFullResponse["sort"]["by"],direction:"desc"},
    pagination:{page,pageSize:size,total,returned:items.length,totalPages:Math.ceil(total/size),truncated:(page-1)*size+items.length<total},items,
    filters:{platforms:[],shops:[],categories:[]},filtersApplied:{platforms:[],shops:[],query:q.get("q")??"",categories:[],marginBands:q.getAll("marginBand")},
    productMarginMetrics:{dimension:q.get("productKind") as "single"|"combo",productCount:total,marginBuckets:{below38Count:0,between38And42Count:0,between42And46Count:0,atLeast46Count:total}},comboMarginMetrics:{dimension:"combo",comboCount:total,marginBuckets:{below38Count:0,between38And42Count:0,between42And46Count:0,atLeast46Count:total}},metrics:{skuCount:total,grossSalesCents:10000*total,netSalesCents:9900*total,grossProfitCents:4900*total,grossMarginRate:4900/9900,lossSkuCount:0,stockedSkuCount:0,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:total}},
  };
  if(q.get("view")==="initial-page"){const p={...full,projection:"initial-page"};Reflect.deleteProperty(p,"metrics");Reflect.deleteProperty(p,"filters");return p;}
  if(q.get("view")==="overview"){const p={...full,projection:"overview"};Reflect.deleteProperty(p,"items");return p;}
  return {projection:"page",productKind:(q.get("productKind")??undefined) as "single"|"combo"|undefined,snapshotToken:token,salesSourceRevision:full.salesSourceRevision,sort:full.sort,pagination:full.pagination,items};
}
async function pending(page:Page, count:number){await page.waitForFunction(n=>((window as unknown as {pending:Array<unknown>}).pending?.length??0)>=n,count);}
async function request(page:Page,index:number){return page.evaluate(i=>(window as unknown as {pending:Array<{url:string}>}).pending[i].url,index);}
async function reply(page:Page,index:number,body:unknown,status=200){await page.evaluate(({index,body,status})=>(window as unknown as {pending:Array<{resolve:(v:Response)=>void}>}).pending[index].resolve(new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})),{index,body,status});}
async function fixturePage() {
  const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import View from './app/product-module-view';function App(){const[start,setStart]=useState('2026-09-01');return <><button onClick={()=>setStart('2026-09-02')}>改日期</button><View range="自定义" customStartDate={start} customEndDate="2026-09-30" moduleView="overview" onModuleViewChange={()=>{}}/></>};createRoot(document.getElementById('root')).render(<App/>);`,loader:"tsx",resolveDir:fileURLToPath(new URL("../",import.meta.url))},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'}});
  const browser=await chromium.launch({executablePath:chrome,headless:true});const page=await browser.newPage();const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));await page.route("**/*",r=>r.fulfill({contentType:"text/html",body:'<div id="root"></div>'}));
  await page.goto("https://product-recovery-fixture.invalid/");
  await page.evaluate(()=>{const state=window as unknown as {pending:Array<{url:string;resolve:(v:Response)=>void}>};state.pending=[];window.fetch=((url:unknown)=>new Promise(resolve=>state.pending.push({url:String(new URL(String(url),location.href)),resolve}))) as typeof fetch;});
  await page.addScriptTag({content:bundle.outputFiles[0].text});return {browser,page,errors};
}

test("product type switches isolate late reads, reset paging and show bundle components without a trend request", {skip:!existsSync(chrome),timeout:30000}, async () => {
  const {browser,page,errors}=await fixturePage();
  try {
    await pending(page,1);
    assert.equal(new URL(await request(page,0)).searchParams.get("productKind"),"single");
    await reply(page,0,response(await request(page,0)));await pending(page,2);
    await reply(page,1,response(await request(page,1)));await page.getByText("55 个单品",{exact:true}).waitFor();
    await page.getByRole("button",{name:"下一页",exact:true}).click();await pending(page,3);
    await page.getByRole("tab",{name:"组合装",exact:true}).click();await pending(page,4);
    const comboUrl=await request(page,3);
    assert.equal(new URL(comboUrl).searchParams.get("productKind"),"combo");
    assert.equal(new URL(comboUrl).searchParams.get("page"),"1");
    await reply(page,3,response(comboUrl,1));await pending(page,5);await reply(page,4,response(await request(page,4),1));
    await page.getByRole("button",{name:"查看构成",exact:true}).waitFor();
    await reply(page,2,response(await request(page,2)));
    assert.equal(await page.locator(".product-cell").count(),1);
    await page.setViewportSize({width:1440,height:1000});
    await page.addStyleTag({content:await readFile(new URL("../app/styles/tokens.css",import.meta.url),"utf8")});
    await page.addStyleTag({content:await readFile(new URL("../app/globals.css",import.meta.url),"utf8")});
    await page.addStyleTag({content:await readFile(new URL("../app/styles/shared-theme.css",import.meta.url),"utf8")});
    await mkdir(new URL("../.runtime/product-kind/",import.meta.url),{recursive:true});
    await page.screenshot({path:fileURLToPath(new URL("../.runtime/product-kind/preview.png",import.meta.url)),fullPage:true});
    const before=await page.evaluate(()=>(window as unknown as {pending:unknown[]}).pending.length);
    await page.getByRole("button",{name:"查看构成",exact:true}).click();
    await page.getByText("合成子件甲",{exact:true}).waitFor();
    assert.equal(await page.getByText("每套数量（件）",{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>(window as unknown as {pending:unknown[]}).pending.length),before);
    await page.getByRole("button",{name:"← 返回商品经营",exact:true}).click();
    await page.getByRole("tab",{name:"单品",exact:true}).click();await pending(page,6);
    await reply(page,5,{...response(await request(page,5),1),productKind:"combo"});
    await page.getByText("商品类型响应与请求不一致",{exact:false}).waitFor();
    assert.equal(await page.locator(".product-cell").count(),0);
    await page.getByRole("button",{name:"重试明细",exact:true}).click();await pending(page,7);
    await reply(page,6,response(await request(page,6),1));await pending(page,8);await reply(page,7,response(await request(page,7),1));
    await page.getByRole("button",{name:"详情",exact:true}).waitFor();
    const queryField=page.getByRole("textbox",{name:/搜索一个或多个货品/});
    await queryField.fill("S-0");
    await page.getByRole("button",{name:"查询",exact:true}).click();await pending(page,9);
    assert.equal(new URL(await request(page,8)).searchParams.get("q"),"S-0");
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("margin cards follow the selected kind and keep it when filtering", {skip:!existsSync(chrome),timeout:30000}, async () => {
  const {browser,page,errors}=await fixturePage();
  const metrics={dimension:"combo",comboCount:6,marginBuckets:{below38Count:1,between38And42Count:2,between42And46Count:2,atLeast46Count:1}};
  const body=(url:string,total:number)=>{
    const payload={...response(url,total),comboMarginMetrics:metrics,productMarginMetrics:{dimension:new URL(url).searchParams.get("productKind"),productCount:6,marginBuckets:metrics.marginBuckets}};
    if (new URL(url).searchParams.getAll("marginBand").includes("38to42")) {
      if ("items" in payload) payload.items=payload.items.map(item=>({...item,costCents:5940,averageCostCents:5940,grossProfitCents:3860,grossMarginRate:.4}));
      if ("metrics" in payload) payload.metrics={...payload.metrics,grossProfitCents:3860*total,grossMarginRate:.4,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:total,atLeast45Count:0}};
    }
    return payload;
  };
  try {
    await pending(page,1);await reply(page,0,body(await request(page,0),1));await pending(page,2);await reply(page,1,body(await request(page,1),1));
    const band=page.getByRole("button",{name:/实际大毛利率38%–42%/});
    await page.getByText("2 个单品",{exact:true}).first().waitFor();
    assert.equal(await page.getByRole("tab",{name:"单品",exact:true}).getAttribute("aria-selected"),"true");
    assert.equal(await page.locator(".product-cell").count(),1);
    assert.equal(await page.getByText("2 个单品",{exact:true}).count(),2);
    await band.click();await pending(page,3);
    const q=new URL(await request(page,2)).searchParams;
    assert.equal(q.get("productKind"),"single");assert.deepEqual(q.getAll("marginBand"),["38to42"]);
    await reply(page,2,body(await request(page,2),2));await pending(page,4);await reply(page,3,body(await request(page,3),2));
    await page.getByRole("button",{name:"详情",exact:true}).first().waitFor();
    assert.equal(await band.getAttribute("aria-pressed"),"true");
    assert.equal(await page.getByText("2 个单品",{exact:true}).count(),2);
    await page.getByRole("tab",{name:"组合装",exact:true}).click();await pending(page,5);
    await reply(page,4,body(await request(page,4),1));await pending(page,6);await reply(page,5,body(await request(page,5),1));
    await page.getByRole("button",{name:"查看构成",exact:true}).waitFor();
    assert.equal(await band.getAttribute("aria-pressed"),"true");
    assert.equal(await page.getByText("2 个组合装",{exact:true}).count(),2);
    for (const label of ["实际大毛利率低于38%","实际大毛利率42%–46%","实际大毛利率46%以上"]) assert.equal(await page.getByText(label,{exact:true}).count(),1);
    await page.setViewportSize({width:1440,height:1000});
    for(const file of ["styles/tokens.css","globals.css","styles/shared-theme.css"]) await page.addStyleTag({content:await readFile(new URL(`../app/${file}`,import.meta.url),"utf8")});
    await page.screenshot({path:fileURLToPath(new URL("../.runtime/product-kind/preview-margin.png",import.meta.url)),fullPage:true});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("combo list includes residual singles and expands allocated child data inline", {skip:!existsSync(chrome),timeout:30000}, async () => {
  const {browser,page,errors}=await fixturePage();
  try {
    await pending(page,1);await reply(page,0,response(await request(page,0),1));await pending(page,2);await reply(page,1,response(await request(page,1),1));
    await page.getByRole("tab",{name:"组合装",exact:true}).click();await pending(page,3);
    const payload=response(await request(page,2),2);
    const items=(payload as ProductSummaryFullResponse).items;
    items[1]={...items[1],productKind:"single",components:[]};
    items[0].components=items[0].components!.map((child,i)=>({...child,sales:{netQuantity:i===0?2:1,grossSalesCents:5000,refundAmountCents:50,netSalesCents:4950,costCents:2500,feeCents:50,grossProfitCents:2450,grossMarginRate:2450/4950}}));
    await reply(page,2,payload);await pending(page,4);await reply(page,3,response(await request(page,3),2));
    await page.getByRole("button",{name:"展开S-0组合装构成",exact:true}).waitFor();
    assert.equal(await page.locator(".product-cell").count(),2);
    assert.equal(await page.getByRole("button",{name:"详情",exact:true}).count(),1);
    assert.equal(await page.getByText("1 套",{exact:true}).count(),1);
    const requests=await page.evaluate(()=>(window as unknown as {pending:unknown[]}).pending.length);
    await page.getByRole("button",{name:"展开S-0组合装构成",exact:true}).click();
    const table=page.getByRole("table",{name:"S-0组合装构成及数据",exact:true});
    await table.waitFor();assert.equal(await table.getByText(/49\.50$/).count(),2);
    assert.equal(await page.evaluate(()=>(window as unknown as {pending:unknown[]}).pending.length),requests);
    await page.getByRole("button",{name:"收起S-0组合装构成",exact:true}).click();assert.equal(await table.count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("an interrupted distribution recovers even when the next page or refresh fails",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixturePage();try{
    await pending(page,1);await reply(page,0,response(await request(page,0)));await pending(page,2);
    await page.getByRole("button",{name:"下一页",exact:true}).click();await pending(page,3);
    await reply(page,2,{error:"合成明细暂不可用",code:"service_unavailable"},503);await pending(page,4);
    assert.equal(new URL(await request(page,3)).searchParams.get("view"),"overview");
    await reply(page,3,response(await request(page,3)));
    await page.getByText("55 个单品",{exact:true}).waitFor();assert.equal(await page.locator(".product-cell").count(),50);
    assert.equal(await page.locator(".product-kpi-grid").getAttribute("aria-busy"),"false");
    await reply(page,1,{...response(await request(page,1)),metrics:{...(response(await request(page,1)) as ProductSummaryFullResponse).metrics,marginBuckets:{below35Count:0,between35And40Count:0,between40And45Count:0,atLeast45Count:20}}});
    assert.equal(await page.getByText("55 个单品",{exact:true}).count(),1);
    await page.getByRole("button",{name:"重试明细",exact:true}).click();await pending(page,5);
    await reply(page,4,response(await request(page,4)));await page.getByText("第 2 / 2 页",{exact:true}).waitFor();
    await page.getByRole("button",{name:"排序方式",exact:true}).click();await page.getByRole("option",{name:"按订单毛利",exact:true}).click();await pending(page,6);
    await page.getByRole("status").filter({hasText:"销售净额"}).waitFor();
    const wrong=response(await request(page,5));wrong.pagination.page=2;await reply(page,5,wrong);
    await page.getByText("商品分页响应与请求不一致",{exact:false}).waitFor();
    await page.getByRole("button",{name:/同步数据/}).click();await pending(page,7);
    await reply(page,6,{error:"合成刷新失败",code:"service_unavailable"},503);await pending(page,8);
    await reply(page,7,response(await request(page,7)));await page.getByRole("button",{name:/同步数据/}).waitFor();
    assert.equal(await page.locator(".product-kpi-grid").getAttribute("aria-busy"),"false");
    assert.equal(await page.locator(".product-cell").count(),5);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("same snapshot with conflicting sales source witness fails the affected region locally",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixturePage();try {
    await pending(page,1);await reply(page,0,response(await request(page,0)));await pending(page,2);
    const wrong={...response(await request(page,1)),salesSourceRevision:"2:1"};await reply(page,1,wrong);
    await page.getByText("商品分布与明细全集合不一致",{exact:false}).waitFor();assert.equal(await page.locator('.product-cell').count(),50);
    await page.getByRole('button',{name:'重试分布与筛选',exact:true}).click();await pending(page,3);await reply(page,2,response(await request(page,2)));await page.getByText('55 个单品',{exact:true}).waitFor();
    await page.getByRole('button',{name:'下一页',exact:true}).click();await pending(page,4);await reply(page,3,{...response(await request(page,3)),salesSourceRevision:'2:1'});
    await page.getByText('商品分页缺少同范围汇总',{exact:false}).waitFor();assert.equal(await page.locator('.product-cell').count(),50);assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("first/new scope failures show blocked statistics, and a changed snapshot restarts page one",{skip:!existsSync(chrome),timeout:30000},async()=>{
  const {browser,page,errors}=await fixturePage();try{
    await pending(page,1);await reply(page,0,{error:"合成首读失败",code:"service_unavailable"},503);
    await page.getByText("等待明细快照恢复",{exact:true}).first().waitFor();
    assert.equal(await page.locator(".product-kpi-grid").getAttribute("aria-busy"),"false");
    await page.getByRole("button",{name:"重试明细",exact:true}).click();await pending(page,2);await reply(page,1,response(await request(page,1)));await pending(page,3);await reply(page,2,response(await request(page,2)));await page.getByText("55 个单品",{exact:true}).waitFor();
    await page.getByRole("button",{name:"改日期",exact:true}).click();await pending(page,4);await reply(page,3,{error:"合成新范围失败",code:"service_unavailable"},503);
    await page.getByText("等待明细快照恢复",{exact:true}).first().waitFor();assert.equal(await page.locator(".product-cell").count(),0);assert.equal(await page.getByText("55 个单品",{exact:true}).count(),0);
    await page.getByRole("button",{name:"重试明细",exact:true}).click();await pending(page,5);await reply(page,4,response(await request(page,4)));await pending(page,6);await reply(page,5,response(await request(page,5)));await page.getByText("55 个单品",{exact:true}).waitFor();
    await page.getByRole("button",{name:"下一页",exact:true}).click();await pending(page,7);await reply(page,6,response(await request(page,6)));await page.getByText("第 2 / 2 页",{exact:true}).waitFor();
    await page.getByRole("button",{name:/同步数据/}).click();await pending(page,8);await reply(page,7,{error:"数据版本变化",code:"version_conflict"},503);await pending(page,9);
    assert.equal(new URL(await request(page,8)).searchParams.get("page"),"1");
    await reply(page,8,response(await request(page,8),3,"b".repeat(64)));await pending(page,10);await reply(page,9,response(await request(page,9),3,"b".repeat(64)));await page.getByText("第 1 / 1 页",{exact:true}).waitFor();
    assert.equal(await page.locator(".product-cell").count(),3);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
