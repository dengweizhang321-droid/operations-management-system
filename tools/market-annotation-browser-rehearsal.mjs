import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const folder = resolve(".runtime/annotation-browser");
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, "entry.tsx"), 'import React from "react"; import { createRoot } from "react-dom/client"; import View from "../../app/market-annotation-view"; createRoot(document.getElementById("root")!).render(<View currentUser={{email:"fixture@example.invalid",role:"admin"}}/>);');
await build({ entryPoints: [resolve(folder, "entry.tsx")], bundle: true, outfile: resolve(folder, "bundle.js"), alias: { "@": resolve(".") }, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const server = createServer(async (request, response) => {
  const file = request.url === "/bundle.js" ? resolve(folder, "bundle.js") : request.url === "/style.css" ? resolve("app/globals.css") : null;
  response.setHeader("Content-Type", file ? request.url.endsWith(".css") ? "text/css" : "application/javascript" : "text/html");
  response.end(file ? await readFile(file) : '<html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const job = { id: "synthetic-job", category: "合成类目", promptVersionId: "prompt", executor: "cloud", modelId: "model", localModelName: "", status: "running", totalCount: 23, completedCount: 5, failedCount: 1, reviewedCount: 0, committedCount: 0, remainingInferenceCount: 17, createdAt: "2026-10-14T00:00:00Z" };
const run = { jobId: job.id, state: "paused", runConcurrency: 12, targetConcurrency: 12, recovering: false, nextRunAt: null, lastFailureCode: "inference_result_unknown", lastFailureMessage: "合成未知结果已隔离", lastStartedAt: null, lastHeartbeatAt: null, completedAt: null, updatedAt: "2026-10-14T00:00:00Z" };
const item = { id: "b", candidateId: "b", jobId: job.id, category: job.category, skuCode: "1234567", productName: "合成商品", brand: "Fixture", sourceImageUrl: "", resolvedImageUrl: "", imageSource: "none", status: "review_pending", classificationStatus: "completed", priceStatus: "no_price", aiSegment: "固定分类", aiImagePriceCents: null, aiConfidenceBps: 9500, aiReason: "完整清晰主图明确无标价", modelInputBytes: 20, imageLoadMs: 1, imagePrepareMs: 1, modelCallMs: 5, totalInferenceMs: 7, reviewedSegment: "固定分类", reviewedImagePriceCents: null, reviewedPriceType: "明确无标价", reviewPriceSource: "ai", reviewJobReady: true, reviewSegments: ["固定分类"], snapshotValid: true, selected: false, version: 1, errorMessage: "", createdAt: job.createdAt };
const review = { items: [item], itemPagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 }, reviewSummary: { jobCount: 1, recordCount: 1, uniqueCandidateCount: 1 }, selection: { filteredReviewableCount: 1, filteredSelectedCount: 0, scopeSelectedCount: 0, staleSelectedCount: 0 } };
const workspace = { categories: [{ value: job.category, count: 23, candidateCount: 17 }], reviewCategories: [{ value: job.category, jobCount: 1, recordCount: 1 }], taxonomy: [{ category: job.category, value: "固定分类" }], prompts: [{ id: "prompt", category: job.category, version: 1, status: "active", segments: ["固定分类"], promptBody: "合成 Prompt", metrics: {} }], jobs: [job], concurrencySettings: [{ category: job.category, executor: "cloud", concurrency: 12 }], cloudRuns: [run], ...review, models: [{ id: "model", name: "合成模型", protocol: "openai", modelName: "no-real-model" }], textModels: [], validationRuns: [], validationResults: [], agents: [] };
let activeClaims = 0, rejectResume = false;
const writes = [];
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname !== "/api/market/annotations") return route.continue();
  let result;
  if (route.request().method() === "POST") {
    const command = route.request().postDataJSON();
    writes.push(command.action);
    if (command.action === "set_cloud_run_state") {
      run.state = rejectResume ? "paused" : command.state;
      if (!rejectResume) { run.lastFailureCode = ""; run.lastFailureMessage = ""; }
      result = { ...run, resumeAccepted: !rejectResume && command.state === "running" };
    } else if (command.action === "set_concurrency") result = { ...command };
    else if (command.action === "review") { item.version++; item.selected = command.updates[0].selected; result = { changed: 1 }; }
    else if (command.action === "select_filtered") { item.selected = command.selected; review.selection.scopeSelectedCount = command.selected ? 1 : 0; review.selection.filteredSelectedCount = review.selection.scopeSelectedCount; result = { selectedCount: review.selection.scopeSelectedCount }; }
    else if (command.action === "commit_selected") { result = { committed: 1, hasMore: false }; item.status = "committed"; item.selected = false; review.selection.scopeSelectedCount = 0; }
    else throw new Error(`Unexpected write ${command.action}`);
    return route.fulfill({ json: { ok: true, result } });
  }
  const view = url.searchParams.get("view");
  if (view === "progress") result = { job, activeClaims, uniqueInferenceUnits: 23, remainingInferenceUnits: 17, cloudRun: run, queues: { A: { pending: 3, processing: activeClaims ? 3 : 0, completed: 0, exception: 1 }, B: { pending: 11, processing: activeClaims ? 9 : 0, completed: 5, exception: 0 } }, historyReusedUnits: 2, modelCompletedUnits: 3, newCompletedLastMinute: 3, performance: { measuredCount: 0 } };
  else if (view === "candidate_counts") result = { categories: workspace.categories };
  else if (view === "review") result = review;
  else result = workspace;
  return route.fulfill({ json: result });
});
const check = async (text) => { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" }); };
try {
  await page.goto(origin);
  await check("A · 分类与价格：待处理 3");
  await check("B · 仅补价格（分类已完成）");
  await check("结果待核验（已暂停）");
  await check("分类：已完成 · 价格：明确无标价");
  await page.getByRole("button", { name: "开始/恢复云端后台识别（并发 12）", exact: true }).click();
  await check("恢复请求已接受，等待后台派发");
  await check("云端后台：等待派发");
  activeClaims = 12;
  await check("正在处理 12 张（目标 12）");
  await check("实际执行 12 · 最近每分钟新完成 3");
  const summary = page.locator(".annotation-current-run");
  await summary.scrollIntoViewIfNeeded();
  await summary.screenshot({ path: resolve(folder, "queue-progress.png") });
  await page.getByRole("button", { name: "完成当前条后暂停", exact: true }).click();
  await check("已请求暂停");
  rejectResume = true;
  run.lastFailureCode = "inference_result_unknown";
  run.lastFailureMessage = "合成未知结果已隔离";
  await page.getByRole("button", { name: "开始/恢复云端后台识别（并发 12）", exact: true }).click();
  await check("恢复未开始：合成未知结果已隔离");
  assert.deepEqual(errors, []);
  assert.ok(writes.every((action) => ["set_cloud_run_state", "set_concurrency"].includes(action)));
  const report = { status: "passed", actualReactComponent: true, syntheticHttp: true, checks: ["paused counts", "separate classification/price", "resume accepted/waiting", "actual active/throughput", "pause", "resume refused/actual state"], productionWrites: 0, realModelCalls: 0, consoleErrors: errors };
  await writeFile(resolve(folder, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
