import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { planTmallWarehouse, runTmallWarehouse, verifyTmallWarehouse, type WarehousePlan } from "../tools/tmall-warehouse-n8n-pipeline";
import { assertWarehouseBrowserDirectory, warehouseConfig, warehouseLoginConfig, warehouseDay, warehouseHash, warehouseHelperError } from "../lib/tmall-warehouse/policy";
import { IsolatedHelperSlots, isolatedRequestIdentity } from "../tools/tmall-isolated-helper";
import { inspectWarehousePage, warehouseReportSelector } from "../tools/tmall-warehouse-export";
import type { Page } from "playwright-core";
import { assertWarehouseLoginIdentity, warehouseLoginCliPaths } from "../tools/tmall-warehouse-login";
import { workerProtectedSourceRoot } from "../tools/worker-local-release.mjs";

test("active top-level report ignores retained home dates but rejects a real report filter", async () => {
  let reportFields = [{value:"",placeholder:"货品ID"}], reportCount = 1;
  const report = { count:async()=>reportCount, isVisible:async()=>true, innerText:async()=>"库存总览 实时 实时库存行数据 共 25 项", getByRole:(role:string)=>role==="heading"?{count:async()=>1}:{count:async()=>1,isEnabled:async()=>true}, locator:()=>({evaluateAll:async()=>reportFields}) };
  const page = { url:()=>"https://scp.tmall.com/?frameUrl=https%3A%2F%2Fscp.tmall.com%2Fpages%2Fsdigit%2Ffulfillment_realtime_inventory_good_s_ptdjd#380972.682131.682503", locator:(selector:string)=> {
    if(selector===warehouseReportSelector)return report;
    if(selector==="body")return {innerText:async()=>"首页 起始日期 2026-09-30 结束日期 2026-10-14 实时库存行数据 共 25 项"};
    if(selector.includes("header-right-account-name"))return {count:async()=>1,textContent:async()=>"sample-owner"};
    throw new Error("unexpected global query would include retained home dates");
  }} as unknown as Page;
  assert.equal(await inspectWarehousePage(page,"sample-owner"),25);
  reportFields=[{value:"SKU-ONLY",placeholder:"货品ID"}];
  await assert.rejects(inspectWarehousePage(page,"sample-owner"),/FILTER_NOT_EMPTY/);
  reportFields=[{value:"",placeholder:"货品ID"}]; reportCount=2;
  await assert.rejects(inspectWarehousePage(page,"sample-owner"),/REPORT_NOT_READY/);
});

