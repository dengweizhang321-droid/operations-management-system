// A single read-only closure check, not a collector or production action.
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { hash, safeRead, safeFileDigest } from '../../tools/release-impact.mjs';
const root = 'E:/codex-artifacts/release-integration-review-20261010/AB-v2-555729fd8f1dedc2';
const startedAtUtc = new Date().toISOString();
const start = performance.now();
const modulePath = `${root}/python-closure.mjs`, baselinePath = `${root}/python-closure.json`;
const moduleSha256 = hash(await safeRead(modulePath));
const baselineRaw = await safeRead(baselinePath), baseline = JSON.parse(baselineRaw);
const { verifyPythonClosure } = await import(`file:///${modulePath}`);
const wrapperMaterialReadAndImportMs = performance.now() - start;
let files = 0, digestFileMs = 0;
const closureStart = performance.now();
const result = await verifyPythonClosure(baseline, async target => {
  const begin = performance.now(), digest = await safeFileDigest(target);
  digestFileMs += performance.now() - begin; files++;
  return digest;
});
const pythonClosureMs = performance.now() - closureStart;
const output = { startedAtUtc, completedAtUtc: new Date().toISOString(), purpose: 'single-readonly-original-python-closure-check',
  modulePath, moduleSha256, baselinePath, baselineRawSha256: hash(baselineRaw), files, result,
  wrapperMaterialReadAndImportMs, pythonClosureMs, digestFileMs, totalMs: performance.now() - start,
  limits: ['One sample on current host; no optimization comparison or production-minute projection.',
    'Import/material read is not full wrapper latency; unchanged child collector was not invoked.',
    'Original full digest, inventory, path, hardlink and startup-hook checks retained.',
    'No Status, lifecycle action, WAL update, production backup/restore, scheduler change or business write.',
    'Python closure belongs to original AB support; it is not a new adopted collector binding.'] };
await writeFile(process.argv[2], `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ files, result, pythonClosureMs, wrapperMaterialReadAndImportMs, digestFileMs }));
