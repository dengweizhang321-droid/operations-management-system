import { readFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeChromeBrowser, launchDedicatedChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, PlaywrightPageClient } from "../lib/jackyun/playwright-client";
import { readJackyunLoginConfig } from "../lib/jackyun/windows-dpapi";
import { inspectJackyunLoginSurface, submitJackyunDpapiLogin, verifyJackyunBrowserBinding, waitForJackyunDpapiSession, isJackyunLoginOrigin, resolveJackyunChromiumExecutable } from "../lib/jackyun/dpapi-login";
import { createDirectSession, readDirectTasks } from "../lib/jackyun/direct-export";
import { apiTaskWindowStart } from "../lib/jackyun/api-clock";
import type { JackyunServerClock, JackyunHttpSession } from "../lib/jackyun/direct-http";
import { apiSha, jackyunApiTransport, readApiScope, prepareApiExport, type ApiTemplates } from "../lib/jackyun/api-plan";
import { selectNewWebSessionTask } from "../lib/jackyun/web-session-export";
import { downloadSignedOssExport } from "../lib/jackyun/oss-download";
import { assertBoundDownloadProvenance, type JackyunDownloadProvenance } from "../lib/jackyun/download-provenance";
import type { JackyunExportTaskBinding } from "../lib/jackyun/export-task";
import { jackyunCaptureDate, jackyunExportFirstPolicyVersion, jackyunExportOrder, type JackyunCurrentSnapshotEvidence } from "../lib/jackyun/run-contract";
import { jackyunModuleOrder, type JackyunModule } from "../lib/jackyun/post-download";
import calibratedTemplates from "../config/jackyun-api-templates.json";
import { readJsonFileOr, writeJsonAtomic } from "../lib/jackyun/json-file";
import type { BrowserHandoff } from "./jackyun-daily-runner";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type ModuleState = { status: "prepared" | "submit_intent" | "submitted" | "handed_off"; preflightStartedAt: string; queryIntentAt: string; queryCompletedAt: string;
  sourceRows: number; payloadSha256: string; querySha256: string; permissionSha256: string; templateSha256: string; baselineIds: string[];
  serverClock?: JackyunServerClock; exportIntentAt?: string; pendingTaskId?: string; binding?: JackyunExportTaskBinding; filePath?: string; provenance?: JackyunDownloadProvenance; handoffSha256?: string };
type ApiState = { version: 1; runId: string; tenantId?: string; transport: typeof jackyunApiTransport; runDate: string; asOfDate: string; templateSha256: string; modules: Partial<Record<JackyunModule, ModuleState>> };
export type ApiExportOptions = { runId: string; runDate: string; asOfDate: string; outputRoot: string; eventRoot: string; downloadDirectory: string;
  beforeModule?: (module: JackyunModule) => Promise<void>; afterModule?: (module: JackyunModule) => Promise<void>; signal?: AbortSignal };

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
      const pages = context.pages().filter(page => page.url() === "about:blank" || isJackyunLoginOrigin(page.url()));
      if (pages.length !== 1) throw new Error("API_LOGIN_PAGE_NOT_UNIQUE");
      const page = pages[0];
      if (page.url() === "about:blank") await page.goto("https://web.jackyun.com/home/mainframe_web_horizontal.html", { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForJackyunDpapiSession({ inspect: () => inspectJackyunLoginSurface(page, login.tenantId), submit: () => submitJackyunDpapiLogin(page, login), initialWaitMs: login.initialWaitMs, afterSubmitWaitMs: login.afterSubmitWaitMs });
      client = new PlaywrightPageClient(page, await context.newCDPSession(page));
      await context.setOffline(true);
      return await callback(await createDirectSession(client, login.tenantId), login.tenantId);
    } finally {
      await context.setOffline(false); client?.close(); await browser.close();
    }
  } finally {
    if (ownedBrowserVerified) await closeChromeBrowser(login.debuggingPort);
    else launched.kill();
  }
}

