import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { unifiedFixture } from "./jackyun-unified-recovery";
import { runJackyunExportFirstAction } from "../../tools/jackyun-export-first-pipeline";
import { appendRecoveryControl, controlDigest, readRecoveryControl } from "../../lib/jackyun/recovery-control";
import { inspectFreshRestart, type FreshRestartTarget } from "../../lib/jackyun/fresh-restart";
import { jackyunModuleOrder } from "../../lib/jackyun/post-download";
import type { HumanRetryAuthority } from "../../lib/jackyun/human-retry";

export async function freshRestartFixture(t: { after: (callback: () => void) => void }, options: Parameters<typeof unifiedFixture>[1] = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-fresh-")), f = await unifiedFixture(root, options);
  const originalFetch = globalThis.fetch;
  let reject = true, mode: "ready" | "uploading" | "processing" | "unknown" | "scope" = "ready", posts = 0;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST") posts++;
    if (reject && url.pathname === "/api/imports/inventory/chunks" && init?.method === "POST" && JSON.parse(String(init.body)).action === "complete") {
      return Response.json({ ok: false, status: "rejected", message: "synthetic controlled warehouse rejection" }, { status: 400 });
    }
    const response = await f.request(input, init);
    if (url.pathname === "/api/imports/recovery" && url.searchParams.get("recovery") === "result") {
      const result = await response.json();
      if (url.searchParams.get("module") === "inventory") {
        if (mode === "unknown") return Response.json({ ...result, status: "unknown" });
        if (mode === "scope") return Response.json({ ...result, scope: { dataset: "stock", snapshotDate: "2020-01-01" } });
        return Response.json({ ...result, uploadStatus: mode });
      }
      return Response.json(result);
    }
    return response;
  };
  globalThis.fetch = request; t.after(() => { globalThis.fetch = originalFetch; });
  f.deps.request = request;
  const run = (action: string, execution = "9000") => runJackyunExportFirstAction(action, execution, f.deps);
  await run("plan-api"); await run("export-all"); await run("validate");
  await assert.rejects(run("import"), /synthetic controlled warehouse rejection/);
  const pipeline = path.join(root, "outputs/jackyun-export-first"), source = path.join(root, "outputs/jackyun-import-runs/n8n-export-first-9000");
  const plan = JSON.parse(await readFile(path.join(pipeline, "n8n-export-first-9000.json"), "utf8"));
  const controller = { version: 2, runId: plan.runId, transport: plan.exportTransport, runDate: plan.runDate, asOfDate: plan.asOfDate,
    salesStartDate: plan.salesStartDate, templateSha256: "c".repeat(64), modules: {} as Record<string, unknown> };
  for (const m of jackyunModuleOrder) {
    const file = path.join(root, "outputs/jackyun-browser-events", plan.runId, `${String(jackyunModuleOrder.indexOf(m) + 1).padStart(2, "0")}-${m}.json`);
    const h = JSON.parse(await readFile(file, "utf8"));
    controller.modules[m] = { status: "handed_off", handoffSha256: plan.exports[m].handoffSha256, filePath: h.filePath, binding: h.evidence.exportTaskBinding };
  }
  await writeFile(path.join(source, "api-controller-state.json"), JSON.stringify(controller));
  const previous = await readRecoveryControl(root, "9000");
  const control = await appendRecoveryControl(root, { ...previous!.record, decision: "resume", attemptExecutionId: "9001" }, previous!.digest, async () => {});
  const target: FreshRestartTarget = { logicalExecutionId: "9000", failedExecutionId: "9001", sourceExecutionId: "9000",
    sourceDigest: controlDigest(plan), controlDigest: control.digest, activeDigest: controlDigest(JSON.parse(await readFile(path.join(pipeline, "active.json"), "utf8"))) };
  const evidence = {
    source: { executionId: "9000", status: "error", retrySuccessId: null, activeExecutions: 0, lastNode: "D·统一导入运营管理系统", runNodes: ["A·固定采集日和销售日期", "B·接口校验与五表下载", "C·五表完整校验和导入演练", "D·统一导入运营管理系统"],
      requestUrl: "http://127.0.0.1:5791/jackyun/export-first/import", error: "synthetic controlled warehouse rejection" },
    latest: { executionId: "9001", status: "error", retrySuccessId: null, activeExecutions: 0, lastNode: "A·固定采集日和销售日期", runNodes: ["A·固定采集日和销售日期"], error: "JACKYUN_RULES_CHANGED_MANUAL_ACTION" } };
  f.deps.freshRestartEvidence = () => evidence as never;
  const authority = (id = randomUUID()): HumanRetryAuthority => ({ ok: true, version: "jackyun-human-retry-authority-v1", kind: "new", supersedes: target,
    authorizationId: id, workflowId: "J8kY2mQ5vR7sT4pN", createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const setAuthority = (value = authority(), execution = "9002") => { f.deps.humanAuthority = { authority: value, executionId: execution, proofDigest: controlDigest(value) }; return value; };
  setAuthority();
  const inspect = () => inspectFreshRestart(root, target, { request, readEvidence: f.deps.freshRestartEvidence });
  return { root, f, run, pipeline, source, target, evidence, inspect, authority, setAuthority,
    proceed: () => { reject = false; }, mode: (v: typeof mode) => { mode = v; }, posts: () => posts };
}
