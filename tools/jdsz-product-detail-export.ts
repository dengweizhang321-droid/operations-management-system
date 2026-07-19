import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(projectRoot, "outputs", "jdsz-product-detail-export");
const downloadDir = path.join(artifactDir, "downloads");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = path.resolve(path.join(projectRoot, ".runtime", "jdsz-chrome-profile"));
const port = 9224;
const targetUrl = "https://jdsz.jd.com/szweb/view/product/productDetail.html";
const startDate = "2026-07-01";
const endDate = "2026-07-19";

type Result = { status: string; sku: RunResult; spu: RunResult };
type RunResult = { savedPath?: string; notes: string[]; ok: boolean };

async function ensureDir(dir: string) { await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true })); }
async function text(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]) { return page.evaluate(() => document.body?.innerText || ""); }

async function clickText(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"], texts: string[]) {
  for (const t of texts) {
    const loc = page.getByText(t, { exact: true });
    if (await loc.count().catch(() => 0)) { await loc.first().click(); return t; }
  }
  throw new Error(`未找到可点击文本：${texts.join(" / ")}`);
}

async function fillDateRange(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]) {
  const inputs = page.locator("input");
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const key = `${(await input.getAttribute("placeholder")) ?? ""} ${(await input.getAttribute("name")) ?? ""} ${(await input.getAttribute("id")) ?? ""}`.toLowerCase();
    if (/开始|start|from|起始/.test(key)) await input.fill(startDate);
    if (/结束|end|to/.test(key)) await input.fill(endDate);
  }
}

async function open(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]) {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function runOne(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"], dimension: "SKU" | "SPU"): Promise<RunResult> {
  const notes: string[] = [];
  await page.screenshot({ path: path.join(artifactDir, `${dimension}-01-page.png`), fullPage: true }).catch(() => undefined);
  await clickText(page, ["商品"]);
  notes.push("已点击左侧商品");
  await page.waitForTimeout(1200);
  await clickText(page, ["商品明细"]);
  notes.push("已进入商品明细");
  if (dimension === "SPU") {
    await clickText(page, ["SPU"]);
    notes.push("已切换到SPU");
  } else {
    notes.push("SKU为默认维度，跳过点击");
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);
  await fillDateRange(page);
  notes.push(`已尝试填写日期 ${startDate} ~ ${endDate}`);
  await page.locator("body").evaluate((el) => { el.scrollTo?.(0, 0); });
  await page.waitForTimeout(500);
  await clickText(page, ["下载数据"]);
  notes.push("已点击下载数据");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(artifactDir, `${dimension}-02-dialog.png`), fullPage: true }).catch(() => undefined);

  const dialogBody = await text(page);
  const dialogOk = /分天下载|不包含对比时间|包含对比时间|下载数据/.test(dialogBody);
  if (!dialogOk) notes.push("弹窗文案未完全匹配，但继续按流程执行");

  await clickText(page, ["分天下载"]);
  notes.push("已选择分天下载");
  await clickText(page, ["不包含对比时间"]);
  notes.push("已选择不包含对比时间");
  await clickText(page, ["确定", "确定导出"]);
  notes.push("已点击确定");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(artifactDir, `${dimension}-03-confirmed.png`), fullPage: true }).catch(() => undefined);

  let savedPath: string | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const body = await text(page);
    if (/前往查看|下载中心/.test(body)) {
      const go = page.getByText("前往查看", { exact: true });
      if (await go.count().catch(() => 0)) {
        await go.first().click();
        notes.push("已点击前往查看");
        break;
      }
    }
    await page.waitForTimeout(1000);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const body = await text(page);
    if (/下载中心|已完成|下载/.test(body)) {
      const dl = page.getByText("下载", { exact: true });
      if (await dl.count().catch(() => 0)) {
        try {
          const p = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
          await dl.first().click();
          const d = await p;
          if (d) {
            await ensureDir(downloadDir);
            savedPath = path.join(downloadDir, `${dimension.toLowerCase()}-${Date.now()}-${d.suggestedFilename()}`);
            await d.saveAs(savedPath);
            notes.push(`已保存下载文件：${savedPath}`);
            break;
          }
        } catch (error) {
          notes.push(`下载捕获失败：${String(error)}`);
        }
      }
    }
    await page.reload({ waitUntil: "networkidle" }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  return { ok: Boolean(savedPath), savedPath, notes };
}

async function main() {
  await ensureDir(artifactDir);
  await ensureDir(downloadDir);
  await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl: targetUrl, headless: false });
  await waitForChrome(port);
  const browser = await connectPlaywrightBrowser(port);
  try {
    const { page, client } = await connectPlaywrightJackyunTarget(browser, { startUrl: targetUrl });
    await open(page);
    const body = await text(page);
    if (/登录|账号|密码|验证码/.test(body)) throw new Error("当前仍在登录页，请先手动登录后重新运行脚本。");
    const sku = await runOne(page, "SKU");
    const spu = await runOne(page, "SPU");
    client.close();
    console.log(JSON.stringify({ status: "completed", sku, spu }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
