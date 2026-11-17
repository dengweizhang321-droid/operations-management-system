import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, writeFileSync, fsyncSync } from "node:fs";
import path from "node:path";
import { assertRetryContextIdentity } from "./n8n-retry-context";
import { assertNoFreshRestart } from "./fresh-restart";

const reservationCapacity = 4096;

/** Reservations moved to `archive/<YYYY-MM>/` by tools/retry-reservation-archive.ts still count as "already reserved". */
function archivedReservationExists(directory: string, name: string) {
  const archive = path.join(directory, "archive");
  try {
    const stat = lstatSync(archive);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("linked_retry_reservation_path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  for (const month of readdirSync(archive)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const monthDirectory = path.join(archive, month);
    if (lstatSync(monthDirectory).isSymbolicLink()) throw new Error("linked_retry_reservation_path");
    try { lstatSync(path.join(monthDirectory, name)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error; }
  }
  return false;
}

/** True when the reservation exists at top level or was archived to archive/<YYYY-MM>/. Linked paths still throw. */
export function retryDispatchReservationExists(root: string, workflowId: string, failedExecutionId: string) {
  const directory = path.join(root, "outputs", "n8n-retry-dispatch");
  const name = `${workflowId}-${failedExecutionId}.json`;
  try { lstatSync(path.join(directory, name)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return archivedReservationExists(directory, name);
}

// Operational send intent, not a business-completion receipt. Never expires or
// auto-releases: response loss and dispatcher restart must not permit another POST.
export function reserveRetryDispatch(root: string, context: {
  workflowId: string; failedExecutionId: string; originalExecutionId: string; originalScheduledAt: string;
}, retryExecutionId: string) {
  assertRetryContextIdentity(context.workflowId, context.failedExecutionId);
  if (context.workflowId === "J8kY2mQ5vR7sT4pN") assertNoFreshRestart(root, [context.originalExecutionId, context.failedExecutionId]);
  if (!path.isAbsolute(root) || !/^[1-9]\d{0,19}$/.test(retryExecutionId)) throw new Error("invalid_retry_reservation");
  const directory = path.join(root, "outputs", "n8n-retry-dispatch");
  for (let cursor = directory; ; cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("linked_retry_reservation_path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  mkdirSync(directory, { recursive: true });
  // Capacity counts only top-level reservation files; archived months and other entries do not consume it.
  if (readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length >= reservationCapacity) {
    throw new Error("retry_reservation_capacity_manual_action");
  }
  const name = `${context.workflowId}-${context.failedExecutionId}.json`;
  if (archivedReservationExists(directory, name)) throw new Error("retry_already_reserved_manual_action");
  const file = path.join(directory, name);
  let fd: number;
  try { fd = openSync(file, "wx"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("retry_already_reserved_manual_action"); throw error; }
  try {
    writeFileSync(fd, JSON.stringify({ version: "teruisi-retry-dispatch-intent-v1", ...context, retryExecutionId, status: "reserved", createdAt: new Date().toISOString() }));
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return { ok: true, reservationStatus: "reserved", failedExecutionId: context.failedExecutionId, retryExecutionId };
}
