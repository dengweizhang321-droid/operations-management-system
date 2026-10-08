import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { jdCustomerServiceWorkflow as contract, customerServicePeriod, assertCustomerServicePeriod, JdCustomerServiceWorkflowError, type CustomerServicePeriod } from "../lib/jd/customer-service-workflow";
import { customerServiceStore } from "../lib/jd/customer-service-stores";
import { withJdChromiumRunLock, defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { launchDedicatedChrome, closeChromeBrowser } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { jdBrowserLaunchMode } from "../lib/jd/browser-mode";
import { ensureJdStoreAuthenticatedSession } from "./jd-saved-login";
import { assertCustomerServiceShop, exportCustomerServiceView, openCustomerServicePage, type CustomerServiceExportCheckpoint } from "./jd-customer-service-export";
import { buildCustomerServiceDailyFiles } from "./jd-customer-service-daily-files";
import { importCustomerServiceDay, verifyCustomerServiceBatch, type CustomerServiceBatchProof } from "./jd-customer-service-import";

export type CustomerServiceN8nPlan = {
  storeKey?: string; shopId?: string; shopName?: string;
  version: 1; executionId: string; period: CustomerServicePeriod;
  createdAt: string; updatedAt: string;
  stage: "planned" | "running" | "executed" | "completed" | "failed";
  source: Partial<Record<"list" | "messages", CustomerServiceExportCheckpoint>>;
  importingDate?: string;
  proofs: CustomerServiceBatchProof[];
  sourceSessionSha256?: string; sourceChatSha256?: string;
  sourceCounts?: { listRows: number; logSessions: number; ambiguous: number };
  dailyFiles?: Array<{ date: string; sessionSha256: string; chatSha256: string; contentSha256: string; conversationCount: number }>;
  failureCode?: string;
};
function reject(code: string): never { throw new JdCustomerServiceWorkflowError(code); }
function filePaths(root: string, executionId: string, storeKey = contract.storeKey as string) {
  const store = customerServiceStore(storeKey);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(executionId)) reject("INVALID_EXECUTION_ID");
  const base = path.join(root, "outputs", "jd-customer-service-pipeline");
  const directory = store.storeKey === contract.storeKey ? base : path.join(base, store.storeKey);
  return { directory, plan: path.join(directory, `${executionId}.json`), active: path.join(directory, "active.json"), lock: path.join(directory, "planning.lock") };
}
export function customerServiceHelperError(stage: string, busy: boolean, route: string, executionId: string | null, owner: string | null) {
  if (!executionId || !/^[A-Za-z0-9_-]{1,96}$/.test(executionId)) return { error: "invalid_execution_id" };
  if (!owner || executionId !== owner) return { error: "execution_mismatch" };
  if (busy) return { error: "pipeline_busy" };
  const expected = stage === "ready" ? "plan" : stage === "planned" ? "run" : stage === "executed" ? "verify" : null;
  return expected && route === `/jd/customer-service/${expected}` ? null : { error: "customer_service_stage_mismatch" };
}
export async function planCustomerServiceRun(root: string, executionId: string, now = new Date(), storeKey = contract.storeKey as string) {
  const store = customerServiceStore(storeKey);
  const files = filePaths(root, executionId, store.storeKey);
  await mkdir(files.directory, { recursive: true });
  return withJackyunRunLock({ runId: `cs-plan-${executionId}`, purpose: "jd-customer-service-plan", lockDirectory: files.lock }, async () => {
    let active: { executionId?: string } | undefined;
    try { active = JSON.parse(await readFile(files.active, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") reject("ACTIVE_PLAN_INVALID_MANUAL_ACTION"); }
    if (active) {
      if (typeof active.executionId !== "string") reject("ACTIVE_PLAN_INVALID_MANUAL_ACTION");
      const previous = JSON.parse(await readFile(filePaths(root, active.executionId, store.storeKey).plan, "utf8")) as CustomerServiceN8nPlan;
      if (previous.executionId !== active.executionId || previous.version !== 1) reject("ACTIVE_PLAN_INVALID_MANUAL_ACTION");
      assertCustomerServicePlanStore(previous, store.storeKey);
      if (previous.stage !== "completed") reject("PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION");
    }
    const createdAt = new Date().toISOString();
    const plan: CustomerServiceN8nPlan = { version: 1, storeKey: store.storeKey, shopName: store.shopName, shopId: store.shopId, executionId, period: customerServicePeriod(now), createdAt, updatedAt: createdAt, stage: "planned", source: {}, proofs: [] };
    await writeFile(files.plan, JSON.stringify(plan), { flag: "wx" });
    await writeJsonAtomic(files.active, { executionId });
    return plan;
  });
}
export function assertCustomerServicePlanStore(plan: CustomerServiceN8nPlan, expectedKey = plan.storeKey ?? contract.storeKey) {
  assertCustomerServicePeriod(plan.period);
  const store = customerServiceStore(expectedKey);
  if ((plan.storeKey ?? contract.storeKey) !== store.storeKey
    || (plan.storeKey !== undefined && (plan.shopName !== store.shopName || plan.shopId !== store.shopId))
    || (plan.storeKey === undefined && (plan.shopName !== undefined || plan.shopId !== undefined))) reject("PLAN_STORE_IDENTITY_MISMATCH_MANUAL_ACTION");
  return store;
}
export async function runCustomerServicePlan(root: string, plan: CustomerServiceN8nPlan) {
  const identity = assertCustomerServicePlanStore(plan);
  if (plan.stage !== "planned" || plan.proofs.length || Object.keys(plan.source).length) reject("RUN_REPLAY_REQUIRES_RECONCILIATION_MANUAL_ACTION");
  const files = filePaths(root, plan.executionId, identity.storeKey);
  const save = () => { plan.updatedAt = new Date().toISOString(); return writeJsonAtomic(files.plan, plan); };
  plan.stage = "running"; await save();
  try {
    await withJdChromiumRunLock("jd-customer-service", async () => {
      const registry = JSON.parse(await readFile(path.join(root, "config", "jd-store-accounts.json"), "utf8"));
      const store = validateJdStoreRegistry(registry, root).find(item => item.storeKey === identity.storeKey);
      if (!store?.enabled || store.shopName !== identity.shopName || store.shopId !== identity.shopId) reject("STORE_REGISTRY_MISMATCH_MANUAL_ACTION");
      const downloadDirectory = path.join(store.browser.downloadDir, "customer-service", plan.executionId);
      let ownsBrowser = false;
      let browser: Awaited<ReturnType<typeof connectPlaywrightBrowser>> | undefined;
      try {
        ownsBrowser = Boolean(await launchDedicatedChrome({ executablePath: store.browser.executablePath,
          profileDirectory: store.browser.userDataDir, profileName: store.browser.profileName,
          port: store.browser.debugPort, startUrl: "about:blank", ...jdBrowserLaunchMode(false) }));
        if (!ownsBrowser) reject("DEDICATED_BROWSER_ALREADY_IN_USE_MANUAL_ACTION");
        browser = await connectPlaywrightBrowser(store.browser.debugPort);
        const contexts = browser.contexts();
        if (contexts.length !== 1) reject("BROWSER_CONTEXT_AMBIGUOUS_MANUAL_ACTION");
        const page = await contexts[0].newPage();
        await page.setViewportSize({ width: 1920, height: 1080 });
        await openCustomerServicePage(page, () => ensureJdStoreAuthenticatedSession(page, store), identity.storeKey);
        const assertStore = async () => { await assertCustomerServiceShop(page, false, identity.storeKey); };
        for (const view of ["list", "messages"] as const) {
          await exportCustomerServiceView({ page, period: plan.period, view, downloadDirectory, assertStore,
            checkpoint: async checkpoint => { plan.source[view] = { ...checkpoint, observedAt: new Date().toISOString() }; await save(); } });
        }
      } finally {
        try { await browser?.close(); }
        finally { if (ownsBrowser) await closeChromeBrowser(store.browser.debugPort); }
      }
      const sessions = plan.source.list; const chats = plan.source.messages;
      if (!sessions?.savedPath || !chats?.savedPath || sessions.phase !== "downloaded" || chats.phase !== "downloaded"
        || sessions.sourceCount !== chats.sourceCount) reject("PAIRED_EXPORT_EVIDENCE_MISMATCH_MANUAL_ACTION");
      const sourceSessionBytes = await readFile(sessions.savedPath); const sourceChatBytes = await readFile(chats.savedPath);
      const daily = buildCustomerServiceDailyFiles(sourceSessionBytes, sourceChatBytes, plan.period, identity.storeKey);
      if (daily.sourceSessionSha256 !== sessions.sha256 || daily.sourceChatSha256 !== chats.sha256
        || daily.summary.sessionCount !== sessions.sourceCount) reject("SOURCE_FILE_EVIDENCE_MISMATCH_MANUAL_ACTION");
      plan.sourceSessionSha256 = daily.sourceSessionSha256; plan.sourceChatSha256 = daily.sourceChatSha256;
      plan.sourceCounts = { listRows: daily.summary.sessionCount, logSessions: daily.summary.chatSessionCount, ambiguous: daily.summary.ambiguousCount };
      plan.dailyFiles = daily.files.map(({ date, sessionSha256, chatSha256, contentSha256, conversationCount }) => ({ date, sessionSha256, chatSha256, contentSha256, conversationCount }));
      await save();
      for (const day of daily.files) {
        await writeFile(path.join(downloadDirectory, `${day.date}.xlsx`), day.sessionBytes, { flag: "wx" });
        await writeFile(path.join(downloadDirectory, `${day.date}.log`), day.chatBytes, { flag: "wx" });
        plan.importingDate = day.date; await save();
        const proof = await importCustomerServiceDay(day, "http://localhost:3000", fetch, identity.storeKey);
        plan.proofs.push(proof); await save();
        await verifyCustomerServiceBatch(proof, "http://localhost:3000", fetch, identity.storeKey);
        delete plan.importingDate; await save();
      }
    }, defaultJdChromiumRunLockDirectory(root));
    plan.stage = "executed"; await save();
    return publicCustomerServicePlan(plan);
  } catch (error) {
    plan.stage = "failed";
    plan.failureCode = error instanceof JdCustomerServiceWorkflowError ? error.code : "CUSTOMER_SERVICE_FAILED_MANUAL_ACTION";
    await save();
    // Do not let browser exceptions leak page text or signed download URLs.
    reject(`${plan.failureCode}_MANUAL_ACTION`);
  }
}
export async function verifyCustomerServicePlan(root: string, plan: CustomerServiceN8nPlan) {
  const identity = assertCustomerServicePlanStore(plan);
  if (plan.stage !== "executed" || plan.importingDate || !plan.dailyFiles?.length
    || plan.proofs.length !== plan.dailyFiles.length) reject("INCOMPLETE_PLAN_MANUAL_ACTION");
  const session = plan.source.list; const chat = plan.source.messages;
  if (!session?.savedPath || !chat?.savedPath) reject("SOURCE_FILES_MISSING_MANUAL_ACTION");
  const digest = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
  if (await digest(session.savedPath) !== plan.sourceSessionSha256 || await digest(chat.savedPath) !== plan.sourceChatSha256) reject("SOURCE_HASH_CHANGED_MANUAL_ACTION");
  for (let index = 0; index < plan.dailyFiles.length; index++) {
    const day = plan.dailyFiles[index]; const proof = plan.proofs[index];
    if (day.date !== proof.date || day.conversationCount !== proof.conversationCount) reject("DAILY_BATCH_SCOPE_MISMATCH_MANUAL_ACTION");
    const directory = path.dirname(session.savedPath);
    if (await digest(path.join(directory, `${day.date}.xlsx`)) !== day.sessionSha256
      || await digest(path.join(directory, `${day.date}.log`)) !== day.chatSha256) reject("DAILY_FILE_HASH_CHANGED_MANUAL_ACTION");
    await verifyCustomerServiceBatch(proof, "http://localhost:3000", fetch, identity.storeKey);
  }
  plan.stage = "completed"; plan.updatedAt = new Date().toISOString(); await writeJsonAtomic(filePaths(root, plan.executionId, identity.storeKey).plan, plan);
  return publicCustomerServicePlan(plan);
}
export function publicCustomerServicePlan(plan: CustomerServiceN8nPlan) {
  const store = assertCustomerServicePlanStore(plan);
  return { ok: true, stage: plan.stage, executionId: plan.executionId, storeKey: store.storeKey, shopName: store.shopName,
    period: plan.period, importedDays: plan.proofs.length,
    sourceCounts: plan.sourceCounts,
    conversationCount: plan.proofs.reduce((sum, proof) => sum + proof.conversationCount, 0),
    warningTotalCount: plan.proofs.reduce((sum, proof) => sum + proof.warningTotalCount, 0) };
}
