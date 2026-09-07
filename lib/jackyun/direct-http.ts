import { createHash } from "node:crypto";

// This is the authenticated website protocol, not the separately licensed Open API.
// Signing material and credentials are supplied at runtime and never serialized here.
export type JackyunSession = { accessToken: string; refreshToken: string; appkey: string; signingSecret: string };
export type JackyunHttpOperation = "tasks" | "validateExport" | "submitExport";
const operations = {
  tasks: { path: "/jkyun/tms/taskmanage/sysTaskInfoList", method: "GET", replaySafe: true },
  validateExport: { path: "/jkyun/excel-service/manager/validateExcelExport", method: "POST", replaySafe: true },
  submitExport: { path: "/jkyun/excel-service/manager/startExcelExport", method: "POST", replaySafe: false },
} as const;
const origin = "https://web.jackyun.com";

function assertSession(value: JackyunSession) {
  if (![value.accessToken, value.refreshToken, value.appkey, value.signingSecret].every(v =>
    typeof v === "string" && v.length > 0 && v.length < 16384 && !/[\r\n]/.test(v))) {
    throw new Error("JACKYUN_SESSION_INVALID");
  }
}

/** Matches jkUtils.jkGetSign, including unsigned empty/whitespace/undefined values. */
export function signJackyunForm(data: Record<string, unknown>, session: JackyunSession, timestamp: number) {
  assertSession(session);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("JACKYUN_TIMESTAMP_INVALID");
  const values: Record<string, string> = {};
  const signed: Record<string, string> = {
    timestamp: String(timestamp), access_token: `Bearer ${session.accessToken}`, appkey: session.appkey,
  };
  for (const [key, value] of Object.entries(data)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ["timestamp", "access_token", "appkey", "sign", "__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("JACKYUN_PARAMETER_INVALID");
    }
    if (["function", "symbol", "bigint"].includes(typeof value)) throw new Error("JACKYUN_PARAMETER_INVALID");
    let serialized: string;
    try { serialized = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
    catch { throw new Error("JACKYUN_PARAMETER_INVALID"); }
    if (typeof serialized !== "string") throw new Error("JACKYUN_PARAMETER_INVALID");
    values[key] = serialized;
    if (value !== undefined && value !== "" && !(typeof value === "string" && /^\s+$/.test(value))) signed[key] = serialized;
  }
  const canonical = Object.keys(signed).sort().map(key => key + signed[key]).join("");
  const sign = createHash("md5").update(session.signingSecret + canonical + session.signingSecret).digest("hex").toUpperCase();
  return new URLSearchParams({ ...values, timestamp: signed.timestamp, access_token: signed.access_token, appkey: signed.appkey, sign });
}

type SessionOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  allowRefresh?: boolean;
  /** Must atomically verify the previous pair before replacing both tokens. Failure poisons this owner. */
  publishSession: (previous: Readonly<JackyunSession>, next: Readonly<JackyunSession>) => Promise<void>;
};

/** One instance per held Jackyun run lock. No background timer or second refresh owner. */
export class JackyunHttpSession {
  #session: JackyunSession;
  #generation = 0;
  #refreshing?: Promise<void>;
  #poisoned = false;
  #fetch: typeof fetch;
  #now: () => number;
  #publish: SessionOptions["publishSession"];
  #allowRefresh: boolean;
  constructor(session: JackyunSession, options: SessionOptions) {
    assertSession(session);
    this.#session = { ...session };
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#publish = options.publishSession;
    this.#allowRefresh = options.allowRefresh === true;
  }

  async #json(path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
    try {
      const response = await this.#fetch(origin + path, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2 * 1024 * 1024) throw new Error();
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
      return { status: response.status, body };
    } catch {
      // A transport error can contain signed URLs, tokens or response contents.
      throw new Error("JACKYUN_HTTP_RESPONSE_UNVERIFIED");
    }
  }

  async #refresh(observedGeneration: number) {
    if (this.#poisoned) throw new Error("JACKYUN_SESSION_RELOGIN_REQUIRED");
    if (observedGeneration !== this.#generation) return;
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      const previous = { ...this.#session };
      try {
        const { status, body } = await this.#json("/auth/refresh", {
          method: "POST", headers: { clientId: "jackyun_web_browser", "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Referer: origin + "/" },
          body: new URLSearchParams({ refreshToken: previous.refreshToken }).toString(),
        });
        if (status !== 200 || typeof body.access_token !== "string" || typeof body.refresh_token !== "string") throw new Error();
        const next = { ...previous, accessToken: body.access_token, refreshToken: body.refresh_token };
        assertSession(next);
        await this.#publish(Object.freeze(previous), Object.freeze(next));
        this.#session = next;
        this.#generation++;
      } catch {
        this.#poisoned = true;
        throw new Error("JACKYUN_SESSION_RELOGIN_REQUIRED");
      }
    })();
    try { await this.#refreshing; } finally { this.#refreshing = undefined; }
  }

  async request<T>(operation: JackyunHttpOperation, data: Record<string, unknown>, moduleCode = ""): Promise<T> {
    const spec = operations[operation];
    if (!spec || !/^[A-Za-z0-9_.-]{0,100}$/.test(moduleCode)) throw new Error("JACKYUN_OPERATION_INVALID");
    if (this.#poisoned) throw new Error("JACKYUN_SESSION_RELOGIN_REQUIRED");
    // A request starting during renewal must not send the superseded token.
    if (this.#refreshing) await this.#refreshing;
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = this.#generation;
      const form = signJackyunForm(data, this.#session, this.#now());
      const headers = { Authorization: `Bearer ${this.#session.accessToken}`, module_code: moduleCode,
        "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Referer: origin + "/", "X-Requested-With": "XMLHttpRequest" };
      const { status, body } = await this.#json(spec.path + (spec.method === "GET" ? "?" + form.toString() : ""), {
        method: spec.method, headers, ...(spec.method === "POST" ? { body: form.toString() } : {}),
      });
      if (["0190210000", "0190210006", "0031117002"].includes(String(body.subCode))) throw new Error("JACKYUN_HTTP_VERIFICATION_REQUIRED");
      if (status === 200 && body.code === 200 && body.result && typeof body.result === "object") return body.result as T;
      if (status === 401 && body.subCode === "0190210003" && attempt === 0 && spec.replaySafe && this.#allowRefresh) {
        await this.#refresh(generation);
        continue;
      }
      // No replay after task submission, transport uncertainty, denial or risk verification.
      throw new Error(spec.replaySafe ? "JACKYUN_HTTP_REQUEST_REJECTED" : "JACKYUN_EXPORT_SUBMISSION_UNCONFIRMED");
    }
    throw new Error("JACKYUN_SESSION_RELOGIN_REQUIRED");
  }
}
