import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { validFinanceAnalysis } from "../lib/sales/view-response";

const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("finance filters preserve search and multiple selections through loading, errors and late responses", {
  skip: !existsSync(chromePath), timeout: 60_000,
}, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import SalesView from './app/sales-module-view';
        createRoot(document.getElementById('root')).render(<SalesView range="自定义"
          customStartDate="2026-09-01" customEndDate="2026-09-30" currentUser={null}
          moduleView="finance" onModuleViewChange={() => {}} />);`,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const complete = JSON.parse(await readFile(new URL("../docs/performance/sales/fixtures/finance.json", import.meta.url), "utf8"));
  const metrics = Object.fromEntries(Object.entries(complete.current).map(([key, value]) =>
    [key, key.endsWith("Cents") ? Math.round(Number(value) * 1234500 / complete.current.netSalesCents) : value]));
  const payload = {
    ...complete,
    hasData: true, selectedMonth: "2026-09", selectedMonths: ["2026-09"],
    months: ["2026-09", "2026-08", "2026-07"].map(month => ({ ...complete.months[0], month })),
    current: metrics, yearToDate: metrics, timeline: [], expenses: [], shops: [], anomalies: [],
    expensePagination: { total: 0, returned: 0, truncated: false },
    shopPagination: { total: 0, returned: 0, truncated: false },
    filters: { platforms: ["京东"], shops: ["甲旗舰店", "乙旗舰店", "丙专卖店"].map(name => ({
      key: JSON.stringify(["京东", name]), name, platform: "京东",
    })) },
  };
  assert.equal(validFinanceAnalysis(payload), true, "the interaction fixture must satisfy the unchanged business response guard");
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://finance-fixture.invalid/");
    await page.addStyleTag({ content: await readFile(new URL("../app/globals.css", import.meta.url), "utf8") });
    await page.evaluate(initial => {
      const pending: Array<{ url: string; resolve: (response: Response) => void }> = [];
      Object.assign(window, { financePending: pending });
      // Every success must echo the actual pending scope. Replaying a fixed
      // September/all-shops response after changing filters is invalid now.
      Object.assign(window, { financeShapeResponse(url: string, body: typeof initial) {
        const value = structuredClone(body);
        const query = new URL(url, location.href).searchParams;
        const requestedMonths = query.getAll("month");
        const allMonths = requestedMonths.includes("*");
        const months = allMonths ? value.months.map((item: { month: string }) => item.month) : requestedMonths;
        value.selectedMonths = value.hasData ? months : [];
        value.selectedMonth = value.hasData ? months.at(-1) ?? null : null;
        value.selection = {
          ...value.selection, allMonths, requestedMonths, months: value.hasData ? months : [],
          platforms: query.getAll("platform"), shops: query.getAll("shop"), fallbackApplied: false,
        };
        if (!value.hasData) {
          value.current = value.previous = value.yearAgo = null;
          value.yearToDate = Object.fromEntries(Object.keys(initial.current).map(key => [key, 0]));
          value.timeline = []; value.expenses = []; value.shops = []; value.anomalies = [];
        }
        return value;
      } });
      let first = true;
      window.fetch = async input => {
        if (first) {
          first = false;
          return Response.json((window as unknown as { financeShapeResponse: (url: string, body: typeof initial) => unknown }).financeShapeResponse(String(input), initial));
        }
        // Deliberately ignore abort: generation fencing must reject late responses too.
        return new Promise<Response>(resolve => pending.push({ url: String(input), resolve }));
      };
    }, payload);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText(/[¥￥]12,345$/, { exact: true }).first().waitFor();
    const settle = async (status: number, body: unknown) => {
      await page.waitForFunction(() => {
        const last = (window as unknown as { financePending: Array<{ settled?: boolean }> }).financePending.at(-1);
        return last && !last.settled;
      });
      await page.evaluate(({ status, body }) => {
        const state = window as unknown as {
          financePending: Array<{ url: string; settled?: boolean; resolve: (response: Response) => void }>;
          financeShapeResponse: (url: string, body: unknown) => unknown;
        };
        const pending = state.financePending;
        pending.at(-1)!.settled = true;
        pending.at(-1)!.resolve(Response.json(status === 200 ? state.financeShapeResponse(pending.at(-1)!.url, body) : body, { status }));
      }, { status, body });
    };
    for (let index = 0; index < 2; index++) {
      await page.getByRole("button", { name: "月份多选", exact: true }).nth(index).click();
      const search = page.getByRole("searchbox", { name: "搜索月份", exact: true });
      await search.fill("2026");
      assert.ok((await page.getByRole("option").allTextContents()).some(text => text.includes("2026年8月")), JSON.stringify({ index, errors, body: await page.locator("body").innerText() }));
      await page.getByRole("option", { name: /2026年8月$/ }).click();
      assert.equal(await search.inputValue(), "2026");
      assert.equal(await page.getByRole("listbox", { name: "月份多选", exact: true }).count(), 1);
      assert.equal(await page.getByText(/[¥￥]12,345$/, { exact: true }).count(), 0);
      await settle(200, payload);
      await page.getByText(/[¥￥]12,345$/, { exact: true }).first().waitFor();
      assert.equal(await search.inputValue(), "2026");
      await page.getByRole("option", { name: /2026年7月$/ }).click();
      assert.equal(await search.inputValue(), "2026");
      await settle(503, { error: "测试读取失败" });
      await page.getByRole("alert").waitFor();
      assert.equal(await search.inputValue(), "2026");
      await page.getByRole("button", { name: "重新加载", exact: true }).click();
      await settle(200, payload);
      await page.getByText(/[¥￥]12,345$/, { exact: true }).first().waitFor();
      // Closing is explicit; toggling an option above never closes the menu.
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("listbox", { name: "月份多选", exact: true }).count(), 0);
    }
    await page.getByRole("button", { name: "销售分析店铺", exact: true }).click();
    const shopSearch = page.getByRole("searchbox", { name: "搜索销售分析店铺", exact: true });
    await shopSearch.fill("旗舰店");
    await page.getByRole("option", { name: "京东 · 甲旗舰店", exact: true }).click();
    assert.equal(await shopSearch.inputValue(), "旗舰店");
    await page.getByRole("option", { name: "京东 · 乙旗舰店", exact: true }).click();
    assert.equal(await page.getByRole("option", { selected: true }).count(), 2);
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await settle(200, payload);
    await page.getByText(/[¥￥]12,345$/, { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "销售分析店铺", exact: true }).click();
    await shopSearch.fill("旗舰店");
    await page.evaluate(() => {
      const pending = (window as unknown as { financePending: Array<{ resolve: (response: Response) => void }> }).financePending;
      for (const request of pending.slice(0, -1)) request.resolve(Response.json({ error: "迟到的旧错误" }, { status: 503 }));
    });
    assert.equal(await shopSearch.inputValue(), "旗舰店");
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("option", { name: "京东 · 乙旗舰店", exact: true }).click();
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await settle(200, { ...payload, hasData: false, selectedMonth: null, selectedMonths: [] });
    await page.getByText("当前筛选没有月度财报数据", { exact: true }).waitFor();
    await page.getByRole("button", { name: "销售分析店铺", exact: true }).click();
    await shopSearch.fill("旗舰店");
    assert.equal(await shopSearch.inputValue(), "旗舰店");
    assert.equal(await page.getByRole("option", { selected: true }).count(), 1);
    assert.equal(await page.getByText(/[¥￥]12,345$/, { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
