import { ApiError } from "../http/api-error";
import { LEARNING_OPERATION_ID_RE, parseLearningReceipt, type LearningReceipt, type LearningResult } from "./learning-operation";

export type LearningState = {
  phase: "idle" | "submitting" | "confirming" | "unconfirmed" | "completed" | "failed" | "blocked";
  operationId?: string;
  message: string;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Options = {
  ownerEmail: string;
  storage: Storage;
  request: (operationId: string, method: "GET" | "POST", signal: AbortSignal) => Promise<unknown>;
  onState: (state: LearningState) => void;
  onCompleted: (result: LearningResult) => void;
  newId?: () => string;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function learningStorageKey(ownerEmail: string) {
  return `teruisi.workflow.learning.v1:${encodeURIComponent(ownerEmail.trim().toLowerCase())}`;
}

/** One operation per tab/account. Automatic recovery only performs GETs. */
export function createLearningOperationClient(options: Options) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const key = learningStorageKey(options.ownerEmail);
  let state: LearningState = { phase: "idle", message: "" };
  let disposed = false;
  let busy = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const publish = (next: LearningState) => { state = next; if (!disposed) options.onState(next); };
  const clearTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };

  try {
    if (!options.ownerEmail.trim()) throw new Error("missing owner");
    const raw = options.storage.getItem(key);
    if (raw !== null) {
      const record = JSON.parse(raw) as { version?: unknown; operationId?: unknown };
      if (!record || record.version !== 1 || typeof record.operationId !== "string" || !LEARNING_OPERATION_ID_RE.test(record.operationId)) throw new Error("invalid record");
      state = { phase: "confirming", operationId: record.operationId, message: "正在确认执行结果…" };
    }
  } catch {
    state = { phase: "blocked", message: "无法读取浏览器学习记录，请恢复浏览器存储后重新打开页面；尚未提交新的学习。" };
  }

  function settle(receipt: LearningReceipt) {
    if (receipt.status === "unconfirmed") return false;
    clearTimer();
    if (receipt.status === "completed") {
      const result = receipt.result;
      publish({ phase: "completed", operationId: receipt.operationId,
        message: `已扫描 ${result.scanned} 个吉客云货品，新增 ${result.added.length} 个监控代码，${result.ambiguous.length} 个多产品线命中未自动归类。` });
      // Data refresh failure must never turn a committed learning into a failed
      // write or cause it to be sent again.
      options.onCompleted(result);
    } else {
      publish({ phase: "failed", operationId: receipt.operationId, message: receipt.error });
    }
    return true;
  }

  async function run(method: "GET" | "POST") {
    if (disposed || busy || !state.operationId || state.phase === "blocked") return;
    const operationId = state.operationId;
    clearTimer(); busy = true;
    controller = new AbortController();
    const current = controller;
    // Browser deadlines only stop waiting; they do not prove server rollback.
    const deadline = setTimeout(() => current.abort(), 20_000);
    publish({ phase: method === "POST" ? "submitting" : "confirming", operationId,
      message: method === "POST" ? "正在学习新代码…" : "正在确认执行结果…" });
    let terminal = false;
    let accessBlocked = false;
    try {
      const value = await options.request(operationId, method, current.signal);
      if (disposed || current.signal.aborted) return;
      terminal = settle(parseLearningReceipt(value, operationId));
    } catch (error) {
      if (disposed) return;
      // An authorization loss keeps the original id and never exposes its
      // saved result to a newly signed-in account. It also stops polling.
      accessBlocked = error instanceof ApiError && (error.status === 401 || error.status === 403);
    } finally {
      clearTimeout(deadline); busy = false;
      if (controller === current) controller = undefined;
      if (!disposed && !terminal) {
        attempts += 1;
        const exhausted = attempts >= 8 || accessBlocked;
        publish({ phase: accessBlocked ? "blocked" : exhausted ? "unconfirmed" : "confirming", operationId,
          message: accessBlocked ? "账号权限已变化，原学习结果已保留，请使用原账号重新打开页面查询。"
            : exhausted ? "暂时无法确认学习结果。可查询结果；继续本次学习将沿用原操作，不会重复执行。"
              : "正在确认执行结果…连接恢复后会继续查询，请勿重复发起学习。" });
        if (!exhausted) timer = schedule(() => { timer = undefined; void run("GET"); }, Math.min(1000 * 2 ** (attempts - 1), 8000));
      }
    }
  }

  return {
    getState: () => state,
    restore() { publish(state); if (state.operationId && state.phase !== "blocked") void run("GET"); },
    async start() {
      if (disposed || busy || state.phase === "blocked" || state.phase === "confirming" || state.phase === "submitting") return;
      // A deliberate click after an unknown outcome reuses the saved id. Only
      // a confirmed terminal result permits creation of a different operation.
      if (state.phase !== "unconfirmed") {
        const operationId = (options.newId ?? (() => crypto.randomUUID()))();
        if (!LEARNING_OPERATION_ID_RE.test(operationId)) return;
        try { options.storage.setItem(key, JSON.stringify({ version: 1, operationId })); }
        catch {
          publish({ phase: "blocked", message: "浏览器无法保存本次学习记录，尚未提交。请允许浏览器存储后重新打开页面。" });
          return;
        }
        state = { phase: "submitting", operationId, message: "正在学习新代码…" };
      }
      attempts = 0;
      await run("POST");
    },
    confirm() {
      if (state.phase !== "confirming" && state.phase !== "unconfirmed") return;
      attempts = 0; void run("GET");
    },
    dispose() { disposed = true; clearTimer(); controller?.abort(); },
  };
}
