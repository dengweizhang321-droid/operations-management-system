import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Frame, Locator, Page } from "playwright-core";

import { launchDedicatedChrome } from "../lib/jackyun/cdp-client";
import { writeJsonAtomic } from "../lib/jackyun/json-file";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { inspectTmallImportBytes } from "../lib/netshop/import-service";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";

export const TMALL_SELLER_ON_SALE_URL = "https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20";
export const TMALL_MASTER_EXPORT_PROMPT = "导出全部商品";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(projectRoot, "outputs", "tmall-product-master-export");
const defaultChromeExecutable = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const maximumWorkbookBytes = 25 * 1024 * 1024;
const exportResultTimeoutMs = 10 * 60 * 1000;

type MasterImportBatch = {
  id?: string;
  source?: string;
  dataset?: string;
  platform?: string;
  shopName?: string;
  snapshotDate?: string | null;
  status?: string;
  rowCount?: number;
  warningCount?: number;
};

type MasterImportPayload = {
  ok?: boolean;
  status?: string;
  message?: string;
  batch?: MasterImportBatch | null;
  warnings?: Array<{ code?: string; message?: string }>;
  verification?: {
    verified?: boolean;
    parsedRowCount?: number;
    readbackRowCount?: number;
    dataset?: string;
    platform?: string;
    shopName?: string;
  };
};

type MasterFileEvidence = {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  sha256: string;
  rowCount: number;
  uniqueProductCount: number;
  uniqueSkuCount: number;
};

type MasterExportAuditStage =
  | "planned"
  | "browser_ready"
  | "export_submitting"
  | "export_submitted"
  | "export_confirmed"
  | "downloaded"
  | "completed";

type MasterExportAudit = {
  version: 1;
  runId: string;
  storeKey: string;
  shopName: string;
  snapshotDate: string;
  targetUrl: string;
  prompt: string;
  startedAt: string;
  updatedAt: string;
  stage: MasterExportAuditStage;
  entryMode?: "bulk_export_entry" | "assistant_direct";
  file?: MasterFileEvidence;
  importResult?: {
    status: "imported" | "duplicate";
    batchId: string;
    rowCount: number;
    warningCount: number;
  };
  lastError?: string;
};

export type TmallProductMasterStageResult = {
  ok: true;
  stage: "product_master";
  status: "skipped_current_snapshot" | "imported" | "duplicate";
  storeKey: string;
  shopName: string;
  snapshotDate: string;
  batchId: string;
  rowCount: number;
  warningCount: number;
  auditPath?: string;
  filePath?: string;
};

type TextCandidate = {
  frame: Frame;
  locator: Locator;
  score: number;
  signature: string;
};

type DownloadCandidate = {
  frame: Frame;
  locator: Locator;
  signature: string;
};

function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function normalizeLocalBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("天猫货品自动导入只允许连接本机运营系统");
  }
  return url.toString().replace(/\/$/, "");
}

function inside(directory: string, filePath: string) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "-").slice(0, 80);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function activeAuditPath(storeKey: string) {
  return path.join(artifactDirectory, `active-${safeSegment(storeKey)}.json`);
}

