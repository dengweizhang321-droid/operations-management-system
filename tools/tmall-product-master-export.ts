import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
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
export const TMALL_PRODUCT_MANAGER_LABEL = "商品管家";
export const TMALL_IMPORTANT_NOTICE_LABEL = "重要通知";
export const TMALL_PRODUCT_INSPECTION_NOTICE_LABEL = "商品巡检";

const tmallExportConfirmationLabels = ["确认导出", "确认任务", "确认执行", "确认执行任务", "确定", "立即导出", "确认"] as const;

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
  entryMode?: "product_manager_opened" | "product_manager_floating_icon" | "product_manager_already_open" | "bulk_export_entry" | "assistant_direct";
  noticeState?: "dismissed" | "not_present";
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

type PositionedUiElement = {
  text: string;
  attributes: string;
  tag: string;
  role: string;
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  position?: string;
  cursor?: string;
};

export function scoreProductManagerCandidate(detail: PositionedUiElement) {
  const label = `${detail.text} ${detail.attributes}`.replace(/\s+/g, "").trim();
  const recognized = label.includes(TMALL_PRODUCT_MANAGER_LABEL) || /product[-_ ]?(manager|assistant)/i.test(label);
  if (!recognized || detail.viewportWidth <= 0 || detail.viewportHeight <= 0) return -1;
  const right = detail.left + detail.width;
  if (right < detail.viewportWidth * 0.9 || detail.top < detail.viewportHeight * 0.6) return -1;
  if (detail.width < 8 || detail.height < 8 || detail.width > 240 || detail.height > 180) return -1;
  let score = 10;
  if (["button", "a"].includes(detail.tag) || ["button", "link", "menuitem"].includes(detail.role)) score += 6;
  score += Math.min(6, Math.round((detail.top / detail.viewportHeight) * 6));
  score += Math.min(4, Math.round((detail.left / detail.viewportWidth) * 4));
  return score;
}

export function scoreProductManagerFloatingCandidate(detail: PositionedUiElement) {
  if (detail.viewportWidth <= 0 || detail.viewportHeight <= 0) return -1;
  const right = detail.left + detail.width;
  const bottom = detail.top + detail.height;
  if (right < detail.viewportWidth * 0.97 || bottom < detail.viewportHeight * 0.78 || detail.top > detail.viewportHeight * 0.96) return -1;
  if (detail.width < 16 || detail.height < 16 || detail.width > 120 || detail.height > 120) return -1;
  if (!["fixed", "sticky", "ancestor-fixed", "ancestor-sticky"].includes(detail.position ?? "")) return -1;
  const label = `${detail.text} ${detail.attributes}`.replace(/\s+/g, "").trim();
  if (/重要通知|商品巡检|关闭|返回顶部|回到顶部|客服|帮助|意见反馈|忽略|去优化|下载|翻译/.test(label)) return -1;
  const actionable = ["button", "a"].includes(detail.tag)
    || ["button", "link", "menuitem"].includes(detail.role)
    || detail.cursor === "pointer";
  if (!actionable) return -1;
  let score = 10;
  if (["button", "a"].includes(detail.tag) || ["button", "link"].includes(detail.role)) score += 6;
  if (detail.cursor === "pointer") score += 4;
  if (right >= detail.viewportWidth * 0.98) score += 5;
  if (detail.top <= detail.viewportHeight * 0.85) score += 3;
  return score;
}

export function productManagerFloatingClusterKey(detail: PositionedUiElement) {
  const centerX = detail.left + detail.width / 2;
  const centerY = detail.top + detail.height / 2;
  return `${Math.round(centerX / 12)}|${Math.round(centerY / 12)}`;
}

