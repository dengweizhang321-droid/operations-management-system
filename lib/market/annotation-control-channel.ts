import { fetchBoundedJson } from "@/lib/ai/bounded-fetch";
import { annotationControlCommand, annotationControlOutcome, type AnnotationControlCommand, type AnnotationControlOutcome } from "./annotation-control-contract";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Options = { fetchImpl?: typeof fetch; storage?: Storage; onChange?: (value: AnnotationControlOutcome | null, scope: string) => void; postTimeoutMs?: number; queryTimeoutMs?: number; confirmationMs?: number; newId?: () => string };

async function boundedControlJson(input: Parameters<typeof fetchBoundedJson>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const task = fetchBoundedJson(input);
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("control_deadline")), input.timeoutMs ?? 5000);
      abort = () => reject(new Error("control_cancelled"));
      if (input.signal?.aborted) abort(); else input.signal?.addEventListener("abort", abort, { once: true });
    })]);
  } finally { clearTimeout(timer); if (abort) input.signal?.removeEventListener("abort", abort); }
}

/** One POST per browser intent; subsequent recovery performs GETs only. */
export function createAnnotationControlChannel(options: Options = {}) {
  let generation = 0;
  let account = "";
  let jobId = "";
  let controller: AbortController | null = null;
  let pending: AnnotationControlCommand[] = [];
  let storageBlocked = false;
  const storage = () => options.storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  const storageKey = () => "market-annotation-control-v1:" + encodeURIComponent(account.split("|")[0]);
  const persist = () => {
    try { storage()?.setItem(storageKey(), JSON.stringify(pending)); }
    catch { storageBlocked = true; throw new Error("本地控制请求记录无法保存，已停止发送；请核查浏览器存储"); }
  };
  const selected = () => pending.find((value) => value.jobId === jobId);
  const cancel = () => { generation += 1; controller?.abort(); controller = null; };
  const publish = (value: AnnotationControlOutcome, mine: number) => {
    if (mine !== generation) return null;
    if (value.outcome === "succeeded" || value.outcome === "rejected") {
      pending = pending.filter((item) => item.operationId !== value.command.operationId);
      persist();
    }
    options.onChange?.(value, `${account}|${jobId}`);
    return value;
  };
  const read = async (command: AnnotationControlCommand, signal: AbortSignal, remaining: number) => {
    const params = new URLSearchParams({ view: "control_operation", jobId: command.jobId, state: command.state,
      expectedControlVersion: command.expectedControlVersion, operationId: command.operationId });
    try {
      const { response, data } = await boundedControlJson({ url: "/api/market/annotations?" + params,
        init: { cache: "no-store" }, signal, timeoutMs: Math.max(1, Math.min(options.queryTimeoutMs ?? 5000, remaining)), maxBytes: 16_384, fetcher: options.fetchImpl });
      return response.ok ? annotationControlOutcome(command, data) : { outcome: "unknown" as const, command };
    } catch { return { outcome: "unknown" as const, command }; }
  };
  const confirm = async (command: AnnotationControlCommand, mine: number, signal: AbortSignal) => {
    const deadline = Date.now() + (options.confirmationMs ?? 15_000);
    let value: AnnotationControlOutcome = { outcome: "unknown", command };
    for (let attempt = 0; attempt < 3 && Date.now() < deadline && !signal.aborted; attempt += 1) {
      value = await read(command, signal, deadline - Date.now());
      if (mine !== generation) return null;
      if (value.outcome === "succeeded" || value.outcome === "rejected") break;
    }
    return publish(value, mine);
  };
  return {
    cancel,
    onChange(callback: Options["onChange"]) { options.onChange = callback; },
    hasPending: () => storageBlocked || pending.length > 0,
    problem: () => storageBlocked ? "本地控制请求记录无法核实，已阻止新的控制及替代任务；请核查浏览器存储，不要清除未确认请求" : "",
    pending: selected,
    selectScope(nextAccount: string, nextJobId: string) {
      if (nextAccount === account && nextJobId === jobId) return;
      cancel(); account = nextAccount; jobId = nextJobId; pending = []; storageBlocked = false;
      try {
        const saved = JSON.parse(storage()?.getItem(storageKey()) ?? "[]");
        if (!Array.isArray(saved) || saved.length > 20) throw new Error("Invalid pending controls");
        pending = saved.map(annotationControlCommand);
        if (new Set(pending.map((value) => value.operationId)).size !== pending.length
            || new Set(pending.map((value) => value.jobId)).size !== pending.length) throw new Error("Duplicate pending controls");
      } catch { pending = []; storageBlocked = true; }
      options.onChange?.(selected() ? { outcome: "unknown", command: selected()! } : null, `${account}|${jobId}`);
    },
    async query() {
      const command = selected();
      if (!command || controller) return null;
      const mine = generation; const active = new AbortController(); controller = active;
      try { return await confirm(command, mine, active.signal); }
      finally { if (mine === generation) controller = null; }
    },
    async submit(intent: Pick<AnnotationControlCommand, "jobId" | "state" | "expectedControlVersion">) {
      if (intent.jobId !== jobId || !account || selected() || controller || storageBlocked || pending.length >= 20) throw new Error("该任务有未确认的控制请求，请先查询原请求");
      const command = annotationControlCommand({ action: "set_cloud_run_state", ...intent, operationId: (options.newId ?? (() => crypto.randomUUID()))() });
      // Durable identity precedes transmission. A storage failure stops this intent.
      pending.push(command); persist();
      const mine = generation; const active = new AbortController(); controller = active;
      options.onChange?.({ outcome: "processing", command }, `${account}|${jobId}`);
      try {
        try {
          const { response, data } = await boundedControlJson({ url: "/api/market/annotations",
            init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) },
            timeoutMs: options.postTimeoutMs ?? 30_000, maxBytes: 16_384, signal: active.signal, fetcher: options.fetchImpl });
          const value = response.ok ? annotationControlOutcome(command, data, true) : { outcome: "unknown" as const, command };
          if (value.outcome === "succeeded") return publish(value, mine);
        } catch { /* Missing response is an unknown write outcome. */ }
        if (active.signal.aborted || mine !== generation) return null;
        return await confirm(command, mine, active.signal);
      } finally { if (mine === generation) controller = null; }
    },
  };
}
