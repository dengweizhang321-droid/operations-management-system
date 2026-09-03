import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  activationFenceRelativePath,
  canonicalJson,
  salesRetirementMigrationSha256,
  sha256Bytes,
  sha256Canonical,
  windowsPathSha256,
  withPayloadSha256,
  workerGuardCheckNames,
  workerGuardEntrypointPaths,
  workerGuardForbiddenScans,
  workerReleaseActivationFence,
} from "../tools/worker-local-release.mjs";
import {
  applyApprovedRotationPlanForTest,
  buildEntrypointPlan,
  publishSuccessorRecord,
  publishRotationPlan,
  publicationStagingDirectoryName,
  atomicInstallFile,
  releaseBinding,
  resolveEffectiveReleaseChain,
  rotationConsumptionDirectoryName,
  rotationPlanPayload,
  successorDirectoryName,
  successorPayload,
} from "../tools/worker-local-release-rotation.mjs";
import { assertReleaseWorkerLaunchAllowed } from "../tools/worker-authority-guard.mjs";

const hex = (character: string) => character.repeat(64);

test("successor sequence remains bounded while allowing continued forward releases", () => {
  const predecessor = releaseBinding({
    releaseId: "20260903T000000Z-0000000000000001",
    manifestSha256: hex("1"),
    guardReceiptSha256: hex("2"),
  });
  const successor = releaseBinding({
    releaseId: "20260903T000001Z-0000000000000002",
    manifestSha256: hex("3"),
    guardReceiptSha256: hex("4"),
  });
  const input = {
    predecessor,
    successor,
    lineage: {},
    approvedPlanSha256: hex("5"),
    activatedAt: "2026-09-03T00:00:00.000Z",
  };

  assert.equal(successorPayload({ ...input, sequence: 33 }).sequence, 33);
  assert.equal(successorPayload({ ...input, sequence: 128 }).sequence, 128);
  assert.throws(() => successorPayload({ ...input, sequence: 129 }), /sequence/);
});

async function writeCanonical(target: string, value: unknown) {
  const raw = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  await writeFile(target, raw);
  return sha256Bytes(raw);
}