test("warehouse uses shared exclusion and execution fencing, never a six-store slot", async () => {
  const headers = { "x-teruisi-n8n-execution-id": "42", "x-teruisi-workflow-key": "tmall-warehouse" };
  const warehouse = isolatedRequestIdentity("/coordination/claim", headers)!;
  assert.equal(warehouse.key, "legacy"); assert.equal(warehouse.workflow, "tmall-warehouse");
  assert.equal(isolatedRequestIdentity("/tmall-warehouse/run", headers)?.workflow, "tmall-warehouse");
  const slots = new IsolatedHelperSlots(new Set(["tmall-cuizhiwang"]), async () => ({ port: 1, token: "test", stop: async () => undefined }));
  await slots.claim(warehouse).slot!.ready;
  assert.equal(slots.claim({ key: "tmall-cuizhiwang", workflow: "tmall", executionId: "43", storeKey: "tmall-cuizhiwang" }).status, "waiting");
  assert.ok(warehouseHelperError("planned", false, "/tmall-warehouse/run", "43", "42"));
  assert.ok(warehouseHelperError("executed", false, "/tmall-warehouse/run", "42", "42"));
  assert.equal(warehouseHelperError("executed", false, "/tmall-warehouse/verify", "42", "42"), null);
});
test("disabled or shared-profile configuration fails closed", () => {
  assert.throws(() => warehouseConfig({ enabled: false }, os.tmpdir()), /DISABLED/);
  assert.throws(() => warehouseConfig({ enabled: true, owner: "test", userDataDir: os.tmpdir(), executablePath: process.execPath, profileName: "Default", baseUrl: "http://localhost:3000" }, os.tmpdir()), /DEDICATED_PROFILE/);
});
test("login-only permits disabled dedicated profile without authorizing business and rejects wrong account", async () => {
  const root=os.tmpdir(),config={enabled:false,owner:"sample-owner",userDataDir:path.join(root,".runtime/tmall-warehouse-browser"),executablePath:process.execPath,profileName:"Default",baseUrl:"http://localhost:3000"};
  assert.equal(warehouseLoginConfig(config,root).enabled,false);
  assert.throws(()=>warehouseConfig(config,root),/DISABLED/);
  let url="https://scp.tmall.com/",name="sample-owner",body="已登录企业";
  const page={url:()=>url,locator:(selector:string)=>selector==="body"?{innerText:async()=>body}:{count:async()=>1,textContent:async()=>name}} as unknown as Page;
  await assertWarehouseLoginIdentity(page,"sample-owner");
  name="other-owner";await assert.rejects(assertWarehouseLoginIdentity(page,"sample-owner"),/OWNER_MISMATCH/);
  name="sample-owner";body="安全验证";await assert.rejects(assertWarehouseLoginIdentity(page,"sample-owner"),/LOGIN_NOT_COMPLETED/);
  body="已登录";url="https://login.taobao.com/";await assert.rejects(assertWarehouseLoginIdentity(page,"sample-owner"),/LOGIN_NOT_COMPLETED/);
});
test("login CLI shares formal helper mutable root and loads template from its frozen source", async () => {
  const sourceFile=path.join(os.tmpdir(),"frozen-source-fixture","tools","tmall-warehouse-login.ts");
  const {pathToFileURL}=await import("node:url");
  const paths=warehouseLoginCliPaths([],pathToFileURL(sourceFile).href);
  assert.equal(paths.root,workerProtectedSourceRoot);
  assert.notEqual(paths.root,path.dirname(path.dirname(sourceFile)));
  assert.equal(paths.templatePath,path.join(path.dirname(path.dirname(sourceFile)),"automation/n8n/tmall-warehouse.config.example.json"));
  assert.throws(()=>warehouseLoginCliPaths(["--root",path.dirname(sourceFile)]),/ARGUMENTS_REJECTED/);
  const template=JSON.parse(await readFile(new URL("../automation/n8n/tmall-warehouse.config.example.json",import.meta.url),"utf8"));
  assert.equal(template.enabled,false);
  assert.equal(template.executablePath,"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
});
test("dedicated profile path cannot redirect into another browser through a junction", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"tmall-warehouse-profile-test-"));
  try {
    const config={enabled:false,owner:"test",userDataDir:path.join(root,".runtime/tmall-warehouse-browser"),executablePath:process.execPath,profileName:"Default",baseUrl:"http://localhost:3000"};
    await mkdir(path.join(root,".runtime")); await mkdir(path.join(root,"foreign-profile"));
    await symlink(path.join(root,"foreign-profile"),config.userDataDir,"junction");
    await assert.rejects(assertWarehouseBrowserDirectory(config,root),/DEDICATED_PROFILE/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["货品ID", "货品名称", "货品编码", "仓名称", "实仓可销", "实仓总数", "良品可用", "良品占用", "销售占用", "残次总量", "采购在途", "调拨在途"], ["001", "sample", "SKU-1", "sample-warehouse", 3, 4, 3, 0, 0, 1, 0, 0]]), "导出数据");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
