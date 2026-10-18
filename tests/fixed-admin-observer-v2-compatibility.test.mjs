import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const normalize=text=>text.replaceAll('\r\n','\n');
test('v2 observer qualification inverse restores exact 0be queue and freezes all other runtime files',async()=>{
 const base='0be03eca5006e40e1bbfa7edb30b66bbd8625deb',file='tools/main-prebuild-queue.mjs';
 const before=normalize(execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true})),after=normalize(await fs.readFile(file,'utf8'));
 const start=after.indexOf('const adminScopedObserverSha256='),end=after.indexOf('const controlNames=',start);assert.ok(start>=0&&end>start);
 assert.equal(createHash('sha256').update(after.slice(start,end)).digest('hex'),'862413e6d01b162adf621b0532c3697376ce2c1df3c5531a7882f9389f48d5a4');
 let restored=after.slice(0,start)+after.slice(end);
 restored=restored.replace("assert.ok(['teruisi-admin-rejection-observation-e2-v1','teruisi-admin-rejection-observation-e2-v2'].includes(observation.version));if(observation.version.endsWith('-v2'))adminValidateScopedObservation(observation);","assert.equal(observation.version,'teruisi-admin-rejection-observation-e2-v1');");
 restored=restored.replace("assert.equal(observation.observerCodeSha256,observation.version.endsWith('-v2')?adminScopedObserverSha256:adminApprovedObserverSha256);","assert.equal(observation.observerCodeSha256,adminApprovedObserverSha256);");
 restored=restored.replace('await object(JSON.parse(observationRaw).observerCodeSha256);','await object(adminApprovedObserverSha256);');assert.equal(restored,before);
 const paths=execFileSync('git',['diff',base,'--name-only'],{encoding:'utf8',windowsHide:true}).trim().split('\n');
 for(const changed of paths)assert.ok(changed===file||changed.startsWith('tests/')||changed.startsWith('docs/release-readiness-fixes-20261018/'),changed);
});
