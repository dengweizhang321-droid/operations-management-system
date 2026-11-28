import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { IsolatedHelperSlots, isolatedRequestIdentity, spawnIsolatedHelper, type HelperSlot, type SlotIdentity } from "../tools/tmall-isolated-helper";

function identity(storeKey: string, executionId: string): SlotIdentity {
  return { key: storeKey, storeKey, workflow: "tmall", executionId };
}
function fixture() {
  const finishes = new Map<string, (clean: boolean) => void>();
  const starts: string[] = [];
  const allowed = new Set(["tmall-lili", "tmall-yijiu", "tmall-yiyong", "tmall-tuofeng", "tmall-cuizhiwang", "tmall-masitu"]);
  const pool = new IsolatedHelperSlots(allowed, async (owner, finish) => {
    starts.push(owner.key); finishes.set(owner.key, finish);
    return { port: 12345, token: "synthetic", stop: async () => undefined };
  });
  return { pool, finishes, starts, allowed };
}

test("six independent Tmall slots start without waiting for another store", async () => {
  const { pool, allowed, starts } = fixture();
  const decisions = [...allowed].map((key, index) => pool.claim(identity(key, String(index))));
  assert.ok(decisions.every(item => item.status === "granted"));
  await Promise.all(decisions.map(item => item.slot!.ready));
  assert.equal(new Set(starts).size, 6);
  assert.equal(pool.summary().length, 6);
});

test("simultaneous same-store claims reserve synchronously and spawn once", async () => {
  const { pool, starts } = fixture();
  const first = pool.claim(identity("tmall-lili", "100"));
  assert.equal(pool.claim(identity("tmall-lili", "101")).status, "waiting");
  assert.equal(pool.claim(identity("tmall-lili", "100")).slot, first.slot);
  assert.equal(pool.claim(identity("tmall-yijiu", "100")).reason, "execution_store_context_mismatch");
  await first.slot!.ready;
  assert.deepEqual(starts, ["tmall-lili"]);
  assert.equal(pool.lookup(identity("tmall-lili", "101")), null);
});

test("one failed/finished store releases only itself, and late callbacks cannot remove a replacement", async () => {
  const { pool, finishes } = fixture();
  const first = pool.claim(identity("tmall-lili", "100"));
  const other = pool.claim(identity("tmall-yijiu", "200"));
  await Promise.all([first.slot!.ready, other.slot!.ready]);
  const finish = finishes.get("tmall-lili")!;
  assert.equal(pool.admitBusiness(identity("tmall-lili", "100")), first.slot);
  finish(true);
  assert.equal(pool.lookup(identity("tmall-yijiu", "200")), other.slot);
  assert.equal(pool.claim(identity("tmall-lili", "100")).reason, "execution_already_finished");
  const retry = pool.claim(identity("tmall-lili", "101"));
  await retry.slot!.ready;
  finish(true);
  assert.equal(pool.lookup(identity("tmall-lili", "101")), retry.slot);
});

test("clean idle release of a claim-only slot does not retire the execution, so the same id can re-claim", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const finishes = new Map<string, (clean: boolean) => void>();
  const pool = new IsolatedHelperSlots(new Set(["tmall-masitu"]), async (owner, finish) => {
    finishes.set(owner.key, finish);
    return { port: 12345, token: "synthetic", stop: async () => undefined };
  }, () => false, diagnostic => { diagnostics.push(diagnostic); });
  const first = pool.claim(identity("tmall-masitu", "300"));
  await first.slot!.ready;
  assert.equal(first.slot!.businessForwarded, false);
  finishes.get("tmall-masitu")!(true);
  assert.equal(pool.slots.size, 0);
  const again = pool.claim(identity("tmall-masitu", "300"));
  assert.equal(again.status, "granted");
  assert.notEqual(again.slot, first.slot);
  await again.slot!.ready;
  assert.deepEqual(diagnostics, [{ event: "helper_idle_release_not_retired", workflow: "tmall", storeKey: "tmall-masitu", executionId: "300", reason: "claim_only_idle_release" }]);
});

test("clean release after a business route was forwarded still retires the execution, and rejection is reported", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const finishes = new Map<string, (clean: boolean) => void>();
  const pool = new IsolatedHelperSlots(new Set(["tmall-masitu"]), async (owner, finish) => {
    finishes.set(owner.key, finish);
    return { port: 12345, token: "synthetic", stop: async () => undefined };
  }, () => false, diagnostic => { diagnostics.push(diagnostic); });
  const first = pool.claim(identity("tmall-masitu", "301"));
  await first.slot!.ready;
  assert.equal(pool.admitBusiness(identity("tmall-masitu", "301")), first.slot);
  finishes.get("tmall-masitu")!(true);
  const again = pool.claim(identity("tmall-masitu", "301"));
  assert.equal(again.reason, "execution_already_finished");
  assert.deepEqual(diagnostics, [{ event: "helper_claim_rejected", workflow: "tmall", storeKey: "tmall-masitu", executionId: "301", reason: "execution_already_finished" }]);
});

