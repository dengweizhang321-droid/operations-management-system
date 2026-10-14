import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {assertClosedPreflight} from '../../lib/jackyun/preflight-recovery.ts';
import {readRecoveryControl,controlDigest} from '../../lib/jackyun/recovery-control.ts';
const out='D:/codex-artifacts/jackyun-live-test-20261014',root='D:/运营管理系统',base=path.join(root,'outputs/jackyun-export-first');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const require=createRequire(path.join(process.env.APPDATA,'npm/node_modules/n8n/package.json')),{parse}=require('flatted');
const control=await readRecoveryControl(root,'8548');assert(control);
assert.equal(control.record.sourceExecutionId,'8956');assert.equal(control.record.attemptExecutionId,'8956');assert.equal(control.record.decision,'collect');
const reservation=await read(path.join(base,'collection-reservations/8548/8956.json'));
assert.equal(controlDigest(reservation),control.record.proofDigest);assert.equal(reservation.previousExecutionId,'8548');
const planBytes=await fs.readFile(path.join(base,'n8n-export-first-8956.json')),plan=JSON.parse(planBytes);
assert.equal(sha(planBytes),reservation.newPlanSha256);assert.equal(plan.phase,'exporting');assert.deepEqual(plan.exports,{});assert.equal(plan.exportIntent,undefined);
const active=await read(path.join(base,'active.json'));assert.equal(active.executionId,'8548');
await assertClosedPreflight(root,'8548','8956');
const absent=[path.join(root,'outputs/jackyun-browser-events/n8n-export-first-8956'),path.join(root,'outputs/jackyun-import-runs/n8n-export-first-8956'),path.join(root,'outputs/jackyun-export-first-validation/n8n-export-first-8956'),'D:/谷歌浏览器/jackyun/n8n-export-first-8956'];
for(const p of absent){try{await fs.lstat(p);throw Error('Business evidence appeared: '+p);}catch(error){if(error.code!=='ENOENT')throw error;}}
const db=new DatabaseSync(path.join(homedir(),'.n8n/database.sqlite'),{readOnly:true});let execution,dataDigest;
try{
 db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
 execution=db.prepare('SELECT id,workflowId,status,startedAt,stoppedAt,retrySuccessId FROM execution_entity WHERE id=? AND deletedAt IS NULL').get(8956);
 assert.equal(execution.workflowId,'J8kY2mQ5vR7sT4pN');assert.equal(execution.status,'error');assert.equal(execution.retrySuccessId,null);
 assert.equal(db.prepare("SELECT count(*) AS n FROM execution_entity WHERE workflowId=? AND status IN ('running','waiting','new') AND deletedAt IS NULL").get(execution.workflowId).n,0);
 const row=db.prepare('SELECT data FROM execution_data WHERE executionId=8956').get(),data=parse(row.data);dataDigest=sha(row.data);
 assert.equal(data.resultData.lastNodeExecuted,'A·固定采集日和销售日期');
 assert.match(data.resultData.error.description,/JACKYUN_RECORD_PUBLISH_MANUAL_ACTION/);
 assert(Object.keys(data.resultData.runData).every(n=>['失败后每小时安全重试入口','固定原执行计划时间','领取共享 helper','helper 领取成功？','A·固定采集日和销售日期'].includes(n)));
}finally{db.close();}
const response=await fetch('http://localhost:3000/api/imports/recovery/run',{redirect:'error',signal:AbortSignal.timeout(15000)});
assert.equal(response.status,200);const target=await response.json();assert.equal(target.logicalExecutionId,'8548');assert.equal(target.failedExecutionId,'8956');assert.equal(target.sourceExecutionId,'8956');assert.equal(target.state,'failed');
const proof={at:new Date().toISOString(),execution,dataDigest,controlDigest:control.digest,reservationDigest:control.record.proofDigest,newPlanSha256:sha(planBytes),legacyClosureValidated:true,absentPaths:absent,target};
if(process.argv[2]==='inspect'){
 await fs.writeFile(out+'/8956-zero-business-reservation-proof.json',JSON.stringify(proof,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'verified_A_only_interruption',logicalExecutionId:'8548',failedExecutionId:'8956',businessEffects:0,reservationPreserved:true}));
}else if(process.argv[2]==='dispatch'){
 const adopted=await read(out+'/unbound-helper-adoption/publication-result.json');assert.equal(adopted.status,'deployed');
 const {resolveEffectiveReleaseChain}=await import(pathToFileURL('D:/codex-isolated/jackyun-unbound-closure-source-20261014/tools/worker-local-release-rotation.mjs'));
 const chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(chain.head.releaseId,adopted.candidateReleaseId);assert.equal(chain.head.manifestSha256,adopted.candidateManifestSha256);
 const requestId=randomUUID();
 await fs.writeFile(out+'/resumed-human-dispatch-started.json',JSON.stringify({at:new Date().toISOString(),requestId,logicalExecutionId:'8548',failedExecutionId:'8956',proof}),{flag:'wx'});
 const result=await fetch('http://localhost:3000/api/imports/recovery/run',{method:'POST',redirect:'error',headers:{'content-type':'application/json',origin:'http://localhost:3000','x-teruisi-recovery-request-id':requestId},body:JSON.stringify({kind:'retry',logicalExecutionId:'8548',failedExecutionId:'8956'}),signal:AbortSignal.timeout(30000)});
 const payload=await result.json();await fs.writeFile(out+'/resumed-human-dispatch-result.json',JSON.stringify({httpStatus:result.status,body:payload,at:new Date().toISOString()}),{flag:'wx'});
 console.log(JSON.stringify({httpStatus:result.status,ok:payload.ok,dispatchStatus:payload.dispatchStatus,error:payload.error??payload.message??null}));
 if(!result.ok||payload.ok!==true)process.exitCode=1;
}else throw Error('Use inspect or dispatch');
