/** Fixed Pandas source rotation bindings; no lifecycle action is performed here. */
import assert from 'node:assert/strict';

const sha = /^[a-f0-9]{64}$/;
export function pandasRuntimeChanged(request) {
  return (request.releasePlan?.changes ?? []).some(change => [change.path, change.before].some(file =>
    typeof file === 'string' && file.startsWith('backend/pandas_runner/') && file.endsWith('.py') &&
    !file.split('/').some(part => part === 'tests' || part.startsWith('test_'))));
}

export function pandasArguments(prepared, {pkg, request, maintenanceId, ownerPid} = {}) {
  const args = ['-PandasPreparedAppId', pkg?.id ?? prepared.preparedAppId,
    '-PandasPreparedAppSha256', pkg?.receiptSha256 ?? prepared.preparedAppSha256,
    '-PandasSourceCommit', request?.mainCommit ?? prepared.sourceCommit];
  if (prepared?.configured) args.push('-PandasPlanSha256', prepared.registeredPlanSha256);
  if (maintenanceId !== undefined) args.push('-PandasMaintenanceId', maintenanceId,
    '-PandasPublicationOwnerPid', String(ownerPid));
  return args;
}

export function verifyPandasPreparation(value, {pkg, request}) {
  assert.equal(value?.prepared, true, '缺少Pandas专用准备回执');
  assert.equal(value.started, false, 'Pandas准备不得启动服务');
  assert.equal(typeof value.configured, 'boolean', 'Pandas配置状态必须明确');
  assert.equal(value.preparedAppId, pkg.id, 'Pandas准备包ID不匹配');
  assert.equal(value.preparedAppSha256, pkg.receiptSha256, 'Pandas准备包摘要不匹配');
  assert.equal(value.sourceCommit, request.mainCommit, 'Pandas来源提交不匹配');
  assert.match(value.sourceSha256 ?? '', sha);
  if (value.configured) {
    assert.match(value.registeredPlanSha256 ?? '', sha);
    assert.match(value.predecessorSourceSha256 ?? '', sha);
    assert.match(value.image ?? '', /^sha256:[a-f0-9]{64}$/);
  } else {
    assert.ok(value.registeredPlanSha256 == null, '未配置Pandas不得携带轮换计划');
  }
  return value;
}

export function verifyPandasCheck(value, prepared, binding) {
  verifyPandasPreparation(value, binding);
  assert.equal(value.checked, true, 'Pandas维护前检查未完成');
  for (const name of ['configured', 'registeredPlanSha256', 'sourceSha256', 'predecessorSourceSha256', 'image'])
    assert.equal(value[name], prepared[name], `Pandas准备绑定变化: ${name}`);
  return value;
}

function verifyIdentity(value, prepared, maintenanceId, ownerPid) {
  for (const name of ['configured', 'registeredPlanSha256', 'sourceSha256', 'predecessorSourceSha256',
    'image', 'preparedAppId', 'preparedAppSha256', 'sourceCommit'])
    assert.equal(value?.[name], prepared[name], `Pandas切换绑定变化: ${name}`);
  assert.equal(prepared.configured, true);
  assert.equal(value.maintenanceId, maintenanceId);
  assert.equal(value.publicationOwnerPid, ownerPid);
  assert.match(value.intentSha256 ?? '', sha);
}

export function verifyPandasSwitch(value, prepared, maintenanceId, ownerPid) {
  verifyIdentity(value, prepared, maintenanceId, ownerPid);
  assert.equal(value.switched, true);
  assert.equal(value.started, false);
  assert.equal(value.status, 'switched_stopped', 'Pandas CAS不能冒充启动就绪');
  return value;
}

export function verifyPandasCompletion(value, prepared, switched) {
  verifyIdentity(value, prepared, switched.maintenanceId, switched.publicationOwnerPid);
  assert.equal(value.intentSha256, switched.intentSha256);
  assert.equal(value.completed, true);
  assert.equal(value.postconditionsVerified, true);
  assert.equal(value.status, 'ready_verified');
  assert.match(value.startupReceiptSha256 ?? '', sha, '缺少原Pandas签名启动回执');
  return value;
}
