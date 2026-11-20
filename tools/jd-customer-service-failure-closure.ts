import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { withJdChromiumRunLock, defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { readCustomerServiceFailureEvidence } from "../lib/jackyun/n8n-preflight-evidence";
import { readJsonDurableOr, writeJsonDurable } from "../lib/jackyun/json-file";
import { verifyCustomerServiceBatch } from "./jd-customer-service-import";
import type { CustomerServiceN8nPlan } from "./jd-customer-service-n8n-pipeline";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function reject(): never { throw Error("PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION"); }
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function isCustomerServicePreSubmitFailure(plan: CustomerServiceN8nPlan) {
  if (plan.stage !== "failed" || !plain(plan.source) || !Array.isArray(plan.proofs) || plan.proofs.length
    || ["sourceRecovery", "importingDate", "dailyFiles", "derivedDirectory", "sourceSessionSha256", "sourceChatSha256", "sourceCounts", "durationAnomalies", "normalizedSessionSha256"].some(key => key in plan)) return false;
  if ("failureBoundary" in plan && (!plain(plan.failureBoundary) || plan.failureBoundary.version !== 1 || plan.failureBoundary.browserClosed !== true
    || !["browser_start", "open_customer_service_page", "export_list", "export_messages"].includes(plan.failureBoundary.step))) return false;
  if (!Object.keys(plan.source).length) return true;
  // Older plans only qualify with an empty source. New plans additionally
  // record that their owned browser was closed after a pre-submit failure.
  if (plan.failureBoundary?.version !== 1 || plan.failureBoundary.browserClosed !== true) return false;
  return Object.entries(plan.source).every(([view, entry]) => ["list", "messages"].includes(view) && plain(entry)
    && entry.view === view && ["querying", "confirming"].includes(String(entry.phase))
    && Object.keys(entry).every(key => ["view", "phase", "observedAt"].includes(key)));
}

export async function customerServiceControlBytes(file: string) {
  for (let cursor = path.resolve(file); ; cursor = path.dirname(cursor)) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (cursor === path.resolve(file) ? !info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024 : !info.isDirectory())
      || path.resolve(await realpath(cursor)).toLowerCase() !== cursor.toLowerCase()) reject();
    if (path.dirname(cursor) === cursor) break;
  }
  return readFile(file);
}

async function assertPortAbsent(port: number) {
  await new Promise<void>((resolve, fail) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); fail(Error("CUSTOMER_SERVICE_BROWSER_STILL_OPEN")); });
    socket.once("timeout", () => { socket.destroy(); fail(Error("CUSTOMER_SERVICE_BROWSER_STATE_UNKNOWN")); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(); else fail(error); });
  });
}

/** Called only under the original per-store planning lock, by the new A owner.
 * Source checkpoints precede every export submission; all import paths require
 * both downloaded checkpoints. This is a control-flow proof, not a PG query. */
