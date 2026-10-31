/** Exact control upgrade materials; explicit adoption has one durable boundary. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {publisherEnvironment} from './publish-latest-main.mjs';
import {canonical,durableCreate,queuePipe,preparationTriggerMode} from './main-prebuild-queue.mjs';
import {acquirePreparationRotationLock} from './worker-local-release-rotation.mjs';
import {makePreparationTask,installPreparationTask,readPreparationTask,assertDisabledPreparationPredecessor,assertDisabledPreparationRecovery,decodedControlCommand as decoded} from './main-prebuild-task.mjs';
import {knownResume} from './publish-main-known-resume.mjs';
import {retirementIntentVersion,retirementConfigVersion} from './preparation-retirement-admission.mjs';
import {retirementRefProtocol,makeRetirementReferenceHook} from './preparation-retirement-ref.mjs';
import {retirementGit} from './preparation-retirement-fs.mjs';
import {artifactLossProtocol,artifactLossManifestName,readArtifactFile,readArtifactLossControlBinding,validateArtifactLossManifest,assertArtifactLossBindings} from './prepared-artifact-loss.mjs';
import {readPreparationQueueStructure} from './main-prebuild-queue.mjs';
const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const controlFiles=['prepared-artifact-loss.mjs','main-preparation-reconcile.mjs','publish-latest-main.mjs','publish-main-progress.mjs','release-scope-plan.mjs','main-prebuild-hook.mjs','main-schema-release.mjs','main-prebuild-status.mjs','main-prebuild-queue.mjs','main-control-dispatch.mjs','main-prebuild-task.mjs','frozen-main-source.mjs','preparation-resolution.mjs','preparation-resolution-history.mjs','preparation-producer-qualification.mjs','cleaned-preparation-writer.mjs','cleaned-preparation-observer.mjs','preparation-retirement-admission.mjs','preparation-retirement-archive.mjs','preparation-retirement-boot.mjs','preparation-retirement-collector.mjs','preparation-retirement-evidence.mjs','preparation-retirement-entry.mjs','preparation-retirement-fs.mjs','preparation-retirement-handoff.mjs','preparation-retirement-handoff-runner.ps1','preparation-retirement-console.mjs','preparation-retirement-history.mjs','preparation-retirement-native.mjs','preparation-retirement-observer.mjs','preparation-retirement-qualification.mjs','preparation-retirement-ref.mjs','preparation-retirement-source.mjs','preparation-retirement-witness.mjs','preparation-retirement.mjs'];
// The scope planner's imports must travel with every newly prepared controller.
controlFiles.push('release-copy-rules.mjs','release-copy-git-sources.mjs');
const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function bytes(file){assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Redirected control path');const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,'Unsafe control file');return fs.readFile(file);}
const hashOrMissing=async file=>await exists(file)?sha(await bytes(file)):null;
async function git(root,args){return (await execute('git',['-C',root,...args],{encoding:'utf8',windowsHide:true})).stdout.trim();}
async function hooksPolicy(repository,gitSpec){
 const common=path.resolve(await retirementGit(repository,['rev-parse','--path-format=absolute','--git-common-dir'],gitSpec)),hooks=path.join(common,'hooks');assert.equal(path.resolve(await fs.realpath(hooks)).toLowerCase(),hooks.toLowerCase(),'Hook directory redirected');const get=async args=>{try{return await retirementGit(repository,['config',...args,'--get-all','core.hooksPath'],gitSpec);}catch(error){if(error.code===1)return null;throw error;}};return {common,hooks,local:await get(['--local']),effective:await get([])};
}
function assertHooksPolicy(policy,expected,{allowUnset=false}={}){assert.equal(policy.hooks,expected.hooks);assert.equal(policy.common,expected.common);const allowed=allowUnset?[expected.beforeLocal,expected.hooks]:[expected.hooks];assert.ok(allowed.includes(policy.local),'Repository-local hook policy changed');assert.equal(policy.effective,policy.local,'Inherited hook policy differs from fixed local policy');}
async function assertRetirementConfigUpgrade(stateDirectory,before,after){const root=path.join(stateDirectory,'preparation-retirements');if(!await exists(root))return;assert.equal(path.resolve(await fs.realpath(root)).toLowerCase(),path.resolve(root).toLowerCase());const members=await fs.readdir(root);assert.ok(members.length<=128);if(members.length)assert.equal(after,before,'Existing retirement requires its qualified config/native provider; config-changing upgrades need a separately qualified protocol before adoption');}
async function atomic(file,raw){await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temporary,'wx');try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}await fs.rename(temporary,file);assert.equal(sha(await bytes(file)),sha(raw),'Atomic control readback differs');}
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
function shell(entry,configFile,label,committedEntry=entry){return makeRetirementReferenceHook({node:process.execPath,entry,configFile,label,committedEntry});}
function bat(entry,mode){return '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"'+process.execPath+'" "'+entry+'" --config "%~dp0main-publisher-config.json" '+mode+' %*\r\nset "release_exit=%errorlevel%"\r\nif /i not "%~1"=="--no-pause" pause\r\nexit /b %release_exit%\r\n';}
export async function validateDependencyUpdate(update,receipt,config,configSha256){
 assert.deepEqual(Object.keys(update).sort(),['version','oldConfigSha256','dependenciesDirectory','cacheLockSha256','receiptPath','receiptSha256'].sort());
 assert.equal(update.version,'teruisi-control-dependency-update-v1');assert.equal(update.oldConfigSha256,configSha256,'Dependency update predecessor changed');
 for(const key of ['cacheLockSha256','receiptSha256'])assert.match(update[key]??'',/^[a-f0-9]{64}$/);
 assert.equal(receipt.version,'teruisi-offline-dependencies-v1');assert.equal(receipt.administrator,false);assert.equal(receipt.exitCode,0);
 assert.equal(receipt.packageLockSha256,update.cacheLockSha256);assert.equal(path.resolve(receipt.dependenciesDirectory),path.resolve(update.dependenciesDirectory));
 const directory=path.resolve(update.dependenciesDirectory),state=path.resolve(config.stateDirectory);
 assert.ok(directory.toLowerCase().startsWith(state.toLowerCase()+path.sep)&&path.basename(directory)==='node_modules','Dependency update must use private publisher storage');
 assert.equal(path.resolve(await fs.realpath(directory)),directory,'Dependencies are redirected');assert.ok((await fs.lstat(directory)).isDirectory());
 assert.match(receipt.modulesLockSha256??'',/^[a-f0-9]{64}$/);assert.equal(sha(await bytes(path.join(directory,'.package-lock.json'))),receipt.modulesLockSha256,'Prepared dependency inventory changed');
 return {...config,dependenciesDirectory:directory,cacheLockSha256:update.cacheLockSha256};
}
// One reviewed compatibility closure, derived from the installed native tools.
// No other main changes or application/runtime files are adopted by this gate.
export const codeOnlyNativeToolsPins=Object.freeze({
 'tools/worker-local-release.mjs':Object.freeze({before:'0f2d229f58b988dc9591699e0d73362ad1f1f8df5367e19844d82d931a99c108',after:'aa1be03ebde6fc5b5f9a50fc986a12756ba8eda69e0549ef111f23d5b9439bd2'}),
 'tools/worker-local-release-rotation.mjs':Object.freeze({before:'7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f',after:'5c265b55c0d738c9785809fdf56c72b72160d6814141d2b21c5149740c3c54fb'}),
 'tools/d1-retirement-proof.mjs':Object.freeze({before:'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76',after:'87cf58e5ab5cac1dd9e77a4502e24b2769e4a121b5bb173dd53d45d913f6bc76'}),
});
// Second exact closure: retain the adopted v1 tools, changing only the reviewed
// successor capacity literal. It cannot import any other current-main bytes.
export const successor512NativeToolsPins=Object.freeze({
 'tools/worker-local-release.mjs':Object.freeze({before:codeOnlyNativeToolsPins['tools/worker-local-release.mjs'].after,after:codeOnlyNativeToolsPins['tools/worker-local-release.mjs'].after}),
 'tools/worker-local-release-rotation.mjs':Object.freeze({before:codeOnlyNativeToolsPins['tools/worker-local-release-rotation.mjs'].after,after:'778c136602cf1ebb44fd2fbed1ee67a3cf24fbd78a2cc52b8541db5be114b556'}),
 'tools/d1-retirement-proof.mjs':codeOnlyNativeToolsPins['tools/d1-retirement-proof.mjs'],
});
export async function validateNativeToolsUpdate(update,config,configSha256){
 assert.deepEqual(Object.keys(update).sort(),['version','oldConfigSha256','nativeToolsSource'].sort());
 assert.ok(['teruisi-code-only-native-tools-update-v1','teruisi-successor-512-native-tools-update-v2'].includes(update.version),'Unsupported native tools update');assert.equal(update.oldConfigSha256,configSha256,'Native tools update predecessor changed');
 const version2=update.version==='teruisi-successor-512-native-tools-update-v2',pins=version2?successor512NativeToolsPins:codeOnlyNativeToolsPins;
 if(version2)assert.equal(configSha256,'49caa8d7a140fa614c2f28389029d07f6de6b503df499094d28e07793490200a','Successor512 requires its exact installed publisher configuration');
 const predecessor=version2?path.resolve(config.stateDirectory,'native-tools',sha(Buffer.from(canonical(Object.fromEntries(Object.entries(codeOnlyNativeToolsPins).map(([name,pin])=>[name,pin.after])))))):path.resolve(config.stateDirectory,'source');
 assert.equal(path.resolve(config.nativeToolsSource),predecessor,'Native tools predecessor source changed');
 const files=Object.fromEntries(Object.entries(pins).map(([name,pin])=>[name,pin.after]));
 const root=path.resolve(update.nativeToolsSource),expected=path.resolve(config.stateDirectory,'native-tools',sha(Buffer.from(canonical(files))));
 assert.equal(root,expected,'Native tools must use the exact immutable closure path');
 assert.equal(path.resolve(await fs.realpath(root)),root,'Native tool closure is redirected');
 assert.deepEqual((await fs.readdir(root)).sort(),['tools']);
 assert.equal(path.resolve(await fs.realpath(path.join(root,'tools'))),path.join(root,'tools'),'Native tools directory is redirected');
 assert.deepEqual((await fs.readdir(path.join(root,'tools'))).sort(),Object.keys(files).map(name=>name.slice(6)).sort(),'Native closure member set changed');
 for(const [name,pin] of Object.entries(pins)){
  assert.equal(sha(await bytes(path.join(config.nativeToolsSource,...name.split('/')))),pin.before,'Native tools predecessor bytes changed');
  assert.equal(sha(await bytes(path.join(root,...name.split('/')))),pin.after,'Native tools candidate bytes changed');
 }
 return {...config,nativeToolsSource:root};
}
/** Successors inherit the exact external manifest. Replacement needs a separate protocol. */
export async function artifactLossUpgradeMaterial(stateDirectory,candidateFile){
 const queue=path.join(stateDirectory,'prebuild-queue-v2'),prior=await readArtifactLossControlBinding(queue);
 if(!candidateFile&&!prior)return null;
 const raw=await readArtifactFile(candidateFile??prior.manifestFile),value=JSON.parse(raw),digest=sha(raw);
 assert.equal(raw.toString(),canonical(value),'Artifact loss upgrade manifest is not canonical');validateArtifactLossManifest(value);assert.equal(path.resolve(value.queueDirectory),path.resolve(queue),'Artifact loss upgrade queue changed');
 if(prior)assert.equal(digest,prior.manifestSha256,'A successor cannot replace its bound artifact loss manifest');
 return {raw,sha256:digest,value};
}
export async function prepareControlUpgrade({configFile,out,sourceRoot=source,dependencyUpdateFile,nativeToolsUpdateFile,restoreDisabledPreparationTask=false,artifactLossManifestFile}={}){
 assert.ok(path.isAbsolute(configFile??'')&&path.isAbsolute(out??''));assert.equal(await git(sourceRoot,['status','--porcelain']),'','Control source must be frozen and clean');
 assert.ok(!(dependencyUpdateFile&&nativeToolsUpdateFile),'Dependency and native tools updates must be separate exact intents');
 assert.ok(!restoreDisabledPreparationTask||(!dependencyUpdateFile&&!nativeToolsUpdateFile),'Disabled task recovery must preserve the exact configuration');
 const configRaw=await bytes(configFile);let config={...JSON.parse(configRaw)},dependencyUpdateRaw,dependencyReceiptRaw,nativeToolsUpdateRaw;
 if(dependencyUpdateFile){
  dependencyUpdateRaw=await bytes(path.resolve(dependencyUpdateFile));const update=JSON.parse(dependencyUpdateRaw);
  dependencyReceiptRaw=await bytes(path.resolve(update.receiptPath));assert.equal(sha(dependencyReceiptRaw),update.receiptSha256,'Dependency receipt changed');
  config=await validateDependencyUpdate(update,JSON.parse(dependencyReceiptRaw),config,sha(configRaw));
 }
 if(nativeToolsUpdateFile){nativeToolsUpdateRaw=await bytes(path.resolve(nativeToolsUpdateFile));config=await validateNativeToolsUpdate(JSON.parse(nativeToolsUpdateRaw),config,sha(configRaw));}
 const updateOnlyConfig=(dependencyUpdateRaw||nativeToolsUpdateRaw)?{...config}:null;
 const executable=(await execute('C:/Windows/System32/where.exe',['git.exe'],{encoding:'utf8',windowsHide:true})).stdout.trim().split(/\r?\n/)[0];
 config.gitDirectory=path.dirname(executable);config.publisherBaseEnvironment=publisherEnvironment(process.env,config.gitDirectory,config.publisherBaseEnvironment);config.controlProtocol='teruisi-main-control-v2';
 if(updateOnlyConfig)assert.deepEqual(config,updateOnlyConfig,'Exact update cannot change other publisher configuration');
 const gitSpec={executable:path.resolve(executable),sha256:sha(await fs.readFile(executable))},policy=await hooksPolicy(config.repository,gitSpec);assert.ok(policy.local===null||policy.local===policy.hooks,'Foreign local hooksPath cannot be changed');assert.equal(policy.effective,policy.local,'Inherited/custom hooksPath cannot be changed');const common=policy.common,hook=path.join(common,'hooks/reference-transaction'),oldHook=await exists(hook)?await bytes(hook):null;
 let retirementConfigRaw=configRaw;if(config.preparationRetirementCompatibility){const c=config.preparationRetirementCompatibility;assert.equal(c.version,retirementConfigVersion);assert.match(c.sourceConfigSha256??'',/^[a-f0-9]{64}$/);retirementConfigRaw=await bytes(path.join(config.stateDirectory,'retirement-configs',c.sourceConfigSha256+'.json'));assert.equal(sha(retirementConfigRaw),c.sourceConfigSha256);}else {assert.equal(updateOnlyConfig,null,'First retirement protocol adoption cannot be mixed with exact native/dependency updates');if(JSON.parse(configRaw).controlProtocol==='teruisi-main-control-v2')assert.deepEqual(config,JSON.parse(configRaw),'First retirement capability adoption must preserve existing v2 runtime inputs before any material is written');config.preparationRetirementCompatibility={version:retirementConfigVersion,sourceConfigSha256:sha(configRaw)};}
 assert.ok(!oldHook||/^#!\/bin\/sh\r?\n# TERUISI main-prebuild v[12]:/.test(oldHook.toString()),'Third-party reference hook cannot be overwritten');
 // Discover unsupported mature layouts before creating any install intent.
 // Adoption still performs its fresh controller/evidence census under locks.
 await nativeOperationBindings(config.releaseDirectory??path.join(config.stateDirectory,'unused'));
 await assertRetirementConfigUpgrade(config.stateDirectory,sha(configRaw),sha(Buffer.from(JSON.stringify(config,null,2)+'\n')));
 const artifactLoss=await artifactLossUpgradeMaterial(config.stateDirectory,artifactLossManifestFile);
 await fs.mkdir(out,{recursive:false});await fs.mkdir(path.join(out,'bundle/tools'),{recursive:true});const files={};
 await fs.writeFile(path.join(out,'RETIREMENT-OLD-CONFIG.json'),retirementConfigRaw,{flag:'wx'});
 await fs.writeFile(path.join(out,'CONTROL-OLD-CONFIG.json'),configRaw,{flag:'wx'});
 if(artifactLoss)await fs.writeFile(path.join(out,artifactLossManifestName),artifactLoss.raw,{flag:'wx'});
 if(dependencyUpdateRaw){await fs.writeFile(path.join(out,'DEPENDENCY-UPDATE.json'),dependencyUpdateRaw,{flag:'wx'});await fs.writeFile(path.join(out,'DEPENDENCIES.json'),dependencyReceiptRaw,{flag:'wx'});await fs.writeFile(path.join(out,'DEPENDENCY-OLD-CONFIG.json'),configRaw,{flag:'wx'});}
 if(nativeToolsUpdateRaw){await fs.writeFile(path.join(out,'NATIVE-TOOLS-UPDATE.json'),nativeToolsUpdateRaw,{flag:'wx'});await fs.writeFile(path.join(out,'NATIVE-TOOLS-OLD-CONFIG.json'),configRaw,{flag:'wx'});}
 for(const name of controlFiles){const raw=await bytes(path.join(sourceRoot,'tools',name));files['tools/'+name]=sha(raw);await fs.writeFile(path.join(out,'bundle/tools',name),raw,{flag:'wx'});}
 const bundleSha256=sha(Buffer.from(canonical(files))),bundleRoot=path.join(config.stateDirectory,'control-bundles',bundleSha256);
 const manifest={version:'teruisi-main-control-bundle-v2',preparationRetirementProtocol:retirementIntentVersion,preparationRetirementRefProtocol:retirementRefProtocol,preparationTriggerMode,bundleSha256,sourceCommit:await git(sourceRoot,['rev-parse','HEAD']),sourceTree:await git(sourceRoot,['rev-parse','HEAD^{tree}']),files};
 if(artifactLoss)Object.assign(manifest,{preparedArtifactLossProtocol:artifactLossProtocol,artifactLossManifestSha256:artifactLoss.sha256});
 const bundleManifestSha256=await durableCreate(path.join(out,'bundle/MANIFEST.json'),manifest),dispatcher=path.join(config.stateDirectory,'control/tools/publish-latest-main.mjs'),oldHookEntry=path.join(config.stateDirectory,'control/tools/main-prebuild-hook.mjs');
 const preparationTask=await makePreparationTask(path.resolve(configFile),config);
 const oldInstallationRaw=await exists(path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'))?await bytes(path.join(config.stateDirectory,'CONTROL-INSTALLATION.json')):null;
 const oldInstallation=oldInstallationRaw?JSON.parse(oldInstallationRaw):null;
 if(oldInstallationRaw)await fs.writeFile(path.join(out,'CONTROL-OLD-INSTALLATION.json'),oldInstallationRaw,{flag:'wx'});
 const oldPreparationTask=oldInstallation?.version==='teruisi-main-control-installation-v3'?oldInstallation.preparationTask:null;
 const predecessorDefinition=await readPreparationTask(preparationTask);let predecessorState;
 if(restoreDisabledPreparationTask){assert.equal(oldInstallation.status,'adopted');assertDisabledPreparationPredecessor(predecessorDefinition,oldPreparationTask);predecessorState=await assertDisabledPreparationRecovery(preparationTask,oldPreparationTask,predecessorDefinition);}
 else assert.deepEqual(predecessorDefinition,oldPreparationTask?.definition??null,'Preparation task is not the exact owned predecessor');
 const configNew=Buffer.from(JSON.stringify(config,null,2)+'\n'),finalHook=Buffer.from(shell(path.join(bundleRoot,'tools/main-prebuild-hook.mjs'),path.resolve(configFile),'manual-only preparation; retired refs fenced.')),
  bridgeHook=Buffer.from(shell(path.join(bundleRoot,'tools/main-prebuild-hook.mjs'),path.resolve(configFile),'manual-only retirement-fenced transition bridge.'));
 if(restoreDisabledPreparationTask)assert.equal(sha(configNew),sha(configRaw),'Disabled task recovery cannot change configuration bytes');
 const template=await bytes(path.join(out,'bundle/tools/main-control-dispatch.mjs'));
 assert.ok(template.toString().includes('const legacyBridge = null;'),'Control bridge template changed');
 const shim=Buffer.from(template.toString().replace('const legacyBridge = null;','const legacyBridge = '+JSON.stringify({fixedCli:dispatcher,oldHook:oldHookEntry,configFile:path.resolve(configFile)})+';'));
 for(const [name,raw] of [['CONFIG.json',configNew],['HOOK',finalHook],['BRIDGE-HOOK',bridgeHook],['SHIM.mjs',shim]])await fs.writeFile(path.join(out,name),raw,{flag:'wx'});
 const installId=randomUUID(),intent={version:'teruisi-main-control-upgrade-v2',installId,configFile:path.resolve(configFile),stateDirectory:path.resolve(config.stateDirectory),repository:config.repository,bundleRoot,bundleSha256,bundleManifestSha256,
  preparationTask,oldPreparationTask,...(restoreDisabledPreparationTask?{restoreDisabledPreparationTask:true,oldPreparationTaskDefinition:predecessorDefinition,oldPreparationTaskState:predecessorState}:{}),sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree,dispatcher,dispatcherSha256:sha(shim),hook,hookSha256:sha(finalHook),bridgeHookSha256:sha(bridgeHook),configSha256:sha(configNew),retirementConfigSha256:sha(retirementConfigRaw),retirementHooks:{version:retirementRefProtocol,common:policy.common,hooks:policy.hooks,beforeLocal:policy.local,git:gitSpec},
  old:{dispatcher:await hashOrMissing(dispatcher),hook:oldHook?sha(oldHook):null,config:sha(configRaw),installation:await hashOrMissing(path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'))},...(dependencyUpdateRaw?{dependencyUpdateSha256:sha(dependencyUpdateRaw)}:{}),...(nativeToolsUpdateRaw?{nativeToolsUpdateSha256:sha(nativeToolsUpdateRaw)}:{}),preparedAt:new Date().toISOString()};
 if(artifactLoss)intent.artifactLossManifestSha256=artifactLoss.sha256;
 const intentSha256=await durableCreate(path.join(out,'INTENT.json'),intent);
 await durableCreate(path.join(out,'PREPARED.json'),{version:'teruisi-main-control-upgrade-prepared-v2',installId,intentSha256,bundleManifestSha256,adoptionPerformed:false});
 return {status:'bundle-prepared',directory:out,installId,intentSha256,bundleManifestSha256,adoptionPerformed:false};
}
/** Read-only material validation, also used by isolated build-only protocol checks. */
export async function readControlUpgradeMaterials(directory){return readMaterials(directory);}
async function readMaterials(directory){
 const raw=await bytes(path.join(directory,'INTENT.json')),intent=JSON.parse(raw),prepared=JSON.parse(await bytes(path.join(directory,'PREPARED.json')));assert.equal(intent.version,'teruisi-main-control-upgrade-v2');assert.equal(prepared.version,'teruisi-main-control-upgrade-prepared-v2');assert.equal(prepared.intentSha256,sha(raw));assert.equal(prepared.installId,intent.installId);assert.equal(prepared.adoptionPerformed,false);
 const manifestRaw=await bytes(path.join(directory,'bundle/MANIFEST.json')),manifest=JSON.parse(manifestRaw);assert.equal(sha(manifestRaw),intent.bundleManifestSha256);assert.equal(manifest.bundleSha256,intent.bundleSha256);assert.deepEqual(Object.keys(manifest.files).sort(),controlFiles.map(name=>'tools/'+name).sort());
 assert.equal(manifest.preparationRetirementProtocol,retirementIntentVersion,'Control materials cannot remove retirement admission');assert.equal(manifest.preparationRetirementRefProtocol,retirementRefProtocol,'Control materials cannot remove native retired-target fence');
 if(intent.artifactLossManifestSha256){
  assert.equal(manifest.preparedArtifactLossProtocol,artifactLossProtocol);assert.equal(manifest.artifactLossManifestSha256,intent.artifactLossManifestSha256,'Control materials changed artifact loss binding');
  const lossRaw=await bytes(path.join(directory,artifactLossManifestName));assert.equal(sha(lossRaw),intent.artifactLossManifestSha256);const loss=JSON.parse(lossRaw);assert.equal(lossRaw.toString(),canonical(loss));validateArtifactLossManifest(loss);assert.equal(path.resolve(loss.queueDirectory),path.join(intent.stateDirectory,'prebuild-queue-v2'));
 }else {assert.equal(manifest.artifactLossManifestSha256,undefined,'Unbound artifact loss manifest');assert.equal(manifest.preparedArtifactLossProtocol,undefined,'Unbound artifact loss capability');}
 if(intent.old.installation){
  const previousRaw=await bytes(path.join(directory,'CONTROL-OLD-INSTALLATION.json'));assert.equal(sha(previousRaw),intent.old.installation,'Control installation preimage changed');const previous=JSON.parse(previousRaw);
  if(previous.status==='adopted'){
   const previousManifestRaw=await bytes(path.join(previous.bundleRoot,'MANIFEST.json'));assert.equal(sha(previousManifestRaw),previous.bundleManifestSha256);const previousManifest=JSON.parse(previousManifestRaw);
   if(previousManifest.artifactLossManifestSha256){assert.equal(manifest.preparedArtifactLossProtocol,artifactLossProtocol,'Successor cannot drop artifact loss capability');assert.equal(intent.artifactLossManifestSha256,previousManifest.artifactLossManifestSha256,'Successor cannot drop or replace its bound artifact loss manifest');}
  }
 }
 for(const [name,expected] of Object.entries(manifest.files))assert.equal(sha(await bytes(path.join(directory,'bundle',...name.split('/')))),expected,'Prepared closure changed');
 for(const [name,expected] of [['CONFIG.json',intent.configSha256],['HOOK',intent.hookSha256],['BRIDGE-HOOK',intent.bridgeHookSha256],['SHIM.mjs',intent.dispatcherSha256]])assert.equal(sha(await bytes(path.join(directory,name))),expected);
 const config=JSON.parse(await bytes(path.join(directory,'CONFIG.json')));
 assert.equal(intent.retirementHooks.version,retirementRefProtocol);assert.equal(path.resolve(intent.retirementHooks.git.executable),path.join(config.gitDirectory,'git.exe'));assert.equal(intent.retirementConfigSha256,config.preparationRetirementCompatibility.sourceConfigSha256);assert.equal(config.preparationRetirementCompatibility.version,retirementConfigVersion);const originalConfig=await bytes(path.join(directory,'RETIREMENT-OLD-CONFIG.json'));assert.equal(sha(originalConfig),intent.retirementConfigSha256);const previousConfigRaw=await bytes(path.join(directory,'CONTROL-OLD-CONFIG.json'));assert.equal(sha(previousConfigRaw),intent.old.config);const previousConfig=JSON.parse(previousConfigRaw);if(previousConfig.preparationRetirementCompatibility)assert.deepEqual(config.preparationRetirementCompatibility,previousConfig.preparationRetirementCompatibility);else {assert.equal(config.preparationRetirementCompatibility.sourceConfigSha256,sha(previousConfigRaw));if(previousConfig.controlProtocol==='teruisi-main-control-v2'){const stripped={...config};delete stripped.preparationRetirementCompatibility;assert.deepEqual(stripped,previousConfig,'Prepared first retirement adoption changed incident runtime inputs');}}if(!intent.dependencyUpdateSha256&&!intent.nativeToolsUpdateSha256){const normalized={...previousConfig,gitDirectory:path.dirname(intent.retirementHooks.git.executable),publisherBaseEnvironment:publisherEnvironment({},config.gitDirectory,previousConfig.publisherBaseEnvironment??config.publisherBaseEnvironment),controlProtocol:'teruisi-main-control-v2',preparationRetirementCompatibility:config.preparationRetirementCompatibility};assert.deepEqual(config,normalized,'Control protocol changed inputs beyond its existing normalized environment and retirement binding');}
 if(intent.dependencyUpdateSha256){
  const updateRaw=await bytes(path.join(directory,'DEPENDENCY-UPDATE.json'));assert.equal(sha(updateRaw),intent.dependencyUpdateSha256);
  const update=JSON.parse(updateRaw),receiptRaw=await bytes(path.join(directory,'DEPENDENCIES.json'));assert.equal(sha(receiptRaw),update.receiptSha256);
  const previousRaw=await bytes(path.join(directory,'DEPENDENCY-OLD-CONFIG.json'));assert.equal(sha(previousRaw),intent.old.config,'Archived dependency predecessor changed');
  const expected=await validateDependencyUpdate(update,JSON.parse(receiptRaw),JSON.parse(previousRaw),intent.old.config);
  assert.deepEqual(config,expected,'Dependency material changed unrelated publisher configuration');
 }
 if(intent.nativeToolsUpdateSha256){
  assert.equal(intent.dependencyUpdateSha256,undefined,'Mixed native/dependency update intent refused');
  const updateRaw=await bytes(path.join(directory,'NATIVE-TOOLS-UPDATE.json'));assert.equal(sha(updateRaw),intent.nativeToolsUpdateSha256);
  const previousRaw=await bytes(path.join(directory,'NATIVE-TOOLS-OLD-CONFIG.json'));assert.equal(sha(previousRaw),intent.old.config,'Native tools predecessor archive changed');
  const expected=await validateNativeToolsUpdate(JSON.parse(updateRaw),JSON.parse(previousRaw),intent.old.config);
  assert.deepEqual(config,expected,'Native tools material changed unrelated publisher configuration');
 }
 if(intent.restoreDisabledPreparationTask!==undefined){
  assert.equal(intent.restoreDisabledPreparationTask,true);assertDisabledPreparationPredecessor(intent.oldPreparationTaskDefinition,intent.oldPreparationTask);
  assert.deepEqual(intent.oldPreparationTaskState,{state:1,instances:0},'Disabled recovery preimage must be Disabled with no instances');
  const preimageRaw=await bytes(path.join(directory,'CONTROL-OLD-INSTALLATION.json'));assert.equal(sha(preimageRaw),intent.old.installation,'Owned installation preimage changed');
  const preimage=JSON.parse(preimageRaw);assert.equal(preimage.status,'adopted');assert.equal(preimage.version,'teruisi-main-control-installation-v3');assert.deepEqual(preimage.preparationTask,intent.oldPreparationTask,'Disabled task is not owned by the exact predecessor');
  assert.equal(intent.configSha256,intent.old.config,'Disabled recovery changed configuration');assert.equal(manifest.preparationTriggerMode,'manual-only','Disabled recovery requires manual-only successor');
 }else {assert.equal(intent.oldPreparationTaskDefinition,undefined,'Unbound disabled task preimage');assert.equal(intent.oldPreparationTaskState,undefined,'Unbound disabled task state');}
 assert.equal(path.resolve(config.stateDirectory),path.resolve(intent.stateDirectory));assert.equal(config.repository,intent.repository);
 assert.equal(path.resolve(intent.configFile),path.resolve(intent.stateDirectory,'main-publisher-config.json'));
 assert.equal(path.resolve(intent.dispatcher),path.resolve(intent.stateDirectory,'control/tools/publish-latest-main.mjs'));
 assert.equal(path.resolve(intent.bundleRoot),path.resolve(intent.stateDirectory,'control-bundles',intent.bundleSha256));
 const common=await git(intent.repository,['rev-parse','--path-format=absolute','--git-common-dir']);assert.equal(path.resolve(intent.hook),path.resolve(common,'hooks/reference-transaction'));
 return {intent,intentSha256:sha(raw),manifest,config};
}

export function normalizeControlPath(value){return path.resolve(value).replaceAll('\\','/').replace(/\/{2,}/g,'/').toLowerCase();}
export async function nativeOperationBindings(releaseDirectory){
 if(!await exists(releaseDirectory))return [];
 const result=[],directories=[],diagnostics=[];let inspected=0;
 const identity=stat=>[stat.dev,stat.ino,stat.birthtimeMs];
 const fileIdentity=stat=>[...identity(stat),stat.size,stat.mtimeMs,stat.ctimeMs,stat.nlink];
 const physicalStat=async file=>{
  const stat=await fs.lstat(file);assert.ok(!stat.isSymbolicLink(),'Release operation evidence redirected');
  assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase(),'Release evidence path redirected');return stat;
 };
 const directory=async(file,list=true)=>{
  const stat=await physicalStat(file);assert.ok(stat.isDirectory(),'Release evidence directory is not ordinary');
  const names=list?(await fs.readdir(file)).sort():null;
  inspected+=names?.length??0;assert.ok(inspected<=100000,'Release operation evidence exceeds bound');
  directories.push({file,identity:identity(stat),names});return names;
 };
 const records=async file=>{
  const names=await directory(file);
  for(const name of names.filter(name=>name.endsWith('-started.json'))){
   const evidence=path.join(file,name),before=await physicalStat(evidence);assert.ok(before.isFile()&&before.nlink===1,'Unsafe release operation evidence');
   const handle=await fs.open(evidence,'r');let raw;
   try{assert.deepEqual(fileIdentity(await handle.stat()),fileIdentity(before),'Release operation evidence replaced');raw=await handle.readFile();assert.deepEqual(fileIdentity(await handle.stat()),fileIdentity(before),'Release operation evidence changed');}finally{await handle.close();}
   assert.deepEqual(fileIdentity(await physicalStat(evidence)),fileIdentity(before),'Release operation evidence changed');
   const value=JSON.parse(raw);
   if(value.script!==undefined||value.action!==undefined){
    assert.ok(typeof value.script==='string'&&path.isAbsolute(value.script)&&typeof value.action==='string'&&Number.isFinite(Date.parse(value.at)),'Native operation identity is incomplete');
    // A result never makes an extant controller unrelated. JSON and its
    // operation hash come from the same read, without traversing source.
    result.push({script:normalizeControlPath(value.script),action:value.action.toLowerCase(),startedAt:value.at,operationSha256:sha(raw),evidencePathSha256:sha(evidence)});
   }
  }
  return names;
 };
 for(const name of await directory(releaseDirectory)){
  const packet=path.join(releaseDirectory,name),stat=await physicalStat(packet);if(!stat.isDirectory())continue;
  const names=await directory(packet);
  // Source can contain the preparation's legitimate dependency junction.
  // Check its root identity, but never enumerate or follow any descendants.
  if(names.includes('source'))await directory(path.join(packet,'source'),false);
  for(const name of names.filter(name=>name.startsWith('publish-'))){
   const publish=path.join(packet,name);
   // This exact diagnostic leaf is not a native operation container. Keep
   // rejecting links, directories and every other publish-* non-directory.
   if(name==='publish-main-check.log'){
    const diagnostic=await physicalStat(publish);assert.ok(diagnostic.isFile()&&diagnostic.nlink===1,'Unsafe publish-main-check diagnostic log');diagnostics.push({file:publish,identity:identity(diagnostic)});continue;
   }
   const published=await records(publish);
   if(published.includes('resume-'+knownResume.maintenanceId))await records(path.join(publish,'resume-'+knownResume.maintenanceId));
   if(published.includes('preparation')){
    const preparation=path.join(publish,'preparation'),prepared=await records(preparation);
    for(const name of prepared.filter(name=>name.startsWith('verify-')))await records(path.join(preparation,name));
   }
  }
 }
 for(const saved of directories){assert.deepEqual(identity(await physicalStat(saved.file)),saved.identity,'Release evidence directory replaced');if(saved.names)assert.deepEqual((await fs.readdir(saved.file)).sort(),saved.names,'Release evidence directory changed');}
 for(const saved of diagnostics){const diagnostic=await physicalStat(saved.file);assert.ok(diagnostic.isFile()&&diagnostic.nlink===1,'Unsafe publish-main-check diagnostic log');assert.deepEqual(identity(diagnostic),saved.identity,'Publish-main-check diagnostic identity changed');}
 return result;
}
export async function controlProcessSnapshot(intent,known=new Map()){
 const code='@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,@{Name="CreationDate";Expression={if($null -ne $_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{$null}}},ExecutablePath,CommandLine)|ConvertTo-Json -Depth 3 -Compress';
 const environment={...process.env,PSModulePath:path.join(process.env.SYSTEMROOT??process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
 const output=await execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16*1024*1024,env:environment}),rows=JSON.parse(output.stdout);
 const prefix=path.resolve(intent.stateDirectory).replaceAll('\\','/').toLowerCase(),config=JSON.parse(await bytes(intent.configFile)),releaseRoot=path.resolve(config.releaseDirectory??path.join(intent.stateDirectory,'unused')),releasePrefix=normalizeControlPath(releaseRoot),selected=new Map(),operations=await nativeOperationBindings(releaseRoot);
 for(const row of rows){if(row.ProcessId===process.pid)continue;const text=decoded(row.CommandLine),operation=operations.find(item=>text.includes(item.script)&&text.includes(item.action));if(text.includes(normalizeControlPath(intent.hook))||text.includes(prefix+'/control/tools/')||text.includes(prefix+'/control-bundles/')||(text.includes(releasePrefix+'/')&&(/\/source\/tools\//.test(text)||/publish-main|process-deadline|manual-maintenance/.test(text)))||operation||known.has(row.ProcessId))selected.set(row.ProcessId,{...row,operation});}
 for(let changed=true;changed;){changed=false;for(const row of rows)if(row.ProcessId!==process.pid&&selected.has(row.ParentProcessId)&&!selected.has(row.ProcessId)){selected.set(row.ProcessId,row);changed=true;}}
 const result=[];for(const row of selected.values()){assert.ok(row.CommandLine&&row.ExecutablePath&&row.CreationDate,'Related control process identity unknown');const birth=String(row.CreationDate);if(known.has(row.ProcessId))assert.equal(known.get(row.ProcessId),birth,'Control PID reused');known.set(row.ProcessId,birth);result.push({pid:row.ProcessId,parentPid:row.ParentProcessId,createdAt:birth,commandLineSha256:sha(row.CommandLine),executableSha256:sha(await fs.readFile(row.ExecutablePath)),operationSha256:row.operation?.operationSha256??null});}return result;
}
export async function adoptControlUpgrade(options={}){return adoptControlUpgradeInternal(options);}
export async function adoptControlUpgradeForTest(options={}){
 const {intent}=await readMaterials(options.directory),privateRoot=path.resolve(intent.stateDirectory).toLowerCase();
 assert.ok(privateRoot.startsWith(path.resolve(process.env.TEMP??process.env.TMP).toLowerCase()+path.sep)||privateRoot.startsWith('d:\\codex-artifacts\\'),'Private test state required');
 const parent=path.dirname(privateRoot),relative=path.relative(parent,path.resolve(intent.repository).toLowerCase());assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Private test repository required');
 return adoptControlUpgradeInternal(options,'\\\\.\\pipe\\TERUISI.Test.ControlRotation.'+sha(privateRoot));
}
async function adoptControlUpgradeInternal({directory,resume=false,timeoutMs=30000,onStage=async()=>{}}={},privateRotationPipe){
 const {intent,intentSha256,manifest,config}=await readMaterials(directory),stateFile=path.join(intent.stateDirectory,'CONTROL-INSTALLATION.json'),installed=await exists(stateFile)?JSON.parse(await bytes(stateFile)):null;
 if(installed?.status==='adopted'&&installed.installId===intent.installId){const {readAdoptedControl}=await import('./main-control-dispatch.mjs');await readAdoptedControl(intent.configFile,intent.bundleRoot);return {status:'already-adopted',installId:intent.installId,adoptionPerformed:false};}
 const assertInstallationCas=async()=>{
  const current=await hashOrMissing(stateFile);if(current===intent.old.installation)return;
  assert.ok(resume,'Explicit same-intent resume required');
  const raw=await bytes(stateFile),value=JSON.parse(raw);assert.equal(raw.toString(),JSON.stringify(value)+'\n','Installation JSON is duplicated or noncanonical');
  assert.deepEqual(Object.keys(value).sort(),['installId','intentSha256','status','version']);
  assert.equal(value.version,'teruisi-main-control-installation-v2');assert.equal(value.status,'installing');assert.equal(value.installId,intent.installId);assert.equal(value.intentSha256,intentSha256,'Installation intent changed');
 };
 await assertInstallationCas();
 const target=path.join(intent.stateDirectory,'control-upgrades',intent.installId);await fs.mkdir(target,{recursive:true});
 for(const name of ['INTENT.json','PREPARED.json','RETIREMENT-OLD-CONFIG.json','CONTROL-OLD-CONFIG.json',...(intent.old.installation?['CONTROL-OLD-INSTALLATION.json']:[]),...(intent.artifactLossManifestSha256?[artifactLossManifestName]:[]),...(intent.nativeToolsUpdateSha256?['NATIVE-TOOLS-UPDATE.json','NATIVE-TOOLS-OLD-CONFIG.json']:[])]){const raw=await bytes(path.join(directory,name)),destination=path.join(target,name);if(await exists(destination))assert.equal(sha(await bytes(destination)),sha(raw));else await fs.writeFile(destination,raw,{flag:'wx'});}
 for(const [name,expected] of Object.entries(manifest.files)){const destination=path.join(intent.bundleRoot,...name.split('/'));await fs.mkdir(path.dirname(destination),{recursive:true});if(await exists(destination))assert.equal(sha(await bytes(destination)),expected,'Immutable bundle differs');else await fs.copyFile(path.join(directory,'bundle',...name.split('/')),destination,1);}
 const destManifest=path.join(intent.bundleRoot,'MANIFEST.json');if(await exists(destManifest))assert.equal(sha(await bytes(destManifest)),intent.bundleManifestSha256);else await fs.copyFile(path.join(directory,'bundle/MANIFEST.json'),destManifest,1);
 if(intent.artifactLossManifestSha256){const destination=path.join(intent.bundleRoot,artifactLossManifestName);if(await exists(destination))assert.equal(sha(await bytes(destination)),intent.artifactLossManifestSha256);else await fs.copyFile(path.join(directory,artifactLossManifestName),destination,1);}
 await onStage('S0');const deadlineUnixMs=Date.now()+Math.min(timeoutMs,1800000),policy={requestId:intentSha256,deadlineUnixMs},unlocks=[];
 const oldPipe='\\\\.\\pipe\\TERUISI.MainPrebuild.'+sha(path.resolve(intent.stateDirectory,'prebuild-queue').toLowerCase());
 try{
  for(const pipe of [oldPipe,queuePipe(path.join(intent.stateDirectory,'prebuild-queue-v2')),privateRotationPipe??'\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'])unlocks.push(await acquirePreparationRotationLock(pipe,policy));
  const either=async(file,allowed)=>assert.ok(allowed.includes(await hashOrMissing(file)),'Upgrade predecessor/step drift: '+file);
  await either(intent.dispatcher,[intent.old.dispatcher,...(resume?[intent.dispatcherSha256]:[])]);await either(intent.hook,[intent.old.hook,...(resume?[intent.bridgeHookSha256,intent.hookSha256]:[])]);await either(intent.configFile,[intent.old.config,...(resume?[intent.configSha256]:[])]);
  await assertInstallationCas();
  if(intent.artifactLossManifestSha256){const loss=JSON.parse(await bytes(path.join(directory,artifactLossManifestName)));assertArtifactLossBindings(loss,path.join(intent.stateDirectory,'prebuild-queue-v2'),await readPreparationQueueStructure(path.join(intent.stateDirectory,'prebuild-queue-v2')));}
  await assertRetirementConfigUpgrade(intent.stateDirectory,intent.old.config,intent.configSha256);
  if(intent.dependencyUpdateSha256||intent.nativeToolsUpdateSha256)assert.equal((await readMaterials(directory)).intentSha256,intentSha256,'Exact update materials changed under installation locks');
 const taskResume=resume&&await hashOrMissing(stateFile)!==intent.old.installation;
 const oldPolicy=await hooksPolicy(intent.repository,intent.retirementHooks.git);assertHooksPolicy(oldPolicy,intent.retirementHooks,{allowUnset:true});assert.equal(oldPolicy.local,resume?oldPolicy.local:intent.retirementHooks.beforeLocal);if(intent.restoreDisabledPreparationTask)await assertDisabledPreparationRecovery(intent.preparationTask,intent.oldPreparationTask,intent.oldPreparationTaskDefinition,{resume:taskResume});
  await onStage('S1');await atomic(intent.hook,await bytes(path.join(directory,'BRIDGE-HOOK')));await retirementGit(intent.repository,['config','--local','core.hooksPath',intent.retirementHooks.hooks],intent.retirementHooks.git);assertHooksPolicy(await hooksPolicy(intent.repository,intent.retirementHooks.git),intent.retirementHooks);await onStage('S1a');
  await atomic(intent.dispatcher,await bytes(path.join(directory,'SHIM.mjs')));await onStage('S2');
  await assertInstallationCas();
  const installingRaw=Buffer.from(JSON.stringify({version:'teruisi-main-control-installation-v2',status:'installing',installId:intent.installId,intentSha256})+'\n');
  await atomic(stateFile,installingRaw);await onStage('S3');
  const assertOwnInstalling=async()=>assert.equal(await hashOrMissing(stateFile),sha(installingRaw),'Installation pointer drifted during adoption');
  await assertOwnInstalling();
  const originalFile=path.join(intent.stateDirectory,'retirement-configs',intent.retirementConfigSha256+'.json');await fs.mkdir(path.dirname(originalFile),{recursive:true});if(await exists(originalFile))assert.equal(await hashOrMissing(originalFile),intent.retirementConfigSha256);else await fs.writeFile(originalFile,await bytes(path.join(directory,'RETIREMENT-OLD-CONFIG.json')),{flag:'wx'});assertHooksPolicy(await hooksPolicy(intent.repository,intent.retirementHooks.git),intent.retirementHooks);await atomic(intent.configFile,await bytes(path.join(directory,'CONFIG.json')));await atomic(intent.hook,await bytes(path.join(directory,'HOOK')));
  await atomic(path.join(intent.stateDirectory,'准备main.bat'),Buffer.from(bat(intent.dispatcher,'--prepare-only')));await atomic(path.join(intent.stateDirectory,'发布main.bat'),Buffer.from(bat(intent.dispatcher,'')));await atomic(path.join(intent.stateDirectory,'查看打包状态.bat'),Buffer.from(bat(path.join(intent.bundleRoot,'tools/main-prebuild-status.mjs'),'')));await onStage('S4');
  const frames=[],known=new Map();let empty=0;
  for(;;){const related=await controlProcessSnapshot(intent,known);frames.push({at:new Date().toISOString(),related});empty=related.length===0?empty+1:0;if(empty>=3)break;if(Date.now()>=deadlineUnixMs){const blocked={version:'teruisi-main-control-blocked-v2',installId:intent.installId,intentSha256,privateTestTopology:privateRotationPipe!==undefined,frames,reason:'legacy-control-window-not-converged'};await durableCreate(path.join(target,'BLOCKED-'+randomUUID()+'.json'),blocked);throw Error('Legacy control window has not converged; installation remains blocked');}await new Promise(resolve=>setTimeout(resolve,250));}
  await assertOwnInstalling();
  assertHooksPolicy(await hooksPolicy(intent.repository,intent.retirementHooks.git),intent.retirementHooks);
  for(const [file,expected] of [[intent.dispatcher,intent.dispatcherSha256],[intent.hook,intent.hookSha256],[intent.configFile,intent.configSha256]])assert.equal(await hashOrMissing(file),expected);
  for(const [name,expected] of Object.entries(manifest.files))assert.equal(await hashOrMissing(path.join(intent.bundleRoot,...name.split('/'))),expected);await onStage('S5');
  if(intent.dependencyUpdateSha256||intent.nativeToolsUpdateSha256)assert.equal((await readMaterials(directory)).intentSha256,intentSha256,'Exact update materials changed before adoption');
  await installPreparationTask(intent.preparationTask,intent.oldPreparationTask,{resume:intent.restoreDisabledPreparationTask?taskResume:resume,...(intent.restoreDisabledPreparationTask?{disabledPredecessor:intent.oldPreparationTaskDefinition}:{})});await onStage('TASK');
  const proof={version:'teruisi-main-control-transition-v2',installId:intent.installId,intentSha256,lockOrder:['v1-queue','v2-queue','native-rotation'],privateTestTopology:privateRotationPipe!==undefined,rotationPipeSha256:sha(privateRotationPipe??'\\\\.\\pipe\\TERUISI.Worker.ReleaseRotation.v1'),frames,legacyWindowConverged:true,productionDeploymentPerformed:false};
  const proofFile=path.join(target,'TRANSITION-'+randomUUID()+'.json');await durableCreate(proofFile,proof);
  const state={version:'teruisi-main-control-installation-v3',preparationTask:intent.preparationTask,status:'adopted',installId:intent.installId,intentSha256,bundleRoot:intent.bundleRoot,bundleSha256:intent.bundleSha256,bundleManifestSha256:intent.bundleManifestSha256,dispatcherSha256:intent.dispatcherSha256,hook:intent.hook,hookSha256:intent.hookSha256,configSha256:intent.configSha256,transitionProofFile:proofFile,transitionProofSha256:sha(await bytes(proofFile)),adoptedAt:new Date().toISOString()};
  await assertOwnInstalling();
  await atomic(stateFile,Buffer.from(JSON.stringify(state)+'\n'));while(unlocks.length)await unlocks.pop()();await onStage('S6');await onStage('S7');
  return {status:'adopted',installId:intent.installId,bundleSha256:intent.bundleSha256,adoptionPerformed:true,productionDeploymentPerformed:false};
 }finally{while(unlocks.length)await unlocks.pop()();}
}
async function main(){const {values}=parseArgs({options:{config:{type:'string'},out:{type:'string'},adopt:{type:'string'},resume:{type:'boolean'},'dependency-update':{type:'string'},'native-tools-update':{type:'string'},'restore-disabled-preparation-task':{type:'boolean'},'artifact-loss-manifest':{type:'string'}}});assert.ok(!values.adopt||(!values['dependency-update']&&!values['native-tools-update']&&!values['restore-disabled-preparation-task']&&!values['artifact-loss-manifest']),'Exact updates must be sealed during material preparation');console.log(JSON.stringify(values.adopt?await adoptControlUpgrade({directory:path.resolve(values.adopt),resume:values.resume}):await prepareControlUpgrade({configFile:values.config,out:values.out,dependencyUpdateFile:values['dependency-update'],nativeToolsUpdateFile:values['native-tools-update'],restoreDisabledPreparationTask:values['restore-disabled-preparation-task'],artifactLossManifestFile:values['artifact-loss-manifest']})));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
