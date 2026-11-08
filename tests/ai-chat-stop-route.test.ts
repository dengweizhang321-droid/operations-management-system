import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { isPublicAiPath } from "../lib/django/ai-service";

test("explicit same-origin Stop reaches only the signed write relay; stream disconnect does not send Stop", async () => {
  const bundle = await build({
    entryPoints: ["app/api/ai/chat/cancel/route.ts", "app/api/ai/chat/route.ts"], bundle: true, write: false,
    outdir: "fixture-w3", platform: "node", format: "esm",
    plugins: [{ name: "chat-stop-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(?:auth\/authorization|django\/(?:ai-service|ai-stream))$/ },
        args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents:
        args.path.includes("authorization") ? `
          export async function requireAppPrincipal(roles) {
            if (roles && !roles.includes(globalThis.__chatStopRole)) throw new Error("fixture-role-denied");
            return { email: "fixture@example.invalid", role: globalThis.__chatStopRole, scope: null };
          }
          export const requireUnrestrictedDataScope = () => {};
          export const authorizationErrorResponse = error => error.message === "fixture-role-denied"
            ? Response.json({ code: "access_denied" }, { status: 403 }) : null;`
          : args.path.includes("ai-stream") ? `
          export function requestDjangoAiStream(_, payload, options) {
            return new Response(new ReadableStream({ cancel() { options.onCancel?.(); } }));
          }`
          : `
          export const isPublicAiPath = path => path === "/api/ai/chat" || path === "/api/ai/chat/cancel";
          export async function requestDjangoAi(principal, input) {
            globalThis.__chatStopWrites.push({ principal, input });
            return { status: 200, revision: "1", data: { ok: true, request: { status: "cancelled" } } };
          }` }));
    } }],
  });
  const fixture = globalThis as unknown as { __chatStopRole: string; __chatStopWrites: Array<{ input: { path: string; method: string; payload: unknown; service?: string } }> };
  fixture.__chatStopRole = "analyst";
  fixture.__chatStopWrites = [];
  const routes = await Promise.all(bundle.outputFiles.map(file =>
    import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`)));
  const [cancelRoute, chatRoute] = routes;
  assert.equal(isPublicAiPath("/api/ai/chat/cancel"), true);
  assert.equal(cancelRoute.GET, undefined);
  const body = { clientRequestId: "fixture-1", workspaceModule: "sales" };
  const request = (path: string, origin: string, stream = false) => new Request(`https://fixture.invalid/api/ai/chat${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin, "content-type": "application/json", accept: stream ? "text/event-stream" : "application/json" },
  });
  assert.equal((await cancelRoute.POST(request("/cancel", "https://cross-site.invalid"))).status, 403);
  fixture.__chatStopRole = "viewer";
  assert.equal((await cancelRoute.POST(request("/cancel", "https://fixture.invalid"))).status, 403);
  assert.equal(fixture.__chatStopWrites.length, 0);
  fixture.__chatStopRole = "analyst";
  assert.equal((await cancelRoute.POST(request("/cancel", "https://fixture.invalid"))).status, 200);
  assert.deepEqual(fixture.__chatStopWrites.map(({ input }) => [input.path, input.method, input.payload]), [
    ["/api/ai/chat/cancel", "POST", body],
  ]);
  fixture.__chatStopWrites.length = 0;
  const status = await chatRoute.GET(new Request("https://fixture.invalid/api/ai/chat?clientRequestId=fixture-1&workspaceModule=sales"));
  assert.equal(status.status, 200);
  assert.equal(fixture.__chatStopWrites[0].input.service, "writer");
  const messages = await chatRoute.GET(new Request("https://fixture.invalid/api/ai/chat?conversationId=conversation"));
  assert.equal(messages.status, 200);
  assert.equal(fixture.__chatStopWrites[1].input.service, undefined);
  fixture.__chatStopWrites.length = 0;
  const stream = await chatRoute.POST(request("", "https://fixture.invalid", true));
  await stream.body?.cancel();
  assert.equal(fixture.__chatStopWrites.length, 0);
});
