import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("AI analysis batches recover committed rows after a provider rejection", { skip: !existsSync(chrome), timeout: 60_000 }, async () => {
  const bundle = await build({ stdin: { contents: `
    import { createRoot } from 'react-dom/client';
    import CustomerServiceView from './app/customer-service-view';
    createRoot(document.getElementById('root')).render(<CustomerServiceView
      customStartDate="2026-10-01" customEndDate="2026-10-08"
      currentUser={{role:'admin',email:'fixture@example.invalid',displayName:'Fixture'}} onNavigate={()=>{}} />);`,
    loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const calls: number[][] = [];
    let fail = true;
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1, shopName: "合成店铺", consultedAt: "2026-10-07 10:00:00", customerId: `fixture-${index}`,
      agent: "合成客服", productName: "合成商品", matchedSkuId: "fixture", productCategory: "合成类目",
      matchStatus: "matched", matchConfidence: "exact", messages: [], messageTotalCount: 0,
      robotScope: "exclude_robot", problemType: "商品咨询", conversionStatus: "unknown",
      serviceIssues: "", summaryText: "", analysisSource: "", analyzedAt: null as string | null, version: 1,
    }));
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request();
      if (request.url().includes("/api/customer-service/analyze")) {
        if (request.method() === "GET") return route.fulfill({ json: { configured: true } });
        const ids = request.postDataJSON().ids as number[];
        calls.push(ids);
        if (fail && calls.length === 2) return route.fulfill({ status: 503, json: {
          error: "当前文本模型的订阅校验未通过，请检查订阅与密钥。", code: "service_unavailable",
        } });
        for (const row of items.filter(row => ids.includes(row.id))) {
          row.analyzedAt = "2026-10-08T00:00:00Z"; row.summaryText = "合成分析完成"; row.version++;
        }
        return route.fulfill({ json: { analyzed: ids.length, requested: ids.length, incomplete: 0,
          results: ids.map(id => ({ id, status: "updated" })) } });
      }
      if (request.url().includes("/api/customer-service/conversations")) return route.fulfill({ json: {
        items, agents: ["合成客服"], shops: ["合成店铺"], categories: ["合成类目"],
        summary: { total: 10, matched: 10, sessionOnly: 0, chatOnly: 0 },
        pagination: { page: 1, pageSize: 30, total: 10, returned: 10, truncated: false },
      } });
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    await page.goto("https://customer-analysis.invalid/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const analyze = page.locator(".customer-service-heading-actions").getByRole("button", { name: "AI分析", exact: true });
    await analyze.click();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /订阅校验未通过/);
    assert.match(await page.getByRole("status").innerText(), /已确认完成 8\/10/);
    assert.deepEqual(calls, [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10]]);
    assert.equal(await page.getByText("合成分析完成", { exact: true }).count(), 8);
    fail = false;
    await analyze.click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("AI 分析已完成 2/2"));
    assert.deepEqual(calls.at(-1), [9, 10]);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await analyze.isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
