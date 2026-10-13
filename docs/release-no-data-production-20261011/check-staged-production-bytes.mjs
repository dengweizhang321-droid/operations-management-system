import{readFile}from'node:fs/promises';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const hash=b=>createHash('sha256').update(b).digest('hex'),git=args=>{const r=spawnSync('git',args,{windowsHide:true,maxBuffer:16777216});assert.equal(r.status,0);return r.stdout;};
const files=git(['diff','--cached','--name-only','-z']).toString().split('\0').filter(Boolean);
for(const name of files){assert.ok(name.startsWith('docs/release-no-data-production-20261011/'),'Unrelated staged file');assert.equal(hash(git(['show',':'+name])),hash(await readFile(name)),name+' blob/source bytes differ');}
const root='E:/codex-artifacts/release-site-blockers-20261011/production-f15d06a/';let evidence=0;
for(const [manifest,base]of [['FIRST_ATTEMPT_ARCHIVE.json','evidence/first-attempt/'],['PRE_SWITCH_ARCHIVE.json','evidence/pre-switch/'],['CONFIRMED_TRANSPORTS_ARCHIVE.json','evidence/confirmed-transports/'],['STOP_BLOCKER_ARCHIVE.json','evidence/stop-blocker/']]){
 const m=JSON.parse(await readFile('docs/release-no-data-production-20261011/evidence/'+manifest));
 for(const entry of m.entries){const target=entry.target??entry.rel??entry.name,source=entry.source??root+(entry.rel??entry.name);assert.equal(hash(await readFile(source)),entry.sha256);assert.equal(hash(await readFile('docs/release-no-data-production-20261011/'+base+target)),entry.sha256);evidence++;}
}
for(const [manifest,base]of [['evidence/ACTUAL_STOP_ARCHIVE.json','evidence/actual-stop-reconciliation/'],['evidence/actual-no-wsl/MANIFEST.json','evidence/actual-no-wsl/'],['evidence/actual-restore/MANIFEST.json','evidence/actual-restore/'],['evidence/morning-production/MANIFEST.json','evidence/morning-production/']]){
 const m=JSON.parse(await readFile('docs/release-no-data-production-20261011/'+manifest));
 for(const e of m.entries){if(/^[A-Za-z]:[\\/]/.test(e.source))assert.equal(hash(await readFile(e.source)),e.sha256);else assert.ok(manifest==='evidence/actual-restore/MANIFEST.json'&&e.name==='READBACK.json'&&e.source==='This read-only script','Unknown generated evidence source');assert.equal(hash(await readFile('docs/release-no-data-production-20261011/'+base+(e.target??e.name))),e.sha256);evidence++;}
}
console.log(JSON.stringify({stagedFiles:files.length,allStagedBlobBytesMatch:true,archivedEvidenceBytesMatch:evidence,productionAcceptanceClaimed:false}));
