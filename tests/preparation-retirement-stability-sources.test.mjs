import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {makeRetirementFixture} from './helpers/preparation-retirement-fixture.mjs';
import {retirementGit} from '../tools/preparation-retirement-fs.mjs';
import {assertRetirementClosureUnchanged} from '../tools/preparation-retirement-collector.mjs';
async function target(f){const dir=path.join(f.context.config.stateDirectory,'prebuild-queue-v2','dispatches');return JSON.parse(await fs.readFile(path.join(dir,f.dispatchId+'.json'),'utf8')).selectedTarget;}
test('same-HEAD extra and missing sources are distinguished before any native release scan',async t=>{
 const f=await makeRetirementFixture(t),sha=await target(f),extra=path.join(f.root,'same-head-extra'),missing=path.join(f.root,'same-head-missing');
 await retirementGit(f.repository,['worktree','add','-b','private-extra',extra,sha]);await fs.writeFile(path.join(extra,'diagnostic-one.json'),'{}');await fs.writeFile(path.join(extra,'diagnostic-two.json'),'{}');
 await retirementGit(f.repository,['worktree','add','-b','private-missing',missing,sha]);await fs.unlink(path.join(missing,'tools/publish-prepared-main.mjs'));
 const stages=[];await assert.rejects(f.collect({onProgress:event=>stages.push(event.stage)}),error=>{assert.equal(error.sourceClassifications.length,2);const x=error.sourceClassifications.find(x=>x.root===extra),m=error.sourceClassifications.find(x=>x.root===missing);assert.equal(x.head,sha);assert.equal(x.sameTarget,true);assert.equal(x.extraCount,2);assert.equal(x.missingCount,0);assert.equal(x.changedCount,null);assert.equal(m.extraCount,0);assert.equal(m.missingCount,1);return true;});
 assert.equal(stages.includes('native-chain-start'),false);assert.equal(stages.includes('native-release-metadata-start'),false);
});
test('different actual sources still qualify and a registration added after collection fails the final global CAS',async t=>{
 const f=await makeRetirementFixture(t),closure=await f.collect();assert.ok(closure.distinctions.some(x=>x.path===f.repository&&x.kind==='source-content'));await assertRetirementClosureUnchanged(f.context,closure);
 const alias=path.join(f.root,'late-original');await retirementGit(f.repository,['worktree','add','-b','private-late-original',alias,await target(f)]);await assert.rejects(assertRetirementClosureUnchanged(f.context,closure),/Registered source set changed/);
});
