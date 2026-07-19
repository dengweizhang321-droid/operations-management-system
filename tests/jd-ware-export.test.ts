import assert from "node:assert/strict";
import test from "node:test";
import {
  newestCompletedJdWareExportTask,
  newestUnseenJdWareExportTask,
  parseJdWareExportTaskRows,
  unseenJdWareExportTasks,
} from "../lib/jd/ware-export";

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
