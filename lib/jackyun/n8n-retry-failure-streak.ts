import { createHash } from "node:crypto";
import { hourlyRetrySameFailureStopThreshold } from "../../tools/n8n-hourly-retry-policy.mjs";

export const retryFailureStreakProtocol = "teruisi-retry-failure-streak-v1";
export const retryFailureStreakThreshold: number = hourlyRetrySameFailureStopThreshold;

/** Strips volatile parts (ids, timestamps, durations, Playwright call logs) so
 * the same deterministic failure text normalizes identically across runs. */
export function normalizeFailureText(text: string): string {
  let value = String(text ?? "");
  value = value.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[\d+(?:;\d+)*m/g, "");
  const cuts = [value.indexOf("\nCall log:"), value.indexOf("\n====")].filter(index => index >= 0);
  if (cuts.length) value = value.slice(0, Math.min(...cuts));
  value = value
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>")
    .replace(/\b[0-9a-fA-F]{12,}\b/g, "<hex>")
    .replace(/\d{4,}/g, "<n>");
  return value.replace(/\s+/g, " ").trim().slice(0, 1024);
}

export function failureFingerprint(input: { workflowId: string; lastNodeExecuted: string; message: string; description: string }): string | null {
  const message = normalizeFailureText(input.message), description = normalizeFailureText(input.description);
  if (!message && !description) return null;
  return createHash("sha256").update(JSON.stringify(["teruisi-retry-failure-fingerprint-v1", input.workflowId, input.lastNodeExecuted, message, description]))
    .digest("hex").slice(0, 32);
}

export type FailureStreakRow = { id: string; status: string; mode: string; fingerprint: string | null };
const automatic = (mode: string) => mode === "trigger" || mode === "webhook";
const failed = (status: string) => status === "error" || status === "crashed";

/** Rows: one workflow, id descending. Pure; n8n's execution history is the ledger. */
export function computeFailureStreak(rows: FailureStreakRow[], failedExecutionId: string, threshold: number = retryFailureStreakThreshold) {
  const at = rows.findIndex(row => row.id === failedExecutionId);
  const head = at >= 0 ? rows[at]! : null;
  if (!head || !failed(head.status) || !automatic(head.mode) || head.fingerprint === null) return { consecutive: 0, stop: false, fingerprint: null as string | null };
  const fingerprint = head.fingerprint;
  let consecutive = 1;
  for (const row of rows.slice(at + 1)) {
    if (consecutive >= threshold) break;
    if (row.status === "success") break;
    if (automatic(row.mode) && row.status === "canceled") break;
    if (automatic(row.mode) && failed(row.status)) {
      if (row.fingerprint !== null && row.fingerprint === fingerprint) { consecutive += 1; continue; }
      break;
    }
  }
  return { consecutive, stop: consecutive >= threshold, fingerprint };
}
