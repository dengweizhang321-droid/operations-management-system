/** Synthetic client for test_pi_export_http: real tool/HTTP/signing, no fetch mock. */
import { registerHooks } from "node:module";
import { createInterface } from "node:readline";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env={};", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { aiToolRegistry, executeRegisteredToolCall } = await import("../lib/ai/tool-registry");
const { requestDjangoAi } = await import("../lib/django/ai-service");

for await (const line of createInterface({ input: process.stdin })) {
  try {
    const command = JSON.parse(line);
    if (command.mode === "consumer") {
      const result = await requestDjangoAi(command.principal, {
        path: "/api/ai/consumer", method: "POST", service: command.service ?? "writer", payload: command.payload,
      }, { requestId: command.requestId, fetchImpl: command.tamperSignature ? async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-teruisi-signature", "v1=" + "0".repeat(64));
        return fetch(url, { ...init, headers });
      } : undefined });
      process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
    } else {
      const context = { principal: command.principal, surface: command.surface ?? "pi_agent", requestId: command.operationId, providerCallId: command.callId };
      const result = command.mode === "handler"
        ? { ok: true, data: await aiToolRegistry.find(entry => entry.name === command.name)!.handler(command.arguments, context) }
        : await executeRegisteredToolCall(command.name, command.arguments, context);
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch (error) {
    const value = error as { status?: number; code?: string };
    process.stdout.write(JSON.stringify({ ok: false, status: value.status, code: value.code }) + "\n");
  }
}
