import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Dialog, Frame, Locator, Page } from "playwright-core";

import { launchDedicatedChrome } from "../lib/jackyun/cdp-client";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { inspectTmallImportBytes } from "../lib/netshop/import-service";
import { netshopOutletKey } from "../lib/netshop/query-contract";
import {
  getRegisteredTmallStore,
  getTmallStore,
  resolveTmallBrowserLaunchTarget,
  type TmallStore,
} from "../lib/netshop/tmall-store-registry";
import { shanghaiYesterday } from "./tmall-multi-store-import-runner";
import {
  createTmallBrowserDownloadSession,
  ensureTmallSellerSession,
  isTmallSellerBusinessUrl,
  TMALL_SELLER_ON_SALE_URL,
} from "./tmall-product-master-export";

export const TMALL_PROMOTION_HOME_URL = "https://one.alimama.com/index.html";
export const TMALL_PROMOTION_ENTRY_URL = TMALL_SELLER_ON_SALE_URL;
export const TMALL_PROMOTION_DOWNLOAD_LIST_URL = "https://one.alimama.com/index.html?spm=a21dvs.28711903.0.d53b8f72b.7a7362ddGBIZmC#!/report/download-list";
export const promotionSuccessNavigationMissingMessage = "确认生成报表后未出现包含“离线数据生成成功”的唯一前往下载提示";
const TMALL_PROMOTION_SELLER_GOODS_URL = "https://myseller.taobao.com/home.htm/alltaopromotion/";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(projectRoot, "outputs", "tmall-promotion-export");
const defaultChromeExecutable = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const maximumDownloadBytes = 25 * 1024 * 1024;
const maximumDaysPerRun = 30;
const reportGenerationTimeoutMs = 10 * 60 * 1000;
const reportRefreshIntervalMs = 8_000;

export function chooseTmallPromotionEntryPageIndex(urls: readonly string[]) {
  const sellerIndex = urls.findIndex((url) => isTmallSellerBusinessUrl(url));
  if (sellerIndex >= 0) return sellerIndex;
  return urls.findIndex((url) => /one\.alimama\.com/i.test(url));
}

type PromotionCoveragePayload = {
  requestedPeriod?: { startDate?: string | null; endDate?: string | null };
  coverage?: {
    promotionDates?: unknown;
    productDailyDates?: unknown;
  };
};

export type PromotionDatePlan = {
  startDate: string;
  endDate: string;
  dates: string[];
};

export type PromotionDownloadTaskChoice = {
  signature: string;
  fileName: string;
  status: string;
  startDate: string;
  endDate: string;
  createdAt: string | null;
  downloadReady: boolean;
};

type PromotionDownloadTaskCandidate = PromotionDownloadTaskChoice & {
  locator: Locator | null;
  contextText: string;
};

type PromotionFileEvidence = {
  fileName: string;
  filePath: string;
  size: number;
  sha256: string;
  rowCount: number;
  dateMin: string;
  dateMax: string;
};

type PromotionAuditStage =
  | "planned"
  | "browser_ready"
  | "dialog_opening"
  | "dialog_ready"
  | "report_configured"
  | "report_submitting"
  | "report_submitted"
  | "downloaded"
  | "importing"
  | "completed"
  | "failed";

type PromotionResumeStage = Exclude<PromotionAuditStage, "failed" | "completed">;

type PromotionExportAudit = {
  version: 1;
  runId: string;
  storeKey: string;
  shopName: string;
  baseUrl: string;
  startedAt: string;
  updatedAt: string;
  stage: PromotionAuditStage;
  resumeStage?: PromotionResumeStage;
  startDate: string;
  endDate: string;
  dates: string[];
  metrics: "全部数据指标";
  downloadListUrl: string;
  dismissedPopups: number;
  dialogAttempts?: number;
  dialogDiagnostic?: PromotionDialogDiagnostic;
  file?: PromotionFileEvidence;
  batchId?: string;
  importStatus?: "imported" | "duplicate";
  warningCount?: number;
  error?: string;
};

type PromotionDialogDiagnostic = {
  capturedAt: string;
  attempts: number;
  pageLocation: string;
  frameCount: number;
  downloadButtonCandidates: number;
  roleDialogCandidates: number;
  modalRootCandidates: number;
  titleCandidates: number;
  screenshotFile?: string;
  screenshotStatus: "saved" | "failed";
};

type PromotionImportPayload = {
  ok?: boolean;
  status?: string;
  message?: string;
  batch?: {
    id?: string;
    source?: string;
    dataset?: string;
    platform?: string;
    shopName?: string;
    status?: string;
    rowCount?: number;
    warningCount?: number;
    dateMin?: string | null;
    dateMax?: string | null;
  };
  verification?: {
    verified?: boolean;
    parsedRowCount?: number;
    readbackRowCount?: number;
    dataset?: string;
    platform?: string;
    shopName?: string;
    dateMin?: string | null;
    dateMax?: string | null;
  };
};

type BoundingBox = { x: number; y: number; width: number; height: number };

type PositionedAction = {
  locator: Locator;
  frame: Frame;
  box: BoundingBox;
  label: string;
  signature: string;
  score: number;
};

function validDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function safeSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "-").slice(0, 80) || "tmall";
}

function inside(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("天猫推广工作流只允许连接本机运营系统");
  }
  return url.toString().replace(/\/$/, "");
}

function assertIsoDateArray(value: unknown, field: string, startDate: string, endDate: string) {
  if (!Array.isArray(value)) throw new Error(`推广覆盖响应 ${field} 不是日期数组`);
  for (const item of value) {
    if (typeof item !== "string" || !validDate(item)) {
      throw new Error(`推广覆盖响应 ${field} 包含非法日期`);
    }
    if (item < startDate || item > endDate) {
      throw new Error(`推广覆盖响应 ${field} 包含请求区间外日期`);
    }
  }
  return [...new Set(value as string[])].sort();
}

export function assertPromotionCoveragePayload(
  payload: PromotionCoveragePayload | null,
  expected: { startDate: string; endDate: string },
) {
  if (!payload?.coverage
    || payload.requestedPeriod?.startDate !== expected.startDate
    || payload.requestedPeriod?.endDate !== expected.endDate) {
    throw new Error("推广覆盖响应的 requestedPeriod 与请求不一致");
  }
  return {
    productDailyDates: assertIsoDateArray(
      payload.coverage.productDailyDates,
      "productDailyDates",
      expected.startDate,
      expected.endDate,
    ),
    promotionDates: assertIsoDateArray(
      payload.coverage.promotionDates,
      "promotionDates",
      expected.startDate,
      expected.endDate,
    ),
  };
}

export function planTmallPromotionDailyReports(input: {
  requestedStartDate: string;
  requestedEndDate: string;
  productDailyDates: readonly string[];
  promotionDates: readonly string[];
  requestedDates?: readonly string[];
  forceExistingDates?: boolean;
  maximumDays?: number;
}): PromotionDatePlan[] {
  if (!validDate(input.requestedStartDate) || !validDate(input.requestedEndDate) || input.requestedStartDate > input.requestedEndDate) {
    throw new Error("推广目标日期范围无效");
  }
  const maximumDays = Math.max(1, Math.min(maximumDaysPerRun, Math.trunc(input.maximumDays ?? maximumDaysPerRun)));
  const productDaily = new Set(input.productDailyDates.filter((date) => (
    validDate(date) && date >= input.requestedStartDate && date <= input.requestedEndDate
  )));
  const requestedDates = input.requestedDates === undefined
    ? null
    : [...new Set(input.requestedDates)].sort();
  if (requestedDates) {
    if (requestedDates.length === 0) throw new Error("推广显式日期清单不能为空");
    if (requestedDates.some((date) => !validDate(date) || date < input.requestedStartDate || date > input.requestedEndDate)) {
      throw new Error("推广显式日期必须位于请求范围内");
    }
    const missingProductDaily = requestedDates.filter((date) => !productDaily.has(date));
    if (missingProductDaily.length > 0) {
      throw new Error(`推广显式日期缺少商品日覆盖：${missingProductDaily.join(", ")}`);
    }
    if (requestedDates.length > maximumDays) {
      throw new Error(`推广显式日期超过单轮 ${maximumDays} 天上限`);
    }
  }
  const candidates = requestedDates ?? [...productDaily].sort();
  return candidates.slice(0, maximumDays).map((date) => ({
    startDate: date,
    endDate: date,
    dates: [date],
  }));
}

/**
 * Backwards-compatible single-report planner. A promotion report is now always
 * restricted to one business day, so callers can never receive a multi-day range.
 */
export function planTmallPromotionDateRange(input: Parameters<typeof planTmallPromotionDailyReports>[0]) {
  return planTmallPromotionDailyReports(input)[0] ?? null;
}

export async function runPromotionDailyPlansSequentially<T>(
  plans: readonly PromotionDatePlan[],
  execute: (plan: PromotionDatePlan, index: number) => Promise<T>,
) {
  const results: T[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]!;
    if (plan.startDate !== plan.endDate || plan.dates.length !== 1 || plan.dates[0] !== plan.startDate) {
      throw new Error("推广报表必须按单个业务日下载，起止日期必须为同一天");
    }
    results.push(await execute(plan, index));
  }
  return results;
}

export function isSafePromotionDismissLabel(value: string) {
  const label = normalizeText(value).replace(/[\s·]/g, "");
  if (!label || /去优化|立即处理|立即参与|立即报名|查看详情|前往|购买|开通|升级/.test(label)) return false;
  return /^(关闭|忽略|暂不|暂不开启|暂不参加|稍后|以后再说|我知道了|知道了|取消|×|✕|close)$/i.test(label);
}

export function promotionNativeDialogAction(input: { type: string; message: string }) {
  const message = normalizeText(input.message)
    .replace(/^提示[:：]\s*/, "")
    .replace(/[。！!]+$/, "");
  const safeInformationalMessages = new Set([
    "暂无数据",
    "当前暂无数据",
    "暂无可下载数据",
    "没有可下载数据",
  ]);
  return input.type === "alert" && safeInformationalMessages.has(message)
    ? "dismiss" as const
    : "stop" as const;
}

export function sanitizePromotionNativeDialogMessage(value: string) {
  const normalized = normalizeText(value)
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[标识已脱敏]")
    .replace(/\b1\d{10}\b/g, "[手机号已脱敏]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[邮箱已脱敏]");
  return (normalized || "空文案").slice(0, 160);
}

