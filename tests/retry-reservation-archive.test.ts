import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { reserveRetryDispatch } from "../lib/jackyun/retry-dispatch-reservation";
import {
  RetryReservationArchiveRefusal,
  archiveRetryReservations,
  inspectRetryReservations,
} from "../tools/retry-reservation-archive-core";

const WORKFLOW = "TmallLiliDaily2026";
const now = new Date("2026-11-17T00:00:00Z");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "retry-archive-"));
  const directory = path.join(root, "outputs", "n8n-retry-dispatch");
  mkdirSync(directory, { recursive: true });
  const put = (failedExecutionId: string, createdAt: string | undefined, extra: object = {}) => {
    const name = `${WORKFLOW}-${failedExecutionId}.json`;
    writeFileSync(path.join(directory, name), JSON.stringify({
      version: "teruisi-retry-dispatch-intent-v1", workflowId: WORKFLOW, failedExecutionId, originalExecutionId: "1", originalScheduledAt: "2026-09-01T00:00:00Z",
      retryExecutionId: "9", status: "reserved", ...(createdAt ? { createdAt } : {}), ...extra,
    }));
    return name;
  };
  const context = (failedExecutionId: string) => ({ workflowId: WORKFLOW, failedExecutionId, originalExecutionId: "1", originalScheduledAt: "2026-09-01T00:00:00Z" });
  return { root, directory, put, context, top: () => readdirSync(directory).filter((n) => n.endsWith(".json")).sort(), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
async function refusal(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RetryReservationArchiveRefusal && error.reason === reason, reason);
}
const confirm = (directory: string, extra: object = {}) => ({ directory, operatorConfirmed: true, reason: "月度归档旧预留", now, ...extra });

test("an archived reservation still blocks the same failure, other failures reserve normally", async () => {
  const x = setup();
  try {
    x.put("100", "2026-09-05T10:00:00.000Z");
    x.put("101", "2026-11-16T10:00:00.000Z");
    const result = await archiveRetryReservations(confirm(x.directory, { olderThanDays: 30 }));
    assert.equal(result.stage, "archived");
    assert.equal((result as { moved: number }).moved, 1);
    assert.equal(existsSync(path.join(x.directory, "archive", "2026-09", `${WORKFLOW}-100.json`)), true);
    assert.deepEqual(x.top(), [`${WORKFLOW}-101.json`]);
    assert.throws(() => reserveRetryDispatch(x.root, x.context("100"), "50"), /retry_already_reserved_manual_action/);
    assert.equal(existsSync(path.join(x.directory, `${WORKFLOW}-100.json`)), false);
    assert.throws(() => reserveRetryDispatch(x.root, x.context("101"), "50"), /retry_already_reserved_manual_action/);
    assert.equal(reserveRetryDispatch(x.root, x.context("102"), "51").reservationStatus, "reserved");
  } finally { x.cleanup(); }
});

test("reserve ignores non-month archive entries but refuses linked archive paths", () => {
  const x = setup();
  try {
    mkdirSync(path.join(x.directory, "archive", "not-a-month"), { recursive: true });
    writeFileSync(path.join(x.directory, "archive", "not-a-month", `${WORKFLOW}-7.json`), "{}");
    assert.equal(reserveRetryDispatch(x.root, x.context("7"), "1").reservationStatus, "reserved");
    const target = mkdtempSync(path.join(tmpdir(), "retry-archive-target-"));
    try {
      mkdirSync(path.join(x.directory, "archive"), { recursive: true });
      symlinkSync(target, path.join(x.directory, "archive", "2026-08"), "junction");
      assert.throws(() => reserveRetryDispatch(x.root, x.context("8"), "2"), /linked_retry_reservation_path/);
    } finally { rmSync(target, { recursive: true, force: true }); }
  } finally { x.cleanup(); }
});

test("reserve refuses a linked archive directory", () => {
  const x = setup();
  const target = mkdtempSync(path.join(tmpdir(), "retry-archive-target-"));
  try {
    symlinkSync(target, path.join(x.directory, "archive"), "junction");
    assert.throws(() => reserveRetryDispatch(x.root, x.context("9"), "1"), /linked_retry_reservation_path/);
  } finally { rmSync(target, { recursive: true, force: true }); x.cleanup(); }
});

