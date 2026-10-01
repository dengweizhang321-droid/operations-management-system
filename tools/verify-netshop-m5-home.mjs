/** M5 actual Home tool author. Run by another Q for independent review.
 * Never mounts a second router/Prototype, never imports C, no source writes. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { runM5Scenarios } from "../tests/fixtures/netshop-m5-home/scenarios.mjs";

const root=process.cwd(),role=process.env.NETSHOP_M5_UI_ROLE||"I-tool-author";
const runId=new Date().toISOString().replace(/[-:.]/g,"")+"-"+randomUUID();
const parent=resolve(process.env.NETSHOP_M5_UI_EVIDENCE_ROOT||"E:/codex-artifacts/netshop-scheme2-20261001/m5-home");
assert.match(parent,/^E:[\\/]/i,"Explicit external E evidence");
const evidence=resolve(parent,runId),runtime=resolve(evidence,"browser");
await mkdir(parent,{recursive:true});await mkdir(evidence);await mkdir(runtime);
const save=(name,value)=>writeFile(resolve(evidence,name),typeof value==="string"||value instanceof Uint8Array?value:JSON.stringify(value,null,2),{flag:"wx"});
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
const hash=raw=>createHash("sha256").update(raw).digest("hex");
const queryPairs=value=>JSON.stringify([...new URLSearchParams(value)].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv)));
const source={head:git("rev-parse","HEAD"),branch:git("branch","--show-current"),dirty:git("status","--porcelain"),root,role,runId,syntheticTransportOnly:true};
await save("source-before.json",source);
const manifestPath=resolve(process.env.NETSHOP_M5_SOURCE_MANIFEST||"tests/fixtures/netshop-m5-home/manifest.json");
const manifestRaw=await readFile(manifestPath),manifest=JSON.parse(manifestRaw);
assert.equal(manifest.schemaVersion,"netshop-m5-home-source-v1");assert.equal(manifest.syntheticOnly,true);
assert.ok(Array.isArray(manifest.records)&&manifest.records.length>=1&&manifest.records.length<=12);
const records=[],sourceFiles=[];
for(const record of manifest.records){
  assert.match(record.name,/^[a-z0-9-]+$/);assert.ok(Number.isSafeInteger(record.bytes));assert.match(record.sha256,/^[a-f0-9]{64}$/);
  const path=resolve(dirname(manifestPath),record.file),raw=await readFile(path);
  assert.equal(raw.length,record.bytes);assert.equal(hash(raw),record.sha256);
  const body=JSON.parse(raw),scope=body.context.requestedScope,w=body.context.periods.current,t=body.tableScope;
  const query=new URLSearchParams({dimension:scope.dimension,periodKind:scope.periodKind,startDate:w.startDate,endDate:w.endDate});
  scope.platforms.forEach(p=>query.append("platform",p));scope.shopKeys.forEach(s=>query.append("outlet",s));for(const[k,v]of Object.entries(t))query.set(k,String(v));
  const revision=body.context.sourceRevisions.find(r=>r.domain==="netshop"&&r.kind==="owning_revision")?.revision;
  assert.ok(revision);if(record.query)assert.equal(queryPairs(record.query),queryPairs(query));if(record.owningRevision)assert.equal(record.owningRevision,revision);
  records.push({...record,raw:raw.toString("utf8"),query:query.toString(),revision,body});
  sourceFiles.push({name:record.name,path,bytes:raw.length,sha256:hash(raw),query:query.toString(),owningRevision:revision,sourceStatus:Object.fromEntries(Object.entries(body.sources).map(([k,v])=>[k,v.state]))});
}
await save("source-captures.json",{manifestPath,manifestSHA256:hash(manifestRaw),sourceFiles,externalOptIn:!!process.env.NETSHOP_M5_SOURCE_MANIFEST,allOriginalBytesVerified:true});
const layout=await readFile(resolve(root,"app/layout.tsx"),"utf8");
const styles=[...layout.matchAll(/^import ["'](\.\/[^"']+\.css)["'];/gm)].map(m=>"app/"+m[1].slice(2));
assert.deepEqual(styles,["app/globals.css","app/shell/top-navigation.css","app/styles/shared-theme.css"]);
assert.match(layout,/<html lang="zh-CN">\s*<body>/);
const entry=styles.map(p=>"import '@/"+p+"';").join("\n")+
"\nimport React from 'react';import {createRoot} from 'react-dom/client';import Home from '@/app/page';"+
"import {installM5Transport} from '@/tests/fixtures/netshop-m5-home/bootstrap.mjs';"+
"import {netshopColumnModules} from '@/app/netshop/shared/module-slots';"+
"installM5Transport("+JSON.stringify(records.map(r=>({name:r.name,raw:r.raw,sha256:r.sha256,bytes:r.bytes})))+");"+
"window.__m5Modules={panorama:!!netshopColumnModules.analysis,products:!!netshopColumnModules.products,promotion:!!netshopColumnModules.promotion,comparison:!!netshopColumnModules.platforms};"+
"createRoot(document.body).render(<Home/>);";
const checks=[],errors=[],consoleErrors=[],network=[];
let server,browser,page,origin,result,inputs=[];
const check=async(name,fn)=>{await fn();checks.push(name);process.stdout.write("PASS "+name+"\n");};
try{
 const bundled=await build({stdin:{contents:entry,sourcefile:"m5-entry.jsx",resolveDir:root,loader:"jsx"},bundle:true,outfile:resolve(runtime,"ui.js"),format:"esm",platform:"browser",jsx:"automatic",conditions:["style"],define:{"process.env.NODE_ENV":'"development"'},tsconfig:resolve(root,"tsconfig.json"),logLevel:"warning",metafile:true});
 for(const path of Object.keys(bundled.metafile.inputs)){
  if(path.includes("node_modules")||path==="m5-entry.jsx")continue;
  assert.ok(!/app[\\/]netshop[\\/]comparison[\\/]/.test(path),"M5 bundle must not import unmerged C module");
  const raw=await readFile(resolve(root,path));inputs.push({path,bytes:raw.length,sha256:hash(raw)});
 }
 for(const path of ["app/layout.tsx","tools/verify-netshop-m5-home.mjs","tests/fixtures/netshop-m5-home/scenarios.mjs"]){const raw=await readFile(resolve(root,path));inputs.push({path,bytes:raw.length,sha256:hash(raw)});}
 await save("compile-source.json",{...source,inputs,styles,layoutSHA256:hash(Buffer.from(layout)),layoutWrapper:{html:{lang:"zh-CN"},body:{}},compiledC:false,actualHome:true,secondRouter:false,originalCaptureFiles:sourceFiles});
 const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><script type="module" src="/ui.js"></script></body></html>';
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://127.0.0.1").pathname;
  if(req.method!=="GET"){network.push({path,method:req.method,reason:"server-write-blocked"});res.writeHead(405).end();return;}
  if(["/ui.js","/ui.css"].includes(path)){res.setHeader("Content-Type",path.endsWith("js")?"text/javascript":"text/css");res.end(await readFile(resolve(runtime,path.slice(1))));return;}
  if(path==="/favicon.ico"){res.writeHead(204).end();return;}
  if(/^\/api\/netshop\/product-images\/[a-f0-9]{64}$/.test(path)){res.setHeader("Content-Type","image/svg+xml");res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><text x="5" y="30">Synthetic image</text></svg>');return;}
  if(path!=="/"){network.push({path,method:req.method,reason:"server-unknown"});res.writeHead(404).end();return;}
  res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+server.address().port;
 await save("resource-running.json",{pid:process.pid,origin,evidence,status:"running",usesOwnInstalledNpm:true,noProduction:true});
 browser=await chromium.launch({executablePath:process.env.NETSHOP_UI_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:"block"});
 context.on("page",tab=>{tab.on("pageerror",e=>errors.push(e.message));tab.on("console",m=>{if(m.type()==="error"&&!/Failed to load resource/.test(m.text()))consoleErrors.push(m.text());});});
 await context.route("**/*",route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();network.push({path:u.pathname,method:route.request().method(),reason:"external-blocked"});return route.abort("blockedbyclient");});
 page=await context.newPage();page.setDefaultTimeout(8000);await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
 result=await runM5Scenarios({page,origin,check,save,evidence,records});
 await check("Actual compiled source and immutable captures remain byte-identical throughout this run",async()=>{
  assert.equal(git("rev-parse","HEAD"),source.head);
  for(const file of inputs){const raw=await readFile(resolve(root,file.path));assert.equal(hash(raw),file.sha256,file.path);}
  for(const file of sourceFiles){const raw=await readFile(file.path);assert.equal(raw.length,file.bytes);assert.equal(hash(raw),file.sha256,file.path);}
 });
 await check("No ambient external/write/model/unknown transport and no browser runtime error",async()=>{
  const t=await page.evaluate(()=>window.__m5);await save("transport.json",t);
  assert.deepEqual(t.writes.filter(x=>!x.probe),[]);assert.deepEqual(t.models.filter(x=>!x.probe),[]);assert.deepEqual(t.external.filter(x=>!x.probe),[]);assert.deepEqual(t.unknownReads.filter(x=>!x.probe),[]);
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(network,[]);
 });
 await save("result.json",{...source,status:"passed",checks,...result,errors,consoleErrors,network,independentReviewConclusion:null,authorExecution:role.startsWith("I-"),source3BaselineOnly:!process.env.NETSHOP_M5_SOURCE_MANIFEST});
 process.stdout.write(JSON.stringify({evidence,status:"passed",checks:checks.length,head:source.head})+"\n");
}catch(error){
 if(page){await save("dom-failed.txt",await page.locator("body").innerText().catch(()=>""));await save("transport-failed.json",await page.evaluate(()=>window.__m5).catch(()=>null));await page.screenshot({path:resolve(evidence,"failed.png"),fullPage:true}).catch(()=>{});}
 await save("failure.json",{...source,status:"failed",checks,error:error.message,errors,consoleErrors,network});process.stderr.write("Evidence: "+evidence+"\n");throw error;
}finally{
 if(browser)await browser.close();if(server?.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 const after=[];
 for(const file of inputs){const raw=await readFile(resolve(root,file.path));after.push({path:file.path,sha256:hash(raw),unchanged:hash(raw)===file.sha256});}
 await save("source-after.json",{head:git("rev-parse","HEAD"),dirty:git("status","--porcelain"),headUnchanged:source.head===git("rev-parse","HEAD"),compiledInputs:after,compiledInputsUnchanged:after.every(r=>r.unchanged)});
 await save("shutdown.json",{browserClosed:true,serverClosed:!server?.listening,pid:process.pid,origin,noProductionProcessesTouched:true,ownNpmDependenciesRetainedForRootQ:true});
 const names=await readdir(evidence),manifest=[];
 for(const name of names){if(name==="browser")continue;const raw=await readFile(resolve(evidence,name));manifest.push({name,bytes:raw.length,sha256:hash(raw)});}
 await save("evidence-manifest.json",{entries:manifest,syntheticOnly:true});
}
