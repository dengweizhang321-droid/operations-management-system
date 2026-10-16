// Read-only onboarding probe: navigation may issue the site's normal query,
// but no query/export/login controls are clicked and no credentials are read.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser } from "playwright-core";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";
import { withJdChromiumRunLock, defaultJdChromiumRunLockDirectory } from "../lib/jd/chromium-run-lock";
import { jdBrowserLaunchMode } from "../lib/jd/browser-mode";
import { launchDedicatedChrome, closeChromeBrowser, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser } from "../lib/jackyun/playwright-client";
import { logisticsDebugPortClosed, visibleRangeDates } from "./jd-logistics-export";

const root = "D:/运营管理系统";
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("An absolute private evidence output is required");
if (process.argv.length > 4 || process.argv[3] !== undefined && process.argv[3] !== "--dates") throw new Error("Unsupported probe arguments");
const verifyDates = process.argv[3] === "--dates";
const stores = validateJdStoreRegistry(JSON.parse(await readFile(path.join(root, "config/jd-store-accounts.json"), "utf8")), root);
const store = stores.find(s => s.storeKey === "jd-yiyong-director" && s.enabled);
if (!store || store.shopId !== "701455" || store.browser.profileName !== "Default") throw new Error("Equipment profile identity differs");
const report = { at: new Date().toISOString(), storeKey: store.storeKey, expectedBusinessUnitCode: "EBU4418046540089",
  visibleBusinessUnitCodes: [] as string[], queryBusinessUnitCodes: [] as string[], accountLabelVisible: false,
  businessFrameReady: false, challengeOrLogin: false, samples: 0, browserClosed: false, portClosed: false,
  exportClicks: 0, businessImports: 0, dateReadback: null as null | { start: string; end: string } };
await withJdChromiumRunLock(`jd-logistics-identity-probe:${randomUUID()}`, async () => {
  let browser: Browser | null = null; let owned = false;
  try {
    const child = await launchDedicatedChrome({ executablePath: store.browser.executablePath,
      profileDirectory: store.browser.userDataDir, profileName: store.browser.profileName, port: store.browser.debugPort,
      startUrl: "about:blank", ...jdBrowserLaunchMode(false) });
    owned = !!child; if (!owned) throw new Error("Probe refuses to adopt an existing browser");
    await waitForChrome(store.browser.debugPort); browser = await connectPlaywrightBrowser(store.browser.debugPort);
    const context = browser.contexts()[0]; if (!context) throw new Error("Equipment browser context missing");
    const page = await context.newPage(); const queried = new Set<string>();
    page.on("request", request => {
      if (request.url() !== "https://api.jdl.com/bsc/batchStock/queryStockFlowList" || request.method() !== "POST") return;
      try {
        const body = request.postDataJSON();
        const ids = Array.isArray(body) && body.length === 1 ? body[0]?.deptRequest?.deptIdList : undefined;
        if (Array.isArray(ids)) for (const id of ids) if (/^[1-9]\d{0,19}$/.test(String(id))) queried.add(`EBU${id}`);
      } catch { /* Missing source evidence remains unknown. */ }
    });
    await page.goto("https://wl.jdl.com/bsc-inventory/flow", { waitUntil: "domcontentloaded", timeout: 60000 });
    let previous = "", stable = 0;
    for (let i = 0; i < 50; i++) {
      const outer = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
      report.accountLabelVisible = outer.includes(store.accountLabel);
      const frames = page.frames().filter(f => /scsw\.jdl\.com\/stockBusiness\/warehouseInventoryRunningQuery(?:New)?/.test(f.url()));
      report.challengeOrLogin = /验证码|短信验证|滑块|安全验证|密码登录|扫码登录/.test(outer);
      if (report.challengeOrLogin) break;
      if (frames.length === 1) {
        const frame = frames[0];
        const text = await frame.locator("body").innerText({ timeout: 1000 }).catch(() => "");
        const values = await frame.locator("input:visible:not([type=password])").evaluateAll(es => es.map(e => (e as HTMLInputElement).value)).catch(() => []);
        report.visibleBusinessUnitCodes = [...new Set((text + "\n" + values.join("\n")).match(/\bEBU[A-Za-z0-9]+\b/g) ?? [])];
        report.businessFrameReady = text.includes("仓库库存流水");
      }
      report.queryBusinessUnitCodes = [...queried].sort(); report.samples++;
      const current = JSON.stringify([report.visibleBusinessUnitCodes, report.queryBusinessUnitCodes]);
      stable = current === previous ? stable + 1 : 0; previous = current;
      if (stable >= 3 && (report.visibleBusinessUnitCodes.length || report.queryBusinessUnitCodes.length)) break;
      await page.waitForTimeout(400);
    }
    if (verifyDates) {
      if (report.challengeOrLogin || report.visibleBusinessUnitCodes.length !== 1 || report.visibleBusinessUnitCodes[0] !== report.expectedBusinessUnitCode) throw new Error("Probe identity unavailable");
      const frames = page.frames().filter(f => /scsw\.jdl\.com\/stockBusiness\/warehouseInventoryRunningQuery(?:New)?/.test(f.url()));
      if (frames.length !== 1) throw new Error("Probe frame ambiguous");
      await visibleRangeDates(frames[0], "2026-10-15", "2026-10-15", "起始时间");
      const start = await frames[0].getByPlaceholder("起始时间", { exact: true }).inputValue();
      const end = await frames[0].getByPlaceholder("结束时间", { exact: true }).inputValue();
      if (start !== "2026-10-15" || end !== start) throw new Error("Probe date readback failed");
      report.dateReadback = { start, end };
    }
  } finally {
    await browser?.close().catch(() => undefined);
    if (owned) { await closeChromeBrowser(store.browser.debugPort); report.portClosed = await logisticsDebugPortClosed(store.browser.debugPort); report.browserClosed = report.portClosed; }
  }
}, defaultJdChromiumRunLockDirectory(root));
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report));
