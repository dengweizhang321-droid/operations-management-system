import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha} from '../tools/main-prebuild-queue.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url)),snapshot=path.join(repository,'.runtime/pinned-native'),driver=fileURLToPath(new URL('./fixtures/artifact-loss-native-lock-driver.mjs',import.meta.url));
test('the deployed D08 snapshot has the actual one-argument callback API and the fixed CLI uses the shared adapter',async()=>{
 const raw=await fs.readFile(path.join(snapshot,'tools/worker-local-release-rotation.mjs'),'utf8');assert.equal(sha(raw),'778c136602cf1ebb44fd2fbed1ee67a3cf24fbd78a2cc52b8541db5be114b556');assert.match(raw,/export async function withRotationLock\(operation\)/);assert.doesNotMatch(raw,/export (?:async )?function acquirePreparationRotationLock\(/);
 const publisher=await fs.readFile(new URL('../tools/publish-latest-main.mjs',import.meta.url),'utf8'),start=publisher.indexOf("if(values['retire-lost-artifacts'])"),end=publisher.indexOf("if(values['abandon-dispatch']!==undefined)",start),branch=publisher.slice(start,end);
 assert.ok(start>=0&&end>start);assert.match(branch,/await retireLostMainArtifacts\(config,/);assert.match(branch,/assertControlGeneration\(binding\)/);assert.match(branch,/assertRetirementAdmission\(config,/);assert.match(branch,/assertOrdinaryPreparationContext\(config\)/);
 const handler=publisher.slice(publisher.indexOf('export async function retireLostMainArtifacts'),publisher.indexOf('export async function runLatestMainCli'));
 assert.match(handler,/config\.nativeToolsSource/);assert.match(handler,/return rotation\.withRotationLock\(operation\);/);assert.doesNotMatch(handler,/acquirePreparationRotationLock|rotationLockPipe/);
});
for(const mode of ['success','throw-before-write','throw-after-record','busy','queue-busy','submission-busy','generation','admission','old-call'])test('real D08 native callback adapter: '+mode,async t=>{
 const temporary=path.join(repository,'.runtime/native-lock-tests');await fs.mkdir(temporary,{recursive:true});
 const child=spawnSync(process.execPath,[driver,mode],{cwd:repository,windowsHide:true,encoding:'utf8',timeout:45000,env:{...process.env,TEMP:temporary,TMP:temporary,TERUISI_NATIVE_LOCK_FIXTURE:snapshot}});
 assert.equal(child.status,0,child.stdout+child.stderr);const result=JSON.parse(child.stdout.trim());assert.equal(result.mode,mode);assert.equal(result.nativeExport,'withRotationLock');assert.equal(result.arity,1);assert.equal(result.forwardedProductionListens,0);assert.ok(result.mappedNativeListens>=2);assert.equal(result.allLocksReacquired,true);assert.equal(result.pendingUnchanged,true);
 t.diagnostic(child.stdout.trim());
});
