/** Stable first-adoption gate. Builtins only; deliberately no legacy exports. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hex=/^[a-f0-9]{64}$/;
const execute=promisify(execFile);
// The installer replaces this one literal with exact immutable path constants.
// Bundle imports keep null; only the fixed first-adoption shim has a fence.
const legacyBridge = null;
export function publisherEnvironment(){throw Error('LEGACY_CONTROL_DISABLED');}
export function legacyHookDecision(bridge,argv){
 const same=(left,right)=>typeof left==='string'&&path.win32.isAbsolute(left)&&path.win32.normalize(left).toLowerCase()===path.win32.normalize(right).toLowerCase();
 if(same(argv[1],bridge.fixedCli))return null;
 if(!same(argv[1],bridge.oldHook)||!same(argv[3],bridge.configFile))return 75;
 if(argv.length===5&&argv[2]==='event'&&['preparing','prepared','aborted'].includes(argv[4]))return 0;
 return 75;
}
if(legacyBridge){const decision=legacyHookDecision(legacyBridge,process.argv);if(decision!==null){if(decision)process.stderr.write('LEGACY_CONTROL_DISABLED\n');process.exit(decision);}}
async function stable(file){
 assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Redirected control path');
 const before=await fs.lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size<4*1024*1024,'Unsafe control evidence');
 const bytes=await fs.readFile(file),after=await fs.lstat(file);
 for(const k of ['ino','dev','size','mtimeMs','ctimeMs','nlink'])assert.equal(after[k],before[k],'Control evidence changed');
 return bytes;
}
export async function readAdoptedControl(configFile,expectedBundle){
 const configRaw=await stable(configFile),config=JSON.parse(configRaw);
 const stateFile=path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'),stateRaw=await stable(stateFile),state=JSON.parse(stateRaw);
 assert.equal(stateRaw.toString(),JSON.stringify(state)+'\n','Installation JSON is duplicated or noncanonical');
 assert.deepEqual(Object.keys(state).sort(),['adoptedAt','bundleManifestSha256','bundleRoot','bundleSha256','configSha256','dispatcherSha256','hook','hookSha256','installId','intentSha256','status','transitionProofFile','transitionProofSha256','version']);
 assert.equal(state.version,'teruisi-main-control-installation-v2');assert.equal(state.status,'adopted','Control upgrade incomplete; preparation/deployment refused');
 assert.ok(/^[a-f0-9-]{36}$/.test(state.installId)&&hex.test(state.intentSha256)&&hex.test(state.bundleManifestSha256)&&hex.test(state.transitionProofSha256));
 assert.equal(sha(configRaw),state.configSha256,'Control config changed');
 const root=path.resolve(config.stateDirectory,'control-bundles',state.bundleSha256);
 assert.equal(path.resolve(state.bundleRoot),root,'Control bundle path changed');
 if(expectedBundle)assert.equal(path.resolve(expectedBundle),root,'Control generation changed; old consumer refused');
 const intent=path.join(config.stateDirectory,'control-upgrades',state.installId,'INTENT.json');assert.equal(sha(await stable(intent)),state.intentSha256);
 assert.equal(path.dirname(path.resolve(state.transitionProofFile)),path.dirname(intent),'Transition proof escaped installation');
 assert.ok(/^TRANSITION-[a-f0-9-]{36}\.json$/.test(path.basename(state.transitionProofFile)));
 assert.equal(sha(await stable(state.transitionProofFile)),state.transitionProofSha256);
 const manifestRaw=await stable(path.join(root,'MANIFEST.json'));assert.equal(sha(manifestRaw),state.bundleManifestSha256);
 const manifest=JSON.parse(manifestRaw);assert.equal(manifest.version,'teruisi-main-control-bundle-v2');assert.equal(manifest.bundleSha256,state.bundleSha256);
 assert.ok(manifest.files&&Object.keys(manifest.files).length>5&&Object.keys(manifest.files).length<32);
 const names=Object.keys(manifest.files);
 assert.ok(names.every(name=>/^tools\/[a-z0-9-]+\.mjs$/.test(name)&&hex.test(manifest.files[name])),'Invalid control closure');
 assert.deepEqual((await fs.readdir(path.join(root,'tools'))).sort(),names.map(name=>name.slice(6)).sort(),'Control bundle member set changed');
 for(const [name,expected] of Object.entries(manifest.files))assert.equal(sha(await stable(path.join(root,...name.split('/')))),expected,'Control bundle changed: '+name);
 assert.equal(sha(await stable(path.join(config.stateDirectory,'control/tools/publish-latest-main.mjs'))),state.dispatcherSha256,'Fixed control gate changed');
 assert.equal(sha(await stable(state.hook)),state.hookSha256,'Git control hook changed');
 assert.equal(sha(await stable(stateFile)),sha(stateRaw),'Control generation changed during admission');
 return {config,state,stateSha256:sha(stateRaw),bundleRoot:root,configFile:path.resolve(configFile)};
}
export async function assertControlGeneration(binding){
 const current=await readAdoptedControl(binding.configFile,binding.bundleRoot);assert.equal(current.stateSha256,binding.stateSha256,'Control installation changed');return current;
}
export async function controlExecution(binding,entry,mode){
 await assertControlGeneration(binding);
 const code='$p=Get-CimInstance Win32_Process -Filter "ProcessId='+process.pid+'";if($null -eq $p -or [string]::IsNullOrEmpty($p.CommandLine) -or [string]::IsNullOrEmpty($p.ExecutablePath)){throw "Control process identity unavailable"};@{pid=$p.ProcessId;createdAt=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine;executable=$p.ExecutablePath}|ConvertTo-Json -Compress';
 const environment={...process.env,PSModulePath:path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
 const result=await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:15000,env:environment});
 const identity=JSON.parse(result.stdout);assert.equal(identity.pid,process.pid);
 const executionId=randomUUID(),directory=path.join(binding.config.stateDirectory,'control-executions');await fs.mkdir(directory,{recursive:true});
 const value={version:'teruisi-main-control-execution-v2',executionId,installId:binding.state.installId,bundleSha256:binding.state.bundleSha256,bundleManifestSha256:binding.state.bundleManifestSha256,
  entry,mode,pid:process.pid,createdAt:identity.createdAt,commandLineSha256:sha(identity.commandLine),executableSha256:sha(await fs.readFile(identity.executable)),startedAt:new Date().toISOString()};
 const handle=await fs.open(path.join(directory,executionId+'.json'),'wx');try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
 await assertControlGeneration(binding);return value;
}
async function main(){
 const args=process.argv.slice(2),index=args.indexOf('--config');assert.ok(index!==-1&&path.isAbsolute(args[index+1]??''),'Absolute control config required');
 const configFile=args[index+1];
 if(args.includes('--control-status')){
  const config=JSON.parse(await fs.readFile(configFile,'utf8'));let state;try{state=JSON.parse(await fs.readFile(path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'),'utf8'));}catch{state={status:'incomplete'};}
  console.log(JSON.stringify({status:state.status,installId:state.installId??null,publicationPerformed:false}));return;
 }
 const binding=await readAdoptedControl(configFile);
 const api=await import(pathToFileURL(path.join(binding.bundleRoot,'tools/publish-latest-main.mjs')));
 await api.runLatestMainCli(args,binding);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Control unavailable: '+error.message);process.exitCode=75;});
