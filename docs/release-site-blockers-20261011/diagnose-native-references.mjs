import {readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const evidence='E:/codex-artifacts/release-site-blockers-20261011';
const guardRaw=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs'),code=guardRaw.toString();
const hash=v=>createHash('sha256').update(v).digest('hex');
assert.equal(hash(guardRaw),'eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd');
const target=path.resolve('D:/teruisi-runtime/django-sales/app.previous').toLowerCase();
const start=code.indexOf('  const isReference='),end=code.indexOf('  let scanned=',start);assert.ok(start>0&&end>start);
const {inspectProcessReference,inspectReferences}=vm.runInNewContext(code.slice(start,end)+';({inspectProcessReference,inspectReferences})',{path,target,realpath,Error,Number,Set});
const script=fileURLToPath(new URL('./Collect-ProcessIdentity.ps1',import.meta.url));
const command="[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); & '"+script.replaceAll("'","''")+"' -OutputPath '"+evidence+"/NATIVE_FALLBACK_CAPTURE_SECOND.json'";
const capture=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'}});
if(capture.status!==0)throw Error('Native diagnostic failed: '+capture.stderr.slice(0,1000));
const current=JSON.parse(capture.stdout),unknown=[],references=[];
for(const p of current.processes){let value;if(!p.identityStable)value={kind:'process-unknown',processId:p.ProcessId,reason:'process-changed-during-capture'};else{try{value=await inspectProcessReference(p);}catch{value={kind:'process-unknown',processId:p.ProcessId,reason:'physical-path-unresolved'};}}if(value)(value.kind==='process-unknown'?unknown:references).push({...value,name:p.Name,openError:p.openError,commandStatus:p.commandStatus,crossCreation:p.crossCreation});}
for(const t of current.tasks)for(const a of t.actions){try{if(await inspectReferences(a.Execute)||await inspectReferences(a.Arguments,{commandLine:true})||await inspectReferences(a.WorkingDirectory)){references.push({kind:'scheduled-task',identitySha256:hash(t.identity)});break;}}catch{unknown.push({kind:'scheduled-task-unknown',identitySha256:hash(t.identity)});break;}}
const record={version:'teruisi-frozen-reference-predicate-native-diagnostic-v1',at:new Date().toISOString(),originalGuardSha256:hash(guardRaw),helperSha256:hash(await readFile(script)),status:unknown.length||references.length?'blocked':'diagnostic-no-reference-found',captureSummary:current.summary,unknown,references,rawCommandsPersisted:false,productionMutations:0,scope:'Diagnostic only; frozen production guard remains CIM-only and unchanged. Does not prove cwd, encoded/relative arguments or all handle references.'};
await writeFile(evidence+'/NATIVE_REFERENCE_DIAGNOSTIC_SECOND.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:record.status,processes:current.processes.length,tasks:current.tasks.length,unknown:unknown.length,references:references.length,unknownDetails:unknown}));
