// Retry only a classified read-only observation, never a lifecycle action.
import { runProcess, safeProcessEvidence } from "file:///D:/teruisi-runtime/teruisi-worker-sales/releases/20261010T014638Z-97833d2f2b7e7bc9/tools/worker-local-release.mjs";
import { performance } from 'node:perf_hooks';
import path from 'node:path';

const transient = new Set(['STATUS_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);
const known = new Set([...transient, 'DEADLINE_EXCEEDED', 'STATUS_IDENTITY_MISMATCH',
  'STATUS_NOT_READY', 'INVALID_STATUS_JSON', 'PROCESS_FAILED', 'OUTPUT_LIMIT',
  'EACCES', 'EPERM', 'ENOENT', 'ASSERTION_FAILED']);
export function observationError(code) { return Object.assign(new Error(code), { code }); }
export function safeObservationError(error) {
  // Never persist stderr, stdout, URLs, argv, customer text, or arbitrary messages.
  const process = error?.processEvidence ?? error?.process;
  const readiness = sanitizeReadinessFailure(error?.readinessEvidence ?? error?.readiness);
  return { code: known.has(error?.code) ? error.code : 'UNCLASSIFIED_FAILURE',
    messageSha256: null, retryable: transient.has(error?.code), ...(process ? {process:safeProcessEvidence(process)} : {}),
    ...(readiness ? {readiness} : {}) };
}
function sanitizeReadinessFailure(value) {
  if (!value || value.version !== 1) return null;
  const allow = (v, values) => values.includes(v) ? v : 'unrecognized';
  const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 2_000_000 ? v : null;
  return {
    version: 1,
    state: allow(value.state, ['Running','BackendUnavailable','BackendDegraded','Unresponsive','StatusError','WorkerStopped','Stopped','Starting','StaleReceipt','PortInUse','Maintenance']),
    backendState: allow(value.backendState, ['Ready','NotReady','Error']),
    workerState: allow(value.workerState, ['exact_release','starting_exact_release','stale_or_invalid_receipt','foreign_or_ambiguous','status_error','stopped']),
    releaseMatchesExpected: value.releaseMatchesExpected === true,
    componentObject: value.componentObject === true,
    componentCount: count(value.componentCount),
    unexpectedComponentCount: count(value.unexpectedComponentCount),
    missingComponents: readinessComponents.filter(n => Array.isArray(value.missingComponents) && value.missingComponents.includes(n)),
    components: Object.fromEntries(readinessComponents.map(n => [n, value.components && Object.hasOwn(value.components,n) && typeof value.components[n] === 'boolean' ? value.components[n] : null]))
  };
}
// A failed readiness assertion must retain the actual probe's bounded facts.
// Never retain arbitrary reason text, URLs, extra field names or status bodies.
export function safeReadinessFailure(status, expectedReleaseId) {
  const allow = (value, values) => values.includes(value) ? value : 'unrecognized';
  const names = ['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
  const components = status?.components;
  const object = components !== null && typeof components === 'object' && !Array.isArray(components);
  const keys = object ? Object.keys(components) : [];
  return {
    version: 1,
    state: allow(status?.state, ['Running','BackendUnavailable','BackendDegraded','Unresponsive','StatusError','WorkerStopped','Stopped','Starting','StaleReceipt','PortInUse','Maintenance']),
    backendState: allow(status?.backendState, ['Ready','NotReady','Error']),
    workerState: allow(status?.workerState, ['exact_release','starting_exact_release','stale_or_invalid_receipt','foreign_or_ambiguous','status_error','stopped']),
    releaseMatchesExpected: typeof expectedReleaseId === 'string' && expectedReleaseId.length > 0 && status?.releaseId === expectedReleaseId,
    componentObject: object,
    componentCount: keys.length,
    unexpectedComponentCount: keys.filter(name => !names.includes(name)).length,
    missingComponents: names.filter(name => !object || !Object.hasOwn(components,name)),
    components: Object.fromEntries(names.map(name => [name, object && Object.hasOwn(components,name) && typeof components[name] === 'boolean' ? components[name] : null]))
  };
}
export async function retryReadOnlyObservation({ query, stage, totalTimeoutMs = 240_000,
  now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onAttempt = async () => {} }) {
  if (!/^[a-z0-9-]{1,100}$/.test(stage) || !Number.isSafeInteger(totalTimeoutMs)
    || totalTimeoutMs < 1 || totalTimeoutMs > 240_000) throw new Error('Invalid read-only observation budget');
  const started = now(), deadline = started + totalTimeoutMs, attempts = [];
  const fail = error => { error.observationAttempts = attempts; throw error; };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const remainingMs = Math.floor(deadline - now());
    if (remainingMs < 1) fail(observationError('DEADLINE_EXCEEDED'));
    const at = new Date().toISOString(), begin = now();
    let value, failure;
    try {
      value = await query({ remainingMs, deadline, attempt, remaining: () => {
        const value = Math.floor(deadline - now());
        if (value < 1) throw observationError('DEADLINE_EXCEEDED');
        return value;
      } });
      if (now() >= deadline) throw observationError('DEADLINE_EXCEEDED');
    } catch (error) { failure = error; }
    const record = { stage, attempt, at, durationMs: now() - begin,
      status: failure ? 'failed' : 'passed', error: failure ? safeObservationError(failure) : null };
    attempts.push(record);
    // Persist the attempt before any subsequent query, including terminal errors.
    await onAttempt(record);
    if (now() >= deadline) fail(observationError('DEADLINE_EXCEEDED'));
    if (!failure) return { value, attempts, elapsedMs: now() - started };
    if (!record.error.retryable || attempt === 4) fail(failure);
    if (deadline - now() <= 2_000) fail(observationError('DEADLINE_EXCEEDED'));
    await sleep(2_000);
  }
}

// This runner owns only its read-only probe child. Its deadline covers output
// EOF too. No taskkill /T, service termination, or raw process diagnostics.
export async function runReadOnlyProcess(executable, args, { timeoutMs, maxOutputBytes = 2 * 1024 * 1024, ...options } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240_000) throw new Error('Invalid probe timeout');
  try {
    return await runProcess(executable,args,{...options,timeoutMs,maxOutputBytes,outputProtocol:'direct-exit-files',cleanup:'direct'});
  } catch (error) {
    const code=error.processEvidence?.code;
    const mapped=observationError(code==='process_timeout' ? 'STATUS_TIMEOUT' : code==='output_limit' ? 'OUTPUT_LIMIT' : known.has(error.processEvidence?.nativeCode) ? error.processEvidence.nativeCode : 'PROCESS_FAILED');
    mapped.processEvidence=error.processEvidence;
    throw mapped;
  }
}
export function parseStatus(stdout) {
  try { const value = JSON.parse(stdout.trim()); if (!value || typeof value !== 'object') throw new Error(); return value; }
  catch { throw observationError('INVALID_STATUS_JSON'); }
}
export const readinessComponents = ['core','finance','netshop','market','products','workflow','inventory','customerService','accessControl','erpReference','bi','ai'];
export function assertCompleteReadiness(status, releaseId) {
  if (!releaseId || status.releaseId !== releaseId || status.workerState !== 'exact_release') throw observationError('STATUS_IDENTITY_MISMATCH');
  if (status.state !== 'Running' || status.backendState !== 'Ready'
    || Object.keys(status.components ?? {}).length !== readinessComponents.length
    || readinessComponents.some(name => status.components?.[name] !== true)) throw observationError('STATUS_NOT_READY');
  return status;
}
export function isExactStatusOperation(op) {
  const command = op?.command, args = command?.args;
  return op?.mutating === false && op?.kind === 'command' && ['acceptance', 'closeout'].includes(op.phase)
    && path.win32.normalize(command?.executable ?? '').toLowerCase() === 'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe'
    && Array.isArray(args) && args.length === 7
    && JSON.stringify(args.slice(0, 3)) === JSON.stringify(['-NoProfile', '-NonInteractive', '-File'])
    && path.win32.normalize(args[3]).toLowerCase() === 'd:\\运营管理系统\\tools\\operations-system-control.ps1'
    && JSON.stringify(args.slice(4)) === JSON.stringify(['-Action', 'Status', '-Json']);
}
