import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const policyVersion = 'teruisi-release-impact-v1';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function requireHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new Error(`Invalid ${label} digest`);
  return value;
}
export async function safeRead(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Redirected evidence/source path');
  }
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > 16n * 1024n * 1024n) throw new Error('Unsafe evidence/source file');
  if (path.resolve(await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error('Redirected file');
  const raw = await readFile(absolute);
  const after = await lstat(absolute, { bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(k => before[k] !== after[k])) throw new Error('File changed while reading');
  return raw;
}

export async function safeFileDigest(target) {
  const absolute = path.resolve(target);
  // safeRead's directory and leaf checks, without materializing an executable.
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Redirected executable path');
  }
  const before = await lstat(absolute, { bigint: true });
  // Windows Resource Protection legitimately hard-links this exact OS host
  // into WinSxS. It is still pinned by its full byte digest and exact path;
  // ordinary script/tool links remain forbidden.
  const systemPowerShell = absolute.toLowerCase() === path.resolve('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe').toLowerCase();
  if (!before.isFile() || (before.nlink !== 1n && !systemPowerShell)) throw new Error('Unsafe executable');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) digest.update(chunk);
  const after = await lstat(absolute, { bigint: true });
  if (['dev','ino','size','mtimeNs','ctimeNs','nlink'].some(k => before[k] !== after[k])) throw new Error('Executable changed while hashing');
  return digest.digest('hex');
}

// This proof is deliberately narrow: all executable tokens, imports, JSX
// structure and event attributes must remain identical. Text and literal
// className values still require an independently reviewed impact witness.
export function displaySkeleton(source, name = 'view.tsx') {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error('Unparseable display source');
  const spans = [];
  function visit(node) {
    if (ts.isJsxText(node)) spans.push([node.pos, node.end, '<display-text>']);
    else if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className'
      && node.initializer && ts.isStringLiteral(node.initializer)) {
      spans.push([node.initializer.getStart(file), node.initializer.end, '"<display-class>"']);
    } else ts.forEachChild(node, visit);
  }
  visit(file);
  let result = source;
  for (const [start, end, token] of spans.sort((a, b) => b[0] - a[0])) result = result.slice(0, start) + token + result.slice(end);
  return result;
}

