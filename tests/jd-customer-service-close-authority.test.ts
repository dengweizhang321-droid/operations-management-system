import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CloseSlotCoordinator } from "../lib/jackyun/operator-close";
import * as XLSX from "xlsx";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";
import { planCustomerServiceRun } from "../tools/jd-customer-service-n8n-pipeline";
import { customerServiceRecoveryDirectory, generateCustomerServiceRecoveryApproval, dispatchCustomerServiceCloseAuthority,
  readCustomerServiceCloseTarget, type CustomerServiceCloseAuthorityTarget } from "../tools/jd-customer-service-source-recovery";

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
  for (const [view, bytes, name] of [["list", p.session, "list.xlsx"], ["messages", p.chat, "messages.log"]] as const) {
    const file = path.join(directory, name); await writeFile(file, bytes);
    plan.source[view] = { view, phase: "downloaded", sourceCount: 1, savedPath: file, sha256: sha(bytes), sizeBytes: bytes.length };
  }
  plan.stage = "failed"; plan.failureCode = "PAIR_PARSE_REJECTED";
  plan.failureBoundary = { version: 1, browserClosed: true, step: "export_messages" };
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

test("dispatchCustomerServiceCloseAuthority 核验现行v2授权后只返回既有精确闭合结果，不生成来源恢复许可", async () => {
  const f = await zeroEffectFixture();
  const authorizationId = "11111111-1111-1111-1111-111111111111";
  const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 3600000).toISOString();
  const good = { ok: true, version: "jd-customer-service-operator-reconcile-authority-v2", action: "close", target: f.target, authorizationId, createdAt, expiresAt };
  const fetchStub: typeof fetch = async () => new Response(JSON.stringify(good));
  // Exercise authorization before an already-committed synthetic target is
  // returned. This path never reads live n8n, drain state or browser ports,
  // and cannot create a new business closure in the test.
  const coordinator: CloseSlotCoordinator = { observe: () => { throw Error("UNEXPECTED_RESOURCE_ACCESS"); }, freeze: () => { throw Error("UNEXPECTED_RESOURCE_ACCESS"); } };
  const committedAuthorizationId = "33333333-3333-3333-3333-333333333333";
  const closedDirectory = path.join(path.dirname(f.planPath), "operator-closures");
  await mkdir(closedDirectory);
  const closedPath = path.join(closedDirectory, `stuck-${f.target.originalPlanSha256}.json`);
  await writeFile(closedPath, JSON.stringify({ version: "jd-customer-service-operator-reconcile-v1", authorizationId: committedAuthorizationId,
    action: "close", target: f.target, outcome: "failed_closed", completedAt: createdAt }));
  const closedBytes = await readFile(closedPath);
  try {
    // Invalid permissions must be rejected before a request is durably
    // recorded. Once a request has a committed result, retries intentionally
    // query that result without requiring a renewed/changed authorization.
    const wrongVersion = { ...good, version: "wrong-version" };
    const stubBad: typeof fetch = async () => new Response(JSON.stringify(wrongVersion));
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, coordinator, stubBad), /CUSTOMER_SERVICE_OPERATOR_RECONCILIATION_BLOCKED/);

    const mismatchedId = { ...good, authorizationId: "22222222-2222-2222-2222-222222222222" };
    const stubMismatch: typeof fetch = async () => new Response(JSON.stringify(mismatchedId));
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, coordinator, stubMismatch), /CUSTOMER_SERVICE_OPERATOR_RECONCILIATION_BLOCKED/);

    const expired = { ...good, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const stubExpired: typeof fetch = async () => new Response(JSON.stringify(expired));
    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, authorizationId, coordinator, stubExpired), /CUSTOMER_SERVICE_OPERATOR_RECONCILIATION_BLOCKED/);

    await assert.rejects(dispatchCustomerServiceCloseAuthority(f.root, "not-a-uuid", coordinator, fetchStub), /CUSTOMER_SERVICE_OPERATOR_RECONCILIATION_BLOCKED/);
    const result = await dispatchCustomerServiceCloseAuthority(f.root, authorizationId, coordinator, fetchStub);
    assert.equal(result.ok, true);
    assert.equal(result.storeKey, f.store.storeKey);
    assert.equal(result.originalExecutionId, "stuck");
    assert.equal(result.outcome, "failed_closed");
    assert.equal(result.committedAuthorizationId, committedAuthorizationId);
    assert.equal(result.requestedAuthorizationId, authorizationId);
    assert.deepEqual(await readFile(closedPath), closedBytes);
    assert.deepEqual(await readFile(f.planPath), f.planBytes);
    await assert.rejects(readdir(customerServiceRecoveryDirectory(f.root, f.store.storeKey)), { code: "ENOENT" });
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

