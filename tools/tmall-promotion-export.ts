import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Frame, Locator, Page } from "playwright-core";

import { launchDedicatedChrome } from "../lib/jackyun/cdp-client";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { inspectTmallImportBytes } from "../lib/netshop/import-service";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import { shanghaiYesterday } from "./tmall-multi-store-import-runner";
import { createTmallBrowserDownloadSession } from "./tmall-product-master-export";

export const TMALL_PROMOTION_HOME_URL = "https://one.alimama.com/index.html";
export const TMALL_PROMOTION_DOWNLOAD_LIST_URL = "https://one.alimama.com/index.html?spm=a21dvs.28711903.0.d53b8f72b.7a7362ddGBIZmC#!/report/download-list";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(projectRoot, "outputs", "tmall-promotion-export");
const defaultChromeExecutable = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const maximumDownloadBytes = 25 * 1024 * 1024;
const maximumDaysPerRun = 30;
const reportGenerationTimeoutMs = 10 * 60 * 1000;
const reportRefreshIntervalMs = 8_000;

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
  file?: PromotionFileEvidence;
  batchId?: string;
  importStatus?: "imported" | "duplicate";
  warningCount?: number;
  error?: string;
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
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function isoDateArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && validDate(item)))].sort();
}

export function planTmallPromotionDateRange(input: {
  requestedStartDate: string;
  requestedEndDate: string;
  productDailyDates: readonly string[];
  promotionDates: readonly string[];
  maximumDays?: number;
}): PromotionDatePlan | null {
  if (!validDate(input.requestedStartDate) || !validDate(input.requestedEndDate) || input.requestedStartDate > input.requestedEndDate) {
    throw new Error("推广缺口规划日期范围无效");
  }
  const maximumDays = Math.max(1, Math.min(maximumDaysPerRun, Math.trunc(input.maximumDays ?? maximumDaysPerRun)));
  const promoted = new Set(input.promotionDates.filter(validDate));
  const missing = [...new Set(input.productDailyDates.filter((date) => (
    validDate(date)
    && date >= input.requestedStartDate
    && date <= input.requestedEndDate
    && !promoted.has(date)
  )))].sort();
  if (missing.length === 0) return null;
  const dates = [missing[0]!];
  for (let index = 1; index < missing.length && dates.length < maximumDays; index += 1) {
    if (missing[index] !== addDays(dates[dates.length - 1]!, 1)) break;
    dates.push(missing[index]!);
  }
  return { startDate: dates[0]!, endDate: dates[dates.length - 1]!, dates };
}

export function isSafePromotionDismissLabel(value: string) {
  const label = normalizeText(value).replace(/[\s·]/g, "");
  if (!label || /去优化|立即处理|立即参与|立即报名|查看详情|前往|购买|开通|升级/.test(label)) return false;
  return /^(关闭|忽略|暂不|暂不开启|暂不参加|稍后|以后再说|我知道了|知道了|取消|×|✕|close)$/i.test(label);
}

export function isPromotionReportSuccessNavigation(input: { label: string; context: string }) {
  const label = normalizeText(input.label).replace(/[\s·]/g, "");
  const context = normalizeText(input.context);
  return /^(立即前往|前往下载|立即前往下载)$/.test(label)
    && /离线数据生成成功/.test(context)
    && /下载任务管理/.test(context);
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
  if (matching.length === 0) return null;
  if (matching[1] && matching[1].createdAt === matching[0]!.createdAt && matching[1].signature !== matching[0]!.signature) return null;
  return matching[0]!.signature;
}

export function assertPromotionImportPayload(
  payload: PromotionImportPayload,
  expected: { shopName: string; startDate: string; endDate: string; rowCount: number },
) {
  const batch = payload.batch;
  const verification = payload.verification;
  if (payload.ok !== true || (payload.status !== "imported" && payload.status !== "duplicate") || !batch?.id
    || batch.source !== "tmall_promotion" || batch.dataset !== "promotion_daily" || batch.platform !== "天猫"
    || batch.shopName !== expected.shopName || batch.status !== "completed" || batch.rowCount !== expected.rowCount
    || batch.dateMin !== expected.startDate || batch.dateMax !== expected.endDate
    || verification?.verified !== true || verification.readbackRowCount !== expected.rowCount
    || verification.dataset !== "promotion_daily" || verification.platform !== "天猫"
    || verification.shopName !== expected.shopName || verification.dateMin !== expected.startDate
    || verification.dateMax !== expected.endDate) {
    throw new Error(payload.message ?? "推广导入批次、店铺、日期、行数或落库回查不一致");
  }
  return {
    batchId: batch.id,
    status: payload.status,
    warningCount: Number(batch.warningCount ?? 0),
  } as const;
}

