/**
 * Exercises inspectMainPublication against the two real original attempt
 * directories named in the task brief, copied read-only to a fresh sibling
 * directory under the same fixed release-packages root (never the
 * originals, never written to, removed again after each test — see
 * copyFixture below for why a generic OS temp directory will not do).
 *
 * c7604df9's fixture has its later-added SUCCESS.json and reconciliation/
 * directory stripped to restore the pristine failure-at-启动服务 state (those
 * were written hours later by a one-off manual recovery tool, not by the
 * original failed publication).
 *
 * Because production has since moved past this exact historical state
 * (newer Worker releases and a newer installed Django deployment.json have
 * landed on top of it), context.sha and context.rotation are overridden for
 * the two paths outside `out` whose real current bytes no longer match this
 * attempt's own preparation record — everything inside `out` itself (and the
 * frozen `source` git checkout under it) is read for real, unmodified aside
 * from the literal path repoint described below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectMainPublication} from '../tools/publish-main-resume.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=async p=>{try{await fs.access(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const REAL_RELEASE_PACKAGES='D:/codex-isolated/main-release-packages';

// A plain recursive copy that skips any reparse point (junction/symlink)
// entirely, rather than trying to recreate one: the real source checkout
// under each attempt directory has a node_modules junction pointing at the
// shared dependencies cache, which fs.cp({verbatimSymlinks:true}) cannot
// recreate without elevated privilege, and which inspectMainPublication's
// own git calls (assertFrozenSource) never need.
async function copyTree(srcDir,destDir){
 await fs.mkdir(destDir,{recursive:true});
 for(const entry of await fs.readdir(srcDir,{withFileTypes:true})){
  const src=path.join(srcDir,entry.name),dest=path.join(destDir,entry.name);
  if(entry.isSymbolicLink())continue;
  if(entry.isDirectory())await copyTree(src,dest);
  else await fs.copyFile(src,dest);
 }
}
// inspectMainPublication cross-checks `out` against the real absolute path
// baked into the original STARTED.json's own `source` field
// (packet===path.dirname(source), out===path.join(packet,'publish-'+commit)),
// so the copy has to live under the real fixed release-packages root, not a
// generic OS temp directory, to satisfy that internal consistency check the
// same way A1's resume-branch path check does. This creates/removes only its
// own uniquely-named sibling directory; no real attempt directory under that
// root is ever read as anything but a copy source, written to, or removed.
//
// A handful of this attempt's own JSON records (STARTED.json and a few
// native-step -started.json entries) also embed that same real packet
// directory's absolute path as a recorded string value (e.g. the DeployApp
// script path, not merely directory structure), which inspectMainPublication
// cross-checks against `source`. Every literal occurrence of the real packet
// path is rewritten to this copy's own path below — a pure string
// substitution, not a semantic edit, and the only change made to any
// record's content besides removing SUCCESS.json/reconciliation/ in the caller.
async function repointEmbeddedPacketPaths(root,realPacketDir){
 // Raw JSON text escapes each backslash as two characters, so the on-disk
 // byte sequence for a Windows path is "\\\\" (JSON string "\\") per path
 // separator, not the single backslash path.join() returns; the forward-
 // slash form is searched for too since some records use it unescaped.
 const needle1=realPacketDir.replaceAll('/','\\').replaceAll('\\','\\\\'),needle2=realPacketDir.replaceAll('\\','/');
 const replacement1=root.replaceAll('/','\\').replaceAll('\\','\\\\'),replacement2=root.replaceAll('\\','/');
 async function walk(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){await walk(full);continue;}
   if(!entry.name.endsWith('.json'))continue;
   const text=await fs.readFile(full,'utf8');
   if(!text.includes(needle1)&&!text.includes(needle2))continue;
   const rewritten=text.split(needle1).join(replacement1).split(needle2).join(replacement2);
   await fs.writeFile(full,rewritten);
  }
 }
 await walk(root);
}
async function copyFixture(t,realDirName){
 const root=path.join(REAL_RELEASE_PACKAGES,'.teruisi-resume-test-fixture-'+Date.now().toString(36)+Math.random().toString(36).slice(2));
 t.after(async()=>{
  const packagesResolved=path.resolve(REAL_RELEASE_PACKAGES);
  assert.ok(path.resolve(root).startsWith(path.join(packagesResolved,'.teruisi-resume-test-fixture-')),'unsafe fixture cleanup path');
  await fs.rm(root,{recursive:true,force:true});
 });
 const realPacketDir=path.join(REAL_RELEASE_PACKAGES,realDirName);
 await copyTree(realPacketDir,root);
 await repointEmbeddedPacketPaths(root,realPacketDir);
 return root;
}

// Fix 1 (coordinator-reviewed): the real c7604df9 fixture's own
// 启动服务-process.json independently proves a clean, non-timeout nonzero
// exit (outputProtocol:'direct-exit-files', code:'nonzero_exit', exitCode:1,
// timeoutType:null, signal:null, treeCleanupPending:false) with a processId
// matching FAILED.json's own processEvidence.processId, and FAILED.json's
// phase is exactly '启动服务' with maintenanceStarted:true — the narrow
// failed_known predicate in stage() (tools/publish-main-resume.mjs), scoped
// to the allowlisted, independently-idempotent '启动服务'/'确认启动版本'
// controller actions only. This test exercises the real fixture end to end.
async function buildC7604df9Fixture(t,{corruptTimeout=false}={}){
 const root=await copyFixture(t,'c7604df99c55-d5a6a3fb-06d27651-r2');
 const out=path.join(root,'publish-c7604df99c55');
 // Restore pristine failure state: SUCCESS.json and reconciliation/ were
 // written hours later by the one-off manual recovery tool, not by the
 // original failed publication being tested here.
 await fs.rm(path.join(out,'SUCCESS.json'),{force:true});
 await fs.rm(path.join(out,'reconciliation'),{recursive:true,force:true});

 // Sanity-check the real evidence this test's conclusion rests on, so a
 // future change to the real attempt directory (or a copy/repoint bug)
 // fails loudly here instead of this test silently testing the wrong thing.
 assert.equal(await exists(path.join(out,'启动服务-started.json')),true);
 assert.equal(await exists(path.join(out,'启动服务-result.json')),false);
 const processFile=path.join(out,'启动服务-process.json');
 const processRecord=await read(processFile);
 assert.equal(processRecord.processEvidence.code,'nonzero_exit');
 assert.equal(processRecord.processEvidence.timeoutType,null);

 if(corruptTimeout){
  // Negative variant: the same fixture, but with this one evidence field
  // changed so it reads as an ambiguous/timeout outcome instead of a known
  // clean failure. Must stay 'unknown' and be refused, same as before Fix 1.
  processRecord.processEvidence.timeoutType='direct-exit';
  processRecord.processEvidence.code='process_timeout';
  await fs.writeFile(processFile,JSON.stringify(processRecord,null,2)+'\n');
 }

 const prepared=await read(path.join(out,'preparation/PREPARED.json'));
 const request=await read(path.join(root,'main-release-request.json'));
 const started=await read(path.join(out,'STARTED.json'));

 // Historical, byte-exact values for the two paths outside `out` that real
 // production has since moved past (newer Django/Worker releases landed on
 // top of this attempt's own target). Taken from this attempt's own
 // preparation/request records, not invented.
 const installedDeploymentSha256=prepared.djangoManifestSha256;
 const preparedAppReceiptSha256=prepared.djangoPackage.receiptSha256;
 const installed='D:/teruisi-runtime/django-sales/app';
 const runtime='D:/teruisi-runtime/teruisi-worker-sales';

 const context={
  installedRoot:installed,workerRuntimeRoot:runtime,
  sha:async file=>{
   const name=path.basename(file);
   if(name==='deployment.json'&&path.resolve(file)===path.resolve(path.join(installed,'deployment.json')))return installedDeploymentSha256;
   if(name.startsWith('app.prepare-')&&name.endsWith('.json'))return preparedAppReceiptSha256;
   return sha(await fs.readFile(file));
  },
  assertRetired:async()=>{},
  // This real attempt DOES have a piRunnerUpgrade (confirmed: Pi genuinely
  // upgraded in the 11-10 run, before the Pandas switch and the later
  // 启动服务 failure -- PiUpgrade-completed.json on disk proves it). R2 only
  // skips observePi when piRunnerUpgrade is absent from PREPARED; it is
  // present here, so observePi legitimately runs. Report the real,
  // already-completed Pi state (windows_complete) rather than throwing.
  observePi:async upgrade=>({registeredPlanSha256:upgrade.registeredPlanSha256,sourceSha256:upgrade.sourceSha256,image:upgrade.image,status:'windows_complete',postconditionsVerified:true}),
  api:{workerRuntimeRoot:runtime},transport:{},
  rotation:{
   assertActiveBatchOwnership:async()=>{},
   // WorkerApply is 'completed' in this fixture (real 11-10 state: the
   // front end had already switched before 启动服务 failed), so the live
   // chain this mock reports must be the NEW candidate release, matching
   // inspectMainPublication's own :231 check -- not the old predecessor.
   resolveEffectiveReleaseChain:async()=>({head:{releaseId:prepared.workerPlan.candidateReleaseId,manifestSha256:prepared.workerPlan.candidateManifestSha256},chainStateSha256:started.predecessorChainStateSha256}),
  },
 };
 return {out,prepared,context};
}
test('c7604df9 real fixture: failed-at-启动服务 is now resumable, with 启动服务 reclassified as failed_known and the exact expected remaining plan',async t=>{
 const {out,prepared,context}=await buildC7604df9Fixture(t);
 const result=await inspectMainPublication(out,context);
 assert.equal(result.status,'resumable');
 assert.equal(result.canResume,true);
 assert.equal(result.steps['启动服务'].state,'failed_known');
 assert.match(result.steps['启动服务'].processSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.failedKnownLabel.label,'启动服务');
 assert.match(result.failedKnownLabel.processSha256,/^[a-f0-9]{64}$/);
 const remaining=Object.entries(result.steps).filter(([,v])=>v.state!=='completed').map(([label])=>label);
 assert.deepEqual(remaining,['启动服务','确认启动版本','核验Pandas Broker原启动回执']);
 assert.equal(result.steps['WorkerApply'].state,'completed');
 assert.equal(result.steps['退出维护'].state,'completed');
 assert.equal(result.pandasSwitchReceipt.status,'switched_stopped');
});
test('c7604df9 real fixture negative: 启动服务-process.json read as a timeout/ambiguous outcome stays unknown and is refused',async t=>{
 const {out,context}=await buildC7604df9Fixture(t,{corruptTimeout:true});
 await assert.rejects(inspectMainPublication(out,context),/步骤已开始但结果未知，不能重放：启动服务/);
});

test('6719d1807ef7 real fixture (no Pi, no Pandas, already succeeded) returns recorded_complete and is not rejected for missing Pi',async t=>{
 const root=await copyFixture(t,'6719d1807ef7-4b8e3cdb-49ff2e8b');
 const out=path.join(root,'publish-6719d1807ef7');
 const prepared=await read(path.join(out,'preparation/PREPARED.json'));
 assert.equal(prepared.piRunnerUpgrade,undefined,'fixture sanity: this attempt must have no Pi upgrade');
 assert.equal(prepared.pandasBrokerRotation,undefined,'fixture sanity: this attempt must have no Pandas rotation');

 const installed='D:/teruisi-runtime/django-sales/app',runtime='D:/teruisi-runtime/teruisi-worker-sales';
 const context={
  installedRoot:installed,workerRuntimeRoot:runtime,
  assertRetired:async()=>{},
  observePi:async()=>{throw Error('observePi must not be called for a no-Pi preparation');},
  api:{workerRuntimeRoot:runtime},transport:{},
  rotation:{assertActiveBatchOwnership:async()=>{},resolveEffectiveReleaseChain:async()=>{throw Error('must not be reached: recorded_complete returns before the chain check');}},
 };
 const result=await inspectMainPublication(out,context);
 assert.equal(result.status,'recorded_complete');
 assert.equal(result.canResume,false);
 assert.equal(result.success.status,'deployed_and_ready');
});
