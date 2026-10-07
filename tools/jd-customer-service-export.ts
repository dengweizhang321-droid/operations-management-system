import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";
import { jdCustomerServiceWorkflow as contract, assertCustomerServicePeriod, JdCustomerServiceWorkflowError, type CustomerServicePeriod } from "../lib/jd/customer-service-workflow";
import { inspectJdLoginPageState } from "./jd-saved-login";

export type CustomerServiceExportCheckpoint = {
  view: "list" | "messages";
  phase: "querying" | "confirming" | "submitting" | "submitted" | "downloaded";
  sourceCount?: number;
  observedAt?: string;
  savedPath?: string; sha256?: string; sizeBytes?: number;
};
function reject(code: string): never { throw new JdCustomerServiceWorkflowError(code); }
export async function openCustomerServicePage(page: Page, authenticate: () => Promise<unknown>) {
  await page.goto("https://shop.jd.com/", { waitUntil: "domcontentloaded" });
  await authenticate();
  await page.goto(contract.entryUrl, { waitUntil: "domcontentloaded" });
  return assertCustomerServiceShop(page, true);
}
export async function assertCustomerServiceShop(page: Page, allowInitialReload = false) {
  if (page.url() !== contract.entryUrl) reject("CHAT_PAGE_MISMATCH");
  const header = page.locator(".shop-menu-accountV1__right-account-top-name").filter({ visible: true });
  let reloaded = false;
  try { await header.waitFor({ state: "visible", timeout: 15_000 }); }
  catch {
    // A missing account widget was observed on an otherwise loaded ChatLog.
    // Only the initial, pre-export navigation may reload once. A wrong visible
    // account, login challenge or any later export stage must fail closed.
    if (!allowInitialReload || await header.count() !== 0 || page.url() !== contract.entryUrl)
      reject("PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION");
    const state = await inspectJdLoginPageState(page);
    if (state.challengePresent || state.credentialRejected || state.temporarilyLocked)
      reject("LOGIN_GATE_MANUAL_ACTION");
    for (const name of ["列表视图", "消息视图"]) {
      if (await page.getByRole("tab", { name, exact: true }).count() !== 1)
        reject("CHAT_PAGE_NOT_READY_MANUAL_ACTION");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    reloaded = true;
    try { await header.waitFor({ state: "visible", timeout: 30_000 }); }
    catch { reject("PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION"); }
  }
  if (page.url() !== contract.entryUrl || await header.count() !== 1
    || await header.getAttribute("title") !== contract.shopName
    || (await header.innerText()).trim() !== contract.shopName)
    reject("PAGE_STORE_IDENTITY_MISMATCH_MANUAL_ACTION");
  return { reloaded };
}
export function customerServiceExportCount(text: string) {
  const match = /^导出数据共计([1-9]\d*)条，是否确认导出？$/.exec(text.trim());
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) > 100_000) reject("EXPORT_COUNT_INVALID");
  return Number(match[1]);
}
export function customerServiceDownloadKind(href: string, view: "list" | "messages") {
  let url: URL;
  try { url = new URL(href, contract.entryUrl); } catch { return reject("DOWNLOAD_LINK_INVALID"); }
  const extension = view === "list" ? ".xlsx" : ".log";
  const prefix = view === "list" ? "/im-data-web.common/" : "/im-data-web.chatlog/";
  if (url.protocol !== "https:" || url.hostname !== "storage.jd.com" || url.port
    || url.username || url.password || !url.pathname.startsWith(prefix)
    || !url.pathname.toLowerCase().endsWith(extension)) reject("DOWNLOAD_LINK_INVALID");
  return extension;
}

