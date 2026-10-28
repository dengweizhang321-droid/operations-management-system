import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectReleaseRetention } from "../tools/release-payload-retention.mjs";
import { dependencyRetentionPlan, dependencyAlgorithm } from "../tools/storage-retention-policy.mjs";

// This test reads the three tool files as TEXT and compares the numbers, rather
// than importing tools/worker-local-release-rotation.mjs (heavy side effects,
// touches production paths). It must keep working if maximumSuccessors changes
// again, which is the whole point: it derives the bound instead of hardcoding it.

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.resolve(here, "..", "tools");

const rotationPath = path.join(toolsDir, "worker-local-release-rotation.mjs");
const payloadRetentionPath = path.join(toolsDir, "release-payload-retention.mjs");
const storageRetentionPath = path.join(toolsDir, "storage-retention-policy.mjs");

function extractAll(filePath, pattern) {
  const text = readFileSync(filePath, "utf8");
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

function singleMatch(filePath, pattern, label) {
  const matches = extractAll(filePath, pattern);
  assert.equal(matches.length, 1,
    `Expected exactly one ${label} declaration in ${filePath}, found ${matches.length}. ` +
    `This test extracts the bound with a regex; if the declaration was renamed, reworded or duplicated, ` +
    `update the regex in tests/retention-bound-drift.test.mjs to match.`);
  return matches[0];
}

test("retention bounds in release-payload-retention.mjs and storage-retention-policy.mjs track maximumSuccessors", () => {
  const maximumSuccessors = singleMatch(
    rotationPath, /const\s+maximumSuccessors\s*=\s*(\d+)\s*;/g, "maximumSuccessors");
  const expectedBound = maximumSuccessors + 1;

  const payloadBound = singleMatch(
    payloadRetentionPath, /releases\.length > (\d+)/g, "releases.length > N bound");
  const storageBound = singleMatch(
    storageRetentionPath, /releases\.length > (\d+)/g, "releases.length > N bound");

  assert.equal(payloadBound, expectedBound,
    `tools/release-payload-retention.mjs is stale: its bound is ${payloadBound} but should be ${expectedBound} ` +
    `(1 + maximumSuccessors). maximumSuccessors = ${maximumSuccessors} lives in ` +
    `tools/worker-local-release-rotation.mjs; the array being guarded is ` +
    `[bootstrap.binding, ...successors], i.e. 1 + maximumSuccessors entries. ` +
    `Update the "releases.length > ${payloadBound}" check in tools/release-payload-retention.mjs to ` +
    `"releases.length > ${expectedBound}" and update its matching test fixtures.`);

  assert.equal(storageBound, expectedBound,
    `tools/storage-retention-policy.mjs is stale: its bound is ${storageBound} but should be ${expectedBound} ` +
    `(1 + maximumSuccessors). maximumSuccessors = ${maximumSuccessors} lives in ` +
    `tools/worker-local-release-rotation.mjs; the array being guarded is ` +
    `[bootstrap.binding, ...successors], i.e. 1 + maximumSuccessors entries. ` +
    `Update the "releases.length > ${storageBound}" check in tools/storage-retention-policy.mjs to ` +
    `"releases.length > ${expectedBound}" and update its matching test fixtures.`);
});

// Behavioural proof that the two retention functions actually honour the
// derived bound (not just that the literal in source text matches).

const maximumSuccessors = singleMatch(
  rotationPath, /const\s+maximumSuccessors\s*=\s*(\d+)\s*;/g, "maximumSuccessors");
const acceptedLength = maximumSuccessors + 1;
const rejectedLength = maximumSuccessors + 2;

// Fixture matching tests/release-payload-retention.test.mjs: one release per hour
// ending at the clock, ids matching /^\d{8}T\d{6}Z-[a-f0-9]{16}$/, unique, createdAt
// parseable and not after `now`.
function payloadChain(length, end = Date.parse("2026-09-28T00:00:00Z")) {
  return Array.from({ length }, (_, index) => ({
    releaseId: `20260101T000000Z-${index.toString(16).padStart(16, "0")}`,
    createdAt: new Date(end - (length - 1 - index) * 3600000).toISOString(),
  }));
}

test(`selectReleaseRetention accepts maximumSuccessors + 1 (${acceptedLength}) and rejects maximumSuccessors + 2 (${rejectedLength})`, () => {
  assert.doesNotThrow(() => selectReleaseRetention(payloadChain(acceptedLength), "2026-09-28T00:00:00Z"));
  assert.throws(() => selectReleaseRetention(payloadChain(rejectedLength), "2026-09-28T00:00:00Z"),
    /Invalid retention inventory/,
    `selectReleaseRetention should reject a chain of ${rejectedLength} entries (maximumSuccessors + 2); ` +
    `its bound in tools/release-payload-retention.mjs is out of sync with maximumSuccessors = ${maximumSuccessors} ` +
    `in tools/worker-local-release-rotation.mjs.`);
});

// Fixture matching tests/storage-retention-policy.test.mjs: releases(count)/hash/tree
// shape; dependencyRetentionPlan requires releases.at(-1).releaseId === headReleaseId
// and a valid 64-hex chainStateSha256.
const hash = (digit) => digit.repeat(64);
const tree = { algorithm: dependencyAlgorithm, fileCount: 2, sha256: hash("a") };
function storageChain(count) {
  return Array.from({ length: count }, (_, i) => ({
    releaseId: `20260912T000000Z-${i.toString(16).padStart(16, "0")}`,
    manifestSha256: hash("b"), tree,
  }));
}

test(`dependencyRetentionPlan accepts maximumSuccessors + 1 (${acceptedLength}) and rejects maximumSuccessors + 2 (${rejectedLength})`, () => {
  const accepted = storageChain(acceptedLength);
  assert.doesNotThrow(() => dependencyRetentionPlan({
    releases: accepted, headReleaseId: accepted.at(-1).releaseId, chainStateSha256: hash("c"),
  }));
  const rejected = storageChain(rejectedLength);
  assert.throws(() => dependencyRetentionPlan({
    releases: rejected, headReleaseId: rejected.at(-1).releaseId, chainStateSha256: hash("c"),
  }), /Invalid retention input/,
    `dependencyRetentionPlan should reject a chain of ${rejectedLength} entries (maximumSuccessors + 2); ` +
    `its bound in tools/storage-retention-policy.mjs is out of sync with maximumSuccessors = ${maximumSuccessors} ` +
    `in tools/worker-local-release-rotation.mjs.`);
});
