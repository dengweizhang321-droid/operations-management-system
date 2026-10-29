export type JackyunCloseIdentity = { logicalExecutionId: string; failedExecutionId: string; sourceExecutionId: string;
  planDigest: string; controlDigest: string; activeDigest: string; evidenceDigest: string };
export type JackyunCloseTarget = { ok: true; state: "empty" | "blocked" | "closable" | "closing" | "closed";
  closeAllowed: boolean; reason: string; target?: JackyunCloseIdentity; logicalExecutionId?: string;
  modules?: { module: string; status: string; batchId?: string }[]; authorizationId?: string; authorizationExpiresAt?: string };
export function validJackyunCloseIdentity(value: unknown): value is JackyunCloseIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as JackyunCloseIdentity;
  return Object.keys(v).sort().join() === ["logicalExecutionId", "failedExecutionId", "sourceExecutionId", "planDigest", "controlDigest", "activeDigest", "evidenceDigest"].sort().join()
    && [v.logicalExecutionId, v.failedExecutionId, v.sourceExecutionId].every(id => typeof id === "string" && /^[1-9]\d{0,19}$/.test(id))
    && BigInt(v.logicalExecutionId) <= BigInt(v.sourceExecutionId) && BigInt(v.sourceExecutionId) <= BigInt(v.failedExecutionId)
    && [v.planDigest, v.controlDigest, v.activeDigest, v.evidenceDigest].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h));
}
