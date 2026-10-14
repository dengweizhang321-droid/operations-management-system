/** Record the committed candidate vision adapter without touching a production job.
 * Credentials are read in memory from the installed environment and never saved.
 * Only the configured model-runtime read, public image reads and the approved
 * provider endpoint are allowed. Every provider POST consumes the 50-call ledger.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const options = Object.fromEntries(process.argv.slice(2).map(v => {
  const [key, ...parts] = v.replace(/^--/, '').split('='); return [key, parts.join('=')];
}));
const release = resolve(options.release ?? '');
const output = resolve(options.output ?? '');
if (!release.startsWith('D:\\teruisi-runtime\\teruisi-worker-sales\\releases\\')
  || !output.startsWith('D:\\codex-artifacts\\market-annotation-chain-audit-')) throw new Error('Invalid audit roots');
const source = resolve(options.source ?? '');
if (![resolve('D:/codex-isolated/market-ai-blockers-integration-20261014/source'), resolve('D:/codex-isolated/market-ai-blockers-release-20261014/source')].includes(source)) throw new Error('Candidate source root mismatch');
const { execFileSync } = await import('node:child_process');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding:'utf8', windowsHide:true}).trim();
if (sourceCommit !== options.commit) throw new Error('Candidate commit mismatch');
if (execFileSync('git', ['status', '--porcelain'], {cwd:source, encoding:'utf8', windowsHide:true}).trim()) throw new Error('Candidate must be committed and clean');
const taskManifest = JSON.parse(await readFile(resolve(options.tasks), 'utf8'));
if (!resolve(options.tasks).startsWith(output + '\\')) throw new Error('Task manifest must remain in private evidence');
const bindingFiles = execFileSync('git', ['ls-files', 'lib/market', 'lib/ai/model-gateway.ts', 'backend/market/annotations.py', 'backend/market/annotation_runtime.py'], {cwd:source,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
const sourceHashes = Object.fromEntries(await Promise.all(bindingFiles.map(async file => [file, createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));

const variant = options.variant || 'candidate';
if (variant !== 'candidate') throw new Error('Unsupported comparison');
const names = (options.samples || 'A1,B1').split(',');
const allSamples = JSON.parse(await readFile(join(output, 'samples.private.json'), 'utf8'));
const selected = names.map(name => {
  const sample = allSamples.find(s => s.sampleId === name);
  if (!sample) throw new Error('Unknown sample');
  return sample;
});
await mkdir(output, { recursive: true });
const envText = await readFile(join(release, '.dev.vars'), 'utf8');
const environment = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (!m) continue;
  let value = m[2];
  if (value.startsWith('"') && value.endsWith('"')) { try { value = JSON.parse(value); } catch { value = value.slice(1, -1); } }
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  environment[m[1]] = value;
}
const runId = 'model-trace-' + randomUUID();
const rows = [];
const secretValues = Object.entries(environment).filter(([key]) => /SECRET|KEY|TOKEN|PASSWORD/.test(key)).map(([, value]) => value).filter(Boolean);
function safeError(error) {
  let text = String(error?.message || error || 'unknown');
  for (const value of secretValues) text = text.split(value).join('[redacted]');
  return text.replace(/\b(?:sk-|key-)[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]').slice(0, 300);
}
const sampleContext = new AsyncLocalStorage();
async function emit(row) {
  const value = { runId, variant, sampleId: sampleContext.getStore()?.sampleId, at: new Date().toISOString(), ...row };
  rows.push(value);
  await appendFile(join(output, 'model-trace.jsonl'), JSON.stringify(value) + '\n');
}
globalThis.__chainSpan = async (stage, operation) => {
  const start = performance.now();
  await emit({ stage, phase: 'start' });
  try {
    const result = await operation();
    await emit({ stage, phase: 'end', outcome: 'ok', durationMs: Math.round((performance.now() - start) * 1000) / 1000 });
    return result;
  } catch (error) {
    await emit({ stage, phase: 'end', outcome: 'error', durationMs: Math.round((performance.now() - start) * 1000) / 1000,
      errorName: error?.name, message: safeError(error) });
    throw error;
  }
};
globalThis.__chainRememberCredential = value => { if (typeof value === 'string' && value) secretValues.push(value); return value; };
function boundedUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const key of ['prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 10_000_000) out[key] = value[key];
  }
  for (const [group, key] of [['prompt_tokens_details','cached_tokens'],['completion_tokens_details','reasoning_tokens']]) {
    if (Number.isSafeInteger(value[group]?.[key]) && value[group][key] >= 0 && value[group][key] <= 10_000_000) out[group] = { [key]: value[group][key] };
  }
  return out;
}
globalThis.__chainModelRead = async (operation) => {
  const result = await globalThis.__chainSpan('model_configuration_read', operation);
  if (result.model) {
    if (result.model.api_key_encrypted) secretValues.push(result.model.api_key_encrypted);
    await emit({ stage: 'model_configuration', modelName: result.model.model_name, protocol: result.model.protocol,
      reasoningMode: result.model.reasoning_mode, timeoutMs: result.model.timeout_ms,
      storedMaxTokens: result.model.max_tokens, encryptedCredentialPresent: Boolean(result.model.api_key_encrypted),
      encryptionKeyPresent: Boolean(environment.AI_SECRET_ENCRYPTION_KEY),
      overrideEncryptionKeyPresent: Boolean(process.env.AI_SECRET_ENCRYPTION_KEY) });
    // Saved model parameters are read unchanged; the candidate owns per-call overrides.
  }
  return result;
};
const originalFetch = globalThis.fetch;
const ledgerPath = resolve('D:/codex-artifacts/market-annotation-chain-audit-20261014/provider-call-ledger.jsonl');
const ledgerLock = ledgerPath + '.exclusive-lock';
const { open, unlink } = await import('node:fs/promises');
const lockHandle = await open(ledgerLock, 'wx');
await lockHandle.writeFile(JSON.stringify({runId,sourceCommit,startedAt:new Date().toISOString()}));
try {

let providerCalls = 0;
providerCalls = (await readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean).length;
if(providerCalls + selected.length > 50) throw new Error('Insufficient authorized budget');
globalThis.fetch = async (urlValue, init = {}) => {
  const url = new URL(String(urlValue));
  const method = init.method || 'GET';
  if (['localhost', '127.0.0.1'].includes(url.hostname)) {
    if (url.port === '3000' && method === 'GET' && (url.pathname === '/api/market/annotations' || /^\/api\/market\/images\/[a-f0-9]{64}$/.test(url.pathname))) {
      return originalFetch(url, init);
    }
    if (url.port === '8112' && method === 'POST' && url.pathname === '/api/ai/consumer') {
      const body = JSON.parse(init.body);
      if (body.operation === 'model-runtime' && body.allowFallback === false && body.id === sampleContext.getStore()?.modelId) return originalFetch(url, init);
    }
    throw new Error('Audit rejected a non-allowlisted local operation');
  }
  if (url.origin !== 'https://opencode.ai' || url.pathname !== '/zen/go/v1/chat/completions' || url.search || method !== 'POST') {
    throw new Error('Audit rejected a non-allowlisted external operation');
  }
  if (providerCalls >= 50) throw new Error('Authorized provider-call budget exhausted');
  const body = JSON.parse(init.body);
  if (!new Headers(init.headers).has('x-opencode-session') || !new Headers(init.headers).get('user-agent')?.toLowerCase().includes('market')) throw new Error('Candidate omitted honest task metadata');
  if (body.thinking?.type !== 'disabled') throw new Error('Candidate did not disable annotation thinking');
  providerCalls += 1;
  const start = performance.now();
  const intent = { callNumber: providerCalls, runId, variant, sampleId: sampleContext.getStore().sampleId,
    at: new Date().toISOString(), model: body.model, maxTokens: body.max_tokens,
    thinking: body.thinking ?? null, sessionHeaderPresent: new Headers(init.headers).has('x-opencode-session'),
    honestAuditUserAgent: true, sourceCommit, requestBytes: Buffer.byteLength(init.body),
    requestSha256: createHash('sha256').update(init.body).digest('hex') };
  await appendFile(ledgerPath, JSON.stringify(intent) + '\n');
  await emit({ stage: 'provider_post', phase: 'start', ...intent });
  try {
    const response = await originalFetch(url, init);
    const data = await response.clone().json().catch(() => null);
    const choice = data?.choices?.[0];
    await emit({ stage: 'provider_post', phase: 'end', httpStatus: response.status,
      durationMs: Math.round((performance.now() - start) * 1000) / 1000,
      finishReason: choice?.finish_reason ?? null,
      contentCharacters: typeof choice?.message?.content === 'string' ? choice.message.content.length : null,
      reasoningCharacters: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : null,
      usage: boundedUsage(data?.usage),
      errorCode: data?.error?.code ?? null,
      errorMessage: data?.error ? safeError(data.error) : null });
    return response;
  } catch (error) {
    await emit({ stage: 'provider_post', phase: 'end', outcome: 'unknown_transport_result',
      durationMs: Math.round((performance.now() - start) * 1000) / 1000, message: safeError(error) });
    throw error;
  }
};
environment.SALES_IMPORT_FILES = { get: async (key) => {
  if (key.includes('/model-v1/')) return null; // Original cached bytes only; documented audit boundary.
  const sample = allSamples.find(s => s.imageCache.objectKey === key);
  if (!sample) return null;
  return globalThis.__chainSpan('cached_image_read_via_public_api', async () => {
    const response = await fetch('http://localhost:3000/api/market/images/' + sample.imageContentSha256, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Cached image read failed HTTP ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== sample.imageCache.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== sample.imageContentSha256) throw new Error('Cached image identity mismatch');
    return { size: bytes.length, body: new Response(bytes).body,
      httpMetadata: { contentType: sample.imageCache.mimeType }, customMetadata: { sha256: sample.imageContentSha256 } };
  });
} };
globalThis.__chainAuditEnv = environment;
const require = createRequire(join(source, 'package.json'));
const { build } = require('esbuild');
const generated = join(output, runId + '-adapter.mjs');
const posix = path => path.replaceAll('\\', '/');
await build({ stdin: { contents: `export * from ${JSON.stringify(posix(join(source, 'lib/market/annotation-model.ts')))}; export {annotationFailure} from ${JSON.stringify(posix(join(source, 'lib/market/annotation-failure.ts')))};`, resolveDir: source }, bundle: true,
  absWorkingDir: source, platform: 'node', format: 'esm', outfile: generated,
  alias: { '@': source }, plugins: [{ name: 'audit-read-only-boundaries', setup(plugin) {
    plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'environment', namespace: 'audit-env' }));
    plugin.onLoad({ filter: /.*/, namespace: 'audit-env' }, () => ({ contents: 'export const env=globalThis.__chainAuditEnv;', loader: 'js' }));
    plugin.onResolve({ filter: /(?:^@\/lib\/(?:ai\/crypto|django\/ai-service)|\/lib\/(?:ai\/crypto|django\/ai-service)\.ts)$/ }, args => {
      if (args.namespace === 'audit-trace') return { path: args.path, namespace: 'file' };
      return { path: args.path.includes('ai-service') ? 'ai-service' : 'crypto', namespace: 'audit-trace' };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'audit-trace' }, args => {
      const file = posix(join(source, args.path === 'crypto' ? 'lib/ai/crypto.ts' : 'lib/django/ai-service.ts'));
      return { loader: 'js', resolveDir: source, contents: args.path === 'crypto'
        ? `export * from ${JSON.stringify(file)}; import {decryptSecret as original} from ${JSON.stringify(file)}; export async function decryptSecret(value){return globalThis.__chainRememberCredential(await globalThis.__chainSpan('credential_decrypt',()=>original(value)));}`
        : `export * from ${JSON.stringify(file)}; import {aiConsumer as original} from ${JSON.stringify(file)}; export async function aiConsumer(...args){return globalThis.__chainModelRead(()=>original(...args));}` };
    });
  } }] });
