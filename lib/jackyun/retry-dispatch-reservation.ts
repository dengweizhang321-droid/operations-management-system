import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, writeFileSync, fsyncSync } from "node:fs";
import path from "node:path";
import { assertRetryContextIdentity } from "./n8n-retry-context";

// Operational send intent, not a business-completion receipt. Never expires or
// auto-releases: response loss and dispatcher restart must not permit another POST.
export function reserveRetryDispatch(root: string, context: {
  workflowId: string; failedExecutionId: string; originalExecutionId: string; originalScheduledAt: string;
}, retryExecutionId: string) {
  assertRetryContextIdentity(context.workflowId, context.failedExecutionId);
  if (!path.isAbsolute(root) || !/^[1-9]\d{0,19}$/.test(retryExecutionId)) throw new Error("invalid_retry_reservation");
  const directory = path.join(root, "outputs", "n8n-retry-dispatch");
  for (let cursor = directory; ; cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("linked_retry_reservation_path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length >= 4096) throw new Error("retry_reservation_capacity_manual_action");
  const file = path.join(directory, `${context.workflowId}-${context.failedExecutionId}.json`);
  let fd: number;
  try { fd = openSync(file, "wx"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("retry_already_reserved_manual_action"); throw error; }
  try {
    writeFileSync(fd, JSON.stringify({ version: "teruisi-retry-dispatch-intent-v1", ...context, retryExecutionId, status: "reserved", createdAt: new Date().toISOString() }));
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return { ok: true, reservationStatus: "reserved", failedExecutionId: context.failedExecutionId, retryExecutionId };
}