async function makeRelease(
  runtime: string,
  protectedRoot: string,
  releaseId: string,
  entrypointText: string,
  {
    includeRotationEntrypoint = true,
    createdAt = "2026-08-30T00:00:00.000Z",
    sourceFingerprint = hex("1"),
    buildFingerprint = hex("6"),
    entrypointTextByPath = {} as Record<string, string>,
  } = {},
) {
  const releaseRoot = path.join(runtime, "releases", releaseId);
  await mkdir(path.join(releaseRoot, "audit"), { recursive: true });
  await mkdir(path.join(releaseRoot, "tools"), { recursive: true });
  const entrypointPaths = includeRotationEntrypoint
    ? [...workerGuardEntrypointPaths]
    : workerGuardEntrypointPaths.filter((relativePath) => ![
      "tools/worker-local-release-rotation.mjs",
      activationFenceRelativePath,
    ].includes(relativePath));
  const activationFence = workerReleaseActivationFence({ createdAt, sourceFingerprint, buildFingerprint });
  const entrypoints = [];
  const entrypointBytes = new Map<string, Buffer>();
  for (const relativePath of entrypointPaths) {
    const content = entrypointTextByPath[relativePath]
      ?? (relativePath === "tools/worker-local-service.ps1" ? entrypointText : "stable");
    const raw = relativePath === activationFenceRelativePath
      ? Buffer.from(`${canonicalJson(activationFence)}\n`, "utf8")
      : Buffer.from(`${content}:${relativePath}`, "utf8");
    await mkdir(path.dirname(path.join(releaseRoot, ...relativePath.split("/"))), { recursive: true });
    await writeFile(path.join(releaseRoot, ...relativePath.split("/")), raw);
    entrypointBytes.set(relativePath, raw);
    entrypoints.push({ relativePath, sha256: sha256Bytes(raw) });
  }
  const sourceD1Path = path.join(runtime, "state.sqlite");
  const persistRoot = path.join(runtime, "persist");
  const guard = withPayloadSha256({
    version: "teruisi-legacy-worker-guard-receipt-v1",
    generatedAt: "2026-08-30T00:00:00.000Z",
    sourceFingerprint,
    status: "passed",
    bindings: {
      protectedSourceRoot: protectedRoot,
      protectedSourceRootPathSha256: windowsPathSha256(protectedRoot),
      persistRoot,
      persistRootPathSha256: windowsPathSha256(persistRoot),
      sourceD1Path,
      sourceD1PathSha256: windowsPathSha256(sourceD1Path),
      authorityRelativePath: "state/sales-postgresql-authority.json",
      authoritySidecarRelativePath: "state/sales-postgresql-authority.json.sha256",
    },
    checks: Object.fromEntries(workerGuardCheckNames.map((name) => [name, true])),
    entrypoints,
    forbiddenLegacyDirectCommands: workerGuardForbiddenScans.map((item) => ({ ...item, matches: [] })),
  }, "receiptPayloadSha256");
  const guardSha256 = await writeCanonical(path.join(releaseRoot, "audit", "legacy-worker-guard-receipt.json"), guard);
  const contractSha256 = await writeCanonical(path.join(releaseRoot, "audit", "sales-retired-code-receipt.json"), { status: "passed" });
  const manifest = withPayloadSha256({
    version: "teruisi-local-worker-release-v1",
    releaseId,
    createdAt,
    source: { sourceFingerprint },
    build: { buildFingerprint },
    runtime: {
      runtimeRootPathSha256: windowsPathSha256(runtime),
      releaseRootPathSha256: windowsPathSha256(releaseRoot),
      sourceD1Path,
      sourceD1PathSha256: windowsPathSha256(sourceD1Path),
      persistRoot,
      persistRootPathSha256: windowsPathSha256(persistRoot),
      protectedSourceRoot: protectedRoot,
      protectedSourceRootPathSha256: windowsPathSha256(protectedRoot),
      host: "127.0.0.1",
      port: 3000,
      cliOverridesAllowed: false,
      helperMode: "supervisor_managed_immutable_bundle",
      helperHost: "127.0.0.1",
      helperPort: 5791,
      helperMutableRoot: protectedRoot,
      helperMutableRootPathSha256: windowsPathSha256(protectedRoot),
      devVars: {},
    },
    artifacts: {
      keyFiles: entrypoints.map((item) => ({ ...item })),
      guardReceipt: {
        version: "teruisi-legacy-worker-guard-receipt-v1",
        relativePath: "audit/legacy-worker-guard-receipt.json",
        sha256: guardSha256,
      },
      contractReceipt: {
        version: "teruisi-sales-retired-code-receipt-v1",
        relativePath: "audit/sales-retired-code-receipt.json",
        sha256: contractSha256,
      },
    },
    processIdentity: {
      supervisorEntrypoint: "tools/worker-local-runtime-supervisor.mjs",
      serviceControl: "tools/worker-local-service.ps1",
      manifestFile: "deployment-manifest.json",
      processReceipt: "state/worker-process.json",
      processReceiptVersion: "teruisi-local-worker-process-v1",
      wranglerEntrypoint: "node_modules/wrangler/bin/wrangler.js",
      wranglerCliEntrypoint: "node_modules/wrangler/wrangler-dist/cli.js",
      fixedWranglerArguments: [],
      helperEntrypoint: "helper/tmall-workflow-helper.mjs",
      fixedHelperArguments: ["serve", "--port", "5791"],
    },
  }, "manifestPayloadSha256");
  const manifestPath = path.join(releaseRoot, "deployment-manifest.json");
  const manifestSha256 = await writeCanonical(manifestPath, manifest);
  return {
    releaseId,
    releaseRoot,
    manifestPath,
    manifestSha256,
    guardReceiptSha256: guardSha256,
    contractReceiptSha256: contractSha256,
    entrypointSha256: entrypoints.find((item) => item.relativePath === "tools/worker-local-service.ps1")!.sha256,
    entrypointRaw: entrypointBytes.get("tools/worker-local-service.ps1")!,
    entrypointBytes,
    entrypoints,
  };
}

