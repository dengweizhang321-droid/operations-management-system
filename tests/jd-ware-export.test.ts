import assert from "node:assert/strict";
import test from "node:test";
import {
  newestCompletedJdWareExportTask,
  newestUnseenJdWareExportTask,
  isJdWareExportTaskCreatedNear,
  parseJdWareExportTaskRows,
  selectRecoverableJdWareExportTask,
  selectExistingJdWareExportTask,
  decideJdWareExportBaselineRecoveryAbandonment,
  unseenJdWareExportTasks,
} from "../lib/jd/ware-export";
import { advanceWareExportAudit, createWareExportAudit, hasStableJdWareTaskSnapshot, hasStableUniqueVisibleJdExportEntry, importSkuFile, isConfirmedJdWareTaskListEmptyState, isLikelyJdLoginPage, isTransientJdExportEntryRepaint, shouldDismissJdMenuUpdateNotice, wareActiveTaskPath } from "../tools/jackyun-ware-export";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("parses the JD export record table without confusing product rows for tasks", () => {
  const tasks = parseJdWareExportTaskRows([
    "志高开水器\n商品编码：14577459490\n2026-07-18 10:03:17\n上架中",
    "2026-07-19 20:00:09\n9371817\n已完成\n成功：1453\n下载",
    "2026-07-19 20:03:11\n9371818\n处理中\n-",
  ]);

  assert.deepEqual(tasks.map((task) => ({
    taskId: task.taskId,
    status: task.status,
    successRows: task.successRows,
  })), [
    { taskId: "9371818", status: "pending", successRows: null },
    { taskId: "9371817", status: "completed", successRows: 1453 },
  ]);
});

test("chooses the newly created task rather than an older completed download", () => {
  const tasks = parseJdWareExportTaskRows([
    "2026-07-19 20:03:11\n9371818\n处理中\n-",
    "2026-07-19 20:00:09\n9371817\n已完成\n成功：1453\n下载",
  ]);

  assert.equal(newestUnseenJdWareExportTask(tasks, new Set(["9371817"]))?.taskId, "9371818");
  assert.equal(newestCompletedJdWareExportTask(tasks)?.taskId, "9371817");
  assert.deepEqual(unseenJdWareExportTasks(tasks, new Set()).map((task) => task.taskId), ["9371818", "9371817"]);
});

test("takes over exactly one pending task before considering an older completed task", () => {
  const tasks = [
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: null, successRows: 1453, rowText: "completed" },
  ];
  const selection = selectExistingJdWareExportTask(tasks, true);
  assert.equal(selection.kind, "pending");
  if (selection.kind === "pending") assert.equal(selection.task.taskId, "9371818");
});

