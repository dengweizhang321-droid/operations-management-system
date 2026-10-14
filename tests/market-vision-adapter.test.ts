import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { annotationFailure } from "../lib/market/annotation-failure";

const model = {
  id: "vision", name: "synthetic vision", protocol: "openai_compatible", model_type: "vision",
  model_name: "deepseek-v4.1-flash", base_url: "https://opencode.ai/zen/go",
  api_key_encrypted: "test-encrypted", status: "enabled", max_tokens: 65_536, reasoning_mode: "auto",
};
const image = { kind: "image", source: "imgzone", url: "https://img10.360buyimg.com/synthetic.jpg", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]), base64: "AQID", optimizedForModel: true };
let imageError = false;
const globals = globalThis as typeof globalThis & { __marketVisionAdapter?: { model: typeof model; image: typeof image; load: (input: Record<string, unknown>) => Promise<typeof image> } };
globals.__marketVisionAdapter = { model, image, load: async (input) => {
  assert.equal(input.imageContentSha256, "a".repeat(64));
  if (imageError) { await new Promise((resolve) => setTimeout(resolve, 10)); throw new Error("图片身份已变化"); }
  return image;
} };
const endpointModule = new URL("../lib/ai/endpoint-security.ts", import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  let source = "";
  if (specifier === "@/lib/django/ai-service") source = "export const aiConsumer = async () => ({model: globalThis.__marketVisionAdapter.model});";
  if (specifier === "@/lib/ai/crypto") source = "export const decryptSecret = async () => 'synthetic-key';";
  if (specifier === "@/lib/ai/endpoint-security") source = `export { resolveAiModelEndpointUrl } from ${JSON.stringify(endpointModule)}; export const loadAiEndpointSecurityContext = async () => ({runtimeEnvironment: 'test'});`;
  if (specifier === "./annotation-image-runtime" && context.parentURL?.includes("annotation-model")) source = "export const loadAnnotationImageWithRuntime = (...args) => globalThis.__marketVisionAdapter.load(...args);";
  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  return next(specifier, context);
} });
const { runVisionAnnotation, probeVisionModelConnection, visionAnnotationTiming } = await import("../lib/market/annotation-model");
const prediction = { segment: "A", image_price_yuan: 99.5, price_type: "标准售价", price_low_yuan: null, price_high_yuan: null, confidence: 0.95, reason: "清晰标价" };
const input = { principal: { email: "owner@example.test", displayName: "Owner", role: "operator" as const, scope: null }, jobId: "server-job-1", modelId: model.id, promptBody: "synthetic classification rules", segments: ["A", "B"], skuCode: "synthetic", productName: "synthetic", brand: "test", imageUrl: image.url, imageContentSha256: "a".repeat(64) };
let requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
const originalFetch = globalThis.fetch;
const openAi = (value: unknown = prediction, finishReason: unknown = "stop") => ({ choices: [{ finish_reason: finishReason, message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });
function setup(response: unknown = openAi(), status = 200) {
  requests = [];
  model.protocol = "openai_compatible";
  model.base_url = "https://opencode.ai/zen/go";
  imageError = false;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify(response), { status, headers: { "retry-after": "2" } });
  };
}
test.after(() => { globalThis.fetch = originalFetch; delete globals.__marketVisionAdapter; });