async function fixture() {
  const runtime = await mkdtemp(path.join(tmpdir(), "teruisi-worker-rotation-"));
  const protectedRoot = path.join(runtime, "protected");
  await mkdir(path.join(runtime, "releases"));
  await mkdir(path.join(runtime, "state"));
  await mkdir(protectedRoot);
  await mkdir(path.join(runtime, "persist"));
  await writeCanonical(path.join(runtime, "runtime-root.json"), withPayloadSha256({
    version: "teruisi-local-worker-release-v1",
    runtimeRootPathSha256: windowsPathSha256(runtime),
  }, "markerPayloadSha256"));
  const bootstrapRelease = await makeRelease(
    runtime, protectedRoot, "20260830T000000Z-1111111111111111", "bootstrap-service",
    { includeRotationEntrypoint: false, createdAt: "2026-08-30T00:00:00.000Z", buildFingerprint: hex("6") },
  );
  for (const [relativePath, raw] of bootstrapRelease.entrypointBytes) {
    const target = path.join(protectedRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, raw);
  }
  const database = new DatabaseSync(path.join(runtime, "state.sqlite"));
  try {
    database.exec("CREATE TABLE domain_retirement_receipts (domain TEXT, version TEXT, status TEXT)");
    database.exec("INSERT INTO domain_retirement_receipts VALUES ('sales','sales-domain-retirement-receipt-v1','completed')");
    for (const name of [
      "sales_import_upload_chunks", "sales_import_uploads", "sales_order_lines", "sales_import_batches",
      "sales_overview_response_cache", "sales_overview_cache_state", "sales_projection_outbox",
      "sales_projection_source_state", "sales_write_authority",
    ]) database.exec(`CREATE VIEW \`${name}\` AS SELECT 'sales-domain-retired-v1' AS \`retirement_tombstone\` WHERE 0`);
    for (const [shortName, tableName] of [
      ["fingerprints", "import_content_fingerprints"],
      ["attempts", "import_content_attempts"],
      ["scope_heads", "import_scope_heads"],
    ]) {
      database.exec(`CREATE TABLE \`${tableName}\` (domain TEXT)`);
      for (const operation of ["insert", "update", "delete"]) {
        const reference = operation === "update" ? "OLD.`domain` = 'sales' OR NEW.`domain` = 'sales'"
          : `${operation === "insert" ? "NEW" : "OLD"}.\`domain\` = 'sales'`;
        database.exec(`CREATE TRIGGER \`sales_retired_${shortName}_${operation}_guard\` BEFORE ${operation.toUpperCase()} ON \`${tableName}\` WHEN ${reference} BEGIN SELECT RAISE(ABORT, 'sales_domain_retired'); END`);
      }
    }
  } finally {
    database.close();
  }
  const pointer = withPayloadSha256({
    version: "teruisi-local-worker-current-v1",
    releaseId: bootstrapRelease.releaseId,
    manifestRelativePath: `releases/${bootstrapRelease.releaseId}/deployment-manifest.json`,
    manifestSha256: bootstrapRelease.manifestSha256,
  }, "pointerPayloadSha256");
  const pointerSha256 = await writeCanonical(path.join(runtime, "current-deployment.json"), pointer);
  const authority = withPayloadSha256({
    version: "teruisi-sales-postgresql-authority-v1",
    domain: "sales",
    authority: "postgresql",
    cutoverId: "sales-cutover-test-0001",
    workerReleaseId: bootstrapRelease.releaseId,
    workerReleaseManifestSha256: bootstrapRelease.manifestSha256,
    djangoDeploymentManifestSha256: hex("2"),
    guardReceiptSha256: bootstrapRelease.guardReceiptSha256,
    sourceD1PathSha256: windowsPathSha256(path.join(runtime, "state.sqlite")),
    persistRootPathSha256: windowsPathSha256(path.join(runtime, "persist")),
  }, "payloadSha256");
  const authorityPath = path.join(runtime, "state", "sales-postgresql-authority.json");
  const authoritySha256 = await writeCanonical(authorityPath, authority);
  await writeFile(`${authorityPath}.sha256`, `${authoritySha256}\n`, "ascii");
  const candidate = await makeRelease(
    runtime, protectedRoot, "20260830T000001Z-2222222222222222", "candidate-service",
    { createdAt: "2026-08-30T00:00:01.000Z", buildFingerprint: hex("7") },
  );
  const cutoverEvidence = {
    attestationPayloadSha256: hex("3"),
    attestationFileSha256: hex("4"),
    forwardRecoverySha256: hex("5"),
  };
  return { runtime, protectedRoot, bootstrapRelease, candidate, pointerSha256, authoritySha256, authority, cutoverEvidence };
}

function lineage(item: Awaited<ReturnType<typeof fixture>>, predecessorContract: string, successorContract: string) {
  return {
    bootstrapCurrentPointerSha256: item.pointerSha256,
    bootstrapAuthoritySha256: item.authoritySha256,
    cutoverId: item.authority.cutoverId,
    djangoDeploymentManifestSha256: item.authority.djangoDeploymentManifestSha256,
    sourceD1PathSha256: item.authority.sourceD1PathSha256,
    persistRootPathSha256: item.authority.persistRootPathSha256,
    ...item.cutoverEvidence,
    salesRetirementMigrationSha256,
    predecessorContractReceiptSha256: predecessorContract,
    successorContractReceiptSha256: successorContract,
  };
}

async function approvedTransition(
  item: Awaited<ReturnType<typeof fixture>>,
  chain: Awaited<ReturnType<typeof resolveEffectiveReleaseChain>>,
  candidateRelease = item.candidate,
  predecessorRelease = item.bootstrapRelease,
  createdAt = "2026-08-30T00:01:00.000Z",
) {
  const candidate = releaseBinding(candidateRelease);
  const recordLineage = lineage(item, predecessorRelease.contractReceiptSha256, candidateRelease.contractReceiptSha256);
  const plan = rotationPlanPayload({
    createdAt,
    chain,
    candidate,
    lineage: recordLineage,
    protectedEntrypoints: candidateRelease.entrypoints.map((candidateEntrypoint) => ({
      relativePath: candidateEntrypoint.relativePath,
      predecessorSha256: predecessorRelease.entrypoints.find(
        (predecessorEntrypoint) => predecessorEntrypoint.relativePath === candidateEntrypoint.relativePath,
      )?.sha256 ?? null,
      candidateSha256: candidateEntrypoint.sha256,
    })),
  });
  const publication = await publishRotationPlan(item.runtime, plan);
  const record = successorPayload({
    sequence: chain.successorCount + 1,
    predecessor: chain.head,
    successor: candidate,
    lineage: recordLineage,
    approvedPlanSha256: publication.planSha256,
    activatedAt: plan.createdAt,
  });
  return { plan, planSha256: publication.planSha256, record };
}

