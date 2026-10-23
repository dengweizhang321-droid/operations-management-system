const fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const candidate='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T034516Z-f308beaede528df7';
const H=x=>createHash('sha256').update(x).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>H(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v));
const source={batch:sync.readFileSync(candidate+'/tools/release-batch.mjs','utf8'),observer:sync.readFileSync(candidate+'/tools/release-no-data-observation.mjs','utf8'),impact:sync.readFileSync(candidate+'/tools/release-impact.mjs','utf8')};
const sourceSha256=Object.fromEntries(Object.entries(source).map(([k,v])=>[k,H(Buffer.from(v))]));
let temp;
function privatePath(p){const a=path.resolve(p);assert.ok(a===temp||a.startsWith(temp+path.sep),'Only reviewer private temp may be written/read');return a;}
async function cleanup(){if(!temp)return;const a=path.resolve(temp);assert.equal(path.dirname(a),path.resolve(os.tmpdir()));assert.ok(path.basename(a).startsWith('teruisi-c-coverage-independent-'));const s=await fs.lstat(a);assert.ok(s.isDirectory()&&!s.isSymbolicLink());await fs.rm(a,{recursive:true,force:false});temp=null;}
(async()=>{
  const started=performance.now(),results=[];
  temp=path.resolve(await fs.mkdtemp(path.join(os.tmpdir(),'teruisi-c-coverage-independent-')));
  const io={lstat:fs.lstat},context={path,Buffer,Map,Error,canonical,hash,io,
    mkdir:async p=>fs.mkdir(privatePath(p)),open:async(p,flags)=>{assert.equal(flags,'wx');return fs.open(privatePath(p),flags);},
    readdir:async p=>fs.readdir(privatePath(p)),safeRead:async p=>fs.readFile(privatePath(p))};
  const begin=source.batch.indexOf('export async function writeOnce('),end=source.batch.indexOf('\nasync function append(',begin);assert.ok(begin>=0&&end>begin);
  let journalCode=source.batch.slice(begin,end).replace(/^export /gm,'');
  const builtinImports=(journalCode.match(/await import\('node:fs\/promises'\)/g)||[]).length;assert.equal(builtinImports,2);
  journalCode=journalCode.replaceAll("await import('node:fs/promises')",'io');
  const journal=vm.runInNewContext(journalCode+';({writeOnce,journalState})',context);
  const oStart=source.observer.indexOf('export async function runNoDataObservation('),oEnd=source.observer.indexOf('\nasync function performNoDataObservation(',oStart);assert.ok(oStart>=0&&oEnd>oStart);
  let observerCode=source.observer.slice(oStart,oEnd).replace(/^export /,'');
  assert.ok(observerCode.includes("const {writeOnce}=await import('./release-batch.mjs');"));
  observerCode=observerCode.replace("const {writeOnce}=await import('./release-batch.mjs');",'const {writeOnce}=observerDependencies;');
  const validationStart=source.observer.indexOf('function exactKeys('),validationEnd=source.observer.indexOf('\n// Explicit dependency seam',validationStart);assert.ok(validationStart>=0&&validationEnd>validationStart);
  const validationCode=source.observer.slice(validationStart,validationEnd).replace(/^export /gm,'');
  const observe=vm.runInNewContext(validationCode+'\n'+observerCode+';((batch,state)=>runNoDataObservation({id:"op-observe",kind:"no-data-observation",mutating:false,phase:"acceptance",covers:["permissions"],observation:{action:"permissions"}},{batch,state}))',{path,assert,hash,randomUUID,Date,Error,
    observerDependencies:{writeOnce:journal.writeOnce},performNoDataObservation:async()=>({status:'completed',syntheticOnly:true})});
  const batch={id:'coverage-batch-0001',batchSha256:'a'.repeat(64)},root=path.join(temp,'journal'),initial=await journal.journalState(root,batch);
  assert.equal(initial.events.length,0);
  const result=await observe(batch,initial);
  assert.equal(result.status,'passed');assert.ok(result.outputs.observationDirectory.startsWith(initial.dir+path.sep+'observations'+path.sep));
  assert.deepEqual(await fs.readdir(initial.dir),['observations']);
  await assert.rejects(journal.journalState(root,batch),e=>e.message==='Broken phase journal sequence');
  results.push({case:'Actual candidate observation receipt writes inside WAL directory',observerReturned:'passed',privateCreateOnlyFsyncReceipts:2,journalReopenRejected:'Broken phase journal sequence',productionActions:0});
  const rStart=source.impact.indexOf('export function backupReuseDecision('),rEnd=source.impact.indexOf('\nexport async function readSourceTree(',rStart);assert.ok(rStart>=0&&rEnd>rStart);
  const reuse=vm.runInNewContext(source.impact.slice(rStart,rEnd).replace(/^export /,'')+';backupReuseDecision',{Date,Number,hash,backupMaxAgeMs:26*60*60*1000,rehearsalMaxAgeMs:7*24*60*60*1000});
  const now=1800000000000,h='b'.repeat(64),fields=Object.fromEntries(['manifestSha256','dumpSha256','environmentSha256','schemaSha256','rolesSha256','operatorSha256','retentionSha256','scheduleSha256'].map(k=>[k,h]));
  const evidence={...fields,backupId:'isolated-point',version:'teruisi-release-recovery-evidence-v1',backupCompletedAt:new Date(now-1000).toISOString(),restoredAt:new Date(now-2000).toISOString(),restoreStatus:'passed',cleanupStatus:'passed',contentEqual:true,rolesEqual:true,permissionsEqual:true,migrationsEqual:true,sequencesValid:true};
  const current={...fields,backupId:'isolated-point',pointExists:true,verifyStatus:'passed',retained:true,sequencesValid:true,softwareCompatible:true,schedule:{active:true,lastResult:'success',lastSuccessAt:new Date(now-1000).toISOString()}};
  const unknown=structuredClone(current);Object.assign(unknown.schedule,{lastResult:'unknown',lastSuccessAt:null,wrapperLastResult:'success',latestAttemptCoverageVerified:false});
  const unknownDecision=reuse({impact:{level:'display'},evidence,current:unknown,now});assert.equal(unknownDecision.mode,'full');assert.ok(unknownDecision.reasons.includes('daily-backup-not-continuous'));
  results.push({case:'Unproven latest scheduler result cannot inherit old wrapper success',mode:'full'});
  const future=structuredClone(current);future.schedule.lastSuccessAt=new Date(now+1).toISOString();assert.equal(reuse({impact:{level:'display'},evidence,current:future,now}).mode,'full');
  results.push({case:'Future scheduler success time cannot qualify display recovery reuse',mode:'full'});
  for(const[k,file]of[['batch','release-batch.mjs'],['observer','release-no-data-observation.mjs'],['impact','release-impact.mjs']])assert.equal(sourceSha256[k],H(sync.readFileSync(candidate+'/tools/'+file)));
  await cleanup();
  console.log(JSON.stringify({independent:true,sourceSha256,sourceStable:true,checks:3,expectedReviewerAssertionsPassed:3,observerWalGapReproduced:true,recoveryNegativeChecks:2,productionImports:0,productionActions:0,nativeChildren:0,networkRequests:0,tempRemoved:true,elapsedMs:performance.now()-started,results},null,2));
})().catch(async e=>{try{await cleanup();}catch{}console.error(JSON.stringify({status:'rejected',errorType:e.name==='AssertionError'?'AssertionError':'Error',messageSha256:H(String(e.message))}));process.exitCode=1;});
