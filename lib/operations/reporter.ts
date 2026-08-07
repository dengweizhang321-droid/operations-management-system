export type ExternalOperationReporter = ReturnType<typeof createExternalOperationReporter>;

export function createExternalOperationReporter(input: {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const endpoint = `${input.baseUrl.replace(/\/$/, "")}/api/operations/runtime`;
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = Math.min(10_000, Math.max(500, input.timeoutMs ?? 2_000));

  const post = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null);
      return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async start(body: {
      externalRunId: string;
      runType: string;
      surface: string;
      platform?: string;
      shopName?: string;
      dataset?: string;
      scope?: unknown;
    }): Promise<string | null> {
      const payload = await post({
        action: "start",
        ...body,
        idempotencyKey: `${body.externalRunId}:${crypto.randomUUID()}`.slice(0, 160),
      });
      const run = payload?.run;
      return run && typeof run === "object" && typeof (run as { id?: unknown }).id === "string"
        ? (run as { id: string }).id
        : null;
    },
    async event(runId: string | null, body: {
      eventType: string;
      level?: "debug" | "info" | "warning" | "error";
      stage?: string;
      attributes?: unknown;
    }) {
      if (!runId) return false;
      return Boolean(await post({ action: "event", runId, traceId: runId, ...body }));
    },
    async finish(runId: string | null, body: {
      status: "succeeded" | "failed" | "cancelled";
      errorCode?: string;
      summary?: unknown;
    }) {
      if (!runId) return false;
      return Boolean(await post({ action: "finish", runId, ...body }));
    },
  };
}
