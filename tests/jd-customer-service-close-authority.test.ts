import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as XLSX from "xlsx";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";
import { planCustomerServiceRun } from "../tools/jd-customer-service-n8n-pipeline";
import { customerServiceRecoveryDirectory, generateCustomerServiceRecoveryApproval, dispatchCustomerServiceCloseAuthority,
  type CustomerServiceCloseAuthorityTarget } from "../tools/jd-customer-service-source-recovery";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function pair(duration = -0.01) {
  const period = customerServicePeriod(new Date());
  const values = { 咨询时间: `${period.endDate} 10:00:00`, 客服: "合成客服", 顾客: "synthetic", cid: "fixture", "会话时长(M)": duration };
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([values]), "会话");
  return { period, session: new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
    chat: new TextEncoder().encode(`/*****************以下为一通会话************************************/\nsynthetic ${period.endDate} 10:00:00\n合成内容\n`) };
}

async function rootWithStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-close-authority-"));
  const config = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const store of config.stores) store.browser.downloadDir = path.join(root, "downloads", store.storeKey);
  await mkdir(path.join(root, "config")); await writeFile(path.join(root, "config/jd-store-accounts.json"), JSON.stringify(config));
  return root;
}

// A "pre_export_zero_effect"-shaped stuck plan: empty source, failed, no proofs.
async function zeroEffectFixture() {
  const root = await rootWithStore();
  const store = jdCustomerServiceStores[2]; // jd-chudian-weizhang
  const plan = await planCustomerServiceRun(root, "stuck", new Date(), store.storeKey);
  plan.stage = "failed"; plan.failureCode = "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION";
  const planPath = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey, "stuck.json");
  const planBytes = Buffer.from(JSON.stringify(plan)); await writeFile(planPath, planBytes);
  const target: CustomerServiceCloseAuthorityTarget = { storeKey: store.storeKey, kind: "pre_export_zero_effect",
    originalExecutionId: "stuck", originalPlanSha256: sha(planBytes), failureCode: plan.failureCode, period: plan.period };
  return { root, store, plan, planPath, planBytes, target };
}

// A "downloaded_pair"-shaped stuck plan: both views downloaded, failed with PAIR_PARSE_REJECTED.
async function downloadedPairFixture() {
  const root = await rootWithStore();
  const store = jdCustomerServiceStores[3]; // jd-cuizhiwang-dengweizhang
  const p = pair();
  const plan = await planCustomerServiceRun(root, "stuck", new Date(), store.storeKey);
  const directory = path.join(root, "downloads", store.storeKey, "customer-service/stuck"); await mkdir(directory, { recursive: true });
  for (const [view, bytes, name] of [["list", p.session, "source.xlsx"], ["messages", p.chat, "source.log"]] as const) {
    const file = path.join(directory, name); await writeFile(file, bytes);
    plan.source[view] = { view, phase: "downloaded", sourceCount: 1, savedPath: file, sha256: sha(bytes), sizeBytes: bytes.length };
  }
  plan.stage = "failed"; plan.failureCode = "PAIR_PARSE_REJECTED";
  const planPath = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey, "stuck.json");
  const planBytes = Buffer.from(JSON.stringify(plan)); await writeFile(planPath, planBytes);
  const target: CustomerServiceCloseAuthorityTarget = { storeKey: store.storeKey, kind: "downloaded_pair",
    originalExecutionId: "stuck", originalPlanSha256: sha(planBytes), failureCode: plan.failureCode, period: plan.period };
  return { root, store, plan, planPath, planBytes, target };
}

