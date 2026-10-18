import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const base=process.env.TERUISI_COMPATIBILITY_BASE??'7ca85e40c2857ede3a55c4fffda1b3945aeb4f1f';
function statements(text,allowed){
 const file=ts.createSourceFile('fixture.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 assert.equal(file.parseDiagnostics.length,0);
 return file.statements.filter(node=>!ts.isFunctionDeclaration(node)||!allowed.has(node.name?.text)).map(node=>node.getText(file).replaceAll('\r\n','\n'));
}
test('Worker static source reader changes leave all other runtime behavior byte-identical',async()=>{
 const file='tools/worker-local-release.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}),after=await fs.readFile(file,'utf8');
 const allowed=new Set(['verifyBoundWorkerSource','workerPreparationIdentity']);
 assert.deepEqual(statements(after,allowed),statements(before,allowed));
});
test('rotation waiting does not change apply/CAS/fence/process/entrypoint/startup boundaries',async()=>{
 const file='tools/worker-local-release-rotation.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}),after=await fs.readFile(file,'utf8');
 const allowed=new Set(['withRotationLock','acquireRotationLock','acquirePreparationRotationLock']);
 assert.deepEqual(statements(after,allowed),statements(before,allowed));
});
test('readiness changes preserve the native deploy/apply/start/ready callback after admitted maintenance',async()=>{
 const file='tools/publish-prepared-main.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).replaceAll('\r\n','\n');
 const after=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
 const policy=` const preparationDeadline=Math.min(Date.now()+1800000,Number(process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS)||Infinity);
 const preparationWait=context.prepareOnly?{requestId:digest(Buffer.from(JSON.stringify(request))),deadlineUnixMs:preparationDeadline}:undefined;
`;
 assert.ok(after.includes(policy));
 // Once the base already carries this reviewed policy, the whole file must
 // remain identical; stripping only the candidate would reject an unchanged file.
 const tail='    assert.equal(entered.status,\'maintenance\');assert.equal(entered.maintenanceId,maintenanceId);assert.equal(entered.postgresPreserved,true);';
 const oldTail=before.slice(before.indexOf(tail)),nextTail=after.slice(after.indexOf(tail));
 assert.ok(before.includes(tail)&&after.includes(tail));
 assert.equal(nextTail.replace(' },preparationWait);',' });'),oldTail.replace(' },preparationWait);',' });'));
});
