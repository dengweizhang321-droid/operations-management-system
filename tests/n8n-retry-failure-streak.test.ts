import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { hourlyRetrySameFailureStopThreshold } from "../tools/n8n-hourly-retry-policy.mjs";
import { stringify } from "flatted";
import { computeFailureStreak, failureFingerprint, normalizeFailureText, type FailureStreakRow } from "../lib/jackyun/n8n-retry-failure-streak";
import { queryN8nFailureStreak } from "../lib/jackyun/n8n-preflight-evidence";

const message = "The service was not able to process your request";
const lili = { workflowId: "TmallLiliDaily2026", lastNodeExecuted: "P·直连创建商品报表、下载、汇总导入并回查", message, description: "天猫商品报表计划维度包含非商品主体，拒绝汇总" };
const tuofeng = { workflowId: "TmallTuofengDaily2026", lastNodeExecuted: "M·MTOP 分批导出、合并校验并导入", message, description: "天猫分批商品 XLSX 的商品 ID 集合与提交批次不一致" };

test("normalization erases volatile parts so the same failure fingerprints equally", () => {
  const a = { ...lili, description: "导出失败 execution 123456 at 2026-11-16T01:02:03.456Z after 30012ms\nCall log:\n  - waiting 1" };
  const b = { ...lili, description: "导出失败 execution 987654 at 2026-11-17 09:10:11 after 45099ms\nCall log:\n  - something else entirely" };
  assert.equal(failureFingerprint(a), failureFingerprint(b));
  assert.equal(failureFingerprint({ ...a, description: "x \x1b[31mred\x1b[39m 2026-11-16" }), failureFingerprint({ ...a, description: "x [31mred[39m 2026-11-17" }));
  assert.equal(normalizeFailureText("id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 hash deadbeefcafe1234"), "id <uuid> hash <hex>");
  assert.equal(normalizeFailureText("a\n====\nnoise 1"), "a");
  assert.equal(normalizeFailureText("x".repeat(3000)).length, 1024);
});

test("fingerprint distinguishes node, description, workflow and short numbers; empty text has none", () => {
  const base = failureFingerprint(lili)!;
  assert.match(base, /^[0-9a-f]{32}$/);
  assert.notEqual(base, failureFingerprint({ ...lili, lastNodeExecuted: "other" }));
  assert.notEqual(base, failureFingerprint({ ...lili, description: "另一个原因" }));
  assert.notEqual(base, failureFingerprint({ ...lili, workflowId: "TmallTuofengDaily2026" }));
  assert.notEqual(failureFingerprint({ ...lili, description: "第 3 页返回 0 行" }), failureFingerprint({ ...lili, description: "第 6 页返回 0 行" }));
  assert.notEqual(failureFingerprint(lili), failureFingerprint(tuofeng));
  assert.equal(failureFingerprint({ ...lili, message: "", description: " \n" }), null);
});

const row = (id: number, status: string, mode: string, fingerprint: string | null = "F"): FailureStreakRow => ({ id: String(id), status, mode, fingerprint });
const bad = (id: number, fp: string | null = "F") => row(id, "error", "trigger", fp);

test("streak counts consecutive same-fingerprint automatic failures", () => {
  assert.deepEqual(computeFailureStreak([bad(9), bad(8), bad(7), bad(6)], "9", 3), { consecutive: 3, stop: true, fingerprint: "F" });
  assert.deepEqual(computeFailureStreak([bad(9), bad(8)], "9", 3), { consecutive: 2, stop: false, fingerprint: "F" });
  assert.equal(computeFailureStreak([bad(9), row(8, "crashed", "webhook"), bad(7)], "9", 3).stop, true);
  assert.equal(computeFailureStreak([bad(12), bad(11), bad(9), bad(8)], "9", 3).consecutive, 2, "newer rows are ignored");
});

test("success clears, other-mode noise is skipped, other fingerprints and canceled end the streak", () => {
  assert.equal(computeFailureStreak([bad(9), bad(8), row(7, "success", "trigger"), bad(6)], "9", 3).consecutive, 2);
  assert.equal(computeFailureStreak([bad(9), bad(8), row(7, "success", "manual"), bad(6)], "9", 3).consecutive, 2);
  assert.equal(computeFailureStreak([bad(9), row(8, "error", "manual"), bad(7), row(6, "running", "trigger"), bad(5)], "9", 3).stop, true);
  assert.equal(computeFailureStreak([bad(9), bad(8, "G"), bad(7), bad(6)], "9", 3).consecutive, 1);
  assert.equal(computeFailureStreak([bad(9), row(8, "canceled", "trigger"), bad(7), bad(6)], "9", 3).consecutive, 1);
  assert.equal(computeFailureStreak([bad(9), bad(8, null), bad(7), bad(6)], "9", 3).consecutive, 1);
  assert.equal(computeFailureStreak([bad(9), row(8, "canceled", "manual"), bad(7), bad(6)], "9", 3).stop, true);
});

