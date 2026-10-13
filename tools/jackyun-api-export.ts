import { readFile, mkdir, lstat, realpath, stat, open } from "node:fs/promises";
import { boundDownloadResumeMessage, JackyunDownloadFailure } from "../lib/jackyun/download-failure";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { closeChromeBrowser, launchDedicatedChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, PlaywrightPageClient } from "../lib/jackyun/playwright-client";
import { readJackyunLoginConfig } from "../lib/jackyun/windows-dpapi";
import { inspectJackyunLoginSurface, submitJackyunDpapiLogin, verifyJackyunBrowserBinding, waitForJackyunDpapiSession, isJackyunLoginOrigin, resolveJackyunChromiumExecutable } from "../lib/jackyun/dpapi-login";
import { createDirectSession, readDirectTasks } from "../lib/jackyun/direct-export";
import { apiTaskWindowObserved, apiTaskWindowStart } from "../lib/jackyun/api-clock";
import type { JackyunServerClock, JackyunHttpSession } from "../lib/jackyun/direct-http";
import { apiSha, jackyunApiTransport, readApiScope, prepareApiExport, buildApiParameters, type ApiTemplates } from "../lib/jackyun/api-plan";
import { validateDirectExportPayload } from "../lib/jackyun/direct-export";
import { selectNewWebSessionTask } from "../lib/jackyun/web-session-export";
import { downloadSignedOssExport } from "../lib/jackyun/oss-download";
import { assertBoundDownloadProvenance, type JackyunDownloadProvenance } from "../lib/jackyun/download-provenance";
import type { JackyunExportTaskBinding } from "../lib/jackyun/export-task";
import { jackyunCaptureDate, jackyunExportFirstPolicyVersion, jackyunExportOrder, type JackyunCurrentSnapshotEvidence } from "../lib/jackyun/run-contract";
import { jackyunModuleOrder, type JackyunModule } from "../lib/jackyun/post-download";
import calibratedTemplates from "../config/jackyun-api-templates.json";
import { readJsonDurableOr as readJsonFileOr, writeJsonDurable as writeJsonAtomic, publishDurableFile } from "../lib/jackyun/json-file";
import type { BrowserHandoff } from "./jackyun-daily-runner";
import { jackyunSalesPeriod } from "../lib/jackyun/sales-period";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type ModuleState = { status: "prepared" | "submit_intent" | "submitted" | "handed_off"; preflightStartedAt: string; queryIntentAt: string; queryCompletedAt: string;
  sourceRows: number; payloadSha256: string; querySha256: string; permissionSha256: string; templateSha256: string; baselineIds: string[];
  serverClock?: JackyunServerClock; exportIntentAt?: string; pendingTaskId?: string; binding?: JackyunExportTaskBinding; filePath?: string; provenance?: JackyunDownloadProvenance; handoffSha256?: string;
  attachmentObjectSha256?: string; readyObservedAt?: string; refreshedBindings?: JackyunExportTaskBinding[] };
type ApiState = { version: 1 | 2; runId: string; tenantId?: string; transport: typeof jackyunApiTransport; runDate: string; asOfDate: string; salesStartDate?: string; templateSha256: string; modules: Partial<Record<JackyunModule, ModuleState>> };
export type ApiExportOptions = { runId: string; runDate: string; asOfDate: string; outputRoot: string; eventRoot: string; downloadDirectory: string;
  salesStartDate?: string;
  assertOwned?: () => Promise<void>;
  controllerVersion?: 2;
  beforeModule?: (module: JackyunModule, continuationOnly?: boolean) => Promise<void>; afterModule?: (module: JackyunModule) => Promise<void>; signal?: AbortSignal;
  resumeTaskBinding?: JackyunExportTaskBinding };

type LoginPage = { url(): string };
type LoginPageContext<T extends LoginPage> = { pages(): T[] };

/**
 * Wait for the dedicated browser's eligible page set to settle before using it.
 * A crashed or still-navigating profile can transiently expose zero or multiple
 * pages; returning immediately turns that transient state into a false login
 * failure and an unsafe retry loop.
 */
