import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("business card confirms once, refresh restores by GET, stale inventory is explicit and in-flight cancel is not rollback", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".codex-tmp-pi-business-"));
  let browser;
  try {
    const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Business from './app/ai-pi-business-actions'; createRoot(document.getElementById('root')).render(React.createElement(Business,{sessionId:'fixture-session',epoch:1,generation:1,ownerKey:'fixture-user',writable:true}));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
    await writeFile(path.join(directory, "ui.js"), bundle.outputFiles[0].text);
    await writeFile(path.join(directory, "index.html"), '<!doctype html><meta charset="utf-8"><title>Private business acceptance</title><div id="root"></div><script src="ui.js"></script>');
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.fixture = JSON.parse(sessionStorage.getItem("business-server") || "null") || {
        action: { actionId: "action-1", actionType: "save_replenishment_draft", status: "prepared", version: 1,
          previewDigest: "f".repeat(64), preview: { details: { source: { inventoryStale: true, inventoryDate: "2026-01-01" } } },
          result: {}, parentOperationId: "parent-1", invocationId: "invoke-1", controls: [] }, calls: [], dropReply: true,
      };
      const f = window.fixture; f.calls = [];
      window.fetch = async (url, init = {}) => {
        const method = init.method || "GET";
        const payload = init.body ? JSON.parse(init.body) : null;
        f.calls.push({ method, payload });
        if (method === "GET") return f.freezeReads ? new Promise(() => {}) : Response.json({ items: [f.action] });
        const key = "fixture-user:business:fixture-session:1:1";
        const pending = JSON.parse(localStorage.getItem(key) || "[]");
        if (!pending.some(item => item.clientRequestId === payload.clientRequestId)) throw Error("identity not saved before POST");
        if (payload.command === "confirm") {
          if (payload.expectedVersion !== f.action.version || payload.previewDigest !== f.action.previewDigest) throw Error("unbound confirmation");
          f.action.status = "queued"; f.action.version++;
        } else if (payload.command === "cancel") f.action.cancelRequested = true;
        else throw Error("unexpected command");
        f.action.controls.push({ clientRequestId: payload.clientRequestId, command: payload.command, status: f.action.status });
        sessionStorage.setItem("business-server", JSON.stringify(f));
        if (f.dropReply) { f.dropReply = false; sessionStorage.setItem("business-server", JSON.stringify(f)); f.freezeReads = true; throw Error("accepted response lost"); }
        return Response.json({ action: f.action });
      };
    });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
    await page.getByRole("alert").filter({ hasText: "库存快照已过期" }).waitFor();
    await page.getByRole("button", { name: "确认以上范围并执行" }).click();
    await page.getByText("原业务请求正在核实", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(x => x.method === "POST").length), 1);
    await page.reload();
    await page.getByText("排队", { exact: true }).waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("fixture-user:business:fixture-session:1:1")).length === 0);
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(x => x.method === "POST").length), 0);
    await page.evaluate(() => { window.fixture.action.status = "dispatched"; sessionStorage.setItem("business-server", JSON.stringify(window.fixture)); });
    await page.reload();
    await page.getByRole("button", { name: "请求取消" }).click();
    await page.getByText("取消请求 · 执行中", { exact: true }).waitFor();
    assert.equal(await page.getByText("已取消", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(x => x.method === "POST").length), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
