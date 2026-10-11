const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{fileURLToPath}=require('node:url');
const root='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T075658Z-aed7ddc1be340f5c',E='E:/codex-artifacts/release-first-adoption-targeted-20261011';
const H=x=>createHash('sha256').update(x).digest('hex'),canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const modulePaths=['deployment-manifest.json','tools/release-impact.mjs','tools/release-batch.mjs','tools/release-batch-admission.mjs'];
const raw=Object.fromEntries(modulePaths.map(p=>[p,fs.readFileSync(root+'/'+p)])),pins=Object.fromEntries(modulePaths.map(p=>[p,H(raw[p])]));
const specRaw=fs.readFileSync(E+'/ADOPTION_BATCH_V2.json'),spec=JSON.parse(specRaw),batch=spec.batch;
const clean=s=>s.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const impactCode=clean(raw['tools/release-impact.mjs'].toString()).replace('const qualifierTools=path.dirname(fileURLToPath(import.meta.url));','const qualifierTools=reviewedTools;');
const batchText=raw['tools/release-batch.mjs'].toString(),batchPrefix=clean(batchText.slice(0,batchText.indexOf('export async function executeBatch('))).replace('const ownTools=path.dirname(fileURLToPath(import.meta.url));','const ownTools=reviewedTools;');
const observerText=fs.readFileSync(root+'/tools/release-no-data-observation.mjs','utf8'),validation=observerText.slice(observerText.indexOf('const resourcePath='),observerText.indexOf('// Explicit dependency seam')).replace(/^export /gm,'');
const retryText=fs.readFileSync(root+'/tools/release-readonly-retry.mjs','utf8'),status=retryText.slice(retryText.indexOf('export function parseStatus(')).replace(/^export /gm,'');
const workerText=fs.readFileSync(root+'/tools/worker-local-release.mjs','utf8'),processCode=workerText.slice(workerText.indexOf('export function safeProcessEvidence('),workerText.indexOf('export async function runProcess(')).replace(/^export /gm,'');
const runner=clean(batchText.slice(batchText.indexOf('export async function runApprovedOperation('),batchText.indexOf('export async function cancelUnswitchedBatch(')));
const sourceRootStart=workerText.indexOf('export function workerSourceRootForBatch('),sourceRootEnd=workerText.indexOf('\n}',sourceRootStart)+2;assert.ok(sourceRootStart>=0&&sourceRootEnd>sourceRootStart);
const sourceRootHelper=workerText.slice(sourceRootStart,sourceRootEnd).replace(/^export /,'');
const transport=clean(batchText.slice(batchText.indexOf('export function productionCommandEnvironment('),batchText.indexOf('export async function runApprovedOperation(')));
const context={path,Buffer,process,Date,Number,performance,assert,createHash,fileURLToPath,readFileSync:fs.readFileSync,reviewedTools:path.join(root,'tools'),ts:{},inflateSync:require('node:zlib').inflateSync,
 workerRuntimeRoot:'D:\\teruisi-runtime\\teruisi-worker-sales',workerSourceRoot:'D:\\运营管理系统',sha256Canonical:v=>H(canonical(v)),canonicalJson:canonical,fail:m=>{throw new Error(m);},
 validateWorkerSourceBinding:envelope=>{assert.equal(envelope.raw,batch.sourceBinding.raw);assert.equal(H(envelope.raw),envelope.sha256);return JSON.parse(envelope.raw);},observationError:code=>Object.assign(new Error(code),{code}),
 runProcess:async()=>{throw new Error('No production invocation');},safeFileDigest:async()=>{throw new Error('No production digest in runner fixture');}};
