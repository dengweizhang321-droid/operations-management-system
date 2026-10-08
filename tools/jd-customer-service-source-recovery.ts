import { createHash } from "node:crypto";
import { readFile, realpath, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { JdCustomerServiceWorkflowError, type CustomerServicePeriod } from "../lib/jd/customer-service-workflow";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { buildCustomerServiceDailyFiles } from "./jd-customer-service-daily-files";
import type { CustomerServiceN8nPlan } from "./jd-customer-service-n8n-pipeline";
import type { CustomerServiceDurationAnomaly } from "./jd-customer-service-duration-normalization";

export const customerServiceRecoveryHeader = "x-teruisi-jd-customer-service-recovery-sha256";
type IdentityWitness = { shopName: string; shopTitle: string; listTabs: 1; messageTabs: 1; challengePresent: false; credentialsSubmitted: false; exportSubmitted: false; importSubmitted: false };
export type CustomerServiceRecoveryApproval = {
  version: 1; kind: "downloaded_pair" | "pre_export_zero_effect";
  storeKey: string; shopId: string; shopName: string;
  originalExecutionId: string; originalPlanSha256: string;
  period: CustomerServicePeriod; failureCode: string;
  approvedAt: string; expiresAt: string;
  expectedDurationAnomalies?: CustomerServiceDurationAnomaly[];
  identityWitness?: IdentityWitness;
};
export type CustomerServiceSourceRecovery = { approvalSha256: string; originalExecutionId: string; kind: CustomerServiceRecoveryApproval["kind"] };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function reject(): never { throw new JdCustomerServiceWorkflowError("SOURCE_RECOVERY_REJECTED_MANUAL_ACTION"); }
export function parseCustomerServiceRecoveryHeader(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) reject();
  return value;
}
export function customerServiceRecoveryDirectory(root: string, storeKey: string) {
  const store = customerServiceStore(storeKey);
  return path.join(root, "outputs", "jd-customer-service-pipeline", ...(store.storeKey === "jd-yiyong-director" ? [] : [store.storeKey]), "recoveries");
}
async function regularBytes(file: string, maximum: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum
    || path.resolve(await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) reject();
  return readFile(file);
}
export async function inspectCustomerServiceRecovery(input: {
  root: string; storeKey: string; executionId: string; approvalSha256: string;
  previous: CustomerServiceN8nPlan; previousBytes: Uint8Array; period: CustomerServicePeriod;
}) {
  const { root, storeKey, previous, approvalSha256, executionId, period } = input;
  parseCustomerServiceRecoveryHeader(approvalSha256);
  const raw = await regularBytes(path.join(customerServiceRecoveryDirectory(root, storeKey), `${approvalSha256}.json`), 64 * 1024);
  if (digest(raw) !== approvalSha256) reject();
  const approval = JSON.parse(raw.toString("utf8")) as CustomerServiceRecoveryApproval;
  const store = customerServiceStore(storeKey);
  const approved = Date.parse(approval.approvedAt), expires = Date.parse(approval.expiresAt), now = Date.now();
  if (approval.version !== 1 || approval.storeKey !== store.storeKey || approval.shopId !== store.shopId || approval.shopName !== store.shopName
    || approval.originalExecutionId !== previous.executionId || previous.executionId === executionId
    || !/^[A-Za-z0-9_-]{1,96}$/.test(previous.executionId) || !/^[A-Za-z0-9_-]{1,96}$/.test(executionId)
    || approval.originalPlanSha256 !== digest(input.previousBytes) || !isDeepStrictEqual(approval.period, previous.period)
    || !isDeepStrictEqual(period, previous.period) || previous.storeKey !== storeKey || previous.shopName !== store.shopName || previous.shopId !== store.shopId
    || previous.stage !== "failed" || previous.failureCode !== approval.failureCode || previous.proofs.length || previous.importingDate || previous.dailyFiles
    || !Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now || expires - approved > 2 * 60 * 60 * 1000) reject();
  const registry = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config", "jd-store-accounts.json"), "utf8")), root);
  const registered = registry.find(item => item.storeKey === storeKey);
  if (!registered?.enabled || registered.shopName !== store.shopName || registered.shopId !== store.shopId) reject();
  const parentDirectory = path.join(registered.browser.downloadDir, "customer-service", previous.executionId);
  if (approval.kind === "pre_export_zero_effect") {
    if (!["PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION", "CHAT_PAGE_NOT_READY_MANUAL_ACTION"].includes(approval.failureCode)
      || Object.keys(previous.source).length || approval.expectedDurationAnomalies !== undefined
      || !isDeepStrictEqual(approval.identityWitness, { shopName: store.shopName, shopTitle: store.shopName,
        listTabs: 1, messageTabs: 1, challengePresent: false, credentialsSubmitted: false, exportSubmitted: false, importSubmitted: false })) reject();
    try { await lstat(parentDirectory); reject(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { approval, source: {} };
  }
  if (approval.kind !== "downloaded_pair" || approval.failureCode !== "PAIR_PARSE_REJECTED" || approval.identityWitness !== undefined
    || !Array.isArray(approval.expectedDurationAnomalies) || !approval.expectedDurationAnomalies.length) reject();
  const bytes: Uint8Array[] = [];
  for (const [index, view] of (["list", "messages"] as const).entries()) {
    const checkpoint = previous.source[view];
    if (!checkpoint?.savedPath || checkpoint.phase !== "downloaded" || checkpoint.view !== view
      || path.dirname(path.resolve(checkpoint.savedPath)).toLowerCase() !== path.resolve(parentDirectory).toLowerCase()
      || path.extname(checkpoint.savedPath).toLowerCase() !== (index === 0 ? ".xlsx" : ".log")
      || !Number.isSafeInteger(checkpoint.sourceCount) || Number(checkpoint.sourceCount) <= 0) reject();
    const file = await regularBytes(checkpoint.savedPath, 25 * 1024 * 1024);
    if (file.length !== checkpoint.sizeBytes || digest(file) !== checkpoint.sha256) reject();
    bytes.push(file);
  }
  if (previous.source.list?.sourceCount !== previous.source.messages?.sourceCount) reject();
  const parsed = buildCustomerServiceDailyFiles(bytes[0], bytes[1], period, storeKey, { negativeDurationToMissing: true });
  if (parsed.summary.sessionCount !== previous.source.list?.sourceCount
    || !isDeepStrictEqual(parsed.durationAnomalies, approval.expectedDurationAnomalies)) reject();
  return { approval, source: structuredClone(previous.source) };
}
export async function claimCustomerServiceRecovery(root: string, recovery: CustomerServiceSourceRecovery, storeKey: string, executionId: string) {
  // Called under the original per-store planning lock; create-only and terminal.
  await writeFile(path.join(customerServiceRecoveryDirectory(root, storeKey), `${recovery.approvalSha256}.claimed.json`),
    JSON.stringify({ executionId, storeKey, ...recovery }), { flag: "wx" });
}
export async function verifyCustomerServiceRecoveryClaim(root: string, recovery: CustomerServiceSourceRecovery, storeKey: string, executionId: string) {
  const raw = await regularBytes(path.join(customerServiceRecoveryDirectory(root, storeKey), `${recovery.approvalSha256}.claimed.json`), 64 * 1024);
  if (!isDeepStrictEqual(JSON.parse(raw.toString("utf8")), { executionId, storeKey, ...recovery })) reject();
}
