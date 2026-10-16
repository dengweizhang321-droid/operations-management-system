import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const directory = "D:/codex-artifacts/jd-monitor-hide-no-warehouse-20261017";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(`file:///${directory}/京东入仓监控-隐藏空仓商品与范围合计.html`);
  const first = page.locator('[data-goods-code="A"]');
  await first.waitFor();
  assert.equal(await page.locator('[data-goods-code="D"]').count(), 0);
  const total = first.locator(".jd-cwarehouse-total-cell");
  assert.equal(await total.locator("strong").textContent(), "8");
  assert.ok((await total.textContent()).includes("部分数据"));
  await page.getByRole("button", { name: "展开合成商品A的分仓明细", exact: true }).click();
  await page.locator(".jd-cwarehouse-detail-total").waitFor();
  assert.ok((await page.locator(".jd-cwarehouse-detail-total").textContent()).includes("部分数据"));
  await page.getByRole("button", { name: "仓库设置", exact: true }).click();
  await page.getByRole("switch", { name: "来源仓W2显示开关" }).uncheck();
  await page.getByRole("button", { name: "保存仓库设置", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-goods-code="A"] .jd-cwarehouse-total-cell strong')?.textContent === "5");
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-goods-code="A"] .jd-cwarehouse-total-cell strong')?.textContent === "5");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "展开合成商品A的分仓明细", exact: true }).click();
  await page.locator(".jd-cwarehouse-detail-table").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  const result = { windowsFileUrl: true, noValueProductHidden: true, knownTotalEight: true,
    partialDataLabel: true, expandedTotals: true, warehouseSwitchTotalFive: true,
    localRefreshPersistence: true, mobileExpansion: true, externalRequests: requests.length, pageErrors: errors };
  writeFileSync(`${directory}/verification.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
