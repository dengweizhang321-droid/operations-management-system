import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { visibleRangeDates } from "../tools/jd-logistics-export";

const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

function fixture(options: { delay?: number; panels?: number; never?: boolean; month?: string; duplicateDay?: boolean; navigationDelay?: number } = {}) {
  const panel = `<div class="el-date-range-picker" style="display:none">
    <div class="el-date-range-picker__content is-left">
      <div class="el-date-range-picker__header">${options.month ?? "2026 年 10 月"}</div>
      <button class="el-icon-arrow-left" onclick="shiftMonth(-1)">previous</button>
      <button class="el-icon-arrow-right" onclick="shiftMonth(1)">next</button>
      <table><tr><td class="prev-month available">15</td><td class="available" onclick="selectDay(15)">15</td>
      ${options.duplicateDay ? '<td class="available" onclick="selectDay(15)">15</td>' : ""}
      <td class="available" onclick="selectDay(16)">16</td><td class="next-month available">15</td></tr></table>
    </div></div>`;
  return `<html><body><input placeholder="起始时间" readonly onclick="openPicker()"><input placeholder="结束时间" readonly>
    <button onclick="window.queryClicks++">查询</button><button onclick="window.exportClicks++">导出</button>
    ${panel}<script>
    window.triggerClicks=0;window.dayClicks=0;window.queryClicks=0;window.exportClicks=0;window.navigationClicks=0;
    function openPicker(){window.triggerClicks++;${options.never ? "return;" : `setTimeout(()=>{
      const panel=document.querySelector('.el-date-range-picker');
      for(let i=1;i<${options.panels ?? 1};i++)document.body.append(panel.cloneNode(true));
      document.querySelectorAll('.el-date-range-picker').forEach(p=>p.style.display='block');
    },${options.delay ?? 0});`}}
    function shiftMonth(delta){window.navigationClicks++;setTimeout(()=>{
      const header=document.querySelector('.el-date-range-picker__header');
      const match=header.textContent.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月/);
      const next=new Date(Date.UTC(Number(match[1]),Number(match[2])-1+delta,1));
      header.textContent=next.getUTCFullYear()+' 年 '+(next.getUTCMonth()+1)+' 月';
    },${options.navigationDelay ?? 0})}
    function selectDay(day){const header=document.querySelector('.el-date-range-picker__header').textContent;
      const match=header.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月/);
      const value=match[1]+'-'+match[2].padStart(2,'0')+'-'+String(day).padStart(2,'0');
      document.querySelector(window.dayClicks===0?'input[placeholder="起始时间"]':'input[placeholder="结束时间"]').value=value;
      window.dayClicks++;if(window.dayClicks===2)document.querySelector('.el-date-range-picker').style.display='none';
    }
    </script></body></html>`;
}
async function effects(page: Page) {
  return page.evaluate(() => ({ trigger: (window as any).triggerClicks, days: (window as any).dayClicks,
    queries: (window as any).queryClicks, exports: (window as any).exportClicks, navigation: (window as any).navigationClicks }));
}

test("logistics date picker uses real DOM with bounded render waiting and unchanged strict controls", { skip: !existsSync(chromePath), timeout: 30000 }, async t => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-networking"] });
  t.after(() => browser.close());
  async function pageFor(html: string) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => route.abort()); // local DOM only, including all negative cases
    const page = await context.newPage(); await page.setContent(html); return page;
  }
  await t.test("waits for delayed visibility, clicks the trigger once, selects and reads back the exact same day", async () => {
    const page = await pageFor(fixture({ delay: 200 }));
    try {
      await visibleRangeDates(page, "2026-10-15", "2026-10-15", "起始时间");
      assert.equal(await page.getByPlaceholder("起始时间", { exact: true }).inputValue(), "2026-10-15");
      assert.equal(await page.getByPlaceholder("结束时间", { exact: true }).inputValue(), "2026-10-15");
      assert.deepEqual(await effects(page), { trigger: 1, days: 2, queries: 0, exports: 0, navigation: 0 });
    } finally { await page.context().close(); }
  });
  await t.test("the same wait works in the business iframe and preserves an interval", async () => {
    const page = await pageFor('<iframe id="business"></iframe>');
    try {
      const frame = page.frames().find(f => f !== page.mainFrame())!;
      await frame.setContent(fixture({ delay: 150 }));
      await visibleRangeDates(frame, "2026-10-15", "2026-10-16", "起始时间");
      assert.equal(await frame.getByPlaceholder("起始时间", { exact: true }).inputValue(), "2026-10-15");
      assert.equal(await frame.getByPlaceholder("结束时间", { exact: true }).inputValue(), "2026-10-16");
    } finally { await page.context().close(); }
  });
  await t.test("duplicate panels appearing after the click still refuse before selecting dates", async () => {
    const page = await pageFor(fixture({ delay: 150, panels: 2 }));
    try {
      await assert.rejects(visibleRangeDates(page, "2026-10-15", "2026-10-15", "起始时间"), /JD_LOGISTICS_DATE_CONTROL_AMBIGUOUS/);
      assert.deepEqual(await effects(page), { trigger: 1, days: 0, queries: 0, exports: 0, navigation: 0 });
    } finally { await page.context().close(); }
  });
  await t.test("a missing panel stops after the explicit wait budget without retrying", async () => {
    const page = await pageFor(fixture({ never: true }));
    try {
      const started = Date.now();
      await assert.rejects(visibleRangeDates(page, "2026-10-15", "2026-10-15", "起始时间"), /JD_LOGISTICS_DATE_CONTROL_NOT_READY/);
      assert.ok(Date.now() - started < 13000);
      assert.deepEqual(await effects(page), { trigger: 1, days: 0, queries: 0, exports: 0, navigation: 0 });
    } finally { await page.context().close(); }
  });
  for (const [name, options, error] of [
    ["an invalid calendar month", { month: "2026 年 13 月" }, "JD_LOGISTICS_CALENDAR_MONTH_NOT_VERIFIED"],
    ["a duplicate target day", { duplicateDay: true }, "JD_LOGISTICS_CALENDAR_DAY_AMBIGUOUS"],
    ["a calendar beyond the existing navigation limit", { month: "2023 年 10 月" }, "JD_LOGISTICS_CALENDAR_RANGE_EXCEEDS_LIMIT"],
  ] as const) await t.test(`${name} remains rejected`, async () => {
    const page = await pageFor(fixture(options));
    try {
      await assert.rejects(visibleRangeDates(page, "2026-10-15", "2026-10-15", "起始时间"), new RegExp(error));
      assert.deepEqual(await effects(page), { trigger: 1, days: 0, queries: 0, exports: 0, navigation: 0 });
    } finally { await page.context().close(); }
  });
  await t.test("async month navigation still waits for the exact month before selecting", async () => {
    const page = await pageFor(fixture({ month: "2026 年 9 月", navigationDelay: 200 }));
    try {
      await visibleRangeDates(page, "2026-10-15", "2026-10-16", "起始时间");
      assert.equal(await page.getByPlaceholder("起始时间", { exact: true }).inputValue(), "2026-10-15");
      assert.equal(await page.getByPlaceholder("结束时间", { exact: true }).inputValue(), "2026-10-16");
      assert.deepEqual(await effects(page), { trigger: 1, days: 2, queries: 0, exports: 0, navigation: 1 });
    } finally { await page.context().close(); }
  });
});
