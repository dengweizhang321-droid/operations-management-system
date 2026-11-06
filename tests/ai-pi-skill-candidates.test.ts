import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { isPublicAiPath, requestDjangoAi } from "../lib/django/ai-service";

const principal = { email: "candidate-fixture@example.invalid", displayName: "镜像", role: "analyst" as const, scope: { platforms: ["京东"], warehouses: [], channels: [] } };
const environment = { TERUISI_DJANGO_INTERNAL_SECRET: "Isolated-candidate-hmac-secret-32-bytes", TERUISI_DJANGO_AI_READER_BASE_URL: "http://127.0.0.1:18111", TERUISI_DJANGO_AI_WRITER_BASE_URL: "http://127.0.0.1:18112" };

// The four routes Django already serves (pi_views.py:94, 111, 114-119). Creation
// is nested under operations/ (4 segments); listing is a 2-segment pi/ top-level
// path and review/publish are 4-segment siblings of it.
const candidatePaths = [
  "operations/op_1/skill-candidates",
  "operations/op_1/skill-candidates/distill",
  "skill-candidates",
  "skill-candidates/c_1/review",
  "skill-candidates/c_1/publish",
];

test("Pi skill-candidate paths are public and writer-owned", async () => {
  for (const suffix of candidatePaths) {
    const path = `/api/ai/pi/${suffix}`;
    assert.equal(isPublicAiPath(path), true, path);
    let endpoint = "";
    await requestDjangoAi(principal, { path }, { environment, fetchImpl: async (url) => { endpoint = String(url); return Response.json({}, { headers: { "x-ai-revision": "1" } }); } });
    // ai-service.ts:99 forces every pi path onto the writer, matching
    // pi_views.py:12-13 refusing to serve Pi from any other process role.
    assert.equal(new URL(endpoint).port, "18112", path);
    await assert.rejects(requestDjangoAi(principal, { path, service: "reader" }, { environment }), /writer/, path);
  }
});

test("Pi skill-candidate neighbours one segment off are refused", async () => {
  for (const suffix of [
    // Creation: Django guards len(parts) == 4 (pi_views.py:94), so the
    // subresource segment is mandatory and nothing may follow it.
    "operations/skill-candidates", "operations/op_1", "operations/op_1/skill-candidates/extra",
    "operations/op_1/skill-candidates/", "operations/op_1/skill-candidate",
    // Listing is exactly 2 segments (pi_views.py:111). The 3-segment
    // pi/skill-candidates/<id> in between has no Django branch at all: the
    // optional group must not degrade into it.
    "skill-candidates/", "skill-candidates/c_1", "skill-candidate",
    // review/publish are exactly 4 segments (pi_views.py:114). No other
    // action name, no fifth segment, no extra id segment.
    "skill-candidates/c_1/review/extra", "skill-candidates/c_1/publish/extra",
    "skill-candidates/c_1/no-such-action", "skill-candidates/c_1/c_2/review",
    "skill-candidates/c_1/Review", "skill-candidates/C 1/review",
    // Traversal and ENTITY bounds (ai-service.ts:9 caps an id at 160 chars).
    "skill-candidates/../sessions", "operations/op_1/../skill-candidates",
    `skill-candidates/${"a".repeat(161)}/review`,
    `operations/${"a".repeat(161)}/skill-candidates`,
  ]) assert.equal(isPublicAiPath(`/api/ai/pi/${suffix}`), false, suffix);
  // The upper bound itself still passes, so the rejections above are the
  // length rule and not an off-by-one that bans every long id.
  assert.equal(isPublicAiPath(`/api/ai/pi/skill-candidates/${"a".repeat(160)}/review`), true);
});

test("Pi skill-candidate route files expose only the method Django serves", async () => {
  const routes = {
    // GET and POST share one path: Django branches on the method at
    // pi_views.py:90 (schema read) and :94 (create).
    "operations/[id]/skill-candidates": ["GET", "POST"],
    "operations/[id]/skill-candidates/distill": ["POST"],
    "skill-candidates": ["GET"],
    "skill-candidates/[id]/review": ["POST"],
    "skill-candidates/[id]/publish": ["POST"],
  };
  for (const [path, methods] of Object.entries(routes)) {
    const source = await readFile(`app/api/ai/pi/${path}/route.ts`, "utf8");
    assert.deepEqual([...source.matchAll(/export const (\w+) = forwardAiRequest/g)].map(match => match[1]), methods, path);
  }
});

