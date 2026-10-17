import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const file = process.env.TMALL_WAREHOUSE_HTML ?? "D:/codex-artifacts/tmall-warehouse-monitor-20261017/天猫入仓监控.html";
test("Windows file HTML renders real component, filters, metrics, details and keeps writes disabled", async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [], network = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  try {
    await page.goto(pathToFileURL(file).href);
    await page.getByRole("button", { name: /合成示例 · 多功能切片机/ }).waitFor();
    assert.equal(await page.locator(".tmall-product-title").count(), 3);
    await page.getByRole("button", { name: /合成示例 · 多功能切片机/ }).click();
    assert.equal(await page.locator(".tmall-warehouse-detail tbody tr").count(), 3);
    assert.ok((await page.locator(".tmall-warehouse-detail").textContent()).includes("暂无依据"));
    await page.getByLabel("分仓显示").selectOption("sales30dQuantity");
    assert.equal(await page.locator(".tmall-warehouse-matrix>tbody>tr").first().locator("td").nth(2).textContent(), "—");
    await page.getByLabel("仓库", { exact: true }).selectOption("合成华南仓");
    await page.waitForFunction(() => document.querySelectorAll(".tmall-warehouse-matrix>thead>tr>th").length === 7);
    await page.getByLabel("货品搜索").fill("SKU-002"); await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".tmall-product-title").length === 1);
    assert.ok((await page.locator(".tmall-product-title").textContent()).includes("商用绞肉机"));
    await page.getByLabel("货品搜索").fill(""); await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".tmall-product-title").length === 3);
    await page.getByLabel("仓库", { exact: true }).selectOption("");
    await page.waitForFunction(() => document.querySelectorAll(".tmall-warehouse-matrix>thead>tr>th").length === 9);
    await page.getByLabel("分仓显示").selectOption("availableQuantity");
    await page.screenshot({ path: "D:/codex-artifacts/tmall-warehouse-monitor-20261017/page-qa.png", fullPage: true });
    await page.getByRole("tab", { name: "文件导入", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "校验并导入" }).isDisabled(), true);
    assert.equal(await page.locator('input[type="file"]').isDisabled(), true);
    await page.getByRole("tab", { name: "运行记录", exact: true }).click();
    await page.getByText("暂无天猫入仓导入批次", { exact: true }).waitFor();
    await page.getByRole("link", { name: "导入工作流", exact: true }).click();
    await page.getByRole("heading", { name: "天猫入仓 n8n 导入工作流" }).waitFor();
    await page.getByRole("button", { name: "返回监控" }).click();
    await page.getByRole("button", { name: /合成示例 · 多功能切片机/ }).waitFor();
    // Simulate a backend that ignores AbortSignal: old response must not win.
    await page.evaluate(() => { const original = window.fetch; window.fetch = async (input, init) => { const u = new URL(String(input), "https://offline.invalid"); if (u.searchParams.get("q") === "SKU-001") { const response = await original(input, init); await new Promise(resolve => setTimeout(resolve, 180)); return response; } return original(input, init); }; });
    await page.getByLabel("货品搜索").fill("SKU-001"); await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByLabel("货品搜索").fill("SKU-003"); await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".tmall-product-title").length === 1 && document.querySelector(".tmall-product-title")?.textContent?.includes("不锈钢切肉机"));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 220)));
    assert.ok((await page.locator(".tmall-product-title").textContent()).includes("不锈钢切肉机"));
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
  } finally { await browser.close(); }
});
