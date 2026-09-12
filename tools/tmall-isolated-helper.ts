import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { Worker } from "node:worker_threads";

export const isolatedHelperProtocol = "tmall-store-isolation-v1";
export const isolatedHelperTokenHeader = "x-teruisi-helper-slot-token";
const storeHeader = "x-teruisi-tmall-store-key";
const executionHeader = "x-teruisi-n8n-execution-id";
const workflowHeader = "x-teruisi-workflow-key";
const tmallRoutes = new Set(["/plan", "/plan-backfill", "/next-day", "/fetch", "/import", "/promotion", "/promotion-direct-v1", "/product-master", "/product-master-direct-v1"]);
const legacyPrefixes = ["/jd/", "/jd-market/", "/jd-promotion/", "/jd-promotion-cut-meat/", "/jackyun/"];
export type SlotIdentity = { key: string; storeKey: string | null; workflow: string; executionId: string };
export type HelperSlot = { port: number; token: string; stop: () => Promise<unknown> };
export type SlotRecord = SlotIdentity & { status: "starting" | "running" | "closing" | "quarantined"; stage: string; ready: Promise<HelperSlot> };

function scalar(headers: IncomingHttpHeaders, key: string) {
  const value = headers[key];
  return typeof value === "string" ? value : null;
}
export function isolatedRequestIdentity(route: string, headers: IncomingHttpHeaders): SlotIdentity | null {
  const executionId = scalar(headers, executionHeader);
  if (!executionId || !/^[A-Za-z0-9._:-]{1,128}$/.test(executionId)) return null;
  const workflow = route === "/coordination/claim" ? scalar(headers, workflowHeader)
    : tmallRoutes.has(route) ? "tmall"
      : route.startsWith("/jd-market/") ? "jd-market"
        : route.startsWith("/jd-promotion/") || route.startsWith("/jd-promotion-cut-meat/") ? "jd-promotion"
          : route.startsWith("/jd/") ? "jd" : route.startsWith("/jackyun/") ? "jackyun" : null;
  if (!workflow || !["tmall", "jd", "jd-market", "jd-promotion", "jackyun"].includes(workflow)) return null;
  if (route !== "/coordination/claim" && !tmallRoutes.has(route) && !legacyPrefixes.some(prefix => route.startsWith(prefix))) return null;
  const storeKey = workflow === "tmall" ? scalar(headers, storeHeader) : null;
  if (workflow === "tmall" && (!storeKey || !/^tmall-[a-z0-9-]+$/.test(storeKey))) return null;
  return { key: storeKey ?? "legacy", storeKey, workflow, executionId };
}

// One independently terminable JS runtime per Tmall store. A simple Map of
// plans in the original runtime is insufficient: its browser module has globals.
export class IsolatedHelperSlots {
  readonly slots = new Map<string, SlotRecord>();
  private readonly retired = new Set<string>();
  constructor(private readonly allowedStores: ReadonlySet<string>, private readonly spawn: (
    identity: SlotIdentity, finish: (clean: boolean) => void,
  ) => Promise<HelperSlot>) {}

