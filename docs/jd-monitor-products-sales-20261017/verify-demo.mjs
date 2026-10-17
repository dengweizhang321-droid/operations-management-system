import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const directory = "D:/codex-artifacts/jd-monitor-products-sales-20261017";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(`file:///${directory}/京东入仓监控-商品监控与3天15天销量.html`);
  await page.getByRole("button", { name: "取消监控合成商品A", exact: true }).waitFor();
  assert.equal(await page.locator('[data-goods-code="D"]').count(), 0);
  assert.equal(await page.locator(".jd-monitor-inactive").getAttribute("open"), null);
  await page.getByRole("button", { name: "取消监控合成商品A", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".jd-monitor-inactive summary")?.textContent?.includes("（2）"));
  assert.equal(await page.locator('[data-goods-code="A"]').count(), 0);
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".jd-monitor-inactive summary")?.textContent?.includes("（2）"));
  await page.locator(".jd-monitor-inactive > summary").click();
  await page.getByRole("button", { name: "添加监控合成商品A", exact: true }).waitFor();
  await page.locator('.jd-monitor-inactive [data-goods-code="A"] .jd-cwarehouse-expand').click();
  const details = page.locator(".jd-monitor-inactive .jd-cwarehouse-detail-table");
  await details.waitFor();
  assert.ok((await details.locator("thead").textContent()).includes("3日销量"));
  assert.ok((await details.locator("thead").textContent()).includes("15日销量"));
  assert.equal(await details.locator("tbody tr").first().locator("td").nth(7).textContent(), "3");
  assert.equal(await details.locator("tbody tr").first().locator("td").nth(9).textContent(), "15");
  const active = page.locator('.jd-cwarehouse-product-table').first();
  const total = await active.locator("thead .jd-cwarehouse-total-cell").boundingBox();
  const action = await active.locator("thead .jd-cwarehouse-monitor-action").boundingBox();
  assert.ok(total.x + total.width <= action.x + 1, "total and monitoring action must not overlap");
  await page.screenshot({ path: `${directory}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "添加监控合成商品A", exact: true }).click();
  await page.getByRole("button", { name: "取消监控合成商品A", exact: true }).waitFor();
  assert.equal(await page.locator(".jd-monitor-inactive").getAttribute("open"), null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "展开合成商品A的分仓明细", exact: true }).click();
  await page.locator(".jd-cwarehouse-detail-table").waitFor();
  await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  const result = { windowsFileUrl: true, cancelCollapsed: true, restore: true, localRefreshPersistence: true,
    threeDaySales: true, fifteenDaySales: true, stickyColumnsDoNotOverlap: true, mobileExpansion: true,
    externalRequests: requests.length, pageErrors: errors };
  writeFileSync(`${directory}/verification.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
