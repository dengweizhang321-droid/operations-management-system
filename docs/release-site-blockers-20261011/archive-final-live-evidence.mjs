import {readFile,readdir,writeFile,lstat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const src='E:/codex-artifacts/release-site-blockers-20261011',dest=fileURLToPath(new URL('./evidence/',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),entries=[];
async function copy(source,target){const info=await lstat(source);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<16*1024*1024);const raw=await readFile(source);let existing;try{existing=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(existing)assert.ok(existing.equals(raw),'Archived evidence cannot be silently replaced');else await writeFile(target,raw,{flag:'wx'});entries.push({source,target,sha256:hash(raw)});}
for(const name of await readdir(src))if(/^(ASTRA_|PRIMARY_|LIVE_REFERENCE_|SITE_AGY(?:8|9|10)_|FIRST_UNKNOWN_|SYSTEM_WSL_|FINAL_LIVE_|ADOPTION_BATCH_LIVE_|ADOPTION_TESTS_LIVE_|FRESH_LIVE_|CURRENT_RUNTIME_FINAL_|EFFECTIVE_CHAIN_FINAL_)/.test(name)&&/\.(json|log|txt|ndjson|ps1)$/.test(name))await copy(path.join(src,name),path.join(dest,name));
const observations=path.join(dest,'live-observations');await mkdir(observations,{recursive:true});
for(const name of await readdir(path.join(src,'_live-reference-observations')))if(name.endsWith('.json'))await copy(path.join(src,'_live-reference-observations',name),path.join(observations,name));
await writeFile(src+'/FINAL_LIVE_EVIDENCE_ARCHIVE_V1.json',JSON.stringify({at:new Date().toISOString(),entries},null,2)+'\n',{flag:'wx'});
await copy(src+'/FINAL_LIVE_EVIDENCE_ARCHIVE_V1.json',path.join(dest,'FINAL_LIVE_EVIDENCE_ARCHIVE_V1.json'));
console.log(JSON.stringify({archived:entries.length}));
