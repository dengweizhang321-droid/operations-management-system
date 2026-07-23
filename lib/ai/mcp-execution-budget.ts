export type BudgetedBatchStopReason = "item_timeout" | "total_budget" | "prior_timeout";

export type CooperativeTimeoutResult<T> = {
  value: T;
  timedOut: boolean;
};

/**
 * Abort is cooperative: after signalling it, this function still waits for the
 * underlying operation to settle. That prevents a timed-out D1 request from
 * becoming untracked background work while the next batch item starts.
 */
export async function runWithCooperativeTimeout<T>(input: {
  timeoutMs: number;
  operation: (signal: AbortSignal) => Promise<T>;
  onTimeout: () => T;
}): Promise<CooperativeTimeoutResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("operation_timeout"));
  }, Math.max(1, input.timeoutMs));
  try {
    const value = await input.operation(controller.signal);
    return { value: timedOut ? input.onTimeout() : value, timedOut };
  } catch (error) {
    if (timedOut) return { value: input.onTimeout(), timedOut: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runSequentialBatchWithinBudget<Item, Result>(input: {
  items: readonly Item[];
  totalBudgetMs: number;
  perItemTimeoutMs: number;
  operation: (item: Item, signal: AbortSignal, index: number) => Promise<Result>;
  notStarted: (item: Item, reason: BudgetedBatchStopReason, index: number) => Result;
}): Promise<Result[]> {
  const deadline = Date.now() + Math.max(1, input.totalBudgetMs);
  const results: Result[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      for (let skipped = index; skipped < input.items.length; skipped += 1) {
        results.push(input.notStarted(input.items[skipped], "total_budget", skipped));
      }
      break;
    }
    const outcome = await runWithCooperativeTimeout({
      timeoutMs: Math.min(input.perItemTimeoutMs, remaining),
      operation: (signal) => input.operation(item, signal, index),
      onTimeout: () => input.notStarted(item, "item_timeout", index),
    });
    results.push(outcome.value);
    if (outcome.timedOut) {
      for (let skipped = index + 1; skipped < input.items.length; skipped += 1) {
        results.push(input.notStarted(input.items[skipped], "prior_timeout", skipped));
      }
      break;
    }
  }
  return results;
}
