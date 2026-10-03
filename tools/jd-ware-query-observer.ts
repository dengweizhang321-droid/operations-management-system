import type { Page, Request, Response } from "playwright-core";

export const jdWareQueryResponseTimeoutMs = 60_000;
export const jdWarePageLoadTimeoutMs = 60_000;
export const jdWareBootstrapTimeoutMs = 200_000;
export type JdWareQueryFailureCode = "NOT_DISPATCHED" | "RESPONSE_TIMEOUT" | "BOOTSTRAP_TIMEOUT" | "DUPLICATE_REQUEST" | "REQUEST_FAILED" | "LOGIN_QUERY_CONFLICT" | "OBSERVER_CLOSED";

type Timer = ReturnType<typeof setTimeout>;
export type JdWareQueryDiagnostics = {
  requestCount: number;
  responseSeen: boolean;
  failedCoreScripts: number;
  rejectedCoreScripts: number;
  loginObserved: boolean;
  authenticationStarted: boolean;
  loginCompleted: boolean;
  mainSurface: "unobserved" | "authenticated" | "login" | "pending";
  loginSubframeCount: number;
  challengePresent: boolean;
  credentialRejected: boolean;
  temporarilyLocked: boolean;
};

/** A fixed enum and counts only: never persist URLs, response bodies or credentials. */
export class JdWareQueryObservationError extends Error {
  constructor(readonly code: JdWareQueryFailureCode, readonly diagnostics: JdWareQueryDiagnostics) {
    super(`${code === "LOGIN_QUERY_CONFLICT" ? "waiting_login：京东登录与首屏查询发生交错，需要人工核验；" : ""}JD_INITIAL_QUERY_${code} (requests=${diagnostics.requestCount}, response=${Number(diagnostics.responseSeen)}, scriptsFailed=${diagnostics.failedCoreScripts}, scriptsRejected=${diagnostics.rejectedCoreScripts}, login=${Number(diagnostics.loginObserved)}, handling=${Number(diagnostics.authenticationStarted)}, completed=${Number(diagnostics.loginCompleted)}, main=${diagnostics.mainSurface}, loginSubframes=${diagnostics.loginSubframeCount}, challenge=${Number(diagnostics.challengePresent)}, rejected=${Number(diagnostics.credentialRejected)}, locked=${Number(diagnostics.temporarilyLocked)})`);
    this.name = "JdWareQueryObservationError";
  }
}

export function isJdWareCoreScript(url: string, resourceType: string) {
  if (resourceType !== "script") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "storage.360buyimg.com"
      && parsed.pathname.startsWith("/shop-pageframe/micro-app/ware-shop-static-plus/")
      && parsed.pathname.endsWith(".js");
  } catch { return false; }
}

