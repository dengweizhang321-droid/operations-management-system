import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { isPublicAiPath, requestDjangoAi } from "../lib/django/ai-service";
import { mergePiEvents, piOperationBlocksSend, piScopeFromDraft, reconcilePiPending, piFailureLabel, piEventDetail, type PiEvent, type PiPending } from "../app/ai-pi-agent-view";

const principal = { email: "pi-fixture@example.invalid", displayName: "镜像", role: "analyst" as const, scope: { platforms: ["京东"], warehouses: [], channels: [] } };
const environment = { TERUISI_DJANGO_INTERNAL_SECRET: "Isolated-Pi-hmac-secret-at-least-32-bytes", TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112" };
const paths = ["skills", "sessions", "sessions/s_1", "sessions/s_1/messages", "sessions/s_1/events", "sessions/s_1/abort", "sessions/s_1/files", "files/f_1", "files/f_1/content"];

test("Pi failure cause is visible ahead of unknown status, including after refresh", () => {
  const data = JSON.parse(JSON.stringify({code: "invalid_provider_response", status: "unknown", responseDiagnostics: { reason: "tool_arguments_bounds" }}));
  assert.match(piEventDetail(data), /模型响应校验失败.*tool_arguments_bounds/);
  assert.equal(piEventDetail({ errorCode: "legacy_code", status: "unknown" }), "legacy_code");
  assert.equal(piEventDetail({status: "running"}), "执行中");
  assert.equal(piFailureLabel("invalid_provider_response"), "模型响应校验失败，执行已暂停。");
  assert.equal(piOperationBlocksSend("unknown"), true);
});

test("Pi recovery only reconciles the exact durable request and keeps unknown operations fenced", () => {
  for (const status of ["queued", "running", "canceling", "unknown", "new-unrecognized-status"]) assert.equal(piOperationBlocksSend(status), true);
  for (const status of ["succeeded", "failed", "canceled"]) assert.equal(piOperationBlocksSend(status), false);
  const pending: PiPending[] = [{ kind: "message", sessionId: "s1", clientRequestId: "lost" }, { kind: "message", sessionId: "s2", clientRequestId: "other-session" }, { kind: "file", sessionId: "s1", clientRequestId: "upload" }];
  const detail = { session: { id: "s1", title: "", status: "running", epoch: 1, generation: 1, updatedAt: "" }, operations: [{ id: "op1", kind: "prompt", status: "unknown", clientRequestId: "lost" }], files: [] };
  assert.deepEqual(reconcilePiPending(pending, detail), pending.slice(1));
  assert.deepEqual(reconcilePiPending(pending, { ...detail, operations: [] }), pending);
  assert.equal(piScopeFromDraft({ warehouses: "", channels: "", platforms: "" }), undefined);
  assert.deepEqual(piScopeFromDraft({ warehouses: "广东仓，广东仓", channels: "", platforms: "京东,天猫" }), { warehouses: ["广东仓"], channels: [], platforms: ["京东", "天猫"] });
  assert.deepEqual(piScopeFromDraft({ warehouses: "", channels: "", platforms: "京东" }, { warehouses: ["广东仓"], channels: ["销售"], platforms: ["京东", "天猫"] }), { warehouses: ["广东仓"], channels: ["销售"], platforms: ["京东"] });
  assert.deepEqual(reconcilePiPending([{ kind: "abort", sessionId: "s1", clientRequestId: "stop" }], { ...detail, controlRequests: [{ clientRequestId: "stop", operationId: "op1", status: "completed" }] }), []);
  const event = (seq: number, text: string): PiEvent => ({ eventSeq: seq, type: "assistant_message", operationId: "op", data: { text }, createdAt: "" });
  assert.deepEqual(mergePiEvents([event(2, "old")], [event(1, "first"), event(2, "canonical")]).map(item => item.data.text), ["first", "canonical"]);
});

test("Pi public paths are exact and all reads use their writer owner", async () => {
  for (const suffix of paths) {
    const path = `/api/ai/pi/${suffix}`;
    assert.equal(isPublicAiPath(path), true, path);
    let endpoint = "";
    await requestDjangoAi(principal, { path }, { environment, fetchImpl: async (url) => { endpoint = String(url); return Response.json({}, { headers: { "x-ai-revision": "1" } }); } });
    assert.equal(new URL(endpoint).port, "18112");
    await assert.rejects(requestDjangoAi(principal, { path, service: "reader" }, { environment }), /writer/);
  }
  for (const suffix of ["", "skills/", "skills/run", "sessions/s_1/internal", "sessions/s_1/messages/retry", "files/f_1/content/extra", `sessions/${"a".repeat(161)}`]) assert.equal(isPublicAiPath(`/api/ai/pi/${suffix}`), false, suffix);
});

test("Pi passive file transport accommodates an 8 MiB file base64 envelope and remains bounded", async () => {
  const payload = { base64: Buffer.alloc(8 * 1024 * 1024, 97).toString("base64"), fileName: "fixture.bin", mimeType: "application/octet-stream" };
  const result = await requestDjangoAi<typeof payload>(principal, { path: "/api/ai/pi/files/f_1/content" }, { environment, fetchImpl: async () => Response.json(payload, { headers: { "x-ai-revision": "1" } }) });
  assert.equal(result.data.base64.length, payload.base64.length);
  await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/pi/files/f_1/content" }, { environment, fetchImpl: async () => Response.json({}, { headers: { "x-ai-revision": "1", "content-length": String(12 * 1024 * 1024 + 1) } }) }), /不可用/);
  await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/reports/r_1/content" }, { environment, fetchImpl: async () => Response.json({}, { headers: { "x-ai-revision": "1", "content-length": String(9 * 1024 * 1024 + 1) } }) }), /不可用/);
});

test("Pi event transport preserves complete large UTF-8 replies within its independent bound", async () => {
  const payload = { items: [{ eventSeq: 1, type: "assistant_message", data: { text: "字".repeat(900_000) } }], hasMore: false };
  const result = await requestDjangoAi<typeof payload>(principal, { path: "/api/ai/pi/sessions/s_1/events" }, { environment, fetchImpl: async () => Response.json(payload, { headers: { "x-ai-revision": "1" } }) });
  assert.equal(result.data.items[0].data.text.length, 900_000);
  await assert.rejects(requestDjangoAi(principal, { path: "/api/ai/pi/sessions/s_1/events" }, { environment, fetchImpl: async () => Response.json({}, { headers: { "x-ai-revision": "1", "content-length": String(4 * 1024 * 1024 + 1) } }) }), /不可用/);
});

test("Pi route files expose only the intended passive GET and explicit POST", async () => {
  const routes = { "skills": ["GET"], "sessions": ["GET", "POST"], "sessions/[id]": ["GET"], "sessions/[id]/messages": ["POST"], "sessions/[id]/events": ["GET"], "sessions/[id]/abort": ["POST"], "sessions/[id]/files": ["POST"], "files/[id]": ["GET"], "files/[id]/content": ["GET"] };
  for (const [path, methods] of Object.entries(routes)) {
    const source = await readFile(`app/api/ai/pi/${path}/route.ts`, "utf8");
    assert.deepEqual([...source.matchAll(/export const (\w+) = forwardAiRequest/g)].map(match => match[1]), methods);
  }
});

test("Pi thin route keeps origin, roles and bounded upload parsing, and forces passive downloads", async () => {
  const bundle = await build({ entryPoints: ["lib/ai/django-route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "pi-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(?:auth\/authorization|django\/(?:ai-service|ai-stream))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.includes("authorization") ? `
      export const requireAppPrincipal = async (roles) => {globalThis.__piRoles=roles;return {role:'analyst',scope:null}};
      export const requireUnrestrictedDataScope = () => {};
      export const authorizationErrorResponse = () => null;`
      : args.path.includes("ai-stream") ? `export const requestDjangoAiStream = () => {throw Error('no SSE')}`
      : `export const isPublicAiPath = () => true;
      export const requestDjangoAi = async (_,input) => {globalThis.__piInput=input;return {status:200,revision:'1',data:input.path.endsWith('/content') ? {base64:'PGgxPnJldmlldzwvaDE+',mimeType:'text/html',fileName:'报告.html'} : {ok:true}}};` }));
  } }] });
  const { forwardAiRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const request = (path: string, body: unknown, origin = "https://fixture.invalid") => new Request(`https://fixture.invalid/api/ai/pi/${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const uploaded = await forwardAiRequest(request("sessions/s_1/files", { clientRequestId: "fixture", fileName: "fixture.txt", mimeType: "text/plain", base64: "YQ==".repeat(160000) }));
  assert.equal(uploaded.status, 200);
  assert.deepEqual((globalThis as unknown as { __piRoles: string[] }).__piRoles, ["admin", "operator", "analyst"]);
  assert.equal((await forwardAiRequest(request("sessions/s_1/files", { base64: "a".repeat(740000) }))).status, 413);
  assert.equal((await forwardAiRequest(request("sessions/s_1/messages", { message: "只读分析".repeat(15000) }))).status, 200);
  assert.equal((await forwardAiRequest(request("sessions/s_1/messages", {}, "https://cross-site.invalid"))).status, 403);
  const attachment = await forwardAiRequest(new Request("https://fixture.invalid/api/ai/pi/files/f_1/content"));
  assert.match(attachment.headers.get("content-disposition"), /^attachment;/);
  assert.equal(attachment.headers.get("x-content-type-options"), "nosniff");
  assert.match(attachment.headers.get("content-security-policy"), /sandbox/);
  assert.match(attachment.headers.get("cache-control"), /no-store/);
  assert.equal(await attachment.text(), "<h1>review</h1>");
});