export async function closeCustomerServicePreSubmitFailure(root: string, previous: CustomerServiceN8nPlan, previousBytes: Uint8Array, replacementId: string, directory: string) {
  if (!isCustomerServicePreSubmitFailure(previous) || previous.storeKey === undefined
    || !["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION", "CHAT_PAGE_MISMATCH", "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION", "LOGIN_GATE_MANUAL_ACTION", "JD_IDENTITY_RATE_LIMIT_MANUAL_ACTION", "CUSTOMER_SERVICE_LOGIN_PENDING", "CUSTOMER_SERVICE_NAVIGATION_TIMEOUT", "CUSTOMER_SERVICE_CONTROL_TIMEOUT"].includes(previous.failureCode ?? "")) reject();
  const store = customerServiceStore(previous.storeKey);
  if (previous.shopName !== store.shopName || previous.shopId !== store.shopId) reject();
  return withJdChromiumRunLock("jd-customer-service-failed-pre-submit-closure", async () => {
    const registered = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config/jd-store-accounts.json"), "utf8")), root).find(s => s.storeKey === store.storeKey);
    if (!registered?.enabled || registered.shopId !== store.shopId || registered.shopName !== store.shopName) reject();
    await assertPortAbsent(registered.browser.debugPort);
    const download = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
    try {
      const info = await lstat(download);
      if (!previous.failureBoundary?.browserClosed || !info.isDirectory() || info.isSymbolicLink()
        || path.resolve(await realpath(download)).toLowerCase() !== path.resolve(download).toLowerCase() || (await readdir(download)).length) reject();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const evidence = readCustomerServiceFailureEvidence(store.storeKey, previous.executionId, replacementId, directory);
    if (![previous.failureCode, `${previous.failureCode}_MANUAL_ACTION`].includes(evidence.failureCode)) reject();
    const planSha256 = sha(previousBytes);
    if (sha(await customerServiceControlBytes(path.join(directory, `${previous.executionId}.json`))) !== planSha256
      || !isDeepStrictEqual(JSON.parse((await customerServiceControlBytes(path.join(directory, "active.json"))).toString("utf8")), { executionId: previous.executionId })) reject();
    const receipt = { version: 1, outcome: "failed_closed_before_submit", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
      executionId: previous.executionId, planSha256, failureCode: previous.failureCode, evidence };
    const receipts = path.join(directory, "failure-closures"); await mkdir(receipts, { recursive: true });
    const file = path.join(receipts, `${previous.executionId}-${planSha256}.json`);
    const existing = await readJsonDurableOr(file, null);
    if (existing === null) await writeJsonDurable(file, receipt, true);
    else if (!isDeepStrictEqual(JSON.parse((await customerServiceControlBytes(file)).toString("utf8")), receipt)) reject();
    return receipt;
  }, defaultJdChromiumRunLockDirectory(root));
}

const partialImportProtocol = "jd-customer-service-confirmed-partial-import-v1";
/** Narrow eligibility for a readback-only failure after confirmed POSTs: every
 * proof is a confirmed import and `importingDate` is the last proven day, so no
 * POST outcome is unknown. Re-import of stored days is Django-idempotent. */
export function isCustomerServiceConfirmedPartialImport(plan: CustomerServiceN8nPlan) {
  if (plan.version !== 1 || plan.stage !== "failed" || plan.failureCode !== "BATCH_READBACK_FAILED"
    || "sourceRecovery" in plan || "operatorVerification" in plan || plan.storeKey === undefined) return false;
  const boundary = plan.failureBoundary, days = plan.dailyFiles, proofs = plan.proofs;
  // `export_messages` is the legacy step recorded before `import_days` existed.
  if (!plain(boundary) || boundary.version !== 1 || boundary.browserClosed !== true
    || !["import_days", "export_messages"].includes(boundary.step)) return false;
  if (!plain(plan.source) || plan.source.list?.phase !== "downloaded" || plan.source.messages?.phase !== "downloaded") return false;
  if (!Array.isArray(days) || !days.length || !Array.isArray(proofs) || !proofs.length || proofs.length > days.length) return false;
  if (!proofs.every((proof, index) => plain(proof) && proof.date === days[index]?.date && proof.conversationCount === days[index].conversationCount
    && proof.storeKey === plan.storeKey && typeof proof.batchId === "string")) return false;
  return plan.importingDate === proofs[proofs.length - 1].date;
}

/** Called only under the original per-store planning lock, by the new A owner. */
export async function closeCustomerServiceConfirmedPartialImport(root: string, previous: CustomerServiceN8nPlan, previousBytes: Uint8Array, replacementId: string, directory: string, request: typeof fetch = fetch) {
  if (!isCustomerServiceConfirmedPartialImport(previous) || previous.storeKey === undefined) reject();
  const store = customerServiceStore(previous.storeKey);
  if (previous.shopName !== store.shopName || previous.shopId !== store.shopId) reject();
  return withJdChromiumRunLock("jd-customer-service-confirmed-partial-import-closure", async () => {
    const registered = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config/jd-store-accounts.json"), "utf8")), root).find(s => s.storeKey === store.storeKey);
    if (!registered?.enabled || registered.shopId !== store.shopId || registered.shopName !== store.shopName) reject();
    await assertPortAbsent(registered.browser.debugPort);
    const evidence = readCustomerServiceFailureEvidence(store.storeKey, previous.executionId, replacementId, directory);
    if (![previous.failureCode, `${previous.failureCode}_MANUAL_ACTION`].includes(evidence.failureCode)) reject();
    // Live readback of every confirmed proof; any failure leaves the plan unresolved.
    for (const proof of previous.proofs) await verifyCustomerServiceBatch(proof, "http://localhost:3000", request, store.storeKey);
    const planSha256 = sha(previousBytes);
    if (sha(await customerServiceControlBytes(path.join(directory, `${previous.executionId}.json`))) !== planSha256
      || !isDeepStrictEqual(JSON.parse((await customerServiceControlBytes(path.join(directory, "active.json"))).toString("utf8")), { executionId: previous.executionId })) reject();
    const stable = { version: 1, protocol: partialImportProtocol, kind: "confirmed_partial_import", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
      executionId: previous.executionId, planSha256, failureCode: previous.failureCode,
      proofs: previous.proofs.map(({ date, batchId, fileHash }) => ({ date, batchId, fileHash })), evidence };
    const receipt = { ...stable, replacementExecutionId: replacementId, completedAt: new Date().toISOString() };
    const receipts = path.join(directory, "failure-closures"); await mkdir(receipts, { recursive: true });
    const file = path.join(receipts, `${previous.executionId}-${planSha256}.json`);
    const existing = await readJsonDurableOr<Record<string, unknown> | null>(file, null);
    if (existing === null) await writeJsonDurable(file, receipt, true);
    else {
      // A crash between receipt and new plan must not strand the next A.
      const rest = JSON.parse((await customerServiceControlBytes(file)).toString("utf8")); delete rest.replacementExecutionId; delete rest.completedAt;
      if (!isDeepStrictEqual(rest, stable)) reject();
    }
    return receipt;
  }, defaultJdChromiumRunLockDirectory(root));
}
