import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRelease,parseNameStatus} from '../tools/release-scope-plan.mjs';

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

test('迁移文件只在数据库结构变化时加入迁移和迁移前备份',()=>{
  const plan=classifyRelease([{status:'A',path:'backend/ai_assistant/migrations/0141_example.py'}]);
  assert.equal(plan.scope,'database-migration');
  assert.equal(plan.migrate,true);
  assert.equal(plan.databaseProtection,'fresh-pre-migration');
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
