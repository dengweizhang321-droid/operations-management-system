import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {compareFixedAdminQueueChange,compareFixedPreparationAdmissionChange} from '../tools/verify-release-candidate.mjs';
test('fixed queue profile accepts only the exact reviewed helper and unresolved call',async()=>{
 const before=execFileSync('git',['show','aaca18485021b6f98107fe168b69c8f57d55ee46:tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true}),after=execFileSync('git',['show','7c0016da70bd0ddc3fe78627f3ffecbcb0d0bd87:tools/main-prebuild-queue.mjs'],{encoding:'utf8',windowsHide:true});
 assert.equal(compareFixedAdminQueueChange(before,after),true);
 assert.equal(compareFixedAdminQueueChange(before,await fs.readFile('tools/main-prebuild-queue.mjs','utf8')),false,'v2 is qualified separately against 0be, not by widening the original aaca profile');
 for(const changed of [after+'\nextraEffect();',after.replace('await observe()','await unrelatedEffect()'),after.replace("decision:'original-native-preparation-never-started-request-terminated'","decision:'prepared'"),after.replace('await adminReadResolution({file});return true','return true')])assert.equal(compareFixedAdminQueueChange(before,changed),false);
});
test('ordinary-user admission profile freezes fetch/dispatch/native routing and exact token query',async()=>{
 const before=execFileSync('git',['show','aaca18485021b6f98107fe168b69c8f57d55ee46:tools/publish-latest-main.mjs'],{encoding:'utf8',windowsHide:true}),after=execFileSync('git',['show','0be03eca5006e40e1bbfa7edb30b66bbd8625deb:tools/publish-latest-main.mjs'],{encoding:'utf8',windowsHide:true});
 assert.equal(compareFixedPreparationAdmissionChange(before,after),true);
 // The ordinary task launch changes more than this historical narrow slice.
 // Its current consumer must use the full compatibility profile.
 assert.equal(compareFixedPreparationAdmissionChange(before,await fs.readFile('tools/publish-latest-main.mjs','utf8')),false);
 for(const changed of [after.replace("result.stdout.trim(),'False'","result.stdout.trim(),'True'"),after.replace('admitPreparation:()=>admit(config),',''),after+'\nnewNativeCall();'])assert.equal(compareFixedPreparationAdmissionChange(before,changed),false);
});
