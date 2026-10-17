import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { assertLogisticsFullScope, confirmLogisticsSourceReadiness } from "../tools/jd-logistics-export";
import type { JdLogisticsExportOptions } from "../lib/jd/logistics-policy";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const scope = { sourceKind: "inventory_snapshot", businessUnitCode: "EBU4418046540089", rangeStart: "2026-10-16", rangeEnd: "2026-10-17" } as JdLogisticsExportOptions;
const controls = [{ label: "仓库状态", values: ["全部"], checked: false }, { label: "SKU", values: [""], checked: false }];
const form = '<div class="el-form-item"><label class="el-form-item__label">仓库状态</label><input value="全部"></div><div class="el-form-item"><label class="el-form-item__label">SKU</label><input value=""></div>';

test("snapshot exports ignore the rendered list count while retaining complete scope and other-source readiness", { skip: !existsSync(chrome), timeout: 15000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  let waits = 0;
  const clock = { waitForTimeout: async () => { waits++; } } as unknown as Page;
  const hash = assertLogisticsFullScope(controls, scope);

  await t.test("a late default 600 count does not block the all-warehouse 900 export", async () => {
    await page.setContent(form + '<div id="count">共900条</div>');
    // Reproduce the stale response changing only the list, after scope setup.
    await page.locator("#count").evaluate(element => { element.textContent = "共600条"; });
    await confirmLogisticsSourceReadiness(clock, page, scope, 900, hash);
    assert.equal(await page.locator("#count").innerText(), "共600条");
    assert.equal(waits, 0);
  });
  await t.test("missing pagination is not a snapshot export prerequisite", async () => {
    await page.setContent(form);
    await confirmLogisticsSourceReadiness(clock, page, scope, 900, hash);
    assert.equal(waits, 0);
  });
  await t.test("retained SKU and warehouse subset still refuse export", async () => {
    for (const selector of [".el-form-item:nth-child(1) input", ".el-form-item:nth-child(2) input"]) {
      await page.setContent(form + "共600条");
      await page.locator(selector).fill("subset");
      await assert.rejects(confirmLogisticsSourceReadiness(clock, page, scope, 900, hash), /PARTIAL_SCOPE_FILTER/);
    }
  });
  await t.test("even an otherwise valid changed scope fingerprint refuses export", async () => {
    await page.setContent(form + '<div class="el-form-item"><label class="el-form-item__label">商品品类</label><input value=""></div>');
    await assert.rejects(confirmLogisticsSourceReadiness(clock, page, scope, 900, hash), /SOURCE_SCOPE_CHANGED/);
  });
  await t.test("other sources still require two matching counts and reject stale counts", async () => {
    for (const sourceKind of ["realtime_inventory", "flow", "shop_products"] as const) {
      const options = { ...scope, sourceKind };
      const activeControls = sourceKind === "shop_products" ? [...controls, { label: "商品状态", values: ["启用"], checked: false }] : controls;
      const activeForm = form + (sourceKind === "shop_products" ? '<div class="el-form-item"><label class="el-form-item__label">商品状态</label><input value="启用"></div>' : "");
      const activeHash = assertLogisticsFullScope(activeControls, options);
      await page.setContent(activeForm + "共600条"); waits = 0;
      await assert.rejects(confirmLogisticsSourceReadiness(clock, page, options, 900, activeHash), /SOURCE_COUNT_UNSTABLE/);
      assert.equal(waits, 30);
      await page.setContent(activeForm + "共900条"); waits = 0;
      await confirmLogisticsSourceReadiness(clock, page, options, 900, activeHash);
      assert.equal(waits, 1);
    }
  });
});
