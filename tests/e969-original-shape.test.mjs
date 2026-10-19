import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assertOriginalFacts,fixed} from '../tools/e969-maintenance-recovery.mjs';
import {assertFrozenSource} from '../tools/frozen-main-source.mjs';
const captured=JSON.parse(await fs.readFile('tests/fixtures/e969-original-shape.json','utf8'));
test('actual pinned request omits sourceTree; PREPARED/STARTED/admission bind the real tree',()=>{
 assert.equal(captured.keys.request.includes('sourceTree'),false);assert.equal(Object.hasOwn(captured.facts.request,'sourceTree'),false);assert.deepEqual(assertOriginalFacts(captured.facts).prepared.sourceIdentity,{commit:fixed.target,tree:fixed.tree});
 for(const name of ['prepared','start','admission']){const facts=structuredClone(captured.facts);if(name==='prepared')facts.prepared.sourceIdentity.tree='f'.repeat(40);else facts[name].sourceTree='f'.repeat(40);assert.throws(()=>assertOriginalFacts(facts));}
});
test('the existing frozenSourceIdentity must match actual commit/tree and remain clean',async()=>{
 const expected=captured.facts.prepared.sourceIdentity,run=async({actualTree=expected.tree,status=''}={})=>assertFrozenSource({source:fixed.source,mainCommit:expected.commit,sourceTree:expected.tree},{git:async(_cwd,args)=>args[0]==='status'?status:args[1]==='HEAD'?expected.commit:actualTree});assert.deepEqual(await run(),expected);await assert.rejects(run({actualTree:'f'.repeat(40)}));await assert.rejects(run({status:' M tools/publish-prepared-main.mjs'}));
});
