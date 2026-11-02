import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { validCustomerServiceCloseIdentity } from "../lib/jd/customer-service-close-contract";
import { assertCustomerServicePeriod } from "../lib/jd/customer-service-workflow";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import type { CloseSlotCoordinator } from "../lib/jackyun/operator-close";
import { readCustomerServiceOperatorEvidence } from "../lib/jackyun/n8n-preflight-evidence";
import { writeJsonDurable } from "../lib/jackyun/json-file";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { withJdChromiumRunLock, defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { readAutomationDrain } from "./automation-drain";
import { customerServiceControlBytes } from "./jd-customer-service-failure-closure";
import { inspectCustomerServiceCloseEvidence, type CustomerServiceCloseAuthorityTarget } from "./jd-customer-service-source-recovery";
import { customerServicePlanFiles, verifyCustomerServicePlan, type CustomerServiceN8nPlan } from "./jd-customer-service-n8n-pipeline";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const protocol = "jd-customer-service-operator-reconcile-v1";
function reject(): never { throw Error("CUSTOMER_SERVICE_OPERATOR_RECONCILIATION_BLOCKED"); }
type Authority = { ok: true; version: "jd-customer-service-operator-reconcile-authority-v2"; authorizationId: string;
  action: "close" | "verify"; target: CustomerServiceCloseAuthorityTarget; createdAt: string; expiresAt: string };
type Intent = { version: typeof protocol; authorizationId: string; action: "close" | "verify"; target: CustomerServiceCloseAuthorityTarget };
type Closure = Intent & { outcome: "failed_closed"; evidence: ReturnType<typeof readCustomerServiceOperatorEvidence>;
  sourceEvidence: Awaited<ReturnType<typeof inspectCustomerServiceCloseEvidence>>["sourceEvidence"]; completedAt: string };
const requestFile = (root: string, id: string) => path.join(root, "outputs/jd-customer-service-operator-requests", `${id}.json`);
function closureFile(root: string, target: CustomerServiceCloseAuthorityTarget) {
  return path.join(customerServicePlanFiles(root, target.originalExecutionId, target.storeKey).directory, "operator-closures", `${target.originalExecutionId}-${target.originalPlanSha256}.json`);
}
function validateTarget(target: CustomerServiceCloseAuthorityTarget) {
  if (!target || !/^[A-Za-z0-9_-]{1,96}$/.test(target.originalExecutionId) || !/^[a-f0-9]{64}$/.test(target.originalPlanSha256)
    || !["pre_export_zero_effect", "downloaded_list_only", "downloaded_pair", "executed_verify"].includes(target.kind)) reject();
  const store = customerServiceStore(target.storeKey);
  if (!validCustomerServiceCloseIdentity({ ...target, shopName: store.shopName, shopId: store.shopId })) reject();
  assertCustomerServicePeriod(target.period);
}
async function controlJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse((await customerServiceControlBytes(file)).toString("utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function portAbsent(port: number) {
  await new Promise<void>((resolve, fail) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); fail(Error("CUSTOMER_SERVICE_BROWSER_STILL_OPEN")); });
    socket.once("timeout", () => { socket.destroy(); fail(Error("CUSTOMER_SERVICE_BROWSER_STATE_UNKNOWN")); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); error.code === "ECONNREFUSED" ? resolve() : fail(Error("CUSTOMER_SERVICE_BROWSER_STATE_UNKNOWN")); });
  });
}
function result(intent: Intent, outcome: "failed_closed" | "completed", completedAt: string, requestedAuthorizationId = intent.authorizationId) {
  return { ok: true as const, version: protocol, authorizationId: requestedAuthorizationId, requestedAuthorizationId,
    committedAuthorizationId: intent.authorizationId, storeKey: intent.target.storeKey,
    originalExecutionId: intent.target.originalExecutionId, originalPlanSha256: intent.target.originalPlanSha256, outcome, completedAt };
}
async function terminal(root: string, intent: Intent) {
  validateTarget(intent.target);
  if (intent.version !== protocol || !uuid(intent.authorizationId) || !["close", "verify"].includes(intent.action)
    || (intent.action === "verify") !== (intent.target.kind === "executed_verify")) reject();
  if (intent.action === "close") {
    const closed = await controlJson<Closure>(closureFile(root, intent.target));
    if (!closed) return null;
    if (closed.version !== protocol || closed.action !== "close" || closed.outcome !== "failed_closed"
      || !uuid(closed.authorizationId) || !isDeepStrictEqual(closed.target, intent.target)) reject();
    return result(closed, "failed_closed", closed.completedAt, intent.authorizationId);
  }
  const plan = await controlJson<CustomerServiceN8nPlan>(customerServicePlanFiles(root, intent.target.originalExecutionId, intent.target.storeKey).plan);
  const marker = plan?.operatorVerification;
  if (plan?.stage !== "completed" || !marker) return null;
  if (plan.executionId !== intent.target.originalExecutionId || plan.storeKey !== intent.target.storeKey
    || plan.shopId !== customerServiceStore(intent.target.storeKey).shopId || plan.shopName !== customerServiceStore(intent.target.storeKey).shopName
    || marker.originalPlanSha256 !== intent.target.originalPlanSha256 || marker.authorizationId !== intent.authorizationId
    || !isDeepStrictEqual(plan.period, intent.target.period)) reject();
  // A later normal A may advance active. This query reports the immutable
  // historical completion; only the actual verification commit requires CAS.
  return result({ ...intent, authorizationId: marker.authorizationId }, "completed", marker.completedAt);
}
/** Query the actual local commit, never the Django permission receipt. */
export async function readCustomerServiceOperatorResult(root: string, authorizationId: string) {
  if (!uuid(authorizationId)) reject();
  const intent = await controlJson<Intent>(requestFile(root, authorizationId));
  if (intent && intent.authorizationId !== authorizationId) reject();
  const committed = intent ? await terminal(root, intent) : null;
  return committed ?? { ok: false, status: "unconfirmed", error: "CUSTOMER_SERVICE_OPERATOR_RESULT_UNCONFIRMED" };
}

