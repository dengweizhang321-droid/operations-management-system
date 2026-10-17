import { chromium, type Page } from "playwright-core";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { withJdChromiumRunLock } from "../lib/jd/chromium-run-lock";
import { assertWarehouseBrowserDirectory, tmallWarehouseSource, tmallWarehouseMaxBytes, warehouseDay, warehouseHash, type WarehouseConfig } from "../lib/tmall-warehouse/policy";

export type WarehouseDownload = { filePath: string; fileName: string; rawFileHash: string; bytes: number; collectedAt: string; snapshotDate: string; expectedRowCount: number; owner: string };
// The portal keeps inactive home/report tabs in the top-level DOM. Scope to
// the observed active SPA report, otherwise home date fields look like filters.
export const warehouseReportSelector = ".tab-content-list-item.active .fulfillment_realtime_inventory_good_s_ptdjd";
export async function tmallWarehouseProfileStatus(root: string): Promise<"ready" | "missing" | "invalid"> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, ".runtime", "tmall-warehouse.json"), "utf8"));
    if (raw.enabled !== true) return "missing";
    const { warehouseConfig } = await import("../lib/tmall-warehouse/policy");
    const config = warehouseConfig(raw, root);
    await assertWarehouseBrowserDirectory(config, root);
    const [exe, profile] = await Promise.all([lstat(config.executablePath), lstat(path.join(config.userDataDir, config.profileName))]);
    return exe.isFile() && !exe.isSymbolicLink() && profile.isDirectory() && !profile.isSymbolicLink() ? "ready" : "invalid";
  } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid"; }
}
export async function inspectWarehousePage(page: Page, owner: string) {
  const url = new URL(page.url());
  if (url.origin !== "https://scp.tmall.com" || (url.pathname !== new URL(tmallWarehouseSource).pathname && url.searchParams.get("frameUrl") !== tmallWarehouseSource)) throw new Error("TMALL_WAREHOUSE_SOURCE_OR_LOGIN_REQUIRED_MANUAL_ACTION");
  const body = await page.locator("body").innerText();
  if (/验证码|安全验证|扫码登录|密码登录/.test(body)) throw new Error("TMALL_WAREHOUSE_LOGIN_REQUIRED_MANUAL_ACTION");
  // Observed on 2026-10-17 in the portal's account panel; never infer the
  // authenticated owner from the exported supplier-name column.
  const identity = page.locator('[data-spm-click="gostr=/ascp;locaid=header-right-account-name"]');
  if (await identity.count() !== 1 || (await identity.textContent())?.trim() !== owner) throw new Error("TMALL_WAREHOUSE_OWNER_MISMATCH_MANUAL_ACTION");
  const report = page.locator(warehouseReportSelector);
  if (await report.count() !== 1 || !await report.isVisible()) throw new Error("TMALL_WAREHOUSE_REPORT_NOT_READY");
  const reportText = await report.innerText();
  if (await report.getByRole("heading", { name: /库存总览.*实时/ }).count() !== 1 || !reportText.includes("实时库存行数据")) throw new Error("TMALL_WAREHOUSE_REPORT_NOT_READY");
  // A fresh dedicated page must represent the complete unfiltered collection.
  const fields = await report.locator('input:not([type="hidden"]), textarea').evaluateAll(nodes => nodes.filter(n => (n as HTMLElement).offsetParent !== null).map(n => ({ value: (n as HTMLInputElement).value, placeholder: n.getAttribute("placeholder") ?? "" })));
  if (fields.some(f => f.value.trim())) throw new Error("TMALL_WAREHOUSE_FILTER_NOT_EMPTY");
  const matches = [...reportText.matchAll(/共\s*(\d+)\s*项/g)];
  if (matches.length !== 1 || Number(matches[0][1]) < 1) throw new Error("TMALL_WAREHOUSE_TOTAL_AMBIGUOUS");
  const button = report.getByRole("button", { name: "导出", exact: true });
  if (await button.count() !== 1 || !await button.isEnabled()) throw new Error("TMALL_WAREHOUSE_EXPORT_AMBIGUOUS");
  return Number(matches[0][1]);
}
export async function exportTmallWarehouse(options: { root: string; runId: string; config: WarehouseConfig; beforeClick: (rowCount: number) => Promise<void>; assertOwner: () => Promise<void> }): Promise<WarehouseDownload> {
  const { config } = options;
  return withJdChromiumRunLock(`tmall-warehouse:${options.runId}`, async () => {
    await options.assertOwner();
    await assertWarehouseBrowserDirectory(config, options.root);
    const executable = await lstat(config.executablePath);
    if (!executable.isFile() || executable.isSymbolicLink()) throw new Error("TMALL_WAREHOUSE_BROWSER_IDENTITY_REJECTED");
    const directory = path.join(options.root, "outputs", "tmall-warehouse", "downloads", options.runId);
    await mkdir(directory, { recursive: true });
    await mkdir(config.userDataDir, { recursive: true });
    const context = await chromium.launchPersistentContext(config.userDataDir, { executablePath: config.executablePath, headless: false, acceptDownloads: true, downloadsPath: directory, args: [`--profile-directory=${config.profileName}`] });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(`https://scp.tmall.com/?frameUrl=${encodeURIComponent(tmallWarehouseSource)}#380972.682131.682503`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.locator(warehouseReportSelector).getByRole("button", { name: "导出", exact: true }).waitFor({ state: "visible", timeout: 45_000 }).catch(() => { throw new Error("TMALL_WAREHOUSE_LOGIN_OR_REPORT_REQUIRED_MANUAL_ACTION"); });
      const count = await inspectWarehousePage(page, config.owner);
      await options.assertOwner();
      // Durable intent precedes this one and only export click. A timeout or
      // failed response leaves intent unresolved and cannot authorize replay.
      await options.beforeClick(count);
      const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
      void downloadPromise.catch(() => undefined);
      await page.locator(warehouseReportSelector).getByRole("button", { name: "导出", exact: true }).click({ timeout: 10_000 });
      const download = await downloadPromise;
      if (await download.failure()) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_RESULT_UNKNOWN_MANUAL_ACTION");
      const fileName = download.suggestedFilename();
      if (!/^isc-hf-biz-workbench_[A-Za-z0-9_-]+\.xlsx$/i.test(fileName)) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_NAME_REJECTED");
      const filePath = path.join(directory, "source.xlsx");
      await download.saveAs(filePath);
      await options.assertOwner();
      await inspectWarehousePage(page, config.owner);
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > tmallWarehouseMaxBytes) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_SIZE_REJECTED");
      const bytes = await readFile(filePath);
      if (bytes.length !== info.size || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_CONTENT_REJECTED");
      const collectedAt = new Date().toISOString();
      return { filePath, fileName, rawFileHash: warehouseHash(bytes), bytes: bytes.length, expectedRowCount: count, collectedAt, snapshotDate: warehouseDay(new Date(collectedAt)), owner: config.owner };
    } finally {
      try { await context.close(); } catch { throw new Error("TMALL_WAREHOUSE_BROWSER_CLEANUP_FAILED"); }
    }
  }, path.join(options.root, ".runtime", "jd-chromium-global.lock"));
}