export function scoreChatSendCandidate(
  detail: { label: string; left: number; top: number; width: number; height: number },
  inputRect: { left: number; right: number; top: number; bottom: number },
) {
  if (detail.width < 10 || detail.height < 10 || detail.width > 96 || detail.height > 96) return -1;
  const centerX = detail.left + detail.width / 2;
  const centerY = detail.top + detail.height / 2;
  const besideInput = centerX >= inputRect.right - 96
    && centerX <= inputRect.right + 80
    && centerY >= inputRect.top - 15
    && centerY <= inputRect.bottom + 15;
  if (!besideInput) return -1;
  let score = 10;
  if (/发送|send|submit|arrow-up/i.test(detail.label)) score += 10;
  if (centerX >= inputRect.right - 64) score += 4;
  return score;
}

export function isTmallExportConfirmationLabel(text: string) {
  const normalized = text.replace(/\s+/g, "").trim();
  return tmallExportConfirmationLabels.includes(normalized as typeof tmallExportConfirmationLabels[number]);
}

export function hasAcceptedTmallExportTask(text: string) {
  const normalized = text.replace(/\s+/g, "");
  return /导出(?:\d+个)?商品到Excel/.test(normalized)
    && /任务\d*[:：]|待执行|任务已执行|执行结果|所有任务已完成|成功导出/.test(normalized);
}

export function isResumableTmallExportStage(stage: string | undefined) {
  return stage === "export_submitted" || stage === "export_confirmed";
}

