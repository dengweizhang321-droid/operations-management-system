// S08: control-only tool classification. Reads repository files with fs only
// (no child processes), so it runs in restricted sandboxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyRelease,controlOnlyTools} from '../tools/release-scope-plan.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=rel=>{try{const raw=fs.readFileSync(path.join(root,rel));return raw.length>8*1024*1024||raw.includes(0)?null:raw.toString('utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const toolNames=new Set(fs.readdirSync(path.join(root,'tools')));
const installerText=read('tools/install-main-prebuild.mjs');
const controlFiles=(()=>{const list=/export const controlFiles=\[([^\]]+)\]/.exec(installerText);assert.ok(list,'installer controlFiles list required');return [...list[1].matchAll(/'([^']+)'/g)].map(m=>'tools/'+m[1]);})();
const controlSet=new Set(controlFiles);
// Control-side entry points that are never part of an application payload:
// the control-bundle builder itself (its controlFiles list and bundleRoot
// launchers define the bundle) and the pre-merge test selector. Changes to
// them stay full; the walk does not continue through them.
const operatorEntries=new Set(['tools/install-main-prebuild.mjs','tools/verify-release-candidate.mjs']);
const nativeEntries=['tools/publish-main.mjs','tools/publish-prepared-main.mjs'];
const scannedRoots=['tools','backend','app','lib','worker','config','components','automation','scripts','public'];
function scannedFiles(){
  const files=[],skip=new Set(['node_modules','__pycache__']);
  const walk=dir=>{for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){if(skip.has(entry.name)||entry.name.startsWith('.'))continue;const rel=dir+'/'+entry.name;if(entry.isDirectory())walk(rel);else if(entry.isFile())files.push(rel);}};
  for(const dir of scannedRoots)if(fs.existsSync(path.join(root,dir)))walk(dir);
  for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&!entry.name.startsWith('.')&&!/\.md$/i.test(entry.name))files.push(entry.name);
  return files;
}
const files=scannedFiles();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const namePattern=file=>new RegExp('(?<![A-Za-z0-9_-])'+escape(path.posix.basename(file).replace(/\.(?:mjs|ps1)$/,''))+'(?:\\.(?:mjs|ps1))?(?![A-Za-z0-9_-])');
const outsideReferrers=file=>{const pattern=namePattern(file);return files.filter(rel=>!controlSet.has(rel)&&!operatorEntries.has(rel)&&pattern.test(read(rel)??''));};
// Conservative edges: any quoted './x', 'tools/x' or bare 'x' literal naming an
// existing tools file (imports, dynamic imports, path.join(source,'tools/x'),
// sibling paths and hash pins all count). The classifier's own controlOnlyTools
// list is classification data, not a load, and is removed before matching.
function edges(rel){
  if(!/\.(?:mjs|ps1|psm1)$/.test(rel))return [];
  let text=read(rel)??'';const out=new Set();
  if(rel==='tools/release-scope-plan.mjs'){const stripped=text.replace(/export const controlOnlyTools=Object\.freeze\(\[[^\]]*\]\);/,'');assert.notEqual(stripped,text,'controlOnlyTools declaration not found');text=stripped;}
  for(const m of text.matchAll(/['"`](?:\.\/|tools[\\/]+)?([A-Za-z0-9._-]+\.(?:mjs|ps1|psm1))['"`]/g))if(toolNames.has(m[1]))out.add('tools/'+m[1]);
  return [...out];
}
// Native publisher closure plus every control file named by a file outside the
// control set, walked transitively through shared control files.
function applicationClosure(){
  const named=controlFiles.filter(file=>outsideReferrers(file).length>0),reached=new Set(),queue=[...nativeEntries,...named];
  while(queue.length){const rel=queue.shift();if(reached.has(rel)||operatorEntries.has(rel))continue;reached.add(rel);queue.push(...edges(rel));}
  return reached;
}

test('every control-only tool is an existing control-bundle member',()=>{
  assert.ok(Object.isFrozen(controlOnlyTools));
  assert.ok(controlOnlyTools.length>0);
  assert.equal(new Set(controlOnlyTools).size,controlOnlyTools.length);
  for(const file of controlOnlyTools){
    assert.match(file,/^tools\/[a-z0-9-]+\.(?:mjs|ps1)$/);
    assert.ok(controlSet.has(file),file+' is not in install-main-prebuild.mjs controlFiles');
    assert.ok(toolNames.has(path.posix.basename(file)),file+' does not exist');
  }
});

test('no control-only tool is reachable from the native publisher or any application/runtime referrer',()=>{
  const closure=applicationClosure();
  for(const shared of ['tools/frozen-main-source.mjs','tools/main-schema-release.mjs','tools/publish-main-progress.mjs','tools/main-prebuild-task.mjs','tools/publish-latest-main.mjs','tools/release-scope-plan.mjs','tools/worker-local-release.mjs'])assert.ok(closure.has(shared),'closure walker lost '+shared);
  for(const file of controlOnlyTools)assert.ok(!closure.has(file),file+' is reachable from the application closure');
});

test('no file outside the control set and operator entries names a control-only tool',()=>{
  assert.ok(files.length>100,'repository scan found too few files');
  for(const file of controlOnlyTools)assert.deepEqual(outsideReferrers(file),[],file+' is referenced outside the control bundle');
  for(const entry of operatorEntries){assert.ok(toolNames.has(path.posix.basename(entry)));assert.deepEqual(outsideReferrers(entry),[],entry+' gained an application referrer');}
});

test('control-only changes need no application components; shared, unknown and renamed tools stay full',()=>{
  const only=classifyRelease([{status:'M',path:'tools/main-prebuild-status.mjs'},{status:'M',path:'tests/main-prebuild-status.test.mjs'},{status:'M',path:'docs/x.md'}]);
  assert.equal(only.scope,'control-only');
  assert.deepEqual(only.components,[]);
  assert.deepEqual(only.packaging,[]);
  assert.deepEqual(only.deployment,[]);
  assert.equal(only.databaseProtection,'not-required');
  assert.deepEqual(only.controlOnly,['tools/main-prebuild-status.mjs']);
  assert.ok(only.reasons.includes('仅控制包:tools/main-prebuild-status.mjs'));
  const both=classifyRelease([{status:'M',path:'tools/main-prebuild-hook.mjs'},{status:'M',path:'tools/main-prebuild-status.mjs'},{status:'M',path:'tools/main-prebuild-hook.mjs'}]);
  assert.equal(both.scope,'control-only');assert.deepEqual(both.controlOnly,['tools/main-prebuild-hook.mjs','tools/main-prebuild-status.mjs']);
  const frontend=classifyRelease([{status:'M',path:'tools/main-prebuild-hook.mjs'},{status:'M',path:'components/sales/filter.tsx'}]);
  assert.deepEqual(frontend.components,['worker']);
  assert.equal(frontend.scope,'frontend-worker');
  assert.deepEqual(frontend.controlOnly,['tools/main-prebuild-hook.mjs']);
  for(const file of ['tools/frozen-main-source.mjs','tools/main-prebuild-queue.mjs','tools/release-scope-plan.mjs','tools/install-main-prebuild.mjs','tools/brand-new-tool.mjs','tools/preparation-retirement-observer.mjs']){
    const plan=classifyRelease([{status:'M',path:file}]);
    assert.equal(plan.scope,'full',file);assert.deepEqual(plan.components,['worker','django'],file);assert.equal(plan.controlOnly,undefined,file);
  }
  const moved=classifyRelease([{status:'R100',before:'tools/main-prebuild-hook.mjs',path:'tools/new.mjs'}]);
  assert.equal(moved.scope,'full');assert.deepEqual(moved.components,['worker','django']);
  const otherCase=classifyRelease([{status:'M',path:'Tools/main-prebuild-hook.mjs'}]);
  assert.equal(otherCase.scope,'full');assert.deepEqual(otherCase.unknown,['Tools/main-prebuild-hook.mjs']);
});

test('change sets without control-only paths keep the exact previous plan object',()=>{
  const mixed=classifyRelease([{status:'M',path:'components/sales/filter.tsx'},{status:'M',path:'backend/netshop/views.py'},{status:'M',path:'tools/publish-main.mjs'},{status:'M',path:'docs/x.md'},{status:'M',path:'tests/x.test.mjs'},{status:'R100',before:'tools/main-prebuild-queue.mjs',path:'tools/main-prebuild-queue2.mjs'}]);
  const expectedMixed={scope:'full',components:['worker','django'],migrate:false,databaseProtection:'verified-current',businessDataProcessing:'separate-authorization-required',
    validation:['git-diff-check','worker-affected-tests','django-affected-tests','affected-integration-tests'],packaging:['prepare-worker-immutable-release','prepare-django-app'],
    deployment:['verify-current-database-backup','activate-worker-release','deploy-django-app','verify-startup','verify-affected-function'],
    workflow:[{step:4,id:'validate-change',actions:['git-diff-check','worker-affected-tests','django-affected-tests','affected-integration-tests']},{step:5,id:'merge-and-package',actions:['merge-main','push-main','prepare-worker-immutable-release','prepare-django-app']},{step:6,id:'publish',actions:['verify-current-database-backup','activate-worker-release','deploy-django-app','verify-startup','verify-affected-function']}],
    domains:['netshop'],unknown:[],reasons:['前端:components/sales/filter.tsx','后端:backend/netshop/views.py','运行或发布工具:tools/publish-main.mjs','测试:tests/x.test.mjs','运行或发布工具:tools/main-prebuild-queue.mjs','运行或发布工具:tools/main-prebuild-queue2.mjs']};
  assert.deepEqual(mixed,expectedMixed);
  assert.equal(JSON.stringify(mixed),JSON.stringify(expectedMixed));
  const docs=classifyRelease([{status:'M',path:'docs/x.md'},{status:'A',path:'tests/y.test.mjs'}]);
  const expectedDocs={scope:'non-production',components:[],migrate:false,databaseProtection:'not-required',businessDataProcessing:'separate-authorization-required',validation:['git-diff-check'],packaging:[],deployment:[],
    workflow:[{step:4,id:'validate-change',actions:['git-diff-check']},{step:5,id:'merge-and-package',actions:['merge-main','push-main']},{step:6,id:'publish',actions:[]}],domains:[],unknown:[],reasons:['测试:tests/y.test.mjs']};
  assert.equal(JSON.stringify(docs),JSON.stringify(expectedDocs));
});