async function approvedRecord(item: Awaited<ReturnType<typeof fixture>>, chain: Awaited<ReturnType<typeof resolveEffectiveReleaseChain>>) {
  return (await approvedTransition(item, chain)).record;
}

async function installCandidateEntrypoints(item: Awaited<ReturnType<typeof fixture>>) {
  await installReleaseEntrypoints(item.protectedRoot, item.candidate);
}

async function installReleaseEntrypoints(
  protectedRoot: string,
  release: Awaited<ReturnType<typeof makeRelease>>,
) {
  for (const [relativePath, raw] of release.entrypointBytes) {
    const target = path.join(protectedRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, raw);
  }
}

async function protectedSnapshot(
  protectedRoot: string,
  entrypoints: Array<{ relativePath: string }>,
) {
  const result: Record<string, string | null> = {};
  for (const { relativePath } of entrypoints) {
    try {
      result[relativePath] = sha256Bytes(await readFile(path.join(protectedRoot, ...relativePath.split("/"))));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") result[relativePath] = null;
      else throw error;
    }
  }
  return result;
}

async function releaseManifestContext(release: Awaited<ReturnType<typeof makeRelease>>) {
  return {
    manifestPath: release.manifestPath,
    manifestSha256: release.manifestSha256,
    manifest: JSON.parse(await readFile(release.manifestPath, "utf8")),
  };
}