test("readCustomerServiceCloseTarget: pre_export_zero_effect 结构合格时 closeAllowed=true 且字段与 generateCustomerServiceRecoveryApproval 一致", async () => {
  const f = await zeroEffectFixture();
  try {
    // A plan recording that its browser was already closed after the
    // pre-submit failure (the modern shape); empty source plus this is the
    // one case this function allows without further human judgement calls.
    f.plan.failureBoundary = { version: 1, browserClosed: true, step: "open_customer_service_page" };
    await writeFile(f.planPath, JSON.stringify(f.plan));
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, true);
    assert.equal(result.target?.kind, "pre_export_zero_effect");
    assert.equal(result.target?.originalExecutionId, "stuck");
    assert.equal(result.target?.failureCode, "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION");
    assert.equal(result.target?.originalPlanSha256, sha(await readFile(f.planPath)));
    assert.deepEqual(result.target?.period, f.plan.period);
    // The reported target must actually be accepted by the real generator.
    const { approval } = await generateCustomerServiceRecoveryApproval(f.root, result.target as CustomerServiceCloseAuthorityTarget, new Date());
    assert.equal(approval.kind, "pre_export_zero_effect");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: downloaded_pair 结构合格时 closeAllowed=true 且能被真实生成器接受", async () => {
  const f = await downloadedPairFixture();
  try {
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, true);
    assert.equal(result.target?.kind, "downloaded_pair");
    assert.equal(result.target?.failureCode, "PAIR_PARSE_REJECTED");
    const { approval } = await generateCustomerServiceRecoveryApproval(f.root, result.target as CustomerServiceCloseAuthorityTarget, new Date());
    assert.equal(approval.kind, "downloaded_pair");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 无 failureBoundary 的旧格式计划报告 closeAllowed=false 且给出具体原因", async () => {
  const f = await zeroEffectFixture();
  try {
    assert.equal("failureBoundary" in f.plan, false); // planCustomerServiceRun 未写入该字段
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, false);
    assert.match(result.reason, /failureBoundary/);
    assert.equal(result.diagnostic?.category, "failure_boundary_missing");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: source 非空但失败码不是 PAIR_PARSE_REJECTED 时拒绝并说明原因", async () => {
  const f = await downloadedPairFixture();
  try {
    f.plan.failureCode = "CHAT_PAGE_MISMATCH";
    const raw = Buffer.from(JSON.stringify(f.plan));
    await writeFile(f.planPath, raw);
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, false);
    assert.equal(result.target, undefined);
    assert.equal(result.diagnostic?.category, "failure_code_mismatch");
    assert.match(result.reason, /PAIR_PARSE_REJECTED/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 结构上满足自动白名单(isCustomerServicePreSubmitFailure)的真实卡住计划仍报告需要人工核实，不被该白名单短路", async () => {
  // Regression test: isCustomerServicePreSubmitFailure() returns true for an
  // empty-source plan with no failureBoundary at all (it only rejects a
  // *malformed* failureBoundary, not a missing one) -- exactly the shape of
  // the real stuck exec 7250/8653/9243/7266/7482/9861 plans. Treating "passes
  // that predicate" as "defer to automatic path" would wrongly tell the
  // operator these real stuck plans need no human action.
  const f = await zeroEffectFixture();
  try {
    assert.equal("failureBoundary" in f.plan, false);
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, false);
    assert.doesNotMatch(result.reason, /自动闭合白名单|不需要人工闭合/);
    assert.match(result.reason, /failureBoundary/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 没有活动任务时报告没有可闭合目标", async () => {
  const root = await rootWithStore();
  try {
    const result = await readCustomerServiceCloseTarget(root, jdCustomerServiceStores[0].storeKey);
    assert.equal(result.closeAllowed, false);
    assert.equal(result.target, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 用户确认保留executed_verify候选，其余非failed状态无需闭合", async () => {
  const f = await zeroEffectFixture();
  try {
    f.plan.stage = "executed";
    delete f.plan.failureCode;
    await writeFile(f.planPath, JSON.stringify(f.plan));
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, true);
    assert.equal(result.target?.kind, "executed_verify");
    assert.equal(result.target?.failureCode, "");
    assert.match(result.reason, /原 C 验证/);
    assert.match(result.reason, /不重跑导出或导入/);
    for (const stage of ["planned", "completed"] as const) {
      f.plan.stage = stage;
      await writeFile(f.planPath, JSON.stringify(f.plan));
      const other = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
      assert.equal(other.closeAllowed, false);
      assert.equal(other.target, undefined);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 已有部分导入进度(proofs/importingDate/dailyFiles)时拒绝", async () => {
  for (const change of ["proofs", "importingDate", "dailyFiles"] as const) {
    const f = await zeroEffectFixture();
    try {
      if (change === "proofs") f.plan.proofs = [{ date: f.plan.period.endDate } as typeof f.plan.proofs[number]];
      if (change === "importingDate") f.plan.importingDate = f.plan.period.endDate;
      if (change === "dailyFiles") f.plan.dailyFiles = [];
      await writeFile(f.planPath, JSON.stringify(f.plan));
      const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
      assert.equal(result.closeAllowed, false);
      assert.equal(result.target, undefined);
      assert.match(result.reason, /部分导入进度/);
      assert.equal(result.diagnostic?.category, "partial_import_progress");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("readCustomerServiceCloseTarget: pre_export_zero_effect 但下载目录仍有残留文件时拒绝", async () => {
  const f = await zeroEffectFixture();
  try {
    f.plan.failureBoundary = { version: 1, browserClosed: true, step: "open_customer_service_page" };
    await writeFile(f.planPath, JSON.stringify(f.plan));
    const directory = path.join(f.root, "downloads", f.store.storeKey, "customer-service", "stuck");
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "leftover.txt"), "x");
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, false);
    assert.match(result.reason, /残留/);
    assert.equal(result.diagnostic?.category, "directory_residue");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("readCustomerServiceCloseTarget: 店铺范围外的 storeKey 被拒绝", async () => {
  const root = await rootWithStore();
  try {
    const result = await readCustomerServiceCloseTarget(root, "jd-not-a-real-store");
    assert.equal(result.closeAllowed, false);
    assert.equal(result.target, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
