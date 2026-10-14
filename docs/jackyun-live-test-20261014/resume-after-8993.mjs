import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withJackyunRunLock,defaultJackyunRunLockDirectory} from '../../lib/jackyun/run-lock.ts';
import {verifyJackyunBrowserBinding,resolveJackyunChromiumExecutable} from '../../lib/jackyun/dpapi-login.ts';
import {closeChromeBrowser,listChromeTargets} from '../../lib/jackyun/cdp-client.ts';
import {inspectPreflightZeroEffects} from '../../lib/jackyun/preflight-recovery.ts';
const root='D:/运营管理系统',out='D:/codex-artifacts/jackyun-live-test-20261014';
const req=createRequire(path.join(process.env.APPDATA,'npm/node_modules/n8n/package.json')),{parse}=req('flatted');
const write=(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2),{flag:'wx'});
async function inspect(){
 const db=new DatabaseSync(path.join(homedir(),'.n8n/database.sqlite'),{readOnly:true});
 let execution,dataSha256;
 try{
  db.exec('PRAGMA query_only=ON; BEGIN');
  execution=db.prepare('SELECT id,workflowId,status,startedAt,stoppedAt,retrySuccessId FROM execution_entity WHERE id=8993 AND deletedAt IS NULL').get();
  assert.equal(execution.workflowId,'J8kY2mQ5vR7sT4pN');assert.equal(execution.status,'error');assert.equal(execution.retrySuccessId,null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM execution_entity WHERE workflowId=? AND deletedAt IS NULL AND status IN ('running','waiting','new')").get(execution.workflowId).n,0);
  const raw=db.prepare('SELECT data FROM execution_data WHERE executionId=8993').get().data,data=parse(raw);
  assert.equal(data.resultData.lastNodeExecuted,'B·接口校验与五表下载');
  assert.equal(data.resultData.error.description,'waiting_login：专用浏览器端口已占用，自动任务不会接管已打开的浏览器。');
  dataSha256=createHash('sha256').update(raw).digest('hex');
 }finally{db.close();}
 const zeroEffect=await inspectPreflightZeroEffects(root,'8993',new Date().toISOString());
 const r=await fetch('http://localhost:3000/api/imports/recovery/run',{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);
 const target=await r.json();assert.equal(target.state,'failed');assert.equal(target.logicalExecutionId,'8548');assert.equal(target.failedExecutionId,'8993');assert.equal(target.sourceExecutionId,'8993');
 return {at:new Date().toISOString(),execution,dataSha256,zeroEffect,target};
}
async function idle(){const r=await fetch('http://127.0.0.1:5791/health',{signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);const h=await r.json();assert.equal(h.ok,true);assert.equal(h.busy,false);assert.deepEqual(h.storeExecutions,[]);}
if(process.argv[2]==='close-orphan'){
 await withJackyunRunLock({runId:'manual-login-8993',purpose:'close_verified_orphan_before_authorized_retry',lockDirectory:defaultJackyunRunLockDirectory(root)},async lock=>{
  await idle();const proof=await inspect();
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=58748'; if(!$p){throw 'missing'}; $parent=Get-CimInstance Win32_Process -Filter 'ProcessId=23336'; @{pid=$p.ProcessId;parent=$p.ParentProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');parentAbsent=($null -eq $parent)} | ConvertTo-Json -Compress"],{windowsHide:true,timeout:15000});
  const identity=JSON.parse(stdout);assert.equal(identity.pid,58748);assert.equal(identity.parent,23336);assert.equal(identity.parentAbsent,true);assert.equal(Date.parse(identity.created),Date.parse('2026-10-13T00:10:09.178739+08:00'));
  const expected={chromePath:resolveJackyunChromiumExecutable(),profileDirectory:path.join(root,'.runtime/jackyun-chrome-profile'),port:9223,headless:true,processId:58748};
  await verifyJackyunBrowserBinding(expected);
  const targets=await listChromeTargets(9223);assert(targets.some(t=>t.type==='page'&&new URL(t.url).origin==='https://web.jackyun.com'));
  // Chromium also exposes its own omnibox UI targets; these are not business pages.
  assert(targets.every(t=>t.url==='about:blank'||new URL(t.url).origin==='https://web.jackyun.com'||(t.type==='browser_ui'&&['chrome://omnibox-popup.top-chrome/','chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html'].includes(t.url))));
  await write('8993-orphan-close-intent.json',{...proof,identity,targetCount:targets.length});
  await lock.assertOwned();await idle();await verifyJackyunBrowserBinding(expected);
  assert.equal(await closeChromeBrowser(9223),true);
  await write('8993-orphan-close-result.json',{at:new Date().toISOString(),closed:true,pid:58748,port:9223,method:'original_closeChromeBrowser'});
  console.log(JSON.stringify({closed:true,pid:58748,port:9223,zeroBusinessEffects:true}));
 });
}else if(process.argv[2]==='dispatch'){
 const closed=JSON.parse(await fs.readFile(out+'/8993-orphan-close-result.json','utf8'));assert.equal(closed.closed,true);
 const proof=await inspect();await idle();
 const requestId=randomUUID();await write('browser-recovered-dispatch-started.json',{at:new Date().toISOString(),requestId,logicalExecutionId:'8548',failedExecutionId:'8993',proof});
 const r=await fetch('http://localhost:3000/api/imports/recovery/run',{method:'POST',redirect:'error',headers:{'content-type':'application/json',origin:'http://localhost:3000','x-teruisi-recovery-request-id':requestId},body:JSON.stringify({kind:'retry',logicalExecutionId:'8548',failedExecutionId:'8993'}),signal:AbortSignal.timeout(30000)});
 const payload=await r.json();await write('browser-recovered-dispatch-result.json',{at:new Date().toISOString(),httpStatus:r.status,body:payload});
 console.log(JSON.stringify({httpStatus:r.status,ok:payload.ok,dispatchStatus:payload.dispatchStatus,error:payload.error??payload.message??null}));
 assert(r.ok&&payload.ok===true);
}else throw Error('Use close-orphan or dispatch; each mutation is create-only and must not be replayed blindly');