export type PromotionMetricSelectionState = {
  checked?: boolean;
  attributeValues?: readonly string[];
  classNames?: readonly string[];
};

export function isPromotionMetricSelectionState(state: PromotionMetricSelectionState) {
  if (state.checked === true) return true;
  if ((state.attributeValues ?? []).some((value) => /^(?:true|checked|selected)$/i.test(value.trim()))) return true;
  return (state.classNames ?? []).some((className) => (
    /(?:^|[-_\s])(?:checked|selected)(?:$|[-_\s])/.test(className.toLowerCase())
  ));
}

function installPromotionNativeDialogGuard(page: Page) {
  const context = page.context();
  const attachedPages = new Set<Page>();
  let failure: Error | null = null;
  let pending = Promise.resolve();
  const onDialog = (dialog: Dialog) => {
    const action = promotionNativeDialogAction({ type: dialog.type(), message: dialog.message() });
    if (action === "stop" && !failure) {
      const diagnostic = sanitizePromotionNativeDialogMessage(dialog.message());
      failure = new Error(`推广页面出现未允许的 ${dialog.type()} 原生对话框（${diagnostic}），已停止本轮`);
    }
    pending = pending.then(async () => {
      await dialog.dismiss().catch(() => undefined);
      const dialogPage = dialog.page();
      if (action === "stop" && dialogPage) await dialogPage.close({ runBeforeUnload: false }).catch(() => undefined);
    });
  };
  const attach = (candidate: Page) => {
    if (attachedPages.has(candidate)) return;
    attachedPages.add(candidate);
    candidate.on("dialog", onDialog);
  };
  const onPage = (candidate: Page) => attach(candidate);
  context.pages().forEach(attach);
  context.on("page", onPage);

  const drain = async () => {
    while (true) {
      const current = pending;
      await current;
      if (current === pending) return;
    }
  };
  return {
    assertSafe: async () => {
      await drain();
      if (failure) throw failure;
    },
    dispose: async () => {
      context.off("page", onPage);
      for (const candidate of attachedPages) candidate.off("dialog", onDialog);
      await drain();
      if (failure) throw failure;
    },
  };
}

export function isPromotionReportSuccessNavigation(input: { label: string; context: string }) {
  const label = normalizeText(input.label).replace(/[\s·]/g, "");
  const context = normalizeText(input.context);
  return /^(立即前往|前往下载|立即前往下载)$/.test(label)
    && /离线数据生成成功/.test(context)
    && /下载任务管理/.test(context);
}

export function shouldRecoverSubmittedPromotionTask(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message === promotionSuccessNavigationMissingMessage
    || error.message === "点击前往下载后出现多个下载任务页面，为防止接管错误页面已停止"
    || error.message === "点击前往下载后未进入下载任务管理页面"
    || (/^locator\.click: Timeout \d+ms exceeded\./.test(error.message)
      && /立即前往|前往下载|element is not stable|detached from the DOM/.test(error.message));
}

