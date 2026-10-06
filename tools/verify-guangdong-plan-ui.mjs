import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";

process.env.CI = "true";
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".runtime/guangdong-plan-ui");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "index.html"), '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/.runtime/guangdong-plan-ui/main.tsx"></script></html>');
await writeFile(resolve(output, "main.tsx"), `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import View from '/app/inventory-module-view';
import '/app/globals.css';
function App(){const [role,setRole]=useState('admin');return <main style={{padding:24}}><button onClick={()=>setRole(role==='admin'?'viewer':'admin')}>切换测试权限</button><View customStartDate="" customEndDate="" currentUser={{email:'synthetic@example.invalid',displayName:'合成用户',role,roleLabel:role}} moduleView="guangdong" onModuleViewChange={()=>{}} onAskAi={()=>{}} /></main>}
createRoot(document.getElementById('root')).render(<App/>);`);
const server = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { "@": root } }, server: { host: "127.0.0.1", port: 3118, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  let version = "1:012345abcdef/sales:1/erp:1";
  const identity = { productCode: "00123", productName: "志高循环风扇", specification: "ZG-18", brand: "志高", category: "电风扇", supplier: "测试供应商", supplierSource: "库存快照" };
  const watch = [{ ...identity, active: true, notes: "关注补货" }];
  const base = { ...identity, warehouse: "广东仓", notes: "关注补货", availableQuantity: 100, inTransitQuantity: 200, inventoryAgeDays: 20, unitCostCents: 5000, knownStockValueCents: 500000, costMissing: false, outbound7dQuantity: 70, outbound15dQuantity: 150, outbound30dQuantity: 300, turnoverDays: 10, latestOrderDate: "2026-09-09", replenishmentQuantity: 35, replenishmentRemainingQuantity: 20, replenishmentStockIncreaseQuantity: 15, replenishmentRemainingReason: "", latestReplenishmentOrderDate: "2026-09-08", supplierLeadDays: 10, supplierBufferDays: 7, planOperatorName: "运营甲", planBuyer: "采购甲", autoRisk: "urgent", autoRiskLabel: "紧急补货", autoRiskReasons: ["销售周转不超过生产周期"], inventoryStale: false };
  const itemSettings = { leadDays: 10, bufferDays: 7, leadDaysOverride: null, bufferDaysOverride: null, cycleSource: "供应商设置", operatorName: "运营甲", operatorNameOverride: null, operatorNameSource: "最新备货计划", buyer: "采购甲", buyerOverride: null, buyerSource: "最新备货计划", risk: "urgent", riskLabel: "紧急补货", riskReasons: ["销售周转不超过生产周期"], riskOverride: null, riskReasonOverride: null, riskSource: "系统判定" };
  const labels = { no_stock: "无可用库存", urgent: "紧急补货", warning: "补货预警", stale: "积压风险", unknown: "待完善/待观察", healthy: "健康" };
  const requests = [];
  await page.route("**/api/inventory/guangdong-monitor**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const suffix = url.pathname.split("guangdong-monitor")[1];
    requests.push({ suffix, search: url.search, method: request.method() });
    assert.equal(request.method(), "GET");
    let result;
    if (!suffix) {
      assert.equal(url.searchParams.has("warehouse"), false);
      const items = watch.filter((row) => row.active).map((row) => ({ ...base, ...row, ...itemSettings }));
      result = { version, hasInventory: true, watchCount: items.length, sync: { inventoryAsOf: "2026-09-08", inventoryAgeAsOf: "2026-09-08", salesThrough: "2026-09-07", inventoryStale: false }, filters: { brands: ["志高"], categories: ["电风扇"], suppliers: ["测试供应商"] }, metrics: { itemCount: items.length, availableQuantity: 100, inTransitQuantity: 200, knownStockValueCents: 500000, missingCostCount: 0, missingStockCount: 0 }, pagination: { page: 1, pageSize: 50, total: items.length, totalPages: 1 }, items, distribution: Object.entries(labels).map(([risk,label]) => ({ risk, label, itemCount: risk === "urgent" ? items.length : 0, quantity: risk === "urgent" ? 100 : 0, knownStockValueCents: risk === "urgent" ? 500000 : 0, itemRate: risk === "urgent" ? 1 : 0, quantityRate: risk === "urgent" ? 1 : 0, valueRate: risk === "urgent" ? 1 : 0 })), disclosures: [] };
    } else throw new Error("Unexpected Guangdong API: " + suffix);
    if (!suffix && url.searchParams.has("section")) {
      const section = url.searchParams.get("section");
      const scope = new URLSearchParams(url.searchParams); scope.delete("section"); scope.sort();
      result = { ...result, readSection: section,
        readScope: createHash("sha256").update(scope.toString()).digest("hex"),
        readSnapshot: createHash("sha256").update(version).digest("hex"),
        items: section === "summary" ? [] : result.items };
    }
    await route.fulfill({ status: 200, json: result });
  });
  let mode = "normal";
  const writes = [];
  let dingTalkCalls = 0;
  const gdOption = {key:"00123::广东仓",warehouse:"广东仓",availableQuantity:100,salesQuantity:300,coverageDays:10,suggestedQuantity:50,inDraftPlan:false};
  const candidate = {...identity,totalSalesQuantity:600,warehouseOptions:[{...gdOption,key:"00123::京东仓",warehouse:"京东仓",availableQuantity:30},gdOption]};
  const candidateResponse = () => ({hasInventory:true,sync:{inventoryAsOf:"2026-09-08",inventoryStale:mode==="stale"},mapping:{samples:mode==="missing"?[]:[candidate]},items:[]});
  await page.route("**/api/inventory/overview**",async route=>{
    assert.equal(new URL(route.request().url()).searchParams.get("q"),"00123");
    if(mode==="delay")await new Promise(resolve=>setTimeout(resolve,700));
    await route.fulfill({status:mode==="readError"?503:200,json:mode==="readError"?{error:"合成读取失败"}:candidateResponse()}).catch(()=>{});
  });
  await page.route("**/api/inventory/replenishment",async route=>{
    assert.equal(route.request().method(),"POST");
    const body=route.request().postDataJSON();writes.push(body);
    if(mode==="saveError"){await route.fulfill({status:400,json:{ok:false,message:"合成保存失败"}});return;}
    base.replenishmentQuantity=body.plannedQuantity;base.latestReplenishmentOrderDate=body.orderDate;
    version=String(writes.length+10)+":012345abcdef/sales:1/erp:1";
    await route.fulfill({json:{ok:true,item:{id:"synthetic-plan-"+writes.length}}});
  });
  await page.route("**/api/inventory/replenishment/dingtalk",async route=>{
    dingTalkCalls++; await route.fulfill({json:{ok:true,outcome:"created"}});
  });
  await page.goto("http://127.0.0.1:3118/.runtime/guangdong-plan-ui/index.html");
  const button=page.getByRole("button",{name:"创建备货计划",exact:true});
  await button.waitFor();
  const columns=await page.getByRole("columnheader").allTextContents();
  assert.equal(columns[columns.indexOf("风险及原因")+1],"创建备货计划");
  assert(columns.includes("建议下单"));assert(!columns.includes("最晚下单"));
  await page.getByText("下单时间 2026-09-08",{exact:true}).waitFor();
  await button.click();
  const dialog=page.getByRole("dialog");await dialog.waitFor();
  assert.equal(await dialog.getByLabel("入库库房").inputValue(),"广东仓");
  assert.equal(await dialog.getByLabel("现有库存").inputValue(),"100");
  assert.equal(await dialog.getByLabel("近30天总销量").inputValue(),"600");
  assert.equal(await dialog.getByLabel("备货数量").inputValue(),"50");
  assert.equal(await dialog.getByLabel("预计消耗周期(天)").inputValue(),"5");
  await dialog.getByLabel("入库库房").selectOption("京东仓");
  assert.equal(await dialog.getByLabel("现有库存").inputValue(),"30");
  await dialog.getByLabel("入库库房").selectOption("广东仓");
  await dialog.getByLabel("对应采购").fill("合成采购");
  await dialog.getByLabel("对应运营").fill("合成运营");
  await dialog.getByLabel("备货数量").fill("66");
  await dialog.getByLabel("下单日期").fill("2026-10-05");
  await page.screenshot({path:resolve(output,"create-plan.png"),fullPage:true});
  await dialog.getByRole("button",{name:"保存草稿",exact:true}).click();
  await dialog.waitFor({state:"hidden"});
  await page.getByText("下单时间 2026-10-05",{exact:true}).waitFor();
  assert.equal(writes.length,1);assert.equal(writes[0].key,gdOption.key);assert.equal(writes[0].manual,true);
  assert.equal(writes[0].plannedQuantity,66);assert.equal(writes[0].buyer,"合成采购");assert.equal(writes[0].operatorName,"合成运营");assert.equal(writes[0].acknowledgeStale,false);assert.equal(dingTalkCalls,0);
  await page.screenshot({path:resolve(output,"detail-after-save.png"),fullPage:true});
  mode="readError";await button.click();await page.getByText("合成读取失败",{exact:true}).waitFor();assert.equal(await dialog.count(),0);
  mode="missing";await button.click();await page.getByText("当前型号缺少可创建计划的广东仓库存记录，请先核对最新库存。",{exact:true}).waitFor();assert.equal(await dialog.count(),0);
  mode="saveError";await button.click();await dialog.waitFor();await dialog.getByRole("button",{name:"保存草稿",exact:true}).click();
  await page.getByText("合成保存失败",{exact:true}).waitFor();assert.equal(await dialog.count(),1);await dialog.getByRole("button",{name:"取消",exact:true}).click();
  mode="stale";await button.click();await dialog.waitFor();
  page.once("dialog",d=>d.dismiss());const before=writes.length;await dialog.getByRole("button",{name:"保存草稿",exact:true}).click();assert.equal(writes.length,before);
  page.once("dialog",d=>d.accept());await dialog.getByRole("button",{name:"保存草稿",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(writes.at(-1).acknowledgeStale,true);
  mode="normal";await button.click();await dialog.waitFor();await dialog.getByLabel("状态").selectOption("confirmed");await dialog.getByRole("button",{name:"确认并提交钉钉",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(dingTalkCalls,1);assert.equal(writes.at(-1).status,"confirmed");
  mode="delay";await button.click();await page.getByRole("button",{name:"切换测试权限"}).click();await page.getByRole("columnheader",{name:"建议下单"}).waitFor();
  await new Promise(resolve=>setTimeout(resolve,900));assert.equal(await dialog.count(),0);assert.equal(await button.count(),0);
  await page.getByRole("button",{name:"切换测试权限"}).click();mode="normal";await button.click();await dialog.waitFor();await dialog.getByRole("button",{name:"取消",exact:true}).click();
  assert.deepEqual(errors,[]);
  const result={status:"passed",synthetic:true,cases:["column order and order date","shared modal defaults and warehouse selection","manual draft and refresh","read failure","missing exact candidate","save failure preserves form","stale cancel and acknowledgement","confirmed DingTalk call mocked","permission change rejects late response"],writes:writes.length,dingTalkCalls};
  await writeFile(resolve(output,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await server.close();}
