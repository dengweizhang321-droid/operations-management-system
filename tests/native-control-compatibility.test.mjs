import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {nativeControlScopeMatches,nativeControlQualification as q,aiRepairIntegrationQualification,aiRepairIntegrationScopeMatches} from '../tools/verify-release-candidate.mjs';
import {nativeControlApplication,verifyNativeControlEvidence} from '../tools/verify-native-control-evidence.mjs';

const row=(status,file,mode='100644')=>[':'+(status==='A'?'000000':'100644')+' '+mode+' '+'a'.repeat(40)+' '+'b'.repeat(40)+' '+status,file];
const required=[
 ['M','tools/manual-maintenance-continuation.mjs'],['M','tools/manual-maintenance-process.psm1'],
 ['M','tools/native-isolation.ps1'],['M','tools/verify-release-candidate.mjs'],['A','tools/verify-native-control-evidence.mjs'],
 ['A','tests/native-maintenance-pins.ps1'],['A','tests/native-isolation-qualification.test.mjs'],
 ['A','tests/native-isolation-credential-gate.test.mjs'],['A','tests/native-control-compatibility.test.mjs'],
];
test('native qualification is limited to its frozen application and exact reviewed tail',()=>{
 const good=required.flatMap(([status,file])=>row(status,file));
 assert.equal(q.application,nativeControlApplication.commit);assert.equal(q.tree,nativeControlApplication.tree);
 assert.equal(nativeControlScopeMatches(good,q.base),true);
 assert.equal(nativeControlScopeMatches([...good,...row('A','docs/ai-native-control-isolation-20261108/REPORT.html')],q.base),true);
 assert.equal(nativeControlScopeMatches(good,'0'.repeat(40)),false);
 for(const bad of [good.slice(2),[...good,...good.slice(0,2)],[...good,'truncated'],
  [...good,...row('M','tools/django-local-service.ps1')],[...good,...row('M','backend/pi_runner/server.py')],
  [...good,...row('A','docs/another-task/REPORT.md')],
  [...good.slice(0,-2),...row('A',q.test,'120000')],[...good.slice(0,-2),...row('A',q.test,'100755')]])
  assert.equal(nativeControlScopeMatches(bad,q.base),false);
 assert.equal(aiRepairIntegrationQualification.application,'557b497dc0fe42f3693a0c6c76320a4833b46b49');
 assert.equal(aiRepairIntegrationScopeMatches(good,q.base),false,'Old integration qualification must not admit new controller bytes');
});

test('a hand-written passed summary cannot replace the pinned native originals',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-evidence-rejection-')),file=path.join(root,'fake.json');
 t.after(async()=>{await fs.unlink(file);await fs.rmdir(root);});
 await fs.writeFile(file,JSON.stringify({version:'teruisi-native-isolation-evidence-v1',nativeColdStart:true,status:'passed'}));
 await assert.rejects(verifyNativeControlEvidence({applicationRoot:'unreached',candidateRoot:'unreached',evidenceFile:file}),/Native evidence anchor changed/);
});
