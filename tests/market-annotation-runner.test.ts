import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { AppPrincipal } from "../lib/auth/authorization";

type RecordValue = Record<string, unknown>;
const owner: AppPrincipal = { email: "owner@example.test", displayName: "Owner", role: "operator", scope: null };
const coordinator: AppPrincipal = { email: "market-annotation-runner@teruisi.internal", displayName: "Scheduler", role: "operator", scope: null };
let mode = "success";
let inferenceCalls = 0;
let completions: RecordValue[] = [];
let completionIds: string[] = [];
const mocks = {
  resolve: async (email: string) => {
    assert.equal(email, owner.email);
    return mode === "revoked" ? { ok: false } : { ok: true, principal: owner };
  },
  infer: async (input: RecordValue) => {
    inferenceCalls += 1;
    assert.deepEqual(input.principal, owner);
    assert.equal(input.jobId, "job");
    assert.ok(Number(input.deadlineAt) < Date.now() + 150_000);
    if (mode === "protocol-error") throw Object.assign(new Error("unsupported response_format"), { failureCode: "model_configuration" });
    if (mode === "unknown-model") throw Object.assign(new Error("模型请求已发出但响应未知"), { failureCode: "inference_result_unknown" });
    return { segment: "A", timing: {} };
  },
  request: async (_principal: AppPrincipal, request: { payload: RecordValue }, options: { requestId?: () => string }) => {
    const command = request.payload.command as RecordValue | undefined;
    if (command?.action === "claim_task") {
      return { status: 200, revision: "1:test", data: { result: { task: {
        jobId: "job", itemId: "item", skuCode: "sku", productName: "synthetic", brand: "test",
        sourceImageUrl: "https://img10.360buyimg.com/synthetic.jpg", promptBody: "classify",
        imageContentSha256: mode === "bad-hash" ? "" : "a".repeat(64), imageCache: null,
        segments: ["A"], fixedSegment: null, modelId: "model", leaseToken: "lease",
        ownerEmail: owner.email, leaseExpiresAt: new Date(Date.now() + 180_000).toISOString(),
      } } } };
    }
    if (command?.action === "complete_task") {
      completions.push(command);
      completionIds.push(options.requestId!());
      if (mode === "ack-lost" && completions.length === 1 || mode === "ack-unavailable") throw Object.assign(new Error("storage unavailable"), { status: 503 });
      return { status: 200, revision: "2:test", replayed: false, data: { result: { done: true } } };
    }
    throw new Error("unexpected progress request");
  },
};
const globals = globalThis as typeof globalThis & { __marketRunnerMocks?: typeof mocks };
globals.__marketRunnerMocks = mocks;
const mockModule = `
export const MARKET_COMMANDS_PATH = '/commands';
export const MARKET_QUERIES_PATH = '/queries';
export const requestDjangoMarketService = (...args) => globalThis.__marketRunnerMocks.request(...args);
export const runVisionAnnotation = (...args) => globalThis.__marketRunnerMocks.infer(...args);
export const visionAnnotationTiming = () => ({imageLoadMs: 1, imagePrepareMs: 2, modelCallMs: 3, totalMs: 6, inputBytes: 7});
export const resolveAiBackgroundPrincipal = (...args) => globalThis.__marketRunnerMocks.resolve(...args);
`;
registerHooks({ resolve(specifier, context, next) {
  if (["@/lib/django/market-service", "@/lib/market/annotation-model", "@/lib/ai/background-principal"].includes(specifier)) {
    return { url: `data:text/javascript,${encodeURIComponent(mockModule)}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { runClaimedDjangoMarketVisionTask } = await import("../lib/market/django-annotation-runner");

for (const scenario of ["success", "ack-lost", "ack-unavailable", "revoked"]) {
  test(`actual Django runner: ${scenario}`, async () => {
    mode = scenario;
    inferenceCalls = 0;
    completions = [];
    completionIds = [];
    const call = runClaimedDjangoMarketVisionTask({ principal: coordinator, jobId: "job", coordinatorToken: "dispatch-lease" });
    if (scenario === "ack-unavailable") await assert.rejects(call, /storage unavailable/);
    else {
      const response = await call;
      assert.equal(response.data.result.processedCount, scenario === "revoked" ? 0 : 1);
    }
    assert.equal(inferenceCalls, scenario === "revoked" ? 0 : 1);
    assert.equal(completions.length, scenario.startsWith("ack-") ? 2 : 1);
    if (scenario === "revoked") assert.equal(completions[0].failureCode, "authorization_revoked");
    else assert.ok(completions.every((command) => command.result && !command.error));
    assert.equal(new Set(completionIds).size, 1);
  });
}

test("actual Django runner refuses an unbound image before inference", async () => {
  mode = "bad-hash";
  inferenceCalls = 0;
  await assert.rejects(runClaimedDjangoMarketVisionTask({ principal: coordinator, jobId: "job", coordinatorToken: "dispatch-lease" }), /返回不完整/);
  assert.equal(inferenceCalls, 0);
});

for (const scenario of ["protocol-error", "unknown-model"]) {
  test(`actual Django runner forwards bounded failure and timing contract: ${scenario}`, async () => {
    mode = scenario; inferenceCalls = 0; completions = []; completionIds = [];
    const result = await runClaimedDjangoMarketVisionTask({ principal: coordinator, jobId: "job", coordinatorToken: "dispatch-lease" });
    assert.equal(result.data.result.processedCount, 0);
    assert.equal(inferenceCalls, 1);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].failureCode, scenario === "protocol-error" ? "model_configuration" : "inference_result_unknown");
    assert.equal(completions[0].failureKind, scenario === "protocol-error" ? "permanent" : "unknown");
    assert.deepEqual(completions[0].timing, { imageLoadMs: 1, imagePrepareMs: 2, modelCallMs: 3, totalMs: 6, inputBytes: 7 });
    assert.equal(completions[0].result, undefined);
  });
}