test("actual market adapter uses stable server job session, honest client, common builder and independent non-thinking A/B policy", async () => {
  setup();
  const before = JSON.stringify(model);
  const a = await runVisionAnnotation(input);
  await runVisionAnnotation({ ...input, fixedSegment: "A" });
  await runVisionAnnotation({ ...input, jobId: "server-job-2" });
  assert.equal(requests.length, 3);
  assert.equal(a.imagePriceCents, 9950);
  assert.equal(a.timing.inputBytes, 3);
  assert.equal(JSON.stringify(model), before);
  const headers = requests.map((request) => new Headers(request.init.headers));
  const expected = createHash("sha256").update("xiaote/session/v1/market/job/server-job-1").digest("hex");
  assert.equal(headers[0].get("x-opencode-session"), expected);
  assert.equal(headers[1].get("x-opencode-session"), expected);
  assert.notEqual(headers[2].get("x-opencode-session"), expected);
  assert.equal(headers[0].get("user-agent"), "xiaote-market/1.0");
  assert.equal(requests[0].url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(requests[0].body.max_tokens, 600);
  assert.equal(requests[1].body.max_tokens, 320);
  for (const request of requests) {
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    const schema = request.body.response_format as { json_schema: { strict: boolean; schema: { additionalProperties: boolean; properties: { segment: { enum: string[] } } } } };
    assert.equal(schema.json_schema.strict, true);
    assert.equal(schema.json_schema.schema.additionalProperties, false);
    assert.deepEqual(schema.json_schema.schema.properties.segment.enum, request === requests[1] ? ["A"] : ["A", "B"]);
    const messages = request.body.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content.filter((part) => part.type === "image_url").length, 1);
  }
  const bText = JSON.stringify(requests[1].body.messages);
  assert.match(bText, /不要重新分类/);
  assert.doesNotMatch(bText, /synthetic classification rules/);
  const djangoProvider = readFileSync(new URL("../backend/ai_assistant/provider.py", import.meta.url), "utf8");
  assert.match(djangoProvider, /origin\(base\) == "https:\/\/opencode.ai" and urlsplit\(base\).path == "\/zen\/go\/v1"/);
  assert.match(djangoProvider, /xiaote\/session\/v1\//);
});

test("exact OpenCode endpoint only: other routes and suppliers do not receive client/session headers", async () => {
  for (const base of ["https://api.openai.com/v1", "https://opencode.ai/zen/v1", "https://opencode.ai/zen/go/v1/extra"]) {
    setup(); model.base_url = base;
    await runVisionAnnotation({ ...input, jobId: undefined });
    const headers = new Headers(requests[0].init.headers);
    assert.equal(headers.get("x-opencode-session"), null);
    assert.equal(headers.get("user-agent"), null);
  }
});

test("OpenCode task without job identity refuses POST; capability probe has explicit independent session", async () => {
  setup();
  await assert.rejects(runVisionAnnotation({ ...input, jobId: undefined }), (error) => annotationFailure(error).failureCode === "model_configuration");
  assert.equal(requests.length, 0);
  setup(openAi({ ...prediction, segment: "红色", image_price_yuan: null, price_type: "无法判断" }));
  assert.equal(await probeVisionModelConnection(model), "图片识别成功");
  assert.match(new Headers(requests[0].init.headers).get("x-opencode-session")!, /^[a-f0-9]{64}$/);
});

test("invalid configured endpoint stops before POST", async () => {
  setup(); model.base_url = "http://untrusted.example.test/v1";
  await assert.rejects(runVisionAnnotation(input), (error) => annotationFailure(error).failureCode === "model_configuration");
  assert.equal(requests.length, 0);
});

for (const [name, envelope] of [
  ["empty body", openAi("")], ["whitespace body", openAi("  ")], ["valid JSON but truncated", openAi(prediction, "length")],
  ["missing finish reason", openAi(prediction, null)], ["unexpected tool finish", openAi(prediction, "tool_calls")],
  ["refusal", { choices: [{ finish_reason: "stop", message: { refusal: "blocked" } }] }],
  ["no choices", {}], ["multiple choices", { choices: [...openAi().choices, ...openAi().choices] }],
  ["null choice", { choices: [null] }],
  ["error HTTP200", { error: { message: "provider error" } }], ["non-text content", { choices: [{ finish_reason: "stop", message: { content: [{ type: "image", text: "invented" }] } }] }],
  ["invalid JSON", openAi("{broken")], ["fenced JSON", openAi("```json\n" + JSON.stringify(prediction) + "\n```")],
  ["unknown category", openAi({ ...prediction, segment: "invented" })], ["wrong B category", openAi({ ...prediction, segment: "B" })],
  ["unknown price type", openAi({ ...prediction, price_type: "invented" })], ["string price", openAi({ ...prediction, image_price_yuan: "99.5" })],
  ["string confidence", openAi({ ...prediction, confidence: "0.95" })], ["missing null", openAi({ ...prediction, price_low_yuan: undefined })],
  ["extra field", openAi({ ...prediction, reasoning_content: "not public" })],
] as const) {
  test(`actual market adapter rejects ${name}`, async () => {
    setup(envelope);
    await assert.rejects(runVisionAnnotation({ ...input, fixedSegment: name === "wrong B category" ? "A" : undefined }), (error) => {
      assert.equal(annotationFailure(error).failureCode, "model_response");
      assert.equal(visionAnnotationTiming(error).inputBytes, 3);
      return true;
    });
    assert.equal(requests.length, 1);
  });
}

test("actual market adapter preserves null price and no-price evidence rules", async () => {
  setup(openAi({ ...prediction, image_price_yuan: null, price_type: "明确无标价" }));
  assert.equal((await runVisionAnnotation(input)).imagePriceCents, null);
  setup(openAi({ ...prediction, image_price_yuan: null, price_type: "明确无标价", confidence: 0.5 }));
  await assert.rejects(runVisionAnnotation(input), /充分证据/);
});

for (const [status, message, code] of [
  [400, "missing x-opencode-session header", "model_configuration"],
  [400, "response_format json_schema is not supported", "model_configuration"],
  [404, "model_not_found", "model_configuration"], [401, "invalid credential", "model_configuration"],
  [400, "image format invalid", "image_fetch"], [400, "bad request", "annotation_failed"],
  [429, "rate limit", "provider_rate_limit"], [503, "temporarily unavailable", "model_network"],
  [429, "image request quota exceeded", "provider_rate_limit"],
] as const) {
  test(`actual market adapter HTTP ${status}: ${code} for ${message}`, async () => {
    setup({ error: { message, code: "synthetic" } }, status);
    await assert.rejects(runVisionAnnotation(input), (error) => annotationFailure(error).failureCode === code);
    assert.equal(requests.length, 1);
  });
}

test("issued POST transport uncertainty is isolated without automatic replay", async () => {
  for (const stage of ["request", "body"]) {
    setup();
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
      if (stage === "request") throw new Error("fetch failed token=secret-value");
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error("socket reset")); } }));
    };
    await assert.rejects(runVisionAnnotation(input), (error) => {
      const failure = annotationFailure(error);
      assert.equal(failure.failureCode, "inference_result_unknown");
      assert.equal(failure.failureKind, "unknown");
      assert.doesNotMatch(failure.failureMessage, /secret-value/);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test("HTTP200 confirmed protocol diagnostics stop the job; output body limits retain unknown protection", async () => {
  setup({ error: { message: "unsupported response_format json_schema" } });
  await assert.rejects(runVisionAnnotation(input), (error) => annotationFailure(error).failureCode === "model_configuration");
  assert.equal(requests.length, 1);
  for (const declared of [false, true]) {
    setup();
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
      return new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: declared ? { "content-length": String(2 * 1024 * 1024 + 1) } : {} });
    };
    await assert.rejects(runVisionAnnotation(input), (error) => annotationFailure(error).failureCode === "inference_result_unknown");
    assert.equal(requests.length, 1);
  }
});

