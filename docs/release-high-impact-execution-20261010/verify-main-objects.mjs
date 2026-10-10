import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { sourceInventory, sourceTreeDigest, hash } from '../../tools/release-impact.mjs';
import { listGitSourceFiles } from '../../tools/worker-local-release.mjs';
const workspace = process.argv[2], commit = 'bc1d830b6770bd2858c31aa4d861354da5ec433c';
const tracked = new Set(execFileSync('git', ['ls-tree', '-rz', '--name-only', commit], { cwd: workspace, encoding: 'utf8' }).split('\0').filter(Boolean));
const names = (await listGitSourceFiles(workspace)).filter(name => tracked.has(name)).sort();
assert.ok(names.every(name => !/[\r\n]/.test(name)));
const raw = execFileSync('git', ['cat-file', '--batch'], { cwd: workspace, input: names.map(name => `${commit}:${name}\n`).join(''), maxBuffer: 256 * 1024 * 1024 });
let offset = 0;
const files = Object.create(null);
for (const name of names) {
  const end = raw.indexOf(10, offset), header = raw.subarray(offset, end).toString('ascii');
  const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
  assert.ok(match, 'Unexpected Git object output');
  const length = Number(match[2]), content = raw.subarray(end + 1, end + 1 + length);
  assert.equal(content.length, length);
  try { files[name] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
  catch { files[name] = `\u0000binary:${content.toString('base64')}`; }
  offset = end + 1 + length;
  assert.equal(raw[offset++], 10);
}
assert.equal(offset, raw.length);
const observed = JSON.parse(await readFile('E:/codex-artifacts/release-high-impact-execution-20261010/source-deltas.json', 'utf8')).main;
const rawBlobSourceSha256 = sourceTreeDigest(files);
// This repository explicitly checks out *.bat as CRLF. Compare checkout bytes,
// retaining the raw Git-object digest separately rather than conflating them.
assert.equal(files['.gitattributes'].trim(), '*.bat text eol=crlf');
const normalizedBatchFiles = Object.keys(files).filter(name => name.endsWith('.bat'));
for (const name of normalizedBatchFiles) files[name] = files[name].replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const result = { commit, files: names.length, rawBlobSourceSha256, normalizedBatchFiles,
  sourceSha256: sourceTreeDigest(files), inventorySha256: hash(sourceInventory(files)),
  purpose: 'Git blob reconstruction verifies the earlier baseline-path workspace observation', verified: true };
assert.equal(result.files, observed.afterFiles);
assert.equal(result.sourceSha256, observed.afterSourceSha256);
assert.equal(result.inventorySha256, observed.afterInventorySha256);
await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
