// Independent read-only proof; only writes its report in this task's evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const source='D:/codex-isolated/market-ai-round2-release-20261015/source';
const root='D:/运营管理系统';
const out='D:/codex-artifacts/market-ai-round2-20261015';
const release='D:/teruisi-runtime/teruisi-worker-sales/releases/20261014T170130Z-17e3867852424323';
const evidence='D:/.codex/worktrees/market-ai-round2-20261015/运营管理系统/docs/market-ai-round2-20261015/evidence';
const rel='tools/worker-local-release-rotation.mjs';
const req=createRequire(source+'/package.json');
const {parse}=req('acorn');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const old=await fs.readFile(release+'/source-snapshot/'+rel);
const saved=await fs.readFile(out+'/protected-rotation-original.mjs');
const current=await fs.readFile(root+'/'+rel);
const finalSource=await fs.readFile(source+'/'+rel);
assert.equal(sha(old),'ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a');
assert.equal(sha(saved),'7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f');
assert.deepEqual(current,saved);
assert.deepEqual(finalSource,saved);
const semantics=raw=>JSON.stringify(parse(raw.toString('utf8'),{ecmaVersion:'latest',sourceType:'module'}),
    (key,value)=>['start','end','loc','range'].includes(key)?undefined:value);
assert.equal(semantics(old),semantics(saved));
const merged=execFileSync('git',['show','028804a43bde2598e34c8a2b2668bf014f2e3f6e:'+rel],{cwd:root,windowsHide:true});
assert.equal(saved.toString('utf8').replaceAll('\r\n','\n'),merged.toString('utf8'));
const beforeLines=old.toString('utf8').replaceAll('\r\n','\n').split('\n');
const afterLines=saved.toString('utf8').replaceAll('\r\n','\n').split('\n');
assert.equal(beforeLines.length,afterLines.length);
const lineDelta=beforeLines.flatMap((line,index)=>line===afterLines[index]?[]:[{line:index+1,before:line,after:afterLines[index]}]);
assert.equal(lineDelta.length,1);assert.ok(lineDelta[0].before.startsWith('// See docs/'));
const guard=JSON.parse(await fs.readFile(release+'/audit/legacy-worker-guard-receipt.json','utf8'));
const mismatches=[];
for(const item of guard.entrypoints){
  assert.ok(!item.relativePath.startsWith('/')&&!item.relativePath.split('/').includes('..'));
  const file=path.join(root,...item.relativePath.split('/'));
  const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  const actual=sha(await fs.readFile(file));
  if(actual!==item.sha256)mismatches.push({path:item.relativePath,expected:item.sha256,actual});
}
assert.equal(mismatches.length,1);assert.equal(mismatches[0].path,rel);
const frozen=JSON.parse(await fs.readFile(source+'/docs/market-ai-round2-20261015/evidence/final-application-source.json','utf8'));
for(const [file,hash]of Object.entries(frozen.files))assert.equal(sha(await fs.readFile(source+'/'+file)),hash,file);
const result={observedAt:new Date().toISOString(),oldSha256:sha(old),savedUserSha256:sha(saved),
  finalSourceToolSha256:sha(finalSource),sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),
  astEqual:true,mergedMainNormalizedTextEqual:true,lineDelta,guardEntrypoints:guard.entrypoints.length,mismatches,
  applicationFilesMatchedReviewed: Object.keys(frozen.files).length,productionMutationsPerformed:false,
  oldDjangoPrepareReusableForChangedTool:false,finalArtifactsNotYetReviewed:true};
await fs.writeFile(evidence+'/review-publication-comment-result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,lineDelta:undefined,mismatches:mismatches.map(x=>x.path)}));
