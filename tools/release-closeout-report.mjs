// Offline evidence/report draft. Never consults production or closes a batch.
import { readdir, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash, safeRead } from './release-impact.mjs';
import { safeObservationError } from './release-readonly-retry.mjs';

const instant = value => { const number = Date.parse(value); if (!Number.isFinite(number)) throw new Error('Invalid evidence timestamp'); return number; };
function scalarProjection(value, keys) {
  const result={};
  for(const key of keys) {
    if(value[key]===undefined||value[key]===null)continue;
    const item=value[key];
    const enums={status:['completed','passed','failed','unknown','started','processing','skipped','cancelled','pending','prepared'],
      cleanupStatus:['isolated_data_removed','failed','pending','unknown'],state:['Running','Stopped','Maintenance','BackendDegraded','Unknown','PortInUse','StatusError','Starting','StaleReceipt','WorkerStopped','BackendUnavailable','Unresponsive'],
      backendState:['Ready','NotReady','Unknown','Stopped','Degraded','Error'],workerState:['exact_release','stopped','unknown','stale_or_invalid_receipt','foreign_or_ambiguous','status_error','starting_exact_release']};
    if(enums[key]&&!enums[key].includes(item))throw new Error('Invalid evidence status enum');
    if(key.endsWith('Sha256')) {if(typeof item!=='string'||!/^([a-f0-9]{64})$/.test(item))throw new Error('Invalid evidence digest field');}
    else if(['profileRestoreVerified','sequenceHealthVerified','productionDatabaseTouched','serviceStateChanged','policySyntaxEquivalenceVerified','noReplay','independent'].includes(key)) {
      if(typeof item!=='boolean')throw new Error('Invalid evidence boolean field');
    } else if(typeof item!=='string'||item.length>160||!/^[-A-Za-z0-9_:./+ ]+$/.test(item))throw new Error('Invalid evidence identifier/status field');
    if(['candidateReleaseId','predecessorReleaseId','releaseId'].includes(key)&&!/^\d{8}T\d{6}Z-[a-f0-9]{16}$/.test(item))throw new Error('Invalid immutable release ID');
    if(key==='checkedAt')instant(item);
    result[key]=item;
  }
  return result;
}
export function intervalUnion(intervals) {
  const ordered = intervals.filter(([a,b]) => b > a).sort((a,b) => a[0] - b[0]), merged = [];
  for (const [a,b] of ordered) {
    if (merged.length && a <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(b, merged.at(-1)[1]);
    else merged.push([a,b]);
  }
  return merged.reduce((total, [a,b]) => total + b - a, 0);
}
export function closeoutAccounting(events, deliveryAt = null) {
  const approved = events.find(record => record.status === 'approved'), closed = events.findLast(record => record.status === 'completed' && record.phase === 'closeout');
  if (!approved) return { approvedToCompleteMs: null, reason: 'missing-approval-time' };
  const start = instant(approved.at), end = instant(closed?.at ?? events.at(-1).at);
  if (end < start) throw new Error('Completion precedes approval');
  const intervals = [], recordedByPhase = {}, reconciliations = [];
  for (const record of events) {
    if (!Number.isFinite(record.durationMs)) continue;
    if (record.durationMs < 0) throw new Error('Invalid recorded duration');
    // Nested retry attempts are evidence within the parent duration, not new
    // execution intervals. Clipping also avoids counting pre-approval queue.
    if (record.status === 'observation-attempt') continue;
    recordedByPhase[record.phase] = (recordedByPhase[record.phase] ?? 0) + record.durationMs;
    const eventAt=instant(record.at), b = Math.min(end, eventAt), a = Math.max(start, eventAt - record.durationMs);
    if (b > a) intervals.push([a,b]);
  }
  const executionCoveredMs = intervalUnion(intervals);
  for (const record of events.filter(record => record.reason === 'independently-reconciled')) {
    const prior = events.slice(0, events.indexOf(record)).filter(event => event.operationId === record.operationId);
    const begun = prior.findLast(event => event.status === 'started'), unknown = prior.findLast(event => event.status === 'unknown');
    reconciliations.push({ operationId: record.operationId, resolution: record.status,
      startedToResolutionMs: begun ? instant(record.at) - instant(begun.at) : null,
      unknownToResolutionMs: unknown ? instant(record.at) - instant(unknown.at) : null });
  }
  if (deliveryAt && (!closed || instant(deliveryAt) < end)) throw new Error('Delivery completion must follow batch completion');
  return { approvedAt: approved.at, completedAt: closed?.at ?? null,
    approvedToCompleteMs: closed ? end - start : null, observedApprovalSpanMs: end - start,
    recordedByPhase, recordedExecutionSumMs: Object.values(recordedByPhase).reduce((a,b) => a+b, 0),
    executionCoveredMs, waitingOrUninstrumentedMs: end - start - executionCoveredMs,
    documentCloseoutMs: deliveryAt ? instant(deliveryAt) - end : null,
    approvedToDeliveryMs: deliveryAt ? instant(deliveryAt) - start : null, reconciliations,
    qualification: 'Durations are recorded execution; interval union prevents overlap. Residual includes coordination, waits and uninstrumented work; it is not all idle time. Coordination spans and document closeout are separate, never added twice.' };
}
export async function readOriginalJournal(directory, batchSha256) {
  const names = (await readdir(directory)).sort(), events = [], files = []; let previous = null;
  for (const name of names) {
    if (!/^\d{6}\.json$/.test(name) || Number(name.slice(0,6)) !== events.length) throw new Error('Invalid original journal inventory');
    const target = path.join(directory, name), raw = await safeRead(target), record = JSON.parse(raw);
    const { eventSha256, ...core } = record;
    if (record.batchSha256 !== batchSha256 || record.previous !== previous || hash(core) !== eventSha256
      || !raw.equals(Buffer.from(`${canonical(record)}\n`))) throw new Error('Original journal chain/bytes changed');
    if (events.length && instant(record.at) < instant(events.at(-1).at)) throw new Error('Original journal time moved backwards');
    events.push(record); previous = eventSha256; files.push({ path: target, bytes: raw.length, sha256: hash(raw) });
  }
  return { events, files, head: previous };
}
const knownReasons = new Set(['independently-reconciled', 'operator-failed-or-result-unavailable', 'invalid-result',
  'live-predecessor-and-integrity-revalidation', 'operation-boundary-revalidation', 'operation-boundary-failed', 'explicit-zero-switch-cancellation']);
function eventSummary(record) {
  return { at: record.at, phase: record.phase, operationId: record.operationId ?? record.operationRef ?? null, status: record.status,
    durationMs: record.durationMs ?? null, reason: knownReasons.has(record.reason) ? record.reason : null,
    reasonSha256: record.reason ? hash(record.reason) : null, receiptSha256: record.receiptSha256 ?? null,
    error: record.error ? safeObservationError(record.error) : null,
    observationAttempts: record.observationAttempts?.map(item => ({ stage: item.stage, attempt: item.attempt, durationMs: item.durationMs,
      status: item.status, error: item.error ? safeObservationError(item.error) : null })) ?? [],
    observation: record.observation ? {stage:record.observation.stage,attempt:record.observation.attempt,
      durationMs:record.observation.durationMs,status:record.observation.status,error:record.observation.error? safeObservationError(record.observation.error):null}:null,
    eventSha256: record.eventSha256 };
}
export async function generateCloseoutDraft(input) {
  const raw = await safeRead(input.batchPath), spec = JSON.parse(raw), batch = spec.batch ?? spec;
  const { batchSha256, ...core } = batch;
  if (hash(core) !== batchSha256 || input.approvedSha256 !== batchSha256) throw new Error('Original approved batch changed');
  const journal = await readOriginalJournal(input.journalDirectory, batchSha256), { events } = journal;
  const latest = new Map(); for (const record of events) if (record.operationId) latest.set(record.operationId, record);
  if (events.some(record => record.operationId && !batch.operations.some(op => op.id === record.operationId))) throw new Error('Unknown operation in original journal');
  const operations = batch.operations.map(op => ({ id: op.id, phase: op.phase, kind: op.kind, mutating: op.mutating,
    covers: op.covers ?? [], status: latest.get(op.id)?.status ?? 'not-executed',
    evidence: events.filter(record => record.operationId === op.id || record.operationRef === op.id).map(eventSummary) }));
  const completedRecord = events.findLast(record => record.phase === 'closeout' && record.status === 'completed');
  const incomplete = operations.filter(op => op.status !== 'passed');
  const completed = !!completedRecord && !incomplete.length && !events.some(record => record.status === 'cancelled');
  const evidenceFiles = [{ path: input.batchPath, bytes: raw.length, sha256: hash(raw) }, ...journal.files], receipts = [], gaps = [], executionLogs = [], observationReceipts=[];
  for(const ref of input.observationReceipts??[]) {
    const bytes=await safeRead(ref.path);
    if(hash(bytes)!==ref.sha256)throw new Error('Observation receipt bytes changed');
    const value=JSON.parse(bytes);
    if(value.version!=='teruisi-status-attempt-v1'||value.batchSha256!==batchSha256)throw new Error('Observation receipt is not bound to this batch');
    const record=value.observation;
    if(!/^[a-z0-9-]{1,100}$/.test(record?.stage??'')||!Number.isInteger(record?.attempt)||record.attempt<1||record.attempt>4||!Number.isFinite(record.durationMs)||record.durationMs<0||!['passed','failed'].includes(record.status))throw new Error('Invalid attempt receipt');
    if(typeof record.at!=='string')throw new Error('Invalid attempt timestamp');
    instant(record.at);
    observationReceipts.push({path:ref.path,sha256:hash(bytes),observation:{stage:record.stage,attempt:record.attempt,at:record.at,
      durationMs:record.durationMs,status:record.status,error:record.error?safeObservationError(record.error):null}});
    evidenceFiles.push({path:ref.path,sha256:hash(bytes),bytes:bytes.length});
  }
  for(const ref of input.executionLogs??[]) {
    const bytes=await safeRead(ref.path);
    if(hash(bytes)!==ref.sha256)throw new Error('Execution log bytes changed');
    const text=bytes.toString('utf8');
    const markers=[['READINESS_ADMISSION_BLOCKED','Complete original system readiness is not the approved successor'],
      ['OPERATOR_RESULT_UNAVAILABLE','operator-failed-or-result-unavailable'],['UNKNOWN_RESULT','unknown'],
      ['DEADLINE_OR_TIMEOUT','timeout'],['DEADLINE_OR_TIMEOUT','超时']].filter(([,literal])=>text.includes(literal)).map(([code])=>code);
    executionLogs.push({path:ref.path,sha256:hash(bytes),bytes:bytes.length,markers:[...new Set(markers)],
      interpretation:'Markers are log observations, not inferred root causes or successful operations. Unclassified details remain in the original file.'});
    evidenceFiles.push({path:ref.path,sha256:hash(bytes),bytes:bytes.length});
  }
  for (const ref of input.receipts ?? []) {
    const bytes = await safeRead(ref.path), original = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const value = ref.format === 'operator-audit-v1' ? original.result : original;
    if (hash(bytes) !== ref.sha256) throw new Error('Receipt bytes changed');
    const event = events.find(record => record.operationId === ref.operationId && record.receiptSha256 === hash(value));
    if (!event) throw new Error('Receipt is not bound to the original operation');
    evidenceFiles.push({ path: ref.path, bytes: bytes.length, sha256: hash(bytes) });
    // Whitelist projection: receipts can contain large/raw confidential payloads.
    const keys = ['status','backupId','manifestSha256','dumpSha256','contentSha256','backupManifestSha256',
      'expectedContentSha256','restoredContentSha256','profileRestoreVerified','sequenceHealthVerified',
      'productionDatabaseTouched','serviceStateChanged','cleanupStatus','policySyntaxEquivalenceVerified','batchSha256','operationId','observationsSha256','noReplay','independent'];
    receipts.push({ operationId: ref.operationId, receiptSha256: hash(value), fields: scalarProjection(value,keys) });
  }
  for (const op of operations.filter(op => ['backup','restore'].includes(op.kind))) if (!receipts.some(receipt => receipt.operationId === op.id)) gaps.push(`missing-original-receipt:${op.id}`);
  let versions = null, deliveryAt = null;
  if (input.versionsEvidence) {
    const bytes = await safeRead(input.versionsEvidence.path);
    if (hash(bytes) !== input.versionsEvidence.sha256) throw new Error('Version evidence changed');
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    versions = input.versionsEvidence.format === 'customer-handoff-v1' ? {
      sourceCommit: value.sourceGitCommit, candidateReleaseId: value.workerPlan?.candidateReleaseId,
      candidateManifestSha256: value.workerPlan?.candidateManifestSha256,
      predecessorReleaseId: value.predecessor?.releaseId, predecessorManifestSha256: value.predecessor?.manifestSha256
    } : Object.fromEntries(['sourceCommit','candidateReleaseId','candidateManifestSha256','predecessorReleaseId','predecessorManifestSha256'].map(key=>[key,value[key]??null]));
    versions=scalarProjection(versions,['sourceCommit','candidateReleaseId','candidateManifestSha256','predecessorReleaseId','predecessorManifestSha256']);
    if (versions.candidateManifestSha256 !== batch.binding.artifactSha256 || !/^[a-f0-9]{40}$/.test(versions.sourceCommit ?? '')) throw new Error('Version evidence does not bind the batch');
    evidenceFiles.push({ path: input.versionsEvidence.path, sha256: hash(bytes), bytes: bytes.length });
  } else gaps.push('missing-exact-source-commit-and-release-versions');
  let observedRuntime=null;
  if (input.runtimeEvidence) {
    const bytes=await safeRead(input.runtimeEvidence.path);
    if(hash(bytes)!==input.runtimeEvidence.sha256)throw new Error('Runtime observation changed');
    const value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    const identity=scalarProjection(value,['checkedAt','releaseId','state','backendState','workerState']);
    observedRuntime={...identity,componentsReady:Object.values(value.components??{}).filter(v=>v===true).length,
      componentCount:Object.keys(value.components??{}).length};
    if(versions&&observedRuntime.releaseId!==versions.candidateReleaseId)gaps.push('observed-runtime-differs-from-approved-candidate');
    evidenceFiles.push({path:input.runtimeEvidence.path,sha256:hash(bytes),bytes:bytes.length});
  }else gaps.push('missing-independent-running-version-observation');
  if (input.deliveryEvidence) {
    const bytes = await safeRead(input.deliveryEvidence.path);
    if (hash(bytes) !== input.deliveryEvidence.sha256) throw new Error('Delivery evidence changed');
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    deliveryAt = value.completedAt ?? value.deliveryCompletedAt;
    evidenceFiles.push({ path: input.deliveryEvidence.path, sha256: hash(bytes), bytes: bytes.length });
  } else gaps.push('missing-document-delivery-completion-time');
  const timing = closeoutAccounting(events.filter(record=>completed||!(record.status==='completed'&&record.phase==='closeout')), completed ? deliveryAt : null);
  return { version: 'teruisi-release-closeout-draft-v1', draft: true,
    status: completed ? 'journal-completed-review-required' : 'release-incomplete', acceptancePassed: null,
    batchSha256, binding: scalarProjection(batch.binding,Object.keys(batch.binding).filter(key=>key.endsWith('Sha256')||['maintenanceId','djangoPreparedAppId'].includes(key))), versions, observedRuntime, journalHead: journal.head, operations,
    failures: events.filter(record => ['unknown','failed','admission-failed'].includes(record.status)).map(eventSummary),
    unresolved: operations.filter(op => ['started','unknown'].includes(op.status)).map(op => op.id),
    notExecuted: operations.filter(op => op.status === 'not-executed').map(op => op.id),
    receipts, executionLogs, observationReceipts, timing, evidenceFiles, evidenceGaps: gaps,
    unexecutedOrUncovered: input.unexecutedOrUncovered ?? [],
    limitations: ['Automatic report generation does not establish acceptance. Independent review and fact checking remain required.',
      'Immutable runtime identity must be independently observed; candidate/predecessor versions do not establish currently running versions.',
      'Historical missing baselines are not reconstructed. Preserved metadata does not establish that old backup payloads remain available.',
      'Estimated savings of 10–18 minutes for false alarms and 5–10 minutes for document closeout are unverified, not a per-batch promise.', ...(input.limitations ?? [])] };
}
const cell = value => String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
export function renderCloseoutDraft(report) {
  return `# 发布证据与交付报告草稿\n\n状态：${report.status}。自动生成不等同于验收通过；须独立复核和事实检查。\n\n批次：${report.batchSha256}\n\n源码与版本：\n\n\`\`\`json\n${JSON.stringify({ binding: report.binding, versions: report.versions, observedRuntime:report.observedRuntime }, null, 2)}\n\`\`\`\n\n| 操作 | 阶段 | 状态 | 原失败/协调数 |\n| --- | --- | --- | ---: |\n${report.operations.map(op => `| ${cell(op.id)} | ${cell(op.phase)} | ${cell(op.status)} | ${op.evidence.filter(e => ['failed','unknown'].includes(e.status) || e.reason === 'independently-reconciled').length} |`).join('\n')}\n\n计时（毫秒）：\n\n\`\`\`json\n${JSON.stringify(report.timing, null, 2)}\n\`\`\`\n\n备份恢复及回执：\n\n\`\`\`json\n${JSON.stringify(report.receipts, null, 2)}\n\`\`\`\n\n未决：${report.unresolved.join(', ') || '无'}。未执行：${report.notExecuted.join(', ') || '无'}。\n\n证据缺口、未覆盖与限制：\n\n${[...report.evidenceGaps, ...report.unexecutedOrUncovered, ...report.limitations].map(item => `- ${cell(item)}`).join('\n')}\n\n完整步骤、原失败、协调、证据路径与 SHA 见同目录 report.json。\n`;
}
async function writeNew(target, content) { const handle = await open(target, 'wx'); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } }
async function main() {
  const [inputPath, output] = process.argv.slice(2);
  if (!inputPath || !output) throw new Error('Usage: release-closeout-report.mjs <offline-input.json> <new-output-directory>');
  const input = JSON.parse(await safeRead(inputPath)), report = await generateCloseoutDraft(input);
  // Never overwrite a previous report or historical evidence.
  await mkdir(output);
  await writeNew(path.join(output, 'report.json'), `${canonical(report)}\n`);
  await writeNew(path.join(output, 'REPORT.md'), renderCloseoutDraft(report));
  await writeNew(path.join(output, 'evidence-manifest.json'), `${canonical({ inputSha256: hash(await safeRead(inputPath)), files: report.evidenceFiles })}\n`);
  console.log(canonical({ status: report.status, draft: true, output, unresolved: report.unresolved.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('CLOSEOUT_EVIDENCE_INVALID_OR_UNAVAILABLE'); process.exitCode = 1; });