async function readActiveAudit(storeKey: string) {
  const filePath = activeAuditPath(storeKey);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as MasterExportAudit;
    if (parsed.version !== 1 || parsed.storeKey !== storeKey || !parsed.runId || !parsed.snapshotDate || !parsed.stage) {
      throw new Error("活动清单结构无效");
    }
    return { filePath, audit: parsed };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function writeActiveAudit(audit: MasterExportAudit) {
  const updated = { ...audit, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(activeAuditPath(audit.storeKey), updated);
  return updated;
}

async function latestMasterBatch(baseUrl: string, store: TmallStore, request: typeof fetch = fetch) {
  const params = new URLSearchParams({
    limit: "20",
    source: "tmall_product_master",
    platform: "天猫",
    shop: store.shopName,
  });
  const response = await request(`${baseUrl}/api/netshop/import?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { items?: unknown } | null;
  if (!response.ok || !Array.isArray(payload?.items)) {
    throw new Error(`无法读取 ${store.shopName} 的货品主数据批次（HTTP ${response.status}）`);
  }
  const batches = payload.items.filter((item): item is MasterImportBatch => Boolean(item && typeof item === "object"));
  return batches.find((batch) => batch.source === "tmall_product_master"
    && batch.dataset === "product_master"
    && batch.platform === "天猫"
    && batch.shopName === store.shopName
    && batch.status === "completed") ?? null;
}

export function currentMasterSnapshot(batch: MasterImportBatch | null, snapshotDate: string, shopName?: string) {
  return Boolean(batch
    && batch.snapshotDate === snapshotDate
    && (!shopName || batch.shopName === shopName)
    && batch.status === "completed"
    && batch.source === "tmall_product_master"
    && batch.dataset === "product_master"
    && batch.platform === "天猫"
    && typeof batch.id === "string"
    && typeof batch.rowCount === "number");
}

export async function inspectTmallMasterFile(
  filePath: string,
  store: Pick<TmallStore, "shopName" | "browser">,
  snapshotDate: string,
): Promise<MasterFileEvidence> {
  const resolved = path.resolve(filePath);
  if (!inside(store.browser.downloadDir, resolved) || !/\.xlsx$/i.test(resolved)) {
    throw new Error("天猫货品文件必须位于当前店铺独立下载目录且扩展名为 .xlsx");
  }
  const info = await stat(resolved);
  if (!info.isFile() || info.size <= 0 || info.size > maximumWorkbookBytes) {
    throw new Error("天猫货品文件为空、不是文件或超过 25MB");
  }
  const bytes = new Uint8Array(await readFile(resolved));
  const inspection = await inspectTmallImportBytes({
    source: "tmall_product_master",
    bytes,
    fileName: path.basename(resolved),
    fileSizeBytes: bytes.byteLength,
    platform: "天猫",
    shopName: store.shopName,
    snapshotDate,
  });
  if (inspection.errors.length > 0 || inspection.dataset !== "product_master"
    || inspection.platform !== "天猫" || inspection.shopName !== store.shopName
    || inspection.totals.rowCount <= 0) {
    const message = inspection.errors.map((issue) => issue.message).join("；") || "货品工作簿身份或行数不符合预期";
    throw new Error(`天猫货品工作簿校验失败：${message}`);
  }
  return {
    fileName: path.basename(resolved),
    filePath: resolved,
    fileSizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    rowCount: inspection.totals.rowCount,
    uniqueProductCount: inspection.totals.uniqueProductCount,
    uniqueSkuCount: inspection.totals.uniqueSkuCount,
  };
}

async function assertEvidenceUnchanged(evidence: MasterFileEvidence, store: Pick<TmallStore, "browser">) {
  if (!inside(store.browser.downloadDir, evidence.filePath)
    || path.basename(evidence.filePath) !== evidence.fileName
    || !/^[a-f0-9]{64}$/.test(evidence.sha256)) {
    throw new Error("活动清单中的货品文件身份无效");
  }
  const info = await stat(evidence.filePath);
  if (!info.isFile() || info.size !== evidence.fileSizeBytes) throw new Error("活动清单中的货品文件缺失或大小变化");
  const bytes = await readFile(evidence.filePath);
  if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) {
    throw new Error("活动清单中的货品文件哈希变化");
  }
}

export async function importTmallProductMasterFile(options: {
  baseUrl: string;
  store: Pick<TmallStore, "shopName">;
  snapshotDate: string;
  evidence: MasterFileEvidence;
  request?: typeof fetch;
}) {
  const request = options.request ?? fetch;
  const bytes = await readFile(options.evidence.filePath);
  const form = new FormData();
  form.append("source", "tmall_product_master");
  form.append("platform", "天猫");
  form.append("shop_name", options.store.shopName);
  form.append("snapshot_date", options.snapshotDate);
  form.append("note", "n8n 千牛出售中全部商品自动导出后导入");
  form.append("file", new File([bytes], options.evidence.fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));

  const response = await request(`${options.baseUrl}/api/netshop/import`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as MasterImportPayload | null;
  const batch = payload?.batch;
  const expectedStatus = payload?.status === "imported" ? 201 : payload?.status === "duplicate" ? 200 : 0;
  const verification = payload?.verification;
  if (response.status !== expectedStatus || !payload?.ok || (payload.status !== "imported" && payload.status !== "duplicate")
    || !batch?.id || batch.source !== "tmall_product_master" || batch.dataset !== "product_master"
    || batch.platform !== "天猫" || batch.shopName !== options.store.shopName || batch.snapshotDate !== options.snapshotDate
    || batch.status !== "completed" || batch.rowCount !== options.evidence.rowCount
    || verification?.verified !== true || verification.dataset !== "product_master"
    || verification.platform !== "天猫" || verification.shopName !== options.store.shopName
    || verification.parsedRowCount !== options.evidence.rowCount || verification.readbackRowCount !== options.evidence.rowCount) {
    throw new Error(payload?.message ?? `天猫货品主数据导入或落库回查失败（HTTP ${response.status}）`);
  }
  return {
    status: payload.status,
    batchId: batch.id,
    rowCount: batch.rowCount,
    warningCount: Number(batch.warningCount ?? 0),
    warnings: (payload.warnings ?? []).map((warning) => ({
      code: String(warning.code ?? "UNKNOWN"),
      message: String(warning.message ?? ""),
    })),
  } as const;
}

async function frameText(frame: Frame) {
  return await frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
}

async function combinedPageText(page: Page) {
  const texts = await Promise.all(page.frames().map((frame) => frameText(frame)));
  return texts.map((text) => text.slice(0, 30_000)).join("\n");
}

async function textCandidates(page: Page, labels: readonly string[], scopeFrame?: Frame) {
  const candidates: TextCandidate[] = [];
  for (const frame of scopeFrame ? [scopeFrame] : page.frames()) {
    for (const label of labels) {
      const matches = frame.getByText(label, { exact: true });
      const count = Math.min(await matches.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const locator = matches.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;
        const detail = await locator.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const tag = element.tagName.toLowerCase();
          const role = element.getAttribute("role") ?? "";
          return { tag, role, left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        }).catch(() => null);
        if (!detail || detail.width < 2 || detail.height < 2) continue;
        const score = ["button", "a"].includes(detail.tag) ? 10 : ["button", "menuitem", "link"].includes(detail.role) ? 8 : 1;
        candidates.push({
          frame,
          locator,
          score,
          signature: `${frame.url()}|${label}|${detail.left}|${detail.top}|${detail.width}|${detail.height}`,
        });
      }
    }
  }
  const unique = new Map<string, TextCandidate>();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.signature);
    if (!previous || candidate.score > previous.score) unique.set(candidate.signature, candidate);
  }
  return [...unique.values()].sort((left, right) => right.score - left.score);
}

async function clickText(page: Page, labels: readonly string[], optional = false, scopeFrame?: Frame) {
  for (const label of labels) {
    const candidates = await textCandidates(page, [label], scopeFrame);
    if (candidates.length === 0) continue;
    const best = candidates[0]!;
    if (candidates.length > 1 && candidates[1]!.score === best.score && candidates[1]!.signature !== best.signature) {
      throw new Error(`页面存在多个同等候选“${label}”，为防止误点已停止`);
    }
    await best.locator.click({ timeout: 10_000 });
    return true;
  }
  if (optional) return false;
  throw new Error(`页面未找到可点击的“${labels.join("/ ")}”`);
}

async function waitUntil(timeoutMs: number, probe: () => Promise<boolean>, errorMessage: string, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(errorMessage);
}

async function findChatInput(page: Page) {
  const candidates: Array<TextCandidate & { frame: Frame }> = [];
  for (const frame of page.frames()) {
    const inputs = frame.locator('textarea,input[type="text"],input:not([type]),[contenteditable="true"]');
    const count = Math.min(await inputs.count().catch(() => 0), 30);
    for (let index = 0; index < count; index += 1) {
      const locator = inputs.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const detail = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const attributes = [element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" ");
        const nearby = (element.closest('[role="dialog"],aside,section,form')?.textContent ?? element.parentElement?.textContent ?? "").slice(0, 2_000);
        const viewportWidth = element.ownerDocument.defaultView?.innerWidth ?? 0;
        return {
          tag: element.tagName.toLowerCase(),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          attributes,
          nearby,
          viewportWidth,
          contentEditable: element.getAttribute("contenteditable") === "true",
        };
      }).catch(() => null);
      if (!detail || detail.width < 80 || detail.height < 20) continue;
      let score = 0;
      if (detail.tag === "textarea") score += 5;
      if (detail.contentEditable) score += 5;
      if (/输入|消息|提问|问问|chat/i.test(detail.attributes)) score += 6;
      if (/新会话|执行结果|商品搜索|商品巡检|商品上架|商品下架/.test(detail.nearby)) score += 6;
      if (detail.viewportWidth > 0 && detail.left > detail.viewportWidth * 0.5) score += 4;
      if (/商品标题|商品ID|商家编码|搜索/.test(detail.attributes)) score -= 12;
      candidates.push({
        frame,
        locator,
        score,
        signature: `${frame.url()}|${detail.left}|${detail.top}|${detail.width}|${detail.height}`,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates[0] || candidates[0].score < 5) throw new Error("未找到右侧千牛聊天输入框");
  if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].signature !== candidates[0].signature) {
    throw new Error("检测到多个同等聊天输入框，为防止把指令填入商品搜索框已停止");
  }
  return candidates[0];
}

async function clickSendOrPressEnter(input: TextCandidate & { frame: Frame }) {
  const inputRect = await input.locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  const buttons = input.frame.locator('button,[role="button"]');
  const count = Math.min(await buttons.count().catch(() => 0), 80);
  const candidates: Array<{ locator: Locator; score: number; signature: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = buttons.nth(index);
    if (!await locator.isVisible().catch(() => false)) continue;
    const detail = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        label: [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" "),
      };
    }).catch(() => null);
    if (!detail || detail.width < 10 || detail.height < 10) continue;
    let score = /发送|send/i.test(detail.label) ? 12 : 0;
    const centerY = detail.top + detail.height / 2;
    if (detail.left >= inputRect.left && detail.left <= inputRect.right + 80
      && centerY >= inputRect.top - 15 && centerY <= inputRect.bottom + 15) score += 6;
    if (score > 0) candidates.push({ locator, score, signature: `${Math.round(detail.left)}|${Math.round(detail.top)}` });
  }
  candidates.sort((left, right) => right.score - left.score);
  if (candidates[0] && (!candidates[1] || candidates[0].score > candidates[1].score || candidates[0].signature === candidates[1].signature)) {
    await candidates[0].locator.click({ timeout: 10_000 });
    return;
  }
  await input.locator.press("Enter", { timeout: 10_000 });
}

async function downloadCandidates(page: Page, scopeFrame?: Frame) {
  const candidates: DownloadCandidate[] = [];
  for (const frame of scopeFrame ? [scopeFrame] : page.frames()) {
    const links = frame.locator('a,button,[role="button"]').filter({ hasText: "前往下载" });
    const count = Math.min(await links.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = links.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const detail = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          href: element instanceof HTMLAnchorElement ? element.href : "",
          text: element.textContent?.replace(/\s+/g, "").trim() ?? "",
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        };
      }).catch(() => null);
      if (!detail || !detail.text.includes("前往下载")) continue;
      candidates.push({ frame, locator, signature: `${frame.url()}|${detail.href}|${detail.left}|${detail.top}` });
    }
  }
  return [...new Map(candidates.map((candidate) => [candidate.signature, candidate])).values()];
}

async function configureExportEntry(page: Page) {
  if (await clickText(page, ["批量导出表格"], true)) return "bulk_export_entry" as const;
  if (await clickText(page, ["更多批量操作"], true)) {
    await waitUntil(10_000, async () => (await textCandidates(page, ["批量导出表格"])).length > 0, "展开批量操作后未出现“批量导出表格”");
    await clickText(page, ["批量导出表格"]);
    return "bulk_export_entry" as const;
  }
  return "assistant_direct" as const;
}

async function assertSellerIdentity(page: Page, store: TmallStore) {
  const url = page.url();
  const text = await combinedPageText(page);
  if (/login\.taobao\.com|passport|member\/login/i.test(url) || /扫码登录|密码登录|账户登录/.test(text)) {
    throw new Error("waiting_login：亿玖店独立浏览器尚未登录千牛，请先在该浏览器完成登录后重试");
  }
  const expected = store.shopName.replace(/^天猫-/, "");
  const shorter = expected.replace(/专卖店$/, "");
  if (!text.includes(expected) && !text.includes(shorter)) {
    throw new Error(`shop_identity_mismatch：页面未显示受控店铺“${expected}”，已停止导出`);
  }
  if (!text.includes("出售中")) throw new Error("千牛页面未进入“商品 > 出售中”列表");
}

async function browserExport(options: {
  store: TmallStore;
  snapshotDate: string;
  runId: string;
  onStage: (stage: MasterExportAuditStage, patch?: Partial<MasterExportAudit>) => Promise<void>;
}) {
  const chromeExecutable = process.env.CHROME_EXECUTABLE_PATH?.trim() || defaultChromeExecutable;
  if (!path.isAbsolute(chromeExecutable)) throw new Error("CHROME_EXECUTABLE_PATH 必须是绝对路径");
  const profileDirectory = path.resolve(projectRoot, options.store.browser.profileDir);
  await mkdir(options.store.browser.downloadDir, { recursive: true });
  await launchDedicatedChrome({
    executablePath: chromeExecutable,
    profileDirectory,
    port: options.store.browser.debugPort,
    startUrl: TMALL_SELLER_ON_SALE_URL,
    headless: false,
    visible: true,
  });
  const browser = await connectPlaywrightBrowser(options.store.browser.debugPort);
  const context = browser.contexts()[0];
  if (!context) throw new Error("亿玖店独立 Chrome 没有可用上下文");
  let page = context.pages().find((candidate) => /myseller\.taobao\.com/i.test(candidate.url()));
  if (!page) page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    if (!page.url().startsWith("https://myseller.taobao.com/home.htm/SellManage/on_sale")) {
      await page.goto(TMALL_SELLER_ON_SALE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    if (/login\.taobao\.com|passport|member\/login/i.test(page.url())) {
      throw new Error("waiting_login：亿玖店独立浏览器尚未登录千牛，请先在该浏览器完成登录后重试");
    }
    await waitUntil(60_000, async () => (await combinedPageText(page!)).includes("出售中"), "等待千牛出售中页面加载超时");
    await assertSellerIdentity(page, options.store);
    await options.onStage("browser_ready");

    const entryMode = await configureExportEntry(page);
    let input = await findChatInput(page);
    await clickText(page, ["新会话"], true, input.frame);
    input = await findChatInput(page);
    const baselineDownloads = new Set((await downloadCandidates(page, input.frame)).map((item) => item.signature));
    await input.locator.fill(TMALL_MASTER_EXPORT_PROMPT, { timeout: 10_000 });
    await options.onStage("export_submitting", { entryMode });
    await clickSendOrPressEnter(input);
    await options.onStage("export_submitted", { entryMode });

    await waitUntil(90_000, async () => (await textCandidates(page!, ["确认", "确认导出"], input.frame)).length > 0, "千牛助手未出现导出确认按钮");
    await clickText(page, ["确认导出", "确认"], false, input.frame);
    await options.onStage("export_confirmed", { entryMode });

    let newDownload: DownloadCandidate | null = null;
    await waitUntil(exportResultTimeoutMs, async () => {
      const current = await downloadCandidates(page!, input.frame);
      const fresh = current.filter((candidate) => !baselineDownloads.has(candidate.signature));
      if (fresh.length === 1) {
        const text = await frameText(fresh[0]!.frame);
        if (/成功导出\s*\d+\s*个商品到Excel文件|所有任务已完成/.test(text)) newDownload = fresh[0]!;
      }
      if (fresh.length > 1) throw new Error("千牛助手返回多个新的下载链接，无法唯一确认本轮导出");
      return newDownload !== null;
    }, "等待千牛生成全部商品 Excel 超时", 2_000);

    const canonicalName = `${safeSegment(options.store.shopName)}-出售中全部商品-${options.snapshotDate}-${options.runId}.xlsx`;
    const targetPath = path.resolve(options.store.browser.downloadDir, canonicalName);
    if (!inside(options.store.browser.downloadDir, targetPath)) throw new Error("下载目标越过店铺独立目录");
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await newDownload!.locator.click({ timeout: 15_000 });
    const download = await downloadPromise;
    const suggestedName = download.suggestedFilename();
    if (!/\.xlsx$/i.test(suggestedName)) throw new Error(`千牛返回的货品文件不是 .xlsx：${safeSegment(suggestedName)}`);
    await download.saveAs(targetPath);
    return { targetPath, entryMode };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runTmallProductMasterStage(options: {
  storeKey?: string;
  baseUrl?: string;
  request?: typeof fetch;
  snapshotDate?: string;
} = {}): Promise<TmallProductMasterStageResult> {
  const store = await getTmallStore(options.storeKey ?? "tmall-yijiu");
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const snapshotDate = options.snapshotDate ?? shanghaiToday();
  const request = options.request ?? fetch;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("天猫货品快照日期必须是 YYYY-MM-DD");

  const current = await latestMasterBatch(baseUrl, store, request);
  if (currentMasterSnapshot(current, snapshotDate, store.shopName)) {
    const completedActive = await readActiveAudit(store.storeKey);
    if (completedActive?.audit.snapshotDate === snapshotDate && completedActive.audit.shopName === store.shopName) {
      await rm(completedActive.filePath, { force: true });
    }
    return {
      ok: true,
      stage: "product_master",
      status: "skipped_current_snapshot",
      storeKey: store.storeKey,
      shopName: store.shopName,
      snapshotDate,
      batchId: current!.id!,
      rowCount: current!.rowCount!,
      warningCount: Number(current!.warningCount ?? 0),
    };
  }

  await mkdir(artifactDirectory, { recursive: true });
  const existing = await readActiveAudit(store.storeKey);
  let audit: MasterExportAudit | undefined = existing?.audit;
  let evidence: MasterFileEvidence | undefined;
  if (existing && audit) {
    if (audit.snapshotDate !== snapshotDate || audit.shopName !== store.shopName) {
      throw new Error(`存在未完成的天猫货品导出清单 ${existing.filePath}，其店铺或快照日期与本轮不一致，已停止以避免重复任务`);
    }
    if (audit.stage === "downloaded" && audit.file) {
      await assertEvidenceUnchanged(audit.file, store);
      evidence = await inspectTmallMasterFile(audit.file.filePath, store, snapshotDate);
      if (evidence.sha256 !== audit.file.sha256 || evidence.rowCount !== audit.file.rowCount) {
        throw new Error("恢复文件重新校验后与活动清单不一致");
      }
    } else if (["export_submitting", "export_submitted", "export_confirmed"].includes(audit.stage)) {
      throw new Error(`检测到未决千牛导出任务（${audit.stage}，清单 ${existing.filePath}），为防止重复发送已停止，请先人工核对右侧聊天任务`);
    } else {
      await rm(existing.filePath, { force: true });
      audit = undefined;
    }
  }

  if (!audit) {
    const now = new Date().toISOString();
    audit = await writeActiveAudit({
      version: 1,
      runId: randomUUID(),
      storeKey: store.storeKey,
      shopName: store.shopName,
      snapshotDate,
      targetUrl: TMALL_SELLER_ON_SALE_URL,
      prompt: TMALL_MASTER_EXPORT_PROMPT,
      startedAt: now,
      updatedAt: now,
      stage: "planned",
    });
  }
  let activeAudit: MasterExportAudit = audit;

  try {
    if (!evidence) {
      const downloaded = await browserExport({
        store,
        snapshotDate,
        runId: activeAudit.runId,
        onStage: async (stage, patch = {}) => {
          activeAudit = await writeActiveAudit({ ...activeAudit, ...patch, stage });
        },
      });
      evidence = await inspectTmallMasterFile(downloaded.targetPath, store, snapshotDate);
      activeAudit = await writeActiveAudit({ ...activeAudit, stage: "downloaded", entryMode: downloaded.entryMode, file: evidence });
    }

    const imported = await importTmallProductMasterFile({ baseUrl, store, snapshotDate, evidence, request });
    activeAudit = await writeActiveAudit({
      ...activeAudit,
      stage: "completed",
      importResult: {
        status: imported.status,
        batchId: imported.batchId,
        rowCount: imported.rowCount,
        warningCount: imported.warningCount,
      },
    });
    const finalAuditPath = path.join(artifactDirectory, `run-${activeAudit.runId}.json`);
    await writeJsonAtomic(finalAuditPath, activeAudit);
    await rm(activeAuditPath(store.storeKey), { force: true });
    return {
      ok: true,
      stage: "product_master",
      status: imported.status,
      storeKey: store.storeKey,
      shopName: store.shopName,
      snapshotDate,
      batchId: imported.batchId,
      rowCount: imported.rowCount,
      warningCount: imported.warningCount,
      auditPath: finalAuditPath,
      filePath: evidence.filePath,
    };
  } catch (error) {
    const lastError = safeError(error);
    await writeActiveAudit({ ...activeAudit, lastError }).catch(() => undefined);
    if (["planned", "browser_ready"].includes(activeAudit.stage)) {
      await rm(activeAuditPath(store.storeKey), { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const result = await runTmallProductMasterStage({
    storeKey: value("--store-key"),
    baseUrl: value("--base-url"),
    snapshotDate: value("--snapshot-date"),
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
