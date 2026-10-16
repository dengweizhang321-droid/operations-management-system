import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as apiError from "../lib/http/api-error";
import * as boundedJson from "../lib/http/bounded-json";
import * as contract from "../lib/workflow/learning-operation";

const operationId = "40000000-0000-4000-8000-000000000001";
function fixture(path: string) {
  const calls: Array<{ principal: unknown; input: Record<string, unknown>; options: { requestId?: () => string } }> = [];
  const roles: unknown[] = [];
  let denied = false;
  const principal = { email: "admin@example.test", role: "admin", scope: null };
  const modules: Record<string, unknown> = {
    "@/lib/auth/authorization": {
      requireAppPrincipal: async (required: unknown) => { roles.push(required); return principal; },
      requireUnrestrictedDataScope: () => { if (denied) throw new Error("scope denied"); },
      authorizationErrorResponse: () => null,
    },
    "@/lib/django/workflow-service": {
      WORKFLOW_NEW_PRODUCT_LINE_LEARN_PATH: contract.LEARNING_PATH,
      getWorkflowBackendMode: async () => "django",
      createDjangoWorkflowService: () => ({ requestJson: async (actor: unknown, input: Record<string, unknown>, options: { requestId?: () => string }) => {
        calls.push({ principal: actor, input: JSON.parse(JSON.stringify(input)), options });
        return { data: { operationId, status: "unconfirmed" }, revision: "4:abcdef123456" };
      } }),
    },
    "@/lib/http/api-error": { ...apiError, safeApiErrorResponse: (error: Error & { status?: number }) => Response.json({ error: error.message }, { status: error.status ?? 503 }) },
    "@/lib/http/bounded-json": boundedJson,
    "@/lib/workflow/learning-operation": contract,
  };
  const exports = {} as { POST: (request: Request) => Promise<Response>; GET: (request: Request, context?: unknown) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(modules[name], name); return modules[name]; }, Request, Response, Headers, URL, JSON, Object });
  return { routes: exports, calls, roles, principal, deny: () => { denied = true; } };
}
const postRequest = (body: unknown) => new Request("https://app.test" + contract.LEARNING_PATH, { method: "POST", headers: { "content-type": "application/json", "x-teruisi-request-id": "untrusted-id" }, body: JSON.stringify(body) });

test("public learning POST forwards stable operation identity after real-principal gate", async () => {
  const f = fixture("app/api/workflow/new-product-lines/learn/route.ts");
  for (let n = 0; n < 2; n++) assert.equal((await f.routes.POST(postRequest({ operationId }))).status, 200);
  for (const call of f.calls) {
    assert.equal(call.principal, f.principal);
    assert.deepEqual(call.input, { method: "POST", path: contract.LEARNING_PATH, service: "writer", payload: { operationId } });
    assert.equal(call.options.requestId?.(), contract.LEARNING_REQUEST_PREFIX + operationId);
  }
  assert.equal(JSON.stringify(f.roles), JSON.stringify([["operator", "admin"], ["operator", "admin"]]));
});

test("public learning POST rejects missing, malformed, extra, oversized input before writer", async () => {
  const f = fixture("app/api/workflow/new-product-lines/learn/route.ts");
  for (const body of [{}, { operationId: "bad" }, { operationId, expectedSourceBatchId: "extra" }, { operationId, padding: "x".repeat(300) }]) {
    assert.ok([400, 413].includes((await f.routes.POST(postRequest(body))).status));
  }
  assert.equal(f.calls.length, 0);
  f.deny(); assert.equal((await f.routes.POST(postRequest({ operationId }))).status, 503);
  assert.equal(f.calls.length, 0);
});

test("public operation GET is no-store, writer-only, and never submits learning", async () => {
  const f = fixture("app/api/workflow/new-product-lines/learn/operations/[operationId]/route.ts");
  const response = await f.routes.GET(new Request("https://app.test" + contract.learningOperationPath(operationId)), { params: Promise.resolve({ operationId }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls[0].input, { method: "GET", path: contract.learningOperationPath(operationId), service: "writer" });
  const bad = await f.routes.GET(new Request("https://app.test" + contract.learningOperationPath(operationId) + "?extra=1"), { params: Promise.resolve({ operationId }) });
  assert.equal(bad.status, 400); assert.equal(f.calls.length, 1);
});

test("original draft preview GET keeps its reader and unsaved query", async () => {
  const f = fixture("app/api/workflow/new-product-lines/learn/route.ts");
  const response = await f.routes.GET(new Request("https://app.test" + contract.LEARNING_PATH + "?name=draft&term=keyword"));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0].input, { method: "GET", path: contract.LEARNING_PATH, service: "reader", rawQuery: "name=draft&term=keyword" });
});