test("capacity counts only top-level json files", () => {
  const x = setup();
  try {
    mkdirSync(path.join(x.directory, "archive", "2026-09"), { recursive: true });
    for (let i = 0; i < 4100; i += 1) writeFileSync(path.join(x.directory, "archive", "2026-09", `${WORKFLOW}-${i + 1000}.json`), "{}");
    for (let i = 0; i < 4095; i += 1) writeFileSync(path.join(x.directory, `${WORKFLOW}-${i + 1}.json`), "{}");
    writeFileSync(path.join(x.directory, "notes.txt"), "not counted");
    assert.equal(reserveRetryDispatch(x.root, x.context("90000"), "1").reservationStatus, "reserved");
    assert.throws(() => reserveRetryDispatch(x.root, x.context("90001"), "2"), /retry_reservation_capacity_manual_action/);
  } finally { x.cleanup(); }
});

test("older-than-days has a floor of 14 and defaults to 30", async () => {
  const x = setup();
  try {
    x.put("1", "2026-10-20T00:00:00.000Z"); // 28 days old
    for (const bad of [13, 0, -1, 14.5, Number.NaN]) {
      await refusal(archiveRetryReservations(confirm(x.directory, { olderThanDays: bad })), "older_than_days_invalid");
    }
    const byDefault = await archiveRetryReservations({ directory: x.directory, dryRun: true, now });
    assert.equal((byDefault as { olderThanDays: number }).olderThanDays, 30);
    assert.deepEqual((byDefault as { wouldMove: unknown[] }).wouldMove, []);
    const fourteen = await archiveRetryReservations({ directory: x.directory, dryRun: true, olderThanDays: 14, now });
    assert.equal((fourteen as { wouldMove: unknown[] }).wouldMove.length, 1);
  } finally { x.cleanup(); }
});

test("reservations with missing or invalid createdAt are skipped and listed", async () => {
  const x = setup();
  try {
    x.put("1", undefined);
    x.put("2", "not-a-date");
    x.put("3", "2026-09-01T00:00:00.000Z", { failedExecutionId: "999" });
    writeFileSync(path.join(x.directory, `${WORKFLOW}-4.json`), "not json");
    x.put("5", "2026-09-01T00:00:00.000Z");
    const result = await archiveRetryReservations(confirm(x.directory)) as { moved: number; skipped: Array<{ name: string; reason: string }> };
    assert.equal(result.moved, 1);
    assert.deepEqual(result.skipped.map((s) => [s.name, s.reason]).sort(), [
      [`${WORKFLOW}-1.json`, "createdAt_missing_or_invalid"], [`${WORKFLOW}-2.json`, "createdAt_missing_or_invalid"],
      [`${WORKFLOW}-3.json`, "name_content_mismatch"], [`${WORKFLOW}-4.json`, "json_invalid"],
    ]);
    assert.equal(x.top().length, 4);
  } finally { x.cleanup(); }
});

test("dry-run and inspect write nothing; months are grouped by createdAt", async () => {
  const x = setup();
  try {
    x.put("1", "2026-09-05T10:00:00.000Z");
    x.put("2", "2026-10-05T10:00:00.000Z");
    x.put("3", "2026-11-16T10:00:00.000Z");
    const snapshot = () => JSON.stringify(readdirSync(x.directory, { recursive: true }).sort());
    const before = snapshot();
    const dry = await archiveRetryReservations({ directory: x.directory, dryRun: true, olderThanDays: 14, now }) as { stage: string; wouldMove: Array<{ month: string }> };
    assert.equal(dry.stage, "dry_run");
    assert.deepEqual(dry.wouldMove.map((item) => item.month), ["2026-09", "2026-10"]);
    const info = await inspectRetryReservations({ directory: x.directory });
    assert.equal(info.topLevelCount, 3);
    assert.equal(info.archivedCount, 0);
    assert.equal(info.oldestCreatedAt, "2026-09-05T10:00:00.000Z");
    assert.equal(info.newestCreatedAt, "2026-11-16T10:00:00.000Z");
    assert.equal(info.months["2026-10"]!.topLevel, 1);
    assert.equal(snapshot(), before);
    await refusal(archiveRetryReservations({ directory: x.directory, now }), "not_confirmed");
    await refusal(archiveRetryReservations(confirm(x.directory, { reason: "短" })), "reason_length");
    await refusal(archiveRetryReservations(confirm(x.directory, { dryRun: true })), "mode_conflict");
    assert.equal(snapshot(), before);
  } finally { x.cleanup(); }
});