/** Install before the sole navigation. A response must belong to a request observed by this instance. */
export function observeJdWareInitialQuery(
  page: Pick<Page, "on" | "off">,
  matches: (url: string, method: string) => boolean,
  clock = {
    schedule: (callback: () => void, ms: number): Timer => setTimeout(callback, ms),
    cancel: (timer: Timer) => clearTimeout(timer),
  },
) {
  const diagnostics: JdWareQueryDiagnostics = {
    requestCount: 0, responseSeen: false, failedCoreScripts: 0, rejectedCoreScripts: 0,
    loginObserved: false, authenticationStarted: false, loginCompleted: false,
    mainSurface: "unobserved", loginSubframeCount: 0,
    challengePresent: false, credentialRejected: false, temporarilyLocked: false,
  };
  let request: Request | undefined;
  let active = true;
  let settled = false;
  let startup: Timer | undefined;
  let response: Timer | undefined;
  let resolve!: (value: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  const cancel = (timer: Timer | undefined) => { if (timer !== undefined) clock.cancel(timer); };
  const clearTimers = () => { cancel(startup); cancel(response); cancel(overall); };
  const fail = (code: JdWareQueryFailureCode) => {
    if (!active || settled) return;
    settled = true;
    clearTimers();
    reject(new JdWareQueryObservationError(code, { ...diagnostics }));
  };
  const armStartup = () => {
    cancel(startup);
    if (!request && active && !settled) startup = clock.schedule(() => fail("NOT_DISPATCHED"), jdWarePageLoadTimeoutMs);
  };
  const onRequest = (candidate: Request) => {
    if (!active || !matches(candidate.url(), candidate.method())) return;
    if (settled && !diagnostics.responseSeen) return;
    diagnostics.requestCount += 1;
    if (request) { fail("DUPLICATE_REQUEST"); return; }
    request = candidate;
    cancel(startup);
    response = clock.schedule(() => fail("RESPONSE_TIMEOUT"), jdWareQueryResponseTimeoutMs);
  };
  const onResponse = (candidate: Response) => {
    if (!active || settled) return;
    if (isJdWareCoreScript(candidate.url(), candidate.request().resourceType()) && candidate.status() >= 400) {
      diagnostics.rejectedCoreScripts += 1;
    }
    if (!request || candidate.request() !== request) return;
    diagnostics.responseSeen = true;
    settled = true;
    clearTimers();
    resolve(candidate);
  };
  const onFailed = (candidate: Request) => {
    if (!active || settled) return;
    if (isJdWareCoreScript(candidate.url(), candidate.resourceType())) diagnostics.failedCoreScripts += 1;
    if (candidate === request) fail("REQUEST_FAILED");
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  const overall = clock.schedule(() => fail("BOOTSTRAP_TIMEOUT"), jdWareBootstrapTimeoutMs);
  armStartup();
  return {
    promise,
    isStopped: () => !active || settled,
    hasRequest: () => diagnostics.requestCount > 0,
    diagnostics: () => ({ ...diagnostics }),
    recordGate: (gate: Pick<JdWareQueryDiagnostics, "challengePresent" | "credentialRejected" | "temporarilyLocked">) => {
      diagnostics.challengePresent ||= gate.challengePresent;
      diagnostics.credentialRejected ||= gate.credentialRejected;
      diagnostics.temporarilyLocked ||= gate.temporarilyLocked;
    },
    recordSurface: (surface: Pick<JdWareQueryDiagnostics, "mainSurface" | "loginSubframeCount">) => {
      diagnostics.mainSurface = surface.mainSurface;
      diagnostics.loginSubframeCount = surface.loginSubframeCount;
    },
    navigationReady: () => { if (!diagnostics.authenticationStarted) armStartup(); },
    assertUniqueRequest: () => {
      if (diagnostics.requestCount !== 1) throw new JdWareQueryObservationError("DUPLICATE_REQUEST", { ...diagnostics });
    },
    loginObserved: () => { diagnostics.loginObserved = true; },
    loginStarted: () => {
      if (!active || (settled && !diagnostics.responseSeen)) throw new JdWareQueryObservationError("OBSERVER_CLOSED", { ...diagnostics });
      // Never dispatch a replacement product query after a pre-login request.
      if (request) throw new JdWareQueryObservationError("LOGIN_QUERY_CONFLICT", { ...diagnostics });
      diagnostics.authenticationStarted = true;
      cancel(startup);
    },
    loginCompleted: () => { diagnostics.loginCompleted = true; armStartup(); },
    dispose: () => {
      active = false;
      clearTimers();
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
    },
  };
}

/** Observe all JD login frames through the existing surface classifier, not just top-frame URL changes. */
export async function waitForJdWareLoginSurface(
  isLogin: () => Promise<boolean>,
  isStopped: () => boolean,
  pause: () => Promise<void>,
) {
  while (!isStopped()) {
    // The existing frame classifier already treats detached/loading frames as
    // pending. Genuine challenge/authentication failures must win this race.
    const login = await isLogin();
    if (isStopped()) break;
    if (login) return "login" as const;
    await pause();
  }
  // This branch cannot authenticate. It owns no timer or browser event listener.
  return await new Promise<never>(() => undefined);
}