async function directoryNamesOrEmpty(target: string) {
  try {
    return (await readdir(target)).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

test("append-only successor resolves an effective head without rewriting bootstrap current or authority", async () => {
  const item = await fixture();
  try {
    const beforePointer = await readFile(path.join(item.runtime, "current-deployment.json"));
    const beforeAuthority = await readFile(path.join(item.runtime, "state", "sales-postgresql-authority.json"));
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true });
    const record = await approvedRecord(item, chain);
    await installCandidateEntrypoints(item);
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true }),
      /effective head protected entrypoint 未匹配 guard/,
    );
    await publishSuccessorRecord(item.runtime, record, chain.bootstrap);
    const after = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true });
    assert.equal(after.head.releaseId, item.candidate.releaseId);
    assert.equal(after.successorCount, 1);
    assert.deepEqual(await readFile(path.join(item.runtime, "current-deployment.json")), beforePointer);
    assert.deepEqual(await readFile(path.join(item.runtime, "state", "sales-postgresql-authority.json")), beforeAuthority);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("release launch guard authorizes only the append-only effective head after activation", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const record = await approvedRecord(item, chain);
    await installCandidateEntrypoints(item);
    await publishSuccessorRecord(item.runtime, record, chain.bootstrap);
    await assert.rejects(assertReleaseWorkerLaunchAllowed({
      manifestPath: item.bootstrapRelease.manifestPath,
      manifestSha256: item.bootstrapRelease.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    }), /effective head release/);
    const candidateAllowed = await assertReleaseWorkerLaunchAllowed({
      manifestPath: item.candidate.manifestPath,
      manifestSha256: item.candidate.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    });
    assert.equal(candidateAllowed.mode, "release-post-cutover-successor");
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("successor publication is same-tuple idempotent and repairs only its exact missing sidecar", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const record = await approvedRecord(item, chain);
    const first = await publishSuccessorRecord(item.runtime, record, chain.bootstrap);
    await rm(first.sidecarPath);
    const repaired = await publishSuccessorRecord(item.runtime, record, chain.bootstrap);
    assert.equal(repaired.sha256, first.sha256);
    const conflicting = successorPayload({ ...record, approvedPlanSha256: hex("7") });
    await assert.rejects(publishSuccessorRecord(item.runtime, conflicting, chain.bootstrap), /批准元组不一致/);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("resolver rejects incomplete sidecars and unreachable fork records", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const record = await approvedRecord(item, chain);
    const publication = await publishSuccessorRecord(item.runtime, record, chain.bootstrap);
    await rm(publication.sidecarPath);
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true }),
      /未知文件|不完整|孤立存在/,
    );
    await writeFile(publication.sidecarPath, `${publication.sha256}\n`, "ascii");
    const root = path.join(item.runtime, "state", successorDirectoryName);
    const orphanSidecar = path.join(root, `${hex("f")}.json.sha256`);
    await writeFile(orphanSidecar, `${hex("e")}\n`, "ascii");
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true }),
      /未知文件|不完整|孤立存在/,
    );
    await rm(orphanSidecar);
    const fakePredecessor = releaseBinding({
      releaseId: "20260830T000002Z-3333333333333333",
      manifestSha256: hex("8"),
      guardReceiptSha256: hex("9"),
    });
    const fork = successorPayload({ ...record, predecessor: fakePredecessor, sequence: 2 });
    const forkPath = path.join(root, `${fakePredecessor.bindingSha256}.json`);
    const forkSha = await writeCanonical(forkPath, fork);
    await writeFile(`${forkPath}.sha256`, `${forkSha}\n`, "ascii");
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true }),
      /不可达记录、分叉或伪造前驱/,
    );
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("rotation plan binds predecessor CAS, immutable evidence and protected-entrypoint before/after hashes", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const plan = rotationPlanPayload({
      createdAt: "2026-08-30T00:01:00.000Z",
      chain,
      candidate: releaseBinding(item.candidate),
      lineage: lineage(item, item.bootstrapRelease.contractReceiptSha256, item.candidate.contractReceiptSha256),
      protectedEntrypoints: [{
        relativePath: "tools/worker-local-service.ps1",
        predecessorSha256: item.bootstrapRelease.entrypointSha256,
        candidateSha256: item.candidate.entrypointSha256,
      }],
    });
    assert.equal(plan.predecessorChainStateSha256, chain.chainStateSha256);
    assert.equal(plan.lineage.salesRetirementMigrationSha256, salesRetirementMigrationSha256);
    assert.equal(plan.protectedEntrypoints[0].predecessorSha256, item.bootstrapRelease.entrypointSha256);
    assert.equal(plan.protectedEntrypoints[0].candidateSha256, item.candidate.entrypointSha256);
    const planCore = { ...plan } as Record<string, unknown>;
    delete planCore.payloadSha256;
    assert.equal(plan.payloadSha256, sha256Canonical(planCore));
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("rotation planning accepts a stopped verifier upgrade mixed with predecessor protected entrypoints", async () => {
  const item = await fixture();
  try {
    const candidate = await makeRelease(
      item.runtime,
      item.protectedRoot,
      "20260830T000002Z-3333333333333333",
      "candidate-service",
      {
        createdAt: "2026-08-30T00:00:02.000Z",
        buildFingerprint: hex("8"),
        entrypointTextByPath: { "tools/worker-local-release.mjs": "candidate-verifier" },
      },
    );
    const verifier = candidate.entrypoints.find((entrypoint) => entrypoint.relativePath === "tools/worker-local-release.mjs")!;
    const verifierTarget = path.join(item.protectedRoot, ...verifier.relativePath.split("/"));
    await writeFile(verifierTarget, candidate.entrypointBytes.get(verifier.relativePath)!);
    const protectedEntrypoints = await buildEntrypointPlan(
      await releaseManifestContext(item.bootstrapRelease),
      await releaseManifestContext(candidate),
    );
    assert.equal(
      protectedEntrypoints.find((entrypoint) => entrypoint.relativePath === verifier.relativePath)?.candidateSha256,
      verifier.sha256,
    );
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true }),
      /protected entrypoint 未匹配 guard/,
    );
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("new rotation plans reject a candidate whose guarded batch entrypoint is absent from the immutable release", async () => {
  const item = await fixture();
  try {
    await rm(path.join(item.candidate.releaseRoot, "运行项目.bat"));
    await assert.rejects(buildEntrypointPlan(
      await releaseManifestContext(item.bootstrapRelease),
      await releaseManifestContext(item.candidate),
    ), /运行项目\.bat/);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("new rotation plans reject manifest keyFiles drift before inspecting the protected root", async () => {
  const item = await fixture();
  try {
    const predecessor = await releaseManifestContext(item.bootstrapRelease);
    const candidate = await releaseManifestContext(item.candidate);
    candidate.manifest = {
      ...candidate.manifest,
      artifacts: {
        ...candidate.manifest.artifacts,
        keyFiles: candidate.manifest.artifacts.keyFiles.filter(
          (entrypoint: { relativePath: string }) => entrypoint.relativePath !== "运行项目.bat",
        ),
      },
    };
    await assert.rejects(buildEntrypointPlan(predecessor, candidate), /keyFiles.*运行项目\.bat/);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("approved apply recovery skips absent candidate material when the protected batch and panel are already exact", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    for (const relativePath of ["运行项目.bat", "tools/operations-system-control.ps1"]) {
      await rm(path.join(item.candidate.releaseRoot, ...relativePath.split("/")));
    }
    const recovered = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
    });
    assert.equal(recovered.status, "activated");
    for (const relativePath of ["运行项目.bat", "tools/operations-system-control.ps1"]) {
      assert.deepEqual(
        await readFile(path.join(item.protectedRoot, ...relativePath.split("/"))),
        item.candidate.entrypointBytes.get(relativePath),
      );
    }
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("test-only apply core activates and idempotently replays an approved first successor", async () => {
  const item = await fixture();
  try {
    const beforePointer = await readFile(path.join(item.runtime, "current-deployment.json"));
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    let startupVerifications = 0;
    const testDependencies = { installAndVerifyStartup: async () => { startupVerifications += 1; } };
    const first = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies,
    });
    assert.equal(first.status, "activated");
    assert.equal(first.releaseId, item.candidate.releaseId);
    const after = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true,
    });
    assert.equal(after.successorCount, 1);
    assert.deepEqual(await readFile(path.join(item.runtime, "current-deployment.json")), beforePointer);
    const replay = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies,
    });
    assert.equal(replay.status, "already_activated");
    assert.equal(replay.consumptionSha256, first.consumptionSha256);
    assert.equal(startupVerifications, 2);
    assert.deepEqual(await readdir(path.join(item.runtime, "state", publicationStagingDirectoryName)), []);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("apply resumes a half-installed protected entrypoint set while predecessor launch stays fail-closed", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    let installed = 0;
    await assert.rejects(applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies: {
        afterEntrypointInstalled: async () => {
          installed += 1;
          if (installed === 1) throw new Error("simulated entrypoint crash");
        },
      },
    }), /simulated entrypoint crash/);
    assert.equal(installed, 1);
    assert.deepEqual(await directoryNamesOrEmpty(path.join(item.runtime, "state", successorDirectoryName)), []);
    await assert.rejects(assertReleaseWorkerLaunchAllowed({
      manifestPath: item.bootstrapRelease.manifestPath,
      manifestSha256: item.bootstrapRelease.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    }), /guard entrypoints|protected entrypoint|entrypoints 无效/);
    const recovered = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
    });
    assert.equal(recovered.status, "activated");
    const after = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true,
    });
    assert.equal(after.head.releaseId, item.candidate.releaseId);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("apply repairs an exact record-without-sidecar publication and ignores staging crash debris", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    const successorRoot = path.join(item.runtime, "state", successorDirectoryName);
    await mkdir(successorRoot);
    const recordPath = path.join(successorRoot, `${approved.record.predecessor.bindingSha256}.json`);
    const recordSha256 = await writeCanonical(recordPath, approved.record);
    const stagingRoot = path.join(item.runtime, "state", publicationStagingDirectoryName);
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(path.join(stagingRoot, "publication-crash-debris.tmp"), "incomplete", "utf8");
    await assert.rejects(
      resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true }),
      /不完整/,
    );
    const recovered = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
    });
    assert.equal(recovered.status, "already_activated");
    assert.equal(recovered.successorSha256, recordSha256);
    assert.equal((await readFile(`${recordPath}.sha256`, "ascii")).trim(), recordSha256);
    assert.deepEqual(await directoryNamesOrEmpty(stagingRoot), ["publication-crash-debris.tmp"]);
    const after = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true,
    });
    assert.equal(after.successorCount, 1);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("startup install or readback failure leaves consumption unpublished and the same plan recoverable", async () => {
  const item = await fixture();
  try {
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    await assert.rejects(applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies: {
        installAndVerifyStartup: async () => { throw new Error("simulated VerifyStartup failure"); },
      },
    }), /simulated VerifyStartup failure/);
    const activated = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true,
    });
    assert.equal(activated.head.releaseId, item.candidate.releaseId);
    assert.deepEqual(
      await directoryNamesOrEmpty(path.join(item.runtime, "state", rotationConsumptionDirectoryName)),
      [],
    );
    const recovered = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: approved.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies: { installAndVerifyStartup: async () => {} },
    });
    assert.equal(recovered.status, "already_activated");
    assert.deepEqual(
      await directoryNamesOrEmpty(path.join(item.runtime, "state", rotationConsumptionDirectoryName)),
      [`${approved.planSha256}.json`, `${approved.planSha256}.json.sha256`],
    );
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("a second successor succeeds when only its immutable activation fence changes", async () => {
  const item = await fixture();
  try {
    let chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const first = await approvedTransition(item, chain);
    await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime, approvedPlanSha256: first.planSha256, cutoverEvidence: item.cutoverEvidence,
    });
    chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const secondCandidate = await makeRelease(
      item.runtime,
      item.protectedRoot,
      "20260830T000002Z-3333333333333333",
      "candidate-service",
      { createdAt: "2026-08-30T00:00:02.000Z", buildFingerprint: hex("8") },
    );
    const second = await approvedTransition(
      item, chain, secondCandidate, item.candidate, "2026-08-30T00:02:00.000Z",
    );
    const changed = second.plan.protectedEntrypoints.filter(
      (entrypoint) => entrypoint.predecessorSha256 !== entrypoint.candidateSha256,
    );
    assert.deepEqual(changed.map((entrypoint) => entrypoint.relativePath), [activationFenceRelativePath]);
    let secondInstalled = 0;
    await assert.rejects(applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: second.planSha256,
      cutoverEvidence: item.cutoverEvidence,
      testDependencies: {
        afterEntrypointInstalled: async (entrypoint) => {
          secondInstalled += 1;
          assert.equal(entrypoint.relativePath, activationFenceRelativePath);
          throw new Error("simulated second-successor fence crash");
        },
      },
    }), /simulated second-successor fence crash/);
    assert.equal(secondInstalled, 1);
    const predecessorStillRecorded = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true,
    });
    assert.equal(predecessorStillRecorded.successorCount, 1);
    await assert.rejects(assertReleaseWorkerLaunchAllowed({
      manifestPath: item.candidate.manifestPath,
      manifestSha256: item.candidate.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    }), /protected entrypoint|入口未安装或已变更/);
    const result = await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime,
      approvedPlanSha256: second.planSha256,
      cutoverEvidence: item.cutoverEvidence,
    });
    assert.equal(result.status, "activated");
    const after = await resolveEffectiveReleaseChain({
      runtimeRoot: item.runtime, allowTestRuntimeRoot: true, verifyInstalledHead: true,
    });
    assert.equal(after.successorCount, 2);
    assert.equal(after.head.releaseId, secondCandidate.releaseId);
    await assert.rejects(assertReleaseWorkerLaunchAllowed({
      manifestPath: item.candidate.manifestPath,
      manifestSha256: item.candidate.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    }), /effective head release/);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("forged evidence, foreign protected roots and cyclic candidates fail before activation mutation", async () => {
  const cases = ["evidence", "path", "cycle"] as const;
  for (const kind of cases) {
    const item = await fixture();
    try {
      const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
      let candidate = item.candidate;
      const predecessor = item.bootstrapRelease;
      let approved;
      if (kind === "path") {
        candidate = await makeRelease(
          item.runtime,
          path.join(item.runtime, "foreign-protected"),
          "20260830T000003Z-4444444444444444",
          "foreign-service",
          { createdAt: "2026-08-30T00:00:03.000Z", buildFingerprint: hex("9") },
        );
        approved = await approvedTransition(item, chain, candidate, predecessor, "2026-08-30T00:03:00.000Z");
      } else if (kind === "cycle") {
        candidate = item.bootstrapRelease;
        approved = await approvedTransition(item, chain, candidate, predecessor, "2026-08-30T00:04:00.000Z");
      } else {
        const forgedLineage = {
          ...lineage(item, predecessor.contractReceiptSha256, candidate.contractReceiptSha256),
          attestationFileSha256: hex("a"),
        };
        const plan = rotationPlanPayload({
          createdAt: "2026-08-30T00:05:00.000Z",
          chain,
          candidate: releaseBinding(candidate),
          lineage: forgedLineage,
          protectedEntrypoints: candidate.entrypoints.map((entrypoint) => ({
            relativePath: entrypoint.relativePath,
            predecessorSha256: predecessor.entrypoints.find((old) => old.relativePath === entrypoint.relativePath)?.sha256 ?? null,
            candidateSha256: entrypoint.sha256,
          })),
        });
        const publication = await publishRotationPlan(item.runtime, plan);
        approved = { plan, planSha256: publication.planSha256 };
      }
      const before = await protectedSnapshot(item.protectedRoot, candidate.entrypoints);
      await assert.rejects(applyApprovedRotationPlanForTest({
        runtimeRoot: item.runtime,
        approvedPlanSha256: approved.planSha256,
        cutoverEvidence: item.cutoverEvidence,
      }), kind === "evidence" ? /当前真实 cutover evidence/
        : kind === "path" ? /未保持 PostgreSQL authority\/receipt lineage/
          : /重复或形成环/);
      assert.deepEqual(await protectedSnapshot(item.protectedRoot, candidate.entrypoints), before);
      assert.deepEqual(await directoryNamesOrEmpty(path.join(item.runtime, "state", successorDirectoryName)), []);
    } finally {
      await rm(item.runtime, { recursive: true, force: true });
    }
  }
});

