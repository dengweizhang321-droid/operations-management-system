import assert from "node:assert/strict";
import test from "node:test";

import { PlaywrightPageClient, withJackyunBrowserTimeout } from "../lib/jackyun/playwright-client";
import { retryOnceAfterAmbiguousBrowserResult } from "../tools/jackyun-browser-controller";

test("Playwright adapter enforces the requested Runtime.evaluate timeout", async () => {
  await assert.rejects(
    withJackyunBrowserTimeout(new Promise<never>(() => undefined), 20, "Runtime.evaluate"),
    (error: Error) => error.name === "JackyunBrowserTimeoutError" && /20ms/.test(error.message),
  );
  assert.equal(await withJackyunBrowserTimeout(Promise.resolve("ok"), 100, "Runtime.evaluate"), "ok");
});

test("Playwright Runtime.evaluate uses the adapter timeout instead of waiting on the page promise forever", async () => {
  const page = { evaluate: () => new Promise<never>(() => undefined) };
  const session = { on() {}, off() {}, detach: async () => undefined };
  const client = new PlaywrightPageClient(page as never, session as never);
  await assert.rejects(
    client.send("Runtime.evaluate", { expression: "new Promise(() => undefined)" }, 20),
    (error: Error) => error.name === "JackyunBrowserTimeoutError",
  );
});

test("a timed-out Playwright evaluation is not duplicated by the ambiguous-result retry", async () => {
  let evaluationCalls = 0;
  let lateEffects = 0;
  const page = {
    async evaluate() {
      evaluationCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      lateEffects += 1;
      return { result: { value: true } };
    },
  };
  const session = { on() {}, off() {}, detach: async () => undefined };
  const client = new PlaywrightPageClient(page as never, session as never);
  await assert.rejects(
    retryOnceAfterAmbiguousBrowserResult(
      () => client.send("Runtime.evaluate", { expression: "true" }, 10),
      0,
    ),
    (error: Error) => error.name === "JackyunBrowserTimeoutError",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(evaluationCalls, 1);
  assert.equal(lateEffects, 1);
});