function jackyun(executionId: string, scheduledAt = "2026-11-28T16:10:00.438Z"): SlotIdentity {
  return { key: "legacy", storeKey: null, workflow: "jackyun", executionId, scheduledAt };
}
function jackyunFixture(now = () => 0) {
  const diagnostics: Array<Record<string, unknown>> = [];
  const finishes: Array<(clean: boolean, waitRelease?: boolean) => void> = [];
  const pool = new IsolatedHelperSlots(new Set(), async (_owner, finish) => {
    finishes.push(finish);
    return { port: 12345, token: "synthetic", stop: async () => undefined };
  }, () => false, diagnostic => { diagnostics.push(diagnostic); }, now);
  return { pool, finishes, diagnostics };
}

test("Jackyun recovery-wait release keeps the same execution resumable once, with the same anchor", async () => {
  const { pool, finishes, diagnostics } = jackyunFixture();
  const first = pool.claim(jackyun("12074"));
  await first.slot!.ready;
  assert.equal(pool.admitBusiness(jackyun("12074")), first.slot);
  finishes[0](true, true);
  assert.equal(pool.slots.size, 0);
  assert.deepEqual(diagnostics, [{ event: "helper_wait_release_resumable", workflow: "jackyun", storeKey: null, executionId: "12074", reason: "recovery_wait_release" }]);
  assert.equal(pool.claim(jackyun("12074", "2026-11-28T17:31:01.754Z")).reason, "execution_plan_anchor_changed_manual_action");
  const resumed = pool.claim(jackyun("12074"));
  assert.equal(resumed.status, "granted");
  assert.notEqual(resumed.slot, first.slot);
  await resumed.slot!.ready;
  pool.admitBusiness(jackyun("12074"));
  // A later ordinary clean finish (no wait) retires it as before.
  finishes[1](true);
  assert.equal(pool.claim(jackyun("12074")).reason, "execution_already_finished");
});

test("wait release is ignored for non-Jackyun workflows, unclean exits and expired entries", async () => {
  const tmall = new Map<string, (clean: boolean, waitRelease?: boolean) => void>();
  const tmallPool = new IsolatedHelperSlots(new Set(["tmall-lili"]), async (owner, finish) => {
    tmall.set(owner.key, finish);
    return { port: 12345, token: "synthetic", stop: async () => undefined };
  });
  await tmallPool.claim(identity("tmall-lili", "500")).slot!.ready;
  tmallPool.admitBusiness(identity("tmall-lili", "500"));
  tmall.get("tmall-lili")!(true, true);
  assert.equal(tmallPool.claim(identity("tmall-lili", "500")).reason, "execution_already_finished");

  const unclean = jackyunFixture();
  await unclean.pool.claim(jackyun("501")).slot!.ready;
  unclean.pool.admitBusiness(jackyun("501"));
  unclean.finishes[0](false, true);
  assert.equal(unclean.pool.claim(jackyun("501")).reason, "helper_slot_cleanup_requires_manual_action");

  let clock = 0;
  const expired = jackyunFixture(() => clock);
  await expired.pool.claim(jackyun("502")).slot!.ready;
  expired.pool.admitBusiness(jackyun("502"));
  expired.finishes[0](true, true);
  clock = 360 * 60_000 + 1;
  assert.equal(expired.pool.claim(jackyun("502")).reason, "execution_already_finished");
});

test("real worker forwards waitRelease to finish only with a clean exit", async () => {
  const fixture = fileURLToPath(new URL("fixtures/tmall-isolated-worker.mjs", import.meta.url));
  const owner = jackyun("600");
  for (const [route, expected] of [["/finish", [true, false]], ["/wait-release", [true, true]]] as const) {
    let done!: (value: [boolean, boolean]) => void;
    const finished = new Promise<[boolean, boolean]>(resolve => { done = resolve; });
    const child = await spawnIsolatedHelper(fixture, owner, (clean, waitRelease) => done([clean, waitRelease === true]));
    const response = await fetch(`http://127.0.0.1:${child.port}${route}`, { headers: { "x-teruisi-helper-slot-token": child.token, connection: "close" }, signal: AbortSignal.timeout(5000) });
    await response.text();
    assert.deepEqual(await finished, expected);
  }
});

test("operator close retires a wait-released Jackyun execution", async () => {
  const { pool, finishes } = jackyunFixture();
  await pool.claim(jackyun("503")).slot!.ready;
  pool.admitBusiness(jackyun("503"));
  finishes[0](true, true);
  const close = pool.closeCoordinator().freeze(["503"]);
  close.complete(); close.release();
  assert.equal(pool.claim(jackyun("503")).reason, "execution_already_finished");
});

test("admitBusiness marks only a matching running slot; a mismatched identity leaves a claim-only slot re-claimable", async () => {
  const { pool, finishes } = fixture();
  const claimed = pool.claim(identity("tmall-lili", "400"));
  await claimed.slot!.ready;
  assert.equal(pool.admitBusiness(identity("tmall-lili", "999")), null);
  assert.equal(claimed.slot!.businessForwarded, false);
  finishes.get("tmall-lili")!(true);
  const again = pool.claim(identity("tmall-lili", "400"));
  assert.equal(again.status, "granted");
  assert.notEqual(again.slot, claimed.slot);
  await again.slot!.ready;
  assert.equal(pool.admitBusiness(identity("tmall-lili", "400")), again.slot);
  assert.equal(again.slot!.businessForwarded, true);
  finishes.get("tmall-lili")!(true);
  assert.equal(pool.claim(identity("tmall-lili", "400")).reason, "execution_already_finished");
});

