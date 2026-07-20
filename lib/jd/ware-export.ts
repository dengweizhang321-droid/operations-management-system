export type JdWareExportTaskStatus = "completed" | "pending" | "failed" | "unknown";

export type JdWareExportTask = {
  taskId: string;
  createdAt: string;
  status: JdWareExportTaskStatus;
  resultText: string | null;
  successRows: number | null;
  rowText: string;
};

function cleanLine(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function taskStatus(lines: readonly string[]): JdWareExportTaskStatus {
  const text = lines.join(" ");
  if (/失败|异常|已取消/.test(text)) return "failed";
  if (/已完成/.test(text)) return "completed";
  if (/处理中|执行中|导出中|排队|创建中|等待/.test(text)) return "pending";
  return "unknown";
}

/**
 * Parses only rows from JD's export-record table.  Product-table rows are
 * intentionally ignored because they do not include an export-task status.
 */
export function parseJdWareExportTaskRows(rows: readonly string[]): JdWareExportTask[] {
  const tasks = new Map<string, JdWareExportTask>();

  for (const row of rows) {
    const lines = row.split(/\r?\n/).map(cleanLine).filter(Boolean);
    const createdAt = lines.find((line) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(line));
    const status = taskStatus(lines);
    if (!createdAt || status === "unknown") continue;

    const taskId = lines.find((line) => /^\d{6,}$/.test(line));
    if (!taskId) continue;

    const resultText = lines.find((line) => /^(成功|失败|已导出|导出失败)[：:]/.test(line)) ?? null;
    const successRowsMatch = resultText?.match(/成功[：:]\s*(\d+)/);
    const task: JdWareExportTask = {
      taskId,
      createdAt,
      status,
      resultText,
      successRows: successRowsMatch ? Number(successRowsMatch[1]) : null,
      rowText: lines.join(" | "),
    };

    const existing = tasks.get(task.taskId);
    if (!existing || existing.createdAt < task.createdAt) tasks.set(task.taskId, task);
  }

  return [...tasks.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function newestUnseenJdWareExportTask(
  tasks: readonly JdWareExportTask[],
  previouslySeenTaskIds: ReadonlySet<string>,
) {
  return unseenJdWareExportTasks(tasks, previouslySeenTaskIds)[0] ?? null;
}

export function unseenJdWareExportTasks(
  tasks: readonly JdWareExportTask[],
  previouslySeenTaskIds: ReadonlySet<string>,
) {
  return tasks.filter((task) => !previouslySeenTaskIds.has(task.taskId));
}

export function newestCompletedJdWareExportTask(tasks: readonly JdWareExportTask[]) {
  return tasks.find((task) => task.status === "completed") ?? null;
}

export type ExistingJdWareExportTaskSelection =
  | { kind: "none" }
  | { kind: "pending"; task: JdWareExportTask }
  | { kind: "completed"; task: JdWareExportTask }
  | { kind: "ambiguous_pending"; tasks: readonly JdWareExportTask[] };

export type JdWareExportRecovery = {
  version: 1;
  baselineTaskIds: string[];
  taskId?: string;
  createdAt: string;
};

export type JdWareExportRecoverySelection =
  | { kind: "task"; task: JdWareExportTask }
  | { kind: "missing" }
  | { kind: "ambiguous"; tasks: readonly JdWareExportTask[] };

/** Resolve only the task durably associated with an interrupted submission. */
export function selectRecoverableJdWareExportTask(
  tasks: readonly JdWareExportTask[],
  recovery: JdWareExportRecovery,
): JdWareExportRecoverySelection {
  const matches = recovery.taskId
    ? tasks.filter((task) => task.taskId === recovery.taskId)
    : tasks.filter((task) => !recovery.baselineTaskIds.includes(task.taskId));
  if (matches.length > 1) return { kind: "ambiguous", tasks: matches };
  return matches[0] ? { kind: "task", task: matches[0] } : { kind: "missing" };
}

/**
 * Selects an existing task without ever silently ignoring an in-progress one.
 * A pending task is the only safe continuation target after a prior process
 * timed out: it has a stable JD task id, while a completed task may be older.
 */
export function selectExistingJdWareExportTask(
  tasks: readonly JdWareExportTask[],
  reuseLatest: boolean,
): ExistingJdWareExportTaskSelection {
  const pending = tasks.filter((task) => task.status === "pending");
  if (pending.length > 1) return { kind: "ambiguous_pending", tasks: pending };
  if (pending.length === 1) return { kind: "pending", task: pending[0] };

  if (!reuseLatest) return { kind: "none" };
  const completed = newestCompletedJdWareExportTask(tasks);
  return completed ? { kind: "completed", task: completed } : { kind: "none" };
}