async function fixture(run: (o: Parameters<typeof planTmallWarehouse>[0], p: WarehousePlan) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tmall-warehouse-test-"));
  const config = { enabled: true, owner: "sample-owner", executablePath: process.execPath, userDataDir: path.join(root, ".runtime", "tmall-warehouse-browser"), profileName: "Default", baseUrl: "http://localhost:31998" };
  const o = { root, executionId: "test-execution", config, request: (async () => Response.json({ success: true, data: { scopeRevisions: { "sample-owner": 7 } } })) as typeof fetch };
  try { await run(o, await planTmallWarehouse(o)); } finally { await rm(root, { recursive: true, force: true }); }
}
test("durable export intent blocks new execution and click replay after unknown download", async () => fixture(async (o,p) => {
  let clicks = 0;
  const exporter = async (args: Parameters<NonNullable<Parameters<typeof runTmallWarehouse>[1]["exporter"]>>[0]): Promise<never> => { await args.beforeClick(1); clicks++; throw new Error("UNKNOWN_DOWNLOAD"); };
  await assert.rejects(runTmallWarehouse(p, { ...o, exporter }), /UNKNOWN_DOWNLOAD/);
  await assert.rejects(runTmallWarehouse(p, { ...o, exporter }), /REPLAY/);
  await assert.rejects(planTmallWarehouse({ ...o, executionId: "replacement" }), /UNRESOLVED/);
  assert.equal(clicks, 1);
  const stored = JSON.parse(await readFile(path.join(o.root,"outputs/tmall-warehouse/active.json"),"utf8")); assert.equal(stored.stage,"export_intent");
}));
test("signed file plus exact completed batch closes; wrong owner/hash/current batch fails", async () => fixture(async (o,p) => {
  const bytes = workbook(); let writes = 0; let current = true;
  const receipt = { id: "batch-test", batchId: "batch-test", owner: o.config!.owner, snapshotDate: warehouseDay(), rowCount: 1, rawFileHash: warehouseHash(bytes), contentHash: "b".repeat(64), status: "completed", isCurrent: true };
  const request = (async (_url: unknown, init?: RequestInit) => { if (init?.method === "POST") { writes++; const b = JSON.parse(String(init.body)); assert.equal(b.expectedScopeRevision,7); assert.equal(b.collectedAt.slice(0,10), new Date().toISOString().slice(0,10)); assert.equal(b.sourceAsOf, ""); return Response.json({ success: true, data: receipt }); } return Response.json({success: true, data:{items:[{...receipt,isCurrent:current}]}}); }) as typeof fetch;
  await runTmallWarehouse(p,{...o, request, exporter: async args => {
    await args.beforeClick(1); const filePath=path.join(o.root,"outputs/tmall-warehouse/downloads",p.runId,"source.xlsx"); await mkdir(path.dirname(filePath),{recursive:true}); await writeFile(filePath,bytes);
    return { filePath, fileName:"isc-hf-biz-workbench_sample.xlsx", rawFileHash:warehouseHash(bytes),bytes:bytes.length,collectedAt:new Date().toISOString(),snapshotDate:warehouseDay(),expectedRowCount:1,owner:o.config!.owner };
  }});
  current = false; await assert.rejects(verifyTmallWarehouse(p,{...o,request}), /BATCH_VERIFICATION/);
  current = true; assert.equal((await verifyTmallWarehouse(p,{...o,request})).stage,"completed");
  assert.equal(writes,1);
}));
test("workflow draft keeps full A/B/C ownership and releases on failure without notifications/retry", async () => {
  const w=JSON.parse(await readFile(new URL("../automation/n8n/tmall-warehouse-daily.workflow.json",import.meta.url),"utf8"));
  assert.equal(w.id,"TmallWarehouseDaily2026"); assert.equal(w.active,false); assert.equal(w.settings.timezone,"Asia/Shanghai");
  assert.equal(w.settings.errorWorkflow,undefined);
  const urls=w.nodes.flatMap((n:{parameters:{url?:string}})=>n.parameters.url?[n.parameters.url]:[]);
  for(const stage of ["plan","run","verify","release"]) assert.ok(urls.includes(`http://127.0.0.1:5791/tmall-warehouse/${stage}`));
  assert.ok(!urls.some((u:string)=>/notify|promotion|product-master/.test(u)));
});
test("unknown import never sends another POST or allows a replacement execution", async () => fixture(async (o,p) => {
  const bytes = workbook(); let posts = 0;
  const request = (async () => { posts++; throw new Error("connection lost after server may have committed"); }) as typeof fetch;
  await assert.rejects(runTmallWarehouse(p,{...o,request,exporter:async args=>{
    await args.beforeClick(1); const filePath=path.join(o.root,"outputs/tmall-warehouse/downloads",p.runId,"source.xlsx"); await mkdir(path.dirname(filePath),{recursive:true}); await writeFile(filePath,bytes);
    return {filePath,fileName:"isc-hf-biz-workbench_sample.xlsx",rawFileHash:warehouseHash(bytes),bytes:bytes.length,collectedAt:new Date().toISOString(),snapshotDate:warehouseDay(),expectedRowCount:1,owner:o.config!.owner};
  }}),/IMPORT_RESULT_UNKNOWN/);
  await assert.rejects(runTmallWarehouse(p,{...o,request}),/REPLAY/);
  await assert.rejects(planTmallWarehouse({...o,executionId:"next"}),/UNRESOLVED/);
  assert.equal(posts,1);
  assert.equal(JSON.parse(await readFile(path.join(o.root,"outputs/tmall-warehouse/active.json"),"utf8")).stage,"import_intent");
}));
test("duplicate closes only with exact attempt and the referenced current published content", async () => fixture(async (o,p) => {
  const bytes=workbook(); let publishedCurrent=false;
  const attempt={id:"duplicate-attempt",batchId:"duplicate-attempt",owner:o.config!.owner,snapshotDate:warehouseDay(),rowCount:1,rawFileHash:warehouseHash(bytes),contentHash:"a".repeat(64),status:"duplicate",referenceBatchId:"published-original",isCurrent:false};
  const request=(async (url:unknown,init?:RequestInit)=>{
    if(init?.method==="POST")return Response.json({success:true,data:attempt});
    const id=new URL(String(url)).searchParams.get("batchId");
    return Response.json({success:true,data:{items:[id==="duplicate-attempt"?attempt:{...attempt,id:"published-original",status:"completed",isCurrent:publishedCurrent,rawFileHash:"c".repeat(64)}]}});
  }) as typeof fetch;
  await runTmallWarehouse(p,{...o,request,exporter:async args=>{
    await args.beforeClick(1);const filePath=path.join(o.root,"outputs/tmall-warehouse/downloads",p.runId,"source.xlsx");await mkdir(path.dirname(filePath),{recursive:true});await writeFile(filePath,bytes);
    return {filePath,fileName:"isc-hf-biz-workbench_sample.xlsx",rawFileHash:warehouseHash(bytes),bytes:bytes.length,collectedAt:new Date().toISOString(),snapshotDate:warehouseDay(),expectedRowCount:1,owner:o.config!.owner};
  }});
  await assert.rejects(verifyTmallWarehouse(p,{...o,request}),/REFERENCE_NOT_CURRENT/);
  publishedCurrent=true;assert.equal((await verifyTmallWarehouse(p,{...o,request})).stage,"completed");
}));
