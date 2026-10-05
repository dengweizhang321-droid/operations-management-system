import assert from "node:assert/strict";
import test from "node:test";
import { mergeInventoryRegion, readInventoryRegions } from "../lib/inventory/read-regions";

const scope = "a".repeat(64), snapshot = "b".repeat(64);
const region = (section: "summary" | "detail", version = snapshot, marker = 1) => ({ readSection: section, readScope: scope, readSnapshot: version, marker, items: section === "detail" ? [marker] : [] });

test("regions preserve details only for an identical query and source", () => {
  const detail = mergeInventoryRegion(null, "scope-1", region("detail"));
  const complete = mergeInventoryRegion(detail, "scope-1", region("summary"));
  assert.equal(complete.summary, true); assert.equal(complete.detail, true);
  assert.deepEqual(complete.value.items, [1]);
  const otherScope = mergeInventoryRegion(complete, "scope-2", region("summary"));
  assert.equal(otherScope.detail, false); assert.deepEqual(otherScope.value.items, []);
  const otherSource = mergeInventoryRegion(complete, "scope-1", region("summary", "c".repeat(64)));
  assert.equal(otherSource.detail, false);
});

test("one failed region remains independently retryable; late aborted reads never publish", async () => {
  const native = globalThis.fetch;
  const controller = new AbortController(); const data: unknown[] = [], errors: string[] = [];
  try {
    globalThis.fetch = async input => new URL(String(input), "http://fixture").searchParams.get("section") === "summary"
      ? Response.json({ error: "fixture failure" }, { status: 503 }) : Response.json(region("detail"));
    const options = { signal: controller.signal, validate: () => {}, onData: (value: unknown) => data.push(value), onError: (part: string) => errors.push(part), onReset: () => {} };
    await readInventoryRegions("/api/inventory/overview?view=overview", options);
    assert.equal(data.length, 1); assert.deepEqual(errors, ["summary"]);
    let release!: () => void;
    globalThis.fetch = async () => { await new Promise<void>(resolve => release = resolve); return Response.json(region("summary")); };
    const pending = readInventoryRegions("/api/inventory/overview", { ...options, section: "summary" });
    controller.abort(); release(); await pending;
    assert.equal(data.length, 1);
  } finally { globalThis.fetch = native; }
});

test("a source change on local retry rebuilds both regions; repeated mismatch fails boundedly", async () => {
  const native = globalThis.fetch;
  let calls = 0, resets = 0; const errors: string[] = [];
  try {
    globalThis.fetch = async input => { calls++; return Response.json(region(new URL(String(input), "http://fixture").searchParams.get("section") as "summary" | "detail", "c".repeat(64))); };
    const options = { signal: new AbortController().signal, section: "summary" as const, previous: { scope, snapshot }, validate: () => {}, onData: () => {}, onError: (part: string) => errors.push(part), onReset: () => resets++ };
    await readInventoryRegions("/api/inventory/overview", options);
    assert.equal(calls, 3); assert.equal(resets, 1); assert.deepEqual(errors, []);
    calls = 0; resets = 0;
    globalThis.fetch = async input => { calls++; const part = new URL(String(input), "http://fixture").searchParams.get("section") as "summary" | "detail"; return Response.json(region(part, part === "summary" ? snapshot : "c".repeat(64))); };
    await readInventoryRegions("/api/inventory/overview", { ...options, section: undefined, previous: null });
    assert.equal(calls, 4); assert.equal(resets, 2); assert.deepEqual(errors, ["summary", "detail"]);
  } finally { globalThis.fetch = native; }
});
