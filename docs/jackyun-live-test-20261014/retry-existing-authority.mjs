import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import path from 'node:path';
const out='D:/codex-artifacts/jackyun-live-test-20261014';
const rows=JSON.parse(await fs.readFile(out+'/existing-human-authority.json','utf8'));
assert.equal(rows.length,1);const receipt=rows[0],authority=receipt.authority;
assert.equal(receipt.status,'completed');assert.equal(receipt.responseStatus,200);
assert.equal(authority.authorizationId,receipt.requestId);assert.equal(authority.logicalExecutionId,'8548');assert.equal(authority.failedExecutionId,'8548');assert.equal(authority.kind,'retry');assert(Date.parse(authority.expiresAt)>Date.now());
const base='http://localhost:3000';
const response=await fetch(base+'/api/imports/recovery/run?'+new URLSearchParams({authorizationId:receipt.requestId}),{redirect:'error',signal:AbortSignal.timeout(20000)});
const body=await response.json();
assert.equal(response.status,200,'Published authority GET must work before dispatch');assert.deepEqual(body,authority);
if(process.argv[2]==='check'){
 await fs.writeFile(out+'/authority-get-after-publish.json',JSON.stringify({status:response.status,exactOriginalAuthority:true,at:new Date().toISOString()}),{flag:'wx'});
 console.log(JSON.stringify({status:'authority_read_passed',exactOriginalAuthority:true}));
}else if(process.argv[2]==='dispatch'){
 const db=new DatabaseSync(path.join(homedir(),'.n8n/database.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare("SELECT count(*) AS n FROM execution_entity WHERE workflowId=? AND status IN ('running','waiting','new') AND deletedAt IS NULL").get('J8kY2mQ5vR7sT4pN').n,0,'Original business workflow has an owner');}finally{db.close();}
 // Exact original request ID and original body; this is the same public POST as the UI.
 // The server and helper retain authority, intent, lock, and unknown-result semantics.
 await fs.writeFile(out+'/original-human-dispatch-started.json',JSON.stringify({at:new Date().toISOString(),requestId:receipt.requestId,logicalExecutionId:'8548'}),{flag:'wx'});
 const result=await fetch(base+'/api/imports/recovery/run',{method:'POST',redirect:'error',headers:{'content-type':'application/json','origin':base,'x-teruisi-recovery-request-id':receipt.requestId},body:JSON.stringify({kind:'retry',logicalExecutionId:'8548',failedExecutionId:'8548'}),signal:AbortSignal.timeout(30000)});
 const payload=await result.json();
 await fs.writeFile(out+'/original-human-dispatch-result.json',JSON.stringify({httpStatus:result.status,body:payload,at:new Date().toISOString()}),{flag:'wx'});
 console.log(JSON.stringify({httpStatus:result.status,ok:payload.ok,dispatchStatus:payload.dispatchStatus,error:payload.error??payload.message??null}));
 if(!result.ok||payload.ok!==true)process.exitCode=1;
}else throw Error('Use check or dispatch');