const env=vm.createContext(context);
const program=impactCode+'\n'+validation+'\n'+status+'\n'+processCode+'\n'+sourceRootHelper+'\n'+batchPrefix+'\n'+transport+'\n'+runner+';this.api={verifyBatch,recoveryDecision,validateToolsNoMigrationScope,applicationInventoryFingerprint,runTargetedRecoveryConsumer,runApprovedOperation};';
vm.runInContext(program,env);
const clone=()=>JSON.parse(JSON.stringify(batch)),reseal=b=>{const c={...b};delete c.batchSha256;b.batchSha256=H(canonical(c));return b;};
const results=[];let cases=0;
function check(name,fn){fn();cases++;results.push({case:name,passed:true});}
function runnerFixture(change={},options={}){
 const b=clone(),op=b.operations.find(o=>o.kind==='restore'),calls=[];
 const backup={backupId:'reviewer-private-point',backupDirectory:'E:\\运营管理系统业务数据\\reviewer-private-point',manifestSha256:'1'.repeat(64),dumpSha256:'2'.repeat(64),contentSha256:'3'.repeat(64)};
 const receipt={backupId:backup.backupId,status:'completed',serviceStateChanged:false,productionDatabaseTouched:false,cleanupStatus:'isolated_data_removed',profileRestoreVerified:true,sequenceHealthVerified:true,backupManifestSha256:backup.manifestSha256,dumpSha256:backup.dumpSha256,expectedContentSha256:backup.contentSha256,restoredContentSha256:backup.contentSha256,...change};
 const state={latest:new Map(b.operations.map(o=>[o.id,{status:'passed',...(o.kind==='backup'?{outputs:backup}:{})}]))};if(options.noConsumer)state.latest.delete('installed-recovery-consumer');
 env.safeFileDigest=async p=>op.command.files.find(f=>f.path===p)?.sha256;
 env.runProcess=async(executable,args)=>{calls.push({executable,args});return {stdout:JSON.stringify(receipt),processEvidence:{version:1,processId:731,exitCode:0}};};
 return{b,op,state,calls,run:()=>env.api.runApprovedOperation(op,{batch:b,state,lease:{}})};
}
function consumerFixture(options={}){
 const b=clone(),calls=[],inventory=b.tests.scopeValidation.after.inventory,head={releaseId:'20261011T075658Z-aed7ddc1be340f5c',manifestSha256:b.binding.artifactSha256,bindingSha256:'a'.repeat(64)},chain={head,headManifestPath:'D:/reviewer-private/head.json',chainStateSha256:'c'.repeat(64),records:[{value:{approvedPlanSha256:b.binding.workerPlanSha256}}]};let reads=0;
 const receipt={version:'teruisi-release-payload-retention-v1',createdAt:new Date().toISOString(),chainStateSha256:chain.chainStateSha256,headReleaseId:head.releaseId,retainedReleaseIds:[head.releaseId],targets:[],retainedKeys:[],preservedMetadata:[]};
 const state={latest:new Map(b.operations.map(o=>[o.id,{status:'passed'}]))};if(options.unconfirmed)state.latest.delete('op-deployapp-switch');
 env.safeFileDigest=async p=>{calls.push({digest:true});return options.badBytes?'0'.repeat(64):p.endsWith('deployment.json')?b.binding.djangoCandidateSha256:inventory['tools/'+path.basename(p)];};
 env.resolveEffectiveReleaseChain=async()=>{reads++;return options.chainDrift&&reads>1?{...chain,headManifestPath:'D:/reviewer-private/changed.json'}:chain;};
 env.runProcess=async(executable,args,opt)=>{calls.push({executable,args,opt});return{stdout:JSON.stringify(receipt),processEvidence:{version:1,processId:732,exitCode:0}};};
 return{calls,run:()=>env.api.runTargetedRecoveryConsumer(b,state,Date.now()+30000)};
}
(async()=>{
 const start=performance.now();
 check('actual872d spec accepted only under exact v4 qualification; v2/v3 strict defaults remain full',()=>{assert.equal(env.api.verifyBatch(batch,batch.batchSha256).batchSha256,batch.batchSha256);assert.equal(batch.recovery.mode,'targeted-first-adoption');assert.equal(env.api.recoveryDecision({impact:batch.impact}).mode,'full');assert.equal(env.api.recoveryDecision({impact:{version:'teruisi-release-impact-v2',level:'strict'}}).mode,'full');});
 check('rehashed omissions/duplicates/post/old-operator/consumer command cannot alter approved operation scope',()=>{
  for(const change of [b=>b.operations.splice(b.operations.findIndex(o=>o.kind==='backup'),1),b=>{const x=structuredClone(b.operations.find(o=>o.kind==='backup'));x.id='duplicate-backup';b.operations.splice(1,0,x);},b=>b.operations.find(o=>o.kind==='backup').phase='backup-post',b=>b.operations.find(o=>o.kind==='restore').backupOperationId='other-point',b=>b.operations.find(o=>o.kind==='restore').command.args[3]='D:/reviewer-private/old-operator.ps1',b=>b.operations.find(o=>o.kind==='recovery-consumer').command={args:['--execute']}]){const b=clone();change(b);reseal(b);assert.throws(()=>env.api.verifyBatch(b,b.batchSha256));}
 });
 check('consumer/restore ordering and isolated restoration assertions cannot be removed by rehash',()=>{
  for(const id of ['op-deployapp-switch','op-hardenacl-switch','op-exitmaintenance-switch','op-startworker-switch']){const b=clone(),a=b.operations.findIndex(o=>o.kind==='restore'),i=b.operations.findIndex(o=>o.id===id);[b.operations[a],b.operations[i]]=[b.operations[i],b.operations[a]];reseal(b);assert.throws(()=>env.api.verifyBatch(b,b.batchSha256));}
  const b=clone();b.operations.find(o=>o.kind==='restore').assertions=b.operations.find(o=>o.kind==='restore').assertions.filter(a=>a.path!=='productionDatabaseTouched');reseal(b);assert.throws(()=>env.api.verifyBatch(b,b.batchSha256));
 });
 check('v4 requires actual executing ten-tool bytes and complete dual Django inventories, not prior evidence or strict-label forgery',()=>{
  for(const change of [b=>delete b.tests.scopeValidation,b=>b.tests.scopeValidation=true,b=>{const n=Object.keys(b.tests.scopeValidation.after.inventory).find(x=>x.startsWith('backend/'));delete b.tests.scopeValidation.after.inventory[n];},b=>b.impact.level='display',b=>b.recoveryEvidence={approved:true},b=>b.impactProof.inventory.after['tools/release-impact.mjs']='f'.repeat(64)]){const b=clone();change(b);reseal(b);assert.throws(()=>env.api.verifyBatch(b,b.batchSha256));}
 });
 const cf=consumerFixture(),cr=await cf.run(),native=cf.calls.find(c=>c.executable);assert.equal(cr.status,'passed');assert.equal(native.executable,process.execPath);assert.equal(native.args.length,1);assert.equal(path.basename(native.args[0]),'release-payload-retention.mjs');assert.ok(!native.args.includes('--execute'));assert.equal(native.opt.cleanup,'direct');assert.equal(cr.processEvidence.processId,732);cases++;results.push({case:'actual installed consumer uses Node+one fixed script with no Execute and exact new-chain receipt',passed:true});
 for(const options of [{unconfirmed:true},{badBytes:true},{chainDrift:true}]){const f=consumerFixture(options);await assert.rejects(f.run());if(!options.chainDrift)assert.ok(!f.calls.some(c=>c.executable));}cases++;results.push({case:'unconfirmed Deploy/changed installed bytes/new-chain drift refuse consumer',passed:true});
 const positive=runnerFixture(),pr=await positive.run();assert.equal(pr.status,'passed');assert.equal(positive.calls.length,1);const encoded=Buffer.from(positive.calls[0].args.at(-1),'base64').toString('utf16le'),payload=JSON.parse(Buffer.from(/FromBase64String\('([^']+)'\)/.exec(encoded)[1],'base64').toString('utf8'));assert.equal(payload.parameters.Action,'RestoreRehearsal');assert.equal(payload.parameters.BackupDirectory,'E:\\运营管理系统业务数据\\reviewer-private-point');assert.equal(payload.parameters.ApprovedManifestSha256,'1'.repeat(64));assert.equal(payload.parameters.ConfirmedIsolatedRestore,true);cases++;results.push({case:'actual e0d runner lexical backup variable works; exact same backup point expands to original isolated restore argv',passed:true});
 for(const change of [{backupId:'other-point'},{restoredContentSha256:'4'.repeat(64)},{productionDatabaseTouched:true},{cleanupStatus:'incomplete'}]){const f=runnerFixture(change);await assert.rejects(f.run(),e=>e.processEvidence?.code==='invalid_result'&&e.processEvidence.processId===731);}
 const missing=runnerFixture({}, {noConsumer:true});await assert.rejects(missing.run());assert.equal(missing.calls.length,0);cases++;results.push({case:'mismatched restore receipt or missing consumer cannot pass/execute',passed:true});
 for(const p of modulePaths)assert.equal(H(fs.readFileSync(root+'/'+p)),pins[p]);assert.equal(H(fs.readFileSync(E+'/ADOPTION_BATCH_V2.json')),H(specRaw));
 console.log(JSON.stringify({independent:true,candidate:root,specRawSha256:H(specRaw),batchSha256:batch.batchSha256,pinsBeforeAndAfter:pins,objectsStable:true,cases,pass:cases,fail:0,elapsedMs:performance.now()-start,productionImports:0,productionActions:0,pgDumpOrRestoreProcesses:0,nativePayloadChildren:0,results},null,2));
})().catch(e=>{const message=String(e.message),known=/^[A-Za-z_$][\w$]* is not defined$/.test(message)||Object.values(raw).some(b=>b.toString().includes("new Error('"+message+"')")||b.toString().includes('new Error("'+message+'")')),line=Number(e.stack?.match(/evalmachine\.<anonymous>:(\d+):/)?.[1]);console.error(JSON.stringify({status:'rejected',casesCompleted:cases,errorType:['AssertionError','ReferenceError','TypeError','SyntaxError','Error'].includes(e.name)?e.name:'OtherError',...(known?{fixedDiagnostic:message}:{}),...(line?{vmLine:line,fixedSourceLine:program.split(/\r?\n/)[line-1]}:{}),messageSha256:H(message)}));process.exitCode=1;});
