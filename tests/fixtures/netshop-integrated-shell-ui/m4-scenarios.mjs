import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

/** Uses only real Home callbacks and browser navigation. No history controller. */
export async function runM4Scenarios({ page, context, origin, check, save, evidence, root }) {
  const owner = JSON.parse(await readFile(resolve(root, "tests/fixtures/netshop-integrated-shell-ui/source6/response-seven-day-shop-week-exact-product.json"), "utf8"));
  const identity = owner.sections.items[0].mapping.linkIdentity, shopKey = `${identity.platform}\u001f${identity.shopName}`;
  const revision = owner.context.sourceRevisions.find(item => item.kind === "owning_revision").revision;
  const query = new URLSearchParams({ module: "shop", view: "products", period: "custom", from: "2026-09-01", to: "2026-09-07", shopPlatform: identity.platform, shopOutlet: shopKey, shopDimension: "sku", shopGrain: "week" });
  const readyP = () => page.getByRole("heading", { name: "商品经营明细", exact: true }).waitFor();
  const readyA = () => page.locator(".promotion-insights .promotion-object-toolbar").waitFor();
  await page.goto(`${origin}/?${query}`); await readyP();
  await check("M4 mounts real P and A only with both registered reader sources and true exact gate", async () => {
    assert.deepEqual(await page.evaluate(() => window.__integratedModules), { products: true, promotion: true, exactPromotion: true });
    for (const file of ["app/api/netshop/promotion-insights/route.ts", "app/api/netshop/promotion-insights/detail/route.ts", "app/netshop/promotion/PromotionInsightsView.tsx"]) assert.ok((await readFile(resolve(root, file))).length > 0);
    assert.equal(await page.getByRole("navigation", { name: "主导航", exact: true }).count(), 1);
  });
  await check("M4 uses real complete-layout top masthead, sticky tabs and system glyph/menu controls", async () => {
    const geometry = () => page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { navigation: rect("#primary-navigation"), head: rect(".shell-masthead"), workspace: rect(".workspace"), tabs: rect(".module-stage .subnav"), offset: parseFloat(getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--app-sticky-offset")), glyphs: [...document.querySelectorAll("#primary-navigation svg")].map(el => { const r=el.getBoundingClientRect();return { width:r.width,height:r.height }; }) };
    });
    const initial = await geometry(); assert.ok(Math.abs(initial.head.y) <= 1); assert.ok(Math.abs(initial.workspace.x) <= 1); assert.ok(initial.workspace.y >= initial.head.bottom - 1); assert.ok(initial.navigation.y >= initial.head.y && initial.navigation.bottom <= initial.head.bottom + 1); assert.ok(initial.navigation.width > initial.navigation.height * 3); assert.ok(Math.abs(initial.offset - initial.head.height) <= 1);
    assert.ok(initial.glyphs.length >= 12 && initial.glyphs.every(glyph => glyph.width > 0 && glyph.height > 0));
    for(const name of ["网店分析", "AI 对话", "AI 助理"]) assert.ok(await page.getByRole("link", { name, exact:false }).count() >= 1);
    await page.evaluate(()=>window.scrollTo(0,180)); await new Promise(resolve=>setTimeout(resolve,80)); const scrolled=await geometry(); assert.ok(Math.abs(scrolled.head.y)<=1); assert.ok(Math.abs(scrolled.tabs.y-scrolled.head.bottom)<=1);
    await save("m4-layout-glyph-geometry.json",{initial,scrolled});await page.evaluate(()=>window.scrollTo(0,0));
  });
  await page.getByLabel("商品明细排序").selectOption("visitors_desc");
  await page.getByLabel("访客 / 转化 / 加购", { exact: true }).uncheck();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByText(`合成商品 ${identity.id}`, { exact: true }).waitFor();
  await page.getByRole("button", { name: "详情", exact: true }).first().click();
  await page.getByRole("button", { name: "推广关联", exact: true }).click();
  await check("actual verified SKU eligibility drills P to A with typed identity and exact shop, not fuzzy q", async () => {
    const button = page.getByRole("button", { name: "查看对应商品推广", exact: true }); assert.equal(await button.isDisabled(), false); await button.click();
    await readyA(); await page.getByLabel("精确商品焦点", { exact: true }).waitFor();
    const request = await page.evaluate(() => window.__integrated.calls.filter(item => item.path === "/api/netshop/promotion-insights").at(-1)), p = new URLSearchParams(request.query);
    assert.deepEqual(JSON.parse(p.get("productIdentity")), [identity.platform, identity.shopName, identity.dimension, identity.id]);
    assert.deepEqual(p.getAll("outlet"), [shopKey]); assert.equal(p.get("q"), "");
    assert.equal(await page.locator("#promotion-products .data-table tbody tr").count(), 1);
  });
  await check("actual A onReturn restores P detail and its original second-page list", async () => {
    await page.getByRole("button", { name: "返回原列表", exact: true }).click();
    await page.getByRole("button", { name: "← 返回商品列表", exact: true }).waitFor();
    await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click();
    await page.getByText(`合成商品 ${identity.id}`, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2");
    assert.equal(await page.getByLabel("商品明细排序").inputValue(), "visitors_desc");
    assert.equal(await page.getByLabel("访客 / 转化 / 加购", { exact: true }).isChecked(), false);
  });
  await page.getByRole("button", { name: "详情", exact: true }).first().click(); await page.getByRole("button", { name: "推广关联", exact: true }).click(); await page.getByRole("button", { name: "查看对应商品推广", exact: true }).click(); await readyA();
  await check("actual A object detail and A-to-P-to-A flat chain keep the original P list origin", async () => {
    await page.locator("#promotion-products .data-table tbody tr").first().getByRole("button").first().click();
    await page.getByRole("button", { name: "查看精确关联商品整期详情", exact: true }).waitFor();
    await page.getByRole("button", { name: "查看精确关联商品整期详情", exact: true }).click();
    await page.getByRole("button", { name: "查看对应商品推广", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopSection"), "promotion", "same exact P roundtrip restores its original detail section");
    await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click();
    await readyP(); await page.getByText(`合成商品 ${identity.id}`, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2");
  });
  const aq = new URLSearchParams(query); aq.set("view", "promotion"); aq.set("shopPageSize", "1");
  await page.goto(`${origin}/?${aq}`); await readyA();
  await check("actual weekly focus/search/sort/page A-to-P-to-A roundtrip restores bound preferences", async () => {
    await page.getByLabel("推广对象排序").selectOption("roas_desc");
    await page.getByLabel("搜索推广对象").fill("SKU");
    await page.getByLabel("观察趋势日期", { exact: true }).first().selectOption("0");
    await page.getByRole("button", { name: "查看这一期间的对象明细", exact: true }).click(); await readyA();
    await page.getByRole("button", { name: "下一页", exact: true }).click(); await readyA();
    const request = await page.evaluate(() => window.__integrated.calls.filter(item => item.path === "/api/netshop/promotion-insights").at(-1)), scope = new URLSearchParams(request.query);
    assert.equal(scope.get("objectStartDate"), "2026-09-01"); assert.equal(scope.get("objectEndDate"), "2026-09-06"); assert.equal(scope.get("q"), "SKU"); assert.equal(scope.get("page"), "2"); assert.equal(scope.get("sort"), "roas_desc"); assert.equal(scope.has("productIdentity"), false);
    await page.locator("#promotion-products .data-table tbody tr").getByRole("button", { name: "合成商品1", exact: true }).click();
    await page.getByRole("button", { name: "查看精确关联商品整期详情", exact: true }).click();
    await page.getByRole("button", { name: "← 返回商品列表", exact: true }).click(); await readyA();
    assert.equal(new URL(page.url()).searchParams.get("shopPage"), "2"); assert.equal(await page.getByLabel("搜索推广对象").inputValue(), "SKU");
    const url = page.url();
    assert.equal(await page.getByLabel("推广对象排序").inputValue(), "roas_desc");
    await page.getByText("已定位对象期间 2026-09-01—2026-09-06", { exact: true }).waitFor();
    const tab = await context.newPage(); await tab.clock.setFixedTime(new Date("2026-10-01T04:00:00Z")); await tab.goto(url);
    try { await tab.getByLabel("推广对象排序").waitFor(); assert.equal(await tab.getByLabel("推广对象排序").inputValue(), "spend_desc"); assert.equal(await tab.getByText("已定位对象期间 2026-09-01—2026-09-06", { exact: true }).count(), 0); }
    finally { await save("new-tab-transport.json", await tab.evaluate(() => window.__integrated)); await tab.close(); }
  });
  await check("actual diagnostic UI passes trace opt-in and forbids paid POST while capturing synthetic Blob downloads", async () => {
    await page.getByRole("button", { name: "生成当前周期诊断", exact: true }).click();
    await page.getByRole("button", { name: "导出 HTML", exact: true }).waitFor();
    await page.getByRole("button", { name: "导出 HTML", exact: true }).click(); await page.getByRole("button", { name: "导出 XLSX", exact: true }).click();
    await page.waitForFunction(() => window.__syntheticDownloads.length === 2 && window.__syntheticDownloads.every(item => item.bytes));
    const downloads = await page.evaluate(() => window.__syntheticDownloads);
    const html = new TextDecoder().decode(Uint8Array.from(downloads[0].bytes)), xlsx = Uint8Array.from(downloads[1].bytes), xml = Object.entries(unzipSync(xlsx)).filter(([name]) => name.endsWith(".xml")).map(([, data]) => strFromU8(data)).join("\n");
    assert.ok(html.includes('<h2>范围与来源</h2>')); assert.ok(html.includes(revision)); assert.ok(xml.includes("范围与来源")); assert.ok(xml.includes(revision));
    await save("synthetic-diagnostic.html", html); await save("synthetic-diagnostic.xlsx", xlsx); await save("download-meta.json", downloads.map(({ bytes, ...record }) => ({ ...record, bytes: bytes.length, synthetic: true })));
    assert.equal(await page.evaluate(() => window.__integrated.paidAttempts.length), 0);
  });
  for (const reason of ["role", "scope", "epoch"]) await check(`actual ${reason} reader error clears old A rows and report without paid dispatch`, async () => {
    await page.evaluate(value => { window.__integratedControl.error = value; }, reason);
    const sort = page.getByLabel("推广对象排序"); await sort.selectOption((await sort.inputValue()) === "roas_desc" ? "spend_desc" : "roas_desc");
    if (reason === "epoch") await page.getByText("来源版本已变化，请重新读取", { exact: true }).waitFor(); else await page.getByRole("alert").filter({ hasText: "旧数据须清空" }).waitFor();
    assert.equal(await page.locator("#promotion-products .data-table tbody tr").count(), 0); assert.equal(await page.getByRole("button", { name: "导出 HTML", exact: true }).count(), 0);
    await page.evaluate(() => { window.__integratedControl.error = null; }); await page.getByRole("button", { name: "重新读取", exact: true }).click(); await readyA();
  });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: resolve(evidence, "m4-real-home-desktop.png"), fullPage: true });
  for (const width of [390, 320]) await check(`actual M4 complete-layout viewport ${width} is bounded`, async () => { await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.client + 1, JSON.stringify(size)); assert.equal(await page.getByRole("button",{name:"打开主导航",exact:true}).isVisible(),true); assert.equal(await page.locator("#primary-navigation").evaluate(el=>getComputedStyle(el).display),"none"); await page.getByRole("button",{name:"打开主导航",exact:true}).click(); await page.getByRole("dialog",{name:"顶部应用导航",exact:true}).waitFor(); await page.getByRole("button",{name:"关闭主导航",exact:true}).click(); await page.screenshot({ path: resolve(evidence, `m4-real-home-${width}.png`), fullPage: true }); });
  return { completedScope: "M4 real Home source6 exact SKU/week-focus/search/sort/page returns, safe errors and actual report DTO binding", pending: ["Independent Q/live-source/actual P mapping and SQL query/ordering proof"], limitations: ["Explicit fixture_projection is recorded per request; A/report business cells and complete calendar/coverage are preserved source6 captures", "P values and positive mapping eligibility remain Owner synthetic fixture data; this run does not prove actual P backend mapping or numerical parity with A", "Role/scope errors are injected reader permission responses, not a database principal-policy test"] };
}