test("startup shortcut recognizes the immutable seven-entry predecessor then rebinds exactly to effective head", async () => {
  const item = await fixture();
  try {
    assert.equal(item.bootstrapRelease.entrypoints.length, 7);
    assert.equal(item.candidate.entrypoints.length, 9);
    const chain = await resolveEffectiveReleaseChain({ runtimeRoot: item.runtime, allowTestRuntimeRoot: true });
    const approved = await approvedTransition(item, chain);
    await applyApprovedRotationPlanForTest({
      runtimeRoot: item.runtime, approvedPlanSha256: approved.planSha256, cutoverEvidence: item.cutoverEvidence,
    });
    const startupRoot = path.join(item.runtime, "startup-test");
    await mkdir(startupRoot);
    const shortcutPath = path.join(startupRoot, "TERUISI Operations Worker.lnk");
    const powershell = String.raw`
$ErrorActionPreference = "Stop"
. $env:TERUISI_TEST_SERVICE -RuntimeRoot $env:TERUISI_TEST_RUNTIME -AllowTestRuntimeRoot -StartupShortcutPath $env:TERUISI_TEST_SHORTCUT -FunctionsOnly
$shell = New-Object -ComObject WScript.Shell
$target = (Get-Command "powershell.exe").Source
function Get-Expected([string]$manifest) {
  $releaseRoot = Split-Path -Parent $manifest
  $service = Join-Path $releaseRoot "tools\worker-local-service.ps1"
  $quote = [char]34
  return [pscustomobject]@{
    Root = $releaseRoot
    Service = $service
    Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File {0}{1}{0} -Action Start -ManifestPath {0}{2}{0}" -f $quote, $service, $manifest
  }
}
$old = Get-Expected $env:TERUISI_TEST_OLD_MANIFEST
$oldIdentity = Get-ManifestIdentity $env:TERUISI_TEST_OLD_MANIFEST
Save-StartupShortcutAtomic $shell $target $old.Arguments $old.Root
$oldLink = $shell.CreateShortcut($env:TERUISI_TEST_SHORTCUT)
if (-not (Test-IsControlledStartupShortcut $oldLink)) {
  throw "seven-entry predecessor shortcut was not controlled"
}
$new = Get-Expected $env:TERUISI_TEST_NEW_MANIFEST
Save-StartupShortcutAtomic $shell $target $new.Arguments $new.Root
if (-not (Test-StartupShortcutExact $shell $target $new.Arguments $new.Root)) { throw "effective head shortcut did not verify" }
[ordered]@{ oldControlled = $true; newExact = $true; oldManifest = $env:TERUISI_TEST_OLD_MANIFEST; newManifest = $env:TERUISI_TEST_NEW_MANIFEST } | ConvertTo-Json -Compress
`;
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powershell,
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        TERUISI_TEST_SERVICE: path.resolve("tools/worker-local-service.ps1"),
        TERUISI_TEST_RUNTIME: item.runtime,
        TERUISI_TEST_SHORTCUT: shortcutPath,
        TERUISI_TEST_OLD_MANIFEST: item.bootstrapRelease.manifestPath,
        TERUISI_TEST_NEW_MANIFEST: item.candidate.manifestPath,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.oldControlled, true);
    assert.equal(output.newExact, true);
    await assert.rejects(assertReleaseWorkerLaunchAllowed({
      manifestPath: item.bootstrapRelease.manifestPath,
      manifestSha256: item.bootstrapRelease.manifestSha256,
      runtimeRoot: item.runtime,
      allowTestRuntimeRoot: true,
    }), /effective head release/);
  } finally {
    await rm(item.runtime, { recursive: true, force: true });
  }
});