// This adapter only operates on a Page already owned by the original JD
// lifecycle and global Chromium lock. The caller must persist checkpoints and
// must NOT invoke it again after a submitting/submitted checkpoint on failure.
export async function exportCustomerServiceView(input: {
  page: Page; period: CustomerServicePeriod; view: "list" | "messages";
  downloadDirectory: string;
  assertStore: () => Promise<void>;
  checkpoint: (value: CustomerServiceExportCheckpoint) => Promise<void>;
}) {
  const { page, period, view, assertStore, checkpoint } = input;
  assertCustomerServicePeriod(period);
  await assertStore();
  if (page.url() !== contract.entryUrl) reject("CHAT_PAGE_MISMATCH");
  await page.getByRole("tab", { name: view === "list" ? "列表视图" : "消息视图", exact: true }).click();
  await checkpoint({ view, phase: "querying" });
  await page.getByRole("button", { name: "重置", exact: true }).click();
  const start = page.getByPlaceholder("开始日期", { exact: true });
  const end = page.getByPlaceholder("结束日期", { exact: true });
  await start.click();
  await start.fill(`${period.startDate} 00:00:00`);
  await start.press("Enter");
  await end.fill(`${period.endDate} 23:59:59`);
  await end.press("Enter");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  if (await page.getByRole("tab", { name: view === "list" ? "列表视图" : "消息视图", exact: true, selected: true }).count() !== 1)
    reject("EXPORT_VIEW_MISMATCH");
  if (await start.inputValue() !== `${period.startDate} 00:00:00`
    || await end.inputValue() !== `${period.endDate} 23:59:59`) reject("DATE_READBACK_MISMATCH");
  for (const id of ["customerPin", "keyWord", "orderId", "productId"]) {
    if (await page.locator(`#${id}`).inputValue() !== "") reject("FILTER_NOT_EMPTY");
  }
  if (await page.getByRole("checkbox", { checked: true }).count()) reject("FILTER_NOT_EMPTY");
  await assertStore();
  await mkdir(input.downloadDirectory, { recursive: true });
  const downloadLink = page.locator("button.export-excel").getByRole("link", { name: "下载", exact: true });
  // The UI retains an older completed export after changing dates. Clicking
  // its link resets the button to Export. Keep that file as unbound evidence,
  // never use it as this run's paired input.
  if (await downloadLink.count()) {
    if (await downloadLink.count() !== 1) reject("DOWNLOAD_LINK_AMBIGUOUS");
    customerServiceDownloadKind(await downloadLink.getAttribute("href") ?? "", view);
    const pending = page.waitForEvent("download", { timeout: 60_000 });
    await downloadLink.click();
    const old = await pending;
    await old.saveAs(path.join(input.downloadDirectory, `unbound-${view}${view === "list" ? ".xlsx" : ".log"}`));
  }
  const exportButton = page.getByRole("button", { name: "download 导出", exact: true });
  await exportButton.waitFor({ state: "visible", timeout: 30_000 });
  await checkpoint({ view, phase: "confirming" });
  await exportButton.click();
  const prompt = page.getByText(/^导出数据共计\d+条，是否确认导出？$/);
  await prompt.waitFor({ state: "visible", timeout: 30_000 });
  if (await prompt.count() !== 1) reject("EXPORT_CONFIRMATION_AMBIGUOUS");
  const sourceCount = customerServiceExportCount(await prompt.innerText());
  await assertStore();
  // Persist before the only operation which creates an export job.
  await checkpoint({ view, phase: "submitting", sourceCount });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await checkpoint({ view, phase: "submitted", sourceCount });
  await downloadLink.waitFor({ state: "visible", timeout: 10 * 60_000 });
  await assertStore();
  if (await downloadLink.count() !== 1) reject("DOWNLOAD_LINK_AMBIGUOUS");
  const extension = customerServiceDownloadKind(await downloadLink.getAttribute("href") ?? "", view);
  const pending = page.waitForEvent("download", { timeout: 60_000 });
  await downloadLink.click();
  const download = await pending;
  const savedPath = path.join(input.downloadDirectory, `${view}${extension}`);
  await download.saveAs(savedPath);
  const sizeBytes = (await stat(savedPath)).size;
  if (!sizeBytes || sizeBytes > 25 * 1024 * 1024) reject("INVALID_FILE_SIZE");
  const sha256 = createHash("sha256").update(await readFile(savedPath)).digest("hex");
  const result: CustomerServiceExportCheckpoint = { view, phase: "downloaded", sourceCount, savedPath, sha256, sizeBytes };
  await checkpoint(result);
  return result;
}
