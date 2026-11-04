import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertLogisticsManifest, type JdLogisticsManifest } from "../lib/jd/logistics-manifest";
import { canonicalLogisticsJson, logisticsHash, parseJdLogisticsConfig, parseJdLogisticsSettings, selectJdLogisticsOperations } from "../lib/jd/logistics-policy";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { jdPreexportEvidence as io, preexportSha256 as sha, type PreexportOptions } from "./close-jd-logistics-preexport";
import { assertLogin11037History, closeJdLogisticsLogin, closureSettingsHash, collectLoginHistoricalBatches, readLoginActivation, type LogisticsLoginTarget } from "./close-jd-logistics-login-9851";
import { jdLogin9851Target } from "./jd-logistics-login-9851-target";
import { jdLogin11037History as history, type LoginActivation } from "./jd-logistics-login-11037-target";

const locations = { root: "D:/运营管理系统", runtime: "D:/teruisi-runtime/teruisi-worker-sales", databasePath: "C:/Users/86137/.n8n/database.sqlite" };
const same = (a: unknown, b: unknown) => canonicalLogisticsJson(a) === canonicalLogisticsJson(b);
function fail(code: string): never { throw new Error(`JD_LOGIN_11037_${code}`); }

/** Preparation observes facts only: no locks, approvals, workflow mutation or recovery writes. */
export async function prepareJdLogisticsLogin11037(o: Omit<PreexportOptions, "target" | "checkpoint">) {
  const directory = path.join(o.root, "outputs/jd-logistics-pipeline");
  await io.ordinary(directory, true);
  // Even an incomplete directory owns the original intent. Never mint a new target over it.
  if ((await readdir(directory)).some(name => name.startsWith("login-11037-"))) fail("EXISTING_INTENT_MANUAL_RECONCILIATION");
  const activePath = path.join(directory, "active.json"), manifestPath = path.join(directory, history.runId + ".json");
  const activeBytes = await io.bytes(activePath), manifestBytes = await io.bytes(manifestPath);
  if (sha(activeBytes) !== history.activeSha256 || sha(manifestBytes) !== history.manifestSha256) fail("HISTORICAL_BYTES_CHANGED");
  const plan = JSON.parse(manifestBytes.toString("utf8")) as JdLogisticsManifest;
  assertLogisticsManifest(plan, history.executionId);
  if (plan.baseUrl !== "http://localhost:3000" || plan.planHash !== history.planHash || plan.runId !== history.runId
    || plan.failure?.code !== history.failureCode || plan.operations.length !== 4) fail("HISTORICAL_PLAN_CHANGED");
  const op = plan.operations[0];
  const workerPath = path.join(o.runtime, "state/worker-process.json"), workerBytes = await io.bytes(workerPath);
  const worker = JSON.parse(workerBytes.toString("utf8"));
  if (!/^\d{8}T\d{6}Z-[a-f0-9]{16}$/.test(worker.releaseId)) fail("CURRENT_RELEASE_INVALID");
  const release = path.join(o.runtime, "releases", worker.releaseId);
  const currentManifest = await io.bytes(path.join(release, "deployment-manifest.json"));
  const receiptBytes = await io.bytes(path.join(release, "audit/helper-build-receipt.json"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const process = await (o.processProbe ?? io.inspectHelperProcess)();
  const configBytes = await io.bytes(path.join(o.root, "config/jd-logistics-sources.json"));
  const registryBytes = await io.bytes(path.join(o.root, "config/jd-store-accounts.json"));
  const stores = validateJdStoreRegistry(JSON.parse(registryBytes.toString("utf8")), o.root);
  const store = stores.find(x => x.storeKey === op.collectorStoreKey);
  if (!store) fail("STORE_UNAVAILABLE");
  const envelope = await io.readGet(`${plan.baseUrl}/api/inventory/jd-logistics?operation=settings`, o.request ?? fetch);
  if (envelope.success !== true) fail("SETTINGS_UNAVAILABLE");
  const settings = parseJdLogisticsSettings(envelope.data), config = parseJdLogisticsConfig(JSON.parse(configBytes.toString("utf8")));
  const department = settings.departments.find(x => x.id === op.departmentId);
  if (!department || department.revision > 10000) fail("DEPARTMENT_REVISION_UNAVAILABLE");
  // Derive a historical revision only when the existing selector reproduces every original field.
  // This does not mutate settings, weaken pipeline assertPolicy, or approve the result.
  const revisions = [];
  for (let revision = 0; revision <= department.revision; revision++) {
    const historicalSettings = structuredClone(settings);
    historicalSettings.departments.find(x => x.id === op.departmentId)!.revision = revision;
    const selected = selectJdLogisticsOperations(config, historicalSettings, stores, new Date(plan.anchorAt));
    if (same(selected, plan.operations.map(({ stage: _stage, ...operation }) => operation))) revisions.push(revision);
  }
  if (revisions.length !== 1) fail("HISTORICAL_POLICY_NOT_UNIQUELY_RECONSTRUCTED");
  await io.ordinary(o.databasePath);
  const db = new DatabaseSync(o.databasePath, { readOnly: true });
  let workflow: Record<string, any>;
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
    workflow = io.object(db.prepare("SELECT active,versionId,activeVersionId,nodes,connections,settings FROM workflow_entity WHERE id=?").get(history.workflowId));
    const data = db.prepare("SELECT data FROM execution_data WHERE executionId=? AND length(data)<=1048576").get(history.executionId)?.data;
    if (typeof data !== "string" || sha(data) !== history.executionDataSha256) fail("EXECUTION_DATA_CHANGED");
  } finally { db.close(); }
  const chain: LoginActivation[] = [];
  let next: LoginActivation = { file: history.activationInFile, sha256: history.activationInSha256 };
  for (;;) {
    if (chain.length >= 128) fail("ACTIVATION_CHAIN_TOO_LONG");
    const record = await readLoginActivation(o.runtime, next); chain.push(next);
    if (record.successor.releaseId === worker.releaseId) break;
    if (!/^[a-f0-9]{64}$/.test(record.successor.bindingSha256)) fail("ACTIVATION_CHAIN_INVALID");
    const file = record.successor.bindingSha256 + ".json";
    const bytes = await io.bytes(path.join(o.runtime, "state/worker-release-successors", file));
    next = { file, sha256: sha(bytes) };
  }
  const batches = await collectLoginHistoricalBatches(plan, { ...history, departmentId: op.departmentId, businessUnitCode: op.businessUnitCode }, o.request ?? fetch);
  const target: LogisticsLoginTarget = { ...history,
    departmentId: op.departmentId, businessUnitCode: op.businessUnitCode, storeKey: store.storeKey, debugPort: store.browser.debugPort,
    releaseId: worker.releaseId, releaseManifestSha256: sha(currentManifest), helperReceiptSha256: sha(receiptBytes), helperTreeSha256: receipt.helperTree?.sha256,
    supervisorPid: process.parentPid, supervisorCreationDate: process.supervisorCreationDate, helperPid: process.pid, helperCreationDate: process.creationDate,
    workflowVersionId: String(workflow.versionId), workflowShapeHash: logisticsHash({ nodes: JSON.parse(workflow.nodes), connections: JSON.parse(workflow.connections), settings: JSON.parse(workflow.settings) }),
    settingsHash: closureSettingsHash(envelope.data), batchesHash: batches.hash, registrySha256: sha(registryBytes), sourceConfigSha256: sha(configBytes),
    originalDepartmentRevision: revisions[0], currentDepartmentRevision: department.revision,
    originalPolicyHashesHash: logisticsHash(plan.operations.map(x => x.policyHash)), activationChain: chain,
  };
  assertLogin11037History(target);
  if (sha(await io.bytes(activePath)) !== sha(activeBytes) || sha(await io.bytes(manifestPath)) !== sha(manifestBytes)
    || sha(await io.bytes(workerPath)) !== sha(workerBytes) || !same(await (o.processProbe ?? io.inspectHelperProcess)(), process)) fail("OBSERVATION_CHANGED");
  return { version: "jd-logistics-login-11037-candidate-v1", observedAt: new Date().toISOString(), approved: false, executionEligible: false,
    note: "Observation only. Review and freeze target separately; inspect/apply recheck every original gate. Workflow freeze and closure need separate authorization.",
    workflowObservation: { active: workflow.active, activeVersionId: workflow.activeVersionId }, target };
}

export async function loadJdLogisticsLogin11037Target(file: string, expectedSha256: string) {
  if (!path.isAbsolute(file) || !/^[a-f0-9]{64}$/.test(expectedSha256)) fail("TARGET_ARGUMENTS_INVALID");
  const bytes = await io.bytes(file);
  if (sha(bytes) !== expectedSha256) fail("FROZEN_TARGET_CHANGED");
  const target = io.object(JSON.parse(bytes.toString("utf8")));
  const fields = [...Object.keys(jdLogin9851Target), "originalHelperTreeSha256", "activationChain"];
  if (!same(Object.keys(target).sort(), fields.sort())) fail("TARGET_SCHEMA_INVALID");
  for (const [key, sample] of Object.entries(jdLogin9851Target)) {
    const value = target[key];
    if (typeof sample === "number" ? !Number.isSafeInteger(value) || value < 0 : typeof value !== "string" || !value.length) fail("TARGET_FIELD_INVALID");
    if (/Hash$|Sha256$/.test(key) && (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) fail("TARGET_HASH_INVALID");
  }
  const typed = target as LogisticsLoginTarget;
  assertLogin11037History(typed);
  return typed;
}

async function main() {
  const args = process.argv.slice(2);
  if (same(args, ["prepare"])) { console.log(JSON.stringify(await prepareJdLogisticsLogin11037(locations), null, 2)); return; }
  const [action, targetFlag, file, shaFlag, expectedSha, applyFlag] = args;
  if (!["inspect", "apply"].includes(action) || targetFlag !== "--target" || shaFlag !== "--sha256"
    || (action === "inspect" ? args.length !== 5 : args.length !== 6 || applyFlag !== "--apply")) fail("USAGE_PREPARE_OR_FROZEN_TARGET_INSPECT_APPLY");
  const target = await loadJdLogisticsLogin11037Target(file, expectedSha);
  const directory = path.join(locations.root, "outputs/jd-logistics-pipeline");
  if ((await readdir(directory)).some(name => name.startsWith("login-11037-"))) fail("EXISTING_INTENT_MANUAL_RECONCILIATION");
  console.log(JSON.stringify(await closeJdLogisticsLogin({ ...locations, target }, action as "inspect" | "apply"), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main().catch(error => {
  console.error(error instanceof Error && /^JD_(?:LOGIN_11037|LOGIN_9851|PREEXPORT)_[A-Z_0-9]+$/.test(error.message) ? error.message : "JD_LOGIN_11037_EVIDENCE_UNKNOWN");
  console.error("STOP: preserve the same target and all recovery evidence. Never reacquire PID and retry an existing intent; archive without committed.json does not authorize scheduling.");
  process.exitCode = 1;
});
