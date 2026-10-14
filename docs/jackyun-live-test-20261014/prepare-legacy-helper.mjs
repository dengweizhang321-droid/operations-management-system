import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const source='D:\\codex-isolated\\jackyun-legacy-closure-source-20261014';
const tested=path.resolve(import.meta.dirname,'../..');
const out='D:/codex-artifacts/jackyun-live-test-20261014/legacy-helper-adoption';
const old='D:/codex-artifacts/jackyun-migration-adoption-20261013/direct-publication-final';
const currentRelease='D:/teruisi-runtime/teruisi-worker-sales/releases/20261013T145450Z-fe391dce49a258cf';
const django='D:/teruisi-runtime/django-sales/app/deployment.json',djangoSha='8b4fed2c3cb8e0206ae8cc492e15f9646ef2dbbd7bbccde2b386fe9770ce02ac';
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=async p=>sha(await fs.readFile(p));
await fs.mkdir(out); // Each preparation has a fresh evidence directory.
const record=(name,value)=>fs.writeFile(out+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const phase=async name=>{await fs.writeFile(out+'/progress.json',JSON.stringify({at:new Date().toISOString(),phase:name,productionSwitches:0}));console.log(name);};
try{
 await phase('verify_exact_helper_only_composition');
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),'');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),'5f7475f9f9a497f70bb91acc480c9aa38d5e297e');
 const previous=JSON.parse(await fs.readFile(old+'/candidate-composition.json','utf8'));
 const changed=['lib/jackyun/preflight-recovery.ts','tests/jackyun-automatic-preflight-recovery.test.ts'];
 const inventory={};
 for(const [file,hash] of Object.entries(previous.afterInventory)){
  const value=await digest(path.join(source,file));inventory[file]=value;
  assert.equal(value,changed.includes(file)?await digest(path.join(tested,file)):hash,'Unexpected candidate difference: '+file);
 }
 const receipt=JSON.parse(await fs.readFile(currentRelease+'/audit/helper-build-receipt.json','utf8'));
 assert.equal(await digest(currentRelease+'/audit/helper-build-receipt.json'),'9a444520920b89ccbb8e3a182b1e97a9f3a5fa2eae9e0045f804d8d6fa212d4c');
 for(const item of receipt.evidence.inputFiles)assert.equal(await digest(path.join(source,item.relativePath)),await digest(path.join(tested,item.relativePath)),'Tested helper dependency differs: '+item.relativePath);
 for(const file of ['tests/jackyun-preflight-recovery.test.ts','tests/jackyun-unified-pipeline.test.ts','tests/fixtures/jackyun-unified-recovery.ts'])assert.equal(await digest(path.join(source,file)),await digest(path.join(tested,file)));
 const testLog=await fs.readFile('D:/codex-artifacts/jackyun-live-test-20261014/legacy-closure-focused-regression.log');
 assert.match(testLog.toString('utf8'),/pass 49/);assert.match(testLog.toString('utf8'),/fail 0/);assert.match(testLog.toString('utf8'),/cancelled 0/);
 await record('composition.json',{source,sourceCommit:'5f7475f9f9a497f70bb91acc480c9aa38d5e297e',mainFixCommit:'8f9aefd26dd947dac64e782db52dd71d6596ac86',changed,inventory,verifiedHelperInputs:receipt.evidence.inputFiles.length,testLogSha256:sha(testLog),tests:{passed:49,failed:0,cancelled:0},djangoRetained:djangoSha});
 assert.equal(await digest(django),djangoSha);
 const release=await import(pathToFileURL(source+'/tools/worker-local-release.mjs'));
 const rotation=await import(pathToFileURL(source+'/tools/worker-local-release-rotation.mjs'));
 assert.deepEqual([...(await release.listGitSourceFiles(source))].sort(),Object.keys(inventory).sort());
 const chain=await rotation.resolveEffectiveReleaseChain({verifyInstalledHead:true});
 assert.equal(chain.head.releaseId,'20261013T145450Z-fe391dce49a258cf');assert.equal(chain.head.manifestSha256,'51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d');
 await phase('bind_fresh_preparation_identity');
 const identity=await release.workerPreparationIdentity(source);
 const binding=release.canonicalJson({version:release.workerSourceBindingVersion,sourceRoot:source,sourceRootPathSha256:release.windowsPathSha256(source),predecessor:chain.head,predecessorChainStateSha256:chain.chainStateSha256,identity})+'\n';
 const file=out+'/source-binding.json';await fs.writeFile(file,binding,{flag:'wx'});
 await phase('original_online_worker_preparation');
 const plan=await rotation.planWorkerReleaseRotation({prepareOnline:true,sourceBindingFile:file,sourceBindingSha256:sha(binding)});
 await record('worker-plan.json',plan);assert.equal(await digest(django),djangoSha);
 await record('result.json',{status:'prepared_not_deployed',workerPlanSha256:plan.planSha256,candidateReleaseId:plan.candidateReleaseId,candidateManifestSha256:plan.candidateManifestSha256,djangoUnchanged:djangoSha});
 await phase('prepared_not_deployed');
}catch(error){await record('failure.json',{status:'preparation_failed',error:error.message,productionSwitches:0});await phase('failed');throw error;}
