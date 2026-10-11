import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const names=['ADMIN_READONLY_COMPLETED_V1.json','ADMIN_REFERENCE_DIAGNOSTIC_V1.json','ADMIN_CAPTURE_SUMMARY_V1.json',
 'ASTRA_ADMIN_RECORD_CROSSCHECK_V1.json','VISIBLE_ENTRY_BOOTSTRAP.ps1','VISIBLE_ENTRY_MANIFEST.json','RUN_READONLY_ADMIN_AUDIT.cmd',
 'RUNNING_WSL_REFERENCE_DIAGNOSTIC_V1.json','RUNNING_WSL_REFERENCE_DIAGNOSTIC_ROOT_V1.json',
 'ASTRA_RESIDUAL_METADATA_V1.json','ASTRA_SELF_METADATA_V1.json',
 'SITE_AGY3_PROMPT.txt','SITE_AGY3_STREAM.ndjson','SITE_AGY3_STDERR.log','SITE_AGY3_CALL.json','PS5_REVIEW_ARGV_TRANSPORT_V1.json'];
const manifest=[];
for(const name of names){
 const raw=await readFile(root+name);
 await writeFile(new URL('./evidence/'+name,import.meta.url),raw,{flag:'wx'});
 manifest.push({name,sha256:createHash('sha256').update(raw).digest('hex'),bytes:raw.length});
}
await writeFile(new URL('./evidence/ADMIN_FOLLOWUP_ARCHIVE_V1.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:manifest.length,rawBytesPreserved:true}));
