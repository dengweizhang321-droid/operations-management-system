import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyRelease,parseNameStatus,makeReleasePlan} from '../tools/release-scope-plan.mjs';

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
  const {planSha256,...core}=plan;
  assert.equal(planSha256,createHash('sha256').update(JSON.stringify(core)).digest('hex'));
  assert.throws(()=>makeReleasePlan({base:'--all',cwd}),/必须提供明确/);
});