export async function reconcileCustomerServiceOperator(root: string, authorizationId: string, coordinator: CloseSlotCoordinator, request: typeof fetch = fetch) {
  if (!uuid(authorizationId)) reject();
  const oldIntent = await controlJson<Intent>(requestFile(root, authorizationId));
  if (oldIntent && oldIntent.authorizationId !== authorizationId) reject();
  if (oldIntent) { const done = await terminal(root, oldIntent); if (done) return done; }
  const response = await request(`http://localhost:3000/api/imports/recovery/customer-service-close?authorizationId=${authorizationId}&authority=1`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > 8192) reject();
  const authority = JSON.parse(raw) as Authority;
  if (authority.ok !== true || authority.version !== "jd-customer-service-operator-reconcile-authority-v2" || authority.authorizationId !== authorizationId
    || !["close", "verify"].includes(authority.action) || !Number.isFinite(Date.parse(authority.createdAt)) || Date.parse(authority.createdAt) > Date.now()
    || !Number.isFinite(Date.parse(authority.expiresAt)) || Date.parse(authority.expiresAt) <= Date.now()) reject();
  const target = authority.target; validateTarget(target);
  if ((authority.action === "verify") !== (target.kind === "executed_verify")) reject();
  const intent: Intent = { version: protocol, authorizationId, action: authority.action, target };
  if (oldIntent && !isDeepStrictEqual(oldIntent, intent)) reject();
  const existing = await terminal(root, intent);
  if (existing) {
    // The new authority only aliases an already committed exact target. Its
    // request must remain queryable after POST, without re-closing the target
    // or replacing the original target-scoped intent/commit identity.
    if (!oldIntent) {
      try { await writeJsonDurable(requestFile(root, authorizationId), intent, true); }
      catch (error) { if (!isDeepStrictEqual(await controlJson(requestFile(root, authorizationId)), intent)) throw error; }
    }
    return existing;
  }
  // Synchronous reservation blocks all future claims. It never takes a live or
  // ready slot away from its original owner, even if no request is in flight.
  if (readAutomationDrain() !== null) reject();
  const reservation = coordinator.freeze([target.originalExecutionId]);
  try {
    const files = customerServicePlanFiles(root, target.originalExecutionId, target.storeKey);
    return await withJackyunRunLock({ runId: `cs-operator-${target.originalExecutionId}`, purpose: "jd-customer-service-operator-reconcile", lockDirectory: files.lock }, async lock => {
      const activeBytes = await customerServiceControlBytes(files.active);
      const bytes = await customerServiceControlBytes(files.plan);
      const previous = JSON.parse(bytes.toString("utf8")) as CustomerServiceN8nPlan;
      const store = customerServiceStore(target.storeKey);
      if (!isDeepStrictEqual(JSON.parse(activeBytes.toString("utf8")), { executionId: target.originalExecutionId }) || sha(bytes) !== target.originalPlanSha256
        || previous.executionId !== target.originalExecutionId || previous.version !== 1 || previous.storeKey !== store.storeKey
        || previous.shopName !== store.shopName || previous.shopId !== store.shopId || !isDeepStrictEqual(previous.period, target.period)
        || (previous.failureCode ?? "") !== target.failureCode || previous.stage !== (intent.action === "verify" ? "executed" : "failed")) reject();
      const evidence = readCustomerServiceOperatorEvidence(store.storeKey, previous.executionId, intent.action);
      const assertOriginal = async () => {
        reservation.assertExited(); await lock.assertOwned();
        if (readAutomationDrain() !== null || !Buffer.from(await customerServiceControlBytes(files.active)).equals(activeBytes)
          || !Buffer.from(await customerServiceControlBytes(files.plan)).equals(bytes)
          || !isDeepStrictEqual(readCustomerServiceOperatorEvidence(store.storeKey, previous.executionId, intent.action), evidence)) reject();
      };
      // Target-scoped intent prevents another requestId from disguising an
      // unknown earlier commit. Retrying this same request reuses the intent.
      const targetIntentFile = path.join(files.directory, "operator-intents", `${target.originalExecutionId}-${target.originalPlanSha256}.json`);
      const priorTarget = await controlJson<Intent>(targetIntentFile);
      if (priorTarget && !isDeepStrictEqual(priorTarget, intent)) reject();
      if (!priorTarget) await writeJsonDurable(targetIntentFile, intent, true);
      if (!oldIntent) await writeJsonDurable(requestFile(root, authorizationId), intent, true);
      const completedAt = new Date().toISOString();
      const outcome = await withJdChromiumRunLock("jd-customer-service-operator-reconcile", async () => {
        const registered = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config/jd-store-accounts.json"), "utf8")), root).find(item => item.storeKey === store.storeKey);
        if (!registered?.enabled || registered.shopId !== store.shopId || registered.shopName !== store.shopName) reject();
        await portAbsent(registered.browser.debugPort);
        if (intent.action === "verify") {
          // Existing verification retains every source/daily hash, partition,
          // proof and exact import-batch check. The only new write is its CAS.
          await verifyCustomerServicePlan(root, structuredClone(previous), { beforeCommit: assertOriginal,
            operatorVerification: { authorizationId, originalPlanSha256: target.originalPlanSha256, completedAt } });
          return result(intent, "completed", completedAt);
        }
        const inspected = await inspectCustomerServiceCloseEvidence(root, previous);
        if (inspected.kind !== target.kind) reject();
        await portAbsent(inspected.registered.browser.debugPort);
        await assertOriginal();
        const repeated = await inspectCustomerServiceCloseEvidence(root, previous);
        if (!isDeepStrictEqual(inspected.sourceEvidence, repeated.sourceEvidence)) reject();
        await portAbsent(inspected.registered.browser.debugPort);
        await assertOriginal();
        const receipt: Closure = { ...intent, outcome: "failed_closed", evidence, sourceEvidence: inspected.sourceEvidence, completedAt };
        await mkdir(path.dirname(closureFile(root, target)), { recursive: true });
        await writeJsonDurable(closureFile(root, target), receipt, true);
        return result(intent, "failed_closed", completedAt);
      }, defaultJdChromiumRunLockDirectory(root));
      reservation.complete(); return outcome;
    });
  } finally { reservation.release(); }
}

