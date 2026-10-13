import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const names=['ADMIN_RESIDUAL_PACKET_V1.json','ADMIN_RESIDUAL_PACKET_V2.json',
 'ADMIN_RESIDUAL_BOOTSTRAP_V1.ps1','ADMIN_RESIDUAL_BOOTSTRAP_V2.ps1',
 'ADMIN_RESIDUAL_ENTRY_V1.json','ADMIN_RESIDUAL_ENTRY_V2.json','RUN_READONLY_RESIDUAL_AUDIT.cmd','RUN_READONLY_RESIDUAL_AUDIT_V2.cmd',
 'ADMIN_RESIDUAL_ENTRY_VERIFICATION_V2.json','ASTRA_RESIDUAL_V2_COMPILE.json','ASTRA_RESIDUAL_ENTRY_V2_CHAIN_CHECK.json',
 'SITE_AGY4_PROMPT.txt','SITE_AGY4_STREAM.ndjson','SITE_AGY4_STDERR.log','SITE_AGY4_CALL.json','NODE_REVIEW_ARGV_TRANSPORT_V1.json'];
const manifest=[];
for(const name of names){const raw=await readFile(root+name);await writeFile(new URL('./evidence/'+name,import.meta.url),raw,{flag:'wx'});manifest.push({name,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length});}
const firstFailure={packetSha256:'cea94364113ca5f7904313a15e10c3b73e59341fa1e257ba104f5ff8ba1b5d7e',
  check:'Ordinary-token native bootstrap intended to reach role refusal; failed earlier at packet hash',
  actualErrorId:'GetHistoryNoHistoryForId',reason:'H function shadowed by built-in h/Get-History alias',nativeTargetCalls:0,
  evidenceKind:'Summary of original tool output; original generator/bootstrap/verification source archived, not a replayed raw stderr',
  correction:'Unique function names; separately frozen V2 packet and ordinary-token refusal verified'};
await writeFile(root+'ADMIN_RESIDUAL_ENTRY_FIRST_FAILURE_V1.json',JSON.stringify(firstFailure,null,2)+'\n',{flag:'wx'});
await writeFile(new URL('./evidence/ADMIN_RESIDUAL_ENTRY_FIRST_FAILURE_V1.json',import.meta.url),await readFile(root+'ADMIN_RESIDUAL_ENTRY_FIRST_FAILURE_V1.json'),{flag:'wx'});
await writeFile(new URL('./evidence/RESIDUAL_PREPARATION_ARCHIVE_V1.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:manifest.length,rawBytesPreserved:true,firstFailurePreserved:true}));