const { runVisionAnnotation, annotationFailure } = await import(pathToFileURL(generated).href + '?run=' + runId);
const workspaceResponse = await fetch('http://localhost:3000/api/market/annotations?view=workspace_fast&itemPageSize=10', { signal: AbortSignal.timeout(35_000) });
if (!workspaceResponse.ok) throw new Error('Workspace identity read failed HTTP ' + workspaceResponse.status);
const workspace = await workspaceResponse.json();
const principal = workspace.principal;
if (!principal || !['admin', 'operator'].includes(principal.role) || principal.scope !== null) throw new Error('Expected authorized local principal');
const results = [];
async function runOne(sample) {
  const start = performance.now();
  await emit({ stage: 'vision_attempt', phase: 'start', mode: sample.mode, imageBytes: sample.imageCache.sizeBytes });
  try {
    const prediction = await runVisionAnnotation({ ...sample, jobId: taskManifest[sample.sampleId].jobId, principal, deadlineAt: Math.min(Date.now() + 140_000, Date.parse(taskManifest[sample.sampleId].leaseExpiresAt) - 15000) });
    const result = { sampleId: sample.sampleId, variant, outcome: 'success',
      durationMs: Math.round(performance.now() - start), providerCalls: rows.filter(r => r.sampleId === sample.sampleId && r.stage === 'provider_post' && r.phase === 'start').length,
      prediction: { segment: prediction.segment, imagePriceCents: prediction.imagePriceCents,
        priceType: prediction.priceType, priceLowCents: prediction.priceLowCents, priceHighCents: prediction.priceHighCents,
        confidenceBps: prediction.confidenceBps, reason: prediction.reason, rawDigest: prediction.rawDigest,
        imageSource: prediction.imageSource, timing: prediction.timing } };
    results.push(result);
    await emit({ stage: 'vision_attempt', phase: 'end', ...result });
  } catch (error) {
    const result = { sampleId: sample.sampleId, variant, outcome: 'error', durationMs: Math.round(performance.now() - start),
      providerCalls: rows.filter(r => r.sampleId === sample.sampleId && r.stage === 'provider_post' && r.phase === 'start').length,
      failure: annotationFailure(error), errorName: error.name, message: safeError(error), timing: error.timing ?? null };
    results.push(result);
    await emit({ stage: 'vision_attempt', phase: 'end', ...result });
  }
  const result = results.find(r => r.sampleId === sample.sampleId);
  console.log(JSON.stringify(options['stream-results'] === '1' ? { event: 'model_result', result } :
    { sampleId: sample.sampleId, result: result.outcome, durationMs: result.durationMs,
      providerCalls: result.providerCalls, message: result.message }));
}
const concurrency = Number(options.concurrency || '1');
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error('Invalid audit concurrency');
if (new Set(names).size !== names.length) throw new Error('Use unique sample identities per run');
const pending = [...selected];
await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
  while (pending.length) {
    const sample = pending.shift();
    await sampleContext.run(sample, () => runOne(sample));
  }
}));
const finalPath = join(output, runId + '.json');
await writeFile(finalPath, JSON.stringify({ runId, variant, release, results, totalLedgerCalls: providerCalls,
  sourceBinding: { sourceCommit, sourceHashes, auditScriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
    deployedModelSha256: createHash('sha256').update(await readFile(join(source, 'lib/market/annotation-model.ts'))).digest('hex') },
  limits: ['Node transport, original cached image via public API; production R2-native binding and image resize not timed',
    'No production job claim, completion, review or commit; no stored model configuration changes; candidate parameters are not modified by harness'], rows }, null, 2));
for (const [file,sha] of Object.entries(sourceHashes)) if(createHash('sha256').update(await readFile(join(source,file))).digest('hex') !== sha) throw new Error('Candidate changed during validation');
globalThis.fetch = originalFetch;
console.log(JSON.stringify({ report: finalPath, totalLedgerCalls: providerCalls }));
} finally {
  await lockHandle.close();
  await unlink(ledgerLock);
}