const strictPath = /(^|\/)(migrations?|models?|auth[^/]*|access_control|import[^/]*|automation[^/]*)(\/|\.)|^(tools|config|worker|build|drizzle|\.openai)\/|\.sql$|(^|\/)(package(-lock)?\.json|vite\.config\.[^/]+)/i;
const sensitive = /permission|principal|authoriz|scopePolicy|fetch|XMLHttpRequest|sendBeacon|mutat|importData|localStorage|sessionStorage|cookie|eval|Function|\b(PUT|POST|PATCH|DELETE|INSERT|UPDATE|ALTER|DROP|GRANT|REVOKE|CREATE|TRUNCATE)\b/i;
export function sourceTreeDigest(files) {
  const digest = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    if (path.posix.isAbsolute(name) || name.split('/').some(p => p === '..' || p === '.') || name.includes('\\')) throw new Error('Unsafe source inventory path');
    const raw = files[name].startsWith('\u0000binary:') ? Buffer.from(files[name].slice(8), 'base64') : Buffer.from(files[name]);
    const label = Buffer.from(name);
    const labelSize = Buffer.alloc(4); labelSize.writeUInt32BE(label.length);
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(raw.length));
    digest.update(labelSize).update(label).update(size).update(raw);
  }
  return digest.digest('hex');
}
export function sourceInventory(files) {
  return Object.fromEntries(Object.entries(files).map(([k,v]) => [k,hash(v.startsWith('\u0000binary:') ? Buffer.from(v.slice(8),'base64') : v)]));
}
export function classifyImpact({ before, after, witness, inventory = { before:sourceInventory(before), after:sourceInventory(after) } }) {
  const changed = [...new Set([...Object.keys(inventory.before), ...Object.keys(inventory.after)])].sort().filter(k => inventory.before[k] !== inventory.after[k]);
  const deltaSha256 = hash(changed.map(name => ({ name, before: inventory.before[name] ?? null, after: inventory.after[name] ?? null })));
  const closureSha256 = hash(inventory);
  const bound = witness?.deltaSha256 === deltaSha256 && witness?.closureSha256 === closureSha256
    && witness?.independent === true && witness?.status === 'passed' && typeof witness?.reviewer === 'string' && witness.reviewer.length > 0
    && ['data', 'permissions', 'writes', 'imports', 'automation', 'lifecycle', 'backup', 'dependencyBehavior'].every(k => witness.effects?.[k] === false);
  let level = 'strict';
  const reasons = [];
  if (!changed.length) reasons.push('Empty release');
  if (!bound) reasons.push('Missing or stale independent dependency/behavior witness');
  if (changed.some(k => strictPath.test(k))) reasons.push('Protected lifecycle/data/dependency surface');
  let display = changed.length > 0;
  for (const name of changed) {
    if (name.startsWith('docs/') || name === 'README.md') continue;
    if (!name.endsWith('.tsx') || before[name] == null || after[name] == null) { display = false; continue; }
    try {
      if (displaySkeleton(before[name], name) !== displaySkeleton(after[name], name)) display = false;
    } catch { display = false; }
  }
  if (bound && changed.length && !changed.some(k => strictPath.test(k))) {
    if (display && witness.kind === 'display') level = 'display';
    // A non-display business change never qualifies for backup reuse. Unknown
    // dependencies, protected surfaces or changed sensitive behavior stay strict.
    else if (witness.kind === 'business' && changed.every(k => !sensitive.test(`${before[k] ?? ''}\n${after[k] ?? ''}`))) level = 'business';
  }
  if (level === 'strict' && !reasons.length) reasons.push('Executable or unproven impact');
  return { version: policyVersion, level, changed, deltaSha256, closureSha256, witnessSha256: witness ? hash(witness) : null, reasons };
}

export function makeImpactProof(before, after, witness) {
  const inventory = { before:sourceInventory(before), after:sourceInventory(after) };
  const changed = classifyImpact({ before, after, witness, inventory }).changed;
  return { inventory, witness: witness ?? null,
    before:Object.fromEntries(changed.filter(k => before[k] != null).map(k => [k,before[k]])),
    after:Object.fromEntries(changed.filter(k => after[k] != null).map(k => [k,after[k]])) };
}
export function verifyImpactProof(proof, binding) {
  if (!proof?.inventory?.before || !proof?.inventory?.after) throw new Error('Missing full impact inventories');
  for (const files of Object.values(proof.inventory)) for (const [name,digest] of Object.entries(files)) {
    requireHash(digest,'source inventory');
    if (path.posix.isAbsolute(name) || name.split('/').some(p => ['..','.'].includes(p)) || name.includes('\\')) throw new Error('Unsafe impact path');
  }
  if (hash(proof.inventory.after) !== binding.sourceInventorySha256 || hash(proof.inventory.before) !== binding.predecessorInventorySha256) throw new Error('Incomplete or changed impact closure');
  const changed = [...new Set([...Object.keys(proof.inventory.before),...Object.keys(proof.inventory.after)])].filter(k => proof.inventory.before[k] !== proof.inventory.after[k]);
  for (const side of ['before','after']) {
    const actual = sourceInventory(proof[side]);
    for (const name of changed) if ((actual[name] ?? null) !== (proof.inventory[side][name] ?? null)) throw new Error('Impact delta bytes changed');
    if (Object.keys(actual).some(k => !changed.includes(k))) throw new Error('Extra impact delta');
  }
  return classifyImpact({ ...proof, inventory:proof.inventory });
}