test("does not create or reuse when multiple pending export tasks exist", () => {
  const tasks = [
    { taskId: "9371819", status: "pending" as const, createdAt: "2026-07-19 20:04:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: null, successRows: 1453, rowText: "completed" },
  ];
  const selection = selectExistingJdWareExportTask(tasks, false);
  assert.equal(selection.kind, "ambiguous_pending");
  if (selection.kind === "ambiguous_pending") assert.deepEqual(selection.tasks.map((task) => task.taskId), ["9371819", "9371818"]);
});

test("recovers the exact timed-out task after it becomes completed", () => {
  const tasks = [
    { taskId: "9371818", status: "completed" as const, createdAt: "2026-07-19 20:03:11", resultText: "成功：1453", successRows: 1453, rowText: "completed" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    taskId: "9371818",
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "task");
  if (selection.kind === "task") assert.equal(selection.task.taskId, "9371818");
});

test("recovers one post-baseline task when the process stopped before learning its id", () => {
  const tasks = [
    { taskId: "9371818", status: "pending" as const, createdAt: "2026-07-19 20:03:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "task");
  if (selection.kind === "task") assert.equal(selection.task.taskId, "9371818");
});

test("filters post-baseline recovery candidates by the confirmation-time window", () => {
  const tasks = [
    { taskId: "9371819", status: "completed" as const, createdAt: "2026-07-19 20:10:11", resultText: "success", successRows: 10, rowText: "unrelated" },
    { taskId: "9371818", status: "completed" as const, createdAt: "2026-07-19 20:03:11", resultText: "success", successRows: 1453, rowText: "target" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "success", successRows: 1450, rowText: "baseline" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "task");
  if (selection.kind === "task") assert.equal(selection.task.taskId, "9371818");
});

test("converts JD Shanghai task timestamps before applying the recovery window", () => {
  assert.equal(isJdWareExportTaskCreatedNear("2026-07-19T12:03:10.000Z", "2026-07-19 20:03:11"), true);
  assert.equal(isJdWareExportTaskCreatedNear("2026-07-19T12:03:10.000Z", "2026-07-19 20:10:11"), false);
});

test("stops when a baseline-only recovery has multiple candidate tasks", () => {
  const tasks = [
    { taskId: "9371819", status: "pending" as const, createdAt: "2026-07-19 20:04:11", resultText: null, successRows: null, rowText: "pending" },
    { taskId: "9371818", status: "completed" as const, createdAt: "2026-07-19 20:03:11", resultText: "成功：1453", successRows: 1453, rowText: "completed" },
    { taskId: "9371817", status: "completed" as const, createdAt: "2026-07-19 20:00:09", resultText: "成功：1450", successRows: 1450, rowText: "older" },
  ];
  const selection = selectRecoverableJdWareExportTask(tasks, {
    version: 1,
    baselineTaskIds: ["9371817"],
    createdAt: "2026-07-19T12:03:10.000Z",
  });
  assert.equal(selection.kind, "ambiguous");
});

test("abandons only a stale baseline-only recovery with a confirmed snapshot and zero nearby candidates", () => {
  const recovery = { version: 1 as const, baselineTaskIds: ["old"], createdAt: "2026-08-07T01:33:00.000Z" };
  assert.equal(decideJdWareExportBaselineRecoveryAbandonment(recovery, [], true, Date.parse("2026-08-07T02:03:00.000Z")).kind, "abandon");
  assert.equal(decideJdWareExportBaselineRecoveryAbandonment({ ...recovery, taskId: "known" }, [], true, Date.parse("2026-08-07T03:00:00.000Z")).kind, "keep");
  assert.equal(decideJdWareExportBaselineRecoveryAbandonment(recovery, [], true, Date.parse("2026-08-07T01:50:00.000Z")).kind, "keep");
  assert.equal(decideJdWareExportBaselineRecoveryAbandonment(recovery, [], false, Date.parse("2026-08-07T03:00:00.000Z")).kind, "keep");
  assert.equal(decideJdWareExportBaselineRecoveryAbandonment(recovery, [{ taskId: "near", status: "pending", createdAt: "2026-08-07 09:33:10", resultText: null, successRows: null, rowText: "near" }], true, Date.parse("2026-08-07T03:00:00.000Z")).kind, "keep");
});

test("task-list baseline requires two stable nonempty snapshots or two explicit empty states", () => {
  const task = { taskId: "1", status: "completed" as const, createdAt: "2026-08-07 09:33:10", resultText: null, successRows: 1, rowText: "row" };
  assert.equal(hasStableJdWareTaskSnapshot([{ tasks: [], emptyConfirmed: false }, { tasks: [], emptyConfirmed: false }]), false);
  assert.equal(hasStableJdWareTaskSnapshot([{ tasks: [], emptyConfirmed: true }, { tasks: [], emptyConfirmed: true }]), true);
  assert.equal(hasStableJdWareTaskSnapshot([{ tasks: [task], emptyConfirmed: false }, { tasks: [task], emptyConfirmed: false }]), true);
  assert.equal(hasStableJdWareTaskSnapshot([{ tasks: [task], emptyConfirmed: false }, { tasks: [], emptyConfirmed: true }]), false);
  assert.equal(hasStableJdWareTaskSnapshot([{ tasks: [{ ...task, rowText: "first frame" }], emptyConfirmed: false }, { tasks: [{ ...task, rowText: "changed frame" }], emptyConfirmed: false }]), false);
});

test("confirms an empty task list only from the uniquely bound export container", () => {
  assert.equal(isConfirmedJdWareTaskListEmptyState({ uniqueRefresh: true, boundToExportContainer: true, containerText: "暂无记录" }), true);
  assert.equal(isConfirmedJdWareTaskListEmptyState({ uniqueRefresh: false, boundToExportContainer: true, containerText: "暂无记录" }), false);
  assert.equal(isConfirmedJdWareTaskListEmptyState({ uniqueRefresh: true, boundToExportContainer: false, containerText: "暂无记录" }), false);
  // A separate page section may say “暂无数据”; it cannot certify this export container.
  assert.equal(isConfirmedJdWareTaskListEmptyState({ uniqueRefresh: true, boundToExportContainer: true, containerText: "导出记录加载中" }), false);
});

test("menu-update overlay is dismissed only for one matching layer with a single exact 知道了 button", () => {
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "京麦菜单更新调整将于明日生效", buttons: ["知道了"] }]), true);
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "京麦菜单更新调整将于明日生效", buttons: ["立即查看"] }]), false);
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "京麦菜单更新调整将于明日生效", buttons: ["知道了", "立即查看"] }]), false);
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "京麦菜单更新调整将于明日生效", buttons: ["知道了"] }, { text: "导出查询商品", buttons: ["确认"] }]), true);
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "京麦菜单更新调整", buttons: ["知道了"] }]), false);
  assert.equal(shouldDismissJdMenuUpdateNotice([{ text: "一级菜单更新调整已生效", buttons: ["知道了"] }, { text: "一级菜单更新调整已生效", buttons: ["知道了"] }]), false);
});

