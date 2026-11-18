import path from "node:path";
import { assertNoOperatorClosure, closeRecord } from "./operator-close-fence";
import { readN8nJackyunRecoveryEntry } from "./n8n-preflight-evidence";

/** Caller headers cannot conceal the persisted logical target/authorization.
 *
 * Every execution is judged by its persisted fixed recovery entry. This used to
 * branch on workflowData.meta.jackyunRecovery, but the live n8n execution record
 * never stores workflow meta, so that test was always false and sent every
 * continuation (an anchor pointing at the original run) down a legacy path that
 * demands anchor == self. An unreadable entry still throws (fail closed). */
export function assertJackyunCloseAdmission(root: string, executionId: string) {
  const ids = [executionId];
  const captured: { humanAuthorizationId?: string } = {};
  const entry = readN8nJackyunRecoveryEntry(executionId, { allowTerminal: true, captureDispatch: captured });
  if (entry.kind === "retry") ids.push(entry.logicalExecutionId, entry.failedExecutionId);
  if (captured.humanAuthorizationId) {
    const bound = closeRecord(path.join(root, "outputs/jackyun-export-first/human-authorizations", `${captured.humanAuthorizationId}.json`));
    if (bound?.status === "revoked") throw new Error("JACKYUN_OPERATOR_CLOSED：原人工派发已撤销，禁止重放。");
  }
  assertNoOperatorClosure(root, ids);
}