export const requirements = Object.freeze({
  display: { tests: ['impact', 'ui', 'boundary', 'build', 'permissions-regression'], backup: 'reusable-or-full', switch: 'worker-only', rollback: 'compatible-application', acceptance: ['resources', 'behavior', 'permissions', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
  business: { tests: ['domain', 'contract', 'negative', 'permissions', 'boundary', 'build'], backup: 'full-pre-and-post', switch: 'prepared-app-keep-postgres', rollback: 'compatible-application-or-approved-data-restore', acceptance: ['resources', 'business-deep-equivalence', 'permissions', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
  strict: { tests: ['domain', 'contract', 'negative', 'concurrency', 'permissions', 'migration-rehearsal', 'lifecycle', 'backup-recovery', 'boundary', 'build'], backup: 'full-pre-and-post', switch: 'reviewed-maintenance-scope', rollback: 'reviewed-forward-or-approved-data-restore', acceptance: ['resources', 'business', 'permissions', 'migrations', 'writes', 'components', 'startup', 'natural-watchdog', 'task-specific'] },
});

// Freshness limits are policy constants, never caller-controlled flags.
export const backupMaxAgeMs = 26 * 60 * 60 * 1000;
export const rehearsalMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export function backupReuseDecision({ impact, evidence, current, now = Date.now() }) {
  const reasons = [];
  const fresh = (stamp, budget) => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) && now - Date.parse(stamp) >= 0 && now - Date.parse(stamp) <= budget;
  if (impact?.level !== 'display') reasons.push('impact');
  if (evidence?.version !== 'teruisi-release-recovery-evidence-v1') reasons.push('version');
  if (current?.schedule?.active !== true || current?.schedule?.lastResult !== 'success'
    || !fresh(current?.schedule?.lastSuccessAt, backupMaxAgeMs)) reasons.push('daily-backup-not-continuous');
  if (!fresh(evidence?.backupCompletedAt, backupMaxAgeMs)) reasons.push('backup-expired');
  if (!fresh(evidence?.restoredAt, rehearsalMaxAgeMs)) reasons.push('restore-expired');
  if (evidence?.restoreStatus !== 'passed' || evidence?.cleanupStatus !== 'passed'
    || evidence?.contentEqual !== true || evidence?.rolesEqual !== true || evidence?.permissionsEqual !== true
    || evidence?.migrationsEqual !== true || evidence?.sequencesValid !== true) reasons.push('incomplete-restore');
  if (current?.pointExists !== true || current?.verifyStatus !== 'passed' || current?.retained !== true) reasons.push('point-unavailable');
  if (current?.sequencesValid !== true || current?.softwareCompatible !== true) reasons.push('current-environment-invalid');
  for (const field of ['manifestSha256', 'dumpSha256', 'environmentSha256', 'schemaSha256', 'rolesSha256', 'operatorSha256', 'retentionSha256', 'scheduleSha256']) {
    if (!/^[a-f0-9]{64}$/.test(evidence?.[field] ?? '') || evidence[field] !== current?.[field]) reasons.push(`changed-${field}`);
  }
  if (typeof evidence?.backupId !== 'string' || evidence.backupId !== current?.backupId) reasons.push('point-identity');
  return { mode: reasons.length ? 'full' : 'reuse', reasons, evidenceSha256: evidence ? hash(evidence) : null };
}

export async function readSourceTree(root) {
  const files = {};
  const decode = raw => {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
    catch { return `\u0000binary:${raw.toString('base64')}`; }
  };
  try {
    await lstat(path.join(root,'.git'));
    const { listGitSourceFiles } = await import('./worker-local-release.mjs');
    for (const name of await listGitSourceFiles(root)) files[name]=decode(await safeRead(path.join(root,...name.split('/'))));
    return files;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function walk(dir, prefix = '') {
    if ((await lstat(dir)).isSymbolicLink()) throw new Error('Redirected source tree');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (['.git', 'node_modules', 'dist', '.venv', '__pycache__', '.runtime', '.wrangler', '.vite-sites-cache', '.next', 'tmp', 'outputs', 'work', '.codex-tmp'].includes(entry.name)) continue;
      if (entry.name.startsWith('.env') || entry.name === '.dev.vars' || entry.name.endsWith('.pyc')) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target, `${relative}/`);
      else {
        const raw = await safeRead(target);
        files[relative] = decode(raw);
      }
    }
  }
  await walk(path.resolve(root));
  return files;
}
