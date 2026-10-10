import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const tag = process.argv[2];
assert.ok(['start','end'].includes(tag));
const root = new URL('./', import.meta.url);
const runtime = 'D:/teruisi-runtime/teruisi-worker-sales/state/';
const id = 'integration-ab-v2-20261010-c22d8dd69a';
const batchSha = '9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15';
const dir = runtime + 'release-batches/' + id;
const can = v => Array.isArray(v) ? `[${v.map(can).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${can(v[k])}`).join(',')}}` : JSON.stringify(v);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const observedStartUtc = new Date().toISOString();
const files = (await readdir(dir)).filter(f => /^\d{6}\.json$/.test(f)).sort();
let previous = null;
const events = [], latest = {};
for (let i = 0; i < files.length; i++) {
  assert.equal(files[i], String(i).padStart(6,'0') + '.json');
  const bytes = await readFile(dir + '/' + files[i]), e = JSON.parse(bytes);
  const { eventSha256, ...core } = e;
  assert.equal(e.batchSha256, batchSha);
  assert.equal(e.previous, previous);
  assert.equal(eventSha256, sha(can(core)));
  assert.equal(bytes.toString(), can(e) + '\n');
  previous = eventSha256;
  if (e.operationId) latest[e.operationId] = e.status;
  events.push(Object.fromEntries(['at','phase','status','reason','operationId','durationMs','eventSha256','previous'].filter(k => k in e).map(k => [k,e[k]])));
}
const readBound = async source => {
  try { const bytes = await readFile(source); return { source, sha256: sha(bytes), value: JSON.parse(bytes) }; }
  catch (e) { if (e.code === 'ENOENT') return { source, exists:false, value:null }; throw e; }
};
const active = await readBound(runtime + 'release-batches/active.json');
const receipt = await readBound(runtime + 'worker-process.json');
const result = { observedStartUtc, observedAtUtc:new Date().toISOString(), baseline:'36d6687bcc3e25dcd07cea8a0aeaaf7d9acfd5b3', journalSource:dir, batchSha256:batchSha, chainCanonicalSequenceVerified:true, eventCount:events.length, latest, events, active, receipt, limits:['Existing files only; no operator/Status/browser/database query', 'Snapshot covers a finite file-list prefix, not atomic global state or full component readiness', 'Original batch continues independently; no mutation or execution performed by discussion'] };
await writeFile(new URL(`live-observation-${tag}.json`, root), JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify({observedAtUtc:result.observedAtUtc,eventCount:events.length,latest,last:events.at(-1),active:active.value,receiptRelease:receipt.value?.releaseId},null,2));
