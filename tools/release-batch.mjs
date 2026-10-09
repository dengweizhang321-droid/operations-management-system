// One approved batch, one rotation lock, a durable write-ahead phase journal.
// Production adapters call the existing lifecycle/backup operators. They do
// not implement service ownership, permissions, drain or rollback themselves.
import { mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { canonical, hash, requireHash, safeRead, safeFileDigest, readSourceTree, sourceTreeDigest, sourceInventory, makeImpactProof, verifyImpactProof, classifyImpact, requirements, backupReuseDecision } from './release-impact.mjs';
import { withRotationLock, applyApprovedRotationPlan, planWorkerReleaseRotation } from './worker-local-release-rotation.mjs';
import { runProcess, workerRuntimeRoot } from './worker-local-release.mjs';
import { isExactStatusOperation, retryReadOnlyObservation, runReadOnlyProcess, parseStatus, assertCompleteReadiness, safeObservationError, observationError } from './release-readonly-retry.mjs';

export const batchVersion = 'teruisi-release-batch-v2';
const phases = ['queue', 'prepare', 'backup-pre', 'restore-pre', 'drain', 'switch', 'acceptance', 'business', 'backup-post', 'restore-post', 'closeout'];
const terminal = new Set(['passed', 'skipped']);
export function makeBatch({ id, binding, before, after, witness, evidence, current, tests, acceptance, rollback, operations, collector, now = Date.now() }) {
  if (!/^[a-z0-9-]{8,80}$/.test(id ?? '')) throw new Error('Invalid batch ID');
  for (const k of ['sourceSha256', 'predecessorSourceSha256', 'sourceInventorySha256', 'predecessorInventorySha256', 'dependencySha256', 'configurationSha256', 'toolchainSha256', 'artifactSha256', 'testsSha256', 'predecessorSha256','workerPlanSha256']) requireHash(binding?.[k], k);
  if (sourceTreeDigest(after) !== binding.sourceSha256 || sourceTreeDigest(before) !== binding.predecessorSourceSha256) throw new Error('Impact inventory does not bind complete candidate/predecessor source');
  if (hash(sourceInventory(after)) !== binding.sourceInventorySha256 || hash(sourceInventory(before)) !== binding.predecessorInventorySha256) throw new Error('Impact inventory fingerprint changed');
  const impact = classifyImpact({ before, after, witness });
  const recovery = backupReuseDecision({ impact, evidence, current, now });
  if (!tests || tests.status !== 'passed' || hash(tests) !== binding.testsSha256
    || tests.sourceSha256 !== binding.sourceSha256 || tests.artifactSha256 !== binding.artifactSha256
    || requirements[impact.level].tests.some(k => !tests.checks?.includes(k))) throw new Error('Incomplete or unbound test evidence');
  if (!Array.isArray(acceptance) || requirements[impact.level].acceptance.some(k => !acceptance.includes(k))) throw new Error('Incomplete task acceptance');
  if (!rollback || !rollback.application || !rollback.compatibility || !rollback.failureState) throw new Error('Missing concrete rollback');
  if (!Array.isArray(operations) || !operations.length || operations.some(o => !phases.includes(o.phase)
    || !/^[a-z0-9-]{3,80}$/.test(o.id ?? '') || typeof o.mutating !== 'boolean')) throw new Error('Invalid approved operations');
  if (new Set(operations.map(o => o.id)).size !== operations.length) throw new Error('Duplicate operation IDs');
  let position = -1;
  for (const op of operations) {
    const next = phases.indexOf(op.phase);
    if (next < position) throw new Error('Phases out of order');
    position = next;
    validateOperation(op);
  }
  for (const name of ['prepare', 'drain', 'switch', 'acceptance', 'closeout', ...(recovery.mode === 'full' ? ['backup-pre', 'restore-pre', 'backup-post', 'restore-post'] : [])]) {
    if (!operations.some(o => o.phase === name)) throw new Error(`Missing ${name} phase`);
  }
  const core = { version: batchVersion, id, createdAt: new Date(now).toISOString(), binding, impact, recovery,
    databaseOperations: { required: recovery.mode==='full', operationIds:operations.filter(o=>['backup','restore'].includes(o.kind)).map(o=>o.id) },
    requirements: requirements[impact.level], tests, acceptance, rollback, operations,
    recoveryEvidence: evidence ?? null, recoveryCurrent: current ?? null, collectorSha256: collector ? hash(collector) : null, impactProof:makeImpactProof(before,after,witness) };
  const sealed = { ...core, batchSha256: hash(core) };
  verifyBatch(sealed,sealed.batchSha256);
  return sealed;
}

const requiredOperatorResults = {
  'backup-pre': { kind: 'backup', assertions: { status: 'completed', serviceStateChanged: false } },
  'backup-post': { kind: 'backup', assertions: { status: 'completed', serviceStateChanged: false } },
  'restore-pre': { kind: 'restore', assertions: { status: 'completed', serviceStateChanged: false, productionDatabaseTouched: false, cleanupStatus: 'isolated_data_removed', profileRestoreVerified: true, sequenceHealthVerified: true } },
  'restore-post': { kind: 'restore', assertions: { status: 'completed', serviceStateChanged: false, productionDatabaseTouched: false, cleanupStatus: 'isolated_data_removed', profileRestoreVerified: true, sequenceHealthVerified: true } },
};
export function validateOperation(op) {
  if(op.step&&!['lifecycle','django-deploy'].includes(op.kind))throw new Error('Lifecycle step labels require an original lifecycle adapter');
  if (op.readOnlyRetry && (!isExactStatusOperation(op) || op.readOnlyRetry.version !== 'teruisi-status-retry-v1'
    || !Number.isSafeInteger(op.readOnlyRetry.totalTimeoutMs) || op.readOnlyRetry.totalTimeoutMs < 1
    || op.readOnlyRetry.totalTimeoutMs > 240_000)) throw new Error('Retry is restricted to the exact read-only Status operation');
  if (op.readOnlyRetry && ([['state','Running'],['backendState','Ready'],['workerState','exact_release']].some(([key,value])=>!op.assertions?.some(a=>a.path===key&&a.equals===value))
    || !op.assertions?.some(a=>a.path==='releaseId'&&typeof a.equals==='string'&&a.equals.length>0))) throw new Error('Read-only retry requires exact full readiness assertions');
  const requirement = requiredOperatorResults[op.phase];
  if (requirement) {
    if (op.kind !== requirement.kind || op.mutating !== true) throw new Error('Backup/restore phase cannot be substituted');
    for (const [name,value] of Object.entries(requirement.assertions)) {
      if (!op.assertions?.some(a => a.path === name && a.equals === value)) throw new Error('Missing required backup/restore result assertion');
    }
    if (!op.command?.args?.includes('-Action') || op.command.args[op.command.args.indexOf('-Action')+1] !== (op.kind === 'backup' ? 'Backup' : 'RestoreRehearsal')
      || !op.command.args.includes('-Execute') || (op.kind === 'restore' && !op.command.args.includes('-ConfirmedIsolatedRestore'))) throw new Error('Backup/restore must use the original operator');
    if (!op.command.files?.some(f => /[\\/]django-postgres-maintenance\.ps1$/i.test(f.path) && op.command.args.includes(f.path))) throw new Error('Backup operator must be bound');
  }
  if (op.kind === 'worker-plan' && (op.phase !== 'prepare' || op.mutating !== false)) throw new Error('Invalid preparation phase');
  if (op.kind === 'worker-apply' && (op.phase !== 'switch' || op.mutating !== true)) throw new Error('Invalid apply phase');
  if(op.kind==='django-deploy'&&(op.phase!=='switch'||op.mutating!==true||op.step!=='DeployApp'))throw new Error('Invalid Django deployment phase');
  if(['lifecycle','django-deploy'].includes(op.kind)) {
    if(!['StopWorker','StartWorker','EnterMaintenance','ExitMaintenance','DeployApp','HardenAcl','VerifyStartup','AggregateStatus','BeginWorkerDrain','EndWorkerDrain'].includes(op.step)
      ||!op.command?.args||op.command.args[op.command.args.indexOf('-Step')+1]!==op.step
      ||!op.command.files?.some(f=>/[\\/]release-lifecycle-step\.ps1$/i.test(f.path)&&op.command.args.includes(f.path)))throw new Error('Lifecycle must call the bound original-engine adapter');
  }
  if(op.phase==='drain'&&(op.kind!=='lifecycle'||!['BeginWorkerDrain','EnterMaintenance'].includes(op.step)||op.mutating!==true
    ||!op.assertions?.some(a=>a.path==='drainConfirmed'&&a.equals===true)))throw new Error('Task drain must freeze admission and confirm original leases before switching');
}
export function verifyBatch(batch, approved) {
  requireHash(approved, 'approved batch');
  if (!/^[a-z0-9-]{8,80}$/.test(batch?.id ?? '') || !Number.isFinite(Date.parse(batch.createdAt))) throw new Error('Invalid batch identity');
  for (const key of ['sourceSha256','predecessorSourceSha256','sourceInventorySha256','predecessorInventorySha256','dependencySha256','configurationSha256','toolchainSha256','artifactSha256','testsSha256','predecessorSha256','workerPlanSha256']) requireHash(batch.binding?.[key],key);
  if(!/^[a-f0-9]{32}$/.test(batch.binding.maintenanceId??''))throw new Error('Exact approved drain/maintenance owner required');
  const { batchSha256, ...core } = batch;
  if (batch.version !== batchVersion || hash(core) !== batchSha256 || approved !== batchSha256) throw new Error('Batch scope changed');
  const impact = verifyImpactProof(batch.impactProof,batch.binding);
  const recovery = backupReuseDecision({ impact, evidence:batch.recoveryEvidence, current:batch.recoveryCurrent, now:Date.parse(batch.createdAt) });
  if (canonical(impact) !== canonical(batch.impact) || canonical(recovery) !== canonical(batch.recovery)
    || canonical(requirements[impact.level]) !== canonical(batch.requirements)) throw new Error('Impact/recovery requirements were altered');
  if(canonical(batch.databaseOperations)!==canonical({required:recovery.mode==='full',operationIds:batch.operations.filter(o=>['backup','restore'].includes(o.kind)).map(o=>o.id)}))throw new Error('Sealed database operations changed');
  if (!batch.tests || batch.tests.status !== 'passed' || hash(batch.tests) !== batch.binding.testsSha256
    || batch.tests.sourceSha256 !== batch.binding.sourceSha256 || batch.tests.artifactSha256 !== batch.binding.artifactSha256
    || requirements[impact.level].tests.some(k => !batch.tests.checks?.includes(k))) throw new Error('Incomplete bound tests');
  if (!Array.isArray(batch.acceptance) || requirements[impact.level].acceptance.some(k => !batch.acceptance.includes(k))) throw new Error('Incomplete acceptance');
  const covered = new Set(batch.operations.filter(o=>['acceptance','business','closeout'].includes(o.phase)).flatMap(o=>o.covers??[]));
  if (batch.acceptance.some(k=>!covered.has(k))) throw new Error('Required acceptance has no executable operation');
  if (!batch.rollback?.application || !batch.rollback.compatibility || !batch.rollback.failureState) throw new Error('Incomplete rollback');
  if (!batch.operations?.length || new Set(batch.operations.map(o => o.id)).size !== batch.operations.length) throw new Error('Missing/duplicate operations');
  let order=-1;
  for (const op of batch.operations) { const next=phases.indexOf(op.phase); if (next<order || next<0) throw new Error('Invalid phase ordering'); order=next; }
  for (const name of ['prepare','drain','switch','acceptance','closeout',...(recovery.mode==='full'?['backup-pre','restore-pre','backup-post','restore-post']:[])]) {
    if (!batch.operations.some(o=>o.phase===name)) throw new Error(`Missing ${name} phase`);
  }
  for (const op of batch.operations) {
    if (!/^[a-z0-9-]{3,80}$/.test(op.id ?? '') || typeof op.mutating !== 'boolean') throw new Error('Invalid operation identity/effect');
    validateOperation(op);
    if(['worker-plan','worker-apply'].includes(op.kind)&&op.planSha256!==batch.binding.workerPlanSha256)throw new Error('Operation would use another candidate plan');
    if(op.kind==='django-deploy'&&(op.command.args[op.command.args.indexOf('-PreparedAppId')+1]!==batch.binding.djangoPreparedAppId
      ||op.command.args[op.command.args.indexOf('-PreparedAppSha256')+1]!==batch.binding.djangoPreparedReceiptSha256))throw new Error('Operation would deploy another prepared app');
    if(['BeginWorkerDrain','StopWorker','EndWorkerDrain','EnterMaintenance','ExitMaintenance'].includes(op.step)
      &&op.command.args[op.command.args.indexOf('-MaintenanceId')+1]!==batch.binding.maintenanceId)throw new Error('Operation changed the exact drain/maintenance owner');
    if(op.kind==='restore') {
      const parent=batch.operations.findIndex(p=>p.id===op.backupOperationId&&p.kind==='backup');
      if(parent<0||parent>=batch.operations.indexOf(op)
        ||op.command.args[op.command.args.indexOf('-BackupDirectory')+1]!==`{receipt:${op.backupOperationId}:backupDirectory}`
        ||op.command.args[op.command.args.indexOf('-ApprovedManifestSha256')+1]!==`{receipt:${op.backupOperationId}:manifestSha256}`)throw new Error('Restore must bind the confirmed earlier backup');
    }
  }
  if(impact.level==='display'&&(batch.operations.some(op=>op.kind==='django-deploy'||['DeployApp','HardenAcl','EnterMaintenance','ExitMaintenance'].includes(op.step))
    ||(batch.binding.djangoCandidateSha256&&batch.binding.djangoCandidateSha256!==batch.binding.djangoPredecessorSha256)))throw new Error('Display release must be Worker-only');
  if(batch.operations.filter(op=>op.kind==='worker-apply').length!==1)throw new Error('Exactly one approved Worker apply is required');
  if(impact.level==='display'&&!batch.operations.some(op=>op.step==='EndWorkerDrain'&&op.phase==='switch'))throw new Error('Worker drain must be explicitly closed after starting the successor');
  if(impact.level==='display') {
    for(const step of ['BeginWorkerDrain','StopWorker','StartWorker','EndWorkerDrain']) {
      const matches=batch.operations.filter(op=>op.step===step);
      if(matches.length!==1||matches[0].kind!=='lifecycle'||matches[0].mutating!==true
        ||matches[0].phase!==(step==='BeginWorkerDrain'?'drain':'switch'))throw new Error('Exactly one original Worker-only lifecycle step is required');
    }
    if(batch.operations.some(op=>op.mutating && !['backup','restore','worker-apply','lifecycle'].includes(op.kind))
      || batch.operations.some(op=>op.kind==='lifecycle' && !['BeginWorkerDrain','StopWorker','StartWorker','EndWorkerDrain','VerifyStartup','AggregateStatus'].includes(op.step))
      || batch.operations.some(op=>op.kind==='lifecycle' && op.command.args.some(a=>/^-(IncludeBackend|KeepPostgres)$/i.test(a))))throw new Error('Display batch changed backend or admitted unproven writes');
  }
  const position=step=>batch.operations.findIndex(op=>op.step===step);
  const applyPosition=batch.operations.findIndex(op=>op.kind==='worker-apply');
  if(impact.level==='display'&&!(position('BeginWorkerDrain')<position('StopWorker')&&position('StopWorker')>=0&&position('StopWorker')<applyPosition
    &&applyPosition<position('StartWorker')&&position('StartWorker')<position('EndWorkerDrain')))throw new Error('Worker-only freeze/stop/apply/start/unfreeze ordering changed');
  if(impact.level!=='display'&&!(position('EnterMaintenance')>=0&&position('EnterMaintenance')<applyPosition
    &&applyPosition<position('ExitMaintenance')&&position('ExitMaintenance')<position('StartWorker')))throw new Error('Full maintenance ordering changed');
  return batch;
}
export function assertBindings(expected, actual) {
  if (!actual || canonical(expected) !== canonical(actual)) throw new Error('Source/dependency/config/toolchain/artifact/tests/predecessor binding changed');
}
export async function writeOnce(target, value) {
  await ensureSafeDirectory(path.dirname(target));
  // Validate every directory before opening: no junctions/symlinks or shared
  // hard-link evidence. A create-only record is fsynced before any effect.
  await safeDirectory(path.dirname(target));
  const handle = await open(target, 'wx');
  try { await handle.writeFile(`${canonical(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
async function ensureSafeDirectory(dir) {
  const {lstat}=await import('node:fs/promises');
  let cursor=path.parse(path.resolve(dir)).root;
  for(const part of path.resolve(dir).slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);let info;
    try{info=await lstat(cursor);}catch(error){if(error.code!=='ENOENT')throw error;try{await mkdir(cursor);}catch(e){if(e.code!=='EEXIST')throw e;}info=await lstat(cursor);}
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Redirected journal directory');
  }
}
async function safeDirectory(dir) {
  const { lstat } = await import('node:fs/promises');
  let cursor = path.parse(path.resolve(dir)).root;
  for (const part of path.resolve(dir).slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Redirected journal directory');
  }
}
export async function journalState(root, batch) {
  if (!/^[a-z0-9-]{8,80}$/.test(batch?.id ?? '')) throw new Error('Invalid journal batch identity');
  const dir = path.join(root, batch.id);
  if (path.dirname(path.resolve(dir)) !== path.resolve(root)) throw new Error('Journal escaped its fixed root');
  await ensureSafeDirectory(dir);
  await safeDirectory(dir);
  const names = (await readdir(dir)).sort();
  const events = [];
  let previous = null;
  for (const name of names) {
    if (!/^\d{6}\.json$/.test(name) || Number(name.slice(0,6)) !== events.length) throw new Error('Broken phase journal sequence');
    const raw = await safeRead(path.join(dir, name));
    const record = JSON.parse(raw);
    const { eventSha256, ...core } = record;
    if (record.batchSha256 !== batch.batchSha256 || record.previous !== previous || hash(core) !== eventSha256
      || !raw.equals(Buffer.from(`${canonical(record)}\n`))) throw new Error('Broken phase journal binding');
    events.push(record); previous = eventSha256;
  }
  const latest = new Map();
  for (const e of events) if (e.operationId) latest.set(e.operationId, e);
  return { dir, events, latest, previous, unknown: [...latest.values()].filter(e => ['started', 'unknown'].includes(e.status)) };
}
async function append(state, batch, record) {
  const core = { batchSha256: batch.batchSha256, previous: state.previous, at: new Date().toISOString(), ...record };
  const event = { ...core, eventSha256: hash(core) };
  await writeOnce(path.join(state.dir, `${String(state.events.length).padStart(6, '0')}.json`), event);
  state.events.push(event); state.previous = event.eventSha256;
  if (event.operationId) state.latest.set(event.operationId, event);
  return event;
}
export function timingReport(events) {
  const durationMs = Object.fromEntries(phases.map(p => [p,0]));
  for (const event of events) if (Number.isFinite(event.durationMs)) durationMs[event.phase] += event.durationMs;
  const approved = events.find(e => e.status === 'approved');
  const closed = events.findLast(e => e.phase === 'closeout' && e.status === 'completed');
  const elapsed = approved ? Date.parse(closed?.at ?? events.at(-1)?.at) - Date.parse(approved.at) : null;
  const switchEvents = events.filter(e => ['drain','switch'].includes(e.phase));
  const switchStart = switchEvents.find(e => e.status === 'started');
  const switchEnd = switchEvents.findLast(e => e.status === 'passed');
  return { durationMs, approvedToCompleteMs: closed ? elapsed : null, elapsedSinceApprovalMs: elapsed,
    // Execution span, not exact HTTP downtime. Record HTTP availability
    // separately in task acceptance if that measurement is required.
    switchExecutionMs: durationMs.switch, switchSpanMs: switchStart && switchEnd ? Date.parse(switchEnd.at) - Date.parse(switchStart.at) : null, completed: !!closed,
    waits: events.filter(e => e.reason).map(e => ({ phase: e.phase, reason: e.reason, durationMs: e.durationMs ?? 0 })) };
}
function admissionStages(value=[]) {
  if(!Array.isArray(value)||value.length>128)throw new Error('Invalid bounded admission stages');
  return value.map(stage=>{
    if(!/^[a-z][a-z0-9-]{1,64}$/.test(stage.stage??'')||!['sealed-evidence','mutable-input','immutable-content','dynamic-state'].includes(stage.category)
      ||!['passed','failed'].includes(stage.status)||!Number.isFinite(stage.durationMs)||stage.durationMs<0)throw new Error('Invalid admission timing record');
    return {stage:stage.stage,category:stage.category,status:stage.status,durationMs:stage.durationMs};
  });
}

export async function executeBatch({ batch, approved, root, collectCurrent, run, beforeOperation, lock = withRotationLock, approvedAt = new Date().toISOString() }) {
  verifyBatch(batch, approved);
  if (!Number.isFinite(Date.parse(approvedAt)) || Date.parse(approvedAt) > Date.now()) throw new Error('Invalid explicit approval time');
  const queued = performance.now();
  const attempt=path.join(root,'_queue',`${batch.id}-${randomUUID()}`);
  await writeOnce(path.join(attempt,'requested.json'),{batchSha256:approved,approvedAt,requestedAt:new Date().toISOString()});
  let acquired=false;
  try { return await lock(async lease => {
    acquired=true;
    await writeOnce(path.join(attempt,'acquired.json'),{batchSha256:approved,acquiredAt:new Date().toISOString(),durationMs:performance.now()-queued});
    await ensureSafeDirectory(root);
    await safeDirectory(root);
    const activePath = path.join(root, 'active.json');
    try { await writeOnce(activePath, { batchSha256: approved, id: batch.id }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const active = JSON.parse(await safeRead(activePath));
      if (active.batchSha256 !== approved || active.id !== batch.id) throw new Error('Another release batch owns the predecessor');
    }
    const state = await journalState(root, batch);
    if (state.unknown.length) throw new Error('Unknown/interrupted production result: reconcile exact operation; never replay');
    if (!state.events.length) await append(state, batch, { phase: 'queue', status: 'approved', at: approvedAt, durationMs: performance.now() - queued });
    else await append(state, batch, { phase: 'queue', status: 'resumed', durationMs: performance.now() - queued });
    const admissionStart = performance.now();
    async function collect(op) {
      const started=performance.now();
      try { return await collectCurrent(batch,lease,op,state); }
      catch(error) {
        await append(state,batch,{phase:op?.phase??'prepare',status:'admission-failed',durationMs:performance.now()-started,admissionStages:admissionStages(error.admissionStages),reason:'live-admission-failed',error:safeObservationError(error),observationAttempts:error.observationAttempts??[]});
        throw error;
      }
    }
    const live = await collect();
    assertBindings(batch.binding, live.binding);
    if (batch.recovery.mode === 'reuse') {
      const decision = backupReuseDecision({ impact: batch.impact, evidence: batch.recoveryEvidence, current: live.recovery });
      if (decision.mode !== 'reuse') throw new Error(`Recovery evidence expired: rebuild full-flow batch (${decision.reasons.join(',')})`);
    }
    await append(state, batch, { phase: 'prepare', status: 'admission', durationMs: performance.now() - admissionStart, admissionStages:admissionStages(live.admissionStages), reason: 'live-predecessor-and-integrity-revalidation' });
    for (const op of batch.operations) {
      if (terminal.has(state.latest.get(op.id)?.status)) continue;
      // A new sample is required at every actual operation. The adapter must
      // revalidate the expected predecessor until switch, then the exact
      // approved successor; never rewrite the approved batch to follow main.
      const boundaryStart = performance.now();
      const current = await collect(op);
      assertBindings(batch.binding, current.binding);
      if (batch.recovery.mode === 'reuse'
        && backupReuseDecision({ impact: batch.impact, evidence: batch.recoveryEvidence, current: current.recovery }).mode !== 'reuse') throw new Error('Recovery point/evidence invalidated at operation boundary');
      await append(state, batch, { phase: op.phase, status: 'admission', durationMs: performance.now() - boundaryStart, admissionStages:admissionStages(current.admissionStages), reason: 'operation-boundary-revalidation',...(current.statusObservation?{observationAttempts:current.statusObservation.attempts}:{}) });
      await beforeOperation?.(op);
      const start = performance.now();
      await append(state, batch, { operationId: op.id, phase: op.phase, status: 'started' });
      let result;
      try { result = await run(op, { batch, lease, state }); }
      catch (error) { result = { status: 'unknown', reason: 'operator-failed-or-result-unavailable', error: safeObservationError(error), observationAttempts: error.observationAttempts ?? [] }; }
      if (!['passed','failed','unknown','skipped'].includes(result?.status)) result = { status: 'unknown', reason: 'invalid-result' };
      if (result.status === 'skipped') throw new Error('Approved required operations cannot be skipped');
      await append(state, batch, { operationId: op.id, phase: op.phase, status: result.status,
        durationMs: performance.now() - start, reason: result.reason ?? null, receiptSha256: result.receiptSha256 ?? null, outputs: result.outputs ?? null,
        ...(result.error ? { error: result.error } : {}), ...(result.observationAttempts ? { observationAttempts: result.observationAttempts } : {}) });
      if (result.status !== 'passed') throw new Error(`Release retained at ${op.id}: ${result.status}`);
    }
    await append(state, batch, { phase: 'closeout', status: 'completed' });
    // Release ownership only after every original required acceptance and
    // closeout operation passes. A failed backup leaves the batch resumable.
    const { unlink } = await import('node:fs/promises');
    await unlink(activePath);
    return timingReport(state.events);
  }); } catch(error) {
    await writeOnce(path.join(attempt,'blocked.json'),{batchSha256:approved,at:new Date().toISOString(),reason:acquired?'stage-blocked':'rotation-lock-busy',durationMs:acquired?0:performance.now()-queued});
    throw error;
  }
}

export async function reconcileOperation({ root, batch, approved, operationId, resolution, proof, lock = withRotationLock }) {
  verifyBatch(batch, approved);
  if (!['passed','failed'].includes(resolution) || proof?.independent !== true || proof?.batchSha256 !== approved
    || proof?.operationId !== operationId || !proof?.observationsSha256 || proof?.noReplay !== true) throw new Error('Exact independent reconciliation required');
  requireHash(proof.observationsSha256, 'reconciliation');
  return lock(async () => {
    const state = await journalState(root, batch);
    const op = batch.operations.find(o => o.id === operationId);
    if (!op || !['started','unknown'].includes(state.latest.get(operationId)?.status)) throw new Error('Operation is not unresolved');
    if (resolution === 'failed' && proof.noEffect !== true) throw new Error('Failed resolution must prove zero effects before retry');
    return append(state, batch, { operationId, phase: op.phase, status: resolution, reason: 'independently-reconciled', receiptSha256: hash(proof) });
  });
}

// The command adapter is intentionally constrained to the reviewed operator
// and exact argv/output assertions in the approval scope. No shell strings.
export function productionCommandEnvironment(executable, parent = process.env) {
  const systemHost = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  if (path.resolve(executable).toLowerCase() !== path.resolve(systemHost).toLowerCase()) return parent;
  // PS7's native Node child inherits its PSModulePath. PS5 cannot import PS7's
  // Security assembly; select the pinned host's own built-in modules instead.
  // This is a child-only environment, never a change to build identity/parent.
  const env = { ...parent };
  const excluded = new Set(['PSMODULEPATH', 'TERUISI_DJANGO_SERVICE_LIBRARY_ONLY',
    'TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY']);
  for (const key of Object.keys(env)) if (excluded.has(key.toUpperCase())) delete env[key];
  env.PSModulePath = path.win32.join(path.win32.dirname(systemHost), 'Modules');
  return env;
}

export function productionCommandArguments(executable, args) {
  const systemHost = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  if (path.resolve(executable).toLowerCase() !== path.resolve(systemHost).toLowerCase()) return args;
  if (canonical(args.slice(0,3)) !== canonical(['-NoProfile','-NonInteractive','-File'])
    || typeof args[3] !== 'string' || !path.win32.isAbsolute(args[3])) throw new Error('System PowerShell requires a reviewed File entrypoint');
  const parameters = {}, seen = new Set();
  const switches = new Set(['execute','json','keeppostgres','confirmedisolatedrestore','confirmedprune']);
  for (let i=4;i<args.length;i++) {
    const key=args[i];
    if (!/^-[A-Za-z][A-Za-z0-9]*$/.test(key)||seen.has(key.toLowerCase())) throw new Error('Invalid or duplicate approved script parameter');
    seen.add(key.toLowerCase());
    const value=args[i+1];
    if (switches.has(key.slice(1).toLowerCase())) parameters[key.slice(1)] = true;
    else {
      if (typeof value !== 'string' || value.startsWith('-')) throw new Error('Invalid approved script parameter value');
      parameters[key.slice(1)] = args[++i];
    }
  }
  // JSON/base64 carries exact Unicode values without interpolating any script
  // path or argument as executable PowerShell text. Parameter keys are bounded.
  const payload=Buffer.from(JSON.stringify({file:args[3],parameters}),'utf8').toString('base64');
  const bootstrap=["$ErrorActionPreference='Stop'", "$utf8=[Text.UTF8Encoding]::new($false)",
    '[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;$OutputEncoding=$utf8',
    `$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json`,
    '$parameters=@{};foreach($p in $request.parameters.PSObject.Properties){$parameters[$p.Name]=$p.Value}',
    '& ([string]$request.file) @parameters'].join('\n');
  return ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')];
}

export async function runApprovedOperation(op, { batch, lease, state }) {
  const observationStart=performance.now();
  validateOperation(op);
  if (op.kind === 'worker-plan') {
    const result = await planWorkerReleaseRotation({ prepareOnline: true, reusePlanSha256: op.planSha256, rotationLease: lease, batchSha256: batch.batchSha256 });
    if (result.planSha256 !== op.planSha256) throw new Error('Prepared plan changed');
    return { status: 'passed', receiptSha256: hash(result) };
  }
  if (op.kind === 'worker-apply') {
    if (op.phase !== 'switch' || op.mutating !== true) throw new Error('Invalid apply phase');
    const result = await applyApprovedRotationPlan({ approvedPlanSha256: op.planSha256, rotationLease: lease, batchSha256: batch.batchSha256 });
    return { status: 'passed', receiptSha256: hash(result) };
  }
  if (!op.command || !Array.isArray(op.command.args) || !op.assertions?.length) throw new Error('Unbound operator or acceptance assertions');
  if (['backup','restore'].includes(op.kind)) {
    const installedOperator = 'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-postgres-maintenance.ps1';
    const requestedOperator=op.command.args[3];
    const preparedOperator=/^[a-f0-9]{32}$/.test(batch.binding.djangoPreparedAppId??'')
      ? path.join('D:\\teruisi-runtime\\django-sales',`app.deploy-${batch.binding.djangoPreparedAppId}`,'tools','django-postgres-maintenance.ps1'):null;
    const originalOperator=requestedOperator===installedOperator||(op.kind==='restore'&&requestedOperator===preparedOperator
      &&op.command.args[op.command.args.indexOf('-PreparedToolAppId')+1]===batch.binding.djangoPreparedAppId
      &&op.command.args[op.command.args.indexOf('-PreparedToolAppSha256')+1]===batch.binding.djangoPreparedReceiptSha256);
    if (!originalOperator
      || path.resolve(op.command.executable) !== 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      || canonical(op.command.args.slice(0,4))!==canonical(['-NoProfile','-NonInteractive','-File',requestedOperator])) throw new Error('Production backup/restore must use the original installed or exact read-only prepared operator');
  }
  for (const file of op.command.files ?? []) {
    if (await safeFileDigest(file.path) !== file.sha256) throw new Error('Operator/acceptance code changed');
  }
  // Both the executable and every script/config dependency must be bound in
  // command.files. Review verifies the closure; lifecycle keeps its own gates.
  if (!(op.command.files ?? []).some(f => f.path === op.command.executable)) throw new Error('Unbound command executable');
  const outputsFor = id => {
    const previous = state.latest.get(id);
    if (previous?.status !== 'passed' || !previous.outputs) throw new Error('Referenced earlier operation has no confirmed outputs');
    return previous.outputs;
  };
  const args = op.command.args.map(arg => {
    const token = /^\{receipt:([a-z0-9-]+):(backupDirectory|manifestSha256|maintenanceId)\}$/.exec(arg);
    if (!token) return arg;
    const value = outputsFor(token[1])[token[2]];
    if (typeof value !== 'string' || !value) throw new Error('Missing exact earlier receipt field');
    return value;
  });
  if (path.resolve(op.command.executable).toLowerCase() === path.resolve('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe').toLowerCase()
    && !op.command.files.some(f => f.path === args[3])) throw new Error('Unbound PowerShell script entrypoint');
  const invoke = timeoutMs => (op.readOnlyRetry ? runReadOnlyProcess : runProcess)(op.command.executable, productionCommandArguments(op.command.executable,args), { cwd: op.command.cwd,
    env: productionCommandEnvironment(op.command.executable),
    label: `${batch.id}/${op.id}`, timeoutMs });
  let result, observationAttempts;
  if (op.readOnlyRetry) {
    const totalTimeoutMs=Math.floor(op.readOnlyRetry.totalTimeoutMs-(performance.now()-observationStart));
    if(totalTimeoutMs<1)throw observationError('DEADLINE_EXCEEDED');
    const observed = await retryReadOnlyObservation({ stage: `${op.phase}-status`, totalTimeoutMs,
      onAttempt: record => append(state, batch, { phase: op.phase, status: 'observation-attempt', operationRef: op.id, observation: record }),
      query: async ({ remaining }) => {
        // Bindings and assertion failures are terminal, including between tries.
        for (const file of op.command.files) { remaining(); if (await safeFileDigest(file.path) !== file.sha256) throw observationError('ASSERTION_FAILED'); remaining(); }
        const value = await invoke(Math.min(remaining(), 60_000));
        const status = parseStatus(value.stdout);
        assertCompleteReadiness(status,op.assertions.find(a=>a.path==='releaseId').equals);
        for (const assertion of op.assertions) if (canonical(assertion.path.split('.').reduce((v,k) => v?.[k], status)) !== canonical(assertion.equals)) throw observationError('ASSERTION_FAILED');
        return value;
      } });
    result = observed.value; observationAttempts = observed.attempts;
  } else result = await invoke(op.command.timeoutMs);
  const receipt = JSON.parse(result.stdout.trim());
  for (const assertion of op.assertions) {
    const actual = assertion.path.split('.').reduce((v,k) => v?.[k], receipt);
    if (canonical(actual) !== canonical(assertion.equals)) throw new Error('Required operator/acceptance assertion failed');
  }
  if (op.kind === 'backup') {
    for (const k of ['manifestSha256','dumpSha256','contentSha256']) requireHash(receipt[k], `backup ${k}`);
    if (typeof receipt.backupDirectory !== 'string' || !receipt.backupId) throw new Error('Missing actual recovery point');
    if (receipt.retention?.status !== 'completed' || path.dirname(path.resolve(receipt.backupDirectory)) !== 'E:\\运营管理系统业务数据') throw new Error('Backup archive/retention is not closed; preserve the original recovery state');
  }
  if (op.kind === 'restore') {
    const backup = outputsFor(op.backupOperationId);
    if (receipt.backupManifestSha256 !== backup.manifestSha256 || receipt.dumpSha256 !== backup.dumpSha256
      || receipt.expectedContentSha256 !== backup.contentSha256 || receipt.restoredContentSha256 !== backup.contentSha256) throw new Error('Restore is not the confirmed exact backup or content changed');
  }
  const allowed = ['backupDirectory','backupId','manifestSha256','dumpSha256','contentSha256','maintenanceId'];
  return { status: 'passed', receiptSha256: hash(receipt), ...(observationAttempts ? { observationAttempts } : {}),
    outputs: Object.fromEntries(allowed.filter(k => typeof receipt[k] === 'string').map(k => [k,receipt[k]])) };
}

export async function cancelUnswitchedBatch({root,batch,approved,proof,lock=withRotationLock}) {
  verifyBatch(batch,approved);
  if(proof?.independent!==true||proof?.batchSha256!==approved||proof?.noSwitchOrBusinessEffects!==true)throw new Error('Independent zero-switch cancellation proof required');
  requireHash(proof.observationsSha256,'cancellation observations');
  return lock(async()=>{
    const state=await journalState(root,batch);
    if(state.unknown.length||state.events.some(e=>['switch','business'].includes(e.phase)&&['started','passed','unknown'].includes(e.status)))throw new Error('A started switch/business action cannot be abandoned');
    if(state.events.some(e=>e.phase==='drain'&&e.status==='passed')&&proof.drainCleared!==true)throw new Error('Exact original drain must be cleared and independently confirmed before cancellation');
    const activePath=path.join(root,'active.json'),active=JSON.parse(await safeRead(activePath));
    if(active.batchSha256!==approved||active.id!==batch.id)throw new Error('Different active batch');
    await append(state,batch,{phase:'closeout',status:'cancelled',reason:'explicit-zero-switch-cancellation',receiptSha256:hash(proof)});
    const {unlink}=await import('node:fs/promises');await unlink(activePath);
    return {status:'cancelled',approved};
  });
}

async function main() {
  const [command, specPath, approved, approvedAt] = process.argv.slice(2);
  if (command==='prepare') {
    if(!specPath||!approved)throw new Error('Usage: release-batch.mjs prepare <request.json> <output.json>');
    const request=JSON.parse(await safeRead(specPath));
    const before=await readSourceTree(request.predecessorSourceRoot),after=await readSourceTree(request.sourceRoot);
    const batch=makeBatch({...request,before,after});
    await writeOnce(approved,{batch,collector:request.collector,journalRoot:path.join(workerRuntimeRoot,'state','release-batches')});
    console.log(canonical({status:'prepared',batchSha256:batch.batchSha256,path:approved,impact:batch.impact.level,recovery:batch.recovery.mode}));return;
  }
  if (!['inspect', 'execute', 'status'].includes(command) || !specPath || !approved) throw new Error('Usage: release-batch.mjs inspect|status|execute <batch.json> <approved-batch-sha256>');
  const spec = JSON.parse(await safeRead(specPath));
  verifyBatch(spec.batch, approved);
  if (command === 'inspect') { console.log(canonical(spec.batch)); return; }
  if (command === 'status') { const state = await journalState(spec.journalRoot, spec.batch); console.log(canonical({ unknown: state.unknown, ...timingReport(state.events) })); return; }
  if (path.resolve(spec.journalRoot) !== path.join(workerRuntimeRoot, 'state', 'release-batches')) throw new Error('Production journal must use the shared fixed runtime root');
  if (!approvedAt) throw new Error('Execution requires the actual explicit approval timestamp (ISO UTC)');
  // The live collector is an explicitly approved read-only task adapter; it
  // reuses installed Status/Verify/CAS and task-specific business observations.
  if (!spec.collector || spec.batch.collectorSha256 !== hash(spec.collector)) throw new Error('Collector is outside approved scope');
  let session=null,collectInProcess=null;
  if(spec.collector.transport==='in-process-content-evidence-v1') {
    const admissionPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'release-batch-admission.mjs');
    if(spec.collector.executable!==process.execPath || spec.collector.args.length!==4 || path.resolve(spec.collector.args[0])!==admissionPath
      || spec.collector.args[1]!=='collect' || path.resolve(spec.collector.args[2])!==path.resolve(specPath))throw new Error('In-process evidence requires the exact standard collector');
    if(spec.collector.cwd&&path.resolve(spec.collector.cwd)!==process.cwd())throw new Error('In-process collector cwd differs from its approved execution context');
    // This is a new approved transport, not recognition of an arbitrary adapter.
    // Pin the entire direct implementation closure, including existing engines.
    for(const name of ['release-batch.mjs','release-batch-admission.mjs','release-impact.mjs','release-preparation-evidence.mjs','release-admission-timing.mjs','release-daily-backup.mjs','release-readonly-retry.mjs','worker-local-release.mjs','worker-local-release-rotation.mjs','d1-retirement-proof.mjs','collect-d1-retirement-proof.mjs']) {
      const target=path.join(path.dirname(admissionPath),name);
      if(!spec.collector.files.some(f=>path.resolve(f.path)===target))throw new Error('Unbound in-process collector implementation');
    }
    const compiler=path.join(path.dirname(path.dirname(admissionPath)),'node_modules','typescript','lib','typescript.js');
    if(!spec.collector.files.some(f=>path.resolve(f.path)===compiler))throw new Error('Unbound in-process impact parser');
    const compilerPackage=path.join(path.dirname(path.dirname(compiler)),'package.json');
    if(!spec.collector.files.some(f=>path.resolve(f.path)===compilerPackage))throw new Error('Unbound impact parser package resolution');
    const {createPreparationEvidenceSession}=await import('./release-preparation-evidence.mjs');
    const {workerSourceRoot}=await import('./worker-local-release.mjs');
    ({collectBatchAdmission:collectInProcess}=await import('./release-batch-admission.mjs'));
    session=createPreparationEvidenceSession({batchSha256:approved,sourceRoot:workerSourceRoot});
  } else if(spec.collector.transport)throw new Error('Unknown collector transport');
  try { await executeBatch({ batch: spec.batch, approved, approvedAt, root: spec.journalRoot,
    run:(op,context)=>{session?.assertStable();return runApprovedOperation(op,context);},beforeOperation:()=>session?.assertStable(),
    collectCurrent: async (_,__,op) => {
      for (const file of spec.collector.files) if (await safeFileDigest(file.path) !== file.sha256) throw new Error('Live collector changed');
      if (!spec.collector.files.some(f => f.path === spec.collector.executable)) throw new Error('Unbound live collector executable');
      const attemptRoot=path.join(spec.journalRoot,'_observations',`${spec.batch.id}-${randomUUID()}`);
      const current=collectInProcess
        ? await collectInProcess(spec.batch,spec.collector.args[3],op?.phase??'admission',{session,step:op?.step??op?.kind,
          onStatusAttempt:record=>writeOnce(path.join(attemptRoot,`${record.attempt}.json`),{version:'teruisi-status-attempt-v1',batchSha256:approved,observation:record})})
        : JSON.parse((await runProcess(spec.collector.executable, [...spec.collector.args,'--phase',op?.phase??'admission'], { cwd: spec.collector.cwd, label: 'release live admission' })).stdout.trim());
      if (current.batchSha256 !== approved || !Number.isFinite(current.observedAtMs)
        || Math.abs(Date.now() - current.observedAtMs) > 5_000) throw new Error('Stale live admission');
      return current;
    } }); } finally { session?.dispose(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
