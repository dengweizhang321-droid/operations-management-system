// Actual React UI with synthetic HTTP only; never connect to application services.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = process.cwd();
const directory = path.resolve(root, ".runtime/ai-workflow-recommendations-ui");
await fs.mkdir(directory, { recursive: true });
const exported = spawnSync("python", ["-Xutf8", "-c", "import runpy,json,sys; print(json.dumps(runpy.run_path(sys.argv[1])['PRESETS'],ensure_ascii=False))", path.join(root, "backend/ai_assistant/workflow_presets.py")], { encoding: "utf8" });
assert.equal(exported.status, 0, exported.stderr);
const presets = JSON.parse(exported.stdout);
const fixture = { version: 0, config: { skills: [], templates: [], pipelines: [] } };
const requests = [], runs = [], checks = [], errors = [];
let writeDelay = 0, rejectSave = false;
function recommendations() {
  return presets.map(preset => { const item = { ...preset }; delete item.bundle; return ({ ...item,
    installed: fixture.config.pipelines.some(p => p.id === item.pipelineId), conflict: false }); });
}
function detail(item) {
  return { item, snapshot: {}, delivery: null, contentError: "空跑只校验流程，不生成报告",
    workflow: { id: item.workflowId, status: item.status, version: 1, retryable: false,
      nodes: ["collect", "report", "review"].map(key => ({ id: key, key, type: key === "review" ? "human_review" : "agent", status: "skipped", version: 1, instruction: "合成演示" })) } };
}
const entry = path.join(directory, "entry.tsx");
await fs.writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import Workbench from ${JSON.stringify(path.join(root, "app/ai-report-workbench-view.tsx"))};import ${JSON.stringify(path.join(root, "app/globals.css"))};createRoot(document.getElementById('root')!).render(<Workbench kind="pipelines"/>);`);
await build({ entryPoints: [entry], bundle: true, outfile: path.join(directory, "app.js"), format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent", alias: { tailwindcss: path.join(root, "node_modules/tailwindcss/index.css") }, define: { "process.env.NODE_ENV": '"production"' }, tsconfig: path.join(root, "tsconfig.json") });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const send = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8"), body = raw ? JSON.parse(raw) : null;
      requests.push({ path: url.pathname, method: req.method, body });
      if (url.pathname === "/api/ai/report-library") {
        if (req.method === "GET") return send({ item: fixture, recommended: recommendations(), history: [], hasMore: false });
        if (writeDelay) { const delay = writeDelay; writeDelay = 0; await new Promise(resolve => setTimeout(resolve, delay)); }
        if (body.expectedVersion !== fixture.version || rejectSave) { rejectSave = false; return send({ error: "资源库已更新，请重新加载后保存" }, 409); }
        if (body.installRecommendation) {
          const preset = presets.find(p => p.id === body.installRecommendation); assert.ok(preset);
          for (const kind of Object.keys(preset.bundle)) fixture.config[kind].push(...structuredClone(preset.bundle[kind]));
          fixture.version++;
          return send({ item: fixture, pipelineId: preset.pipelineId });
        }
        assert.ok(["skills", "templates", "pipelines"].includes(body.kind));
        const index = fixture.config[body.kind].findIndex(i => i.id === body.item.id); assert.ok(index >= 0);
        fixture.config[body.kind][index] = body.item; fixture.version++;
        return send({ item: fixture });
      }
      if (url.pathname === "/api/ai/business-evidence") return send({ items: [], principalKey: "a".repeat(64), pagination: { page: 1, pageSize: 10, total: 0, hasMore: false } });
      if (url.pathname === "/api/ai/reports") {
        if (req.method === "GET") return send({ items: runs, total: runs.length });
        const pipeline = fixture.config.pipelines.find(p => p.id === body.pipelineId); assert.ok(pipeline);
        const item = { id: `synthetic-${runs.length + 1}`, name: pipeline.name, status: "completed", dryRun: body.dryRun, workflowId: "synthetic-workflow", version: fixture.version, createdAt: "2026-10-09T04:00:00Z", template: pipeline.name, skills: ["合成方法"], scope: body.scope };
        runs.push(item); return send({ item });
      }
      if (url.pathname.startsWith("/api/ai/reports/")) return send(detail(runs.find(i => i.id === url.pathname.split("/").at(-1))));
      return send({ error: "未知合成接口" }, 404);
    }
    if (url.pathname === "/app.js" || url.pathname === "/app.css") {
      res.setHeader("content-type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
      res.end(await fs.readFile(path.join(directory, url.pathname.slice(1)))); return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main style="padding:24px;max-width:1440px;margin:auto"><p>隔离验收 · 合成数据</p><div id="root"></div></main><script src="/app.js"></script></body></html>');
  } catch (error) { errors.push(String(error)); res.writeHead(500); res.end("synthetic verification failure"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", error => errors.push(String(error)));
await page.route("**/*", route => route.request().url().startsWith(address + "/") ? route.continue() : route.abort());
const count = (pathname) => requests.filter(r => r.path === pathname && r.method === "POST").length;
async function check(name, fn) { await fn(); checks.push(name); }
try {
  await page.goto(address); await page.getByRole("region", { name: "推荐运营工作流" }).waitFor();
  await check("six_recommendations_are_read_only_on_load", async () => {
    assert.equal(await page.locator(".report-recommendation").count(), 6);
    assert.equal(count("/api/ai/report-library"), 0); assert.equal(count("/api/ai/reports"), 0);
    await page.screenshot({ path: path.join(directory, "recommended-desktop.png"), fullPage: true });
  });
  await check("install_once_and_open_real_scope_form", async () => {
    writeDelay = 300;
    const button = page.getByRole("button", { name: "添加并配置 " + presets[0].name, exact: true });
    await button.evaluate(el => { el.click(); el.click(); });
    await page.getByRole("heading", { name: presets[0].name + " · 运行范围", exact: true }).waitFor();
    assert.equal(count("/api/ai/report-library"), 1); assert.equal(count("/api/ai/reports"), 0);
    assert.equal(fixture.version, 1);
    assert.notEqual(await page.getByLabel("开始日期（含）", { exact: true }).inputValue(), "");
  });
  await check("related_template_edit_is_versioned_and_persists", async () => {
    await page.getByRole("button", { name: "编辑报告模板", exact: true }).click();
    const editor = page.getByRole("region", { name: "资源编辑器" });
    const input = editor.getByLabel("取数步骤", { exact: false });
    await input.fill((await input.inputValue()) + "合成验收追加要求。");
    await editor.getByRole("button", { name: "保存为新版本", exact: false }).click();
    await page.getByText("已保存新版本；正在运行的任务继续使用原版本。", { exact: true }).waitFor();
    assert.equal(fixture.version, 2); assert.ok(fixture.config.templates[0].dataSteps.endsWith("合成验收追加要求。"));
    await page.reload(); await page.getByRole("button", { name: "配置 " + presets[0].name, exact: true }).click();
    await page.getByText("合成验收追加要求。", { exact: false }).waitFor();
  });
  await check("dry_run_payload_and_history_do_not_invoke_formal_run", async () => {
    await page.getByLabel("精确店铺名称", { exact: true }).fill("合成店铺");
    await page.getByRole("button", { name: "空跑（不调用模型）", exact: true }).click();
    await page.locator(".report-detail").waitFor();
    const request = requests.find(r => r.path === "/api/ai/reports" && r.method === "POST");
    assert.equal(request.body.dryRun, true); assert.equal(request.body.expectedVersion, 2);
    assert.equal(request.body.scope.shop, "合成店铺"); assert.ok(request.body.clientRequestId);
    assert.equal(count("/api/ai/reports"), 1);
    assert.equal(requests.filter(r => /send|channels/.test(r.path)).length, 0);
  });
  await check("conflict_retains_unsaved_configuration", async () => {
    await page.getByRole("button", { name: "配置 " + presets[0].name, exact: true }).click();
    await page.getByRole("button", { name: "编辑报告模板", exact: true }).click();
    const editor = page.getByRole("region", { name: "资源编辑器" });
    await editor.getByLabel("名称", { exact: true }).fill("保留未保存的修改"); rejectSave = true;
    await editor.getByRole("button", { name: "保存为新版本", exact: false }).click();
    await page.getByRole("alert").filter({ hasText: "资源库已更新" }).waitFor();
    assert.equal(await editor.getByLabel("名称", { exact: true }).inputValue(), "保留未保存的修改");
    assert.equal(fixture.version, 2);
  });
  await check("refresh_rebinds_current_configuration_and_disabled_state", async () => {
    await page.getByRole("region", { name: "资源编辑器" }).getByRole("button", { name: "关闭", exact: true }).click();
    const oldTemplate = fixture.config.templates[0];
    fixture.config.templates.push({ ...structuredClone(oldTemplate), id: "external-template", name: "外部更新的模板", dataSteps: "刷新后必须显示的新取数要求" });
    fixture.config.pipelines[0].templateId = "external-template";
    fixture.config.pipelines[0].enabled = false; fixture.version++;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByText("刷新后必须显示的新取数要求", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "空跑（不调用模型）", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "开始分析（调用模型）", exact: true }).isDisabled(), true);
    fixture.config.pipelines[0].enabled = true; fixture.version++;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "开始分析（调用模型）" && !b.disabled));
  });
  await check("formal_launch_uses_explicit_button_and_current_version", async () => {
    await page.getByLabel("精确店铺名称", { exact: true }).fill("合成店铺");
    await page.getByRole("region", { name: "工作流运行配置" }).getByRole("button", { name: "近7天", exact: true }).click();
    const start = await page.getByLabel("开始日期（含）", { exact: true }).inputValue();
    const end = await page.getByLabel("结束日期（含）", { exact: true }).inputValue();
    assert.equal((Date.parse(end) - Date.parse(start)) / 86400000, 6);
    await page.getByRole("button", { name: "开始分析（调用模型）", exact: true }).click();
    await page.locator(".report-detail").getByText("synthetic-2", { exact: false }).waitFor();
    const request = requests.filter(r => r.path === "/api/ai/reports" && r.method === "POST").at(-1);
    assert.equal(request.body.dryRun, false); assert.equal(request.body.expectedVersion, 4);
    assert.equal(request.body.scope.startDate, start); assert.equal(request.body.scope.endDate, end);
    assert.equal(count("/api/ai/reports"), 2);
    assert.equal(requests.filter(r => /send|channels/.test(r.path)).length, 0);
  });
  await check("mobile_layout_and_no_unexpected_browser_errors", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await page.getByRole("region", { name: "推荐运营工作流" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(directory, "recommended-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
  });
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({ checks, errors, requestCount: requests.length, productionRequests: 0 }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, evidence: directory }));
} catch (error) {
  console.error(error);
  await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(directory, "last-result.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
