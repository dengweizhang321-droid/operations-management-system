import path from "node:path";
import { assertNoOperatorClosure, closeRecord } from "./operator-close-fence";
import { n8nJackyunRequiresRecoveryHeader, readN8nJackyunOriginalPlanContext, readN8nJackyunRecoveryEntry } from "./n8n-preflight-evidence";

/** Caller headers cannot conceal the persisted logical target/authorization. */
export function assertJackyunCloseAdmission(root: string, executionId: string) {
  const ids = [executionId];
  if (n8nJackyunRequiresRecoveryHeader(executionId, true)) {
    const captured: { humanAuthorizationId?: string } = {};
    const entry = readN8nJackyunRecoveryEntry(executionId, { allowTerminal: true, captureDispatch: captured });
    if (entry.kind === "retry") ids.push(entry.logicalExecutionId, entry.failedExecutionId);
    if (captured.humanAuthorizationId) {
      const bound = closeRecord(path.join(root, "outputs/jackyun-export-first/human-authorizations", `${captured.humanAuthorizationId}.json`));
      if (bound?.status === "revoked") throw new Error("JACKYUN_OPERATOR_CLOSED：原人工派发已撤销，禁止重放。");
    }
  } else ids.push(readN8nJackyunOriginalPlanContext(executionId).originalExecutionId);
  assertNoOperatorClosure(root, ids);
}