test("unclean exit of a claim-only slot is still quarantined and retired",async () => {
  const { pool, finishes } = fixture();
  await pool.claim(identity("tmall-lili", "302")).slot!.ready;
  finishes.get("tmall-lili")!(false);
  assert.equal(pool.claim(identity("tmall-lili", "302")).reason, "helper_slot_cleanup_requires_manual_action");
  assert.equal(pool.slots.get("tmall-lili")!.status, "quarantined");
});

test("unknown termination quarantines that store while other Tmall stores run", async () => {
  const { pool, finishes } = fixture();
  await pool.claim(identity("tmall-lili", "100")).slot!.ready;
  finishes.get("tmall-lili")!(false);
  assert.match(pool.claim(identity("tmall-lili", "101")).reason!, /manual_action/);
  assert.equal(pool.claim(identity("tmall-yijiu", "200")).status, "granted");
});

test("legacy workflows retain shared exclusion; disabled/unknown stores cannot allocate", async () => {
  const { pool, starts } = fixture();
  assert.equal(pool.claim(identity("tmall-ledu", "1")).status, "rejected");
  const legacy = { key: "legacy", storeKey: null, workflow: "jd", executionId: "2" };
  const first = pool.claim(legacy);
  await first.slot!.ready;
  assert.equal(pool.claim(identity("tmall-lili", "3")).status, "waiting");
  assert.equal(pool.claim({ ...legacy, workflow: "jackyun", executionId: "4" }).status, "waiting");
  assert.deepEqual(starts, ["legacy"]);
});

test("router rejects missing/array identities and never infers Tmall from a legacy route", () => {
  const headers = { "x-teruisi-n8n-execution-id": "123", "x-teruisi-tmall-store-key": "tmall-lili", "x-teruisi-workflow-key": "tmall" };
  assert.deepEqual(isolatedRequestIdentity("/coordination/claim", headers), identity("tmall-lili", "123"));
  assert.deepEqual(isolatedRequestIdentity("/product-master-direct-v1", headers), identity("tmall-lili", "123"));
  for (const route of ["/unknown", "/product-master-direct-v1?store=other", "/health"]) assert.equal(isolatedRequestIdentity(route, headers), null);
  assert.equal(isolatedRequestIdentity("/plan", { ...headers, "x-teruisi-tmall-store-key": ["tmall-lili", "tmall-yijiu"] }), null);
  assert.equal(isolatedRequestIdentity("/plan", { ...headers, "x-teruisi-n8n-execution-id": "" }), null);
  assert.equal(isolatedRequestIdentity("/jd/plan", headers)?.key, "legacy");
});

test("real worker exits release only a clean store; a crash quarantines only its own store", async () => {
  const children: HelperSlot[] = [];
  const exits = new Map<string, Promise<boolean>>();
  const pool = new IsolatedHelperSlots(new Set(["tmall-lili", "tmall-yijiu", "tmall-yiyong"]), async (owner, finish) => {
    let exited!: (clean: boolean) => void;
    exits.set(owner.executionId, new Promise(resolve => { exited = resolve; }));
    const child = await spawnIsolatedHelper(fileURLToPath(new URL("fixtures/tmall-isolated-worker.mjs", import.meta.url)), owner, clean => { finish(clean); exited(clean); });
    children.push(child);
    return child;
  });
  async function send(child: HelperSlot, route: string) {
    const response = await fetch(`http://127.0.0.1:${child.port}${route}`, { headers: { "x-teruisi-helper-slot-token": child.token, connection: "close" }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    await response.text();
  }
  async function exited(id: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([exits.get(id)!, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fixture exit timeout")), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  try {
    const lili = pool.claim(identity("tmall-lili", "lili-first"));
    const yijiu = pool.claim(identity("tmall-yijiu", "yijiu-first"));
    const [first, other] = await Promise.all([lili.slot!.ready, yijiu.slot!.ready]);
    await send(first, "/finish");
    assert.equal(await exited("lili-first"), true);
    assert.equal(pool.lookup(identity("tmall-yijiu", "yijiu-first")), yijiu.slot);
    const retry = pool.claim(identity("tmall-lili", "lili-retry"));
    assert.equal(retry.status, "granted");
    await retry.slot!.ready;
    await send(other, "/crash");
    assert.equal(await exited("yijiu-first"), false);
    assert.equal(pool.claim(identity("tmall-yijiu", "yijiu-retry")).status, "rejected");
    assert.equal(pool.lookup(identity("tmall-lili", "lili-retry")), retry.slot);
    const third = pool.claim(identity("tmall-yiyong", "yiyong-first"));
    assert.equal(third.status, "granted");
    await third.slot!.ready;
  } finally { await Promise.all(children.map(child => child.stop())); }
});
