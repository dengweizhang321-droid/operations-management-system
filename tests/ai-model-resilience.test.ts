import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  AiModelRequestError,
  executeModelRequestWithResilience,
  type AiTextModelRuntimeConfig,
  type ModelAttemptResult,
} from "../lib/ai/model-gateway";
import { createD1ModelAttemptObserver } from "../lib/ai/model-resilience";
import { startOperationRun, type OperationDatabase } from "../lib/operations/runtime";

const model = (id: string, protocol: "openai_compatible" | "anthropic" = "openai_compatible"): AiTextModelRuntimeConfig => ({
  id,
  name: id,
  protocol,
  modelName: id,
  baseUrl: "https://api.example.com/v1",
  apiKeyEncrypted: "encrypted",
  timeoutMs: 10_000,
  maxTokens: 1_024,
  reasoningMode: "disabled",
  temperature: 0,
  maxToolRounds: 6,
  maxTotalToolCalls: 12,
});

function databaseFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const database = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...bound: unknown[]) { values = bound as SQLInputValue[]; return this; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
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

test("模型瞬时错误有限重试并在原模型恢复后停止", async () => {
  let calls = 0;
  const delays: number[] = [];
  const attempts: ModelAttemptResult[] = [];
  const result = await executeModelRequestWithResilience({
    primaryModel: model("primary"),
    fallbackModels: [model("fallback")],
    request: async (candidate) => {
      calls += 1;
      assert.equal(candidate.id, "primary");
      if (calls < 3) throw new AiModelRequestError("model_http_429", "限流", 429, true, 100);
      return "ok";
    },
    retryPolicy: { maxAttemptsPerModel: 3, baseDelayMs: 0, maximumDelayMs: 0, maximumRetryAfterMs: 1_000 },
    sleep: async (delay) => { delays.push(delay); },
    observer: {
      async afterAttempt(_candidate, attempt) { attempts.push(attempt); },
    },
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays.every((delay) => delay >= 100 && delay <= 125));
  assert.deepEqual(attempts.map((item) => item.outcome), ["failed", "failed", "succeeded"]);
});

test("主模型瞬时故障耗尽后只降级到同协议备用模型", async () => {
  const used: string[] = [];
  const result = await executeModelRequestWithResilience({
    primaryModel: model("primary"),
    fallbackModels: [model("wrong-protocol", "anthropic"), model("fallback")],
    request: async (candidate) => {
      used.push(candidate.id);
      if (candidate.id === "primary") throw new AiModelRequestError("model_http_503", "暂不可用", 503, true);
      return candidate.id;
    },
    retryPolicy: { maxAttemptsPerModel: 2, baseDelayMs: 0, maximumDelayMs: 0 },
    sleep: async () => undefined,
  });
  assert.equal(result, "fallback");
  assert.deepEqual(used, ["primary", "primary", "fallback"]);
});

test("模型鉴权和协议错误不重试也不降级", async () => {
  const used: string[] = [];
  await assert.rejects(() => executeModelRequestWithResilience({
    primaryModel: model("primary"),
    fallbackModels: [model("fallback")],
    request: async (candidate) => {
      used.push(candidate.id);
      throw new AiModelRequestError("model_http_401", "鉴权失败", 401, false);
    },
    sleep: async () => undefined,
  }), /鉴权失败/);
  assert.deepEqual(used, ["primary"]);
});

test("用户取消不会污染模型健康或触发熔断", async () => {
  const { sqlite, database } = databaseFixture();
  const run = await startOperationRun(database, { runType: "ai_question", surface: "test", traceId: "trace-cancel" });
  const observer = createD1ModelAttemptObserver({ db: database, runId: run.id, traceId: run.traceId });
  const before = await observer.beforeAttempt!(model("cancelled-model"), 1, 0);
  await observer.afterAttempt!(model("cancelled-model"), {
    outcome: "cancelled", attempt: 1, fallbackIndex: 0, durationMs: 10, retryable: false,
    retryDelayMs: 0, errorCode: "model_request_cancelled",
  }, before.context);
  const health = sqlite.prepare("SELECT consecutive_failures FROM ai_model_runtime_health WHERE model_id='cancelled-model'").get();
  assert.equal(health, undefined);
  const step = sqlite.prepare("SELECT status FROM operation_steps WHERE run_id=?").get(run.id) as { status: string };
  assert.equal(step.status, "cancelled");
  sqlite.close();
});

test("持久化模型健康在连续失败后打开熔断并由成功复位", async () => {
  const { sqlite, database } = databaseFixture();
  const run = await startOperationRun(database, { runType: "ai_question", surface: "test", traceId: "trace-circuit" });
  const observer = createD1ModelAttemptObserver({ db: database, runId: run.id, traceId: run.traceId });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = await observer.beforeAttempt!(model("unstable"), attempt, 0);
    assert.equal(before.allowed, true);
    await observer.afterAttempt!(model("unstable"), {
      outcome: "failed", attempt, fallbackIndex: 0, durationMs: 10, retryable: true,
      retryDelayMs: 0, errorCode: "model_http_503",
    }, before.context);
  }
  const blocked = await observer.beforeAttempt!(model("unstable"), 1, 0);
  assert.equal(blocked.allowed, false);
  const health = sqlite.prepare("SELECT consecutive_failures failures, circuit_open_until openUntil FROM ai_model_runtime_health WHERE model_id='unstable'").get() as { failures: number; openUntil: string };
  assert.equal(health.failures, 3);
  assert.ok(Date.parse(`${health.openUntil}Z`) > Date.now());

  await observer.afterAttempt!(model("unstable"), {
    outcome: "succeeded", attempt: 1, fallbackIndex: 0, durationMs: 10, retryable: false, retryDelayMs: 0,
  });
  const reset = sqlite.prepare("SELECT consecutive_failures failures, circuit_open_until openUntil FROM ai_model_runtime_health WHERE model_id='unstable'").get() as { failures: number; openUntil: string | null };
  assert.deepEqual({ ...reset }, { failures: 0, openUntil: null });
  sqlite.close();
});
