// Create-only copies of reviewed read-only harnesses, with final source/output pins.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url),out='E:/codex-artifacts/release-site-blockers-20261011/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(out+'ASTRA_LIVE_GUARD_CORE_HANDOFF_V6.json');
const handoff=JSON.parse(raw);
for(const f of handoff.files)assert.equal(hash(await readFile(f.path)),f.sha256);
for(const [before,after] of [['run-live-reference-qualification-v3.mjs','run-live-reference-qualification-v4.mjs'],['prepare-live-readonly-qualification-v3.mjs','prepare-live-readonly-qualification-v4.mjs']]){
 let text=await readFile(new URL(before,base),'utf8');
 text=text.replaceAll('_V3','_V4').replaceAll('-v3.mjs','-v4.mjs').replace('HANDOFF_V5','HANDOFF_V6');
 await writeFile(new URL(after,base),text,{flag:'wx'});
}
console.log(JSON.stringify({handoffSha256:hash(raw),files:handoff.files.length,productionActions:0}));