  claim(identity: SlotIdentity): { status: "granted" | "waiting" | "rejected"; reason?: string; slot?: SlotRecord } {
    if (identity.storeKey && !this.allowedStores.has(identity.storeKey)) return { status: "rejected", reason: "tmall_store_not_enabled_or_registered" };
    const active = this.slots.get(identity.key);
    if (active?.status === "quarantined") return { status: "rejected", reason: "helper_slot_cleanup_requires_manual_action" };
    if (this.retired.has(identity.executionId)) return { status: "rejected", reason: "execution_already_finished" };
    for (const slot of this.slots.values()) {
      if (slot.executionId === identity.executionId && (slot.key !== identity.key || slot.workflow !== identity.workflow)) {
        return { status: "rejected", reason: "execution_store_context_mismatch" };
      }
    }
    if (active) return active.executionId === identity.executionId && active.workflow === identity.workflow && active.status !== "closing"
      ? { status: "granted", slot: active } : { status: "waiting", reason: "store_execution_active" };
    // Preserve existing non-Tmall mutual exclusion. This change does not
    // authorize JD/Jackyun to overlap their shared resources with Tmall.
    if (identity.key === "legacy" ? this.slots.size > 0 : this.slots.has("legacy")) {
      return { status: "waiting", reason: "legacy_workflow_active" };
    }
    // Refuse new work rather than discard replay protection after a very long
    // service lifetime. A controlled idle restart can reset this bounded cache.
    if (this.retired.size >= 4096) return { status: "rejected", reason: "helper_replay_capacity_requires_manual_action" };
    const slot = { ...identity, status: "starting", stage: "ready" } as SlotRecord;
    this.slots.set(identity.key, slot); // synchronous reservation, before awaits
    slot.ready = Promise.resolve().then(() => this.spawn(identity, clean => {
      if (this.slots.get(identity.key) !== slot) return;
      this.retired.add(identity.executionId);
      if (clean) this.slots.delete(identity.key);
      else { slot.status = "quarantined"; slot.stage = "failed"; }
    })).then(child => {
      if (slot.status === "starting") slot.status = "running";
      return child;
    }).catch(error => {
      slot.status = "quarantined";
      slot.stage = "failed";
      throw error;
    });
    // A disconnecting HTTP client must not produce an unhandled rejection.
    void slot.ready.catch(() => undefined);
    return { status: "granted", slot };
  }

  lookup(identity: SlotIdentity) {
    const slot = this.slots.get(identity.key);
    return slot && slot.executionId === identity.executionId && slot.workflow === identity.workflow && slot.status === "running" ? slot : null;
  }
  summary() {
    return [...this.slots.values()].map(({ storeKey, workflow, executionId, status, stage }) => ({ storeKey, workflow, executionId, status, stage }));
  }
}

export function spawnIsolatedHelper(entryFile: string, identity: SlotIdentity, finish: (clean: boolean) => void): Promise<HelperSlot> {
  return new Promise((resolve, reject) => {
    const token = randomBytes(32).toString("hex");
    const worker = new Worker(entryFile, {
      workerData: { protocol: isolatedHelperProtocol, identity, token },
      stdout: true, stderr: true,
      ...(identity.storeKey ? { resourceLimits: { maxOldGenerationSizeMb: 512 } } : {}),
    });
    // Never forward task logs, URLs, credentials or workerData to n8n.
    worker.stdout?.resume(); worker.stderr?.resume();
    let ready = false;
    let clean = false;
    const timer = setTimeout(() => {
      reject(new Error("helper_slot_start_timeout"));
      void worker.terminate();
    }, 30_000);
    worker.on("message", message => {
      if (message?.type === "ready" && !ready && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
        ready = true;
        clearTimeout(timer);
        resolve({ port: message.port, token, stop: () => worker.terminate() });
      } else if (message?.type === "finished") {
        clean = message.clean === true;
        // Abort late promises (including a timed-out promotion) before allowing
        // a replacement execution to own this store.
        void worker.terminate();
      }
    });
    worker.on("error", () => reject(new Error("helper_slot_worker_failed")));
    worker.on("exit", () => {
      clearTimeout(timer);
      if (!ready) reject(new Error("helper_slot_start_failed"));
      finish(clean);
    });
  });
}

function reply(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(body);
}

async function forward(request: IncomingMessage, response: ServerResponse, record: SlotRecord) {
  const slot = await record.ready;
  if (record.status !== "running") throw new Error("helper_slot_not_running");
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest({ hostname: "127.0.0.1", port: slot.port, path: request.url, method: "POST",
      headers: { ...request.headers, host: `127.0.0.1:${slot.port}`, connection: "close", [isolatedHelperTokenHeader]: slot.token },
    }, result => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      result.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes > 8 * 1024 * 1024) { result.destroy(new Error("helper_slot_response_too_large")); return; }
        chunks.push(part);
      });
      result.on("error", reject);
      result.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (typeof data.stage === "string") record.stage = data.stage;
          reply(response, result.statusCode ?? 502, data);
          resolve();
        } catch { reject(new Error("helper_slot_invalid_response")); }
      });
    });
    upstream.on("error", reject);
    // Do not cancel a submitted platform action because the n8n HTTP client
    // disconnected. The isolated worker owns its normal timeout and audit.
    request.pipe(upstream);
  });
}

