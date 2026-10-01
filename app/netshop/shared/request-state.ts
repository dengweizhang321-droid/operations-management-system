"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ReadStatus = "loading" | "ready" | "empty" | "error" | "version_changed";
export class InsightReadError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Generation fence remains effective even when a mock/upstream ignores abort. */
export class ScopedReadGate {
  private generation = 0;
  private controller: AbortController | null = null;
  begin(scope: string) {
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    const generation = ++this.generation;
    return { scope, signal: controller.signal, current: () => generation === this.generation && !controller.signal.aborted };
  }
  cancel() { this.generation++; this.controller?.abort(); this.controller = null; }
}
const hasContent = () => false;
export function useScopedRead<T>(scope: string, load: (signal: AbortSignal) => Promise<T>, isEmpty: (data: T) => boolean = hasContent) {
  const gate = useRef(new ScopedReadGate());
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ scope: string; status: ReadStatus; data: T | null; error: string }>({ scope: "", status: "loading", data: null, error: "" });
  useEffect(() => {
    const currentGate = gate.current;
    const request = currentGate.begin(scope);
    void (async () => {
      setState({ scope, status: "loading", data: null, error: "" });
      try {
        const data = await load(request.signal);
        if (request.current()) setState({ scope, status: isEmpty(data) ? "empty" : "ready", data, error: "" });
      } catch (error) {
        if (request.current()) setState({ scope, status: error instanceof InsightReadError && error.code.endsWith("revision_changed") ? "version_changed" : "error", data: null, error: error instanceof Error ? error.message : "来源读取失败" });
      }
    })();
    return () => currentGate.cancel();
  }, [scope, load, isEmpty, retry]);
  const refresh = useCallback(() => setRetry(v => v + 1), []);
  // Scope changes take effect during render, before a new effect can run.
  return { ...(state.scope === scope ? state : { scope, status: "loading" as const, data: null, error: "" }), refresh };
}
