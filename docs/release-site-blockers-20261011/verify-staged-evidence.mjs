import {readFile} from 'node:fs/promises';import{spawnSync}from'node:child_process';import path from'node:path';import assert from'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/',base='docs/release-site-blockers-20261011/';
const archive=JSON.parse(await readFile(root+'FINAL_LIVE_EVIDENCE_ARCHIVE_V1.json'));
async function same(file,source){const relative=path.relative(process.cwd(),file).split(path.sep).join('/');const r=spawnSync('git',['show',':'+relative],{maxBuffer:16*1024*1024,windowsHide:true});assert.equal(r.status,0,relative);assert.ok(r.stdout.equals(await readFile(source)),relative);}
for(const e of archive.entries)await same(e.target,e.source);
const handoff=JSON.parse(await readFile(root+'ASTRA_LIVE_GUARD_CORE_HANDOFF_V6.json'));for(const e of handoff.files)await same(path.resolve(base,e.name),e.path);
console.log(JSON.stringify({archivedBlobBytesMatched:archive.entries.length,guardBlobBytesMatched:handoff.files.length}));
