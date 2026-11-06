import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { parseDistillationIntent } from "../app/ai-pi-skill-distillation";

test("disconnected distillation intents retain the exact request and report binding", () => {
  const intent = { clientRequestId: "same-request", reportVersionDigest: "a".repeat(64) };
  assert.equal(parseDistillationIntent(null), null);
  assert.deepEqual(parseDistillationIntent(JSON.stringify(intent)), intent);
  for (const invalid of ["[]", "null", "{}", JSON.stringify({ ...intent, reportVersionDigest: "bad" }), JSON.stringify({ ...intent, clientRequestId: "a/b" }), JSON.stringify({ ...intent, modelId: "other" })]) assert.throws(() => parseDistillationIntent(invalid));
});

test("single-file demonstration has inline executable assets and a file-safe offline adapter", async () => {
  const htmlUrl = pathToFileURL(`${process.cwd()}/docs/skill-distill-ui-20261107/提炼草稿交互方案.html`);
  assert.equal(htmlUrl.protocol, "file:");
  const html = await readFile(htmlUrl, "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /合成演示数据/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0][1]));
  const adapter = await readFile("tests/fixtures/skill-distillation-demo.tsx", "utf8");
  assert.match(adapter, /new URL\(String\(input\), "https:\/\/offline-demo.invalid"\)/);
  assert.doesNotMatch(adapter, /originalFetch|window\.open|localhost|127\.0\.0\.1/);
});
