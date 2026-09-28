import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffectiveReleaseChain } from "./worker-local-release-rotation.mjs";
import { assertNoReparsePoint, canonicalJson, hashTree, sha256Bytes, verifyWorkerRelease, workerRuntimeRoot } from "./worker-local-release.mjs";

export const payloadNames = ["dist", "helper", "source-snapshot", "node_modules"];
const releaseId = /^\d{8}T\d{6}Z-[a-f0-9]{16}$/;
export function asciiJson(value) {
  // Native PowerShell 5 pipelines may decode stdout using a legacy code page.
  // Escaped JSON keeps path values lossless without changing the console's code page.
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function selectReleaseRetention(releases, now, pinned = []) {
  const clock = Date.parse(now);
  if (!Number.isFinite(clock) || !Array.isArray(releases) || !releases.length || releases.length > 257
      || !Array.isArray(pinned) || pinned.some((id) => !releaseId.test(id))) throw new Error("Invalid retention inventory");
  const seen = new Set();
  for (const item of releases) {
    if (!releaseId.test(item.releaseId) || seen.has(item.releaseId)
        || !Number.isFinite(Date.parse(item.createdAt)) || Date.parse(item.createdAt) > clock) throw new Error("Invalid release identity or timestamp");
    seen.add(item.releaseId);
  }
  if (pinned.some((id) => !seen.has(id))) throw new Error("Protected release missing from verified chain");
  const keep = new Set([...pinned, ...releases.slice(-3).map((item) => item.releaseId)]);
  for (const item of releases) if (Date.parse(item.createdAt) >= clock - 7 * 86400000) keep.add(item.releaseId);
  return { retained: releases.filter((item) => keep.has(item.releaseId)), candidates: releases.filter((item) => !keep.has(item.releaseId)) };
}

export function exactPayloadPath(root, id, name) {
  if (!releaseId.test(id) || !payloadNames.includes(name)) throw new Error("Invalid payload target");
  const target = path.resolve(root, "releases", id, name);
  if (path.dirname(path.dirname(target)) !== path.resolve(root, "releases")) throw new Error("Target escaped releases root");
  return target;
}

async function metadata(root, relative = "") {
  const items = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (!relative && payloadNames.includes(entry.name)) continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(root, name);
    await assertNoReparsePoint(full);
    if (entry.isDirectory()) items.push(...await metadata(root, name));
    else items.push({ relativePath: name, sha256: sha256Bytes(await readFile(full)) });
  }
  return items;
}

export async function planReleaseRetention(now = new Date().toISOString()) {
  const chain = await resolveEffectiveReleaseChain({ verifyInstalledHead: true });
  const headManifest = JSON.parse(await readFile(chain.headManifestPath, "utf8"));
  await verifyWorkerRelease({ manifestPath: chain.headManifestPath, approvedManifestSha256: chain.head.manifestSha256,
    expectedSourceD1PathSha256: headManifest.runtime.sourceD1PathSha256,
    expectedPersistRootPathSha256: headManifest.runtime.persistRootPathSha256, processPolicy: "stopped-or-exact-release" });
  const bindings = [chain.bootstrap.binding, ...chain.records.map((record) => record.value.successor)];
  const releases = [];
  for (const binding of bindings) {
    const full = path.join(workerRuntimeRoot, "releases", binding.releaseId, "deployment-manifest.json");
    await assertNoReparsePoint(full);
    const bytes = await readFile(full);
    if (sha256Bytes(bytes) !== binding.manifestSha256) throw new Error("Release manifest changed");
    const manifest = JSON.parse(bytes);
    releases.push({ ...binding, createdAt: manifest.createdAt, manifest });
  }
  const pinFile = path.join(workerRuntimeRoot, "state", "release-retention-protection.json");
  let pinned = [];
  try {
    await assertNoReparsePoint(pinFile);
    const protection = JSON.parse(await readFile(pinFile, "utf8"));
    if (protection.version !== "teruisi-release-protection-v1" || Object.keys(protection).sort().join() !== "releaseIds,version") throw new Error("Invalid protection record");
    pinned = protection.releaseIds;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const selected = selectReleaseRetention(releases, now, pinned);
  const targets = [], retainedKeys = [], preservedMetadata = [];
  for (const item of selected.retained) {
    for (const key of item.manifest.artifacts.keyFiles) {
      const file = path.join(workerRuntimeRoot, "releases", item.releaseId, key.relativePath);
      await assertNoReparsePoint(file);
      if (sha256Bytes(await readFile(file)) !== key.sha256) throw new Error("Retained release is incomplete");
      retainedKeys.push({ path: file, sha256: key.sha256 });
    }
  }
  for (const item of selected.candidates) {
    const root = path.join(workerRuntimeRoot, "releases", item.releaseId);
    preservedMetadata.push(...(await metadata(root)).map((key) => ({ path: path.join(root, key.relativePath), sha256: key.sha256 })));
    for (const name of payloadNames) {
      const target = exactPayloadPath(workerRuntimeRoot, item.releaseId, name);
      let info;
      try { info = await lstat(target); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      await assertNoReparsePoint(target);
      if (!info.isDirectory()) throw new Error("Payload is not a directory");
      const expected = name === "source-snapshot" ? item.manifest.source.tree
        : item.manifest.build[{ dist: "distTree", helper: "helperTree", node_modules: "nodeModulesTree" }[name]];
      const actual = await hashTree(target, name === "dist" ? { excluded: new Set(["server/.dev.vars"]) } : {});
      if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("Old payload changed; cleanup refused");
      targets.push({ path: target, releaseId: item.releaseId, name, manifestSha256: item.manifestSha256 });
    }
  }
  const after = await resolveEffectiveReleaseChain({ verifyInstalledHead: true });
  if (after.chainStateSha256 !== chain.chainStateSha256) throw new Error("Release chain changed");
  return { version: "teruisi-release-payload-retention-v1", createdAt: now, chainStateSha256: chain.chainStateSha256,
    headReleaseId: chain.head.releaseId, retainedReleaseIds: selected.retained.map((item) => item.releaseId),
    targets, retainedKeys, preservedMetadata };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Planner accepts no arguments");
  planReleaseRetention().then((result) => process.stdout.write(asciiJson(result) + "\n"))
    .catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
