// Creates a content-bound offline CLI artifact only; never a Worker release.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { hash, safeRead, canonical } from '../../tools/release-impact.mjs';
const workspace = path.resolve(process.argv[2]), destination = path.resolve(process.argv[3]);
assert.equal(path.dirname(destination).toLowerCase(), path.resolve('E:/codex-artifacts/release-high-impact-execution-20261010').toLowerCase());
await mkdir(destination); // Must be a fresh candidate; no in-place replacement.
const entries = [];
async function save(relative, bytes) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  entries.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
}
for (const relative of ['tools/release-composition-review.mjs', 'tools/release-impact.mjs', 'tools/worker-local-release.mjs',
  'tests/release-composition-review.test.mjs', 'docs/release-high-impact-execution-20261010/COMPOSITION_TOOL.md']) {
  await save(relative, await safeRead(path.join(workspace, relative)));
}
await save('provenance/project-package-lock.json', await safeRead(path.join(workspace, 'package-lock.json')));
async function copyDependency(relative) {
  const dir = path.join(workspace, relative);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Dependency redirects refused');
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await copyDependency(name);
    else await save(name, await safeRead(path.join(workspace, name)));
  }
}
await copyDependency('node_modules/typescript');
const typescript = JSON.parse(await safeRead(path.join(destination, 'node_modules/typescript/package.json')));
assert.equal(typescript.version, '5.9.3');
await save('package.json', Buffer.from(JSON.stringify({ name: 'teruisi-offline-composition-candidate', private: true,
  type: 'module', engines: { node: '>=22.13.0' }, dependencies: { typescript: '5.9.3' } }, null, 2) + '\n'));
entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
for (const entry of entries) assert.equal(hash(await safeRead(path.join(destination, entry.path))), entry.sha256);
const inventorySha256 = hash(entries);
const manifest = { kind: 'reviewable-offline-cli-candidate', inventorySha256, entries, productionRelease: false,
  productionBatchSha256: null, candidateEntry: 'tools/release-composition-review.mjs',
  limits: ['Contains copied byte-pinned TypeScript; no installation or production configuration required.',
    'Original Worker tool is an unchanged library dependency for read-only Git source enumeration; no lifecycle call is made.',
    'No production guard/rotation plan/approval is issued by this artifact.'] };
await writeFile(path.join(destination, 'candidate-manifest.json'), canonical(manifest) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ destination, files: entries.length, inventorySha256, manifestSha256: hash(canonical(manifest) + '\n') }));
