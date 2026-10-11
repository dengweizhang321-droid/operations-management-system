import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {classifyBoundOsInstance,nativeEvidenceBinding} from './live-os-instance-policy.mjs';
const bytes=await readFile('E:/codex-artifacts/release-site-blockers-20261011/ADMIN_RESIDUAL_METADATA_V2.json');
assert.equal(createHash('sha256').update(bytes).digest('hex'),nativeEvidenceBinding.evidenceSha256);
const records=JSON.parse(bytes).records;
function fixture(pid=1700){const n=structuredClone(records.find(r=>r.processId===pid));return {p:{ProcessId:pid,Name:n.name,SessionId:0,identityStable:true,cimCreationUtc:n.cimCreationUtc,ExecutablePath:n.imageEvidence?.actualPath??null},n,f:{kind:'process-unknown',processId:pid,reason:n.imageEvidence?'unproven-native-command-unreadable':'missing-or-invalid-executable'}};}
for(const pid of [236,280,1700,6548])test('exact reviewed native instance '+pid,()=>{const {p,n,f}=fixture(pid);assert.match(classifyBoundOsInstance(p,n,f).kind,/^reviewed-/);});
test('correct vmmem native tuple still requires guest supplement',()=>{const {p,n,f}=fixture(53880);assert.equal(classifyBoundOsInstance(p,n,f).kind,'requires-wsl-supplement');});
const mutations=[
 ['identified reference cannot be waived',v=>{v.f.kind='process';}],
 ['other PID/name cannot become OS exception',v=>{v.p.ProcessId=9000;}],
 ['reused PID native birth',v=>{v.n.nativeCreationFileTime='134355974136433727';}],
 ['live CIM birth drift',v=>{v.p.cimCreationUtc='2026-10-04T14:23:34.6433720Z';}],
 ['live unstable',v=>{v.p.identityStable=false;}],
 ['native query access denied',v=>{v.n.ntStatus=-1073741790;}],
 ['short layout',v=>{v.n.returnedLength=48;}],
 ['wrong basic PID',v=>{v.n.basicProcessId=1;}],
 ['unknown new flag',v=>{v.n.flags|=512;}],
 ['ordinary unprotected actor is not IUM',v=>{v.n.flags=0;v.n.isSecureProcess=false;}],
 ['signature valid alone insufficient',v=>{v.n.imageEvidence.sha256='0'.repeat(64);}],
 ['Microsoft-named copied image outside System32',v=>{v.n.imageEvidence.actualPath='D:\\LsaIso.exe';}],
 ['current captured image differs',v=>{v.p.ExecutablePath='D:\\LsaIso.exe';}],
 ['image moved during query',v=>{v.n.imageEvidence.postIdentityStable=false;}],
 ['signature invalid',v=>{v.n.imageEvidence.signatureStatus='HashMismatch';}],
 ['forged signer identity',v=>{v.n.imageEvidence.signerThumbprint='0'.repeat(40);}],
 ['unresolved path reason cannot be waived',v=>{v.f.reason='physical-path-unresolved';}],
 ['booleans cannot replace raw flags',v=>{delete v.n.flags;}],
 ['missing value is not numeric zero',v=>{delete v.n.ntStatus;}]
];
for(const [name,mutate] of mutations)test(name,()=>{const v=fixture();mutate(v);assert.throws(()=>classifyBoundOsInstance(v.p,v.n,v.f));});
test('kernel shape with new executable is refused',()=>{const v=fixture(236);v.p.ExecutablePath='C:\\Windows\\System32\\powershell.exe';assert.throws(()=>classifyBoundOsInstance(v.p,v.n,v.f));});
test('missing image cannot hide an explicit command reference',()=>{const v=fixture(236);v.p.CommandLine='C:\\Windows\\System32\\cmd.exe /c D:\\teruisi-runtime\\django-sales\\app.previous\\run.cmd';assert.throws(()=>classifyBoundOsInstance(v.p,v.n,v.f));});
test('opaque nonempty command cannot use kernel exception either',()=>{const v=fixture(236);v.p.CommandLine='encoded-or-relative-command';assert.throws(()=>classifyBoundOsInstance(v.p,v.n,v.f));});
