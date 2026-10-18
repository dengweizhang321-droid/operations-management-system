// Opt-in acceptance; HTTP bridge executes the actual thin Worker route adapter.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const out = process.env.PI_E2E_OUT;
const port = Number(process.env.PI_E2E_UI_PORT);
const origin = `http://127.0.0.1:${port}`;
const django = `http://127.0.0.1:${process.env.PI_E2E_DJANGO_PORT}`;
const principal = { email: "pi-e2e@example.invalid", displayName: "隔离验收", role: "admin", roleLabel: "管理员", scope: null };
const boundary = { name: "isolated-principal", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "principal", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const requireAppPrincipal=async()=>(${JSON.stringify(principal)});export const requireUnrestrictedDataScope=()=>{};export const authorizationErrorResponse=()=>null;` }));
} };
const route = await build({ entryPoints: ["lib/ai/django-route.ts"], bundle: true, write: false, platform: "node", format: "esm", external: ["cloudflare:workers"], plugins: [boundary] });
const { forwardAiRequest } = await import(`data:text/javascript;base64,${Buffer.from(route.outputFiles[0].text).toString("base64")}`);
const ui = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Pi from './app/ai-pi-agent-view';createRoot(document.getElementById('root')).render(React.createElement(Pi,{currentUser:${JSON.stringify(principal)}}));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
const calls = [];
let dropNextMessage = true;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/ui.js"></script>'); return; }
    if (req.url === "/ui.js") { res.setHeader("content-type", "application/javascript"); res.end(ui.outputFiles[0].text); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(origin + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
    const response = await forwardAiRequest(request);
    const bytes = Buffer.from(await response.arrayBuffer());
    calls.push({ method: req.method, path: req.url, status: response.status, ...(req.url.endsWith('/content') ? { downloadHeaders: Object.fromEntries(response.headers) } : {}), ...(body.length ? { payload: JSON.parse(body) } : {}) });
    if (dropNextMessage && req.method === "POST" && req.url.endsWith("/messages") && response.ok) {
      dropNextMessage = false;
      calls.at(-1).responseDroppedAfterDjangoAcceptance = true;
      // Deliver headers then lose the body: Chrome cannot transparently retry
      // an entirely unobserved connection reset, and application fetch fails.
      res.writeHead(response.status, { "content-type": "application/json", "content-length": bytes.length + 100 });
      res.write("{"); setTimeout(() => res.destroy(), 30); return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes);
  } catch (error) { console.error(error); res.writeHead(500); res.end("fixture failed"); }
});
await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
const snapshot = async () => { const response = await fetch(django + "/__fixture"); assert.equal(response.status, 200); return response.json(); };
async function until(predicate, label, ms = 140000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const state = await snapshot(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw Error(`timeout: ${label} ${JSON.stringify(await snapshot())}`);
}
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PI_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "＋ 新建环境" }).click();
  await page.getByRole("heading", { name: "新对话", exact: true }).waitFor();
  await page.getByText("技能与本轮数据范围", { exact: false }).click();
  await page.getByLabel("excel-report", { exact: false }).check();
  const send = async text => {
    await page.getByLabel("任务", { exact: true }).fill(text);
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
  };
  await send("first:权限内合成销售、库存、推广取数，真实Python生成Excel。");
  let state = await until(s => s.operations.length === 1, "admitted");
  const firstId = state.operations[0].id;
  const requestId = state.operations[0].client_request_id;
  assert.equal(calls.filter(c => c.path.endsWith("/messages")).length, 1);
  assert.equal(calls.find(c => c.path.endsWith("/messages")).responseDroppedAfterDjangoAcceptance, true);
  const refreshStart = calls.length;
  await page.reload();
  state = await until(s => s.operations[0].status === "succeeded", "first completed");
  await page.getByRole("button", { name: "刷新记录" }).click();
  const downloadLink = page.getByRole("link", { name: "report.xlsx", exact: true }).first();
  await downloadLink.waitFor({ timeout: 15000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  await download.saveAs(path.join(out, "download.xlsx"));
  assert.equal(download.suggestedFilename(), "report.xlsx");
  assert.ok((await readFile(path.join(out, "download.xlsx"))).length > 1000);
  assert.deepEqual(calls.slice(refreshStart).filter(c => c.method !== "GET"), []);
  assert.equal(state.operations.filter(o => o.client_request_id === requestId).length, 1);
  assert.equal(state.dispatches.filter(d => d.operation_id === firstId && d.kind === "runner:prompt").length, 1);
  const postsBeforeReadOnlyRecovery = state.providerPosts;
  await page.reload();
  await page.getByRole("button", { name: "刷新记录" }).click();
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal((await snapshot()).providerPosts, postsBeforeReadOnlyRecovery);
  const original = calls.find(c => c.path.endsWith("/messages"));
  const replayResponse = await fetch(origin + original.path, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(original.payload) });
  assert.equal(replayResponse.status, 202);
  const replay = await replayResponse.json();
  assert.equal(replay.operation.id, firstId);
  assert.equal(replay.replayed, true);
  const afterReplay = await snapshot();
  assert.equal(afterReplay.providerPosts, postsBeforeReadOnlyRecovery);
  assert.equal(afterReplay.operations.length, 1);
  assert.equal(afterReplay.dispatches.filter(d => d.operation_id === firstId && d.kind === "runner:prompt").length, 1);
  await send("continue:同会话读取上轮context-marker.txt，禁止重新取数。");
  state = await until(s => s.operations.length === 2 && s.operations[1].status === "succeeded", "same-generation continuation");
  assert.deepEqual(state.operations.slice(0, 2).map(o => [o.session_id, o.epoch, o.generation]), [0, 1].map(() => [state.operations[0].session_id, state.operations[0].epoch, state.operations[0].generation]));
  await page.getByRole("button", { name: "刷新记录" }).click();
  await page.getByRole("article").getByText("已接着同一 Pi 会话读取上一轮文件。合成验收。", { exact: true }).waitFor();
  await send("stop:执行可确定停止的本地等待，随后继续原会话读取旧文件。");
  await until(s => s.stopStarted && s.operations[2]?.status === "running", "stop run active");
  await page.getByRole("button", { name: "刷新记录" }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  state = await until(s => s.operations[2]?.status === "canceled", "known stop terminal");
  await page.getByRole("button", { name: "刷新记录" }).click();
  await send("continue:停止旧轮后开启新一轮，读取之前context-marker.txt。");
  state = await until(s => s.operations.length === 4 && s.operations[3].status === "succeeded", "after-stop file continuation");
  assert.equal(new Set(state.operations.map(o => `${o.session_id}/${o.epoch}/${o.generation}`)).size, 1);
  await page.getByRole("button", { name: "刷新记录" }).click();
  await send("unknown:合成供应商已受理后响应未知，保持原操作围栏。");
  state = await until(s => s.operations.length === 5 && s.operations[4].status === "unknown", "unknown fence");
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "模型响应校验失败" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "发送任务", exact: true }).isDisabled(), true);
  const postsAtUnknown = state.providerPosts;
  await page.getByRole("button", { name: "刷新记录" }).click();
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal((await snapshot()).providerPosts, postsAtUnknown);
  assert.equal(calls.filter(c => c.method === "POST" && c.path.endsWith("/messages")).length, 6);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(out, "unknown-fence.png"), fullPage: true });
  await writeFile(path.join(out, "browser-evidence.json"), JSON.stringify({ passed: true, calls, firstRequestId: requestId, sameRequestReplay: { operationId: replay.operation.id, replayed: replay.replayed, providerPostsUnchanged: true }, postsBeforeReadOnlyRecovery, postsAtUnknown, final: state, actualDownload: true, actualReactComponent: true, actualWorkerRouteAdapter: true, workerRuntime: "Node HTTP harness, not workerd", principalBoundarySynthetic: true }, null, 2));
  await context.close();
} finally {
  await writeFile(path.join(out, "http-calls.json"), JSON.stringify(calls, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