test("failed row must exist, be an automatic failure and have a fingerprint", () => {
  const zero = { consecutive: 0, stop: false, fingerprint: null };
  assert.deepEqual(computeFailureStreak([bad(8), bad(7), bad(6)], "9", 3), zero);
  assert.deepEqual(computeFailureStreak([row(9, "success", "trigger"), bad(8), bad(7)], "9", 3), zero);
  assert.deepEqual(computeFailureStreak([row(9, "error", "manual"), bad(8), bad(7)], "9", 3), zero);
  assert.deepEqual(computeFailureStreak([bad(9, null), bad(8, null), bad(7, null)], "9", 3), zero);
});

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE execution_entity (id INTEGER PRIMARY KEY, workflowId TEXT, status TEXT, mode TEXT, deletedAt TEXT); CREATE TABLE execution_data (executionId INTEGER, data TEXT)");
  const add = (id: number, status: string, mode: string, error?: { node: string; message: string; description: string }, deletedAt: string | null = null, workflowId = lili.workflowId) => {
    db.prepare("INSERT INTO execution_entity VALUES (?,?,?,?,?)").run(id, workflowId, status, mode, deletedAt);
    if (error) db.prepare("INSERT INTO execution_data VALUES (?,?)").run(id, stringify({ resultData: { lastNodeExecuted: error.node, error: { message: error.message, description: error.description, stack: `s${id}` }, runData: {} } }));
  };
  return { db, add };
}

test("database layer scans n8n history with numeric ids, deletion and per-workflow isolation", () => {
  const { db, add } = memoryDb();
  const err = (id: number, description = lili.description) => ({ node: lili.lastNodeExecuted, message, description: `${description} execution ${id}00000` });
  add(5, "error", "trigger", err(5, "旧的别的原因"));
  add(9, "error", "trigger", err(9));
  add(10, "error", "webhook", err(10));
  add(11, "error", "trigger", err(11));
  add(12, "error", "trigger", err(12), "2026-11-17");
  add(13, "error", "trigger", err(13), null, "TmallTuofengDaily2026");
  const result = queryN8nFailureStreak(db, lili.workflowId, "11", 3);
  assert.equal(result.consecutive, 3);
  assert.equal(result.stop, true);
  assert.equal(result.version, "teruisi-retry-failure-streak-v1");
  assert.equal(result.fingerprint, failureFingerprint({ ...lili, description: `${lili.description} execution 1100000` }));
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "10", 3).consecutive, 2, "ids compare numerically, newer rows ignored");
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "12", 3).consecutive, 0, "deleted failed row");
  add(14, "success", "trigger");
  add(15, "error", "trigger", err(15));
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "15", 3).consecutive, 1);
  db.close();
});

test("unreadable stored data ends the streak conservatively", () => {
  const { db, add } = memoryDb();
  const good = { node: lili.lastNodeExecuted, message, description: lili.description };
  add(1, "error", "trigger", good);
  add(2, "error", "trigger", good);
  add(3, "error", "trigger");
  db.prepare("INSERT INTO execution_data VALUES (?,?)").run(3, "not json");
  add(4, "error", "trigger", good);
  add(5, "error", "trigger", good);
  add(6, "error", "trigger", good);
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "6", 3).stop, true);
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "4", 3).consecutive, 1);
  db.prepare("DELETE FROM execution_data WHERE executionId=4").run();
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "4", 3).fingerprint, null);
  db.close();
});

test("default threshold: three identical failures do not stop, four do", () => {
  assert.equal(hourlyRetrySameFailureStopThreshold, 4);
  assert.deepEqual(computeFailureStreak([bad(9), bad(8), bad(7), row(6, "success", "trigger")], "9"), { consecutive: 3, stop: false, fingerprint: "F" });
  assert.equal(computeFailureStreak([bad(9), bad(8), bad(7), bad(6), bad(5)], "9").stop, true);
});

test("alert wording names the same threshold as the policy constant", () => {
  const script = readFileSync(new URL("../tools/n8n-manual-action-alert.ps1", import.meta.url), "utf8");
  const line = script.split(/\r?\n/).find(text => text.includes("manual_action_repeated_failure=@("));
  assert.ok(line, "hint line present");
  assert.ok(line!.includes(`${hourlyRetrySameFailureStopThreshold} 次`));
});

test("a newer successful execution of the workflow suppresses the stop but keeps the fingerprint", () => {
  const { db, add } = memoryDb();
  const good = { node: lili.lastNodeExecuted, message, description: lili.description };
  for (const id of [1, 2, 3, 4]) add(id, "error", "trigger", good);
  assert.equal(queryN8nFailureStreak(db, lili.workflowId, "4").stop, true);
  add(5, "success", "manual", undefined, "2026-11-17");
  add(6, "success", "trigger", undefined, null, "TmallTuofengDaily2026");
  const unaffected = queryN8nFailureStreak(db, lili.workflowId, "4");
  assert.equal(unaffected.stop, true, "deleted or other-workflow successes do not count");
  add(7, "success", "manual");
  const suppressed = queryN8nFailureStreak(db, lili.workflowId, "4");
  assert.equal(suppressed.consecutive, 0);
  assert.equal(suppressed.stop, false);
  assert.equal(suppressed.fingerprint, unaffected.fingerprint);
  db.close();
});
