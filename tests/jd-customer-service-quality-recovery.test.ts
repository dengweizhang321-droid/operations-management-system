import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as XLSX from "xlsx";
import { customerServicePeriod } from "../lib/jd/customer-service-workflow";
import { parseSessionWorkbook } from "../lib/customer-service/import-service";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";
import { buildCustomerServiceDailyFiles } from "../tools/jd-customer-service-daily-files";
import { planCustomerServiceRun, runCustomerServicePlan } from "../tools/jd-customer-service-n8n-pipeline";
import { customerServiceRecoveryDirectory, parseCustomerServiceRecoveryHeader, type CustomerServiceRecoveryApproval } from "../tools/jd-customer-service-source-recovery";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function pair(duration = -0.01, extra: Record<string, unknown> = {}) {
  const period = customerServicePeriod(new Date());
  const values = { 咨询时间: `${period.endDate} 10:00:00`, 客服: "合成客服", 顾客: "synthetic", cid: "fixture", "会话时长(M)": duration, ...extra };
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([values]), "会话");
  return { period, session: new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
    chat: new TextEncoder().encode(`/*****************以下为一通会话************************************/\nsynthetic ${period.endDate} 10:00:00\n合成内容\n`) };
}
test("负时长仅在显式自动清洗策略下为缺失；原字节、会话和其他字段保留", () => {
  const p = pair(); const before = sha(p.session);
  assert.throws(() => buildCustomerServiceDailyFiles(p.session, p.chat, p.period, jdCustomerServiceStores[1].storeKey), /PAIR_PARSE/);
  const result = buildCustomerServiceDailyFiles(p.session, p.chat, p.period, jdCustomerServiceStores[1].storeKey, { negativeDurationToMissing: true });
  assert.equal(sha(p.session), before);
  assert.equal(result.sourceSessionSha256, before);
  assert.deepEqual(result.durationAnomalies, [{ sourceRowNumber: 2, sourceValue: -0.01 }]);
  assert.equal(result.conversationCount, 1);
  const row = parseSessionWorkbook(result.files[0].sessionBytes)[0];
  assert.equal(row.durationMinutes, null); assert.equal(row.customerId, "synthetic"); assert.equal(row.conversationId, "fixture");
  assert.deepEqual(buildCustomerServiceDailyFiles(p.session, p.chat, p.period, jdCustomerServiceStores[1].storeKey, { negativeDurationToMissing: true }), result);
});
test("负响应时间、非法计数与时间仍拒绝，正数/零/原缺失时长不改变", () => {
  for (const extra of [{ "新平均响应时间(S)": -1 }, { 客户消息数: -1 }, { 咨询时间: "invalid" }]) {
    const p = pair(-0.01, extra);
    assert.throws(() => buildCustomerServiceDailyFiles(p.session, p.chat, p.period, jdCustomerServiceStores[1].storeKey, { negativeDurationToMissing: true }), /PAIR_PARSE/);
  }
  for (const value of [0, 2.5]) { const p = pair(value); const r = buildCustomerServiceDailyFiles(p.session, p.chat, p.period, jdCustomerServiceStores[1].storeKey, { negativeDurationToMissing: true }); assert.deepEqual(r.durationAnomalies, []); assert.equal(r.normalizedSessionSha256, sha(p.session)); }
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-recovery-"));
  const config = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const store of config.stores) store.browser.downloadDir = path.join(root, "downloads", store.storeKey);
  await mkdir(path.join(root, "config")); await writeFile(path.join(root, "config/jd-store-accounts.json"), JSON.stringify(config));
  const store = jdCustomerServiceStores[1]; const p = pair();
  const parent = await planCustomerServiceRun(root, "parent", new Date(), store.storeKey);
  const directory = path.join(root, "downloads", store.storeKey, "customer-service/parent"); await mkdir(directory, { recursive: true });
  for (const [view, bytes, name] of [["list", p.session, "source.xlsx"], ["messages", p.chat, "source.log"]] as const) {
    const file = path.join(directory, name); await writeFile(file, bytes);
    parent.source[view] = { view, phase: "downloaded", sourceCount: 1, savedPath: file, sha256: sha(bytes), sizeBytes: bytes.length };
  }
  parent.stage = "failed"; parent.failureCode = "PAIR_PARSE_REJECTED";
  const parentPath = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey, "parent.json");
  const parentBytes = Buffer.from(JSON.stringify(parent)); await writeFile(parentPath, parentBytes);
  const approval: CustomerServiceRecoveryApproval = { version: 1, kind: "downloaded_pair", storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
    originalExecutionId: "parent", originalPlanSha256: sha(parentBytes), period: p.period, failureCode: "PAIR_PARSE_REJECTED",
    approvedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), expectedDurationAnomalies: [{ sourceRowNumber: 2, sourceValue: -0.01 }] };
  const approve = async (value: CustomerServiceRecoveryApproval) => { const raw = Buffer.from(JSON.stringify(value)); const digest = sha(raw);
    await mkdir(customerServiceRecoveryDirectory(root, store.storeKey), { recursive: true }); await writeFile(path.join(customerServiceRecoveryDirectory(root, store.storeKey), digest + ".json"), raw); return digest; };
  return { root, store, parent, parentBytes, parentPath, approval, approve };
}
test("批准的已下载双文件仅被一个新完整execution领取，原失败和原文件不改", async () => {
  const f = await fixture();
  try {
    const digest = await f.approve(f.approval);
    const results = await Promise.allSettled(["child-1", "child-2"].map(id => planCustomerServiceRun(f.root, id, new Date(), f.store.storeKey, digest)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    assert.deepEqual(await readFile(f.parentPath), f.parentBytes);
    const child = results.find(r => r.status === "fulfilled"); assert.ok(child?.status === "fulfilled");
    assert.equal(child.value.sourceRecovery?.originalExecutionId, "parent");
    assert.deepEqual(child.value.source, f.parent.source); assert.equal(child.value.stage, "planned");
    await writeFile(f.parent.source.list!.savedPath!, "tampered");
    await assert.rejects(runCustomerServicePlan(f.root, child.value), /SOURCE_RECOVERY/);
    const saved = JSON.parse(await readFile(path.join(path.dirname(f.parentPath), child.value.executionId + ".json"), "utf8")); assert.equal(saved.stage, "planned");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("坏店铺、过期、变动原计划、未决/已有导入及错异常清单均拒绝", async () => {
  for (const change of ["store", "expired", "plan", "submitted", "importing", "proof", "anomaly"]) {
    const f = await fixture();
    try {
      if (change === "store") f.approval.shopName = "wrong";
      if (change === "expired") { f.approval.approvedAt = new Date(Date.now() - 7200000).toISOString(); f.approval.expiresAt = new Date(Date.now() - 1000).toISOString(); }
      if (change === "anomaly") f.approval.expectedDurationAnomalies = [];
      if (change === "submitted") f.parent.source.messages!.phase = "submitted";
      if (change === "importing") f.parent.importingDate = f.parent.period.endDate;
      if (change === "proof") f.parent.proofs = [{ date: f.parent.period.endDate } as typeof f.parent.proofs[number]];
      if (["submitted", "importing", "proof"].includes(change)) { const raw = Buffer.from(JSON.stringify(f.parent)); await writeFile(f.parentPath, raw); f.approval.originalPlanSha256 = sha(raw); }
      const digest = await f.approve(f.approval);
      if (change === "plan") await writeFile(f.parentPath, JSON.stringify({ ...f.parent, updatedAt: "changed" }));
      await assert.rejects(planCustomerServiceRun(f.root, "child", new Date(), f.store.storeKey, digest), /SOURCE_RECOVERY/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
  for (const value of ["", "../bad", ["a".repeat(64)]]) assert.throws(() => parseCustomerServiceRecoveryHeader(value));
});

test("导出前零效果许可须有同店可见身份见证且不存在下载残留", async () => {
  for (const residue of [false, true]) {
    const f = await fixture();
    try {
      const directory = path.dirname(f.parent.source.list!.savedPath!);
      assert.ok(path.resolve(directory).startsWith(path.resolve(f.root) + path.sep));
      if (!residue) await rm(directory, { recursive: true });
      f.parent.source = {}; f.parent.failureCode = "PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION";
      const raw = Buffer.from(JSON.stringify(f.parent)); await writeFile(f.parentPath, raw);
      f.approval.kind = "pre_export_zero_effect"; f.approval.failureCode = f.parent.failureCode;
      f.approval.originalPlanSha256 = sha(raw); delete f.approval.expectedDurationAnomalies;
      f.approval.identityWitness = { shopName: f.store.shopName, shopTitle: f.store.shopName, listTabs: 1, messageTabs: 1, challengePresent: false, credentialsSubmitted: false, exportSubmitted: false, importSubmitted: false };
      const digest = await f.approve(f.approval);
      if (residue) await assert.rejects(planCustomerServiceRun(f.root, "fresh", new Date(), f.store.storeKey, digest), /SOURCE_RECOVERY/);
      else { const plan = await planCustomerServiceRun(f.root, "fresh", new Date(), f.store.storeKey, digest); assert.deepEqual(plan.source, {}); assert.equal(plan.sourceRecovery?.kind, "pre_export_zero_effect"); assert.deepEqual(await readFile(f.parentPath), raw); }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