test("preserves the task id in a timeout failure audit", () => {
  const running = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://localhost:3000", reuseLatest: false }), {
    stage: "wait_new_task", baselineTaskIds: ["9371817"], taskId: "9371818", taskStatus: "pending",
  });
  const failed = advanceWareExportAudit(running, { status: "failed", error: "等待京东导出任务 9371818 完成超时" });
  assert.deepEqual(
    { status: failed.status, stage: failed.stage, taskId: failed.taskId, baselineTaskIds: failed.baselineTaskIds },
    { status: "failed", stage: "wait_new_task", taskId: "9371818", baselineTaskIds: ["9371817"] },
  );
});

test("keeps the abandoned recovery evidence in the audit after later failure", () => {
  const abandoned = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://localhost:3000", reuseLatest: false }), {
    stage: "recovery_abandoned",
    recoveryArchivePath: "active-task-jd-yiyong-director.abandoned-1.json",
    recoveryCreatedAt: "2026-08-07T01:33:00.000Z",
  });
  const failed = advanceWareExportAudit(abandoned, { status: "failed", error: "audit write retry failed" });
  assert.deepEqual(
    { stage: failed.stage, recoveryArchivePath: failed.recoveryArchivePath, recoveryCreatedAt: failed.recoveryCreatedAt },
    { stage: "recovery_abandoned", recoveryArchivePath: "active-task-jd-yiyong-director.abandoned-1.json", recoveryCreatedAt: "2026-08-07T01:33:00.000Z" },
  );
});

test("a resolved export-button click is not reported as a submitted JD task", () => {
  const audit = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://localhost:3000", reuseLatest: false }), {
    stage: "task_click_invoked", baselineTaskIds: ["9371817"],
  });
  assert.deepEqual(
    { stage: audit.stage, taskId: audit.taskId, baselineTaskIds: audit.baselineTaskIds },
    { stage: "task_click_invoked", taskId: undefined, baselineTaskIds: ["9371817"] },
  );
});

