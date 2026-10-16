/** Shared wire contract for manual learning; independent of AI providers. */
export const LEARNING_PATH = "/api/workflow/new-product-lines/learn";
export const LEARNING_REQUEST_PREFIX = "workflow-learning:";
export const LEARNING_OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type LearningResult = { added: unknown[]; ambiguous: unknown[]; scanned: number };
export type LearningReceipt =
  | { operationId: string; status: "completed"; result: LearningResult }
  | { operationId: string; status: "failed"; error: string }
  | { operationId: string; status: "unconfirmed" };

export function learningOperationPath(operationId: string) {
  if (!LEARNING_OPERATION_ID_RE.test(operationId)) throw new Error("新品学习操作编号无效");
  return `${LEARNING_PATH}/operations/${operationId}`;
}

export function parseLearningReceipt(value: unknown, operationId: string): LearningReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("学习结果尚未确认");
  const row = value as Record<string, unknown>;
  if (row.operationId !== operationId) throw new Error("学习结果与本次操作不匹配");
  if (row.status === "unconfirmed") return { operationId, status: "unconfirmed" };
  if (row.status === "failed" && typeof row.error === "string" && row.error.length <= 2000) return { operationId, status: "failed", error: row.error };
  if (row.status === "completed" && row.result && typeof row.result === "object") {
    const result = row.result as Record<string, unknown>;
    if (Array.isArray(result.added) && result.added.length <= 1000 && Array.isArray(result.ambiguous) && result.ambiguous.length <= 1000
      && Number.isSafeInteger(result.scanned) && Number(result.scanned) >= 0) {
      return { operationId, status: "completed", result: result as LearningResult };
    }
  }
  throw new Error("学习结果尚未确认");
}
