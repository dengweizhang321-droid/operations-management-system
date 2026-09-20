/**
 * Standalone sales-only export script.
 * Connects to the dedicated Chrome, navigates to 销售单明细账,
 * sets the monthly date range, queries, exports all pages, and
 * waits for the .xlsx download to land in D:\谷歌浏览器.
 *
 * Usage:  npx tsx tools/jackyun-sales-export-only.ts
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  CdpClient,
  connectChromeBrowser,
  connectJackyunTarget,
  evaluateValue,
  listChromeTargets,
} from "../lib/jackyun/cdp-client";
import { downloadSignedOssExport } from "../lib/jackyun/oss-download";

// ─── Config (mirrors jackyun-daily-policy.json) ───────────────────────────
const PORT = 9223;
const DOWNLOAD_DIR = "D:\\谷歌浏览器";
const PAGE_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const STABLE_SAMPLES = 2;
const ALLOWED_HOSTS = ["jackyun-shortterm.oss-cn-zhangjiakou.aliyuncs.com"];
const START_URL = "https://web.jackyun.com/home/mainframe_web_horizontal.html";
const SALES_PAGE_NAME = "销售单明细账";
const SALES_URL_HINTS = ["order_detail_list"];

// ─── Date helpers ──────────────────────────────────────────────────────────
function shanghaiYesterday(): string {
  const now = new Date();
  // Beijing = UTC+8
  const beijing = new Date(now.getTime() + 8 * 3600_000);
  beijing.setUTCDate(beijing.getUTCDate() - 1);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const d = String(beijing.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function salesStartDate(asOfDate: string): string {
  return `${asOfDate.slice(0, 8)}01`;
}

// ─── CDP helpers (copied from jackyun-browser-controller.ts) ───────────────
function jsDocumentsPrelude(urlHints: string[] = []) {
  return `
    const urlHints = ${JSON.stringify(urlHints)};
    const documents = [];
    const visit = (doc, include) => {
      if (include) documents.push(doc);
      for (const frame of doc.querySelectorAll('iframe,frame')) {
        const rect = frame.getBoundingClientRect();
        const style = frame.ownerDocument.defaultView.getComputedStyle(frame);
        if (rect.width <= 100 || rect.height <= 100 || style.visibility === 'hidden' || style.display === 'none') continue;
        const nextInclude = include || urlHints.some((hint) => (frame.src || '').includes(hint));
        try { if (frame.contentDocument) visit(frame.contentDocument, nextInclude); } catch {}
      }
    };
    visit(document, urlHints.length === 0);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/[（）]/g, (c) => c === '（' ? '(' : ')').replace(/\\s+/g, '').trim();
  `;
}

async function pageText(client: CdpClient) {
  return evaluateValue<string>(client, `(() => { ${jsDocumentsPrelude()} return documents.map((doc) => doc.body?.innerText || '').join(String.fromCharCode(10)); })()`);
}

async function currentUrl(client: CdpClient) {
  return evaluateValue<string>(client, "location.href");
}

async function activeContentUrl(client: CdpClient) {
  return evaluateValue<string | null>(client, `(() => {
    const frames = Array.from(document.querySelectorAll('iframe,frame'))
      .map((frame) => {
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return { src: frame.src || '', area: rect.width * rect.height, visible: rect.width > 100 && rect.height > 100 && style.visibility !== 'hidden' && style.display !== 'none' };
      })
      .filter((f) => f.visible && f.src && !/cockpit/i.test(f.src))
      .sort((a, b) => b.area - a.area);
    return frames[0]?.src ?? null;
  })()`);
}

async function clickText(client: CdpClient, text: string) {
  const result = await evaluateValue<{ clicked: boolean; actual?: string; x?: number; y?: number }>(client, `(() => {
    ${jsDocumentsPrelude()}
    const wanted = normalize(${JSON.stringify(text)});
    const candidates = documents.flatMap((doc) => Array.from(doc.querySelectorAll('button,a,li,span,div')))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent) === wanted)
      .sort((a, b) => {
        const rank = (el) => {
          const cls = String(el.className || '');
          const rect = el.getBoundingClientRect();
          if (/tip-button|button-blue|mini-button|x-btn|\\bbtn\\b/i.test(cls)) return 0;
          if (/toolbar-item|menuitem/i.test(cls)) return 1;
          if (/tab/i.test(cls) || (rect.top > 65 && rect.top < 120)) return 8;
          return 5;
        };
        const rankDelta = rank(a) - rank(b);
        if (rankDelta) return rankDelta;
        return a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      });
    const el = candidates[0];
    if (!el) return { clicked: false };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const point = (node) => {
      let rect = node.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      let win = node.ownerDocument.defaultView;
      while (win && win.frameElement) {
        const frameRect = win.frameElement.getBoundingClientRect();
        x += frameRect.left; y += frameRect.top; win = win.parent;
      }
      return { x, y };
    };
    return { clicked: true, actual: (el.innerText || el.textContent || '').trim(), ...point(el) };
  })()`);
  if (!result.clicked) {
    const body = await pageText(client).catch(() => "");
    throw new Error(`clickable text not found: ${text}; pageText=${body.slice(0, 500)}`);
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: result.x, y: result.y, button: "none" });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: result.x, y: result.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: result.x, y: result.y, button: "left", clickCount: 1 });
  return result.actual ?? text;
}

async function clickAnyText(client: CdpClient, texts: string[]) {
  let lastError: unknown;
  for (const text of texts) {
    try { return await clickText(client, text); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`页面未找到：${texts.join(" / ")}`);
}

async function isActiveText(client: CdpClient, text: string) {
  return evaluateValue<boolean>(client, `(() => {
    ${jsDocumentsPrelude()}
    const wanted = normalize(${JSON.stringify(text)});
    const elements = documents.flatMap((doc) => Array.from(doc.querySelectorAll('span,div,a,li')))
      .filter((el) => visible(el) && normalize(el.innerText || el.textContent) === wanted);
    return elements.some((el) => {
      let current = el;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        if (/active|selected|focus|x-tab-active/i.test(current.className || '') || current.getAttribute('aria-selected') === 'true') return true;
      }
      return false;
    });
  })()`);
}

async function setDateInputs(client: CdpClient, values: string[], urlHints: string[] = []) {
  return evaluateValue<string[]>(client, `(() => {
    ${jsDocumentsPrelude(urlHints)}
    const isDateLikeValue = (value) => /^\\d{4}-\\d{2}-\\d{2}(?: \\d{2}:\\d{2}:\\d{2})?$/.test(value || '');
    const dateInputs = documents.flatMap((doc) => Array.from(doc.querySelectorAll('input')))
      .filter((el) => {
        if (!visible(el)) return false;
        const key = ((el.id || '') + ' ' + (el.name || '')).toLowerCase();
        if (/select.*time|timestr|time.*str/.test(key)) return false;
        return isDateLikeValue(el.value || '') || /日期|时间/.test(el.placeholder || '') || /time|date/i.test(key);
      })
      .sort((a, b) => {
        const rank = (el) => {
          const key = ((el.id || '') + ' ' + (el.name || '')).toLowerCase();
          if (/begin|start|from/.test(key)) return 0;
          if (/end|to/.test(key)) return 1;
          if (isDateLikeValue(el.value || '')) return 2;
          return 3;
        };
        return rank(a) - rank(b);
      });
    if (dateInputs.length < ${values.length}) throw new Error('页面日期输入框数量不足');
    const targets = dateInputs.slice(0, ${values.length});
    const expected = ${JSON.stringify(values)};
    targets.forEach((input, index) => {
      if (input.value === expected[index]) return;
      const setter = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(input, expected[index]) : input.value = expected[index];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    return targets.map((input) => input.value);
  })()`);
}

async function waitForPageText(client: CdpClient, text: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await pageText(client);
    if (/验证码|重新登录|账号登录/.test(body) && !body.includes(text)) throw new Error("吉客云出现登录验证，已停止。");
    if (body.includes(text)) return body;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`页面未在规定时间内进入：${text}`);
}

async function waitForActiveModule(client: CdpClient, text: string, timeoutMs: number, previousContentUrl?: string | null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await pageText(client);
    if (/验证码|重新登录|账号登录/.test(body) && !body.includes(text)) throw new Error("吉客云出现登录验证，已停止。");
    const contentUrl = await activeContentUrl(client);
    if (contentUrl && SALES_URL_HINTS.some((hint) => contentUrl.includes(hint))) return;
    if (contentUrl && previousContentUrl && contentUrl !== previousContentUrl && !/cockpit/i.test(contentUrl)) return;
    if (await isActiveText(client, text)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`无法确认当前激活模块：${text}`);
}

async function stableRowCount(client: CdpClient, urlHints: string[] = []) {
  let previous: number | null = null;
  let stable = 0;
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const gridTotal = await evaluateValue<number | null>(client, `(() => {
      ${jsDocumentsPrelude(urlHints)}
      for (const doc of documents) {
        const win = doc.defaultView;
        const grids = ['gridOrderDetail', 'grid'].map((id) => win?.mini?.get?.(id)).filter(Boolean);
        for (const grid of grids) {
          if (grid && grid.isLoading === false && Number.isSafeInteger(grid.totalCount) && grid.totalCount > 0) return grid.totalCount;
        }
      }
      return null;
    })()`);
    if (gridTotal !== null) {
      if (gridTotal === previous) stable += 1;
      else { previous = gridTotal; stable = 1; }
      if (stable >= STABLE_SAMPLES) return gridTotal;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    const text = await evaluateValue<string>(client, `(() => { ${jsDocumentsPrelude(urlHints)} return documents.map((doc) => doc.body?.innerText || '').join(String.fromCharCode(10)); })()`);
    if (/共\s*[\d,]+\+\s*条/.test(text) && text.includes("查看总数")) {
      await clickText(client, "查看总数");
      await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, POLL_INTERVAL_MS)));
      continue;
    }
    const counts = [...text.matchAll(/共\s*([\d,]+)\s*条/g)].map((match) => Number(match[1].replace(/,/g, ""))).filter(Number.isSafeInteger);
    const count = counts.length ? Math.max(...counts) : 0;
    if (count > 0 && count === previous) stable += 1;
    else stable = 1;
    previous = count || null;
    if (previous && stable >= STABLE_SAMPLES) return previous;
    await new Promise((resolve) => setTimeout(resolve, Math.max(500, POLL_INTERVAL_MS)));
  }
  throw new Error("页面总行数在规定时间内未稳定。");
}

async function installDownloadFileHook(client: CdpClient, urlHints: string[]) {
  await evaluateValue<boolean>(client, `(() => {
    ${jsDocumentsPrelude(urlHints)}
    let installed = false;
    for (const doc of documents) {
      const win = doc.defaultView;
      const jkUtils = win?.jkUtils;
      if (!jkUtils || typeof jkUtils.downloadFile !== 'function') continue;
      if (!win.__codexDownloadFileHookInstalled) {
        const original = jkUtils.downloadFile;
        win.__codexDownloadFileHookInstalled = true;
        win.__codexLastDownloadFileUrl = null;
        jkUtils.downloadFile = function(url) {
          win.__codexLastDownloadFileUrl = String(url || '');
          return original.apply(this, arguments);
        };
      }
      installed = true;
    }
    return installed;
  })()`);
}

async function triggerSalesMinimalExportAllPage(client: CdpClient, urlHints: string[]) {
  const requiredHeaders = [
    "发货仓库","销售渠道","网店订单号","货品编号","货品名称","数量",
    "货品成本","分摊后金额","费用分摊","毛利","毛利率","未税毛利",
    "未税毛利率(%)","发货时间","下单时间",
  ];
  await installDownloadFileHook(client, urlHints);
  return evaluateValue<boolean>(client, `(async () => {
    ${jsDocumentsPrelude(urlHints)}
    const requiredHeaders = ${JSON.stringify(requiredHeaders)};
    for (const doc of documents) {
      const win = doc.defaultView;
      const grid = win?.mini?.get?.('gridOrderDetail');
      const orderExport = win?.omsUtils?.orderExportV2;
      const fileExport = win?.jkUtils?.fileExport;
      if (!grid || !orderExport || !fileExport || typeof grid.exportAllPage !== 'function' || typeof grid.getColumns !== 'function' || typeof fileExport.startExcelExport !== 'function') continue;
      const columns = grid.getColumns();
      const selected = requiredHeaders.map((header) => columns.find((column) => column.header === header)).filter(Boolean);
      const missing = requiredHeaders.filter((header) => !selected.some((column) => column.header === header));
      if (missing.length) throw new Error('sales minimal export missing columns: ' + missing.join(','));
      let captured = null;
      const originalStartExcelExport = fileExport.startExcelExport;
      const originalPerformValidation = orderExport.performValidation;
      const originalValideIsWithSkuImg = orderExport.valideIsWithSkuImg;
      fileExport.startExcelExport = function(config) { captured = JSON.parse(JSON.stringify(config)); return config; };
      orderExport.performValidation = function(_v, _d, callback) { callback(); };
      orderExport.valideIsWithSkuImg = function(_s, _r, callback) { callback(false); };
      try {
        await Promise.resolve(grid.exportAllPage());
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        fileExport.startExcelExport = originalStartExcelExport;
        orderExport.performValidation = originalPerformValidation;
        orderExport.valideIsWithSkuImg = originalValideIsWithSkuImg;
      }
      if (!captured) throw new Error('sales export config was not captured');
      const enName = selected.map((column) => column.field);
      const showName = selected.map((column) => column.header);
      captured.headersJson = { enName, showName };
      captured.conditionJson.cols = enName;
      await Promise.resolve(originalStartExcelExport.call(fileExport, captured));
      return true;
    }
    return false;
  })()`);
}

async function findHookedDownloadUrl(client: CdpClient, urlHints: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluateValue<string | null>(client, `(() => {
      ${jsDocumentsPrelude(urlHints)}
      for (const doc of documents) {
        const win = doc.defaultView;
        if (win?.__codexLastDownloadFileUrl) return win.__codexLastDownloadFileUrl;
      }
      return null;
    })()`, Math.min(10_000, timeoutMs));
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function findOssUrl(port: number, captured: () => string | undefined, allowedHosts: readonly string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const direct = captured();
    if (direct) return direct;
    const targets = await listChromeTargets(port).catch(() => []);
    const targetUrl = targets.map((t) => t.url).find((value) => {
      try { return allowedHosts.includes(new URL(value).hostname); } catch { return false; }
    });
    if (targetUrl) return targetUrl;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("导出后未捕获到本轮 OSS 下载事件。");
}

async function findLocalDownloadedFile(downloadDirectory: string, exportIntentAt: string) {
  const threshold = Date.parse(exportIntentAt) - 5_000;
  const pattern = /^销售单明细账(?: \(\d+\))?\.xlsx$/i;
  const entries = await readdir(downloadDirectory, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ filePath: string; mtimeMs: number; size: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name) || entry.name.endsWith(".crdownload")) continue;
    const filePath = path.join(downloadDirectory, entry.name);
    const info = await stat(filePath).catch(() => null);
    if (info && info.mtimeMs >= threshold && info.size > 0) candidates.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

async function waitForFileStable(filePath: string) {
  for (let i = 0; i < 10; i++) {
    const info1 = await stat(filePath).catch(() => null);
    if (!info1) { await new Promise((r) => setTimeout(r, 1_000)); continue; }
    await new Promise((r) => setTimeout(r, 1_000));
    const info2 = await stat(filePath).catch(() => null);
    if (info2 && info1.size === info2.size && info1.mtimeMs === info2.mtimeMs) return info2;
  }
  return null;
}

async function fileSha256(filePath: string) {
  const { readFile } = await import("node:fs/promises");
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const asOfDate = shanghaiYesterday();
  const startDate = salesStartDate(asOfDate);
  const expectedDates = [`${startDate} 00:00:00`, `${asOfDate} 23:59:59`];

  console.log(JSON.stringify({
    type: "sales_export_start",
    asOfDate,
    dateRange: `${expectedDates[0]} 至 ${expectedDates[1]}`,
    downloadDirectory: DOWNLOAD_DIR,
    timestamp: new Date().toISOString(),
  }));

  // 1. Connect browser-level client for download interception
  const browserClient = await connectChromeBrowser(PORT);
  await browserClient.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
  let capturedOssUrl: string | undefined;
  browserClient.on("Browser.downloadWillBegin", (params) => {
    const url = typeof params.url === "string" ? params.url : undefined;
    if (url) capturedOssUrl = url;
    console.log(JSON.stringify({ type: "download_will_begin", urlHash: createHash("sha256").update(url || "").digest("hex").slice(0, 16) }));
  });

  // 2. Connect to 吉客云 page
  const { client } = await connectJackyunTarget(PORT);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  client.on("Network.requestWillBeSent", (params) => {
    const request = params.request as { url?: string } | undefined;
    if (!request?.url) return;
    try { if (ALLOWED_HOSTS.includes(new URL(request.url).hostname)) capturedOssUrl = request.url; } catch { /* ignore */ }
  });

  // 3. Navigate to 销售单明细账 if not already active
  const urlBefore = await currentUrl(client);
  if (!/web\.jackyun\.com/i.test(urlBefore)) {
    await client.send("Page.navigate", { url: START_URL });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await waitForPageText(client, SALES_PAGE_NAME, PAGE_TIMEOUT_MS);
  const contentUrlBefore = await activeContentUrl(client);
  if (!await isActiveText(client, SALES_PAGE_NAME)) {
    await clickText(client, SALES_PAGE_NAME);
  }
  await waitForActiveModule(client, SALES_PAGE_NAME, PAGE_TIMEOUT_MS, contentUrlBefore);
  console.log(JSON.stringify({ type: "navigated_to_sales", timestamp: new Date().toISOString() }));

  // 4. Set date range and verify
  const dates = await setDateInputs(client, expectedDates, SALES_URL_HINTS);
  if (dates.join("|") !== expectedDates.join("|")) {
    throw new Error(`销售日期区间读回不一致：期望 ${expectedDates.join(" 至 ")}，实际 ${dates.join(" 至 ")}`);
  }
  console.log(JSON.stringify({ type: "dates_verified", value: dates.join(" 至 "), timestamp: new Date().toISOString() }));

  // 5. Query (筛选/查询) — only once
  console.log(JSON.stringify({ type: "query_click", timestamp: new Date().toISOString() }));
  await clickAnyText(client, ["筛选", "查询"]);

  // 6. Wait for table to stabilize
  const rowCount = await stableRowCount(client, SALES_URL_HINTS);
  console.log(JSON.stringify({ type: "table_stable", expectedSourceRows: rowCount, timestamp: new Date().toISOString() }));

  // 7. Export all pages
  const exportIntentAt = new Date().toISOString();
  console.log(JSON.stringify({ type: "export_start", exportIntentAt }));
  const directExportStarted = await triggerSalesMinimalExportAllPage(client, SALES_URL_HINTS);
  console.log(JSON.stringify({ type: "minimal_export_result", started: directExportStarted }));

  // 8. Wait for download
  const downloadDeadline = Date.now() + 300_000; // 5 min max
  let filePath: string | undefined;
  let downloadProvenance: Record<string, unknown> | undefined;

  while (Date.now() < downloadDeadline) {
    // Check local download first
    const local = await findLocalDownloadedFile(DOWNLOAD_DIR, exportIntentAt);
    if (local) {
      const stable = await waitForFileStable(local.filePath);
      if (stable) {
        filePath = local.filePath;
        downloadProvenance = {
          method: "chrome_direct",
          completedAt: new Date(stable.mtimeMs).toISOString(),
          originalFileName: path.basename(local.filePath),
          bytes: stable.size,
        };
        break;
      }
    }

    // Check hooked URL
    const hookedUrl = await findHookedDownloadUrl(client, SALES_URL_HINTS, 5_000);
    const ossUrl = hookedUrl ?? capturedOssUrl;
    if (ossUrl) {
      try {
        const runId = `sales-export-${Date.now()}`;
        const downloaded = await downloadSignedOssExport({
          url: ossUrl,
          downloadDirectory: DOWNLOAD_DIR,
          runId,
          module: "sales" as never,
          exportIntentAt,
          allowedHosts: ALLOWED_HOSTS,
          timeoutMs: 120_000,
        });
        filePath = downloaded.filePath;
        downloadProvenance = downloaded.provenance as Record<string, unknown>;
        break;
      } catch (error) {
        console.log(JSON.stringify({ type: "oss_download_retry", error: error instanceof Error ? error.message : String(error) }));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  if (!filePath) {
    throw new Error("下载超时：销售单明细账文件未在 5 分钟内完成下载。");
  }

  // 9. Report
  const info = await stat(filePath);
  const sha256 = await fileSha256(filePath);

  const result = {
    type: "sales_export_done",
    filePath,
    fileName: path.basename(filePath),
    bytes: info.size,
    sha256,
    mtime: new Date(info.mtimeMs).toISOString(),
    dateRange: `${expectedDates[0]} 至 ${expectedDates[1]}`,
    expectedSourceRows: rowCount,
    downloadProvenance,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));

  browserClient.close();
  client.close();
}

main().catch((error) => {
  console.error(JSON.stringify({
    type: "sales_export_failed",
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  }));
  process.exit(1);
});
