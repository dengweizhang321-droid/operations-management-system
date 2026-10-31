import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess,{execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyRelease,parseNameStatus,makeReleasePlan} from '../tools/release-scope-plan.mjs';
import {readFileSync} from 'node:fs';
import {extractCopyRules,copyRuleSourcePaths,copiedComponents} from '../tools/release-copy-rules.mjs';

test('new control bundle contains scope imports and loads its publisher in isolation',async t=>{
  const {controlFiles}=await import('../tools/install-main-prebuild.mjs');
  const temp=mkdtempSync(path.join(os.tmpdir(),'teruisi-scope-bundle-'));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  mkdirSync(path.join(temp,'tools'));
  for(const name of controlFiles)copyFileSync(new URL(`../tools/${name}`,import.meta.url),path.join(temp,'tools',name));
  const target=new URL(`file:///${path.join(temp,'tools','publish-latest-main.mjs').replaceAll('\\','/')}`);
  // Module import only: argv never selects a CLI entry, no prepare/adopt call.
  execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(target.href)});`],{cwd:temp,encoding:'utf8',windowsHide:true});
  assert.ok(controlFiles.includes('release-copy-rules.mjs'));
  assert.ok(controlFiles.includes('release-copy-git-sources.mjs'));
});

test('copy membership is pure and covers worker/django/both/neither/unknown',()=>{
  const rules={known:true,workerFiles:['tools/worker.mjs','tools/both.mjs'],djangoFiles:['tools/django.mjs','tools/both.mjs']};
  for(const [file,components] of [['worker',['worker']],['django',['django']],['both',['worker','django']],['offline',[]]]){
    const plan=classifyRelease([{status:'M',path:`tools/${file}.mjs`}],{copyRules:rules});
    assert.deepEqual(plan.components,components);
    if(components.length)assert.ok(plan.validation.includes('affected-integration-tests'));
  }
  assert.equal(copiedComponents('tools/x',{known:false}).known,false);
  assert.deepEqual(copiedComponents('TOOLS/BOTH.MJS',rules).components,['worker','django']);
  assert.equal(copiedComponents('tools/../x',rules).known,false);
  const renamed=classifyRelease([{status:'R100',before:'tools/django.mjs',path:'tools/worker.mjs'}],{copyRules:rules});
  assert.deepEqual(renamed.components,['worker','django']);
  assert.deepEqual(classifyRelease([{status:'M',path:'tools/release-scope-plan.mjs'}],{copyRules:rules}).components,['worker','django']);
});

test('actual producer inventory distinguishes runtime from archive; unknown copy changes fail closed',()=>{
  const sources=Object.fromEntries(copyRuleSourcePaths.map(p=>[p,readFileSync(new URL(`../${p}`,import.meta.url),'utf8')]));
  const read=p=>{try{return readFileSync(new URL(`../${p}`,import.meta.url),'utf8');}catch{return null;}};
  const rules=extractCopyRules(sources,read);
  assert.equal(rules.known,true);
  assert.deepEqual(copiedComponents('tools/sqlite-consistent-backup.py',rules).components,['django']);
  assert.deepEqual(copiedComponents('tools/check_schema_code_digest.py',rules).components,[]);
  assert.deepEqual(classifyRelease([{status:'M',path:'tools/release-closeout-report.mjs'}],{copyRules:rules}).components,[]);
  assert.deepEqual(classifyRelease([{status:'T',path:'tools/release-closeout-report.mjs'}],{copyRules:rules}).components,['worker','django']);
  assert.ok(rules.helperFiles.includes('tools/tmall-sycm-cookie-pipeline.ts'));
  assert.ok(rules.helperFiles.includes('lib/jackyun/json-file.ts'));
  assert.ok(rules.helperFiles.includes('tools/jackyun-json-publish.ps1'));
  assert.deepEqual(copiedComponents('tools/install-workerd-heap-patch.mjs',rules).components,['worker']);
  assert.deepEqual(copiedComponents('tools/install-wrangler-inspector-patch.mjs',rules).components,['worker']);
  const dynamicHook={...sources,'package.json':JSON.stringify({scripts:{postinstall:'node '+process.env.UNKNOWN_HOOK}})};
  assert.equal(extractCopyRules(dynamicHook,read).known,false);
  assert.ok(rules.controlFiles.includes('tools/frozen-main-source.mjs'));
  for(const [p,expected] of [['tools/jackyun-api-export.ts',['worker']],['tools/sqlite-consistent-backup.py',['django']],['tools/sales-d1-retirement.ts',['worker','django']],['tools/check_schema_code_digest.py',[]]]){
    assert.deepEqual(classifyRelease([{status:'D',path:p}],{copyRules:rules}).components,expected);
  }
  const dynamicWorker={...sources,[copyRuleSourcePaths[1]]:sources[copyRuleSourcePaths[1]].replace('await cp(path.join(buildRoot, "dist")','await cp(computedSource')};
  assert.equal(extractCopyRules(dynamicWorker,read).known,false);
  const missing=p=>p==='lib/jackyun/json-file.ts'?null:read(p);
  assert.equal(extractCopyRules(sources,missing).known,false);
  const missingControl=p=>p==='tools/frozen-main-source.mjs'?null:read(p);
  assert.equal(extractCopyRules(sources,missingControl).known,false);
  const rebound={...sources,[copyRuleSourcePaths[1]]:sources[copyRuleSourcePaths[1]].replace('const source = path.join(sourceRoot, ...relativePath.split("/"));','const source = path.join(sourceRoot, "tools/new-runtime.mjs");')};
  assert.equal(extractCopyRules(rebound,read).known,false);
  const dynamicResource={...sources,[copyRuleSourcePaths[2]]:sources[copyRuleSourcePaths[2]].replace('sourceRelativePath: "tools/jackyun-json-publish.ps1"','sourceRelativePath: process.env.RESOURCE')};
  assert.equal(extractCopyRules(dynamicResource,read).known,false);
  const dynamicControl=p=>p==='tools/publish-latest-main.mjs'?read(p)+'\nawait import(process.env.CONTROL);\n':read(p);
  assert.equal(extractCopyRules(sources,dynamicControl).known,false);
  sources[copyRuleSourcePaths[0]]=sources[copyRuleSourcePaths[0]].replace('function Prepare-Application {','function Prepare-Application {\n Copy-Item -LiteralPath $unknown -Destination $staging\n');
  assert.equal(extractCopyRules(sources,read).known,false);
});

test('前端改动只构建和发布 Worker，且不要求数据库保护',()=>{
  const plan=classifyRelease([{status:'M',path:'components/ai/model-form.tsx'}]);
  assert.deepEqual(plan.components,['worker']);
  assert.equal(plan.scope,'frontend-worker');
  assert.equal(plan.databaseProtection,'not-required');
  assert.deepEqual(plan.packaging,['prepare-worker-immutable-release']);
});

test('后端改动只准备 Django，并要求核验现有备份但不运行迁移',()=>{
  const plan=classifyRelease([{status:'M',path:'backend/ai_assistant/views.py'}]);
  assert.deepEqual(plan.components,['django']);
  assert.equal(plan.migrate,false);
  assert.equal(plan.databaseProtection,'verified-current');
  assert.ok(!plan.deployment.includes('apply-approved-migrations'));
});

test('新结构迁移保留迁移验证并取消默认全库备份恢复',()=>{
  const plan=classifyRelease([{status:'A',path:'backend/ai_assistant/migrations/0141_example.py'}]);
  assert.equal(plan.scope,'database-migration');
  assert.equal(plan.migrate,true);
  assert.equal(plan.databaseProtection,'schema-only-no-new-full-backup-or-restore');
  assert.equal(plan.businessDataProcessing,'separate-authorization-required');
  assert.ok(!plan.deployment.some(action=>/backup|restore/.test(action)));
  assert.ok(plan.deployment.includes('apply-approved-migrations'));
});

test('共享和未知路径保守升级，重命名前后都纳入判断',()=>{
  const changes=parseNameStatus('R100\0components/old.tsx\0mystery/new.ts\0');
  const plan=classifyRelease(changes);
  assert.equal(plan.scope,'full');
  assert.deepEqual(plan.components,['worker','django']);
  assert.deepEqual(plan.unknown,['mystery/new.ts']);
});

test('纯文档和测试变更不产生生产打包或发布动作',()=>{
  const plan=classifyRelease([{status:'M',path:'docs/example.md'},{status:'M',path:'tests/example.test.mjs'}]);
  assert.equal(plan.scope,'non-production');
  assert.deepEqual(plan.packaging,[]);
  assert.deepEqual(plan.deployment,[]);
});

test('普通前端验证限于修改功能，构建只在对应制品准备中完成',()=>{
  const plan=classifyRelease([{status:'M',path:'components/sales/filter.tsx'}]);
  assert.deepEqual(plan.validation,['git-diff-check','worker-affected-tests']);
  assert.deepEqual(plan.workflow.map(stage=>stage.step),[4,5,6]);
  assert.deepEqual(plan.workflow[1].actions,['merge-main','push-main','prepare-worker-immutable-release']);
  assert.deepEqual(plan.workflow[2].actions,['activate-worker-release','verify-startup','verify-affected-function']);
});

test('普通后端改动不触发迁移 dry-run、系统检查或其他组件打包',()=>{
  const plan=classifyRelease([{status:'M',path:'backend/netshop/views.py'}]);
  assert.deepEqual(plan.validation,['git-diff-check','django-affected-tests']);
  assert.deepEqual(plan.workflow[1].actions,['merge-main','push-main','prepare-django-app']);
  assert.deepEqual(plan.deployment,['verify-current-database-backup','deploy-django-app','verify-startup','verify-affected-function']);
});

test('迁移改动保留隔离演练且不添加新备份，未知影响仍验证集成路径',()=>{
  const migration=classifyRelease([{status:'A',path:'backend/netshop/migrations/0042_example.py'}]);
  assert.ok(migration.validation.includes('migration-dry-run'));
  assert.ok(migration.validation.includes('isolated-postgresql-migration-rehearsal'));
  assert.ok(!migration.deployment.includes('create-pre-migration-backup'));
  const unknown=classifyRelease([{status:'M',path:'unknown/runtime.bin'}]);
  assert.ok(unknown.validation.includes('affected-integration-tests'));
  assert.deepEqual(unknown.workflow[1].actions,['merge-main','push-main','prepare-worker-immutable-release','prepare-django-app']);
});

test('纯文档交付只合并推送，无生产发布动作',()=>{
  const plan=classifyRelease([{status:'M',path:'docs/process.md'}]);
  assert.deepEqual(plan.workflow[1].actions,['merge-main','push-main']);
  assert.deepEqual(plan.workflow[2].actions,[]);
});

test('真实 Git 完整差异绑定 v3 流程，合并提交不丢失已修改组件',t=>{
  const cwd=mkdtempSync(path.join(os.tmpdir(),'teruisi-release-flow-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
  git(['init','-q','--initial-branch=main']);
  git(['config','user.name','Release Flow Test']);
  git(['config','user.email','release-flow-test@example.invalid']);
  mkdirSync(path.join(cwd,'components'));
  writeFileSync(path.join(cwd,'components','filter.tsx'),'export const label="old";\n');
  git(['add','.']);git(['commit','-qm','base']);
  const base=git(['rev-parse','HEAD']).trim();
  git(['switch','-qc','feature']);
  writeFileSync(path.join(cwd,'components','filter.tsx'),'export const label="new";\n');
  git(['add','.']);git(['commit','-qm','change function']);
  const beforeMerge=makeReleasePlan({base,cwd});
  git(['switch','-q','main']);git(['merge','--no-ff','-qm','merge feature','feature']);
  const plan=makeReleasePlan({base,cwd});
  assert.equal(plan.version,'teruisi-scoped-release-plan-v3');
  assert.notEqual(plan.headSha,beforeMerge.headSha);
  assert.deepEqual(plan.changes,beforeMerge.changes);
  assert.deepEqual(plan.workflow,beforeMerge.workflow);
  assert.notEqual(plan.planSha256,beforeMerge.planSha256);
  assert.equal(Object.hasOwn(plan,'copyRuleEvidence'),false);
  const {planSha256,...core}=plan;
  assert.equal(planSha256,createHash('sha256').update(JSON.stringify(core)).digest('hex'));
  assert.throws(()=>makeReleasePlan({base:'--all',cwd}),/必须提供明确/);
});

test('同次计划只读一次共同Git对象，缓存不跨调用复用',t=>{
  const cwd=mkdtempSync(path.join(os.tmpdir(),'teruisi-plan-cache-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
  git(['init','-q','--initial-branch=main']);
  git(['config','user.name','Release Cache Test']);
  git(['config','user.email','release-cache-test@example.invalid']);
  mkdirSync(path.join(cwd,'tools'));
  writeFileSync(path.join(cwd,'tools','shared.mjs'),'export const shared=1;\n');
  writeFileSync(path.join(cwd,'tools','changed.mjs'),'export const value=1;\n');
  git(['add','.']);git(['commit','-qm','base']);
  const base=git(['rev-parse','HEAD']).trim();
  writeFileSync(path.join(cwd,'tools','changed.mjs'),'export const value=2;\n');
  git(['add','.']);git(['commit','-qm','head']);
  const readObjects=[],originalExec=childProcess.execFileSync;
  t.mock.method(childProcess,'execFileSync',(file,args,options)=>{
    if(file==='git'&&args[0]==='cat-file')readObjects.push(...String(options.input).trim().split('\n'));
    return originalExec(file,args,options);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const plan=makeReleasePlan({base,cwd});
  assert.deepEqual(plan.components,['worker','django']); // Missing producers remain unknown/full.
  assert.equal(Object.hasOwn(plan,'copyRuleEvidence'),false);
  assert.equal(readObjects.length,3); // One shared blob and both versions of the changed file.
  assert.equal(new Set(readObjects).size,3);
  const firstRead=[...readObjects];readObjects.length=0;
  assert.deepEqual(makeReleasePlan({base,cwd}),plan);
  assert.deepEqual(readObjects,firstRead);
});
