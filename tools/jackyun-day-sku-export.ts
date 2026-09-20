import { launchDedicatedChrome, waitForChrome } from "../lib/jackyun/cdp-client";
import { connectPlaywrightBrowser, connectPlaywrightJackyunTarget } from "../lib/jackyun/playwright-client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(projectRoot, "outputs", "jackyun-day-sku-export");
const downloadDir = path.join(artifactDir, "downloads");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = path.resolve(path.join(projectRoot, ".runtime", "jackyun-chrome-profile"));
const port = 9223;
const targetUrl = "https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0";
const startDate = "2026-07-01";
const endDate = "2026-07-19";

type Result = { status: string; notes: string[]; savedPath?: string };

async function ensureDir(dir: string) { await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true })); }
async function bodyText(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]) { return page.evaluate(() => document.body?.innerText || ""); }
async function clickText(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"], texts: string[]) {
  for (const t of texts) {
    const loc = page.getByText(t, { exact: true });
    if (await loc.count().catch(() => 0)) { await loc.first().click(); return t; }
  }
  throw new Error(`未找到可点击文本：${texts.join(" / ")}`);
}
async function fillDateHints(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]){
  const inputs = page.locator("input");
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const key = `${(await input.getAttribute("name")) ?? ""} ${(await input.getAttribute("id")) ?? ""} ${(await input.getAttribute("placeholder")) ?? ""}`.toLowerCase();
    if (/start|begin|from|起始|开始/.test(key)) await input.fill(startDate);
    if (/end|to|结束/.test(key)) await input.fill(endDate);
  }
}
async function openPage(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]) { await page.goto(targetUrl, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => undefined); }

async function run(page: Awaited<ReturnType<typeof connectPlaywrightJackyunTarget>>["page"]): Promise<Result> {
  const notes: string[] = [];
  await page.screenshot({ path: path.join(artifactDir, "01-page.png"), fullPage: true }).catch(() => undefined);
  await clickText(page, ["下载数据", "导出查询商品", "导出商品", "导出"]);
  notes.push("已点击入口按钮");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(artifactDir, "02-dialog.png"), fullPage: true }).catch(() => undefined);

  await fillDateHints(page);
  notes.push(`已尝试填写日期 ${startDate} ~ ${endDate}`);
  await page.waitForTimeout(500);

  await clickText(page, ["分天下载", "分天导出"]);
  notes.push("已选择分天下载");
  await page.waitForTimeout(300);
  await clickText(page, ["确定导出", "确定", "开始导出"]);
  notes.push("已点击确定导出");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(artifactDir, "03-confirmed.png"), fullPage: true }).catch(() => undefined);

  const deadline = Date.now() + 60_000;
  let savedPath: string | undefined;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (/下载中心|下载记录/.test(text) && /已完成/.test(text) && /下载/.test(text)) {
      const dl = page.getByText("下载", { exact: true });
      if (await dl.count().catch(() => 0)) {
        const p = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
        await dl.first().click();
        const down = await p;
        if (down) {
          await ensureDir(downloadDir);
          savedPath = path.join(downloadDir, `day-sku-${Date.now()}-${down.suggestedFilename()}`);
          await down.saveAs(savedPath);
          break;
        }
      }
    }
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "networkidle" }).catch(() => undefined);
  }
  return { status: savedPath ? "completed" : "partial", notes, savedPath };
}

async function main() {
  await ensureDir(artifactDir); await ensureDir(downloadDir);
  await launchDedicatedChrome({ executablePath: chromePath, profileDirectory, port, startUrl: targetUrl, headless: false });
  await waitForChrome(port);
  const browser = await connectPlaywrightBrowser(port);
  try {
    const { page, client } = await connectPlaywrightJackyunTarget(browser, { startUrl: targetUrl });
    await openPage(page);
    const text = await bodyText(page);
    if (/登录|账号|密码|验证码/.test(text)) throw new Error("当前仍在登录页，请先手动登录后重试。");
    const result = await run(page);
    client.close();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
