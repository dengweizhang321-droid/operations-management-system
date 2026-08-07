import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  finishOperationRun,
  finishOperationStep,
  getOperationMetrics,
  getOperationRunDetails,
  listOperationRuns,
  recordOperationEvent,
  startOperationRun,
  startOperationStep,
  type OperationDatabase,
} from "../lib/operations/runtime";
import { createExternalOperationReporter } from "../lib/operations/reporter";

function databaseFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const database = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as OperationDatabase;
  return { sqlite, database };
}

test("统一运行账本保持 run/step/event 关联、幂等终态和敏感字段边界", async () => {
  const { sqlite, database } = databaseFixture();
  const first = await startOperationRun(database, {
    traceId: "trace-1",
    runType: "test_pipeline",
    surface: "test",
    actorEmail: "admin@example.com",
    platform: "测试平台",
    shopName: "测试店铺",
    dataset: "daily",
    idempotencyKey: "same-attempt",
    scope: { date: "2026-08-06", apiKey: "must-not-persist", nested: { token: "hidden", ok: true } },
  });
  const duplicate = await startOperationRun(database, {
    runType: "test_pipeline",
    surface: "test",
    idempotencyKey: "same-attempt",
  });
  assert.equal(duplicate.id, first.id);
  assert.deepEqual(first.scope, { date: "2026-08-06", nested: { ok: true } });

  const step = await startOperationStep(database, {
    runId: first.id,
    traceId: first.traceId,
    stepType: "download",
    stepKey: "download-report",
    attributes: { fileHash: "a".repeat(64), cookie: "must-not-persist" },
  });
  const duplicateStep = await startOperationStep(database, {
    runId: first.id,
    traceId: first.traceId,
    stepType: "download",
    stepKey: "download-report",
  });
  assert.equal(duplicateStep.id, step.id);
  assert.deepEqual(step.attributes, { fileHash: "a".repeat(64) });

  await recordOperationEvent(database, {
    runId: first.id,
    stepId: step.id,
    traceId: first.traceId,
    spanId: step.spanId,
    eventType: "download.verified",
    attributes: { rows: 12, authorization: "Bearer hidden" },
  });
  const completedStep = await finishOperationStep(database, {
    stepId: step.id,
    status: "succeeded",
    result: { rows: 12 },
  });
  assert.equal(completedStep.status, "succeeded");
  await finishOperationStep(database, { stepId: step.id, status: "failed", errorCode: "late_failure" });
  assert.equal((await getOperationRunDetails(database, first.id)).steps[0].status, "succeeded");

  const completed = await finishOperationRun(database, {
    runId: first.id,
    status: "succeeded",
    summary: { imported: 12 },
  });
  assert.equal(completed.status, "succeeded");
  await finishOperationRun(database, { runId: first.id, status: "failed", errorCode: "late_failure" });

  const details = await getOperationRunDetails(database, first.id);
  assert.equal(details.run.status, "succeeded");
  assert.ok(details.events.some((event) => event.eventType === "run.started"));
  assert.ok(details.events.some((event) => event.eventType === "download.verified"));
  assert.ok(details.events.some((event) => event.eventType === "run.succeeded"));
  assert.equal(JSON.stringify(details).includes("Bearer hidden"), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM operation_events WHERE event_type='run.succeeded'").get()?.count, 1);
  sqlite.close();
});

test("运行列表和指标查询有硬上限并提供成功率与 P95", async () => {
  const { sqlite, database } = databaseFixture();
  for (let index = 0; index < 5; index += 1) {
    const run = await startOperationRun(database, {
      runType: index < 4 ? "metric_pipeline" : "other_pipeline",
      surface: "test",
      idempotencyKey: `metric-${index}`,
    });
    sqlite.prepare("UPDATE operation_runs SET started_at=datetime('now', ?) WHERE id=?")
      .run(`-${index + 1} seconds`, run.id);
    await finishOperationRun(database, {
      runId: run.id,
      status: index === 2 ? "failed" : "succeeded",
      errorCode: index === 2 ? "TEST_FAILURE" : "",
    });
  }
  const list = await listOperationRuns(database, { runType: "metric_pipeline", limit: 2 });
  assert.equal(list.returned, 2);
  assert.equal(list.truncated, true);
  const metrics = await getOperationMetrics(database, { runType: "metric_pipeline" });
  assert.equal(metrics.sampleSize, 4);
  assert.equal(metrics.succeeded, 3);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.successRate, 0.75);
  assert.ok((metrics.durationMs.p95 ?? 0) >= (metrics.durationMs.p50 ?? 0));
  sqlite.close();
});

test("0057 前向迁移创建公共运行、事件与模型健康表", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../drizzle/0057_operation_runtime_observability.sql", import.meta.url), "utf8"));
  const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const name of ["operation_runs", "operation_steps", "operation_events", "ai_model_runtime_health"]) assert.ok(tables.has(name), name);
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ tag: string }> };
  assert.equal(journal.entries.at(-1)?.tag, "0057_operation_runtime_observability");
  sqlite.close();
});

test("外部自动化 reporter 对不可用观测接口失败开放且不发送额外凭据", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const reporter = createExternalOperationReporter({
    baseUrl: "http://localhost:3000/",
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { "content-type": "application/json" } });
    },
    timeoutMs: 500,
  });
  assert.equal(await reporter.start({ externalRunId: "run-1", runType: "test", surface: "test" }), null);
  assert.equal(await reporter.finish(null, { status: "failed" }), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://localhost:3000/api/operations/runtime");
  assert.deepEqual(Object.keys(requests[0].init?.headers as Record<string, string>), ["content-type"]);
});

test("运行账本 API 只允许管理员并保持 no-store 与有界视图", async () => {
  const route = await readFile(new URL("../app/api/operations/runtime/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(route, /view === "metrics"/);
  assert.match(route, /view === "details"/);
  assert.match(route, /cache-control": "no-store"/);
  assert.doesNotMatch(route, /payload\.(apiKey|cookie|authorization)/i);
});