export async function runApiExports(options: ApiExportOptions, deps: { http?: JackyunHttpSession; tenantId?: string; templates?: ApiTemplates; taskTimeoutMs?: number; pollIntervalMs?: number } = {}) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(options.runId) || jackyunCaptureDate(new Date().toISOString()) !== options.runDate
    || new Date(Date.parse(options.runDate + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) !== options.asOfDate) throw new Error("API_RUN_SCOPE_INVALID");
  const templates = deps.templates ?? calibratedTemplates as ApiTemplates;
  const templateSha256 = apiSha(JSON.stringify(templates));
  const runDirectory = path.join(options.outputRoot, options.runId), eventDirectory = path.join(options.eventRoot, options.runId);
  const statePath = path.join(runDirectory, "api-controller-state.json");
  const state = await readJsonFileOr<ApiState>(statePath, { version: 1, runId: options.runId, transport: jackyunApiTransport, runDate: options.runDate, asOfDate: options.asOfDate, templateSha256, modules: {} });
  if (state.version !== 1 || state.runId !== options.runId || state.transport !== jackyunApiTransport || state.templateSha256 !== templateSha256
    || state.runDate !== options.runDate || state.asOfDate !== options.asOfDate) throw new Error("API_RUN_BINDING_CHANGED");
  const allowedHosts = ["jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com"];
  const execute = async (http: JackyunHttpSession, tenantId: string) => {
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
    }
    for (const moduleKey of jackyunExportOrder) {
      options.signal?.throwIfAborted();
      if (jackyunCaptureDate(new Date().toISOString()) !== options.runDate) throw new Error("API_CAPTURE_DATE_CHANGED");
      await options.beforeModule?.(moduleKey);
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
        const preflightStartedAt = new Date().toISOString();
        const prepared = await prepareApiExport(http, templates, scope, moduleKey, options.runDate, options.asOfDate);
        const validationData = { ...prepared.data }; delete validationData.isSyn;
        const validation = await http.request<{ data: unknown; noPrivilegeItem: unknown; desensitizationItem: unknown }>("validateExport", validationData, prepared.moduleCode);
        if (validation.data !== null || validation.noPrivilegeItem !== null || validation.desensitizationItem !== null) throw new Error("API_EXPORT_VALIDATION_CHANGED");
        const baseline = await readDirectTasks(http, moduleKey);
        const serverClock = http.serverClock;
        entry = { status: "prepared", serverClock, preflightStartedAt, queryIntentAt: prepared.queryIntentAt, queryCompletedAt: prepared.queryCompletedAt, sourceRows: prepared.sourceRows,
          payloadSha256: prepared.payloadSha256, querySha256: prepared.querySha256, permissionSha256: scope.permissionSha256, templateSha256, baselineIds: baseline.records.map(row => row.taskId) };
        state.modules[moduleKey] = entry;
        await mkdir(runDirectory, { recursive: true });
        await writeJsonAtomic(statePath, state);
        if (jackyunCaptureDate(new Date().toISOString()) !== options.runDate) throw new Error("API_CAPTURE_DATE_CHANGED");
        entry.status = "submit_intent"; entry.exportIntentAt = new Date().toISOString();
        apiTaskWindowStart(entry.serverClock, entry.exportIntentAt);
        await writeJsonAtomic(statePath, state);
        // Never replay this POST, including after an uncertain response/process restart.
        await http.request("submitExport", prepared.data, prepared.moduleCode);
        entry.status = "submitted";
        await writeJsonAtomic(statePath, state);
      }
      const taskWindowStartAt = apiTaskWindowStart(entry.serverClock, entry.exportIntentAt!);
      const deadline = Date.now() + (deps.taskTimeoutMs ?? 300000);
      let selected: ReturnType<typeof selectNewWebSessionTask>["result"] = null;
      while (Date.now() < deadline) {
        options.signal?.throwIfAborted();
        const snapshot = await readDirectTasks(http, moduleKey, taskWindowStartAt);
        const task = selectNewWebSessionTask(snapshot, { module: moduleKey, sourceRows: entry.sourceRows, exportIntentAt: taskWindowStartAt, observedAt: new Date().toISOString(), allowedHosts,
          baselineIds: entry.baselineIds, pendingTaskId: entry.pendingTaskId, binding: entry.binding });
        if (task.taskId && !entry.pendingTaskId) { entry.pendingTaskId = task.taskId; await writeJsonAtomic(statePath, state); }
        if (task.result) { selected = task.result; break; }
        await new Promise(resolve => setTimeout(resolve, deps.pollIntervalMs ?? 1500));
      }
      if (!selected) throw new Error("API_ORIGINAL_EXPORT_TASK_PENDING");
      entry.binding = selected.binding; await writeJsonAtomic(statePath, state);
      const downloaded = await downloadSignedOssExport({ url: selected.url, downloadDirectory: options.downloadDirectory, runId: options.runId, module: moduleKey,
        policyVersion: jackyunExportFirstPolicyVersion, exportIntentAt: entry.exportIntentAt!, allowedHosts, timeoutMs: 300000 });
      entry.filePath = downloaded.filePath; entry.provenance = downloaded.provenance;
      const snapshotEvidence: JackyunCurrentSnapshotEvidence | undefined = moduleKey === "inventory" || moduleKey === "inventory_age" ? {
        version: 1, module: moduleKey, runId: options.runId, source: "current_query", targetDate: options.runDate, queryIntentAt: entry.queryIntentAt,
        queryRefreshSource: "module_network_request", queryRefreshCompletedAt: entry.queryCompletedAt, tableStableAt: entry.queryCompletedAt,
      } : undefined;
      const fieldChecks = moduleKey === "sales" ? [{ field: "统计时间类型", value: "发货时间", verifiedAt: entry.queryCompletedAt }, { field: "日期区间", value: `${options.asOfDate.slice(0, 8)}01 00:00:00 至 ${options.asOfDate} 23:59:59`, verifiedAt: entry.queryCompletedAt }]
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
      await mkdir(eventDirectory, { recursive: true }); await writeJsonAtomic(eventPath, handoff);
      entry.handoffSha256 = apiSha(await readFile(eventPath, "utf8")); entry.status = "handed_off"; await writeJsonAtomic(statePath, state);
      await options.afterModule?.(moduleKey);
      console.log(JSON.stringify({ module: moduleKey, status: "handed_off", rows: entry.sourceRows, elapsedMs: Date.now() - Date.parse(entry.preflightStartedAt) }));
    }
    return { status: "exported" as const, runId: options.runId, transport: jackyunApiTransport, statePath };
  };
  return deps.http && deps.tenantId ? execute(deps.http, deps.tenantId) : withJackyunApiSession(execute);
}
