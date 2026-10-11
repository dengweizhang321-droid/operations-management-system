// Task-specific, proposed live guard policy. This module grants no batch approval.
import assert from 'node:assert/strict';
const NONE=0xfffffffe;
const pinned=[
 {pid:236,name:'Secure System',birth:'134355974016662550',cim:'2026-10-04T14:23:21.6662550Z',flags:129,peb:true,level:5,reason:'missing-or-invalid-executable',kind:'reviewed-system-instance'},
 {pid:280,name:'Registry',birth:'134355974016977125',cim:'2026-10-04T14:23:21.6977120Z',flags:1,peb:true,level:5,reason:'missing-or-invalid-executable',kind:'reviewed-system-instance'},
 {pid:1700,name:'LsaIso.exe',birth:'134355974136433726',cim:'2026-10-04T14:23:33.6433720Z',flags:128,peb:false,level:NONE,reason:'unproven-native-command-unreadable',kind:'reviewed-ium-instance',image:'C:\\Windows\\System32\\LsaIso.exe',sha:'c6d056926edf6c5b531f1bb58a366794f95446bf35e40cf51c069bd068d0c967'},
 {pid:6548,name:'NgcIso.exe',birth:'134355974150851854',cim:'2026-10-04T14:23:35.0851850Z',flags:128,peb:false,level:NONE,reason:'unproven-native-command-unreadable',kind:'reviewed-ium-instance',image:'C:\\Windows\\System32\\NgcIso.exe',sha:'a35439fab7d5188fe047b580e6ed3aea547453718a4fa854524a8d1d2c213203'},
 {pid:53880,name:'vmmemWSL',birth:'134360870965622198',cim:'2026-10-10T06:24:56.5622190Z',flags:0,peb:true,level:NONE,reason:'missing-or-invalid-executable',kind:'requires-wsl-supplement'}
];
export const nativeEvidenceBinding=Object.freeze({
 packetSha256:'bb861c8fecab8e5652029c6c509daba48b767344a0c494ea39bd281a83c4b0e0',
 evidenceSha256:'0c0c0b4074403c8b7d1a53e9d4c4ffdbdb97802bed6827bcd13e70fb264cf4d6',
 probeSha256:'6cef0abc35f4c99300d9b36393add66191557715d14d3d4a930dc0627d0f3ff9'
});
export function validateKernelDeparture(process){
 assert.equal(process?.identityStable,false,'Stable live rows cannot be skipped as departures');
 const proof=process.departureProof;
 assert.equal(proof?.version,'teruisi-kernel-process-departure-v1');assert.equal(proof.processId,process.ProcessId);
 assert.ok(Number.isSafeInteger(process.ProcessId)&&process.ProcessId>4&&process.ProcessId<=2147483647);
 assert.equal(proof.accessMask,'0x1000');assert.equal(typeof proof.originalCimCreationUtc,'string');assert.ok(proof.originalCimCreationUtc.length>0);assert.equal(proof.originalCimCreationUtc,process.cimCreationUtc);
 if(proof.kind==='pid-absent'){
  assert.equal(proof.openError,87);assert.equal(proof.finalCimState,'absent');assert.equal(proof.exitQuerySucceeded,false);assert.equal(proof.exitCode,null);assert.equal(proof.reason,'kernel-invalid-pid-and-cim-absent');
  assert.equal(proof.nativeCreationBefore,null);assert.equal(proof.nativeCreationAfter,null);
 }else{
  assert.equal(proof.kind,'same-instance-exited');assert.equal(proof.openError,null);assert.equal(proof.exitQuerySucceeded,true);
  assert.ok(Number.isSafeInteger(proof.exitCode)&&proof.exitCode>=0&&proof.exitCode<=0xffffffff&&proof.exitCode!==259,'Active/ambiguous exit code cannot be departed');
  assert.match(proof.originalNativeCreationFileTime,/^[1-9][0-9]+$/);assert.equal(process.nativeCreationFileTime,proof.originalNativeCreationFileTime);
  assert.equal(proof.nativeCreationBefore,proof.originalNativeCreationFileTime);assert.equal(proof.nativeCreationAfter,proof.originalNativeCreationFileTime);
  assert.ok(['absent','same-instance'].includes(proof.finalCimState));assert.equal(proof.reason,'successful-kernel-exit-query-non259');
 }
 return {kind:'kernel-confirmed-departure',processId:process.ProcessId,proof:{...proof}};
}
export function classifyBoundOsInstance(process,native,finding){
 assert.equal(finding?.kind,'process-unknown','An identified reference cannot be overridden');
 const expected=pinned.find(p=>p.pid===process?.ProcessId);
 assert.ok(expected,'Process is outside the five reviewed instances');
 assert.equal(finding.processId,expected.pid);assert.equal(finding.reason,expected.reason,'Unsupported unknown reason');
 assert.equal(process.Name,expected.name);assert.equal(process.SessionId,0);assert.equal(process.identityStable,true);
 // The old predicate may stop at missing ExecutablePath before inspecting
 // CommandLine. Never let that early failure conceal a command/reference.
 assert.ok(process.CommandLine==null||process.CommandLine==='','A nonempty command cannot use this metadata-absence exception');
 assert.equal(process.cimCreationUtc,expected.cim,'Live CIM instance differs');
 assert.equal(native?.processId,expected.pid);assert.equal(native.name,expected.name);assert.equal(native.sessionId,0);
 assert.equal(native.nativeCreationFileTime,expected.birth);assert.equal(native.cimCreationUtc,expected.cim);
 assert.equal(native.accessMask,'0x1000');assert.equal(native.instanceMatchesBaseline,true);assert.equal(native.identityStable,true);
 for(const key of ['openError','timeBeforeError','timeAfterError','protectionError'])assert.equal(native[key],null,key);
 assert.equal(native.ntStatus,0);assert.equal(native.ntStatusHex,'00000000');assert.equal(native.returnedLength,64);assert.equal(native.structureSize,64);
 assert.equal(native.basicProcessId,expected.pid);assert.equal(native.layoutValid,true);assert.equal(native.pebIsNull,expected.peb);
 assert.equal(native.flags,expected.flags);assert.equal(native.flagsHex,expected.flags.toString(16).padStart(8,'0'));assert.equal(native.unknownFlagBits,0);
 assert.equal(native.isSecureProcess,!!(expected.flags&128));assert.equal(native.isProtectedProcess,!!(expected.flags&1));assert.equal(native.isSubsystemProcess,false);
 assert.equal(native.protectionSucceeded,true);assert.equal(native.protectionLevel,expected.level);assert.equal(native.protectionLevelHex,expected.level.toString(16).padStart(8,'0'));
 if(expected.image){
  // The live collector queries the image on the same native handle, holds its
  // exact system file open across hashing/signature, and brackets instance state.
  assert.equal(process.ExecutablePath?.toLowerCase(),expected.image.toLowerCase());
  const e=native.imageEvidence;assert.ok(e);assert.equal(e.status,'metadata-collected-not-admission');
  assert.equal(e.expectedPath,expected.image);assert.equal(e.actualPath,expected.image);assert.equal(e.sha256,expected.sha);
  assert.equal(e.queryError,null);assert.equal(e.failure,null);assert.equal(e.postIdentityStable,true);
  assert.equal(e.signatureStatus,'Valid');assert.equal(e.signerSubject,'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
  assert.equal(e.signerIssuer,'CN=Microsoft Windows Production PCA 2011, O=Microsoft Corporation, L=Redmond, S=Washington, C=US');
  assert.equal(e.signerThumbprint,'DC91E564D5BC1E3A8E02D6A8508682ABEA8A2443');
 } else assert.ok(process.ExecutablePath==null||process.ExecutablePath==='','A new user image cannot use a kernel/VM exception');
 // Even a correct native vmmem tuple is deliberately not an exemption.
 return Object.freeze({kind:expected.kind,processId:expected.pid,nativeCreationFileTime:expected.birth});
}
