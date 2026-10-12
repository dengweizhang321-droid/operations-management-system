// Fixed diagnostic only: builtins, existing files, bounded native metadata and
// create-only safe evidence. No Status, lifecycle, SQL, task mutation or replay.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const out='E:/codex-artifacts/startup-status-receipt-safety-20261012';
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const helper='D:/.codex/worktrees/release-site-blockers/运营管理系统/docs/release-site-blockers-20261011/Collect-LiveProcessIdentity.ps1';
const base='D:/teruisi-runtime/teruisi-worker-sales';
const journal=base+'/state/release-batches/first-adoption-live-guard-20261011';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
function physical(p){p=path.resolve(p);const parents=[];for(let q=p;;q=path.dirname(q)){const s=fs.lstatSync(q,{bigint:true});assert(!s.isSymbolicLink(),'Reparse denied');assert.equal(fs.realpathSync.native(q).toLowerCase(),q.toLowerCase(),'Physical alias denied');parents.push([q,String(s.dev),String(s.ino)]);if(q===path.dirname(q))return parents;}}
function stat(s){return ['dev','ino','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k]));}
export function checked(p,expected){const parents=physical(p),a=fs.lstatSync(p,{bigint:true});assert(a.isFile());const system=path.resolve(p).toLowerCase()===path.resolve(ps).toLowerCase();assert.equal(a.nlink,system?2n:1n);if(system)assert.equal(expected,'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5');const bytes=fs.readFileSync(p);assert.deepEqual(stat(fs.lstatSync(p,{bigint:true})),stat(a),'File changed during read');assert.deepEqual(physical(p),parents);if(expected)assert.equal(sha(bytes),expected,'Bound bytes changed');return bytes;}
function context(){
 const spec=checked('E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json','960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b');
 const manifest=checked(base+'/releases/20261011T090355Z-21c2645a63247749/deployment-manifest.json','6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4');
 const bound=JSON.parse(manifest).source.sourceBinding;assert.equal(sha(bound.raw),'1168c06784a134da5390b7403e83de8af27d5f866ad239f92bd4c136c134b745');assert.equal(JSON.parse(bound.raw).identity.sourceTree.sha256,'dc1dbeeded593980c6712e7afabde0a053dfd13d8f6c4bb9375718330af2b8fb');
 const django=checked('D:/teruisi-runtime/django-sales/app/deployment.json','85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09');
 const owner=JSON.parse(checked(base+'/state/release-batches/active.json'));assert.deepEqual(owner,{batchSha256:'f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f',id:'first-adoption-live-guard-20261011'});
 const names=fs.readdirSync(journal).filter(x=>/^\d{6}\.json$/.test(x)).sort();assert.equal(names.length,49,'Exact unresolved journal required');let previous=null;
 for(let i=0;i<49;i++){assert.equal(names[i],String(i).padStart(6,'0')+'.json');const raw=checked(path.join(journal,names[i])),v=JSON.parse(raw),{eventSha256,...core}=v;assert.equal(sha(canonical(core)),eventSha256);assert.equal(raw.toString(),canonical(v)+'\n');assert.equal(v.previous,previous);previous=eventSha256;}
 assert.equal(previous,'1a614e58caf56a243ea8dead3ce1609993fd993c3ed39cac296bf83c64617bd4');
 return {specSha256:sha(spec),workerManifestSha256:sha(manifest),djangoManifestSha256:sha(django),owner,walCount:49,head:previous};
}
const expectedPids=[9440,38400,52220,53960,28016,62716,36644,52636,72676,70032,62748,41596,12556,31216,28748,71524,53104,67196,60408,68280,67472,10336,48520,43884,3692];
export function summarizeCapture(v,labels){
 assert.equal(v.version,'fixed-startup-native-capture-v1');assert.equal(v.sid,'S-1-5-21-815909789-107973518-1379257801-1001');assert.equal(v.administrator,true);assert.equal(v.productionActions,0);
 assert(Array.isArray(v.fixedRows));assert.deepEqual(v.fixedRows.map(x=>x.processId),expectedPids);assert.equal(labels.entries.length,23);
 const rows=v.fixedRows.map(row=>{
   const allowed=['processId','cimBeforeCount','cimAfterCount','cimCreationUtc','cimCreationAfterUtc','parentProcessId','parentAfterProcessId','name','sessionId','image','commandLine','openError','imageError','timesError','commandStatusFirst','commandStatusSecond','nativeCreationFileTime','identityStable','commandStable','nativeCimBirthEqual','cimNativeCommandEqual','cimNativeImageEqual'];
   assert(Object.keys(row).every(k=>allowed.includes(k)),'Unexpected raw metadata field');
   const full=v.processes.filter(x=>x.ProcessId===row.processId);assert(full.length<=1,'Duplicate full-census PID');
   const label=labels.entries.find(x=>x.processId===row.processId);
   const {commandLine,image,...safe}=row;
   const c=full[0];
   return {...safe,service:label?.service??(row.processId===43884?'worker-supervisor':'worker-port-process'),auditStartup:label?.startup??null,auditRemoval:label?.removal??null,startupRawSha256:label?.startupRawSha256??null,removalRawSha256:label?.removalRawSha256??null,imageSha256:typeof image==='string'?sha(image):null,imageIsInstalledVenv:typeof image==='string'&&path.win32.normalize(image).toLowerCase().startsWith('d:\\teruisi-runtime\\django-sales\\venv\\'),commandLineSha256:typeof commandLine==='string'?sha(commandLine):null,commandCharacters:typeof commandLine==='string'?commandLine.length:null,fullCensus:{present:!!c,identityStable:c?.identityStable??false,cimCreationUtc:c?.cimCreationUtc??null,nativeCreationFileTime:c?.nativeCreationFileTime??null,imageSha256:typeof c?.ExecutablePath==='string'?sha(c.ExecutablePath):null,commandLineSha256:typeof c?.CommandLine==='string'?sha(c.CommandLine):null},originalOwnershipEstablished:false};
 });
 const cwd=v.selectedCwd;assert.equal(cwd.processId,47936);
 if(cwd.readable){assert.equal(cwd.identityStable,true);assert.equal(cwd.nativeCreationFileTime,'134357214785673015');assert.equal(cwd.cimCreationUtc,'2026-10-06T00:51:18.5673010Z');}
 return {version:'fixed-startup-safe-metadata-v1',sid:v.sid,administrator:v.administrator,startedAt:v.startedAt,completedAt:v.completedAt,rows,selectedCwd:{processId:47936,readable:cwd.readable,identityStable:cwd.identityStable,nativeCreationFileTime:cwd.nativeCreationFileTime,cimCreationUtc:cwd.cimCreationUtc,directorySha256:typeof cwd.CurrentDirectory==='string'?sha(cwd.CurrentDirectory):null,openError:cwd.openError,failure:cwd.failure},aggregate:v.summary,originalOwnershipEstablished:false,missingOriginalReceiptFields:labels.missingOriginalReceiptFields,rawCommandsOrCwdPersisted:false,productionActions:0};
}
export function captureFixedStartupMetadata(){
 assert(!Object.keys(process.env).some(k=>k.toUpperCase().startsWith('NODE_')),'NODE environment overrides forbidden');
 physical(out);const before=context();
 const pins=[[process.execPath,'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'],[ps,'7600ffe12da441fe89d035b13801e8e91d064bc544a27b19a5cf49f6ab8b18f5'],[helper,'280fa1cd5b4c22b73743736e1b2c6d4b50f0a106e36e8fd8b139682666903c12'],[path.join(dir,'Collect-FixedStartupMetadata.ps1'),'a280e1cc8da5aa0de9c56d1cb0671ec9454078d0a941fc96f4fd73fe1c5877fa'],[path.join(dir,'STARTUP_AUDIT_LABELS_V1.json'),'4ad0439a29be4fcc670c858c08239c60a7c7c985eab544533f8680924a6f3681']];
 const bytes=pins.map(([p,h])=>checked(p,h));
 // The original bounded source records are machine-captured labels, not saved
 // ownership receipts. Verify their exact original audit lines still exist.
 const labels=JSON.parse(bytes[4]);const log=fs.readFileSync(labels.source,'utf8');const hashes=new Set(log.split(/\r?\n/).filter(Boolean).map(sha));for(const row of labels.entries){assert(hashes.has(row.startupRawSha256));assert(hashes.has(row.removalRawSha256));}
 const env={...process.env};for(const key of Object.keys(env))if(['PSMODULEPATH','TERUISI_DJANGO_SERVICE_LIBRARY_ONLY','TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY'].includes(key.toUpperCase()))delete env[key];env.PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
 const run=spawnSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bytes[3].toString('utf8').replace(/^\ufeff/,''),'utf16le').toString('base64')],{input:JSON.stringify({version:'fixed-startup-metadata-input-v1',collectorBase64:bytes[2].toString('base64')}),windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:16777216,env});
 const transport={exitCode:run.status,errorCode:run.error?.code??null,stdoutSha256:sha(run.stdout??''),stderrSha256:sha(run.stderr??''),stdoutBytes:Buffer.byteLength(run.stdout??''),stderrBytes:Buffer.byteLength(run.stderr??'')};
 fs.writeFileSync(out+'/ADMIN_STARTUP_CAPTURE_TRANSPORT_V1.json',JSON.stringify(transport,null,2)+'\n',{flag:'wx'});
 assert.equal(run.error,undefined,'Metadata capture transport failed');assert.equal(run.status,0,'Metadata capture failed');
 const result=summarizeCapture(JSON.parse(run.stdout),labels);
 fs.writeFileSync(out+'/ADMIN_STARTUP_OBSERVATION_ATTEMPT_V1.json',JSON.stringify({initialContext:before,finalContextVerified:false,...result},null,2)+'\n',{flag:'wx'});
 for(const [p,h]of pins)checked(p,h);assert.deepEqual(context(),before,'Bound runtime context changed');
 fs.writeFileSync(out+'/ADMIN_STARTUP_IDENTITY_V1.json',JSON.stringify({context:before,...result},null,2)+'\n',{flag:'wx'});
 return {status:'diagnostic-captured-only',originalOwnershipEstablished:false,rows:result.rows.length,resultSha256:sha(fs.readFileSync(out+'/ADMIN_STARTUP_IDENTITY_V1.json')),productionActions:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,2);try{console.log(JSON.stringify(captureFixedStartupMetadata()));}catch(e){console.error(JSON.stringify({status:'failed',errorType:e.name,productionActions:0}));process.exitCode=1;}}
