import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as XLSX from "xlsx";
import { customerServicePeriod, JdCustomerServiceWorkflowError } from "../lib/jd/customer-service-workflow";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import type { CustomerServiceN8nPlan } from "../tools/jd-customer-service-n8n-pipeline";
import { customerServiceCloseEvidenceCode, inspectCustomerServiceCloseEvidence, readCustomerServiceCloseTarget } from "../tools/jd-customer-service-source-recovery";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const period = customerServicePeriod(new Date("2026-10-31T02:00:00Z"));
function pair(listCount = 2, messagesCount = 2, invalidChat = false) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(Array.from({ length: listCount }, (_, i) => ({
    咨询时间: `${period.endDate} 10:00:00`, 客服: "synthetic-agent-private", 顾客: `synthetic-customer-private-${i}`, cid: `fixture-${i}`, "会话时长(M)": -0.01,
  }))), "会话");
  return { list: new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
    messages: new TextEncoder().encode(invalidChat ? "synthetic-chat-private-invalid" : Array.from({ length: messagesCount }, (_, i) =>
      `/*****************以下为一通会话************************************/\nsynthetic-customer-private-${i} ${period.endDate} 10:00:00\nsynthetic-chat-private\n`).join("\n")) };
}
async function fixture(kind: "list" | "pair" | "executed" = "pair", options: { listCount?: number; messagesCount?: number; invalidChat?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jd-cs-diagnostic-"));
  const store = customerServiceStore(kind === "list" ? "jd-chudian-weizhang" : kind === "executed" ? "jd-cuizhiwang-dengweizhang" : "jd-maidehao-operator1");
  const executionId = kind === "list" ? "11039" : kind === "executed" ? "11018" : "11042";
  const config = JSON.parse(await readFile(new URL("../config/jd-store-accounts.json", import.meta.url), "utf8"));
  for (const entry of config.stores) entry.browser.downloadDir = path.join(root, "downloads", entry.storeKey);
  await mkdir(path.join(root, "config")); await writeFile(path.join(root, "config/jd-store-accounts.json"), JSON.stringify(config));
  const directory = path.join(root, "outputs/jd-customer-service-pipeline", store.storeKey);
  const sourceDirectory = path.join(root, "downloads", store.storeKey, "customer-service", executionId);
  await mkdir(directory, { recursive: true }); await mkdir(sourceDirectory, { recursive: true });
  const plan: CustomerServiceN8nPlan = { version: 1, storeKey: store.storeKey, shopId: store.shopId, shopName: store.shopName,
    executionId, period, createdAt: "2026-10-30T02:00:00.000Z", updatedAt: "2026-10-30T02:05:00.000Z",
    stage: kind === "executed" ? "executed" : "failed", source: {}, proofs: [] };
  if (kind !== "executed") {
    plan.failureCode = kind === "list" ? "CHAT_PAGE_MISMATCH" : "PAIR_PARSE_REJECTED";
    plan.failureBoundary = { version: 1, browserClosed: true, step: "export_messages" };
  }
  const bytes = pair(options.listCount, options.messagesCount, options.invalidChat);
  for (const view of kind === "list" ? ["list"] as const : ["list", "messages"] as const) {
    const file = path.join(sourceDirectory, view === "list" ? "list.xlsx" : "messages.log");
    await writeFile(file, bytes[view]);
    plan.source[view] = { view, phase: "downloaded", savedPath: file, sourceCount: options.listCount ?? 2,
      sizeBytes: bytes[view].length, sha256: sha(bytes[view]), observedAt: "2026-10-30T02:04:00.000Z" };
  }
  // 11018 shape: B finished with persisted daily/proof material; no failureCode.
  // Target inspection must not mistake this for a failed source closure or
  // claim that C's independent full verification has already passed.
  if (kind === "executed") {
    plan.sourceCounts = { listRows: 2, logSessions: 2, ambiguous: 0 };
    plan.sourceSessionSha256 = sha(bytes.list); plan.sourceChatSha256 = sha(bytes.messages);
    plan.dailyFiles = [{ date: period.endDate, sessionSha256: sha(bytes.list), chatSha256: sha(bytes.messages), contentSha256: "c".repeat(64), conversationCount: 2 }];
    plan.proofs = [{ date: period.endDate } as CustomerServiceN8nPlan["proofs"][number]];
  }
  const planPath = path.join(directory, `${executionId}.json`), activePath = path.join(directory, "active.json");
  const save = () => writeFile(planPath, JSON.stringify(plan));
  await save(); await writeFile(activePath, JSON.stringify({ executionId }));
  return { root, store, plan, planPath, activePath, directory, sourceDirectory, save };
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) for (const [key, value] of Object.entries(await snapshot(file))) result[path.join(item.name, key)] = value;
    else result[item.name] = sha(await readFile(file));
  }
  return result;
}
test("11039 downloaded_list_only and 11018 executed_verify remain read-only candidates", async () => {
  for (const kind of ["list", "executed"] as const) {
    const f = await fixture(kind);
    try {
      const before = await snapshot(f.root);
      const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
      assert.equal(result.closeAllowed, true);
      assert.equal(result.target?.kind, kind === "list" ? "downloaded_list_only" : "executed_verify");
      assert.equal(result.target?.originalExecutionId, kind === "list" ? "11039" : "11018");
      assert.equal(result.target?.originalPlanSha256, sha(await readFile(f.planPath)));
      assert.equal(result.diagnostic, undefined);
      assert.deepEqual(await snapshot(f.root), before);
      if (kind === "executed") assert.match(result.reason, /原 C 验证/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("messages.log parsed count below the promised export count still closes", async () => {
  // JD's export confirmation count is a promise, not a ground truth; the real
  // log always parses to fewer sessions than promised. Below-promise must allow.
  const f = await fixture("pair", { messagesCount: 1 });
  try {
    const before = await snapshot(f.root);
    const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
    assert.equal(result.closeAllowed, true);
    assert.equal(result.target?.kind, "downloaded_pair");
    assert.equal(result.diagnostic, undefined);
    assert.deepEqual(await snapshot(f.root), before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("precise source rejections report only whitelisted categories, basenames and counts", async () => {
  for (const change of ["missing", "digest", "size", "checkpoint-count", "list-count", "messages-count-exceeds", "parse"] as const) {
    const f = await fixture("pair", change === "messages-count-exceeds" ? { messagesCount: 3 } : change === "parse" ? { invalidChat: true } : {});
    try {
      if (change === "missing") await rm(f.plan.source.messages!.savedPath!);
      if (change === "digest") f.plan.source.messages!.sha256 = "a".repeat(64);
      if (change === "size") f.plan.source.messages!.sizeBytes! += 1;
      if (change === "checkpoint-count") f.plan.source.messages!.sourceCount = 3;
      if (change === "list-count") for (const checkpoint of Object.values(f.plan.source)) checkpoint.sourceCount = 3;
      await f.save();
      const before = await snapshot(f.root);
      const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
      assert.equal(result.closeAllowed, false); assert.equal(result.target, undefined);
      const category = change === "missing" ? "file_missing" : change === "digest" ? "digest_mismatch" : change === "size" ? "size_mismatch" : change === "parse" ? "parse_rejected" : "count_mismatch";
      assert.equal(result.diagnostic?.category, category);
      const expected = change === "checkpoint-count" ? { category, file: "messages.log", expected: 2, actual: 3 }
        : change === "list-count" ? { category, file: "list.xlsx", expected: 3, actual: 2 }
        : change === "messages-count-exceeds" ? { category, file: "messages.log", expected: 2, actual: 3 }
        : change === "parse" ? { category } : { category, file: "messages.log" };
      assert.deepEqual(result.diagnostic, expected);
      assert.match(result.reason, new RegExp(category));
      assert.match(result.reason, change === "parse" ? /PAIR_FORMAT_INVALID/ : change === "missing" ? /CLOSE_SOURCE_EVIDENCE_INVALID/ : /SOURCE_RECOVERY_REJECTED_MANUAL_ACTION/);
      const publicResult = JSON.stringify(result);
      for (const secret of [f.root, f.sourceDirectory, "synthetic-customer-private", "synthetic-agent-private", "synthetic-chat-private", "Error:", "stack"]) assert.equal(publicResult.includes(secret), false);
      assert.deepEqual(await snapshot(f.root), before);
      await assert.rejects(inspectCustomerServiceCloseEvidence(f.root, f.plan), error => change === "missing"
        ? (error as NodeJS.ErrnoException).code === "ENOENT"
        : error instanceof JdCustomerServiceWorkflowError && error.code === (change === "parse" ? "PAIR_PARSE_REJECTED" : "SOURCE_RECOVERY_REJECTED_MANUAL_ACTION"));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("diagnostics do not loosen list-only failure boundary or file whitelist", async () => {
  for (const change of ["submitted", "extra-file"] as const) {
    const f = await fixture("list");
    try {
      if (change === "submitted") f.plan.source.messages = { view: "messages", phase: "submitted" };
      else await writeFile(path.join(f.sourceDirectory, "private-unexpected.txt"), "synthetic-chat-private");
      await f.save();
      const result = await readCustomerServiceCloseTarget(f.root, f.store.storeKey);
      assert.equal(result.closeAllowed, false);
      assert.equal(result.diagnostic?.category, change === "submitted" ? "boundary_invalid" : "directory_mismatch");
      assert.doesNotMatch(JSON.stringify(result), /private-unexpected|synthetic-chat-private/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("unknown errors and parse details keep the original safe code whitelist", () => {
  assert.equal(customerServiceCloseEvidenceCode(new Error("C:/private/synthetic-chat-private")), "CLOSE_SOURCE_EVIDENCE_INVALID");
  assert.equal(customerServiceCloseEvidenceCode(new JdCustomerServiceWorkflowError("PAIR_PARSE_REJECTED", "synthetic-chat-private")), "PAIR_FORMAT_INVALID");
  assert.equal(customerServiceCloseEvidenceCode(new JdCustomerServiceWorkflowError("PAIR_PARSE_REJECTED", "MESSAGE_CONTENT_LIMIT_EXCEEDED")), "MESSAGE_CONTENT_LIMIT_EXCEEDED");
});
