import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateLiveWslAssociation,hostAssociationEvidenceSha256} from './live-wsl-host-policy.mjs';
const raw=await readFile('E:/codex-artifacts/release-site-blockers-20261011/WSL_HOST_ASSOCIATION_ADMIN_V1.json');
assert.equal(createHash('sha256').update(raw).digest('hex'),hostAssociationEvidenceSha256);
const original=JSON.parse(raw),epoch={bootId:'4a67b065-2648-48ef-8821-72f272ceb41d',pid1Start:'122',osrelease:'6.18.33.2-microsoft-standard-WSL2'};
// Controlled proposed live-frame fixture. The original unproven record is never
// rewritten; changed header/status are only test inputs, not field acceptance.
function frame(){const v=structuredClone(original);v.version='teruisi-live-wsl-host-association-v1';v.record.status='association-metadata-collected-not-admission';v.record.failure=null;v.record.matchingRuntimeIds=[v.record.runtimeGuidCandidates[0]];return v;}
test('exact observed nullable schema plus explicit live producer shape and guest epoch',()=>{assert.equal(validateLiveWslAssociation(frame(),frame(),epoch).kind,'exact-live-host-guest-association');});
test('original failed diagnostic is never retroactively accepted',()=>{assert.throws(()=>validateLiveWslAssociation(original,original,epoch));});
const cases=[
 ['HCS start success but completion failed',v=>{v.record.hcsAfter.completionStatus=-2143878885;}],
 ['missing RuntimeOsType is not explicit observed null',v=>{delete v.record.hcsBefore.wslSystems[0].runtimeOsType;}],
 ['invented Linux HCS field rejected',v=>{v.record.hcsBefore.wslSystems[0].runtimeOsType='Linux';}],
 ['different VM RuntimeId',v=>{v.record.hcsAfter.wslSystems[0].runtimeId='00000000-0000-0000-0000-000000000000';}],
 ['empty HCS systems',v=>{v.record.hcsAfter.wslSystems=[];}],
 ['multiple WSL owners',v=>{v.record.hcsAfter.wslSystems.push({...v.record.hcsAfter.wslSystems[0]});}],
 ['wrong owner',v=>{v.record.hcsAfter.wslSystems[0].owner='other';}],
 ['stopped VM',v=>{v.record.hcsAfter.wslSystems[0].state='Stopped';}],
 ['same PID but parent restarted',v=>{v.record.parentCreationFileTime='134360870964681910';}],
 ['extra GUID in same command',v=>{v.record.runtimeGuidCandidates.push('00000000-0000-0000-0000-000000000000');}],
 ['matching GUID but different command bytes',v=>{v.record.commandSha256='0'.repeat(64);}],
 ['same hashes in different argv positions',v=>{v.record.commandArgumentShape.reverse();}],
 ['non-system parent',v=>{v.record.imagePath='D:\\vmwp.exe';}],
 ['parent image changed',v=>{v.record.imageSha256='0'.repeat(64);}],
 ['native query failed',v=>{v.record.commandStatusFirst=-1;}],
 ['unstable final identity',v=>{v.record.identityStable=false;}]
];
for(const [name,change] of cases)test(name,()=>{const a=frame(),b=frame();change(b);assert.throws(()=>validateLiveWslAssociation(a,b,epoch));});
test('host birth cannot stand in for guest boot epoch',()=>{const bad={...epoch,btime:'1791613496'};assert.throws(()=>validateLiveWslAssociation(frame(),frame(),bad));});