test("Windows atomic installer replaces an existing entrypoint in one rename and leaves no temporary file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "teruisi-worker-atomic-install-"));
  try {
    const source = path.join(root, "candidate.ps1");
    const target = path.join(root, "installed.ps1");
    const candidate = Buffer.from("candidate-entrypoint", "utf8");
    await writeFile(source, candidate);
    await writeFile(target, "predecessor-entrypoint", "utf8");
    await atomicInstallFile(source, target, sha256Bytes(candidate));
    assert.deepEqual(await readFile(target), candidate);
    assert.deepEqual(await readFile(source), candidate);
    assert.deepEqual((await readdir(root)).sort(), ["candidate.ps1", "installed.ps1"]);
    const sourceText = await readFile(path.resolve("tools/worker-local-release-rotation.mjs"), "utf8");
    const installer = sourceText.slice(sourceText.indexOf("export async function atomicInstallFile"), sourceText.indexOf("async function installProtectedEntrypoints"));
    assert.match(installer, /await rename\(temporary, target\)/);
    assert.doesNotMatch(installer, /rm\(target|unlink\(target/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production rotation CLI rejects caller-controlled runtime/source/command overrides", async () => {
  const source = await readFile(path.resolve("tools/worker-local-release-rotation.mjs"), "utf8");
  assert.match(source, /production plan 不接受路径、命令或测试覆盖/);
  assert.match(source, /production apply 只接受 --approved-plan-sha256/);
  assert.doesNotMatch(source, /--source-root|--dev-vars-source|--persist-root|--source-d1-path|--command/);
  const service = await readFile(path.resolve("tools/worker-local-service.ps1"), "utf8");
  assert.match(service, /worker-local-release-rotation\.mjs/);
  assert.match(service, /ManifestPath is not the authorized effective head release/);
  assert.match(source, /validateApprovedRotationBeforeMutation/);
  assert.match(source, /resolveEffectiveReleaseChain\(\{ allowTestRuntimeRoot, verifyInstalledHead: false \}\)/);
  assert.match(source, /dependencies\.verifyHeadStopped/);
  assert.equal((source.match(/await dependencies\.verifyHeadStopped/g) ?? []).length, 2);
  assert.match(source, /beforeMutation\.chain\.chainStateSha256 !== validated\.chain\.chainStateSha256/);
  assert.match(source, /dependencies\.assertCandidateStopped[\s\S]+installProtectedEntrypoints/);
  assert.match(source, /installProtectedEntrypoints[\s\S]+dependencies\.assertCandidateStopped[\s\S]+publishSuccessorRecord/);
  assert.match(source, /verifyInstalledGuardEntrypoints\(validated\.candidateManifest[\s\S]+publishSuccessorRecord/);
  assert.match(source, /worker-release-publication-staging/);
  assert.match(source, /InstallStartup[\s\S]+VerifyStartup/);
  const releaseSource = await readFile(path.resolve("tools/worker-local-release.mjs"), "utf8");
  assert.match(releaseSource, /\.runtime\/worker-release-activation-fence\.json/);
  assert.match(source, /Local\\\\TERUISI\.Worker\.LocalService\.v1/);
});
