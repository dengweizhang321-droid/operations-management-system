import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { downloadSignedOssExport } from "../lib/jackyun/oss-download";
import { JackyunDownloadFailure } from "../lib/jackyun/download-failure";

const bytes = Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4]);
const transient = () => Object.assign(new TypeError("fetch failed SECRET signed URL"), { cause: { code: "ECONNRESET" } });
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "oss-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { url: "https://oss.example.invalid/export.xlsx?SECRET=signature", downloadDirectory: root,
    runId: "test-run", module: "inventory" as const, allowedHosts: ["oss.example.invalid"], exportIntentAt: new Date().toISOString() };
}

test("OSS transient GETs reuse exactly the same file, then persist only the complete XLSX", async t => {
  const options = await fixture(t); const urls: string[] = []; const sleeps: number[] = [];
  const result = await downloadSignedOssExport(options, {
    request: async (url, init) => { urls.push(String(url)); assert.equal(init?.redirect, "manual"); if (urls.length < 3) throw transient(); return new Response(bytes); },
    sleep: async ms => { sleeps.push(ms); },
  });
  assert.deepEqual(urls, Array(3).fill(options.url)); assert.deepEqual(sleeps, [2000, 4000]);
  assert.deepEqual(await readFile(result.filePath), bytes);
  assert.equal((await readdir(path.dirname(result.filePath))).length, 1);
  assert.doesNotMatch(JSON.stringify(result.provenance), /SECRET|signature/);
});

test("OSS retry exhaustion has bounded attempts and a sanitized cause", async t => {
  const options = await fixture(t); let attempts = 0;
  await assert.rejects(downloadSignedOssExport(options, { request: async () => { attempts++; throw transient(); }, sleep: async () => {} }),
    error => error instanceof JackyunDownloadFailure && error.retryable && error.code === "ECONNRESET" && error.attempts === 3 && !/SECRET/.test(error.message));
  assert.equal(attempts, 3); assert.deepEqual(await readdir(path.join(options.downloadDirectory, "jackyun/test-run/inventory")), []);
});

test("OSS stream failure discards partial bytes before retrying the same attachment", async t => {
  const options = await fixture(t); let calls = 0;
  const result = await downloadSignedOssExport(options, { request: async () => {
    calls++;
    if (calls > 1) return new Response(bytes);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 5)); controller.error(transient()); } }));
  }, sleep: async () => {} });
  assert.equal(calls, 2); assert.deepEqual(await readFile(result.filePath), bytes);
  assert.equal((await readdir(path.dirname(result.filePath))).length, 1);
});

test("OSS HTTP, TLS and malformed-file terminal failures never retry", async t => {
  for (const kind of ["401", "403", "404", "TLS", "malformed", "unknown"]) {
    const options = await fixture(t); let calls = 0;
    await assert.rejects(downloadSignedOssExport(options, { request: async () => {
      calls++;
      if (kind === "TLS") throw Object.assign(new Error("secret certificate details"), { cause: { code: "CERT_HAS_EXPIRED" } });
      if (kind === "unknown") throw new Error("secret unknown cause");
      return kind === "malformed" ? new Response("not XLSX") : new Response("private response", { status: Number(kind) });
    }, sleep: async () => { assert.fail("terminal failure slept"); } }), error => error instanceof JackyunDownloadFailure && !error.retryable && !/secret|private/i.test(error.message));
    assert.equal(calls, 1, kind);
  }
});

test("OSS 503 retries and redirected targets are validated on every hop", async t => {
  const options = await fixture(t); let calls = 0;
  await downloadSignedOssExport(options, { request: async () => ++calls === 1 ? new Response("busy", { status: 503 }) : new Response(bytes), sleep: async () => {} });
  assert.equal(calls, 2);
  for (const target of ["https://attacker.invalid/a.xlsx", "https://user:pass@oss.example.invalid/a.xlsx", "https://oss.example.invalid:9443/a.xlsx"]) {
    calls = 0;
    await assert.rejects(downloadSignedOssExport(await fixture(t), { request: async () => { calls++; return new Response(null, { status: 302, headers: { Location: target } }); } }),
      error => error instanceof JackyunDownloadFailure && !error.retryable);
    assert.equal(calls, 1);
  }
});

test("OSS deadline includes backoff and prevents starting a late GET", async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(downloadSignedOssExport({ ...options, timeoutMs: 25 }, {
    request: async () => { calls++; throw transient(); },
    sleep: async (ms, signal) => { await setTimeout(ms, undefined, { signal }); },
  }), error => error instanceof JackyunDownloadFailure && error.code === "ETIMEDOUT");
  assert.equal(calls, 1);
});

test("OSS one deadline is shared across redirects and the response body", async t => {
  const options = await fixture(t); const signals: AbortSignal[] = [];
  await assert.rejects(downloadSignedOssExport({ ...options, timeoutMs: 25 }, { request: async (_url, init) => {
    signals.push(init!.signal!);
    if (signals.length === 1) return new Response(null, { status: 302, headers: { Location: "https://oss.example.invalid/next.xlsx" } });
    await setTimeout(100, undefined, { signal: init!.signal! });
    return new Response(bytes);
  } }), error => error instanceof JackyunDownloadFailure && error.code === "ETIMEDOUT");
  assert.equal(signals.length, 2); assert.equal(signals[0], signals[1]);
});

test("OSS body timeout removes the partial file and does not start another request after deadline", async t => {
  const options = await fixture(t); let calls = 0;
  const keepAlive = globalThis.setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  await assert.rejects(downloadSignedOssExport({ ...options, timeoutMs: 25 }, { request: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); } }));
  } }), error => error instanceof JackyunDownloadFailure && error.code === "ETIMEDOUT");
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(path.join(options.downloadDirectory, "jackyun/test-run/inventory")), []);
});

test("an elapsed deadline never promotes a known authorization rejection to a transient failure", async t => {
  const options = await fixture(t); let calls = 0;
  await assert.rejects(downloadSignedOssExport({ ...options, timeoutMs: 5 }, { request: async () => {
    calls++; await setTimeout(20); return new Response(null, { status: 403 });
  } }), error => error instanceof JackyunDownloadFailure && error.code === "HTTP_403" && !error.retryable);
  assert.equal(calls, 1);
});