test("pre_export_zero_effect 生成的许可文件自洽：文件名等于内容sha256，可被领取", async () => {
  const f = await zeroEffectFixture();
  try {
    const { approval, approvalSha256 } = await generateCustomerServiceRecoveryApproval(f.root, f.target, new Date());
    const file = path.join(customerServiceRecoveryDirectory(f.root, f.store.storeKey), `${approvalSha256}.json`);
    const raw = await readFile(file);
    assert.equal(sha(raw), approvalSha256);
    assert.deepEqual(JSON.parse(raw.toString("utf8")), approval);
    assert.equal(approval.kind, "pre_export_zero_effect");
    assert.equal(approval.failureCode, "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION");
    assert.deepEqual(approval.identityWitness, { shopName: f.store.shopName, shopTitle: f.store.shopName, listTabs: 1, messageTabs: 1,
      challengePresent: false, credentialsSubmitted: false, exportSubmitted: false, importSubmitted: false });
    assert.equal(approval.expectedDurationAnomalies, undefined);
    // Original stuck plan bytes are untouched.
    assert.deepEqual(await readFile(f.planPath), f.planBytes);
    // Re-calling with the exact same approvedAt is idempotent (create-only, same content).
    const approvedAt = new Date(approval.approvedAt);
    const second = await generateCustomerServiceRecoveryApproval(f.root, f.target, approvedAt);
    assert.equal(second.approvalSha256, approvalSha256);
    // A different approvedAt for the same stuck plan produces a distinct
    // approval file rather than silently overwriting the first one.
    const third = await generateCustomerServiceRecoveryApproval(f.root, f.target, new Date(approvedAt.getTime() + 1000));
    assert.notEqual(third.approvalSha256, approvalSha256);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("downloaded_pair 生成的许可从真实下载文件重算异常清单，不凭空编造", async () => {
  const f = await downloadedPairFixture();
  try {
    const { approval, approvalSha256 } = await generateCustomerServiceRecoveryApproval(f.root, f.target, new Date());
    assert.equal(approval.kind, "downloaded_pair");
    assert.deepEqual(approval.expectedDurationAnomalies, [{ sourceRowNumber: 2, sourceValue: -0.01 }]);
    assert.equal(approval.identityWitness, undefined);
    const file = path.join(customerServiceRecoveryDirectory(f.root, f.store.storeKey), `${approvalSha256}.json`);
    assert.equal(sha(await readFile(file)), approvalSha256);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION 永远不是可批准的failureCode", async () => {
  const f = await zeroEffectFixture();
  try {
    const bad = { ...f.target, failureCode: "PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION" };
    await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, bad, new Date()));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("failureCode 必须与原计划的真实failureCode一致，不接受调用方随意声明", async () => {
  const f = await zeroEffectFixture();
  try {
    const mismatched = { ...f.target, failureCode: "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION" };
    await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, mismatched, new Date()));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("kind 与 failureCode 必须配对：downloaded_pair 只接受 PAIR_PARSE_REJECTED", async () => {
  const f = await zeroEffectFixture();
  try {
    const wrongKind = { ...f.target, kind: "downloaded_pair" as const };
    await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, wrongKind, new Date()));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("原计划摘要不匹配、已有导入进度或stage非failed均拒绝", async () => {
  for (const change of ["sha", "stage", "proofs"]) {
    const f = await zeroEffectFixture();
    try {
      if (change === "sha") f.target.originalPlanSha256 = "a".repeat(64);
      if (change === "stage") { f.plan.stage = "executed"; await writeFile(f.planPath, JSON.stringify(f.plan)); f.target.originalPlanSha256 = sha(await readFile(f.planPath)); }
      if (change === "proofs") {
        f.plan.proofs = [{ date: f.plan.period.endDate } as typeof f.plan.proofs[number]];
        const raw = Buffer.from(JSON.stringify(f.plan)); await writeFile(f.planPath, raw); f.target.originalPlanSha256 = sha(raw);
      }
      await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, f.target, new Date()));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("pre_export_zero_effect 存在下载目录残留时拒绝", async () => {
  const f = await zeroEffectFixture();
  try {
    const directory = path.join(f.root, "downloads", f.store.storeKey, "customer-service", "stuck");
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "leftover.txt"), "x");
    await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, f.target, new Date()));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("店铺范围外的storeKey被拒绝", async () => {
  const f = await zeroEffectFixture();
  try {
    const outside = { ...f.target, storeKey: "jd-not-a-real-store" };
    await assert.rejects(generateCustomerServiceRecoveryApproval(f.root, outside as CustomerServiceCloseAuthorityTarget, new Date()));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("dispatchCustomerServiceCloseAuthority 重新核验Worker回执版本、身份与有效期后才生成", async () => {
  const f = await zeroEffectFixture();
  const authorizationId = "11111111-1111-1111-1111-111111111111";
  const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 3600000).toISOString();
  const good = { ok: true, version: "jd-customer-service-operator-close-authority-v1", action: "close", target: f.target, authorizationId, createdAt, expiresAt };
  const fetchStub = async (_url: string) => ({ ok: true, text: async () => JSON.stringify(good) }) as Response;
  try {
    const result = await dispatchCustomerServiceCloseAuthority(f.root, authorizationId, fetchStub);
    assert.equal(result.ok, true);
    assert.equal(result.storeKey, f.store.storeKey);
    assert.equal(result.originalExecutionId, "stuck");

    const wrongVersion = { ...good, version: "wrong-version" };
    const stubBad = async (_url: string) => ({ ok: true, text: async () => JSON.stringify(wrongVersion) }) as Response;
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, stubBad));

    const mismatchedId = { ...good, authorizationId: "22222222-2222-2222-2222-222222222222" };
    const stubMismatch = async (_url: string) => ({ ok: true, text: async () => JSON.stringify(mismatchedId) }) as Response;
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, stubMismatch));

    const expired = { ...good, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const stubExpired = async (_url: string) => ({ ok: true, text: async () => JSON.stringify(expired) }) as Response;
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, stubExpired));

    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, "not-a-uuid", fetchStub));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("端到端：生成的许可真正能被既有planCustomerServiceRun消费，打破PREVIOUS_RUN_UNRESOLVED自锁", async () => {
  const f = await zeroEffectFixture();
  try {
    // Without any approval, the stuck "failed" plan with a non-whitelisted
    // shape for the automatic closer would make the next A round reject.
    const { approvalSha256 } = await generateCustomerServiceRecoveryApproval(f.root, f.target, new Date());
    const next = await planCustomerServiceRun(f.root, "next", new Date(), f.store.storeKey, approvalSha256);
    assert.equal(next.stage, "planned");
    assert.equal(next.sourceRecovery?.originalExecutionId, "stuck");
    assert.equal(next.sourceRecovery?.kind, "pre_export_zero_effect");
    assert.deepEqual(next.source, {});
    // The original stuck plan is left exactly as it was; nothing was deleted
    // or retroactively marked successful.
    assert.deepEqual(await readFile(f.planPath), f.planBytes);
    assert.equal(JSON.parse(await readFile(f.planPath, "utf8")).stage, "failed");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
