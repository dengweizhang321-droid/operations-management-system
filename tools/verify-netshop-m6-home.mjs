/** M6 actual Home harness author. No execution without separate source/corpus pins. */
import assert from "node:assert/strict";
import { readFile,writeFile,mkdir,readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readM6Corpus,sha256 } from "../tests/fixtures/netshop-m6-home/corpus.mjs";
import { runM6Scenarios } from "../tests/fixtures/netshop-m6-home/scenarios.mjs";
const root=process.cwd(),git=(...a)=>execFileSync("git",a,{cwd:root,encoding:"utf8"}).trim();
const manifestPath=resolve(process.env.NETSHOP_M6_CORPUS_MANIFEST||"tests/fixtures/netshop-m6-home/manifest-stage-c22-c9.json");
const corpus=await readM6Corpus(manifestPath);
if(process.argv.includes("--inspect-corpus")){
 process.stdout.write(JSON.stringify({schema:corpus.manifest.schemaVersion,manifestSHA256:corpus.manifestSHA256,finalCorpus:corpus.manifest.finalCorpus,records:corpus.records.map(r=>({name:r.name,phase:r.phase,seed:r.seed||null,bytes:r.bytes,sha256:r.sha256,originalQuery:r.query,header:r.owningRevision,rawMeaning:r.rawMeaning})),staticOnly:true,noBuildOrBrowser:true})+"\n");process.exit(0);
}
const sourcePin=process.env.NETSHOP_M6_SOURCE_PIN,corpusPin=process.env.NETSHOP_M6_CORPUS_SHA256;
assert.match(sourcePin||"",/^[a-f0-9]{40}$/,"Root clean final source SHA must be supplied; no implicit WIP execution");
assert.equal(corpusPin,corpus.manifestSHA256,"Independent corpus SHA pin must match original file");
assert.equal(git("status","--porcelain"),"","Run in clean final Root M6 tree, not RootI WIP");
const additions=git("diff","--name-only",sourcePin,"HEAD").split("\n").filter(Boolean);
assert.ok(additions.every(p=>p==="tools/verify-netshop-m6-home.mjs"||p.startsWith("tests/fixtures/netshop-m6-home/")||p.startsWith("docs/netshop-refactor/reviews/")),"Source pin may differ only by explicit new tool/evidence files");
assert.equal(corpus.manifest.finalCorpus,true,"C22/early C9 corpus is phase evidence, not final M6 API acceptance");
assert.ok(corpus.records.filter(r=>r.kind==="comparison").every(r=>r.finalAcceptance===true&&r.apiLayer==="signed-owning-api"&&r.seed),"Final comparison needs real API layer and same-seed provenance, not old function captures");
const {build}=await import("esbuild"),{chromium}=await import("playwright-core");
const parent=resolve(process.env.NETSHOP_M6_UI_EVIDENCE_ROOT||"E:/codex-artifacts/netshop-scheme2-20261001/m6-home");assert.match(parent,/^E:[\\/]/i);
const runId=new Date().toISOString().replace(/[-:.]/g,"")+"-"+randomUUID(),evidence=resolve(parent,runId),runtime=resolve(evidence,"browser");
await mkdir(parent,{recursive:true});await mkdir(evidence);await mkdir(runtime);
const save=(name,v)=>writeFile(resolve(evidence,name),typeof v==="string"?v:JSON.stringify(v,null,2),{flag:"wx"});
const source={head:git("rev-parse","HEAD"),sourcePin,corpusPin,root,runId,role:process.env.NETSHOP_M6_UI_ROLE||"I-tool-author",syntheticOnly:true};
await save("source-before.json",source);await save("corpus.json",{manifest:corpus.manifest,records:corpus.records.map(r=>({...Object.fromEntries(Object.entries(r).filter(([k])=>!["body","raw"].includes(k))),bodyIncludedInBundle:true,rawBytesPreserved:true}))});
const layout=await readFile(resolve(root,"app/layout.tsx"),"utf8"),styles=[...layout.matchAll(/^import ["'](\.\/[^"']+\.css)["'];/gm)].map(m=>"app/"+m[1].slice(2));
assert.deepEqual(styles,["app/globals.css","app/shell/top-navigation.css","app/styles/shared-theme.css"]);assert.match(layout,/<html lang="zh-CN">\s*<body>/);
const payload=corpus.records.map(r=>({name:r.name,kind:r.kind,status:r.status,headers:r.headers,phase:r.phase,seed:r.seed,query:r.query,owningRevision:r.owningRevision,raw:r.raw,sha256:r.sha256,rawMeaning:r.rawMeaning,finalAcceptance:r.finalAcceptance}));
const entry=styles.map(p=>"import '@/"+p+"';").join("\n")+
"\nimport React from 'react';import {createRoot} from 'react-dom/client';import Home from '@/app/page';import {installM6Transport} from '@/tests/fixtures/netshop-m6-home/bootstrap.mjs';"+
"import {netshopColumnModules as m} from '@/app/netshop/shared/module-slots';"+
"await installM6Transport("+JSON.stringify(payload.filter(r=>r.kind==="comparison"))+","+JSON.stringify(payload.filter(r=>r.kind!=="comparison"))+");"+
"window.__m6Modules={comparison:!!m.platforms,panorama:!!m.analysis,products:!!m.products,promotion:!!m.promotion};createRoot(document.body).render(<Home/>);";
const checks=[],errors=[],blocked=[];let browser,server,page,origin,inputs=[];
const check=async(name,fn)=>{await fn();checks.push(name);process.stdout.write("PASS "+name+"\n");};
try{
 const compiled=await build({stdin:{contents:entry,resolveDir:root,sourcefile:"m6-entry.jsx",loader:"jsx"},bundle:true,outfile:resolve(runtime,"ui.js"),platform:"browser",format:"esm",jsx:"automatic",conditions:["style"],define:{"process.env.NODE_ENV":'"development"'},tsconfig:resolve(root,"tsconfig.json"),metafile:true,logLevel:"warning"});
 for(const p of Object.keys(compiled.metafile.inputs)){if(p==="m6-entry.jsx"||p.includes("node_modules"))continue;const b=await readFile(resolve(root,p));inputs.push({path:p,bytes:b.length,sha256:sha256(b)});}
 const l=await readFile(resolve(root,"app/layout.tsx"));inputs.push({path:"app/layout.tsx",bytes:l.length,sha256:sha256(l)});
 await save("compile-source.json",{...source,inputs,layoutWrapper:{html:{lang:"zh-CN"},body:{}},styles,actualHome:true,secondRouter:false});
 server=createServer(async(req,res)=>{const p=new URL(req.url,"http://127.0.0.1").pathname;if(req.method!=="GET"){blocked.push({path:p,method:req.method});res.writeHead(405).end();return;}
 if(["/ui.js","/ui.css"].includes(p)){res.setHeader("content-type",p.endsWith("js")?"text/javascript":"text/css");res.end(await readFile(resolve(runtime,p.slice(1))));return;}
 if(p==="/favicon.ico"){res.writeHead(204).end();return;}if(p!=="/"){blocked.push({path:p,method:req.method});res.writeHead(404).end();return;}
 res.setHeader("content-type","text/html; charset=utf-8");res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><script type="module" src="/ui.js"></script></body></html>');});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));origin="http://127.0.0.1:"+server.address().port;await save("resource-running.json",{pid:process.pid,origin,noProduction:true});
 browser=await chromium.launch({executablePath:process.env.NETSHOP_UI_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:"block"});context.on("page",p=>p.on("pageerror",e=>errors.push(e.message)));
 await context.route("**/*",r=>{if(new URL(r.request().url()).origin===origin)return r.continue();blocked.push({reason:"external",path:new URL(r.request().url()).pathname});return r.abort("blockedbyclient");});
 page=await context.newPage();page.setDefaultTimeout(8000);await page.clock.setFixedTime(new Date("2026-10-01T04:00:00Z"));
 const result=await runM6Scenarios({page,origin,check,save,evidence,records:corpus.records,manifest:corpus.manifest});
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);for(const f of inputs){assert.equal(sha256(await readFile(resolve(root,f.path))),f.sha256);}assert.equal(git("rev-parse","HEAD"),source.head);
 await save("transport.json",await page.evaluate(()=>window.__m6));await save("result.json",{...source,status:"passed",checks,...result,authorNotIndependentQ:true});
}catch(e){if(page){await save("dom-failed.txt",await page.locator("body").innerText().catch(()=>""));await save("transport-failed.json",await page.evaluate(()=>window.__m6).catch(()=>null));await save("location-failed.json",await page.evaluate(()=>({url:location.href,history:history.state})).catch(()=>null));await page.screenshot({path:resolve(evidence,"failed.png"),fullPage:true}).catch(()=>{});}await save("failure.json",{...source,checks,error:e.message,errors,blocked});throw e;}
finally{if(browser)await browser.close();if(server?.listening)await new Promise((r,j)=>server.close(e=>e?j(e):r()));
 await save("shutdown.json",{browserClosed:true,serverClosed:!server?.listening,pid:process.pid,origin,noProductionProcessesTouched:true});
 await save("source-after.json",{head:git("rev-parse","HEAD"),dirty:git("status","--porcelain"),inputsUnchanged:await Promise.all(inputs.map(async f=>({path:f.path,unchanged:sha256(await readFile(resolve(root,f.path)))===f.sha256})))});
 const entries=[];for(const name of await readdir(evidence)){if(name==="browser")continue;const b=await readFile(resolve(evidence,name));entries.push({name,bytes:b.length,sha256:sha256(b)});}await save("evidence-manifest.json",{entries});
}
