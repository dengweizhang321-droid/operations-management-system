import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "outputs/backup-retention/ui");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "index.html"), '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/outputs/backup-retention/ui/main.tsx"></script></html>');
await writeFile(resolve(output, "main.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client'; import View from '/app/database-backups'; import '/app/globals.css'; createRoot(document.getElementById('root')).render(<main style={{padding:24}}><p>合成备份界面验证 · 不连接生产</p><View canManage={!location.search.includes('viewer')}/></main>);`);
const server = await createServer({ configFile: false, root, plugins: [react()], cacheDir: resolve(output, "vite-cache"),
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client"] }, resolve: { alias: { "@": root } }, server: { host: "127.0.0.1", port: 3109, strictPort: true } });
const backupId = "daily-20260928T010203Z-aaaaaaaaaaaa";
const snapshot = { enabled: true, items: [{ backupId, completedAt: "2026-09-28T01:02:04Z", sizeBytes: 256 * 1024, manifestSha256: "a".repeat(64), protected: true }],
  jobs: [], uploads: [], invalidBackupIds: [], uploadChunkBytes: 128 * 1024, maximumArchiveBytes: 8 * 1024 ** 3 };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let browser, failJob = true;
const requests = [], checks = [], errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3109") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    assert.equal(url.pathname, "/api/access-control/backups");
    if (route.request().method() === "GET") return route.fulfill({ json: snapshot });
    const payload = route.request().postDataJSON(); requests.push(payload);
    if (payload.operation === "job") {
      if (failJob) { failJob = false; return route.fulfill({ status: 503, json: { error: "合成响应中断" } }); }
      snapshot.jobs.unshift({ id: payload.id, action: payload.action, status: "completed", createdAt: Date.now() / 1000, result: { uploadId: payload.target } });
      return route.fulfill({ json: { job: snapshot.jobs[0] } });
    }
    if (payload.operation === "upload-start") return route.fulfill({ json: { id: payload.id, offset: 0 } });
    if (payload.operation === "upload-chunk") {
      const bytes = Buffer.from(payload.data, "base64"); assert.equal(hash(bytes), payload.sha256); assert.ok(bytes.length <= snapshot.uploadChunkBytes);
      return route.fulfill({ json: { offset: payload.offset + bytes.length } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("http://127.0.0.1:3109/outputs/backup-retention/ui/index.html");
  await page.getByRole("button", { name: "立即备份", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "合成响应中断" }).waitFor();
  await page.getByRole("button", { name: "核对原请求" }).click();
  await page.getByText("创建备份 · 已完成", { exact: true }).waitFor();
  assert.equal(requests[0].id, requests[1].id); checks.push("ambiguous-job-response-reuses-id");
  await page.getByLabel("选择数据库备份包").setInputFiles({ name: "synthetic-backup.zip", mimeType: "application/zip", buffer: Buffer.alloc(300000, 42) });
  assert.equal(await page.getByRole("button", { name: "上传并校验", exact: true }).isEnabled(), false);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "上传并校验", exact: true }).click();
  await page.getByText("导入校验 · 已完成", { exact: true }).waitFor();
  const chunks = requests.filter(item => item.operation === "upload-chunk");
  assert.deepEqual(chunks.map(item => item.offset), [0, 131072, 262144]); checks.push("bounded-upload-checksums-and-offsets");
  assert.equal(await page.getByRole("button", { name: "隔离恢复验证", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "恢复生产", exact: true }).count(), 0); checks.push("restore-is-separate-from-upload");
  await page.screenshot({ path: resolve(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "mobile.png"), fullPage: true });
  await page.goto("http://127.0.0.1:3109/outputs/backup-retention/ui/index.html?viewer");
  await page.getByText("仅管理员可管理数据库备份", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "立即备份" }).count(), 0); checks.push("non-admin-has-no-actions");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ status: "passed", checks, requests: requests.length, errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", checks, output }));
} finally { await browser?.close(); await server.close(); }
