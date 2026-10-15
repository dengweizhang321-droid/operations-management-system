import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// Actual React with synthetic same-origin HTTP. No runtime credentials or models.
const folder = resolve(".runtime/market-progress-browser", crypto.randomUUID());
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, "entry.tsx"), `import React from "react"; import {createRoot} from "react-dom/client"; import View from ${JSON.stringify(resolve("app/market-annotation-view.tsx").replaceAll("\\", "/"))}; createRoot(document.getElementById("root")!).render(<View currentUser={{email:"fixture@example.invalid",role:"admin"}}/>);`);
await build({ entryPoints: [resolve(folder, "entry.tsx")], bundle: true, outfile: resolve(folder, "bundle.js"),
  alias: { "@": resolve(".") }, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const server = createServer(async (request, response) => {
  const file = request.url === "/bundle.js" ? resolve(folder, "bundle.js") : request.url === "/style.css" ? resolve("app/globals.css") : null;
  response.setHeader("Content-Type", file ? request.url.endsWith(".css") ? "text/css" : "application/javascript" : "text/html");
  response.end(file ? await readFile(file) : '<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.clock.install();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const job = { id: "job", category: "合成类目", promptVersionId: "prompt", executor: "cloud", modelId: "model", localModelName: "", status: "running", totalCount: 6023, completedCount: 2558, failedCount: 51, reviewedCount: 0, committedCount: 0, remainingInferenceCount: 3464, createdAt: "2026-10-15T00:00:00Z" };
const run = { jobId: job.id, controlVersion: "a".repeat(64), state: "paused", targetConcurrency: 12, runConcurrency: 12, recovering: false,
  nextRunAt: null, lastFailureCode: "", lastFailureMessage: "", lastStartedAt: null, lastHeartbeatAt: null, completedAt: null, updatedAt: null };
const review = { items: [], itemPagination: { page: 1, pageSize: 20, pageCount: 1, total: 0 }, reviewSummary: { jobCount: 1, recordCount: 6023, uniqueCandidateCount: 6023 }, selection: { filteredReviewableCount: 0, filteredSelectedCount: 0, scopeSelectedCount: 0, staleSelectedCount: 0 } };
const workspace = () => ({ categories: [{ value: job.category, count: 6023, candidateCount: 0 }], reviewCategories: [{ value: job.category, jobCount: 1, recordCount: 6023 }],
  taxonomy: [{ category: job.category, value: "合成分类" }], prompts: [{ id: "prompt", category: job.category, version: 1, status: "active", segments: ["合成分类"], promptBody: "合成规则", metrics: {} }],
  jobs: [job], cloudRuns: [run], concurrencySettings: [{ category: job.category, executor: "cloud", concurrency: 12 }], ...review,
  models: [{ id: "model", name: "合成模型", protocol: "openai", modelName: "synthetic" }], textModels: [], validationRuns: [], validationResults: [], agents: [] });
let failLight = "", failAfterControl = false, active = 0, failDetails = false;
let holdNextLight = false, releaseLight, signalHeld;
const heldLight = new Promise((done) => { signalHeld = done; });
const calls = { light: 0, details: 0, review: 0, posts: [] };
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname !== "/api/market/annotations") return route.continue();
  if (route.request().method() === "POST") {
    const c = route.request().postDataJSON(); calls.posts.push(c);
    assert.equal(c.action, "set_cloud_run_state");
    const before = run.controlVersion;
    run.controlVersion = (before.startsWith("a") ? "b" : "c").repeat(64); run.state = c.state;
    if (failAfterControl) failLight = "maintenance_wait";
    return route.fulfill({ json: { ok: true, result: { operationId: c.operationId, requestId: `annotation-control-${c.operationId}`, jobId: job.id, targetState: c.state,
      beforeControlVersion: before, afterControlVersion: run.controlVersion, auditId: "22222222-2222-4222-8222-222222222222", committedAt: new Date().toISOString(),
      effectiveState: run.state, resumeAccepted: c.state === "running", quarantinedExpiredClaims: false } } });
  }
  const view = url.searchParams.get("view");
  if (view === "progress_light") {
    calls.light++;
    if (holdNextLight) {
      holdNextLight = false;
      await new Promise((done) => { releaseLight = done; signalHeld(); });
    }
    if (failLight) return route.fulfill({ status: 503, json: { code: failLight } });
    return route.fulfill({ json: { job, activeClaims: active, cloudRun: run, sampledAt: new Date().toISOString() } });
  }
  if (view === "progress") {
    calls.details++;
    if (failDetails) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: { job, activeClaims: active, cloudRun: run, uniqueInferenceUnits: 6000, remainingInferenceUnits: 3441,
      queues: { A: { pending: 0, processing: 0, completed: 117, exception: 0 }, B: { pending: 3391, processing: 0, completed: 2441, exception: 51 } }, performance: { measuredCount: 0 } } });
  }
  if (view === "review") { calls.review++; return route.fulfill({ json: review }); }
  if (view === "candidate_counts") return route.fulfill({ json: { categories: workspace().categories } });
  return route.fulfill({ json: workspace() });
});
const check = (text) => page.getByText(text, { exact: false }).first().waitFor({ state: "visible" });
try {
  await page.goto(origin);
  await check("控制状态：已暂停"); await check("执行状态：已暂停派发"); await check("读取状态：已读取最新状态");
  await check("唯一推理单元剩余 3441/6000");
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const reviewBaseline = calls.review, detailBaseline = calls.details;
  const previousReadText = await page.getByText("读取状态：", { exact: false }).innerText();
  await page.clock.runFor(16_000);
  await page.waitForFunction((previous) => Array.from(document.querySelectorAll("small")).find((e) => e.textContent.includes("读取状态："))?.textContent !== previous, previousReadText);
  assert.equal(calls.details, detailBaseline); assert.equal(calls.review, reviewBaseline);
  failAfterControl = true;
  holdNextLight = true;
  await page.getByRole("button", { name: "开始/恢复云端后台识别（并发 12）", exact: true }).click();
  await heldLight;
  await page.waitForFunction(() => document.querySelector(".annotation-current-run-actions button")?.textContent?.includes("正在交给云端后台"));
  const slowPreReadCount = calls.light;
  await page.clock.runFor(16_000);
  assert.equal(calls.light, slowPreReadCount, "polling cannot cancel a slow control pre-read");
  assert.equal(calls.posts.length, 0);
  assert.equal(typeof releaseLight, "function"); releaseLight();
  await check("该恢复请求已于"); await check("维护中，暂不派发");
  const warning = "系统正在维护或排空，暂时无法读取最新状态；维护结束后会重新查询。";
  assert.equal(await page.getByText(warning, { exact: true }).count(), 1, "one read failure has one owner");
  assert.equal(calls.posts.length, 1);
  assert.equal(await page.getByRole("button", { name: "开始/恢复云端后台识别（并发 12）", exact: true }).isEnabled(), false);
  failLight = ""; failAfterControl = false; active = 12;
  await page.clock.runFor(16_000);
  await check("执行状态：正在处理 12 张"); await check("控制状态：继续执行");
  assert.equal(await page.getByText(warning, { exact: true }).count(), 0);
  assert.equal(calls.posts.length, 1, "recovery only observes; it never resubmits the command");
  const beforeReview = calls.review;
  job.completedCount += 12; job.remainingInferenceCount -= 12;
  await page.clock.runFor(6_000); await check("已识别 2570/6023 条记录");
  assert.equal(calls.review, beforeReview, "new completions do not reload review");
  assert.equal(calls.details, detailBaseline);
  failDetails = true;
  await page.getByRole("button", { name: "刷新详细统计", exact: true }).click();
  await check("详细统计读取失败");
  await page.clock.runFor(6_000); await check("读取状态：已读取最新状态");
  assert.equal(calls.posts.length, 1);
  await page.getByRole("button", { name: "刷新复核结果", exact: true }).click();
  assert.equal(calls.review, beforeReview + 1);
  await page.locator(".annotation-current-run").screenshot({ path: resolve(folder, "progress-states.png") });
  assert.deepEqual(errors, []);
  const result = { status: "passed", actualReact: true, syntheticHttpOnly: true, checks: ["three states", "paused still reads", "slow control pre-read crosses polling tick", "one maintenance warning", "committed control survives failed GET", "natural read recovery without POST", "light polling independent of review/details", "details failure independent", "manual review refresh"],
    lightReads: calls.light, detailReads: calls.details, reviewReads: calls.review, controlPosts: calls.posts.length, productionWrites: 0, realModelCalls: 0 };
  await writeFile(resolve(folder, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: resolve(folder, "result.json") }));
} catch (error) {
  await writeFile(resolve(folder, "failure.json"), JSON.stringify({ status: "failed", error: String(error), calls, errors, evidence: folder }, null, 2));
  await writeFile(resolve(folder, "failure.html"), await page.content());
  console.error(JSON.stringify({ evidence: resolve(folder, "failure.json") }));
  throw error;
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