test("deadline before POST uses timeout class; deadline after issued POST is unknown", async () => {
  setup();
  await assert.rejects(runVisionAnnotation({ ...input, deadlineAt: Date.now() - 1 }), (error) => annotationFailure(error).failureCode === "model_timeout");
  assert.equal(requests.length, 0);
  setup();
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  await assert.rejects(runVisionAnnotation({ ...input, deadlineAt: Date.now() + 50 }), (error) => {
    assert.equal(annotationFailure(error).failureCode, "inference_result_unknown");
    assert.ok(visionAnnotationTiming(error).modelCallMs >= 30);
    return true;
  });
  assert.equal(requests.length, 1);
});

test("pre-POST image identity failure records image-stage duration and never calls provider", async () => {
  setup(); imageError = true;
  await assert.rejects(runVisionAnnotation(input), (error) => {
    const timing = visionAnnotationTiming(error);
    assert.ok(timing.imageLoadMs >= 5);
    assert.ok(timing.totalMs >= timing.imageLoadMs);
    assert.equal(timing.modelCallMs, 0);
    assert.equal(annotationFailure(error).failureCode, "image_fetch");
    return true;
  });
  assert.equal(requests.length, 0);
});

test("supplier errors are bounded and redact credentials, URLs and inline images", async () => {
  setup({ error: { message: 'missing x-opencode-session authorization: Bearer private-secret api_key="other-secret" https://example.test/path?token=secret data:image/png;base64,AQID ' + "z".repeat(1000) } }, 400);
  await assert.rejects(runVisionAnnotation(input), (error) => {
    const failure = annotationFailure(error);
    assert.equal(failure.failureCode, "model_configuration");
    assert.ok(failure.failureMessage.length <= 300);
    assert.doesNotMatch(failure.failureMessage, /private-secret|other-secret|example.test|AQID/);
    return true;
  });
});

test("Anthropic uses one forced structured tool and rejects truncation or ambiguous results", async () => {
  for (const [stopReason, content, valid] of [
    ["tool_use", [{ type: "tool_use", name: "submit_market_sku_annotation", input: prediction }], true],
    ["max_tokens", [{ type: "tool_use", name: "submit_market_sku_annotation", input: prediction }], false],
    ["tool_use", [{ type: "tool_use", name: "other", input: prediction }], false],
    ["end_turn", [], false],
    ["tool_use", [{ type: "tool_use", name: "submit_market_sku_annotation", input: prediction }, { type: "tool_use", name: "other", input: prediction }], false],
  ] as const) {
    setup({ stop_reason: stopReason, content }); model.protocol = "anthropic"; model.base_url = "https://api.anthropic.com/v1";
    if (valid) assert.equal((await runVisionAnnotation(input)).segment, "A");
    else await assert.rejects(runVisionAnnotation(input), (error) => annotationFailure(error).failureCode === "model_response");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.tool_choice, { type: "tool", name: "submit_market_sku_annotation" });
    assert.equal(requests[0].body.thinking, undefined);
  }
});
