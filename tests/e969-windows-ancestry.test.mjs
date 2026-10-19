import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assertRecoveryActors} from '../tools/e969-maintenance-recovery.mjs';
const captured=JSON.parse(await fs.readFile('tests/fixtures/e969-windows-ancestry.json','utf8'));
test('actual Windows 0/4/860 ancestry ends only at the exact identified system terminal',()=>{
 const writer={processId:700001,parentProcessId:1,name:'node.exe',creationDate:'2026-10-19T14:00:00Z',commandLine:'node private writer',executablePath:process.execPath},observer={...writer,processId:700002,commandLine:'node private witness'},actor={actor:{processId:16244,creationDate:'2026-10-19T13:34:39.851223Z'},rotationOwner:{processId:41088,creationDate:'2026-10-19T13:27:17.187699Z'}},run=rows=>assertRecoveryActors([...rows,writer,observer],{writer,observer,actor,receipts:{}});
 assert.equal(captured.fullCensusRows,636);assert.deepEqual(captured.rows.map(r=>r.processId).sort((a,b)=>a-b),[0,4,860]);run(captured.rows);
 for(const change of [{parentProcessId:4},{name:'fake system'},{creationDate:null}]){const rows=structuredClone(captured.rows);Object.assign(rows.find(r=>r.processId===0),change);assert.throws(()=>run(rows));}
 const extra={processId:800001,parentProcessId:800001,name:'private.exe',creationDate:'2026-10-19T14:00:00Z'};assert.throws(()=>run([...captured.rows,extra]));assert.throws(()=>run([...captured.rows,{...extra,parentProcessId:800002},{...extra,processId:800002,parentProcessId:800001}]));assert.throws(()=>run([...captured.rows,{...extra,parentProcessId:4,creationDate:null}]));assert.throws(()=>run([...captured.rows,{...extra,parentProcessId:16244}]));
});
