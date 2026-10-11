import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url),root='E:/codex-artifacts/release-site-blockers-20261011/';
const runs=[['recheck-current-runtime.mjs','CURRENT_RUNTIME_FIRST.json','CURRENT_RUNTIME_ADMIN_FOLLOWUP.json'],
 ['recheck-effective-chain.mjs','EFFECTIVE_CHAIN_FIRST.json','EFFECTIVE_CHAIN_ADMIN_FOLLOWUP.json']];
for(const [name,before,after] of runs){
 const raw=await readFile(new URL(name,base),'utf8');
 assert.equal(raw.split(before).length,2);
 const captured=raw.replace(before,after);
 // Capture the already-reviewed read-only recheck bytes; only create-only output changes.
 const child=spawnSync(process.execPath,['--input-type=module','--eval',captured],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
 assert.equal(child.status,0,child.stderr);console.log(child.stdout.trim());
 await writeFile(root+after+'.source-binding.json',JSON.stringify({sourceName:name,originalSourceSha256:createHash('sha256').update(raw).digest('hex'),capturedSourceSha256:createHash('sha256').update(captured).digest('hex'),change:'Create-only audit output filename only',productionActionsRequested:0},null,2)+'\n',{flag:'wx'});
}