export async function serveIsolatedHelper(options: {
  port: number; entryFile: string; allowedStores: ReadonlySet<string>;
  health: () => Promise<Record<string, unknown>>;
  cors: (origin: string | undefined, privateNetwork: boolean) => Record<string, string>;
}) {
  const pool = new IsolatedHelperSlots(options.allowedStores, (identity, finish) => spawnIsolatedHelper(options.entryFile, identity, finish));
  const server = createServer(async (request, response) => {
    const route = request.url ?? "";
    const cors = route === "/health" ? options.cors(request.headers.origin, request.headers["access-control-request-private-network"] === "true") : {};
    try {
      if (request.method === "OPTIONS" && route === "/health") {
        if (!cors["Access-Control-Allow-Origin"]) { reply(response, 403, { ok: false, error: "origin_not_allowed" }); return; }
        response.writeHead(204, cors); response.end(); return;
      }
      if (request.method === "GET" && route === "/health") {
        const slots = pool.summary();
        reply(response, 200, { ...(await options.health()), ok: true, stage: slots.length ? "running" : "ready", busy: slots.length > 0,
          activeWorkflow: slots.some(slot => slot.workflow === "tmall") ? "tmall" : slots[0]?.workflow ?? null,
          isolationProtocol: isolatedHelperProtocol, storeExecutions: slots }, cors);
        return;
      }
      const identity = request.method === "POST" ? isolatedRequestIdentity(route, request.headers) : null;
      if (!identity) { reply(response, 400, { ok: false, error: "missing_or_invalid_helper_request_identity" }); return; }
      // Existing helper contracts accept header-only requests. Refuse arbitrary
      // bodies and client-supplied internal slot credentials at the front door.
      if (request.headers[isolatedHelperTokenHeader] !== undefined || request.headers["transfer-encoding"] !== undefined
        || Number(request.headers["content-length"] ?? 0) !== 0) {
        reply(response, 400, { ok: false, error: "invalid_helper_request_body_or_internal_header" }); return;
      }
      if (route === "/coordination/claim") {
        const rawAttempt = request.headers["x-teruisi-coordination-attempt"];
        if (rawAttempt !== undefined && (typeof rawAttempt !== "string" || !/^\d{1,3}$/.test(rawAttempt))) {
          reply(response, 400, { ok: false, error: "missing_or_invalid_coordination_attempt" }); return;
        }
        const decision = pool.claim(identity);
        if (decision.status === "rejected") { reply(response, 409, { ok: false, error: decision.reason, message: "执行单元拒绝领取，需要人工核对原任务" }); return; }
        if (decision.status === "waiting") {
          const expired = Number(rawAttempt ?? 0) >= 72;
          reply(response, expired ? 409 : 200, { ok: !expired, ...(expired ? { error: "coordination_wait_expired" } : {}),
            coordinationStatus: "waiting", workflow: identity.workflow, reason: decision.reason, activeWorkflow: identity.workflow }); return;
        }
        await forward(request, response, decision.slot!);
      } else {
        const slot = pool.lookup(identity);
        if (!slot) { reply(response, 409, { ok: false, error: "execution_not_claimed_or_store_mismatch" }); return; }
        await forward(request, response, slot);
      }
    } catch { reply(response, 503, { ok: false, error: "helper_slot_unavailable", message: "独立执行单元异常，需要人工核对原任务，禁止自动重建或跨店接管" }); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return { ok: true, stage: "serve", address: "127.0.0.1", port: options.port, oneShot: false, isolationProtocol: isolatedHelperProtocol };
}
