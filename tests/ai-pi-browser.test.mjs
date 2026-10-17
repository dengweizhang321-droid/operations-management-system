import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("actual Pi UI persists request identity and restores by GET after a lost POST response", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".codex-tmp-pi-ui-"));
  let browser;
  try {
    const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Pi from './app/ai-pi-agent-view'; createRoot(document.getElementById('root')).render(React.createElement(Pi,{currentUser:{email:'fixture@example.invalid',displayName:'镜像',role:'analyst',roleLabel:'分析员'}}));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
    await writeFile(path.join(directory, "ui.js"), bundle.outputFiles[0].text);
    await writeFile(path.join(directory, "index.html"), '<!doctype html><meta charset="utf-8"><title>Pi isolated UI fixture</title><div id="root"></div><script src="ui.js"></script>');
    browser = await chromium.launch({ executablePath: process.env.PI_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => {
      const saved = JSON.parse(sessionStorage.getItem("server") || "null");
      window.fixture = saved || { sessions: [], operations: [], controls: [], events: [], files: [], calls: [], frozen: false };
      const f = window.fixture;
      f.calls = [];
      const save = () => sessionStorage.setItem("server", JSON.stringify(f));
      window.fetch = async (input, init = {}) => {
        const url = String(input); const method = init.method || "GET";
        const payload = init.body ? JSON.parse(init.body) : null;
        f.calls.push({ url, method, payload });
        if (url.endsWith("/sessions/s1") && f.deferS1) return new Promise(resolve => { window.releasePi = () => resolve(Response.json({ session: { ...f.sessions[0], title: "迟到旧环境" }, operations: [], files: [] })); });
        if (method === "POST") {
          const pending = JSON.parse(localStorage.getItem("ai-pi-v1:fixture@example.invalid:pending"));
          if (!pending.some(item => item.clientRequestId === payload.clientRequestId)) throw Error("request identity was not durable before dispatch");
        }
        if (url.endsWith("/messages") && f.rejectNextMessage) { f.rejectNextMessage = false; save(); return Response.json({ error: "合成参数拒绝" }, { status: 400 }); }
        const session = () => ({ ...f.sessions[0], status: f.frozen ? "frozen" : f.operations.some(item => item.status === "running") ? "running" : "ready", activeOperationId: f.operations.some(item => item.status === "running") ? "op1" : null });
        let result;
        if (url.endsWith("/skills")) result = { items: [{ id: "source-audit", name: "来源核查", description: "核对已授权数据来源", status: "enabled" }, { id: "off", name: "未部署技能", description: "环境未准备", status: "disabled" }], models: [{ id: "m1", name: "现有模型", modelName: "fixture", isDefault: true }] };
        else if (/\/sessions(?:\?|$)/.test(url) && method === "GET") result = { items: f.sessions.map(item => item.id === "s1" ? session() : item) };
        else if (url.endsWith("/sessions") && method === "POST") { const item = { id: "s1", title: "来源分析", status: "ready", epoch: 1, generation: 1, scope: payload.scope ?? null, createClientRequestId: payload.clientRequestId }; f.sessions = [item]; result = { session: item }; }
        else if (url.includes("/events?")) { const after = Number(new URL(url, "https://fixture.invalid").searchParams.get("after")); result = { items: f.events.filter(event => event.eventSeq > after), after, hasMore: false }; }
        else if (url.endsWith("/messages")) { if (payload.shopSelection) { f.sessions[0].shopSelection = payload.shopSelection; f.sessions[0].generation++; f.sessions[0].epoch++; f.events = []; f.files = []; } f.operations = [{ id: "op1", clientRequestId: payload.clientRequestId, kind: "message", status: "running" }]; f.events.push({ eventSeq: f.sessions[0].generation, type: "user_message", operationId: "op1", data: { text: payload.message } }); save(); throw Error("simulated response loss after server acceptance"); }
        else if (url.endsWith("/abort")) { f.operations[0].status = "canceled"; f.controls.push({ clientRequestId: payload.clientRequestId, operationId: "op1", status: "completed" }); result = { session: session(), operation: f.operations[0] }; }
        else if (url.endsWith("/files") && method === "POST") { const file = { id: "f1", clientRequestId: payload.clientRequestId, fileName: payload.fileName, mimeType: payload.mimeType, sizeBytes: 6, sha256: "a".repeat(64), direction: "input", manifest: { source: "fixture" } }; f.files.push(file); result = { file }; }
        else if (/\/sessions\/s1$/.test(url)) result = { session: session(), operations: f.operations, files: f.files, controlRequests: f.controls };
        else if (/\/sessions\/s2$/.test(url)) result = { session: f.sessions.find(item => item.id === "s2"), operations: f.s2Operations || [], files: [] };
        else throw Error("unexpected path " + url);
        save(); return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
      };
    });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const documentUrl = pathToFileURL(path.join(directory, "index.html")).href;
    await page.goto(documentUrl);
    await page.getByText("技能与本轮数据范围", { exact: false }).click();
    await page.getByLabel("来源核查", { exact: false }).check();
    assert.equal(await page.getByLabel("未部署技能", { exact: false }).isDisabled(), true);
    await page.getByLabel("平台", { exact: true }).fill("京东");
    await page.getByRole("button", { name: "＋ 新建环境" }).click();
    await page.getByRole("heading", { name: "来源分析" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({ name: "source.txt", mimeType: "text/plain", buffer: Buffer.from("source") });
    await page.getByRole("link", { name: "source.txt" }).waitFor();
    assert.match(await page.getByRole("link", { name: "source.txt" }).getAttribute("href"), /\/pi\/files\/f1\/content$/);
    await page.evaluate(() => { window.fixture.rejectNextMessage = true; });
    await page.getByLabel("任务", { exact: true }).fill("拒绝夹具");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-pi-v1:fixture@example.invalid:pending")).length === 0);
    await page.getByLabel("任务", { exact: true }).fill("/skill:source-audit 核对来源");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.getByRole("article").getByText("/skill:source-audit 核对来源", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "发送任务", exact: true }).isDisabled(), true);
    const sent = await page.evaluate(() => window.fixture.calls.filter(call => call.url.endsWith("/messages") && call.payload.message !== "拒绝夹具"));
    assert.equal(sent.length, 1); assert.deepEqual(sent[0].payload.skillIds, ["source-audit"]); assert.equal(sent[0].payload.scope, undefined); assert.deepEqual(sent[0].payload.fileIds, ["f1"]);
    assert.deepEqual((await page.evaluate(() => window.fixture.calls.find(call => call.url.endsWith("/sessions") && call.method === "POST"))).payload.scope.platforms, ["京东"]);
    await page.reload();
    await page.getByRole("article").getByText("/skill:source-audit 核对来源", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.filter(call => call.method !== "GET")), []);
    await page.evaluate(() => { window.fixture.operations[0].skills = [{ id: "source-audit", version: "1.0.0", sha256: "a".repeat(64) }]; window.fixture.operations[0].skillsLoaded = true; });
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.getByText("本轮技能已加载：source-audit v1.0.0", { exact: true }).waitFor();
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await page.waitForFunction(() => window.fixture.controls.length === 1);
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-pi-v1:fixture@example.invalid:pending")).length === 0);
    await page.getByText("技能与本轮数据范围", { exact: false }).click();
    await page.getByLabel("精确店铺名称", { exact: true }).fill("合成旗舰店");
    await page.getByText("本轮仅该店：京东 / 合成旗舰店", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "上传附件（≤512 KiB）" }).isDisabled(), true);
    await page.getByLabel("任务", { exact: true }).fill("接下来只看这家店");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.getByText("仅该店：京东 / 合成旗舰店", { exact: true }).waitFor();
    const next = await page.evaluate(() => window.fixture.calls.filter(call => call.url.endsWith("/messages")).at(-1).payload);
    assert.deepEqual(next.shopSelection, { platform: "京东", shop: "合成旗舰店" });
    assert.equal(next.scope, undefined);
    assert.equal(await page.getByRole("article").getByText("/skill:source-audit 核对来源", { exact: true }).count(), 0);
    await page.evaluate(() => { window.fixture.operations[0].status = "unknown"; window.fixture.operations[0].errorCode = "invalid_provider_response"; });
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.getByRole("alert").filter({ hasText: "模型响应校验失败，执行已暂停。" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "发送任务", exact: true }).isDisabled(), true);
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "模型响应校验失败，执行已暂停。" }).waitFor();
    await page.evaluate(() => { window.fixture.frozen = true; window.fixture.operations = []; });
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.getByText("当前环境因权限变化或未知结果被冻结", { exact: false }).waitFor();
    assert.equal(await page.getByRole("article").count(), 0);
    assert.equal(await page.getByRole("button", { name: "发送任务", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "＋ 新建环境" }).isEnabled(), true);
    await page.getByRole("button", { name: "＋ 新建环境" }).click();
    const recoveredCreate = await page.evaluate(() => window.fixture.calls.filter(call => call.url.endsWith("/sessions") && call.method === "POST").at(-1).payload);
    assert.equal(recoveredCreate.scope, undefined);
    assert.equal(recoveredCreate.shopSelection, undefined);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-pi-v1:fixture@example.invalid:pending")).every(item => item.kind !== "create"));
    await page.evaluate(() => { window.fixture.frozen = false; window.fixture.deferS1 = true; window.fixture.sessions.push({ id: "s2", title: "新授权环境", status: "ready", epoch: 1, generation: 1, scope: null }); });
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.waitForFunction(() => typeof window.releasePi === "function");
    await page.getByRole("button", { name: /新授权环境/ }).click();
    await page.getByRole("heading", { name: "新授权环境" }).waitFor();
    await page.evaluate(() => window.releasePi());
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole("heading", { name: "新授权环境" }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "迟到旧环境" }).count(), 0);
    await page.evaluate(() => { window.fixture.s2Operations = [{ id: "old-model-op", kind: "prompt", status: "succeeded", modelId: "retired-model", skills: [] }]; sessionStorage.setItem("server", JSON.stringify(window.fixture)); });
    await page.reload();
    await page.getByText("本环境上次使用的模型已不可用，请重新选择。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.waitForFunction(() => window.fixture.calls.filter(call => call.url.endsWith("/skills")).length >= 2);
    await page.waitForTimeout(100);
    await page.getByLabel("任务", { exact: true }).fill("需要重新选择模型的任务");
    assert.equal(await page.getByRole("button", { name: "发送任务", exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