/** Called under the original store planning lock by a normal fresh A. The
 * receipt is permanent, but the source and original plan must still match. */
export async function consumeCustomerServiceOperatorClosure(root: string, previous: CustomerServiceN8nPlan, previousBytes: Uint8Array, replacementId: string) {
  const targetBase = { storeKey: previous.storeKey!, originalExecutionId: previous.executionId, originalPlanSha256: sha(previousBytes) };
  const file = closureFile(root, targetBase as CustomerServiceCloseAuthorityTarget);
  const receipt = await controlJson<Closure>(file); if (!receipt) return false;
  if (receipt.version !== protocol || receipt.action !== "close" || receipt.outcome !== "failed_closed" || !uuid(receipt.authorizationId)
    || receipt.target.storeKey !== previous.storeKey || receipt.target.originalExecutionId !== previous.executionId || receipt.target.originalPlanSha256 !== sha(previousBytes)
    || receipt.target.failureCode !== previous.failureCode || !isDeepStrictEqual(receipt.target.period, previous.period)) reject();
  return withJdChromiumRunLock("jd-customer-service-consume-operator-closure", async () => {
    const current = await inspectCustomerServiceCloseEvidence(root, previous);
    if (current.kind !== receipt.target.kind || !isDeepStrictEqual(current.sourceEvidence, receipt.sourceEvidence)
      || !isDeepStrictEqual(readCustomerServiceOperatorEvidence(previous.storeKey!, previous.executionId, "close", replacementId), receipt.evidence)) reject();
    await portAbsent(current.registered.browser.debugPort);
    return true;
  }, defaultJdChromiumRunLockDirectory(root));
}

export async function assertCustomerServiceSourceRecoveryNotClosed(root: string, previous: CustomerServiceN8nPlan, previousBytes: Uint8Array) {
  const existing = await controlJson(closureFile(root, { storeKey: previous.storeKey!, originalExecutionId: previous.executionId, originalPlanSha256: sha(previousBytes) } as CustomerServiceCloseAuthorityTarget));
  if (existing) reject();
}
