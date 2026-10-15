export type AnnotationReadIssue = { kind: "maintenance" | "timeout" | "unavailable" | "forbidden" | "invalid_response"; status?: number };
export class AnnotationReadError extends Error {
  constructor(message: string, readonly issue?: AnnotationReadIssue) { super(message); }
}

/** One read scope: only its latest request may publish data or change its error. */
export function createAnnotationReadChannel(options: {
  label: string;
  onError: (message: string) => void;
  onIssue?: (issue: AnnotationReadIssue | null) => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  let generation = 0;
  let active: AbortController | null = null;
  let failed = false;
  const cancel = () => {
    generation += 1;
    active?.abort();
    active = null;
  };
  return {
    cancel,
    hasError: () => failed,
    async read<T>(url: string, validate: (value: unknown) => value is T, publish: (value: T) => void, signal?: AbortSignal): Promise<T | undefined> {
      cancel();
      const requestGeneration = generation;
      const controller = new AbortController();
      active = controller;
      let timedOut = false;
      let issue: AnnotationReadIssue = { kind: "unavailable" };
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
      const isCurrent = () => requestGeneration === generation && !signal?.aborted;
      let rejectAborted: () => void = () => undefined;
      try {
        if (controller.signal.aborted) return;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAborted = () => reject(new Error("aborted"));
          controller.signal.addEventListener("abort", rejectAborted, { once: true });
        });
        const request = (async () => {
          const response = await (options.fetchImpl ?? fetch)(url, { cache: "no-store", signal: controller.signal });
          return { response, value: await response.json() as unknown };
        })();
        const { response, value } = await Promise.race([request, aborted]);
        if (!isCurrent()) return;
        if (controller.signal.aborted) throw new Error("aborted");
        if (!response.ok) {
          const code = value && typeof value === "object" && "code" in value ? value.code : "";
          issue = { kind: code === "maintenance_wait" ? "maintenance" : [401, 403].includes(response.status) ? "forbidden" : "unavailable", status: response.status };
          throw new Error("read_rejected");
        }
        if (!validate(value)) { issue = { kind: "invalid_response", status: response.status }; throw new Error("invalid_response"); }
        publish(value);
        failed = false;
        options.onError("");
        options.onIssue?.(null);
        return value;
      } catch {
        if (!isCurrent() || (controller.signal.aborted && !timedOut)) return;
        if (timedOut) issue = { kind: "timeout" };
        const message = issue.kind === "maintenance"
          ? "系统正在维护或排空，暂时无法读取最新状态；维护结束后会重新查询。"
          : `${options.label}${timedOut ? "超时" : "失败"}，当前显示上次成功读取的数据，请重试。`;
        failed = true;
        options.onError(message);
        options.onIssue?.(issue);
        throw new AnnotationReadError(message, issue);
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", rejectAborted);
        signal?.removeEventListener("abort", abort);
        if (active === controller) active = null;
      }
    },
  };
}
