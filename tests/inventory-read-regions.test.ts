import assert from "node:assert/strict";
import test from "node:test";
import { mergeInventoryRegion, readInventoryRegions, type InventoryReadSection, type InventoryRegionPayload, type InventoryRegionState } from "../lib/inventory/read-regions";

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
    const pending = readInventoryRegions("/api/inventory/overview", { ...options, section: "summary", previous: { scope, snapshot, summary: false, detail: true } });
    controller.abort(); release(); await pending;
    assert.equal(data.length, 1);
  } finally { globalThis.fetch = native; }
});

test("a source change on local retry rebuilds both regions; repeated mismatch fails boundedly", async () => {
  const native = globalThis.fetch;
  let calls = 0, resets = 0; const errors: string[] = [];
  try {
    globalThis.fetch = async input => { calls++; return Response.json(region(new URL(String(input), "http://fixture").searchParams.get("section") as "summary" | "detail", "c".repeat(64))); };
    const options = { signal: new AbortController().signal, section: "summary" as const, previous: { scope, snapshot, summary: false, detail: true }, validate: () => {}, onData: () => {}, onError: (part: string) => errors.push(part), onReset: () => resets++ };
    await readInventoryRegions("/api/inventory/overview", options);
    assert.equal(calls, 3); assert.equal(resets, 1); assert.deepEqual(errors, []);
    calls = 0; resets = 0;
    globalThis.fetch = async input => { calls++; const part = new URL(String(input), "http://fixture").searchParams.get("section") as "summary" | "detail"; return Response.json(region(part, part === "summary" ? snapshot : "c".repeat(64))); };
    await readInventoryRegions("/api/inventory/overview", { ...options, section: undefined, previous: null });
    assert.equal(calls, 4); assert.equal(resets, 2); assert.deepEqual(errors, ["summary", "detail"]);
  } finally { globalThis.fetch = native; }
});

const inventoryReads = [
  ["overview", "/api/inventory/overview?view=overview"],
  ["plan", "/api/inventory/overview?view=plan"],
  ["age", "/api/inventory/age-analysis?status=aged"],
  ["stale", "/api/inventory/age-analysis?status=stagnant"],
  ["inbound", "/api/inventory/inbound-monitor"],
  ["guangdong", "/api/inventory/guangdong-monitor"],
] as const;

for (const [view, url] of inventoryReads) for (const failedSection of ["summary", "detail"] as const) {
  test(`${view}: retrying early ${failedSection} failure replaces its cancelled in-flight sibling`, async () => {
    const native = globalThis.fetch;
    let state: InventoryRegionState<{ marker: number; items: number[] }> | null = null;
    let controller: AbortController | null = null, generation = 0;
    const calls: InventoryReadSection[] = [], errors: Partial<Record<InventoryReadSection, string>> = {};
    const counts = { summary: 0, detail: 0 };
    const sibling = failedSection === "summary" ? "detail" : "summary";
    let releaseSibling!: () => void, reportFailure!: () => void;
    const slowSibling = new Promise<void>(resolve => { releaseSibling = resolve; });
    const failed = new Promise<void>(resolve => { reportFailure = resolve; });
    const publish = (value: InventoryRegionPayload<{ marker: number; items: number[] }>) => {
      state = mergeInventoryRegion(state, url, value);
      delete errors[value.readSection];
    };
    const cancel = () => controller?.abort();
    // Match both view implementations: replace the shared controller and pass
    // only a state belonging to the current complete request key.
    const load = (section?: InventoryReadSection) => {
      controller?.abort(); controller = new AbortController();
      const active = controller, id = ++generation;
      return readInventoryRegions<{ marker: number; items: number[] }>(url, {
        signal: active.signal, section, previous: state?.key === url ? state : null,
        validate: () => {},
        onData: value => { if (id === generation && !active.signal.aborted) publish(value); },
        onError: (part, message) => { if (id === generation && !active.signal.aborted) { errors[part] = message; reportFailure(); } },
        onReset: () => { if (id === generation && !active.signal.aborted) state = null; },
      });
    };
    try {
      globalThis.fetch = async input => {
        const part = new URL(String(input), "http://fixture").searchParams.get("section") as InventoryReadSection;
        calls.push(part); const attempt = ++counts[part];
        if (part === failedSection && attempt === 1) return Response.json({ error: "early region failure" }, { status: 503 });
        if (part === sibling && attempt === 1) {
          await slowSibling; // Deliberately ignore abort to exercise late-response fencing.
          return Response.json(region(part, "c".repeat(64), 99));
        }
        return Response.json(region(part, snapshot, 2));
      };
      let initialSettled = false;
      const initial = load().then(() => { initialSettled = true; });
      await failed;
      assert.equal(initialSettled, false, "Retry must occur while the sibling request is still in flight");
      assert.equal(errors[failedSection], "early region failure");
      await load(failedSection);
      assert.deepEqual(calls, ["summary", "detail", "summary", "detail"]);
      const ready = state as InventoryRegionState<{ marker: number; items: number[] }> | null;
      assert.equal(ready?.summary, true); assert.equal(ready?.detail, true);
      assert.deepEqual(ready?.value.items, [2]); assert.deepEqual(errors, {});
      releaseSibling(); await initial;
      assert.equal(state, ready, "The cancelled sibling must not replace the recovered current result");
    } finally { releaseSibling(); cancel(); globalThis.fetch = native; }
  });
}

test("local retry keeps an already-ready sibling and full refresh still reloads the pair", async () => {
  const native = globalThis.fetch, calls: InventoryReadSection[] = [];
  const ready = mergeInventoryRegion(null, "current", region("detail"));
  let state = ready;
  try {
    globalThis.fetch = async input => {
      const part = new URL(String(input), "http://fixture").searchParams.get("section") as InventoryReadSection;
      calls.push(part); return Response.json(region(part));
    };
    const options = { signal: new AbortController().signal, previous: ready, validate: () => {}, onData: (value: ReturnType<typeof region>) => { state = mergeInventoryRegion(state, "current", value); }, onError: () => assert.fail("unexpected read error"), onReset: () => assert.fail("same snapshot must not reset") };
    await readInventoryRegions("/api/inventory/overview", { ...options, section: "summary" });
    assert.deepEqual(calls, ["summary"]); assert.equal(state.summary, true); assert.equal(state.detail, true);
    assert.equal(state.value, ready.value);
    calls.length = 0;
    await readInventoryRegions("/api/inventory/overview", { ...options, previous: state });
    assert.deepEqual(calls, ["summary", "detail"]);
  } finally { globalThis.fetch = native; }
});