async function coverageForStore(baseUrl: string, store: TmallStore, startDate: string, endDate: string, request: typeof fetch) {
  const params = new URLSearchParams({
    platform: "天猫",
    shop: store.shopName,
    startDate,
    endDate,
    page: "1",
    pageSize: "1",
  });
  const response = await request(`${baseUrl}/api/netshop/promotion-performance?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as PromotionCoveragePayload | null;
  if (!response.ok || !payload?.coverage) {
    throw new Error(`无法读取 ${store.shopName} 的推广/商品日期覆盖（HTTP ${response.status}）`);
  }
  return {
    productDailyDates: isoDateArray(payload.coverage.productDailyDates),
    promotionDates: isoDateArray(payload.coverage.promotionDates),
  };
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

async function assertAlimamaIdentity(page: Page, store: TmallStore) {
  const url = page.url();
  const text = await combinedPageText(page);
  if (/login\.taobao\.com|passport|oauth|member\/login/i.test(url)
    || /扫码登录|密码登录|账户登录/.test(text) && !/货品全站推|推广中心|下载任务管理/.test(text)) {
    throw new Error("waiting_login：亿玖店独立浏览器尚未登录阿里妈妈，请先人工登录后重试");
  }
  const expected = store.shopName.replace(/^天猫-/, "");
  const shorter = expected.replace(/专卖店$/, "");
  if (!text.includes(expected) && !text.includes(shorter)) {
    throw new Error(`shop_identity_mismatch：阿里妈妈页面未显示受控店铺“${expected}”，已停止推广导出`);
  }
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
          const positionScore = preference === "left"
            ? Math.max(0, 6 - Math.floor(box.x / Math.max(1, viewport.width / 8)))
            : preference === "right"
              ? Math.max(0, 6 - Math.floor((viewport.width - box.x - box.width) / Math.max(1, viewport.width / 8)))
              : 0;
          candidates.push({ locator, frame, box, label, signature, score: semanticScore + positionScore });
        }
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score || left.box.y - right.box.y || left.box.x - right.box.x);
}

async function clickPageText(page: Page, labels: readonly string[], preference: "left" | "right" | "none" = "none") {
  const candidates = await positionedTextActions(page, labels, preference);
  const selected = candidates[0];
  if (!selected) throw new Error(`页面缺少可见操作：${labels.join("/")}`);
  if (candidates[1] && candidates[1].score === selected.score && candidates[1].signature !== selected.signature
    && Math.abs(candidates[1].box.x - selected.box.x) < 8 && Math.abs(candidates[1].box.y - selected.box.y) < 8) {
    throw new Error(`页面存在多个同等操作候选：${labels.join("/")}`);
  }
  await selected.locator.click({ timeout: 15_000 });
}

async function actionContext(locator: Locator) {
  return locator.evaluate((element) => {
    let current: Element | null = element;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const role = current.getAttribute("role") ?? "";
      const className = typeof current.className === "string" ? current.className : "";
      if (role === "dialog" || /modal|dialog|popup|notice|message|advert|activity/i.test(className)) {
        return (current.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
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
      const actions = frame.locator('button,a,[role="button"],[aria-label],[title],[class*="close" i]');
      const count = Math.min(await actions.count().catch(() => 0), 400);
      for (let index = 0; index < count; index += 1) {
        const locator = actions.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;
        const detail = await locator.evaluate((element) => ({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          aria: element.getAttribute("aria-label") ?? "",
          title: element.getAttribute("title") ?? "",
        })).catch(() => ({ text: "", aria: "", title: "" }));
        const label = [detail.text, detail.aria, detail.title].find(isSafePromotionDismissLabel);
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

async function findDownloadReportDialog(page: Page) {
  for (const frame of page.frames()) {
    const dialogs = frame.getByRole("dialog");
    const count = Math.min(await dialogs.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = dialogs.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      if ((await locator.innerText({ timeout: 3_000 }).catch(() => "")).includes("下载报表")) return { frame, locator };
    }
    const heading = frame.getByText("下载报表", { exact: true });
    const headingCount = Math.min(await heading.count().catch(() => 0), 10);
    for (let index = 0; index < headingCount; index += 1) {
      const item = heading.nth(index);
      if (!await item.isVisible().catch(() => false)) continue;
      let scope = item;
      for (let depth = 0; depth < 6; depth += 1) {
        scope = scope.locator("xpath=..");
        const text = await scope.innerText({ timeout: 1_000 }).catch(() => "");
        if (/日期范围/.test(text) && /数据指标/.test(text) && /确定/.test(text)) return { frame, locator: scope };
      }
    }
  }
  return null;
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

async function findDatePopupScope(page: Page) {
  const scopes: Array<{ locator: Locator; area: number }> = [];
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
            scopes.push({ locator: scope, area: box.width * box.height });
            break;
          }
        }
      }
    }
  }
  return scopes.sort((left, right) => left.area - right.area)[0]?.locator ?? null;
}

async function clickUniqueWithin(scope: Locator, label: string) {
  const roleButtons = scope.getByRole("button", { name: label, exact: true });
  const textButtons = scope.getByText(label, { exact: true });
  for (const collection of [roleButtons, textButtons]) {
    const visible: Locator[] = [];
    const count = Math.min(await collection.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = collection.nth(index);
      if (await locator.isVisible().catch(() => false)) visible.push(locator);
    }
    if (visible.length === 1) {
      await visible[0]!.click({ timeout: 10_000 });
      return;
    }
    if (visible.length > 1) throw new Error(`弹窗内存在多个“${label}”操作，为防止误点已停止`);
  }
  throw new Error(`弹窗内缺少“${label}”操作`);
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
  if (visibleInputs.length < 2) throw new Error("日期选择弹层没有唯一的起止日期输入框");
  await setInputValue(visibleInputs[0]!, startDate);
  await setInputValue(visibleInputs[1]!, endDate);
  await clickUniqueWithin(datePopup, "确定");
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

async function chooseAllMetrics(page: Page, dialog: Locator) {
  const clickChoice = async (scope: Locator) => {
    const choices = scope.getByText("全部数据指标", { exact: true });
    const count = Math.min(await choices.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const choice = choices.nth(index);
      if (!await choice.isVisible().catch(() => false)) continue;
      const label = choice.locator("xpath=ancestor-or-self::label[1]");
      if (await label.count().catch(() => 0)) await label.click({ timeout: 5_000 });
      else await choice.click({ timeout: 5_000 });
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
  if (!/one\.alimama\.com/i.test(page.url())) {
    await page.goto(TMALL_PROMOTION_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  dismissedPopups += await dismissBlockingPopups(page);
  await waitForAlimamaIdentity(page, store);
  dismissedPopups += await dismissBlockingPopups(page);
  await clickPageText(page, ["推广"], "left");
  await waitUntil(30_000, async () => (await combinedPageText(page)).includes("货品全站推"), "推广菜单未展开");
  dismissedPopups += await dismissBlockingPopups(page);
  await clickPageText(page, ["货品全站推"], "left");
  await waitUntil(60_000, async () => (await combinedPageText(page)).includes("货品全站推广"), "货品全站推页面加载超时");
  dismissedPopups += await dismissBlockingPopups(page);
  await clickPageText(page, ["报表"], "none");
  await waitUntil(30_000, async () => (await positionedTextActions(page, ["下载报表"], "right")).length > 0, "货品全站推报表页缺少下载报表按钮");
  return dismissedPopups;
}

async function launchStoreChrome(store: TmallStore) {
  const executablePath = process.env.CHROME_EXECUTABLE_PATH?.trim() || defaultChromeExecutable;
  if (!path.isAbsolute(executablePath)) throw new Error("CHROME_EXECUTABLE_PATH 必须是绝对路径");
  await mkdir(store.browser.downloadDir, { recursive: true });
  await launchDedicatedChrome({
    executablePath,
    profileDirectory: path.resolve(projectRoot, store.browser.profileDir),
    port: store.browser.debugPort,
    startUrl: TMALL_PROMOTION_HOME_URL,
    headless: false,
    visible: true,
  });
}

export async function launchTmallPromotionLogin(storeKey = "tmall-yijiu") {
  const store = await getTmallStore(storeKey);
  await launchStoreChrome(store);
  return {
    ok: true,
    status: "browser_ready" as const,
    storeKey: store.storeKey,
    shopName: store.shopName,
    targetUrl: TMALL_PROMOTION_HOME_URL,
    profileDirectory: store.browser.profileDir,
    debugPort: store.browser.debugPort,
  };
}

async function configureAndSubmitReport(options: {
  page: Page;
  store: TmallStore;
  startDate: string;
  endDate: string;
  beforeSubmit: () => Promise<void>;
}) {
  let dismissedPopups = await navigateToPromotionReport(options.page, options.store);
  dismissedPopups += await dismissBlockingPopups(options.page);
  await clickPageText(options.page, ["下载报表"], "right");
  const dialog = await waitUntilValue(10_000, async () => {
    const found = await findDownloadReportDialog(options.page);
    if (found) return found;
    dismissedPopups += await dismissBlockingPopups(options.page);
    return null;
  }, "下载报表弹窗未出现");
  await chooseDateRange(options.page, dialog.locator, options.startDate, options.endDate);
  dismissedPopups += await dismissBlockingPopups(options.page);
  await chooseAllMetrics(options.page, dialog.locator);
  dismissedPopups += await dismissBlockingPopups(options.page);
  await options.beforeSubmit();
  await clickUniqueWithin(dialog.locator, "确定");
  await waitUntil(15_000, async () => !await dialog.locator.isVisible().catch(() => false), "确认下载后报表弹窗未关闭，可能存在字段校验错误");
  const downloadPage = await clickReportSuccessNavigation(options.page, options.store);
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
    "确认生成报表后未出现包含“离线数据生成成功”的唯一前往下载提示",
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

function taskDateRange(text: string) {
  const match = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:至|~|～|—|–)\s*(\d{4}-\d{2}-\d{2})/);
  return match ? { startDate: match[1]!, endDate: match[2]! } : null;
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
      const range = taskDateRange(contextText);
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
        const range = taskDateRange(contextText);
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
  return assertPromotionImportPayload(payload, {
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

export async function runTmallPromotionStage(options: {
  storeKey?: string;
  baseUrl?: string;
  request?: typeof fetch;
  auditDirectory?: string;
} = {}) {
  const store = await getTmallStore(options.storeKey ?? "tmall-yijiu");
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const request = options.request ?? fetch;
  const runAuditDirectory = path.resolve(options.auditDirectory ?? artifactDirectory);
  if (!store.initialStartDate) throw new Error(`${store.shopName} 尚未配置推广补数起始日期`);
  const requestedEndDate = shanghaiYesterday();
  const coverage = await coverageForStore(baseUrl, store, store.initialStartDate, requestedEndDate, request);
  const plan = planTmallPromotionDateRange({
    requestedStartDate: store.initialStartDate,
    requestedEndDate,
    productDailyDates: coverage.productDailyDates,
    promotionDates: coverage.promotionDates,
  });
  if (!plan) {
    return {
      ok: true,
      stage: "promotion",
      status: "skipped" as const,
      reason: coverage.productDailyDates.length === 0 ? "waiting_product_daily" : "already_covered",
      storeKey: store.storeKey,
      shopName: store.shopName,
      coverageConfirmed: coverage.productDailyDates.every((date) => coverage.promotionDates.includes(date)),
    };
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
      let page = context.pages().find((candidate) => /one\.alimama\.com/i.test(candidate.url()));
      if (!page) page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const dismissDialog = (dialog: import("playwright-core").Dialog) => { void dialog.dismiss().catch(() => undefined); };
      page.on("dialog", dismissDialog);
      try {
        let downloadPage = page;
        if (!["report_submitting", "report_submitted"].includes(resume)) {
          audit.stage = "browser_ready";
          await writeAudit(audit, runAuditDirectory);
          const submission = await configureAndSubmitReport({
            page,
            store,
            startDate: plan.startDate,
            endDate: plan.endDate,
            beforeSubmit: async () => {
              audit.stage = "report_submitting";
              await writeAudit(audit, runAuditDirectory);
            },
          });
          audit.dismissedPopups += submission.dismissedPopups;
          downloadPage = submission.downloadPage;
          audit.stage = "report_submitted";
          await writeAudit(audit, runAuditDirectory);
        }
        const filePath = await waitForGeneratedTask({
          page: downloadPage,
          store,
          startDate: plan.startDate,
          endDate: plan.endDate,
          runStartedAt: audit.startedAt,
          runId: audit.runId,
        });
        file = await inspectPromotionFile(filePath, store, plan);
        audit.file = file;
        audit.stage = "downloaded";
        await writeAudit(audit, runAuditDirectory);
      } finally {
        page.off("dialog", dismissDialog);
        await browser.close().catch(() => undefined);
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
    await writeAudit(audit, runAuditDirectory);
    return {
      ok: true,
      stage: "promotion",
      status: imported.status,
      storeKey: store.storeKey,
      shopName: store.shopName,
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

async function main() {
  const argv = process.argv.slice(2);
  const storeKeyIndex = argv.indexOf("--store-key");
  const storeKey = storeKeyIndex >= 0 ? argv[storeKeyIndex + 1] : "tmall-yijiu";
  const result = argv.includes("--launch-only")
    ? await launchTmallPromotionLogin(storeKey)
    : await runTmallPromotionStage({ storeKey });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
