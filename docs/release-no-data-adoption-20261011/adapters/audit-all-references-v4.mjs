import {readFile,writeFile} from 'node:fs/promises';
import {realpath,readdir,lstat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-no-data-adoption-20261011';
const raw=await readFile(root+'/adoption-scope-guard-v4.mjs'),code=raw.toString('utf8');
const target=path.resolve('D:/teruisi-runtime/django-sales/app.previous').toLowerCase();
const start=code.indexOf('  const isReference='),end=code.indexOf('  let scanned=',start);
assert.ok(start>0&&end>start);
const {inspectReferences,visitValue}=vm.runInNewContext(code.slice(start,end)+';({inspectReferences,visitValue})',{path,target,realpath,Error});
const query=JSON.parse(code.match(/const query=("[^\n]+");/)[1]);
const env=vm.runInNewContext('('+code.match(/const nativeEnvironment=([^\n]+);/)[1]+')',{process:{env:process.env}});
const capture=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',query],{env,windowsHide:true,timeout:60_000,maxBuffer:8*1024*1024});
assert.equal(capture.status,0);
const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(capture.stdout));
const references=[],unknown=[];
async function check(text,kind,id,commandLine=false){try{if(await inspectReferences(text,{commandLine}))references.push({kind,id});}catch(error){unknown.push({kind,id,code:'physical-path-unresolved'});}}
for(const p of value.processes){await check(p.CommandLine,'process-command',p.ProcessId,true);await check(p.ExecutablePath,'process-executable',p.ProcessId);}
for(const t of value.tasks){const id=createHash('sha256').update(t.identity).digest('hex');for(const a of t.actions){await check(a.Execute,'task-executable',id);await check(a.Arguments,'task-arguments',id,true);await check(a.WorkingDirectory,'task-working-directory',id);}}
const impact=await import(pathToFileURL('D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T051645Z-3032ae332a32f1a0/tools/release-impact.mjs'));
let filesScanned=0;
async function inspectJson(file){const info=await lstat(file);assert.equal(info.nlink,1);assert.ok(info.size<=32*1024*1024);const raw=await impact.safeRead(file);filesScanned++;if(await visitValue(JSON.parse(raw)))references.push({kind:'state-or-candidate',id:createHash('sha256').update(file).digest('hex')});}
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name),info=await lstat(file);assert.ok(!info.isSymbolicLink());if(e.isDirectory())await walk(file);else if(e.name.endsWith('.json'))await inspectJson(file);}}
await walk('D:/teruisi-runtime/teruisi-worker-sales/state');await walk('D:/teruisi-runtime/django-sales/run');
for(const name of await readdir('D:/teruisi-runtime/django-sales'))if(/^app\.(prepare|deploy)-.*\.json$/.test(name))await inspectJson(path.join('D:/teruisi-runtime/django-sales',name));
const record={version:'teruisi-primary-native-reference-v4-audit-v1',at:new Date().toISOString(),guardSha256:createHash('sha256').update(raw).digest('hex'),filesScanned,status:references.length||unknown.length?'blocked':'passed',processes:value.processes.length,scheduledTasks:value.tasks.length,references,unknown,rawProcessOrTaskValuesPersisted:false,productionMutations:0};
await writeFile(root+'/ALL_REFERENCES_V4.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record));
