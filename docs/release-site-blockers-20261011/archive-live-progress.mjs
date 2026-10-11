import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const files=['ADMIN_RESIDUAL_METADATA_V2.json','ASTRA_RESIDUAL_METADATA_V2_CROSSCHECK.json',
 'CURRENT_RUNTIME_ADMIN_FOLLOWUP.json','EFFECTIVE_CHAIN_ADMIN_FOLLOWUP.json',
 'HCS_METADATA_CURRENT_V1.json','WSL_HOST_ASSOCIATION_ORDINARY_V1.json','WSL_HOST_ASSOCIATION_ADMIN_V1.json',
 'PRIMARY_WSL_HOST_OBSERVATION_CROSSCHECK_V1.json','SYSTEM_WSL_IDENTITY_V1.json',
 'WSL_HOST_READONLY_PACKET_V1.json','WSL_HOST_READONLY_PACKET_V2.json','WSL_HOST_READONLY_BOOTSTRAP_V1.ps1','WSL_HOST_READONLY_BOOTSTRAP_V2.ps1',
 'RUN_READONLY_WSL_HOST_AUDIT_V1.cmd','RUN_READONLY_WSL_HOST_AUDIT_V2.cmd','WSL_HOST_READONLY_ENTRY_V1.json','WSL_HOST_READONLY_ENTRY_V2.json',
 'WSL_HOST_ENTRY_VERIFICATION_V1.json','WSL_HOST_ENTRY_VERIFICATION_V2.json','ASTRA_WSL_HOST_ENTRY_CHAIN_CHECK_V2.json',
 'ASTRA_LIVE_WSL_SHAPE_V1.json','ASTRA_LIVE_WSL_NAMESPACES_V1.json','ASTRA_LIVE_GUEST_FIRST_OBSERVATION.json','ASTRA_LIVE_GUEST_FLAGS_OBSERVATION.json',
 'ASTRA_LIVE_GUARD_CORE_HANDOFF_V1.json','ASTRA_LIVE_GUARD_CORE_HANDOFF_V2.json','ASTRA_LIVE_GUARD_CORE_HANDOFF_V3.json',
 'ASTRA_LIVE_CORE_WRAPPER_FIRST_TEST.log','ASTRA_LIVE_HCS_SYSTEM_INTEGRATION_FIRST_TEST.log','ASTRA_LIVE_GUARD_V2_FINAL_TEST.log','ASTRA_LIVE_GUARD_V3_FINAL_TEST.log',
 'SITE_AGY5_PROMPT.txt','SITE_AGY5_STREAM.ndjson','SITE_AGY5_STDERR.log','SITE_AGY5_CALL.json',
 'SITE_AGY6_PROMPT.txt','SITE_AGY6_STREAM.ndjson','SITE_AGY6_STDERR.log','SITE_AGY6_CALL.json',
 'SITE_AGY7_PROMPT.txt','SITE_AGY7_STREAM.ndjson','SITE_AGY7_STDERR.log','SITE_AGY7_CALL.json',
 'LIVE_REFERENCE_READONLY_QUALIFICATION_V1.json','LIVE_REFERENCE_READONLY_BOOTSTRAP_V1.ps1','LIVE_REFERENCE_READONLY_BINDING_V1.json','PRIMARY_LIVE_REFERENCE_QUALIFICATION_FAILURE_V1.json'];
const archived=[],missing=[];
for(const name of files){let raw;try{raw=await readFile(root+name)}catch(e){if(e.code==='ENOENT'){missing.push(name);continue}throw e;}
 await writeFile(new URL('./evidence/'+name,import.meta.url),raw,{flag:'wx'});archived.push({name,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length});
}
for(const name of ['before-host','failure','inventory-summary','native','started']){
 const original='_live-reference-observations/7c6b889d-8d74-4538-b92b-8d2414e1b925-'+name+'.json';
 const raw=await readFile(root+original),target='FIRST_LIVE_AUDIT_'+name+'.json';
 await writeFile(new URL('./evidence/'+target,import.meta.url),raw,{flag:'wx'});archived.push({name:original,target,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length});
}
await writeFile(new URL('./evidence/LIVE_PROGRESS_ARCHIVE_V1.json',import.meta.url),JSON.stringify({archived,missing,scope:'Explicit allowlist raw evidence; missing files are recorded rather than fabricated.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:archived.length,missing}));