test("an identical existing target counts as done; a different one stops the run and is reported", async () => {
  const x = setup();
  try {
    const a = x.put("1", "2026-09-05T10:00:00.000Z");
    const b = x.put("2", "2026-09-06T10:00:00.000Z");
    const c = x.put("3", "2026-09-07T10:00:00.000Z");
    const month = path.join(x.directory, "archive", "2026-09");
    mkdirSync(month, { recursive: true });
    writeFileSync(path.join(month, a), readFileSync(path.join(x.directory, a)));
    writeFileSync(path.join(month, b), "different bytes");
    const result = await archiveRetryReservations(confirm(x.directory)) as { ok: boolean; stage: string; alreadyArchived: number; moved: number; conflict: { name: string } | null };
    assert.equal(result.ok, false);
    assert.equal(result.stage, "stopped");
    assert.equal(result.alreadyArchived, 1);
    assert.equal(result.moved, 0);
    assert.equal(result.conflict?.name, b);
    assert.equal(readFileSync(path.join(month, b), "utf8"), "different bytes");
    assert.deepEqual(x.top(), [b, c]);
    assert.equal(existsSync(path.join(month, a)), true);
  } finally { x.cleanup(); }
});

test("a linked archive or month directory is refused before any write", async () => {
  const x = setup();
  const target = mkdtempSync(path.join(tmpdir(), "retry-archive-target-"));
  try {
    x.put("1", "2026-09-05T10:00:00.000Z");
    symlinkSync(target, path.join(x.directory, "archive"), "junction");
    await refusal(archiveRetryReservations(confirm(x.directory)), "archive_directory_linked");
    await refusal(archiveRetryReservations({ directory: x.directory, dryRun: true, now }), "archive_directory_linked");
    await refusal(inspectRetryReservations({ directory: x.directory }), "archive_directory_linked");
    rmSync(path.join(x.directory, "archive"), { recursive: true, force: true });
    mkdirSync(path.join(x.directory, "archive"));
    symlinkSync(target, path.join(x.directory, "archive", "2026-09"), "junction");
    await refusal(archiveRetryReservations(confirm(x.directory)), "archive_month_linked");
    assert.deepEqual(x.top(), [`${WORKFLOW}-1.json`]);
    assert.deepEqual(readdirSync(target), []);
  } finally { rmSync(target, { recursive: true, force: true }); x.cleanup(); }
});

test("confirm appends an audit line and moves exact bytes", async () => {
  const x = setup();
  try {
    const name = x.put("1", "2026-09-05T10:00:00.000Z");
    const original = readFileSync(path.join(x.directory, name));
    await archiveRetryReservations(confirm(x.directory));
    assert.deepEqual(readFileSync(path.join(x.directory, "archive", "2026-09", name)), original);
    const log = readFileSync(path.join(x.directory, "archive", "archive-log.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(log.length, 1);
    assert.equal(log[0].moved, 1);
    assert.equal(statSync(path.join(x.directory, "archive")).isDirectory(), true);
  } finally { x.cleanup(); }
});

test("Jackyun retry budget still sees an archived original reservation", async () => {
  const { reserveJackyunFailureRetry } = await import("../lib/jackyun/retry-budget");
  const { retryDispatchReservationExists } = await import("../lib/jackyun/retry-dispatch-reservation");
  const x = setup();
  try {
    const workflowId = "J8kY2mQ5vR7sT4pN";
    const context = { workflowId, originalExecutionId: "8548", failedExecutionId: "8548", originalScheduledAt: "2026-10-13T00:00:00.000Z" };
    const options = { failedStoppedAt: "2026-10-13T00:00:10.000Z", now: "2026-10-13T01:00:10.000Z", lockDirectory: path.join(x.root, "lock") };
    assert.equal(retryDispatchReservationExists(x.root, workflowId, "8548"), false);
    const name = `${workflowId}-8548.json`;
    mkdirSync(path.join(x.directory, "archive", "2026-10"), { recursive: true });
    writeFileSync(path.join(x.directory, "archive", "2026-10", name), "{}");
    assert.equal(retryDispatchReservationExists(x.root, workflowId, "8548"), true);
    await assert.rejects(reserveJackyunFailureRetry(x.root, context, "8550", options), /原版本已有重试派发记录/);
    // Top-level reservation is still seen too.
    writeFileSync(path.join(x.directory, `${workflowId}-8600.json`), "{}");
    assert.equal(retryDispatchReservationExists(x.root, workflowId, "8600"), true);
  } finally { x.cleanup(); }
});