export function isTmallProductWorkbookFilename(fileName: string) {
  return fileName.length > 5 && fileName.length <= 240 && /\.xlsx$/i.test(fileName) && !/[\u0000-\u001f<>:"/\\|?*]/.test(fileName);
}

export function scoreImportantNoticeCloseCandidate(detail: PositionedUiElement, notice: PositionedUiElement) {
  if (detail.viewportWidth <= 0 || detail.viewportHeight <= 0) return -1;
  if (notice.left < notice.viewportWidth * 0.45 || notice.top < notice.viewportHeight * 0.4) return -1;
  const centerX = detail.left + detail.width / 2;
  const centerY = detail.top + detail.height / 2;
  const closeLabel = `${detail.text} ${detail.attributes}`.replace(/\s+/g, " ").trim();
  const text = detail.text.replace(/\s+/g, "").trim();
  if (/去优化|立即优化/.test(text)) return -1;
  const explicitClose = text === "忽略" || /关闭|close|dismiss|我知道了|知道了|^[×✕x]$/i.test(closeLabel);
  const compact = detail.width >= 8 && detail.width <= 72 && detail.height >= 8 && detail.height <= 72;
  const nearby = centerX >= notice.left - 40
    && centerX <= notice.viewportWidth
    && centerY >= notice.top - 180
    && centerY <= notice.top + 260;
  if (!nearby || (!explicitClose && !compact)) return -1;
  let score = explicitClose ? 16 : 4;
  if (["button", "a"].includes(detail.tag) || ["button", "link"].includes(detail.role)) score += 5;
  if (compact) score += 4;
  if (centerX >= notice.left) score += 3;
  if (centerY <= notice.top + 80) score += 2;
  return score;
}

export function scoreTmallBlockingNoticeCandidate(detail: PositionedUiElement) {
  if (detail.viewportWidth <= 0 || detail.viewportHeight <= 0) return -1;
  if (detail.left < detail.viewportWidth * 0.45 || detail.top < detail.viewportHeight * 0.35) return -1;
  if (detail.width < 2 || detail.height < 2 || detail.width > 800 || detail.height > 700) return -1;
  const text = detail.text.replace(/\s+/g, "").trim();
  const structural = /notify[_-]?body/i.test(detail.attributes);
  const labeled = text.includes(TMALL_IMPORTANT_NOTICE_LABEL)
    || text.includes(TMALL_PRODUCT_INSPECTION_NOTICE_LABEL);
  if (!structural && !labeled) return -1;
  let score = 10;
  if (text === TMALL_IMPORTANT_NOTICE_LABEL || text === TMALL_PRODUCT_INSPECTION_NOTICE_LABEL) score += 10;
  if (structural) score += 8;
  score += Math.round((detail.left / detail.viewportWidth) * 5);
  score += Math.round((detail.top / detail.viewportHeight) * 5);
  return score;
}

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

function activeAuditPath(storeKey: string, auditDirectory = artifactDirectory) {
  return path.join(auditDirectory, `active-${safeSegment(storeKey)}.json`);
}

async function readActiveAudit(storeKey: string, auditDirectory = artifactDirectory) {
  const filePath = activeAuditPath(storeKey, auditDirectory);
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

async function writeActiveAudit(audit: MasterExportAudit, auditDirectory = artifactDirectory) {
  const updated = { ...audit, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(activeAuditPath(audit.storeKey, auditDirectory), updated);
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

async function textCandidates(page: Page, labels: readonly string[], scopeFrame?: Frame, scopeLocator?: Locator) {
  const candidates: TextCandidate[] = [];
  for (const frame of scopeFrame ? [scopeFrame] : page.frames()) {
    for (const label of labels) {
      const matches = scopeLocator && frame === scopeFrame
        ? scopeLocator.getByText(label, { exact: true })
        : frame.getByText(label, { exact: true });
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

async function clickText(page: Page, labels: readonly string[], optional = false, scopeFrame?: Frame, scopeLocator?: Locator) {
  for (const label of labels) {
    const candidates = await textCandidates(page, [label], scopeFrame, scopeLocator);
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

async function chatInputCandidates(page: Page) {
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
  return candidates;
}

async function maybeFindChatInput(page: Page) {
  const candidates = await chatInputCandidates(page);
  if (!candidates[0] || candidates[0].score < 5) return null;
  if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].signature !== candidates[0].signature) {
    throw new Error("检测到多个同等聊天输入框，为防止把指令填入商品搜索框已停止");
  }
  return candidates[0];
}

async function findChatInput(page: Page) {
  const input = await maybeFindChatInput(page);
  if (!input) throw new Error("未找到右侧千牛聊天输入框");
  return input;
}

async function positionedDetail(locator: Locator) {
  return await locator.evaluate((element): PositionedUiElement => {
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle(element);
    return {
      text: element.textContent ?? "",
      attributes: [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("class"),
        element.getAttribute("id"),
        element.getAttribute("name"),
        element.getAttribute("data-title"),
        element.getAttribute("data-tip"),
        element.getAttribute("data-tooltip"),
        ...Array.from(element.querySelectorAll('[aria-label],[title],img[alt],img[title]')).slice(0, 8).flatMap((child) => [
          child.getAttribute("aria-label"),
          child.getAttribute("title"),
          child.getAttribute("alt"),
        ]),
      ].filter(Boolean).join(" "),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") ?? "",
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: view?.innerWidth ?? 0,
      viewportHeight: view?.innerHeight ?? 0,
      position: style?.position ?? "",
      cursor: style?.cursor ?? "",
    };
  }).catch(() => null);
}

async function importantNoticeCandidates(page: Page) {
  const candidates: Array<TextCandidate & { detail: PositionedUiElement; actionScope?: Locator }> = [];
  for (const frame of page.frames()) {
    const sources = [
      frame.getByText(/重要通知|商品巡检/),
      frame.locator('[class*="notify_body" i],[class*="notify-body" i]'),
    ];
    for (const matches of sources) {
      const count = Math.min(await matches.count().catch(() => 0), 30);
      for (let index = 0; index < count; index += 1) {
        const locator = matches.nth(index);
        if (!await locator.isVisible().catch(() => false)) continue;
        const detail = await positionedDetail(locator);
        if (!detail) continue;
        const score = scoreTmallBlockingNoticeCandidate(detail);
        if (score < 0) continue;
        const container = locator.locator(
          "xpath=ancestor-or-self::*[.//*[self::button or self::a or @role='button']][1]",
        );
        const actionScope = await container.count().catch(() => 0) > 0 ? container : undefined;
        candidates.push({
          frame,
          locator,
          score,
          signature: `${frame.url()}|${detail.left}|${detail.top}|${detail.width}|${detail.height}`,
          detail,
          actionScope,
        });
      }
    }
  }
  const unique = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    if (!unique.has(candidate.signature)) unique.set(candidate.signature, candidate);
  }
  return [...unique.values()];
}

async function dismissImportantNotice(page: Page) {
  let notices: Awaited<ReturnType<typeof importantNoticeCandidates>> = [];
  const deadline = Date.now() + 4_000;
  do {
    notices = await importantNoticeCandidates(page);
    if (notices.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  } while (Date.now() < deadline);
  if (notices.length === 0) return "not_present" as const;

  const notice = notices[0]!;
  const actions = notice.actionScope
    ? notice.actionScope.locator('button,a,[role="button"],[aria-label],[title],[class*="close" i]')
    : notice.frame.locator('button,a,[role="button"],[aria-label],[title],[class*="close" i]');
  const count = Math.min(await actions.count().catch(() => 0), 120);
  const candidates: Array<{ locator: Locator; score: number; signature: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = actions.nth(index);
    if (!await locator.isVisible().catch(() => false)) continue;
    const detail = await positionedDetail(locator);
    if (!detail) continue;
    const score = scoreImportantNoticeCloseCandidate(detail, notice.detail);
    if (score < 0) continue;
    candidates.push({
      locator,
      score,
      signature: `${detail.left}|${detail.top}|${detail.width}|${detail.height}|${detail.attributes}`,
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates[0]) throw new Error("检测到右下角通知，但未找到可安全确认的“忽略/关闭”按钮");
  if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].signature !== candidates[0].signature) {
    throw new Error("右下角通知存在多个同等“忽略/关闭”候选，为防止误点已停止");
  }
  await candidates[0].locator.click({ timeout: 10_000 });
  await waitUntil(10_000, async () => !await notice.locator.isVisible().catch(() => false), "右下角通知点击“忽略/关闭”后仍然可见");
  return "dismissed" as const;
}

async function productManagerCandidates(page: Page) {
  const candidates: Array<TextCandidate & { detail: PositionedUiElement }> = [];
  for (const frame of page.frames()) {
    const matches = frame.locator([
      `:text-is("${TMALL_PRODUCT_MANAGER_LABEL}")`,
      `button:has-text("${TMALL_PRODUCT_MANAGER_LABEL}")`,
      `a:has-text("${TMALL_PRODUCT_MANAGER_LABEL}")`,
      `[role="button"]:has-text("${TMALL_PRODUCT_MANAGER_LABEL}")`,
      `[aria-label*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `[title*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `[data-title*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `[data-tip*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `[data-tooltip*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `img[alt*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      `img[title*="${TMALL_PRODUCT_MANAGER_LABEL}"]`,
      '[class*="product-manager" i]',
      '[class*="productmanager" i]',
      '[class*="product-assistant" i]',
    ].join(","));
    const count = Math.min(await matches.count().catch(() => 0), 50);
    for (let index = 0; index < count; index += 1) {
      const locator = matches.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const detail = await positionedDetail(locator);
      if (!detail) continue;
      const score = scoreProductManagerCandidate(detail);
      if (score < 0) continue;
      candidates.push({
        frame,
        locator,
        score,
        signature: `${frame.url()}|${detail.left}|${detail.top}|${detail.width}|${detail.height}`,
        detail,
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score);
}

async function productManagerFloatingCandidates(page: Page) {
  const candidates: Array<TextCandidate & { detail: PositionedUiElement }> = [];
  for (const frame of page.frames()) {
    const elements = frame.locator("body *");
    const raw = await elements.evaluateAll((items) => {
      const results: Array<{ index: number; detail: PositionedUiElement }> = [];
      for (let index = 0; index < items.length; index += 1) {
        const element = items[index]!;
        const view = element.ownerDocument.defaultView;
        if (!view) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8 || rect.right < view.innerWidth * 0.9 || rect.top < view.innerHeight * 0.35) continue;
        const style = view.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0) continue;
        let positioned: Element | null = element;
        let position = style.position;
        for (let depth = 0; depth < 5 && !["fixed", "sticky"].includes(position); depth += 1) {
          positioned = positioned.parentElement;
          if (!positioned) break;
          position = view.getComputedStyle(positioned).position;
        }
        if (!["fixed", "sticky"].includes(position)) continue;
        const attributes = [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("class"),
          element.getAttribute("id"),
          element.getAttribute("name"),
          element.getAttribute("data-title"),
          element.getAttribute("data-tip"),
          element.getAttribute("data-tooltip"),
          ...Array.from(element.querySelectorAll('[aria-label],[title],img[alt],img[title]')).slice(0, 8).flatMap((child) => [
            child.getAttribute("aria-label"),
            child.getAttribute("title"),
            child.getAttribute("alt"),
          ]),
        ].filter(Boolean).join(" ");
        results.push({
          index,
          detail: {
            text: element.textContent ?? "",
            attributes,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") ?? "",
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            viewportWidth: view.innerWidth,
            viewportHeight: view.innerHeight,
            position: positioned === element ? position : `ancestor-${position}`,
            cursor: style.cursor,
          },
        });
        if (results.length >= 50) break;
      }
      return results;
    }).catch(() => []);
    for (const item of raw) {
      const score = scoreProductManagerFloatingCandidate(item.detail);
      if (score < 0) continue;
      candidates.push({
        frame,
        locator: elements.nth(item.index),
        score,
        signature: `${frame.url()}|${item.detail.left}|${item.detail.top}|${item.detail.width}|${item.detail.height}|${item.detail.attributes}`,
        detail: item.detail,
      });
    }
  }
  const unique = new Map<string, TextCandidate & { detail: PositionedUiElement }>();
  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    const key = `${candidate.frame.url()}|${productManagerFloatingClusterKey(candidate.detail)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

async function openProductManagerChat(page: Page) {
  const existing = await maybeFindChatInput(page);
  if (existing) return { input: existing, entryMode: "product_manager_already_open" as const };

  let entryMode: "product_manager_opened" | "product_manager_floating_icon" = "product_manager_opened";
  let candidates = await productManagerCandidates(page);
  if (!candidates[0]) {
    entryMode = "product_manager_floating_icon";
    candidates = await productManagerFloatingCandidates(page);
  }
  if (!candidates[0]) throw new Error("未找到右下角“商品管家”入口（包括唯一无标签悬浮图标）");
  if (entryMode === "product_manager_floating_icon" && candidates.length > 1) {
    throw new Error("右下角存在多个无标签悬浮图标，无法唯一确认“商品管家”，为防止误点已停止");
  }
  if (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].signature !== candidates[0].signature) {
    throw new Error("右下角存在多个同等“商品管家”入口，为防止误点已停止");
  }
  await candidates[0].locator.click({ timeout: 10_000 });
  let input: Awaited<ReturnType<typeof maybeFindChatInput>> = null;
  await waitUntil(20_000, async () => {
    input = await maybeFindChatInput(page);
    return input !== null;
  }, "点击右下角“商品管家”后未出现右侧聊天输入框", 500);
  return { input: input!, entryMode };
}

async function chatOverlayScope(input: TextCandidate & { frame: Frame }) {
  const overlay = input.locator.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' next-overlay-wrapper ')][1]",
  );
  return await overlay.count().catch(() => 0) > 0 ? overlay : null;
}

async function clickSendOrPressEnter(input: TextCandidate & { frame: Frame }) {
  const inputRect = await input.locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  const senderScope = input.locator.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-sender ')][1]",
  );
  const overlayScope = await chatOverlayScope(input);
  const scope = await senderScope.count().catch(() => 0) > 0
    ? senderScope
    : overlayScope
      ? overlayScope
      : null;
  if (!scope) {
    await input.locator.press("Enter", { timeout: 10_000 });
    return;
  }
  const buttons = scope.locator('button,[role="button"]');
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
        label: [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("class"),
        ].filter(Boolean).join(" "),
      };
    }).catch(() => null);
    if (!detail) continue;
    const score = scoreChatSendCandidate(detail, inputRect);
    if (score > 0) candidates.push({ locator, score, signature: `${Math.round(detail.left)}|${Math.round(detail.top)}` });
  }
  candidates.sort((left, right) => right.score - left.score);
  if (candidates[0] && (!candidates[1] || candidates[0].score > candidates[1].score || candidates[0].signature === candidates[1].signature)) {
    try {
      await candidates[0].locator.click({ timeout: 10_000 });
      return;
    } catch {
      // The prompt is still in the textarea when a covered send control rejects the click.
      // Pressing Enter is the Sender component's scoped, non-global fallback.
    }
  }
  await input.locator.press("Enter", { timeout: 10_000 });
}

async function downloadCandidates(page: Page, scopeFrame?: Frame, scopeLocator?: Locator) {
  const candidates: DownloadCandidate[] = [];
  for (const frame of scopeFrame ? [scopeFrame] : page.frames()) {
    const root = scopeLocator && frame === scopeFrame ? scopeLocator : frame.locator("body");
    const links = root.locator('a,button,[role="button"]').filter({ hasText: "前往下载" });
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

async function downloadWithBrowserEvents(options: {
  page: Page;
  locator: Locator;
  downloadDirectory: string;
  targetPath: string;
}) {
  await mkdir(options.downloadDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(path.join(options.downloadDirectory, ".tmall-product-master-"));
  if (!inside(options.downloadDirectory, stagingDirectory)) throw new Error("浏览器下载暂存目录越过店铺独立目录");
  const session = await options.page.context().newCDPSession(options.page);
  let activeGuid: string | undefined;
  let resolveStarted!: (value: { guid: string; suggestedFilename: string }) => void;
  let resolveCompleted!: (value: { guid: string; filePath?: string }) => void;
  let rejectCompleted!: (error: Error) => void;
  const started = new Promise<{ guid: string; suggestedFilename: string }>((resolve) => {
    resolveStarted = resolve;
  });
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
    if (event.state === "canceled") rejectCompleted(new Error("Chrome 已取消商品管家 XLSX 下载"));
  });
  try {
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: stagingDirectory,
      eventsEnabled: true,
    });
    await options.locator.click({ timeout: 15_000 });
    const start = await withDeadline(started, 60_000, "点击“前往下载”后 Chrome 未开始浏览器级下载");
    if (!isTmallProductWorkbookFilename(start.suggestedFilename)) {
      throw new Error(`千牛返回的货品文件不是安全的 .xlsx：${safeSegment(start.suggestedFilename)}`);
    }
    const finish = await withDeadline(completed, 120_000, "Chrome 商品管家 XLSX 下载未在两分钟内完成");
    const stagedPath = path.resolve(finish.filePath || path.join(stagingDirectory, finish.guid));
    if (!inside(stagingDirectory, stagedPath)) throw new Error("Chrome 下载结果越过本轮暂存目录");
    await stat(stagedPath);
    const targetExists = await stat(options.targetPath).then(() => true).catch(() => false);
    if (targetExists) throw new Error("本轮商品管家规范文件已存在，为防止覆盖已停止");
    await rename(stagedPath, options.targetPath);
  } finally {
    await session.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => undefined);
    await session.detach().catch(() => undefined);
    if (inside(options.downloadDirectory, stagingDirectory)) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
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

async function launchStoreChrome(store: TmallStore) {
  const chromeExecutable = process.env.CHROME_EXECUTABLE_PATH?.trim() || defaultChromeExecutable;
  if (!path.isAbsolute(chromeExecutable)) throw new Error("CHROME_EXECUTABLE_PATH 必须是绝对路径");
  const profileDirectory = path.resolve(projectRoot, store.browser.profileDir);
  await mkdir(store.browser.downloadDir, { recursive: true });
  await launchDedicatedChrome({
    executablePath: chromeExecutable,
    profileDirectory,
    port: store.browser.debugPort,
    startUrl: TMALL_SELLER_ON_SALE_URL,
    headless: false,
    visible: true,
  });
  return { profileDirectory, debugPort: store.browser.debugPort };
}

export async function launchTmallProductMasterLogin(storeKey = "tmall-yijiu") {
  const store = await getTmallStore(storeKey);
  const browser = await launchStoreChrome(store);
  return {
    ok: true,
    status: "browser_ready" as const,
    storeKey: store.storeKey,
    shopName: store.shopName,
    targetUrl: TMALL_SELLER_ON_SALE_URL,
    ...browser,
  };
}

async function browserExport(options: {
  store: TmallStore;
  snapshotDate: string;
  runId: string;
  resumeStage?: "export_submitted" | "export_confirmed";
  entryMode?: MasterExportAudit["entryMode"];
  noticeState?: MasterExportAudit["noticeState"];
  onStage: (stage: MasterExportAuditStage, patch?: Partial<MasterExportAudit>) => Promise<void>;
}) {
  await launchStoreChrome(options.store);
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
    if (!options.resumeStage) await options.onStage("browser_ready");

    const currentNoticeState = await dismissImportantNotice(page);
    const productManager = await openProductManagerChat(page);
    const entryMode = options.entryMode ?? productManager.entryMode;
    const noticeState = currentNoticeState === "dismissed"
      ? currentNoticeState
      : options.noticeState ?? currentNoticeState;
    let input = productManager.input;
    let chatScope = await chatOverlayScope(input);
    const baselineDownloads = new Set<string>();
    if (!options.resumeStage) {
      await clickText(page, ["新会话"], true, input.frame, chatScope ?? undefined);
      input = await findChatInput(page);
      chatScope = await chatOverlayScope(input);
      for (const item of await downloadCandidates(page, input.frame, chatScope ?? undefined)) {
        baselineDownloads.add(item.signature);
      }
      await input.locator.fill(TMALL_MASTER_EXPORT_PROMPT, { timeout: 10_000 });
      await options.onStage("export_submitting", { entryMode, noticeState });
      await clickSendOrPressEnter(input);
      await options.onStage("export_submitted", { entryMode, noticeState });
    }

    const chatText = async () => chatScope
      ? await chatScope.innerText({ timeout: 5_000 }).catch(() => "")
      : await frameText(input.frame);
    if (options.resumeStage !== "export_confirmed") {
      await waitUntil(90_000, async () => {
        const confirmations = await textCandidates(
          page!,
          tmallExportConfirmationLabels,
          input.frame,
          chatScope ?? undefined,
        );
        if (confirmations[0]) {
          const best = confirmations[0];
          if (confirmations[1] && confirmations[1].score === best.score && confirmations[1].signature !== best.signature) {
            throw new Error("商品管家存在多个同等导出确认候选，为防止误点已停止");
          }
          await best.locator.click({ timeout: 10_000 });
          return true;
        }
        const downloads = (await downloadCandidates(page!, input.frame, chatScope ?? undefined))
          .filter((candidate) => !baselineDownloads.has(candidate.signature));
        if (downloads.length > 1) throw new Error("商品管家返回多个导出下载链接，无法唯一确认当前任务");
        return downloads.length === 1 || hasAcceptedTmallExportTask(await chatText());
      }, "商品管家未出现导出确认、任务受理或下载结果");
      await options.onStage("export_confirmed", { entryMode, noticeState });
    }

    let newDownload: DownloadCandidate | null = null;
    await waitUntil(exportResultTimeoutMs, async () => {
      const current = await downloadCandidates(page!, input.frame, chatScope ?? undefined);
      const fresh = current.filter((candidate) => !baselineDownloads.has(candidate.signature));
      if (fresh.length === 1) {
        const text = await chatText();
        if (/成功导出\s*\d+\s*个商品到Excel文件|所有任务已完成/.test(text)) newDownload = fresh[0]!;
      }
      if (fresh.length > 1) throw new Error("千牛助手返回多个新的下载链接，无法唯一确认本轮导出");
      return newDownload !== null;
    }, "等待千牛生成全部商品 Excel 超时", 2_000);

    const canonicalName = `${safeSegment(options.store.shopName)}-出售中全部商品-${options.snapshotDate}-${options.runId}.xlsx`;
    const targetPath = path.resolve(options.store.browser.downloadDir, canonicalName);
    if (!inside(options.store.browser.downloadDir, targetPath)) throw new Error("下载目标越过店铺独立目录");
    await downloadWithBrowserEvents({
      page,
      locator: newDownload!.locator,
      downloadDirectory: options.store.browser.downloadDir,
      targetPath,
    });
    return { targetPath, entryMode, noticeState };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function runTmallProductMasterStage(options: {
  storeKey?: string;
  baseUrl?: string;
  request?: typeof fetch;
  snapshotDate?: string;
  auditDirectory?: string;
} = {}): Promise<TmallProductMasterStageResult> {
  const store = await getTmallStore(options.storeKey ?? "tmall-yijiu");
  const baseUrl = normalizeLocalBaseUrl(options.baseUrl ?? process.env.OPERATIONS_SYSTEM_URL ?? "http://localhost:3000");
  const snapshotDate = options.snapshotDate ?? shanghaiToday();
  const request = options.request ?? fetch;
  const runAuditDirectory = path.resolve(options.auditDirectory ?? artifactDirectory);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("天猫货品快照日期必须是 YYYY-MM-DD");

  const current = await latestMasterBatch(baseUrl, store, request);
  if (currentMasterSnapshot(current, snapshotDate, store.shopName)) {
    const completedActive = await readActiveAudit(store.storeKey, runAuditDirectory);
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

  await mkdir(runAuditDirectory, { recursive: true });
  const existing = await readActiveAudit(store.storeKey, runAuditDirectory);
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
    } else if (audit.stage === "export_submitting") {
      throw new Error(`检测到未决千牛导出任务（${audit.stage}，清单 ${existing.filePath}），为防止重复发送已停止，请先人工核对右侧聊天任务`);
    } else if (isResumableTmallExportStage(audit.stage)) {
      // Resume the isolated current chat without starting a new conversation or sending the prompt again.
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
    }, runAuditDirectory);
  }
  let activeAudit: MasterExportAudit = audit;

  try {
    if (!evidence) {
      const downloaded = await browserExport({
        store,
        snapshotDate,
        runId: activeAudit.runId,
        resumeStage: isResumableTmallExportStage(activeAudit.stage)
          ? activeAudit.stage as "export_submitted" | "export_confirmed"
          : undefined,
        entryMode: activeAudit.entryMode,
        noticeState: activeAudit.noticeState,
        onStage: async (stage, patch = {}) => {
          activeAudit = await writeActiveAudit({ ...activeAudit, ...patch, stage }, runAuditDirectory);
        },
      });
      evidence = await inspectTmallMasterFile(downloaded.targetPath, store, snapshotDate);
      activeAudit = await writeActiveAudit({
        ...activeAudit,
        stage: "downloaded",
        entryMode: downloaded.entryMode,
        noticeState: downloaded.noticeState,
        file: evidence,
      }, runAuditDirectory);
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
    }, runAuditDirectory);
    const finalAuditPath = path.join(runAuditDirectory, `run-${activeAudit.runId}.json`);
    await writeJsonAtomic(finalAuditPath, activeAudit);
    await rm(activeAuditPath(store.storeKey, runAuditDirectory), { force: true });
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
    await writeActiveAudit({ ...activeAudit, lastError }, runAuditDirectory).catch(() => undefined);
    if (["planned", "browser_ready"].includes(activeAudit.stage)) {
      await rm(activeAuditPath(store.storeKey, runAuditDirectory), { force: true }).catch(() => undefined);
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
  const result = args.includes("--launch-only")
    ? await launchTmallProductMasterLogin(value("--store-key") ?? "tmall-yijiu")
    : await runTmallProductMasterStage({
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