test("Pi skill-candidate writes keep same-origin enforcement and forward their body keys unchanged", async () => {
  const bundle = await build({ entryPoints: ["lib/ai/django-route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "candidate-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(?:auth\/authorization|django\/(?:ai-service|ai-stream))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.includes("authorization") ? `
      export const requireAppPrincipal = async (roles) => {globalThis.__candidateRoles=roles;return {role:'analyst',scope:null}};
      export const requireUnrestrictedDataScope = () => {};
      export const authorizationErrorResponse = () => null;`
      : args.path.includes("ai-stream") ? `export const requestDjangoAiStream = () => {throw Error('no SSE')}`
      : `export const isPublicAiPath = () => true;
      export const requestDjangoAi = async (_,input) => {globalThis.__candidateInput=input;return {status:200,revision:'1',data:{ok:true}}};` }));
  } }] });
  const { forwardAiRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  const post = (path: string, body: unknown, origin = "https://fixture.invalid") => new Request(`https://fixture.invalid/api/ai/pi/${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const sent = () => (globalThis as unknown as { __candidateInput: { payload?: Record<string, unknown> } }).__candidateInput.payload;

  // The three writes carry exactly the key sets skill_candidates.py's own
  // fields() calls allow (save:118, review:169, publish:254). The thin route
  // neither adds nor drops keys, so Django's allowlist is the only gate --
  // there is no second Worker-side key allowlist to fall out of step with it.
  const bodies: Array<[string, Record<string, unknown>]> = [
    ["operations/op_1/skill-candidates", { content: { goal: "g" }, schemaRef: "skill-candidate-v1", schemaDigest: "a".repeat(64) }],
    ["operations/op_1/skill-candidates/distill", { clientRequestId: "request-1", reportVersionDigest: "a".repeat(64) }],
    ["operations/op_1/skill-candidates/distill", { clientRequestId: "request-1", reportVersionDigest: "a".repeat(64), withdrawAuthorization: true }],
    ["skill-candidates/c_1/review", { status: "approved", expectedVersion: 1, contentDigest: "b".repeat(64), note: "可以" }],
    ["skill-candidates/c_1/publish", { domains: ["netshop"], keywords: ["京东"], expectedLibraryVersion: 3 }],
  ];
  for (const [path, body] of bodies) {
    assert.equal((await forwardAiRequest(post(path, body))).status, 200, path);
    assert.deepEqual(Object.keys(sent() ?? {}).sort(), Object.keys(body).sort(), path);
    assert.deepEqual(sent(), body, path);
    // django-route.ts:14 -> requireAiSameOriginWrite: a cross-site POST never
    // reaches Django at all.
    assert.equal((await forwardAiRequest(post(path, body, "https://cross-site.invalid"))).status, 403, path);
  }
  // Writes require a non-viewer role (django-route.ts:15); the GET listing does not.
  assert.deepEqual((globalThis as unknown as { __candidateRoles: string[] }).__candidateRoles, ["admin", "operator", "analyst"]);
  assert.equal((await forwardAiRequest(new Request("https://fixture.invalid/api/ai/pi/skill-candidates?status=approved"))).status, 200);
  assert.equal((globalThis as unknown as { __candidateRoles?: string[] }).__candidateRoles, undefined);

  // review/publish are deliberately NOT added to django-route.ts:30's admin
  // gate. publish()'s own unscoped-admin check (skill_candidates.py:257,299,
  // and report_library.save():112 under it) is the authority; review() is
  // owner-gated (skill_candidates.py:34) and must stay reachable by the
  // analyst who proposed the candidate.
  const route = await readFile("lib/ai/django-route.ts", "utf8");
  assert.doesNotMatch(route, /skill-candidates/);
});

test("the skill-candidate schema read is reachable as a GET on the create path", async () => {
  // The read half of distillation (pi_views.py:90). It shares its path with
  // the create POST, so PI_PUBLIC_PATH already admits it -- the regex is
  // method-blind. What was missing, and what this pins, is the Next route
  // file exporting GET at all: without that export the path resolves to a
  // route with no GET handler and the caller gets 405 from the framework,
  // never reaching Django's branch.
  const path = "/api/ai/pi/operations/op_1/skill-candidates";
  assert.equal(isPublicAiPath(path), true);
  const route = await readFile("app/api/ai/pi/operations/[id]/skill-candidates/route.ts", "utf8");
  assert.match(route, /export const GET = forwardAiRequest/);

  // A GET on this path goes to the writer, like every other Pi path.
  let endpoint = "";
  await requestDjangoAi(principal, { path, method: "GET" }, { environment, fetchImpl: async (url) => { endpoint = String(url); return Response.json({}, { headers: { "x-ai-revision": "1" } }); } });
  assert.equal(new URL(endpoint).port, "18112");

  // Through the thin route: a read needs no non-viewer role (django-route.ts:15)
  // and no same-origin header (:14), and it forwards no payload. Ownership is
  // Django's to enforce, not the Worker's.
  const bundle = await build({ entryPoints: ["lib/ai/django-route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "schema-read-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(?:auth\/authorization|django\/(?:ai-service|ai-stream))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.includes("authorization") ? `
      export const requireAppPrincipal = async (roles) => {globalThis.__schemaRoles=roles;return {role:'analyst',scope:null}};
      export const requireUnrestrictedDataScope = () => {};
      export const authorizationErrorResponse = () => null;`
      : args.path.includes("ai-stream") ? `export const requestDjangoAiStream = () => {throw Error('no SSE')}`
      : `export const isPublicAiPath = () => true;
      export const requestDjangoAi = async (_,input) => {globalThis.__schemaInput=input;return {status:200,revision:'1',data:{outputSchemaRef:'skill-candidate-v1'}}};` }));
  } }] });
  const { forwardAiRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  (globalThis as unknown as { __schemaRoles?: string[] }).__schemaRoles = undefined;
  const read = await forwardAiRequest(new Request(`https://fixture.invalid${path}`));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).outputSchemaRef, "skill-candidate-v1");
  const sent = (globalThis as unknown as { __schemaInput: { path: string; method: string; payload?: unknown } }).__schemaInput;
  assert.equal(sent.path, path);
  assert.equal(sent.method, "GET");
  assert.equal(sent.payload, undefined);
  assert.equal((globalThis as unknown as { __schemaRoles?: string[] }).__schemaRoles, undefined);
});