test("retries the reversible export drawer action only for a JD repaint", () => {
  assert.equal(isTransientJdExportEntryRepaint(new Error("element is not stable; detached from the DOM")), true);
  assert.equal(isTransientJdExportEntryRepaint(new Error("intercepted by overlay")), false);
});

test("requires two consecutive unique visible export-entry samples", () => {
  assert.equal(hasStableUniqueVisibleJdExportEntry([1]), false);
  assert.equal(hasStableUniqueVisibleJdExportEntry([1, 0, 1]), false);
  assert.equal(hasStableUniqueVisibleJdExportEntry([0, 1, 1]), true);
});

test("records an auto-import failure audit after a rejected connection without browser startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  const initial = createWareExportAudit({ baseUrl: "http://127.0.0.1:3000", reuseLatest: false });
  const ready = advanceWareExportAudit(initial, {
    stage: "auto_import",
    taskId: "9371818",
    taskStatus: "completed",
    savedPath: workbook,
  });
  await assert.rejects(
    importSkuFile("http://127.0.0.1:3000", workbook, async () => { throw new Error("connect ECONNREFUSED"); }),
    /ECONNREFUSED/,
  );
  const failed = advanceWareExportAudit(ready, { status: "failed", error: "connect ECONNREFUSED" });
  assert.deepEqual(
    { status: failed.status, stage: failed.stage, taskId: failed.taskId, savedPath: failed.savedPath, baseUrl: failed.baseUrl },
    { status: "failed", stage: "auto_import", taskId: "9371818", savedPath: workbook, baseUrl: "http://127.0.0.1:3000" },
  );
});

test("records an auto-import HTTP 500 failure audit without browser startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  await assert.rejects(
    importSkuFile("http://127.0.0.1:3000", workbook, async () => new Response(JSON.stringify({ message: "server failed" }), { status: 500 })),
    /server failed/,
  );
  const failed = advanceWareExportAudit(createWareExportAudit({ baseUrl: "http://127.0.0.1:3000", reuseLatest: false }), {
    status: "failed", stage: "auto_import", taskId: "9371818", savedPath: workbook, error: "server failed",
  });
  assert.equal(failed.stage, "auto_import");
  assert.equal(failed.error, "server failed");
});

test("master auto-import rejects a successful HTTP response with another shop's batch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  await assert.rejects(
    importSkuFile("http://127.0.0.1:3000", workbook, "A店", async () => Response.json({ ok: true, status: "duplicate", batch: { id: "b", source: "jd_product_master", dataset: "product_master", platform: "京东", shopName: "B店", status: "completed", warningCount: 0, rowCount: 1 } })),
    /SKU 导入失败/,
  );
});

test("master import requires imported=201 and duplicate=200 exactly", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jd-ware-export-"));
  const workbook = path.join(directory, "task.xlsx");
  await writeFile(workbook, "not-a-real-workbook");
  const payload = { ok: true, status: "duplicate", batch: { id: "b", source: "jd_product_master", dataset: "product_master", platform: "京东", shopName: "A店", status: "completed", warningCount: 0, rowCount: 1 } };
  await assert.rejects(importSkuFile("http://127.0.0.1:3000", workbook, "A店", async () => Response.json(payload, { status: 201 })), /SKU 导入失败/);
});

test("per-store recovery manifests cannot collide and login redirects fail before export UI wait", () => {
  assert.notEqual(wareActiveTaskPath("store-a"), wareActiveTaskPath("store-b"));
  assert.equal(isLikelyJdLoginPage("https://passport.jd.com/login", "账号 登录"), true);
  assert.equal(isLikelyJdLoginPage("https://wares-jdm.jd.com/ware", "登录 批量操作 导出查询商品"), false);
  assert.equal(isLikelyJdLoginPage("https://wares-jdm.jd.com/ware", "账号中心 页面加载中"), false);
  assert.equal(isLikelyJdLoginPage("https://wares-jdm.jd.com/ware", "账号 密码 登录", true), true);
});