export async function waitForUniqueJackyunLoginPage<T extends LoginPage>(
  context: LoginPageContext<T>,
  { timeoutMs = 15_000, settleMs = 250 }: { timeoutMs?: number; settleMs?: number } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000
    || !Number.isSafeInteger(settleMs) || settleMs < 100 || settleMs > 2_000) {
    throw new Error("吉客云登录页面等待参数无效。");
  }
  const deadline = Date.now() + timeoutMs;
  let previousSignature = "";
  let previousPage: T | undefined;
  let stableSamples = 0;
  let counts = { eligible: 0, total: 0, blank: 0, jackyun: 0, other: 0 };
  while (Date.now() < deadline) {
    const pages = context.pages();
    const eligible = pages.filter((page) => page.url() === "about:blank" || isJackyunLoginOrigin(page.url()));
    const blank = pages.filter(page => page.url() === "about:blank").length;
    counts = { eligible: eligible.length, total: pages.length, blank, jackyun: eligible.length - blank, other: pages.length - eligible.length };
    const signature = eligible.map((page) => page.url()).join("\u0000");
    if (eligible.length === 1) {
      if (eligible[0] === previousPage && signature === previousSignature) stableSamples += 1;
      else stableSamples = 1;
      previousPage = eligible[0];
      previousSignature = signature;
      if (stableSamples >= 2) return eligible[0];
    } else {
      stableSamples = 0;
      previousPage = undefined;
      previousSignature = signature;
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  // URLs may carry session tokens. Only bounded counts leave this function.
  const count = (value: number) => Math.min(value, 999999);
  throw new Error(`API_LOGIN_PAGE_NOT_UNIQUE: eligible=${count(counts.eligible)}; total=${count(counts.total)}; blank=${count(counts.blank)}; jackyun=${count(counts.jackyun)}; other=${count(counts.other)}`);
}

/** Caller owns the profile/run lock. Browser is used only for authentication and token publication. */
export async function withJackyunApiSession<T>(callback: (http: JackyunHttpSession, tenantId: string) => Promise<T>): Promise<T> {
  const login = await readJackyunLoginConfig(projectRoot);
  const chromePath = resolveJackyunChromiumExecutable();
  if (!(await stat(chromePath).catch(() => null))?.isFile()) {
    throw new Error("waiting_login：独立 Chromium 未安装，自动任务已停止。");
  }
  const launched = await launchDedicatedChrome({ executablePath: chromePath, profileDirectory: login.profileDirectory, port: login.debuggingPort,
    startUrl: "https://web.jackyun.com/home/mainframe_web_horizontal.html", headless: true });
  if (!launched) throw new Error("waiting_login：专用浏览器端口已占用，自动任务不会接管已打开的浏览器。");
  let ownedBrowserVerified = false;
  try {
    await verifyJackyunBrowserBinding({ chromePath, profileDirectory: login.profileDirectory, port: login.debuggingPort, headless: true, processId: launched.pid });
    ownedBrowserVerified = true;
    const browser = await connectPlaywrightBrowser(login.debuggingPort);
    const context = browser.contexts()[0];
    let client: PlaywrightPageClient | undefined;
    try {
      if (!context) throw new Error("API_LOGIN_PAGE_NOT_UNIQUE: no_context");
      const page = await waitForUniqueJackyunLoginPage(context);
      if (page.url() === "about:blank") await page.goto("https://web.jackyun.com/home/mainframe_web_horizontal.html", { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForJackyunDpapiSession({ inspect: () => inspectJackyunLoginSurface(page, login.tenantId), submit: () => submitJackyunDpapiLogin(page, login), initialWaitMs: login.initialWaitMs, afterSubmitWaitMs: login.afterSubmitWaitMs });
      client = new PlaywrightPageClient(page, await context.newCDPSession(page));
      await context.setOffline(true);
      return await callback(await createDirectSession(client, login.tenantId), login.tenantId);
    } finally {
      await context?.setOffline(false); client?.close(); await browser.close();
    }
  } finally {
    if (ownedBrowserVerified) await closeChromeBrowser(login.debuggingPort);
    else launched.kill();
  }
}

export async function runApiExports(options: ApiExportOptions, deps: { http?: JackyunHttpSession; tenantId?: string; templates?: ApiTemplates; taskTimeoutMs?: number; pollIntervalMs?: number; download?: Parameters<typeof downloadSignedOssExport>[1] } = {}) {
  const salesPeriod = jackyunSalesPeriod(options.asOfDate, options.salesStartDate);
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(options.runId)
    || new Date(Date.parse(options.runDate + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) !== options.asOfDate) throw new Error("API_RUN_SCOPE_INVALID");
  const templates = deps.templates ?? calibratedTemplates as ApiTemplates;
  const templateSha256 = apiSha(JSON.stringify(templates));
  const runDirectory = path.join(options.outputRoot, options.runId), eventDirectory = path.join(options.eventRoot, options.runId);
  const statePath = path.join(runDirectory, "api-controller-state.json");
  const state = await readJsonFileOr<ApiState>(statePath, { version: options.controllerVersion ?? 1, runId: options.runId, transport: jackyunApiTransport, runDate: options.runDate, asOfDate: options.asOfDate, ...(options.salesStartDate !== undefined ? { salesStartDate: options.salesStartDate } : {}), templateSha256, modules: {} });
  if (![1, 2].includes(state.version) || state.runId !== options.runId || state.transport !== jackyunApiTransport || state.templateSha256 !== templateSha256
    || state.runDate !== options.runDate || state.asOfDate !== options.asOfDate || state.salesStartDate !== options.salesStartDate) throw new Error("API_RUN_BINDING_CHANGED");
  const allowedHosts = ["jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com"];
  const assertOwned = options.assertOwned ?? (async () => undefined);
  await assertOwned();
  const persist = async (target: string, value: unknown) => { await assertOwned(); await writeJsonAtomic(target, value); await assertOwned(); };
  const execute = async (session: JackyunHttpSession, tenantId: string) => {
    // Preserve the session object/private fields while fencing every local HTTP
    // action and its returned result. A late former owner cannot write progress.
    const http = { get serverClock() { return session.serverClock; }, request: async (...args: Parameters<JackyunHttpSession["request"]>) => {
      await assertOwned(); const result = await session.request(...args); await assertOwned(); return result;
    } } as unknown as JackyunHttpSession;
    if (state.tenantId !== undefined ? state.tenantId !== tenantId : Object.keys(state.modules).length > 0) throw new Error("API_TENANT_BINDING_CHANGED");
    state.tenantId = tenantId;
    const scope = await readApiScope(http, templates, tenantId);
    let pendingSeen = false;
    for (const moduleKey of jackyunExportOrder) {
      const entry = state.modules[moduleKey];
      if (pendingSeen && entry) throw new Error("API_STATE_MODULE_ORDER_INVALID");
      if (entry?.status !== "handed_off") pendingSeen = true;
    }
    for (const [key, entry] of Object.entries(state.modules)) {
      if (!jackyunExportOrder.includes(key as JackyunModule) || !entry || !["prepared", "submit_intent", "submitted", "handed_off"].includes(entry.status)
        || entry.permissionSha256 !== scope.permissionSha256 || entry.templateSha256 !== templateSha256
        || !Number.isSafeInteger(entry.sourceRows) || entry.sourceRows <= 0 || entry.sourceRows > 500000
        || ![entry.payloadSha256, entry.querySha256].every(value => /^[a-f0-9]{64}$/.test(value))
        || !Array.isArray(entry.baselineIds) || new Set(entry.baselineIds).size !== entry.baselineIds.length || !entry.baselineIds.every(value => /^sys-\d{1,20}$/.test(value))
        || entry.status !== "prepared" && !entry.exportIntentAt) throw new Error("API_STATE_EVIDENCE_INVALID");
      if (entry.exportIntentAt) apiTaskWindowStart(entry.serverClock, entry.exportIntentAt);
      if (state.version === 1 && ["attachmentObjectSha256", "readyObservedAt", "refreshedBindings"].some(field => Object.hasOwn(entry, field))) throw new Error("API_LEGACY_STATE_SCHEMA_CHANGED");
      const currentParameters = buildApiParameters(key as JackyunModule, templates.modules[key as JackyunModule], scope, options.asOfDate, options.salesStartDate);
      currentParameters.data.exportTotal = String(entry.sourceRows);
      const payload = validateDirectExportPayload(key as JackyunModule, new URLSearchParams(currentParameters.data).toString(), currentParameters.moduleCode, options.asOfDate, options.salesStartDate);
      if (payload.payloadSha256 !== entry.payloadSha256 || apiSha(JSON.stringify(currentParameters.query)) !== entry.querySha256) throw new Error("JACKYUN_API_SCOPE_MANUAL_ACTION：原模块参数或授权范围变化，禁止混合新旧文件。");
    }
    if (options.resumeTaskBinding) {
      const firstIncomplete = jackyunExportOrder.find(moduleKey => state.modules[moduleKey]?.status !== "handed_off");
      const entry = firstIncomplete ? state.modules[firstIncomplete] : undefined;
      const taskAlreadyBound = entry?.pendingTaskId === options.resumeTaskBinding.taskId
        && isDeepStrictEqual(entry.binding, options.resumeTaskBinding);
      const hasStoredBinding = entry?.pendingTaskId !== undefined || entry?.binding !== undefined;
      if (!firstIncomplete || options.resumeTaskBinding.module !== firstIncomplete || entry?.status !== "submitted"
        || hasStoredBinding && !taskAlreadyBound
        || entry.filePath || entry.provenance || entry.handoffSha256
        || options.resumeTaskBinding.sourceRows !== entry.sourceRows || entry.baselineIds.includes(options.resumeTaskBinding.taskId)) {
        throw new Error("API_RESUME_BINDING_INVALID");
      }
    }
    for (const moduleKey of jackyunExportOrder) {
      options.signal?.throwIfAborted();
      const stored = state.modules[moduleKey];
      const readyAt = stored?.readyObservedAt ?? (stored?.binding && stored.serverClock
        ? new Date(Date.parse(stored.binding.observedAt) - Date.parse(stored.serverClock.serverDate) + Date.parse(stored.serverClock.receivedAt)).toISOString() : undefined);
      const continuationOnly = stored?.status === "handed_off" || Boolean(stored?.binding && readyAt && jackyunCaptureDate(readyAt) === options.runDate)
        || moduleKey === "sales" && Boolean(stored?.exportIntentAt);
      if (jackyunCaptureDate(new Date().toISOString()) !== options.runDate && !continuationOnly) throw new Error("JACKYUN_CAPTURE_GENERATION_REQUIRED_MANUAL_ACTION：旧任务没有原采集日的完成附件证明；须协调旧请求后建立新实际采集日计划，不能标成旧快照。");
      if (state.version === 2 && stored?.status === "submit_intent" && !stored.pendingTaskId && !stored.binding) throw new Error("JACKYUN_SUBMIT_UNKNOWN_MANUAL_ACTION：原导出提交缺少受理回执和唯一任务绑定，需核查原请求；空列表或任务暂不可见均不能证明未执行。");
      await options.beforeModule?.(moduleKey, continuationOnly);
      const eventPath = path.join(eventDirectory, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`);
      let entry = state.modules[moduleKey];
      if (entry?.status === "handed_off") {
        if (!entry.filePath || !entry.provenance || !entry.handoffSha256) throw new Error("API_ARCHIVE_INCOMPLETE");
        assertBoundDownloadProvenance(entry.provenance, allowedHosts, { runId: options.runId, module: moduleKey, policyVersion: jackyunExportFirstPolicyVersion });
        if (apiSha(await readFile(eventPath, "utf8")) !== entry.handoffSha256) throw new Error("API_ARCHIVE_CHANGED");
        // File SHA is over bytes, never decoded text.
        const bytes = await readFile(entry.filePath);
        if (createHash("sha256").update(bytes).digest("hex") !== entry.provenance.sha256 || bytes.length !== entry.provenance.bytes) throw new Error("API_ARCHIVE_CHANGED");
        await options.afterModule?.(moduleKey); continue;
      }
      if (!entry?.exportIntentAt) {
        if (jackyunCaptureDate(new Date().toISOString()) !== options.runDate) throw new Error("API_CAPTURE_DATE_CHANGED");
        const preflightStartedAt = new Date().toISOString();
        const prepared = await prepareApiExport(http, templates, scope, moduleKey, options.runDate, options.asOfDate, options.salesStartDate);
        const validationData = { ...prepared.data }; delete validationData.isSyn;
        const validation = await http.request<{ data: unknown; noPrivilegeItem: unknown; desensitizationItem: unknown }>("validateExport", validationData, prepared.moduleCode);
        if (validation.data !== null || validation.noPrivilegeItem !== null || validation.desensitizationItem !== null) throw new Error("API_EXPORT_VALIDATION_CHANGED");
        const baseline = await readDirectTasks(http, moduleKey);
        const serverClock = http.serverClock;
        entry = { status: "prepared", serverClock, preflightStartedAt, queryIntentAt: prepared.queryIntentAt, queryCompletedAt: prepared.queryCompletedAt, sourceRows: prepared.sourceRows,
          payloadSha256: prepared.payloadSha256, querySha256: prepared.querySha256, permissionSha256: scope.permissionSha256, templateSha256, baselineIds: baseline.records.map(row => row.taskId) };
        state.modules[moduleKey] = entry;
        await mkdir(runDirectory, { recursive: true });
        await persist(statePath, state);
        if (jackyunCaptureDate(new Date().toISOString()) !== options.runDate) throw new Error("API_CAPTURE_DATE_CHANGED");
        entry.status = "submit_intent"; entry.exportIntentAt = new Date().toISOString();
        apiTaskWindowStart(entry.serverClock, entry.exportIntentAt);
        await persist(statePath, state);
        // Never replay this POST, including after an uncertain response/process restart.
        await http.request("submitExport", prepared.data, prepared.moduleCode);
        entry.status = "submitted";
        await persist(statePath, state);
      }
      const taskWindowStartAt = apiTaskWindowStart(entry.serverClock, entry.exportIntentAt!);
      const deadline = Date.now() + (deps.taskTimeoutMs ?? 300000);
      let selected: ReturnType<typeof selectNewWebSessionTask>["result"] = null;
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const snapshot = await readDirectTasks(http, moduleKey, taskWindowStartAt);
        const resumed = options.resumeTaskBinding?.module === moduleKey ? options.resumeTaskBinding : undefined;
        const task = selectNewWebSessionTask(snapshot, { module: moduleKey, sourceRows: entry.sourceRows, exportIntentAt: taskWindowStartAt,
          observedAt: apiTaskWindowObserved(entry.serverClock, new Date().toISOString()), allowedHosts,
          baselineIds: entry.baselineIds, pendingTaskId: entry.pendingTaskId ?? resumed?.taskId,
          binding: state.version === 2 && entry.attachmentObjectSha256 ? undefined : entry.binding ?? resumed });
        if (task.taskId && !entry.pendingTaskId) { entry.pendingTaskId = task.taskId; await persist(statePath, state); }
        if (task.result) {
          if (state.version === 2) {
            const object = new URL(task.result.url), objectSha = apiSha(object.origin + object.pathname);
            if (entry.attachmentObjectSha256 && entry.attachmentObjectSha256 !== objectSha
              || entry.binding && ["taskId", "label", "createdAt", "module", "sourceRows"].some(key => entry.binding![key as keyof JackyunExportTaskBinding] !== task.result!.binding[key as keyof JackyunExportTaskBinding])) {
              throw new Error("JACKYUN_ATTACHMENT_CHANGED_MANUAL_ACTION：原任务附件对象或身份变化，禁止拼入原校验集合。");
            }
            if (entry.binding && entry.binding.sourceUrlHash !== task.result.binding.sourceUrlHash) {
              const history = entry.refreshedBindings ?? [];
              if (history.length >= 8) throw new Error("原附件链接刷新预算已用尽，需要人工核查。");
              entry.refreshedBindings = [...history, entry.binding];
            }
            entry.attachmentObjectSha256 = objectSha;
            entry.readyObservedAt ??= new Date().toISOString();
          }
          selected = task.result; break;
        }
        await new Promise(resolve => setTimeout(resolve, deps.pollIntervalMs ?? 1500));
      }
      if (!selected) throw new Error("API_ORIGINAL_EXPORT_TASK_PENDING");
      entry.binding = selected.binding; await persist(statePath, state);
      const downloaded = await downloadSignedOssExport({ url: selected.url, downloadDirectory: options.downloadDirectory, runId: options.runId, module: moduleKey,
        policyVersion: jackyunExportFirstPolicyVersion, exportIntentAt: entry.exportIntentAt!, allowedHosts, timeoutMs: 300000, assertOwned }, deps.download).catch(error => {
          // One cross-execution recovery is supported only for the first bound
          // inventory task. Other phases retain their existing operator path.
          if (error instanceof JackyunDownloadFailure && error.retryable && moduleKey === "inventory"
            && !options.resumeTaskBinding && Object.keys(state.modules).length === 1) {
            throw new Error(boundDownloadResumeMessage(error));
          }
          throw error;
        });
      entry.filePath = downloaded.filePath; entry.provenance = downloaded.provenance;
      const snapshotEvidence: JackyunCurrentSnapshotEvidence | undefined = moduleKey === "inventory" || moduleKey === "inventory_age" ? {
        version: 1, module: moduleKey, runId: options.runId, source: "current_query", targetDate: options.runDate, queryIntentAt: entry.queryIntentAt,
        queryRefreshSource: "module_network_request", queryRefreshCompletedAt: entry.queryCompletedAt, tableStableAt: entry.queryCompletedAt,
      } : undefined;
      const fieldChecks = moduleKey === "sales" ? [{ field: "统计时间类型", value: "发货时间", verifiedAt: entry.queryCompletedAt }, { field: "日期区间", value: `${salesPeriod.startDate} 00:00:00 至 ${options.asOfDate} 23:59:59`, verifiedAt: entry.queryCompletedAt }]
        : moduleKey === "products" ? [{ field: "模式", value: "规格模式(SKU)", verifiedAt: entry.queryCompletedAt }] : [];
      const handoff: BrowserHandoff = {
        schemaVersion: 2, runId: options.runId, module: moduleKey, policyVersion: jackyunExportFirstPolicyVersion, filePath: downloaded.filePath,
        // Compatibility names in the existing importer envelope: no DOM navigation/table events are claimed.
        navigationIntentAt: entry.preflightStartedAt, queryIntentAt: entry.queryIntentAt, tableStableAt: entry.queryCompletedAt,
        exportIntentAt: entry.exportIntentAt!, downloadEventAt: downloaded.provenance.completedAt, expectedSourceRows: entry.sourceRows,
        downloadProvenance: downloaded.provenance, snapshotEvidence, fieldChecks,
        evidence: { controller: "authenticated_http_api", exportTransport: jackyunApiTransport, taskQuerySource: "direct_http_api", directPayloadSha256: entry.payloadSha256,
          apiPreflightStartedAt: entry.preflightStartedAt, apiQueryCompletedAt: entry.queryCompletedAt, apiQuerySha256: entry.querySha256,
          serverClock: entry.serverClock, permissionSha256: entry.permissionSha256, templateSha256, sourceUrlHash: downloaded.provenance.sourceUrlHash, exportTaskBinding: selected.binding },
      };
      await assertOwned();
      await mkdir(eventDirectory, { recursive: true }); await persist(eventPath, handoff);
      entry.handoffSha256 = apiSha(await readFile(eventPath, "utf8")); entry.status = "handed_off"; await persist(statePath, state);
      await options.afterModule?.(moduleKey);
      console.log(JSON.stringify({ module: moduleKey, status: "handed_off", rows: entry.sourceRows, elapsedMs: Date.now() - Date.parse(entry.preflightStartedAt) }));
    }
    return { status: "exported" as const, runId: options.runId, transport: jackyunApiTransport, statePath };
  };
  return deps.http && deps.tenantId ? execute(deps.http, deps.tenantId) : withJackyunApiSession(execute);
}

/** Pure file continuation, including after midnight. All five original atomic
 * handoffs and the controller must agree; no orphan XLSX is adopted. */
export async function verifyCompletedApiLocalFiles(options: Pick<ApiExportOptions, "runId" | "runDate" | "asOfDate" | "salesStartDate" | "outputRoot" | "eventRoot" | "downloadDirectory">) {
  const file = path.join(options.outputRoot, options.runId, "api-controller-state.json");
  const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) return false;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1048576) throw new Error("API_ARCHIVE_IDENTITY_INVALID");
  const state = await readJsonFileOr<ApiState | null>(file, null);
  if (!state || ![1, 2].includes(state.version) || state.runId !== options.runId || state.runDate !== options.runDate || state.asOfDate !== options.asOfDate
    || state.salesStartDate !== options.salesStartDate || state.transport !== jackyunApiTransport
    || state.templateSha256 !== apiSha(JSON.stringify(calibratedTemplates)) || !state.modules || !state.tenantId) throw new Error("API_RUN_BINDING_CHANGED");
  if (jackyunExportOrder.some(key => state.modules[key]?.status !== "handed_off")) return false;
  if (Object.keys(state.modules).length !== 5) throw new Error("API_ARCHIVE_EVIDENCE_INVALID");
  for (const moduleKey of jackyunExportOrder) {
    const entry = state.modules[moduleKey]!;
    if (!entry.filePath || !entry.provenance || !entry.handoffSha256 || !entry.binding || entry.pendingTaskId !== entry.binding.taskId
      || entry.templateSha256 !== state.templateSha256 || entry.permissionSha256 !== calibratedTemplates.permissionFieldsSha256) throw new Error("API_ARCHIVE_INCOMPLETE");
    const event = path.join(options.eventRoot, options.runId, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`);
    const eventInfo = await lstat(event), dataInfo = await lstat(entry.filePath);
    if (![eventInfo, dataInfo].every(i => i.isFile() && !i.isSymbolicLink() && i.nlink === 1)
      || path.dirname(path.resolve(entry.filePath)) !== path.resolve(options.downloadDirectory, "jackyun", options.runId, moduleKey)
      || path.resolve(await realpath(entry.filePath)) !== path.resolve(entry.filePath)) throw new Error("API_ARCHIVE_IDENTITY_INVALID");
    const raw = await readFile(event), handoff = JSON.parse(raw.toString("utf8")) as BrowserHandoff;
    if (apiSha(raw) !== entry.handoffSha256 || handoff.runId !== state.runId || handoff.module !== moduleKey
      || handoff.filePath !== entry.filePath || !isDeepStrictEqual(handoff.downloadProvenance, entry.provenance)
      || !isDeepStrictEqual(handoff.evidence?.exportTaskBinding, entry.binding) || handoff.expectedSourceRows !== entry.sourceRows
      || handoff.evidence?.directPayloadSha256 !== entry.payloadSha256) throw new Error("API_ARCHIVE_CHANGED");
    const bytes = await readFile(entry.filePath);
    if (apiSha(bytes) !== entry.provenance.sha256 || bytes.length !== entry.provenance.bytes) throw new Error("API_ARCHIVE_CHANGED");
  }
  return true;
}

export async function repairOriginalApiFile(options: Pick<ApiExportOptions, "runId" | "runDate" | "asOfDate" | "salesStartDate" | "outputRoot" | "eventRoot" | "downloadDirectory" | "assertOwned"> & { module: JackyunModule },
  deps: { http?: JackyunHttpSession; tenantId?: string; download?: Parameters<typeof downloadSignedOssExport>[1] } = {}) {
  const state = await readJsonFileOr<ApiState | null>(path.join(options.outputRoot, options.runId, "api-controller-state.json"), null);
  const entry = state?.modules[options.module];
  if (!state || ![1, 2].includes(state.version) || state.runId !== options.runId || state.runDate !== options.runDate || state.asOfDate !== options.asOfDate
    || state.salesStartDate !== options.salesStartDate || state.templateSha256 !== apiSha(JSON.stringify(calibratedTemplates))
    || entry?.status !== "handed_off" || !entry.binding || !entry.filePath || !entry.provenance || !entry.handoffSha256) return false;
  const originalProvenance = entry.provenance;
  const eventPath = path.join(options.eventRoot, options.runId, `${String(jackyunModuleOrder.indexOf(options.module) + 1).padStart(2, "0")}-${options.module}.json`);
  const eventRaw = await readFile(eventPath), handoff = JSON.parse(eventRaw.toString("utf8")) as BrowserHandoff;
  if (apiSha(eventRaw) !== entry.handoffSha256 || handoff.filePath !== entry.filePath || !isDeepStrictEqual(handoff.downloadProvenance, entry.provenance)
    || !isDeepStrictEqual(handoff.evidence?.exportTaskBinding, entry.binding)
    || path.dirname(path.resolve(entry.filePath)) !== path.resolve(options.downloadDirectory, "jackyun", options.runId, options.module)) throw new Error("JACKYUN_FILE_REPAIR_MANUAL_ACTION：原任务和交接记录无法证明文件身份，禁止认领孤立文件。");
  const info = await lstat(entry.filePath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512 * 1024 * 1024)) throw new Error("原文件身份异常，需要人工核查，禁止覆盖。");
  const corrupt = info ? await readFile(entry.filePath) : null;
  if (corrupt && apiSha(corrupt) === entry.provenance.sha256 && corrupt.length === entry.provenance.bytes) return false;
  const assertOwned = options.assertOwned ?? (async () => undefined);
  await assertOwned();
  const repairDir = path.join(options.outputRoot, options.runId, "file-repairs", options.module, randomUUID()); await mkdir(repairDir, { recursive: true });
  if (corrupt) { const fd = await open(path.join(repairDir, "corrupt-original.xlsx"), "wx"); try { await fd.writeFile(corrupt); await fd.sync(); } finally { await fd.close(); } }
  await writeJsonAtomic(path.join(repairDir, "intent.json"), { version: "jackyun-exact-file-repair-v1", runId: options.runId, module: options.module,
    originalHandoffSha256: entry.handoffSha256, originalFileSha256: entry.provenance.sha256, originalBytes: entry.provenance.bytes,
    observedCorruptSha256: corrupt ? apiSha(corrupt) : null, originalTask: entry.binding }, true);
  const recover = async (http: JackyunHttpSession, tenantId: string) => {
    if (state.tenantId !== tenantId) throw new Error("API_TENANT_BINDING_CHANGED");
    await assertOwned();
    const scope = await readApiScope(http, calibratedTemplates as ApiTemplates, tenantId);
    if (scope.permissionSha256 !== entry.permissionSha256) throw new Error("API_FIELD_PERMISSIONS_CHANGED_RECALIBRATE");
    const params = buildApiParameters(options.module, (calibratedTemplates as ApiTemplates).modules[options.module], scope, options.asOfDate, options.salesStartDate);
    if (apiSha(JSON.stringify(params.query)) !== entry.querySha256) throw new Error("原附件参数或授权范围变化，需要人工核查。");
    const snapshot = await readDirectTasks(http, options.module, apiTaskWindowStart(entry.serverClock, entry.exportIntentAt!));
    await assertOwned();
    const selected = selectNewWebSessionTask(snapshot, { module: options.module, sourceRows: entry.sourceRows, exportIntentAt: apiTaskWindowStart(entry.serverClock, entry.exportIntentAt!),
      observedAt: apiTaskWindowObserved(entry.serverClock, new Date().toISOString()), baselineIds: entry.baselineIds, pendingTaskId: entry.binding!.taskId,
      allowedHosts: ["jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com"] });
    if (!selected.result || ["taskId", "module", "label", "createdAt", "sourceRows"].some(k => selected.result!.binding[k as keyof JackyunExportTaskBinding] !== entry.binding![k as keyof JackyunExportTaskBinding])) throw new Error("原附件尚未确认有效，需要核查唯一 taskId；禁止重新导出。");
    const downloaded = await downloadSignedOssExport({ url: selected.result.url, downloadDirectory: options.downloadDirectory, runId: options.runId, module: options.module,
      policyVersion: jackyunExportFirstPolicyVersion, exportIntentAt: entry.exportIntentAt!, allowedHosts: ["jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com"], assertOwned }, deps.download);
    if (downloaded.provenance.sha256 !== originalProvenance.sha256 || downloaded.provenance.bytes !== originalProvenance.bytes) throw new Error("原任务附件内容变化，已保留新旧证据，禁止混入原校验集合。");
    await assertOwned();
    const temp = `${entry.filePath}.${randomUUID()}.tmp`, fd = await open(temp, "wx");
    try { await fd.writeFile(await readFile(downloaded.filePath)); await fd.sync(); } finally { await fd.close(); }
    await publishDurableFile(temp, entry.filePath!); await assertOwned();
    await writeJsonAtomic(path.join(repairDir, "restored.json"), { version: "jackyun-exact-file-repair-v1", restoredOriginalBytes: true,
      originalFileSha256: originalProvenance.sha256, originalHandoffSha256: entry.handoffSha256, freshTaskBinding: selected.result.binding, download: downloaded.provenance }, true);
    return true;
  };
  return deps.http && deps.tenantId ? recover(deps.http, deps.tenantId) : withJackyunApiSession(recover);
}

export async function inspectSubmittedApiTask(options: { runId: string; outputRoot: string; allowedHosts: string[]; binding?: JackyunExportTaskBinding },
  deps: { http?: JackyunHttpSession; tenantId?: string } = {}) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(options.runId) || !path.isAbsolute(options.outputRoot)
    || !Array.isArray(options.allowedHosts) || !options.allowedHosts.length) throw new Error("API_RESUME_SCOPE_INVALID");
  const statePath = path.join(options.outputRoot, options.runId, "api-controller-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as ApiState;
  const entry = state.modules.inventory;
  if (state.version !== 1 || state.runId !== options.runId || state.transport !== jackyunApiTransport
    || state.templateSha256 !== apiSha(JSON.stringify(calibratedTemplates)) || Object.keys(state.modules).length !== 1
    || !state.tenantId || entry?.status !== "submitted" || !entry.exportIntentAt
    || (entry.pendingTaskId === undefined) !== (entry.binding === undefined)
    || entry.pendingTaskId !== undefined && (entry.pendingTaskId !== entry.binding?.taskId || entry.binding.module !== "inventory"
      || entry.binding.sourceRows !== entry.sourceRows || entry.baselineIds.includes(entry.binding.taskId))
    || entry.filePath || entry.provenance || entry.handoffSha256 || !Number.isSafeInteger(entry.sourceRows) || entry.sourceRows <= 0
    || !Array.isArray(entry.baselineIds) || new Set(entry.baselineIds).size !== entry.baselineIds.length
    || !entry.baselineIds.every(value => /^sys-\d{1,20}$/.test(value))) throw new Error("API_RESUME_STATE_INVALID");
  const inspect = async (http: JackyunHttpSession, tenantId: string) => {
    if (state.tenantId !== tenantId) throw new Error("API_TENANT_BINDING_CHANGED");
    const taskWindowStartAt = apiTaskWindowStart(entry.serverClock, entry.exportIntentAt!);
    const snapshot = await readDirectTasks(http, "inventory", taskWindowStartAt);
    const selected = selectNewWebSessionTask(snapshot, { module: "inventory", sourceRows: entry.sourceRows,
      exportIntentAt: taskWindowStartAt, observedAt: apiTaskWindowObserved(entry.serverClock, new Date().toISOString()),
      allowedHosts: options.allowedHosts, baselineIds: entry.baselineIds,
      pendingTaskId: entry.pendingTaskId ?? options.binding?.taskId, binding: entry.binding ?? options.binding });
    if (!selected.result) throw new Error(selected.taskId ? "API_ORIGINAL_EXPORT_TASK_PENDING" : "API_ORIGINAL_EXPORT_TASK_NOT_FOUND");
    return selected.result.binding;
  };
  return deps.http && deps.tenantId ? inspect(deps.http, deps.tenantId) : withJackyunApiSession(inspect);
}