export function promotionDatePickerRole(value: string | null | undefined) {
  if (/trigger\s*:\s*['"]start['"]/.test(value ?? "")) return "start" as const;
  if (/trigger\s*:\s*['"]end['"]/.test(value ?? "")) return "end" as const;
  return null;
}

function isPromotionDownloadListPageUrl(value: string) {
  try {
    const url = new URL(value);
    return /(^|\.)one\.alimama\.com$/i.test(url.hostname)
      && /^#!\/report\/download-list(?:[/?]|$)/.test(url.hash);
  } catch {
    return false;
  }
}

function parseShanghaiTaskDate(value: string) {
  const match = value.match(/(?:报表[_-])?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const conventional = value.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (!conventional) return null;
  const parsed = new Date(`${conventional[1]}T${conventional[2].length === 5 ? `${conventional[2]}:00` : conventional[2]}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function chooseTmallPromotionDownloadTask(
  candidates: readonly PromotionDownloadTaskChoice[],
  expected: { startDate: string; endDate: string; runStartedAt: string },
) {
  const startedAt = Date.parse(expected.runStartedAt);
  if (!Number.isFinite(startedAt)) throw new Error("推广任务开始时间无效");
  const matching = candidates.filter((candidate) => {
    const createdAt = candidate.createdAt ? Date.parse(candidate.createdAt) : Number.NaN;
    return candidate.startDate === expected.startDate
      && candidate.endDate === expected.endDate
      && /^(生成成功|已完成)$/.test(normalizeText(candidate.status))
      && candidate.downloadReady
      && Number.isFinite(createdAt)
      && createdAt >= startedAt - 90_000
      && createdAt <= Date.now() + 5 * 60_000;
  }).sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!));
  if (matching.length !== 1) return null;
  return matching[0]!.signature;
}

export function assertPromotionImportPayload(
  payload: PromotionImportPayload,
  httpStatus: number,
  expected: { shopName: string; startDate: string; endDate: string; rowCount: number },
) {
  const batch = payload.batch;
  const verification = payload.verification;
  const importStatus = payload.status === "imported" || payload.status === "duplicate" ? payload.status : null;
  const expectedHttpStatus = importStatus === "imported" ? 201 : importStatus === "duplicate" ? 200 : null;
  if (importStatus === null || expectedHttpStatus === null || httpStatus !== expectedHttpStatus
    || payload.ok !== true || !batch?.id
    || batch.source !== "tmall_promotion" || batch.dataset !== "promotion_daily" || batch.platform !== "天猫"
    || batch.shopName !== expected.shopName || batch.status !== "completed" || batch.rowCount !== expected.rowCount
    || batch.dateMin !== expected.startDate || batch.dateMax !== expected.endDate
    || !Number.isInteger(batch.warningCount ?? 0) || Number(batch.warningCount ?? 0) < 0
    || verification?.verified !== true || verification.parsedRowCount !== expected.rowCount
    || verification.readbackRowCount !== expected.rowCount
    || verification.dataset !== "promotion_daily" || verification.platform !== "天猫"
    || verification.shopName !== expected.shopName || verification.dateMin !== expected.startDate
    || verification.dateMax !== expected.endDate) {
    throw new Error(payload.message ?? "推广导入批次、店铺、日期、行数或落库回查不一致");
  }
  return {
    batchId: batch.id,
    status: importStatus,
    warningCount: Number(batch.warningCount ?? 0),
  } as const;
}

export function buildTmallPromotionCoverageUrl(baseUrl: string, store: Pick<TmallStore, "shopName">, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    platform: "天猫",
    outlet: netshopOutletKey("天猫", store.shopName),
    startDate,
    endDate,
    page: "1",
    pageSize: "1",
  });
  return `${baseUrl}/api/netshop/promotion-performance?${params}`;
}

async function coverageForStore(baseUrl: string, store: TmallStore, startDate: string, endDate: string, request: typeof fetch) {
  const response = await request(buildTmallPromotionCoverageUrl(baseUrl, store, startDate, endDate), {
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as PromotionCoveragePayload | null;
  if (!response.ok) {
    throw new Error(`无法读取 ${store.shopName} 的推广/商品日期覆盖（HTTP ${response.status}）`);
  }
  return assertPromotionCoveragePayload(payload, { startDate, endDate });
}

async function combinedPageText(page: Page) {
  const texts = await Promise.all(page.frames().map(async (frame) => {
    const body = await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const labels = await frame.locator("[aria-label],[title]").evaluateAll((elements) => elements.slice(0, 500).map((element) => (
      `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`
    )).join(" ")).catch(() => "");
    return `${body}\n${labels}`;
  }));
  return texts.join("\n");
}

async function assertStoreIdentity(page: Page, store: TmallStore, surface: "千牛店铺后台" | "阿里妈妈") {
  const url = page.url();
  const text = await combinedPageText(page);
  if (/login\.taobao\.com|passport|oauth|member\/login/i.test(url)
    || /扫码登录|密码登录|账户登录/.test(text) && !/货品全站推|推广中心|下载任务管理/.test(text)) {
    throw new Error(`waiting_login：${store.shopName} 独立浏览器尚未登录${surface}，请先人工登录后重试`);
  }
  const expected = store.shopName.replace(/^天猫-/, "");
  const shorter = expected.replace(/专卖店$/, "");
  if (!text.includes(expected) && !text.includes(shorter)) {
    throw new Error(`shop_identity_mismatch：${surface}页面未显示受控店铺“${expected}”，已停止推广导出`);
  }
}

async function assertAlimamaIdentity(page: Page, store: TmallStore) {
  await assertStoreIdentity(page, store, "阿里妈妈");
}

async function assertSellerIdentity(page: Page, store: TmallStore) {
  await assertStoreIdentity(page, store, "千牛店铺后台");
}

async function waitForAlimamaIdentity(page: Page, store: TmallStore, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertAlimamaIdentity(page, store);
      return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("waiting_login")) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("阿里妈妈页面店铺身份核验超时");
}

async function waitUntil(timeoutMs: number, probe: () => Promise<boolean>, message: string, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

async function positionedTextActions(page: Page, labels: readonly string[], preference: "left" | "right" | "none" = "none") {
  const candidates: PositionedAction[] = [];
  const seen = new Set<string>();
  for (const frame of page.frames()) {
    for (const label of labels) {
      const locators = [
        frame.getByRole("button", { name: label, exact: true }),
        frame.getByRole("link", { name: label, exact: true }),
        frame.getByText(label, { exact: true }),
      ];
      for (let sourceIndex = 0; sourceIndex < locators.length; sourceIndex += 1) {
        const count = Math.min(await locators[sourceIndex]!.count().catch(() => 0), 30);
        for (let index = 0; index < count; index += 1) {
          const locator = locators[sourceIndex]!.nth(index);
          if (!await locator.isVisible().catch(() => false)) continue;
          const box = await locator.boundingBox().catch(() => null);
          if (!box || box.width < 2 || box.height < 2) continue;
          const signature = `${frame.url()}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.width)}|${Math.round(box.height)}|${label}`;
          if (seen.has(signature)) continue;
          seen.add(signature);
          const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
          const semanticScore = sourceIndex === 0 ? 8 : sourceIndex === 1 ? 6 : 2;
          const receivesPointer = await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
            const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && (hit === element || element.contains(hit) || hit.contains(element)));
          }).catch(() => false);
          const positionScore = preference === "left"
            ? Math.max(0, 6 - Math.floor(box.x / Math.max(1, viewport.width / 8)))
            : preference === "right"
              ? Math.max(0, 6 - Math.floor((viewport.width - box.x - box.width) / Math.max(1, viewport.width / 8)))
              : 0;
          candidates.push({ locator, frame, box, label, signature, score: semanticScore + positionScore + (receivesPointer ? 20 : -20) });
        }
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score || left.box.y - right.box.y || left.box.x - right.box.x);
}

async function clickPageText(
  page: Page,
  labels: readonly string[],
  preference: "left" | "right" | "none" = "none",
  controlledAnchorPath?: RegExp,
) {
  const candidates = await positionedTextActions(page, labels, preference);
  const selected = candidates[0];
  if (!selected) throw new Error(`页面缺少可见操作：${labels.join("/")}`);
  if (candidates[1] && candidates[1].score === selected.score && candidates[1].signature !== selected.signature
    && Math.abs(candidates[1].box.x - selected.box.x) < 8 && Math.abs(candidates[1].box.y - selected.box.y) < 8) {
    throw new Error(`页面存在多个同等操作候选：${labels.join("/")}`);
  }
  try {
    await selected.locator.click({ timeout: 15_000 });
  } catch (error) {
    const dismissed = await dismissBlockingPopups(page).catch(() => 0);
    if (dismissed > 0) {
      try {
        await selected.locator.click({ timeout: 15_000 });
        return;
      } catch (retryError) {
        if (!controlledAnchorPath) throw retryError;
      }
    }
    if (!controlledAnchorPath) throw error;
    const href = await selected.locator.getAttribute("href").catch(() => null);
    const tag = await selected.locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    const resolved = href ? new URL(href, page.url()) : null;
    if (tag !== "a" || !resolved || resolved.origin !== new URL(page.url()).origin || !controlledAnchorPath.test(resolved.pathname)) {
      throw error;
    }
    await selected.locator.evaluate((element) => (element as HTMLAnchorElement).click());
  }
}

async function clickPageTextAndFollow(options: {
  page: Page;
  labels: readonly string[];
  preference: "left" | "right" | "none";
  timeoutMs: number;
  message: string;
  ready: (candidate: Page) => Promise<boolean>;
  controlledAnchorPath?: RegExp;
}) {
  const context = options.page.context();
  const pagesBeforeClick = new Set(context.pages());
  await clickPageText(options.page, options.labels, options.preference, options.controlledAnchorPath);
  return waitUntilValue(options.timeoutMs, async () => {
    const newPages = context.pages().filter((candidate) => !pagesBeforeClick.has(candidate));
    for (const candidate of newPages) {
      if (!candidate.isClosed() && await options.ready(candidate).catch(() => false)) return candidate;
    }
    if (!options.page.isClosed() && await options.ready(options.page).catch(() => false)) return options.page;
    return null;
  }, options.message);
}

async function actionContext(locator: Locator) {
  return locator.evaluate((element) => {
    let current: Element | null = element;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const role = current.getAttribute("role") ?? "";
      const className = typeof current.className === "string" ? current.className : "";
      const id = current.getAttribute("id") ?? "";
      const dynamicView = current.getAttribute("data-daynamic-view") ?? current.getAttribute("mx-view") ?? "";
      const text = (current.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
      const isDownloadReportDialog = text.includes("下载报表") && text.includes("日期范围") && text.includes("数据指标");
      const isKnownPromotionOverlay = /^wrapper_dlg_/i.test(id)
        || /competitive_rec_item|recommend.*(?:dialog|popup)|(?:dialog|popup).*recommend/i.test(dynamicView);
      if (role === "dialog" || /modal|dialog|popup|notice|message|advert|activity/i.test(className) || isKnownPromotionOverlay) {
        return isKnownPromotionOverlay && !isDownloadReportDialog ? `平台广告弹窗 ${text}` : text;
      }
    }
    return "";
  }).catch(() => "");
}

async function dismissBlockingPopups(page: Page) {
  let dismissed = 0;
  for (let round = 0; round < 8; round += 1) {
    let selected: { locator: Locator; score: number; signature: string } | null = null;
    for (const frame of page.frames()) {
      const actions = frame.locator('button,a,[role="button"],[aria-label],[title],[class*="close" i],[mx-view*="icon=close" i]');
      const count = Math.min(await actions.count().catch(() => 0), 400);
      for (let index = 0; index < count; index += 1) {
        const locator = actions.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;
        const detail = await locator.evaluate((element) => ({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          aria: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
          className: typeof element.className === "string" ? element.className : "",
          view: element.getAttribute("mx-view") ?? "",
        })).catch(() => ({ text: "", aria: "", title: "", className: "", view: "" }));
        const syntheticClose = /(?:^|[-_])close(?:[-_]|$)|iconclose/i.test(detail.className)
          || /(?:[?&]|^)icon=close(?:&|$)/i.test(detail.view)
          ? "关闭"
          : "";
        const label = [detail.text, detail.aria, detail.title, syntheticClose].find(isSafePromotionDismissLabel);
        if (!label) continue;
        const context = await actionContext(locator);
        if (!/平台消息|消息|通知|公告|广告|活动|优惠|弹窗|新功能|温馨提示/.test(context)) continue;
        const box = await locator.boundingBox().catch(() => null);
        if (!box) continue;
        const signature = `${frame.url()}|${Math.round(box.x)}|${Math.round(box.y)}|${label}`;
        const score = (/关闭|忽略|暂不|稍后|我知道了|知道了|×|✕|close/i.test(label) ? 10 : 0)
          + (/平台消息|广告|通知/.test(context) ? 4 : 0);
        if (!selected || score > selected.score) selected = { locator, score, signature };
      }
    }
    if (!selected) break;
    const before = selected.signature;
    await selected.locator.click({ timeout: 5_000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
    dismissed += 1;
    if (!before) break;
  }
  return dismissed;
}

export function isPromotionDownloadDialogText(value: string) {
  const text = normalizeText(value);
  const hasTitle = /下载报表|报表下载|生成报表/.test(text);
  const hasDate = /日期范围|统计日期|报表日期|开始日期|结束日期/.test(text);
  const hasMetrics = /数据指标|报表指标|指标选择|全部数据指标/.test(text);
  const hasConfirm = /确定|确认生成|立即生成|开始生成/.test(text)
    || (text.match(/生成报表/g)?.length ?? 0) >= 2;
  return hasTitle && hasDate && hasMetrics && hasConfirm;
}

async function uniqueSemanticDialogCandidate(
  frame: Frame,
  collection: Locator,
  label: string,
  ambiguous: "throw" | "skip" = "throw",
) {
  const matches: Locator[] = [];
  const count = Math.min(await collection.count().catch(() => 0), 100);
  for (let index = 0; index < count; index += 1) {
    const locator = collection.nth(index);
    if (!await locator.isVisible().catch(() => false)) continue;
    const text = await locator.innerText({ timeout: 1_000 }).catch(() => "");
    if (!isPromotionDownloadDialogText(text)) continue;
    const box = await locator.boundingBox().catch(() => null);
    if (!box) continue;
    matches.push(locator);
  }
  if (matches.length > 1) {
    if (ambiguous === "skip") return null;
    throw new Error(`${label}存在多个下载报表弹窗候选，为防止误操作已停止`);
  }
  return matches[0] ? { frame, locator: matches[0] } : null;
}

async function findDownloadReportDialog(page: Page) {
  const pageMatches: Array<{ frame: Frame; locator: Locator }> = [];
  for (const frame of page.frames()) {
    const roleDialog = await uniqueSemanticDialogCandidate(frame, frame.getByRole("dialog"), "页面中");
    if (roleDialog) {
      pageMatches.push(roleDialog);
      continue;
    }

    const semanticRoot = await uniqueSemanticDialogCandidate(
      frame,
      frame.locator([
        '[aria-modal="true"]',
        '[class*="dialog" i]',
        '[class*="modal" i]',
        '[class*="drawer" i]',
        '[class*="popup" i]',
      ].join(",")),
      "页面中",
      "skip",
    );
    if (semanticRoot) {
      pageMatches.push(semanticRoot);
      continue;
    }

    const headings = frame.getByText(/^(下载报表|报表下载|生成报表)$/);
    const headingCount = Math.min(await headings.count().catch(() => 0), 20);
    const matches: Locator[] = [];
    for (let index = 0; index < headingCount; index += 1) {
      const item = headings.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      let scope = item;
      for (let depth = 0; depth < 10; depth += 1) {
        scope = scope.locator("xpath=..");
        const text = await scope.innerText({ timeout: 1_000 }).catch(() => "");
        if (!isPromotionDownloadDialogText(text)) continue;
        const box = await scope.boundingBox().catch(() => null);
        if (box) matches.push(scope);
        break;
      }
    }
    if (matches.length > 1) throw new Error("页面中存在多个下载报表标题候选，为防止误操作已停止");
    if (matches[0]) pageMatches.push({ frame, locator: matches[0] });
  }
  if (pageMatches.length > 1) throw new Error("多个页面框架同时存在下载报表弹窗，为防止跨页面误操作已停止");
  return pageMatches[0] ?? null;
}

async function downloadReportButtons(page: Page) {
  const matches: Locator[] = [];
  for (const frame of page.frames()) {
    const candidates = frame.locator('[mx-click*="download()"]');
    const count = Math.min(await candidates.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      if (normalizeText(await candidate.innerText({ timeout: 1_000 }).catch(() => "")) !== "下载报表") continue;
      matches.push(candidate);
    }
  }
  if (matches.length === 0) {
    const semanticActions = await positionedTextActions(page, ["下载报表"], "right");
    return semanticActions.map((candidate) => candidate.locator);
  }
  return matches;
}

async function clickDownloadReport(page: Page) {
  const matches = await downloadReportButtons(page);
  if (matches.length !== 1) throw new Error(`页面中下载报表事件节点数量为 ${matches.length}`);
  try {
    await matches[0]!.click({ timeout: 15_000 });
  } catch (error) {
    const dismissed = await dismissBlockingPopups(page).catch(() => 0);
    if (!dismissed) throw error;
    await matches[0]!.click({ timeout: 15_000 });
  }
}

export async function openPromotionDialogWithRetry<T>(options: {
  findDialog: () => Promise<T | null>;
  click: () => Promise<void>;
  waitForDialog: (attempt: 1 | 2) => Promise<T | null>;
  beforeRetry: () => Promise<void>;
  onAttempt?: (attempt: 1 | 2) => Promise<void>;
}) {
  const existing = await options.findDialog();
  if (existing) return { dialog: existing, attempts: 0 as const };
  for (const attempt of [1, 2] as const) {
    await options.onAttempt?.(attempt);
    await options.click();
    const dialog = await options.waitForDialog(attempt);
    if (dialog) return { dialog, attempts: attempt };
    if (attempt === 1) await options.beforeRetry();
  }
  throw new Error("下载报表弹窗连续两次未出现，已停止且未提交报表任务");
}

export function sanitizePromotionDiagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    const hashRoute = url.hash.split("?")[0] ?? "";
    return `${url.origin}${url.pathname}${hashRoute}`.slice(0, 300);
  } catch {
    return "invalid-url";
  }
}

async function visibleLocatorCount(locator: Locator, maximum = 100) {
  let visible = 0;
  const count = Math.min(await locator.count().catch(() => 0), maximum);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1;
  }
  return visible;
}

async function collectPromotionDialogDiagnostic(options: {
  page: Page;
  storeKey: string;
  runId: string;
  attempts: number;
  directory: string;
}): Promise<PromotionDialogDiagnostic> {
  let roleDialogCandidates = 0;
  let modalRootCandidates = 0;
  let titleCandidates = 0;
  for (const frame of options.page.frames()) {
    roleDialogCandidates += await visibleLocatorCount(frame.getByRole("dialog"), 20);
    modalRootCandidates += await visibleLocatorCount(frame.locator([
      '[aria-modal="true"]',
      '[class*="dialog" i]',
      '[class*="modal" i]',
      '[class*="drawer" i]',
      '[class*="popup" i]',
    ].join(",")));
    titleCandidates += await visibleLocatorCount(frame.getByText(/^(下载报表|报表下载|生成报表)$/), 20);
  }
  const diagnosticDirectory = path.join(options.directory, "diagnostics");
  const screenshotFile = `${safeSegment(options.storeKey)}-${safeSegment(options.runId)}-${Date.now()}-dialog.png`;
  let screenshotStatus: PromotionDialogDiagnostic["screenshotStatus"] = "failed";
  await mkdir(diagnosticDirectory, { recursive: true });
  try {
    await options.page.screenshot({ path: path.join(diagnosticDirectory, screenshotFile), fullPage: false });
    screenshotStatus = "saved";
  } catch {
    // 页面可能已在失败瞬间关闭；审计仍保留其余脱敏结构摘要。
  }
  return {
    capturedAt: new Date().toISOString(),
    attempts: options.attempts,
    pageLocation: sanitizePromotionDiagnosticUrl(options.page.url()),
    frameCount: options.page.frames().length,
    downloadButtonCandidates: (await downloadReportButtons(options.page).catch(() => [])).length,
    roleDialogCandidates,
    modalRootCandidates,
    titleCandidates,
    ...(screenshotStatus === "saved" ? { screenshotFile } : {}),
    screenshotStatus,
  };
}

async function setInputValue(locator: Locator, value: string) {
  try {
    await locator.fill(value, { timeout: 5_000 });
  } catch {
    await locator.evaluate((element, nextValue) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }, value);
  }
  const actual = await locator.inputValue().catch(() => "");
  if (actual !== value) throw new Error(`日期输入未生效：期望 ${value}，实际 ${actual || "空"}`);
}

async function findVisibleAcrossFrames(page: Page, selector: string) {
  const matches: Locator[] = [];
  for (const frame of page.frames()) {
    const locators = frame.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = locators.nth(index);
      if (await locator.isVisible().catch(() => false)) matches.push(locator);
    }
  }
  return matches;
}

export async function clickCalendarMonthArrowWithFallback(input: {
  beforeMonth: string;
  targetMonth: string;
  click: () => Promise<void>;
  fallbackClick: () => Promise<void>;
  readMonth: () => Promise<string>;
  primaryWaitMs?: number;
  finalWaitMs?: number;
}) {
  await input.click().catch(() => undefined);
  const changedAfterPrimary = await waitUntilValue(
    input.primaryWaitMs ?? 1_500,
    async () => {
      const month = await input.readMonth();
      return month && month !== input.beforeMonth ? month : null;
    },
    "日期日历主点击后月份未变化",
    100,
  ).catch(() => null);
  if (changedAfterPrimary) return changedAfterPrimary;

  await input.fallbackClick();
  return waitUntilValue(
    input.finalWaitMs ?? 5_000,
    async () => {
      const month = await input.readMonth();
      return month && month !== input.beforeMonth ? month : null;
    },
    `日期日历无法从 ${input.beforeMonth} 切换到 ${input.targetMonth}`,
    100,
  );
}

async function displayedCalendarMonth(calendar: Locator) {
  const monthLabel = normalizeText(await calendar.locator("span").filter({ hasText: /^\d{4}年\d{2}月$/ }).first()
    .innerText({ timeout: 2_000 }).catch(() => ""));
  const currentMonth = monthLabel.match(/^(\d{4})年(\d{2})月$/);
  return currentMonth ? `${currentMonth[1]}-${currentMonth[2]}` : "";
}

async function chooseCustomDatePickerValue(page: Page, picker: Locator, value: string) {
  const pickerId = await picker.getAttribute("id").catch(() => null);
  const pickerRole = promotionDatePickerRole(await picker.getAttribute("mx-change").catch(() => null));
  if (!pickerId || !/^mx_[A-Za-z0-9_-]+$/.test(pickerId)) throw new Error("日期选择器缺少安全组件标识");
  if (!pickerRole) throw new Error("日期选择器缺少起止角色");
  const trigger = picker.locator(":scope > .mx-trigger");
  if (!await trigger.isVisible().catch(() => false)) throw new Error("日期选择器触发控件不可见");
  await trigger.click({ timeout: 5_000 });
  const calendarSelector = `#days_mx_output_${pickerId}`;
  const calendar = await waitUntilValue(10_000, async () => {
    const matches = await findVisibleAcrossFrames(page, calendarSelector);
    if (matches.length > 1) throw new Error("日期选择器出现多个同标识日历，为防止误选已停止");
    return matches[0] ?? null;
  }, "日期日历未展开");

  const targetMonth = value.slice(0, 7);
  for (let step = 0; step < 4; step += 1) {
    const normalizedMonth = await displayedCalendarMonth(calendar);
    if (!normalizedMonth) throw new Error("日期日历缺少当前年月标题");
    if (normalizedMonth === targetMonth) break;
    const next = normalizedMonth < targetMonth;
    const arrows = calendar.locator(next
      ? '[mx-click*="magix-portsaf({next:true})"]'
      : '[mx-click*="magix-portsaf()"]');
    const visibleArrows: Locator[] = [];
    const arrowCount = Math.min(await arrows.count().catch(() => 0), 5);
    for (let index = 0; index < arrowCount; index += 1) {
      const candidate = arrows.nth(index);
      if (await candidate.isVisible().catch(() => false)) visibleArrows.push(candidate);
    }
    if (visibleArrows.length !== 1) throw new Error(`日期日历切换到 ${targetMonth} 的可见方向按钮数量为 ${visibleArrows.length}`);
    const arrow = visibleArrows[0]!;
    await clickCalendarMonthArrowWithFallback({
      beforeMonth: normalizedMonth,
      targetMonth,
      click: () => arrow.click({ timeout: 5_000 }),
      fallbackClick: () => arrow.evaluate((element) => (element as HTMLElement).click()),
      readMonth: () => displayedCalendarMonth(calendar),
    });
  }
  if (await displayedCalendarMonth(calendar) !== targetMonth) throw new Error(`日期日历无法切换到 ${targetMonth}`);

  const selectedDay = await waitUntilValue(5_000, async () => {
    const day = calendar.locator(`span[title="${value}"][mx-click]`);
    const visibleDays: Locator[] = [];
    const dayCount = Math.min(await day.count().catch(() => 0), 5);
    for (let index = 0; index < dayCount; index += 1) {
      const candidate = day.nth(index);
      if (await candidate.isVisible().catch(() => false)) visibleDays.push(candidate);
    }
    if (visibleDays.length > 1) throw new Error(`日期日历中 ${value} 存在多个可见单元格`);
    return visibleDays[0] ?? null;
  }, `日期日历中 ${value} 的可选单元格未就绪`);
  await selectedDay.click({ timeout: 5_000 });
  await waitUntil(15_000, async () => {
    for (const frame of page.frames()) {
      const candidates = frame.locator('[class*="calendar-datepicker"]');
      const count = Math.min(await candidates.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        if (promotionDatePickerRole(await candidate.getAttribute("mx-change").catch(() => null)) !== pickerRole) continue;
        const view = await candidate.getAttribute("mx-view").catch(() => "");
        const text = normalizeText(await candidate.innerText({ timeout: 1_000 }).catch(() => ""));
        if (view?.includes(`selected=${value}`) || text.includes(value)) return true;
      }
    }
    return false;
  }, `日期选择器未更新为 ${value}`);
}

async function findDatePopupScope(page: Page) {
  const scopes: Array<{ locator: Locator; area: number; frame: Frame }> = [];
  for (const frame of page.frames()) {
    for (const label of ["昨日", "本月", "上月"] as const) {
      const anchors = frame.getByText(label, { exact: true });
      const count = Math.min(await anchors.count().catch(() => 0), 10);
      for (let index = 0; index < count; index += 1) {
        const anchor = anchors.nth(index);
        if (!await anchor.isVisible().catch(() => false)) continue;
        let scope = anchor;
        for (let depth = 0; depth < 7; depth += 1) {
          scope = scope.locator("xpath=..");
          const text = await scope.innerText({ timeout: 1_000 }).catch(() => "");
          const box = await scope.boundingBox().catch(() => null);
          if (box && /昨日/.test(text) && /本月/.test(text) && /上月/.test(text) && /确定/.test(text)) {
            scopes.push({ locator: scope, area: box.width * box.height, frame });
            break;
          }
        }
      }
    }
  }
  const selected = scopes.sort((left, right) => left.area - right.area)[0];
  if (!selected) return null;
  const output = selected.locator.locator("xpath=ancestor-or-self::*[starts-with(@id,'mx_output_')][1]");
  const outputId = await output.getAttribute("id").catch(() => null);
  if (outputId && /^mx_output_[A-Za-z0-9_-]+$/.test(outputId) && await output.isVisible().catch(() => false)) {
    return selected.frame.locator(`#${outputId}`);
  }
  return selected.locator;
}

async function clickUniqueWithin(scope: Locator, label: string, preferredSelector?: string) {
  const nativeButtons = scope.locator("button");
  const roleButtons = scope.locator('[role="button"]');
  const textButtons = scope.getByText(label, { exact: true });
  const collections = preferredSelector ? [scope.locator(preferredSelector)] : [nativeButtons, roleButtons, textButtons];
  for (const collection of collections) {
    const visible: Locator[] = [];
    const count = Math.min(await collection.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = collection.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      if (collection !== textButtons) {
        const text = normalizeText(await locator.innerText({ timeout: 1_000 }).catch(() => ""));
        const aria = normalizeText(await locator.getAttribute("aria-label").catch(() => "") ?? "");
        if (text !== label && aria !== label) continue;
      }
      visible.push(locator);
    }
    if (visible.length === 1) {
      await visible[0]!.click({ timeout: 10_000 });
      return;
    }
    if (visible.length > 1) throw new Error(`弹窗内存在多个“${label}”操作，为防止误点已停止`);
  }
  throw new Error(`弹窗内缺少“${label}”操作`);
}

async function clickUniqueWithinLabels(scope: Locator, labels: readonly string[], preferredSelector?: string) {
  const labelSet = new Set(labels);
  const collections = [
    ...(preferredSelector ? [scope.locator(preferredSelector)] : []),
    scope.locator("button,[role=\"button\"]"),
  ];
  for (const collection of collections) {
    const visible: Locator[] = [];
    const count = Math.min(await collection.count().catch(() => 0), 30);
    for (let index = 0; index < count; index += 1) {
      const locator = collection.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const text = normalizeText(await locator.innerText({ timeout: 1_000 }).catch(() => ""));
      const aria = normalizeText(await locator.getAttribute("aria-label").catch(() => "") ?? "");
      if (!labelSet.has(text) && !labelSet.has(aria)) continue;
      visible.push(locator);
    }
    if (visible.length === 1) {
      await visible[0]!.click({ timeout: 10_000 });
      return;
    }
    if (visible.length > 1) throw new Error(`弹窗内存在多个“${labels.join("/")}”操作，为防止误点已停止`);
  }
  throw new Error(`弹窗内缺少“${labels.join("/")}”操作`);
}

async function chooseDateRange(page: Page, dialog: Locator, startDate: string, endDate: string) {
  const selectors = dialog.locator('[role="combobox"],button,input,[class*="picker" i]');
  const selectorCount = Math.min(await selectors.count().catch(() => 0), 100);
  const openers: Array<{ locator: Locator; score: number; area: number }> = [];
  for (let index = 0; index < selectorCount; index += 1) {
    const locator = selectors.nth(index);
    if (!await locator.isVisible().catch(() => false)) continue;
    const text = normalizeText(`${await locator.innerText({ timeout: 1_000 }).catch(() => "")} ${await locator.getAttribute("value").catch(() => "") ?? ""}`);
    if (!/过去\s*\d+\s*天|昨日|自定义/.test(text)) continue;
    const box = await locator.boundingBox().catch(() => null);
    if (!box) continue;
    const role = await locator.getAttribute("role").catch(() => "");
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    openers.push({
      locator,
      score: (role === "combobox" ? 8 : 0) + (tag === "button" || tag === "input" ? 5 : 0) + (text.length <= 20 ? 3 : 0),
      area: box.width * box.height,
    });
  }
  const opener = openers.sort((left, right) => right.score - left.score || left.area - right.area)[0];
  if (opener) {
    await opener.locator.click({ timeout: 5_000 });
  } else {
    const dateRange = dialog.getByText(/过去\s*\d+\s*天|昨日|自定义/).first();
    if (!await dateRange.isVisible().catch(() => false)) throw new Error("下载报表弹窗缺少日期范围选择器");
    await dateRange.click({ timeout: 5_000 });
  }
  const datePopup = await waitUntilValue(10_000, () => findDatePopupScope(page), "日期选择弹层未出现");
  const inputs = datePopup.locator("input");
  const visibleInputs: Locator[] = [];
  const inputCount = Math.min(await inputs.count().catch(() => 0), 20);
  for (let index = 0; index < inputCount; index += 1) {
    const locator = inputs.nth(index);
    if (await locator.isVisible().catch(() => false)) visibleInputs.push(locator);
  }
  if (visibleInputs.length >= 2) {
    await setInputValue(visibleInputs[0]!, startDate);
    await setInputValue(visibleInputs[1]!, endDate);
  } else {
    const pickerLocators = datePopup.locator('[class*="calendar-datepicker"]');
    const pickers = new Map<"start" | "end", Locator>();
    const pickerCount = Math.min(await pickerLocators.count().catch(() => 0), 10);
    for (let index = 0; index < pickerCount; index += 1) {
      const picker = pickerLocators.nth(index);
      if (!await picker.isVisible().catch(() => false)) continue;
      const role = promotionDatePickerRole(await picker.getAttribute("mx-change").catch(() => null));
      if (!role) continue;
      if (pickers.has(role)) throw new Error(`日期选择弹层存在多个 ${role} 日期选择器`);
      pickers.set(role, picker);
    }
    const startPicker = pickers.get("start");
    const endPicker = pickers.get("end");
    if (!startPicker || !endPicker) throw new Error("日期选择弹层没有唯一的起止日期控件");
    await chooseCustomDatePickerValue(page, startPicker, startDate);
    await chooseCustomDatePickerValue(page, endPicker, endDate);
  }
  await clickUniqueWithin(datePopup, "确定", ".mx-output-footer button");
  await waitUntil(10_000, async () => !await datePopup.isVisible().catch(() => false), "日期范围确认后弹层未关闭");
}

async function waitUntilValue<T>(timeoutMs: number, probe: () => Promise<T | null>, message: string, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

async function promotionMetricSelectionConfirmed(choice: Locator) {
  const state = await choice.evaluate((element): PromotionMetricSelectionState => {
    const scope = element.closest([
      "label",
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="option"]',
      '[class*="checkbox"]',
      '[class*="radio"]',
      '[class*="metric"]',
    ].join(",")) ?? element.parentElement ?? element;
    const candidates = [
      scope,
      ...Array.from(scope.querySelectorAll([
        "input",
        '[aria-checked]',
        '[aria-selected]',
        '[data-checked]',
        '[data-selected]',
        '[class*="checked"]',
        '[class*="selected"]',
      ].join(","))).slice(0, 20),
    ];
    const attributes = ["aria-checked", "aria-selected", "data-checked", "data-selected"];
    return {
      checked: candidates.some((candidate) => candidate instanceof HTMLInputElement && candidate.checked),
      attributeValues: candidates.flatMap((candidate) => attributes
        .map((attribute) => candidate.getAttribute(attribute))
        .filter((value): value is string => value !== null)),
      classNames: candidates
        .map((candidate) => candidate.getAttribute("class") ?? "")
        .filter(Boolean),
    };
  }).catch(() => null);
  return state !== null && isPromotionMetricSelectionState(state);
}

async function chooseAllMetrics(page: Page, dialog: Locator) {
  const clickChoice = async (scope: Locator) => {
    const choices = scope.getByText("全部数据指标", { exact: true });
    const count = Math.min(await choices.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const choice = choices.nth(index);
      if (!await choice.isVisible().catch(() => false)) continue;
      const label = choice.locator("xpath=ancestor-or-self::label[1]");
      const control = await label.count().catch(() => 0) ? label : choice;
      if (!await promotionMetricSelectionConfirmed(control)) await control.click({ timeout: 5_000 });
      await waitUntil(
        5_000,
        () => promotionMetricSelectionConfirmed(control),
        "“全部数据指标”点击后未确认选中状态",
        200,
      );
      return true;
    }
    return false;
  };
  if (await clickChoice(dialog)) return;
  const metricLabel = dialog.getByText("数据指标", { exact: true }).first();
  if (await metricLabel.isVisible().catch(() => false)) await metricLabel.click({ timeout: 5_000 });
  for (const frame of page.frames()) {
    if (await clickChoice(frame.locator("body"))) return;
  }
  throw new Error("下载报表弹窗缺少“全部数据指标”选项");
}

async function navigateToPromotionReport(page: Page, store: TmallStore) {
  let dismissedPopups = 0;
  if (!/myseller\.taobao\.com\/home\.htm\/SellManage\/on_sale/i.test(page.url())) {
    await page.goto(TMALL_PROMOTION_ENTRY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  await ensureTmallSellerSession(page, store);
  dismissedPopups += await dismissBlockingPopups(page);
  await assertSellerIdentity(page, store);
  dismissedPopups += await dismissBlockingPopups(page);
  page = await clickPageTextAndFollow({
    page,
    labels: ["推广"],
    preference: "left",
    timeoutMs: 60_000,
    message: "千牛推广中心未出现货品全站推入口",
    controlledAnchorPath: /^\/home\.htm\/(?:_firstmenuid_\/2513|tuiguangcenter_new)\/?$/i,
    ready: async (candidate) => /myseller\.taobao\.com\/home\.htm\/tuiguangcenter_new/i.test(candidate.url())
      && (await combinedPageText(candidate)).includes("货品全站推"),
  });
  dismissedPopups += await dismissBlockingPopups(page);
  const pagesBeforeGoodsClick = new Set(page.context().pages());
  await clickPageText(page, ["货品全站推"], "left", /^\/home\.htm\/alltaopromotion\/?$/i);
  const sellerGoodsReady = async () => /myseller\.taobao\.com\/home\.htm\/alltaopromotion/i.test(page.url())
    && (await combinedPageText(page)).includes("货品全站推广");
  try {
    await waitUntil(8_000, sellerGoodsReady, "千牛货品全站推页面未在当前标签打开");
  } catch {
    await page.goto(TMALL_PROMOTION_SELLER_GOODS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitUntil(60_000, sellerGoodsReady, "千牛货品全站推页面加载超时");
  }
  for (const candidate of page.context().pages()) {
    if (!pagesBeforeGoodsClick.has(candidate) && candidate !== page && /one\.alimama\.com\/index\.html.*#!\/manage\/onesite/i.test(candidate.url())) {
      await candidate.close().catch(() => undefined);
    }
  }
  page.setDefaultTimeout(15_000);
  await waitForAlimamaIdentity(page, store);
  dismissedPopups += await dismissBlockingPopups(page);
  await clickPageText(page, ["报表"], "left");
  await waitUntil(30_000, async () => (await positionedTextActions(page, ["下载报表"], "right")).length > 0, "货品全站推报表页缺少下载报表按钮");
  return { dismissedPopups, page };
}

async function launchStoreChrome(store: TmallStore, interactiveLogin = false) {
  const launchTarget = resolveTmallBrowserLaunchTarget(
    store,
    process.env.CHROME_EXECUTABLE_PATH?.trim() || defaultChromeExecutable,
  );
  if (!path.isAbsolute(launchTarget.executablePath)) throw new Error("天猫 Chromium 可执行文件必须是绝对路径");
  await mkdir(store.browser.downloadDir, { recursive: true });
  await launchDedicatedChrome({
    executablePath: launchTarget.executablePath,
    profileDirectory: launchTarget.profileDirectory,
    profileName: launchTarget.profileName,
    port: store.browser.debugPort,
    startUrl: TMALL_PROMOTION_ENTRY_URL,
    headless: false,
    visible: interactiveLogin,
    startMinimized: !interactiveLogin,
    keepWindowHidden: !interactiveLogin,
  });
  return launchTarget;
}

export async function launchTmallPromotionLogin(storeKey = "tmall-yijiu") {
  const store = await getRegisteredTmallStore(storeKey);
  await launchStoreChrome(store, true);
  return {
    ok: true,
    status: "browser_ready" as const,
    storeKey: store.storeKey,
    shopName: store.shopName,
    targetUrl: TMALL_PROMOTION_ENTRY_URL,
    debugPort: store.browser.debugPort,
    instruction: "请完成登录，并在 Chromium 提示时为当前独立店铺 Profile 保存密码；程序不会读取或保存明文凭证。",
  };
}

async function configureAndSubmitReport(options: {
  page: Page;
  store: TmallStore;
  startDate: string;
  endDate: string;
  onDialogOpening: (attempt: 1 | 2) => Promise<void>;
  onDialogReady: (attempts: number) => Promise<void>;
  onDialogFailure: (attempts: number) => Promise<void>;
  afterConfigured: () => Promise<void>;
  beforeSubmit: () => Promise<void>;
  afterSubmit: () => Promise<void>;
  assertDialogSafe: () => Promise<void>;
}) {
  await options.assertDialogSafe();
  const navigation = await navigateToPromotionReport(options.page, options.store);
  const page = navigation.page;
  await options.assertDialogSafe();
  let dismissedPopups = navigation.dismissedPopups;
  dismissedPopups += await dismissBlockingPopups(page);
  let dialogAttempts = 0;
  let opened: Awaited<ReturnType<typeof openPromotionDialogWithRetry<{ frame: Frame; locator: Locator }>>>;
  try {
    opened = await openPromotionDialogWithRetry({
      findDialog: () => findDownloadReportDialog(page),
      click: () => clickDownloadReport(page),
      waitForDialog: async (attempt) => {
        const deadline = Date.now() + (attempt === 1 ? 15_000 : 30_000);
        while (Date.now() < deadline) {
          const found = await findDownloadReportDialog(page);
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
      },
      beforeRetry: async () => {
        await options.assertDialogSafe();
        await waitForAlimamaIdentity(page, options.store);
        dismissedPopups += await dismissBlockingPopups(page);
        if ((await downloadReportButtons(page)).length !== 1) {
          throw new Error("首次点击无效后下载报表按钮身份发生变化，已停止且未提交报表任务");
        }
      },
      onAttempt: async (attempt) => {
        dialogAttempts = attempt;
        await options.onDialogOpening(attempt);
      },
    });
  } catch (error) {
    await options.onDialogFailure(dialogAttempts).catch(() => undefined);
    throw error;
  }
  const dialog = opened.dialog;
  await options.onDialogReady(opened.attempts);
  await options.assertDialogSafe();
  await chooseDateRange(page, dialog.locator, options.startDate, options.endDate);
  dismissedPopups += await dismissBlockingPopups(page);
  await options.assertDialogSafe();
  await chooseAllMetrics(page, dialog.locator);
  dismissedPopups += await dismissBlockingPopups(page);
  await options.assertDialogSafe();
  await options.afterConfigured();
  await options.beforeSubmit();
  await options.assertDialogSafe();
  await clickUniqueWithinLabels(dialog.locator, ["确定", "确认生成", "生成报表"], ".dialog-footer button");
  await waitUntil(15_000, async () => !await dialog.locator.isVisible().catch(() => false), "确认下载后报表弹窗未关闭，可能存在字段校验错误");
  await options.assertDialogSafe();
  // 弹窗关闭后先持久化已提交状态。即使短暂成功提示已消失，后续也只会
  // 进入受控下载中心按日期、创建时间和唯一任务恢复，不会重复创建报表。
  await options.afterSubmit();
  const downloadPage = await clickReportSuccessNavigation(page, options.store).catch((error) => {
    if (shouldRecoverSubmittedPromotionTask(error)) return page;
    throw error;
  });
  await options.assertDialogSafe();
  return { dismissedPopups, downloadPage };
}

async function reportSuccessContext(locator: Locator) {
  return locator.evaluate((element) => {
    let current: Element | null = element;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const text = (current.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.includes("离线数据生成成功") && text.includes("下载任务管理")) return text.slice(0, 800);
    }
    return "";
  }).catch(() => "");
}

async function findReportSuccessNavigation(page: Page) {
  const candidates = await positionedTextActions(page, ["立即前往", "前往下载", "立即前往下载"], "right");
  const matching: PositionedAction[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const context = await reportSuccessContext(candidate.locator);
    if (!isPromotionReportSuccessNavigation({ label: candidate.label, context })) continue;
    const signature = `${candidate.frame.url()}|${Math.round(candidate.box.x)}|${Math.round(candidate.box.y)}|${Math.round(candidate.box.width)}|${Math.round(candidate.box.height)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    matching.push(candidate);
  }
  if (matching.length > 1) throw new Error("报表生成成功提示中存在多个前往下载操作，为防止误点已停止");
  return matching[0]?.locator ?? null;
}

async function clickReportSuccessNavigation(page: Page, store: TmallStore) {
  const action = await waitUntilValue(
    30_000,
    () => findReportSuccessNavigation(page),
    promotionSuccessNavigationMissingMessage,
    100,
  );
  const context = page.context();
  const pagesBeforeClick = new Set(context.pages());
  await action.click({ timeout: 10_000 });
  const downloadPage = await waitUntilValue(60_000, async () => {
    const matching = context.pages().filter((candidate) => isPromotionDownloadListPageUrl(candidate.url()));
    if (matching.includes(page)) return page;
    const newlyOpened = matching.filter((candidate) => !pagesBeforeClick.has(candidate));
    if (newlyOpened.length === 1) return newlyOpened[0]!;
    if (newlyOpened.length > 1 || matching.length > 1) {
      throw new Error("点击前往下载后出现多个下载任务页面，为防止接管错误页面已停止");
    }
    return matching[0] ?? null;
  }, "点击前往下载后未进入下载任务管理页面");
  downloadPage.setDefaultTimeout(15_000);
  await downloadPage.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  await waitForAlimamaIdentity(downloadPage, store);
  return downloadPage;
}

export function parsePromotionTaskDateRange(text: string) {
  const range = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:至|~|～|—|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (range) return { startDate: range[1]!, endDate: range[2]! };
  const single = text.match(/(?:日期范围|统计日期|数据日期)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/);
  return single ? { startDate: single[1]!, endDate: single[1]! } : null;
}

async function scanDownloadTasks(page: Page) {
  const candidates: PromotionDownloadTaskCandidate[] = [];
  const seen = new Set<string>();
  for (const frame of page.frames()) {
    const rows = frame.locator('tr,[role="row"]');
    const count = Math.min(await rows.count().catch(() => 0), 500);
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      if (!await row.isVisible().catch(() => false)) continue;
      const contextText = normalizeText(await row.innerText({ timeout: 2_000 }).catch(() => ""));
      const range = parsePromotionTaskDateRange(contextText);
      const fileName = contextText.match(/报表[_-]\d{8}[_-]\d{6}(?:\.zip)?/i)?.[0] ?? "";
      if (!range || !fileName) continue;
      const status = contextText.match(/生成成功|已完成|生成中|处理中|待执行|生成失败|失败/)?.[0] ?? "未知";
      const actions = row.getByText("下载", { exact: true });
      let download: Locator | null = null;
      const actionCount = Math.min(await actions.count().catch(() => 0), 10);
      for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
        const action = actions.nth(actionIndex);
        if (await action.isVisible().catch(() => false)) {
          if (download) {
            download = null;
            break;
          }
          download = action;
        }
      }
      const createdAt = parseShanghaiTaskDate(`${fileName} ${contextText}`);
      const signature = `${frame.url()}|${fileName}|${range.startDate}|${range.endDate}|${createdAt ?? "unknown"}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      candidates.push({
        signature,
        fileName,
        status,
        ...range,
        createdAt,
        downloadReady: Boolean(download),
        locator: download,
        contextText,
      });
    }
    const downloadActions = frame.getByText("下载", { exact: true });
    const downloadCount = Math.min(await downloadActions.count().catch(() => 0), 200);
    for (let index = 0; index < downloadCount; index += 1) {
      const action = downloadActions.nth(index);
      if (!await action.isVisible().catch(() => false)) continue;
      let scope = action;
      for (let depth = 0; depth < 9; depth += 1) {
        scope = scope.locator("xpath=..");
        const contextText = normalizeText(await scope.innerText({ timeout: 1_000 }).catch(() => ""));
        const range = parsePromotionTaskDateRange(contextText);
        const fileName = contextText.match(/报表[_-]\d{8}[_-]\d{6}(?:\.zip)?/i)?.[0] ?? "";
        if (!range || !fileName) continue;
        const status = contextText.match(/生成成功|已完成|生成中|处理中|待执行|生成失败|失败/)?.[0] ?? "未知";
        const createdAt = parseShanghaiTaskDate(`${fileName} ${contextText}`);
        const signature = `${frame.url()}|${fileName}|${range.startDate}|${range.endDate}|${createdAt ?? "unknown"}`;
        const existing = candidates.find((candidate) => candidate.signature === signature);
        if (existing && !existing.locator) {
          existing.downloadReady = true;
          existing.locator = action;
        } else if (!seen.has(signature)) {
          seen.add(signature);
          candidates.push({
            signature,
            fileName,
            status,
            ...range,
            createdAt,
            downloadReady: true,
            locator: action,
            contextText,
          });
        }
        break;
      }
    }
  }
  return candidates;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function downloadTask(options: {
  page: Page;
  locator: Locator;
  store: TmallStore;
  startDate: string;
  endDate: string;
  runId: string;
}) {
  const stagingDirectory = await mkdtemp(path.join(options.store.browser.downloadDir, ".tmall-promotion-"));
  if (!inside(options.store.browser.downloadDir, stagingDirectory)) throw new Error("推广下载暂存目录越过店铺独立目录");
  const session = await createTmallBrowserDownloadSession(options.page);
  let activeGuid: string | undefined;
  let resolveStarted!: (value: { guid: string; suggestedFilename: string }) => void;
  let resolveCompleted!: (value: { guid: string; filePath?: string }) => void;
  let rejectCompleted!: (error: Error) => void;
  const started = new Promise<{ guid: string; suggestedFilename: string }>((resolve) => { resolveStarted = resolve; });
  const completed = new Promise<{ guid: string; filePath?: string }>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });
  session.on("Browser.downloadWillBegin", (event) => {
    if (activeGuid) return;
    activeGuid = event.guid;
    resolveStarted({ guid: event.guid, suggestedFilename: event.suggestedFilename });
  });
  session.on("Browser.downloadProgress", (event) => {
    if (!activeGuid || event.guid !== activeGuid) return;
    if (event.state === "completed") resolveCompleted({ guid: event.guid, filePath: event.filePath });
    if (event.state === "canceled") rejectCompleted(new Error("Chrome 已取消天猫推广 ZIP 下载"));
  });
  try {
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: stagingDirectory,
      eventsEnabled: true,
    });
    await options.locator.click({ timeout: 15_000 });
    const start = await withDeadline(started, 60_000, "点击推广任务下载后 Chrome 未开始下载");
    if (!/^[^/\\]+\.zip$/i.test(start.suggestedFilename)) {
      throw new Error(`阿里妈妈返回的推广文件不是安全 ZIP：${safeSegment(start.suggestedFilename)}`);
    }
    const finish = await withDeadline(completed, 120_000, "天猫推广 ZIP 下载未在两分钟内完成");
    const stagedPath = path.resolve(finish.filePath || path.join(stagingDirectory, finish.guid));
    if (!inside(stagingDirectory, stagedPath)) throw new Error("推广下载结果越过本轮暂存目录");
    await stat(stagedPath);
    const targetPath = path.resolve(options.store.browser.downloadDir,
      `${safeSegment(options.store.shopName)}-货品全站推-${options.startDate}_${options.endDate}-${options.runId}.zip`);
    if (!inside(options.store.browser.downloadDir, targetPath)) throw new Error("推广规范文件越过店铺独立目录");
    if (await stat(targetPath).then(() => true).catch(() => false)) throw new Error("本轮推广规范文件已存在，为防止覆盖已停止");
    await rename(stagedPath, targetPath);
    return targetPath;
  } finally {
    await session.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => undefined);
    await session.detach().catch(() => undefined);
    if (inside(options.store.browser.downloadDir, stagingDirectory)) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function waitForGeneratedTask(options: {
  page: Page;
  store: TmallStore;
  startDate: string;
  endDate: string;
  runStartedAt: string;
  runId: string;
}) {
  if (!isPromotionDownloadListPageUrl(options.page.url())) {
    await options.page.goto(TMALL_PROMOTION_DOWNLOAD_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  await waitForAlimamaIdentity(options.page, options.store);
  const deadline = Date.now() + reportGenerationTimeoutMs;
  let lastObservation = "未发现本轮日期范围的下载任务";
  while (Date.now() < deadline) {
    await dismissBlockingPopups(options.page);
    const candidates = await scanDownloadTasks(options.page);
    const expected = { startDate: options.startDate, endDate: options.endDate, runStartedAt: options.runStartedAt };
    const selectedSignature = chooseTmallPromotionDownloadTask(candidates, expected);
    const selected = selectedSignature ? candidates.find((candidate) => candidate.signature === selectedSignature) : null;
    if (selected?.locator) {
      return downloadTask({
        page: options.page,
        locator: selected.locator,
        store: options.store,
        startDate: options.startDate,
        endDate: options.endDate,
        runId: options.runId,
      });
    }
    const relevant = candidates.filter((candidate) => candidate.startDate === options.startDate && candidate.endDate === options.endDate
      && candidate.createdAt && Date.parse(candidate.createdAt) >= Date.parse(options.runStartedAt) - 90_000)
      .sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!));
    if (relevant[0]) {
      lastObservation = `最近匹配任务 ${relevant[0].fileName}，状态“${relevant[0].status}”，${relevant[0].downloadReady ? "下载动作存在但候选不唯一" : "尚未出现唯一下载动作"}`;
      if (/生成失败|^失败$/.test(relevant[0].status)) throw new Error(`阿里妈妈推广报表生成失败：${lastObservation}`);
    }
    const refresh = await positionedTextActions(options.page, ["刷新表格"], "left");
    if (refresh[0]) await refresh[0].locator.click({ timeout: 5_000 }).catch(() => undefined);
    else await options.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, reportRefreshIntervalMs));
  }
  throw new Error(`阿里妈妈推广报表等待十分钟后仍不可安全下载：${lastObservation}`);
}

async function inspectPromotionFile(filePath: string, store: TmallStore, plan: PromotionDatePlan): Promise<PromotionFileEvidence> {
  const resolved = await realpath(filePath);
  if (!inside(store.browser.downloadDir, resolved) || !/\.zip$/i.test(resolved)) {
    throw new Error("推广文件不在当前店铺独立下载目录或扩展名不是 .zip");
  }
  const info = await stat(resolved);
  if (!info.isFile() || info.size <= 0 || info.size > maximumDownloadBytes) throw new Error("推广 ZIP 为空或超过 25MB 上限");
  const bytes = new Uint8Array(await readFile(resolved));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("推广下载结果缺少 ZIP 魔数");
  const inspection = await inspectTmallImportBytes({
    source: "tmall_promotion",
    bytes,
    fileName: path.basename(resolved),
    fileSizeBytes: bytes.byteLength,
    shopName: store.shopName,
    expectedStartDate: plan.startDate,
    expectedEndDate: plan.endDate,
  });
  if (inspection.errors.length > 0 || inspection.dataset !== "promotion_daily" || inspection.platform !== "天猫"
    || inspection.shopName !== store.shopName || inspection.totals.rowCount <= 0
    || inspection.totals.dateMin !== plan.startDate || inspection.totals.dateMax !== plan.endDate) {
    const codes = inspection.errors.map((issue) => issue.code ?? issue.message).join(", ");
    throw new Error(`推广 ZIP 内容、日期或店铺校验失败${codes ? `：${codes}` : ""}`);
  }
  return {
    fileName: path.basename(resolved),
    filePath: resolved,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    rowCount: inspection.totals.rowCount,
    dateMin: plan.startDate,
    dateMax: plan.endDate,
  };
}

async function assertFileUnchanged(file: PromotionFileEvidence, store: TmallStore, plan: PromotionDatePlan) {
  const current = await inspectPromotionFile(file.filePath, store, plan);
  if (current.fileName !== file.fileName || current.size !== file.size || current.sha256 !== file.sha256
    || current.rowCount !== file.rowCount || current.dateMin !== file.dateMin || current.dateMax !== file.dateMax) {
    throw new Error("恢复清单中的推广文件已变化，拒绝继续导入");
  }
  return current;
}

async function importPromotionFile(options: {
  baseUrl: string;
  store: TmallStore;
  plan: PromotionDatePlan;
  file: PromotionFileEvidence;
  request: typeof fetch;
}) {
  const bytes = new Uint8Array(await readFile(options.file.filePath));
  const form = new FormData();
  form.set("source", "tmall_promotion");
  form.set("platform", "天猫");
  form.set("shop_name", options.store.shopName);
  form.set("expectedStartDate", options.plan.startDate);
  form.set("expectedEndDate", options.plan.endDate);
  form.set("note", "n8n 货品全站推全部数据指标自动签收");
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([body], options.file.fileName, { type: "application/zip" }));
  const response = await options.request(`${options.baseUrl}/api/netshop/import`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as PromotionImportPayload | null;
  if (!payload) throw new Error(`推广导入接口未返回 JSON（HTTP ${response.status}）`);
  return assertPromotionImportPayload(payload, response.status, {
    shopName: options.store.shopName,
    startDate: options.plan.startDate,
    endDate: options.plan.endDate,
    rowCount: options.file.rowCount,
  });
}

function activeAuditPath(storeKey: string, directory: string) {
  return path.join(directory, `active-${safeSegment(storeKey)}.json`);
}

async function readActiveAudit(storeKey: string, directory: string) {
  const filePath = activeAuditPath(storeKey, directory);
  try {
    const audit = JSON.parse(await readFile(filePath, "utf8")) as PromotionExportAudit;
    if (audit.version !== 1 || audit.storeKey !== storeKey || !audit.runId || !audit.startDate || !audit.endDate || !audit.stage) {
      throw new Error("推广活动恢复清单结构无效");
    }
    return { filePath, audit };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAudit(audit: PromotionExportAudit, directory: string) {
  await mkdir(directory, { recursive: true });
  audit.updatedAt = new Date().toISOString();
  await writeJsonAtomic(activeAuditPath(audit.storeKey, directory), audit);
}

function resumableStage(audit: PromotionExportAudit): PromotionAuditStage {
  return audit.stage === "failed" ? audit.resumeStage ?? "planned" : audit.stage;
}

async function runTmallPromotionDate(options: {
  store: TmallStore;
  baseUrl: string;
  request: typeof fetch;
  auditDirectory: string;
  plan: PromotionDatePlan;
}) {
  const { store, baseUrl, request, auditDirectory: runAuditDirectory, plan } = options;
  if (plan.startDate !== plan.endDate || plan.dates.length !== 1 || plan.dates[0] !== plan.startDate) {
    throw new Error("推广报表必须按单个业务日下载，起止日期必须为同一天");
  }
  const existing = await readActiveAudit(store.storeKey, runAuditDirectory);
  if (existing && (existing.audit.startDate !== plan.startDate || existing.audit.endDate !== plan.endDate)
    && !["completed", "planned"].includes(resumableStage(existing.audit))) {
    throw new Error(`存在未完成的推广恢复清单 ${existing.audit.startDate}..${existing.audit.endDate}，拒绝覆盖为 ${plan.startDate}..${plan.endDate}`);
  }
  const audit: PromotionExportAudit = existing
    && existing.audit.startDate === plan.startDate
    && existing.audit.endDate === plan.endDate
    ? existing.audit
    : {
        version: 1,
        runId: randomUUID(),
        storeKey: store.storeKey,
        shopName: store.shopName,
        baseUrl,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stage: "planned",
        startDate: plan.startDate,
        endDate: plan.endDate,
        dates: plan.dates,
        metrics: "全部数据指标",
        downloadListUrl: TMALL_PROMOTION_DOWNLOAD_LIST_URL,
        dismissedPopups: 0,
      };
  if (audit.shopName !== store.shopName || audit.baseUrl !== baseUrl || audit.dates.join(",") !== plan.dates.join(",")) {
    throw new Error("推广恢复清单的店铺、系统地址或日期与当前计划不一致");
  }
  await writeAudit(audit, runAuditDirectory);

  try {
    let file = audit.file;
    const resume = resumableStage(audit);
    if (file) {
      file = await assertFileUnchanged(file, store, plan);
    } else {
      await launchStoreChrome(store);
      const browser = await connectPlaywrightBrowser(store.browser.debugPort);
      const context = browser.contexts()[0];
      if (!context) throw new Error("亿玖店独立 Chrome 没有可用上下文");
      const pages = context.pages();
      const entryPageIndex = chooseTmallPromotionEntryPageIndex(pages.map((candidate) => candidate.url()));
      let page = entryPageIndex >= 0 ? pages[entryPageIndex] : undefined;
      if (!page) page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const dialogGuard = installPromotionNativeDialogGuard(page);
      try {
        await dialogGuard.assertSafe();
        let downloadPage = page;
        if (!["report_submitting", "report_submitted"].includes(resume)) {
          audit.stage = "browser_ready";
          await writeAudit(audit, runAuditDirectory);
          const submission = await configureAndSubmitReport({
            page,
            store,
            startDate: plan.startDate,
            endDate: plan.endDate,
            assertDialogSafe: dialogGuard.assertSafe,
            onDialogOpening: async (attempt) => {
              audit.stage = "dialog_opening";
              audit.dialogAttempts = attempt;
              delete audit.dialogDiagnostic;
              await writeAudit(audit, runAuditDirectory);
            },
            onDialogReady: async (attempts) => {
              audit.stage = "dialog_ready";
              audit.dialogAttempts = attempts;
              delete audit.dialogDiagnostic;
              await writeAudit(audit, runAuditDirectory);
            },
            onDialogFailure: async (attempts) => {
              audit.dialogAttempts = attempts;
              audit.dialogDiagnostic = await collectPromotionDialogDiagnostic({
                page,
                storeKey: store.storeKey,
                runId: audit.runId,
                attempts,
                directory: runAuditDirectory,
              });
              await writeAudit(audit, runAuditDirectory);
            },
            afterConfigured: async () => {
              audit.stage = "report_configured";
              await writeAudit(audit, runAuditDirectory);
            },
            beforeSubmit: async () => {
              audit.stage = "report_submitting";
              await writeAudit(audit, runAuditDirectory);
            },
            afterSubmit: async () => {
              audit.stage = "report_submitted";
              await writeAudit(audit, runAuditDirectory);
            },
          });
          audit.dismissedPopups += submission.dismissedPopups;
          downloadPage = submission.downloadPage;
        }
        await dialogGuard.assertSafe();
        const filePath = await waitForGeneratedTask({
          page: downloadPage,
          store,
          startDate: plan.startDate,
          endDate: plan.endDate,
          runStartedAt: audit.startedAt,
          runId: audit.runId,
        });
        await dialogGuard.assertSafe();
        try {
          file = await inspectPromotionFile(filePath, store, plan);
        } catch (error) {
          audit.runId = randomUUID();
          audit.startedAt = new Date().toISOString();
          audit.stage = "browser_ready";
          delete audit.file;
          await writeAudit(audit, runAuditDirectory);
          throw error;
        }
        audit.file = file;
        audit.stage = "downloaded";
        await writeAudit(audit, runAuditDirectory);
      } catch (error) {
        await dialogGuard.assertSafe();
        throw error;
      } finally {
        try {
          await dialogGuard.assertSafe();
        } finally {
          try {
            await dialogGuard.dispose();
          } finally {
            await browser.close().catch(() => undefined);
          }
        }
      }
    }

    audit.stage = "importing";
    await writeAudit(audit, runAuditDirectory);
    const imported = await importPromotionFile({ baseUrl, store, plan, file, request });
    const after = await coverageForStore(baseUrl, store, plan.startDate, plan.endDate, request);
    const missingAfterImport = plan.dates.filter((date) => !after.promotionDates.includes(date));
    if (missingAfterImport.length > 0) {
      throw new Error(`推广导入接口成功但日期覆盖回查缺少：${missingAfterImport.join(", ")}`);
    }
    audit.stage = "completed";
    audit.batchId = imported.batchId;
    audit.importStatus = imported.status;
    audit.warningCount = imported.warningCount;
    delete audit.error;
    delete audit.resumeStage;
    delete audit.dialogDiagnostic;
    await writeAudit(audit, runAuditDirectory);
    return {
      ok: true,
      stage: "promotion_day" as const,
      status: imported.status,
      storeKey: store.storeKey,
      shopName: store.shopName,
      date: plan.startDate,
      startDate: plan.startDate,
      endDate: plan.endDate,
      dates: plan.dates,
      metrics: audit.metrics,
      fileName: file.fileName,
      sha256: file.sha256,
      rowCount: file.rowCount,
      batchId: imported.batchId,
      warningCount: imported.warningCount,
      coverageConfirmed: true,
    };
  } catch (error) {
    const current = audit.stage;
    audit.resumeStage = current === "completed" || current === "failed" ? undefined : current;
    audit.stage = "failed";
    audit.error = error instanceof Error ? error.message : String(error);
    await writeAudit(audit, runAuditDirectory).catch(() => undefined);
    throw error;
  }
}

export async function runTmallPromotionStage(options: {
  storeKey?: string;
  baseUrl?: string;
  request?: typeof fetch;
  auditDirectory?: string;
  dates?: readonly string[];
  forceExistingDates?: boolean;
  maximumDays?: number;
  executeDate?: typeof runTmallPromotionDate;
} = {}) {
  const store = await getTmallStore(options.storeKey ?? "tmall-yijiu");
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const request = options.request ?? fetch;
  const runAuditDirectory = path.resolve(options.auditDirectory ?? artifactDirectory);
  if (!store.initialStartDate) throw new Error(`${store.shopName} 尚未配置推广补数起始日期`);
  const latestAllowedDate = shanghaiYesterday();
  const requestedDates = options.dates === undefined
    ? [latestAllowedDate]
    : [...new Set(options.dates)].sort();
  if (requestedDates && requestedDates.length === 0) throw new Error("推广显式日期清单不能为空");
  if (requestedDates?.some((date) => !validDate(date) || date < store.initialStartDate! || date > latestAllowedDate)) {
    throw new Error(`推广显式日期必须位于 ${store.initialStartDate} 至 ${latestAllowedDate}`);
  }
  const requestedStartDate = requestedDates[0]!;
  const requestedEndDate = requestedDates.at(-1)!;
  const coverage = await coverageForStore(baseUrl, store, requestedStartDate, requestedEndDate, request);
  const missingProductDailyDates = requestedDates.filter((date) => !coverage.productDailyDates.includes(date));
  if (missingProductDailyDates.length > 0) {
    throw new Error(`waiting_product_daily：商品日数据尚未覆盖 ${missingProductDailyDates.join(", ")}，推广阶段需要稍后重试`);
  }
  const plans = planTmallPromotionDailyReports({
    requestedStartDate,
    requestedEndDate,
    productDailyDates: coverage.productDailyDates,
    promotionDates: coverage.promotionDates,
    requestedDates,
    maximumDays: options.maximumDays,
  });

  const executeDate = options.executeDate ?? runTmallPromotionDate;
  const dailyResults = await runPromotionDailyPlansSequentially(plans, async (plan) => executeDate({
      store,
      baseUrl,
      request,
      auditDirectory: runAuditDirectory,
      plan,
    }));
  const executedResults = dailyResults;
  const importedCount = executedResults.filter((result) => result.status === "imported").length;
  const duplicateCount = executedResults.filter((result) => result.status === "duplicate").length;
  const skippedCount = dailyResults.length - executedResults.length;
  const firstExecuted = executedResults[0];
  return {
    ok: true,
    stage: "promotion",
    status: importedCount > 0 ? "imported" as const : duplicateCount > 0 ? "duplicate" as const : "skipped" as const,
    mode: "daily" as const,
    reason: undefined,
    storeKey: store.storeKey,
    shopName: store.shopName,
    startDate: plans[0]!.startDate,
    endDate: plans[plans.length - 1]!.endDate,
    dates: plans.map((plan) => plan.startDate),
    plannedDates: plans.map((plan) => plan.startDate),
    completedDates: dailyResults.map((result) => result.date),
    reportCount: executedResults.length,
    importedCount,
    duplicateCount,
    skippedCount,
    fileName: dailyResults.length === 1 ? firstExecuted?.fileName : undefined,
    sha256: dailyResults.length === 1 ? firstExecuted?.sha256 : undefined,
    rowCount: executedResults.reduce((sum, result) => sum + (result.rowCount ?? 0), 0),
    warningCount: executedResults.reduce((sum, result) => sum + (result.warningCount ?? 0), 0),
    batchId: dailyResults.length === 1 ? firstExecuted?.batchId : undefined,
    dailyResults,
    forcedExistingDates: options.forceExistingDates === true,
    coverageConfirmed: dailyResults.every((result) => result.coverageConfirmed),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const storeKeyIndex = argv.indexOf("--store-key");
  const storeKey = storeKeyIndex >= 0 ? argv[storeKeyIndex + 1] : "tmall-yijiu";
  const datesIndex = argv.indexOf("--dates");
  const datesValue = datesIndex >= 0 ? argv[datesIndex + 1] : undefined;
  const dates = datesValue === undefined
    ? undefined
    : [...new Set(datesValue.split(",").map((date) => date.trim()).filter(Boolean))].sort();
  if (datesValue !== undefined && dates?.length === 0) throw new Error("--dates 必须是逗号分隔的 YYYY-MM-DD 日期");
  const forceExistingDates = argv.includes("--force-existing");
  if (forceExistingDates && dates === undefined) throw new Error("--force-existing 只能与 --dates 一起使用");
  const result = argv.includes("--launch-only")
    ? await launchTmallPromotionLogin(storeKey)
    : await runTmallPromotionStage({ storeKey, dates, forceExistingDates });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
