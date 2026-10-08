import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const row = (id: number, shopName = "合成店A") => ({ id, shopName, consultedAt: "2026-10-07 10:00:00", customerId: `SYNTHETIC-${id}`, agent: "合成客服", productSku: "SYNTHETIC", productName: "合成货品", matchStatus: "matched", matchConfidence: "exact", messages: [], messageTotalCount: 1, robotScope: "", problemType: "", conversionStatus: "", serviceIssues: "", summaryText: "", analyzedAt: null, version: 1 });
const list = (id = 101, shop = "合成店A") => ({ items: [row(id, shop)], shops: ["合成店A", "合成店B"], agents: [], categories: [], summary: { total: 1, matched: 1 }, pagination: { page: 1, pageSize: 30, total: 1, returned: 1, truncated: false } });
async function pending(page: Page, count: number) {
  await page.waitForFunction(n => (window as unknown as { reads: unknown[] }).reads.length >= n, count);
}
async function reply(page: Page, index: number, body: unknown, status = 200) {
  await page.evaluate(({ index, body, status }) => (window as unknown as { reads: { resolve: (response: Response) => void }[] }).reads[index].resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })), { index, body, status });
}
async function fixture() {
  const bundle = await build({ stdin: { contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import View from './app/customer-service-view';
    const initial={email:'synthetic@example.test',displayName:'Synthetic',role:'admin',scopeRestricted:false};
    function App(){const[user,setUser]=useState(initial),[date,setDate]=useState('2026-10-01'),[show,setShow]=useState(true);return <>
      <button onClick={()=>setUser({...initial})}>更换身份包</button>
      <button onClick={()=>setUser({...initial,role:'viewer'})}>只读身份</button>
      <button onClick={()=>setDate('2026-10-02')}>更换日期</button>
      <button onClick={()=>setShow(false)}>离开客服</button>
      {show&&<View currentUser={user} customStartDate={date} customEndDate="2026-10-08" onNavigate={()=>{}}/>}
    </>};createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://customer-read-scope-fixture.invalid/");
  await page.evaluate(() => {
    const state = window as unknown as { reads: { url: string; method: string; resolve: (response: Response) => void }[] };
    state.reads = [];
    // Deliberately ignore abort to exercise owner/generation fencing.
    window.fetch = ((url: unknown, init: RequestInit = {}) => {
      const path = String(url), method = init.method ?? "GET";
      if (path === "/api/customer-service/analyze" && method === "GET") return Promise.resolve(Response.json({ configured: true }));
      return new Promise(resolve => state.reads.push({ url: path, method, resolve }));
    }) as typeof fetch;
  });
  await page.addStyleTag({ content: await readFile(new URL("../app/globals.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await pending(page, 1);
  await reply(page, 0, list());
  await page.locator('.stable-read-content[aria-busy="false"] tbody tr').filter({ hasText: "SYNTHETIC-101" }).waitFor();
  return { browser, page, errors };
}
async function toggleB(page: Page) {
  const menu = page.getByRole("listbox", { name: "客服店铺筛选选项" });
  if (!await menu.isVisible()) await page.getByRole("button", { name: "客服店铺筛选", exact: true }).click();
  await menu.getByRole("option", { name: "合成店B", exact: true }).click();
}

test("new customer scope retains inert presentation, fences old handlers, and exposes only its own recovered rows", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await toggleB(page); await pending(page, 2);
    const old = page.locator('[data-retained-read="true"] .customer-row-actions button').last();
    assert.equal(await old.evaluate(el => Boolean(el.closest("[inert]"))), true);
    await old.evaluate(el => (el as HTMLButtonElement).click());
    assert.equal(await page.evaluate(() => (window as unknown as { reads: unknown[] }).reads.length), 2);
    assert.equal(await page.locator(".customer-service-heading-actions button").first().isDisabled(), true);
    await reply(page, 1, list(202, "合成店B"));
    await page.locator('.stable-read-content[aria-busy="false"] tbody').filter({ hasText: "SYNTHETIC-202" }).waitFor();
    assert.equal(await page.getByText("SYNTHETIC-101", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("failed customer scope cannot revive prior rows when returning to the previous filter", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await toggleB(page); await pending(page, 2); await reply(page, 1, { error: "SYNTHETIC_FAILURE" }, 503);
    await page.getByRole("alert").filter({ hasText: "SYNTHETIC_FAILURE" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看会话", exact: true }).count(), 0);
    await toggleB(page); await pending(page, 3);
    assert.equal(await page.getByText("SYNTHETIC-101", { exact: true }).count(), 0);
    assert.equal(await page.locator(".customer-service-heading-actions button").first().isDisabled(), true);
    await reply(page, 2, list());
    await page.locator('.stable-read-content[aria-busy="false"] tbody').filter({ hasText: "SYNTHETIC-101" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("an equal-looking identity packet clears customer presentation and requests fresh authorized options", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "更换身份包", exact: true }).click(); await pending(page, 2);
    assert.equal(await page.getByText("SYNTHETIC-101", { exact: true }).count(), 0);
    const url = await page.evaluate(() => (window as unknown as { reads: { url: string }[] }).reads[1].url);
    assert.equal(new URL(url, "https://fixture.invalid").searchParams.get("includeOptions"), "true");
    await reply(page, 1, list(202, "合成店B"));
    await page.getByText("SYNTHETIC-202", { exact: true }).waitFor();
    await page.getByRole("button", { name: "只读身份", exact: true }).click(); await pending(page, 3);
    await reply(page, 2, list(303)); await page.getByText("SYNTHETIC-303", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "AI分析", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("late customer detail cannot reopen after its date changes", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2);
    await page.getByRole("button", { name: "更换日期", exact: true }).click(); await pending(page, 3);
    await reply(page, 1, { item: row(101) }); await reply(page, 2, list(202));
    await page.getByText("SYNTHETIC-202", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog", { name: "客服会话详情" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a late import completion refreshes the current scope without stranding its reader", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "客服导入店铺", exact: true }).click();
    await page.getByRole("listbox", { name: "客服导入店铺选项", exact: true }).getByRole("option").first().click();
    const files = page.locator('input[type="file"]');
    assert.equal(await files.count(), 2);
    await files.nth(0).setInputFiles({ name: "synthetic.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic") });
    await files.nth(1).setInputFiles({ name: "synthetic.log", mimeType: "text/plain", buffer: Buffer.from("synthetic") });
    await page.getByRole("button", { name: "开始导入并匹配", exact: true }).click(); await pending(page, 3);
    await reply(page, 1, { ok: true, upload: { id: "synthetic-session", receivedChunkIndexes: [0] } });
    await reply(page, 2, { ok: true, upload: { id: "synthetic-chat", receivedChunkIndexes: [0] } }); await pending(page, 4);
    await toggleB(page); await pending(page, 5);
    await reply(page, 3, { ok: true, message: "SYNTHETIC_IMPORT_COMPLETED" });
    await page.getByText("SYNTHETIC_IMPORT_COMPLETED", { exact: true }).waitFor();
    await pending(page, 6);
    const refreshed = await page.evaluate(() => (window as unknown as { reads: { url: string }[] }).reads[5].url);
    assert.equal(new URL(refreshed, "https://fixture.invalid").searchParams.get("shopName"), "合成店B");
    await reply(page, 4, list(202, "合成店B"));
    await reply(page, 5, list(202, "合成店B"));
    await page.locator('.stable-read-content[aria-busy="false"] tbody').filter({ hasText: "SYNTHETIC-202" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("an accepted detail save finishing under a new identity cannot overwrite its rows or reopen its detail", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2); await reply(page, 1, { item: row(101) });
    const dialog = page.getByRole("dialog", { name: "客服会话详情" }); await dialog.waitFor();
    await dialog.locator("textarea").nth(0).fill("OLD_OWNER_DRAFT");
    await dialog.getByRole("button", { name: "保存详情标注", exact: true }).click(); await pending(page, 3);
    await page.getByRole("button", { name: "更换身份包", exact: true }).evaluate(el => (el as HTMLButtonElement).click()); await pending(page, 4);
    const fresh = list(); fresh.items[0].serviceIssues = "NEW_OWNER_SERVICE"; fresh.items[0].version = 9;
    await reply(page, 3, fresh); await page.getByText("NEW_OWNER_SERVICE", { exact: true }).waitFor();
    await reply(page, 2, { version: 2 }); await pending(page, 5);
    await reply(page, 4, fresh);
    await page.locator('.stable-read-content[aria-busy="false"] tbody').filter({ hasText: "NEW_OWNER_SERVICE" }).waitFor();
    assert.equal(await page.getByText("OLD_OWNER_DRAFT", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "客服会话详情" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("an accepted save may finish after leaving customer view without refreshing the unmounted instance", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2); await reply(page, 1, { item: row(101) });
    const dialog = page.getByRole("dialog", { name: "客服会话详情" }); await dialog.waitFor();
    await dialog.locator("textarea").nth(0).fill("UNMOUNTED_OWNER_DRAFT");
    await dialog.getByRole("button", { name: "保存详情标注", exact: true }).click(); await pending(page, 3);
    await page.getByRole("button", { name: "离开客服", exact: true }).evaluate(el => (el as HTMLButtonElement).click());
    await reply(page, 2, { version: 2 }); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => (window as unknown as { reads: unknown[] }).reads.length), 3);
    assert.equal(await page.locator(".customer-service-page").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a failed refresh preserves only its exact prior scope and cannot start AI; permission denial clears it", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "↻ 刷新数据", exact: true }).click(); await pending(page, 2);
    await reply(page, 1, { error: "SYNTHETIC_TRANSIENT_READ" }, 503);
    await page.locator('[data-previous-read="true"] tbody').filter({ hasText: "SYNTHETIC-101" }).waitFor();
    assert.equal(await page.locator('.stable-read-content[aria-busy="true"]').count(), 0);
    assert.equal(await page.locator(".customer-service-heading-actions button").first().isDisabled(), true);
    assert.equal(await page.locator(".customer-row-actions button").first().isDisabled(), true);
    await page.getByRole("button", { name: "↻ 刷新数据", exact: true }).click(); await pending(page, 3);
    await reply(page, 2, { error: "SYNTHETIC_DENIED" }, 403);
    await page.getByRole("alert").filter({ hasText: "SYNTHETIC_DENIED" }).waitFor();
    assert.equal(await page.getByText("SYNTHETIC-101", { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-retained-read="true"]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("detail permission denial clears old customer rows and ends the reading state", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2);
    await reply(page, 1, { error: "SYNTHETIC_DETAIL_DENIED" }, 403);
    await page.getByRole("alert").filter({ hasText: "SYNTHETIC_DETAIL_DENIED" }).waitFor();
    assert.equal(await page.getByText("SYNTHETIC-101", { exact: true }).count(), 0);
    assert.equal(await page.locator('.stable-read-content[aria-busy="true"]').count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "客服会话详情" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("opening and closing detail after a transient same-scope failure does not turn the list busy again", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "↻ 刷新数据", exact: true }).click(); await pending(page, 2);
    await reply(page, 1, { error: "SYNTHETIC_TRANSIENT_READ" }, 503);
    await page.locator('[data-previous-read="true"] tbody').waitFor();
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 3); await reply(page, 2, { item: row(101) });
    await page.getByRole("dialog", { name: "客服会话详情" }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await page.locator('.stable-read-content[aria-busy="true"]').count(), 0);
    assert.equal(await page.locator('[data-previous-read="true"]').count(), 1);
    assert.match(await page.getByRole("alert").innerText(), /SYNTHETIC_TRANSIENT_READ/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a cancelled old detail denial cannot clear the restored scope's new successful rows", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2);
    await toggleB(page); await pending(page, 3); await toggleB(page); await pending(page, 4);
    await reply(page, 3, list(303)); await page.getByText("SYNTHETIC-303", { exact: true }).waitFor();
    await reply(page, 1, { error: "SYNTHETIC_OLD_DENIAL" }, 403); await reply(page, 2, list(202));
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("SYNTHETIC-303", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await page.locator('.stable-read-content[aria-busy="true"]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("current detail denial fences a parallel list reply and permits a fresh explicit recovery", { skip: !existsSync(chrome), timeout: 30_000 }, async () => {
  const { browser, page, errors } = await fixture();
  try {
    await page.getByRole("button", { name: "查看会话", exact: true }).click(); await pending(page, 2);
    await page.getByRole("button", { name: "↻ 刷新数据", exact: true }).click(); await pending(page, 3);
    await reply(page, 1, { error: "SYNTHETIC_CURRENT_DENIAL" }, 403);
    await page.getByRole("alert").filter({ hasText: "SYNTHETIC_CURRENT_DENIAL" }).waitFor();
    await reply(page, 2, list(999)); await page.waitForTimeout(100);
    assert.equal(await page.getByText("SYNTHETIC-999", { exact: true }).count(), 0);
    assert.equal(await page.locator('.stable-read-content[aria-busy="true"]').count(), 0);
    await page.getByRole("button", { name: "↻ 刷新数据", exact: true }).click(); await pending(page, 4); await reply(page, 3, list(303));
    await page.getByText("SYNTHETIC-303", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
