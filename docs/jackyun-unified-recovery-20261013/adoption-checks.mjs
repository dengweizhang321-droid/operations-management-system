// Read-only production postconditions. No import, retry, workflow update or service action.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {runAdapter} from '../release-integration-review/batch-v2/adapter.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export function classifyPublication(expected,actual) {
 assert.equal(actual.id,expected.id);assert.equal(actual.active,true);assert.equal(actual.pinDataEmpty,true);assert.equal(actual.running,0);
 if(canonical(actual.definition)===canonical(expected.after)&&actual.activeVersionId!==expected.beforeVersionId)return 'published';
 assert.equal(actual.activeVersionId,expected.beforeVersionId,'Published predecessor changed outside this exact update');
 assert.equal(canonical(actual.definition.nodes),canonical(expected.before.nodes),'Published nodes drifted');
 assert.equal(canonical(actual.definition.connections),canonical(expected.before.connections),'Published connections drifted');
 assert.ok([canonical(expected.before.settings),canonical(expected.after.settings)].includes(canonical(actual.definition.settings)),'Settings outside the exact approved update');
 return 'pending';
}
export async function inspectBusiness(request) {
  const routes=['/api/imports/erp?source=products&page=1&pageSize=1','/api/imports/erp?source=inventory_age&page=1&pageSize=1','/api/imports/erp?source=combos&page=1&pageSize=1','/api/imports/inventory?page=1&pageSize=1','/api/imports/sales?page=1&pageSize=1'];
  const observations=[];
  for(const route of routes){const r=await request(3000,route);assert.equal(r.status,200);const body=JSON.parse(r.text);assert.ok(Array.isArray(body.items));assert.ok(body.items.length<=1);observations.push({route,status:200,rows:body.items.length,sha256:sha(r.text)});}
  const target=await request(3000,'/api/imports/recovery/run');assert.equal(target.status,200);const body=JSON.parse(target.text);
  assert.equal(body.ok,true);assert.equal(typeof body.state,'string');assert.equal(typeof body.newCollectionAllowed,'boolean');
  return {status:'passed',productionWrites:0,fiveAuthorityReadersAvailable:true,recoveryTargetReadable:true,targetState:body.state,observations,businessReplayPerformed:false};
}
export async function inspectPermissions(request) {
  for(const port of [8091,8092]){const r=await request(port,'/api/erp-reference/imports?source=products&page=1&pageSize=1');assert.equal(r.status,401);}
  for(const [port,route] of [[3000,'/api/imports/recovery/run?unexpected=1'],[5791,'/coordination/jackyun-recovery-target?logicalExecutionId=bad'],[5791,'/coordination/jackyun-recovery-target?logicalExecutionId=8548&logicalExecutionId=8555']])assert.equal((await request(port,route)).status,400);
  return {status:'passed',unsignedBackendDenied:true,malformedIdentityDenied:true,productionWrites:0,productionNonAdminSessionTestPerformed:false};
}
async function main(){
 const [action,configPath]=process.argv.slice(2),h=JSON.parse(await readFile(configPath));
 assert.equal(h.version,'jackyun-adoption-checks-v1');
 const {safeRead,safeFileDigest}=await import(pathToFileURL(path.join(h.engineRoot,'tools/release-impact.mjs')));
 assert.equal(await safeFileDigest('D:/teruisi-runtime/django-sales/app/deployment.json'),h.djangoManifestSha256);
 const request=async(port,route)=>{assert.ok([3000,5791,8091,8092].includes(port));assert.ok(route.startsWith('/')&&!route.includes('://'));const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000)});const text=await r.text();assert.ok(Buffer.byteLength(text)<=1024*1024);return {status:r.status,text};};
 let result;
 if(action==='business')result=await inspectBusiness(request);
 else if(action==='permissions')result=await inspectPermissions(request);
 else if(action==='resources'){
   const resources=JSON.parse(await readFile(h.resourceInventory));let count=0;
   for(const [uri,digest] of Object.entries(resources)){assert.match(uri,/^\/[A-Za-z0-9_./-]+$/);assert.ok(!uri.includes('..'));const r=await fetch('http://127.0.0.1:3000'+uri,{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),digest);count++;}
   assert.ok(count>0);result={status:'passed',resourcesVerified:count,productionWrites:0};
 }else if(action==='migrations'){
   const {runProcess}=await import(pathToFileURL(path.join(h.engineRoot,'tools/worker-local-release.mjs')));
   const root='D:/teruisi-runtime/django-sales';
   const r=await runProcess(root+'/venv/Scripts/python.exe',[root+'/app/tools/jackyun_audit_addition.py','release','--root',root+'/app','--runtime',root],{label:'Read-only finalized audit generation',timeoutMs:120000});
   const p=JSON.parse(r.stdout);assert.equal(p.status,'verified');assert.equal(p.result.migrationCount,142);assert.deepEqual(p.result.beforeRows,p.result.afterRows);
   result={status:'passed',migrationCount:142,oldAuditRowsPreserved:true,productionBusinessWrites:0,receiptSha256:sha(r.stdout)};
 }else if(action==='n8n-publication'){
   // The approved operator publishes through the existing n8n editor while
   // this step observes. Saving a draft is insufficient; this never writes SQLite.
   const expected=JSON.parse(await readFile(h.n8nProposal)),deadline=Date.now()+540000,observations=[];
   assert.deepEqual(expected.map(x=>x.id).sort(),['J8kY2mQ5vR7sT4pN','TeruisiHourlyRetry2026'].sort());
   while(true){
     const db=new DatabaseSync(path.join(homedir(),'.n8n/database.sqlite'),{readOnly:true});let states;const sample=[];
     try{
       db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
       states=expected.map(e=>{
         const w=db.prepare('SELECT id,active,activeVersionId,settings,pinData FROM workflow_entity WHERE id=?').get(e.id);assert.ok(w);
         const published=db.prepare('SELECT nodes,connections FROM workflow_history WHERE workflowId=? AND versionId=?').get(e.id,w.activeVersionId);assert.ok(published);
         const definition={nodes:JSON.parse(published.nodes),connections:JSON.parse(published.connections),settings:JSON.parse(w.settings??'{}')};
         const running=db.prepare("SELECT count(*) AS n FROM execution_entity WHERE workflowId=? AND status IN ('running','waiting','new') AND deletedAt IS NULL").get(e.id).n;
         sample.push({id:e.id,active:!!w.active,activeVersionId:w.activeVersionId,running,definitionSha256:sha(canonical(definition))});
         const state=classifyPublication(e,{id:e.id,active:!!w.active,activeVersionId:w.activeVersionId,pinDataEmpty:Object.keys(JSON.parse(w.pinData??'{}')).length===0,running,definition});
         return {id:e.id,state,activeVersionId:w.activeVersionId,definitionSha256:sha(canonical(definition))};
       });
     }catch(error){await writeFile(path.join(h.observationRoot,'n8n-publication-failure.json'),JSON.stringify({status:'failed',observations,sample}),{flag:'wx'});throw error;}finally{db.close();}
     observations.push({at:new Date().toISOString(),states});
     if(states.every(s=>s.state==='published')){result={status:'passed',exactPublishedWorkflows:2,observations,observerDatabaseWrites:0};break;}
     if(Date.now()>=deadline){await writeFile(path.join(h.observationRoot,'n8n-publication-pending.json'),JSON.stringify(observations),{flag:'wx'});throw Error('Publication not confirmed; retain maintenance');}
     await new Promise(resolve=>setTimeout(resolve,5000));
   }
 }else if(action==='natural-watchdog'){
   result=await runAdapter(action,{root:h.observationRoot,h:{workerPlan:{candidateReleaseId:h.candidateReleaseId}},safeRead,digestFile:safeFileDigest});
 }else throw Error('Unknown read-only acceptance');
 await writeFile(path.join(h.observationRoot,action+'-result.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Read-only adoption postcondition failed; retain exact batch owner and evidence');process.exitCode=1;});
