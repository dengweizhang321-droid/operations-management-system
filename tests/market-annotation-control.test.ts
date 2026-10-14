import assert from "node:assert/strict";
import test from "node:test";
import { createAnnotationControlChannel } from "../lib/market/annotation-control-channel";
import { annotationControlCommand, annotationControlOutcome, annotationControlRequestId } from "../lib/market/annotation-control-contract";
import { requestAnnotationControl } from "../lib/django/market-service";

const command = () => annotationControlCommand({ action: "set_cloud_run_state", jobId: "test-job", state: "running", expectedControlVersion: "a".repeat(64), operationId: "11111111-1111-4111-8111-111111111111" });
const intent = () => { const value = command(); return { jobId: value.jobId, state: value.state, expectedControlVersion: value.expectedControlVersion }; };
const success = () => ({ outcome: "succeeded", operationId: command().operationId, requestId: annotationControlRequestId(command()), jobId: command().jobId, targetState: "running",
  result: { operationId: command().operationId, requestId: annotationControlRequestId(command()), jobId: command().jobId, targetState: "running", beforeControlVersion: "a".repeat(64), afterControlVersion: "b".repeat(64), auditId: "22222222-2222-4222-8222-222222222222", committedAt: "2026-10-15T01:00:00Z", effectiveState: "running", resumeAccepted: true, quarantinedExpiredClaims: false } });
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } }; };
const setup = (fetchImpl: typeof fetch, store = storage(), onChange?: (value: unknown) => void) => {
  const channel = createAnnotationControlChannel({ fetchImpl, storage: store, onChange, newId: () => command().operationId });
  channel.selectScope("actor@example.test|operator|false", "test-job"); return channel;
};
test("commit with lost response is confirmed through GET, with exactly one POST", async () => {
  const methods: string[] = [];
  const channel = setup(async (_url, init) => { methods.push(init?.method ?? "GET"); return init?.method === "POST" ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(success()); });
  assert.equal((await channel.submit(intent()))?.outcome, "succeeded");
  assert.deepEqual(methods, ["POST", "GET"]); assert.equal(channel.hasPending(), false);
});
test("missing receipt and permission failure remain unknown and prevent duplicate/new intent", async () => {
  let posts = 0;
  const channel = setup(async (_url, init) => { if (init?.method === "POST") posts++; return Response.json({}, { status: 403 }); });
  assert.equal((await channel.submit(intent()))?.outcome, "unknown");
  await assert.rejects(channel.submit(intent()), /未确认/);
  assert.equal((await channel.query())?.outcome, "unknown"); assert.equal(posts, 1); assert.equal(channel.hasPending(), true);
});
test("explicit persisted rejection permits only a new human intent", async () => {
  const channel = setup(async (_url, init) => init?.method === "POST" ? Response.json({}, { status: 409 }) : Response.json({ ...success(), outcome: "rejected", error: "version conflict" }));
  assert.equal((await channel.submit(intent()))?.outcome, "rejected"); assert.equal(channel.hasPending(), false);
});
test("unknown operation survives refresh and role/scope changes for same actor without POST replay", async () => {
  const store = storage(); let posts = 0;
  const first = setup(async (_url, init) => { if (init?.method === "POST") posts++; return Response.json({}, { status: 503 }); }, store);
  await first.submit(intent());
  const second = setup(async (_url, init) => { assert.notEqual(init?.method, "POST"); return Response.json(success()); }, store);
  second.selectScope("actor@example.test|admin|true", "test-job");
  assert.equal(second.hasPending(), true); assert.equal((await second.query())?.outcome, "succeeded"); assert.equal(posts, 1);
  second.selectScope("other@example.test|admin|false", "test-job"); assert.equal(second.hasPending(), false);
});
test("cancellation plus late response cannot publish or clear another scope's operation", async () => {
  let resolve!: (value: Response) => void;
  const old = new Promise<Response>((done) => { resolve = done; });
  const changes: unknown[] = [];
  const channel = setup(async () => old, storage(), (value) => changes.push(value));
  const pending = channel.submit(intent());
  channel.cancel(); channel.selectScope("actor@example.test|operator|false", "new-job");
  const count = changes.length;
  resolve(Response.json({ ok: true, result: success().result }));
  assert.equal(await pending, null); assert.equal(changes.length, count); assert.equal(channel.hasPending(), true);
});
test("same job double click is fenced while first POST is pending", async () => {
  let resolve!: (value: Response) => void;
  const first = new Promise<Response>((done) => { resolve = done; });
  let posts = 0;
  const channel = setup(async () => { posts++; return first; });
  const pending = channel.submit(intent());
  await assert.rejects(channel.submit(intent()), /未确认/);
  resolve(Response.json({ ok: true, result: success().result })); await pending; assert.equal(posts, 1);
});
test("foreign tuple, malformed success and current running do not prove original commit", () => {
  const valid = success();
  for (const value of [{ job: { status: "running" } }, { ...valid, jobId: "other" }, { ...valid, result: { ...valid.result, beforeControlVersion: "x" } }, { ...valid, result: { ...valid.result, auditId: "bad" } }]) {
    assert.equal(annotationControlOutcome(command(), value).outcome, "unknown");
  }
  assert.throws(() => annotationControlCommand({ ...command(), actor: "spoofed" }));
});
test("signed SDK binds one operation to writer requestId and preserves exact command bytes", async () => {
  const seen: { url: string; id: string | null; body: unknown }[] = [];
  const principal = { email: "actor@example.test", role: "operator", displayName: "Actor", scope: null } as const;
  const config = { readerBaseUrl: "http://127.0.0.1:8031", writerBaseUrl: "http://127.0.0.1:8032", internalSecret: "x".repeat(40) };
  const fetchImpl: typeof fetch = async (url, init) => { seen.push({ url: String(url), id: new Headers(init?.headers).get("x-teruisi-request-id"), body: JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) }); return Response.json({}, { headers: { "x-market-data-revision": "1:aaaaaaaaaaaa" } }); };
  await requestAnnotationControl(principal, command(), false, { config, fetchImpl });
  await requestAnnotationControl(principal, command(), true, { config, fetchImpl });
  assert.ok(seen.every((value) => value.url === "http://127.0.0.1:8032/api/market/commands"));
  assert.equal(seen[0].id, annotationControlRequestId(command())); assert.notEqual(seen[1].id, seen[0].id);
  assert.deepEqual(seen[0].body, { contractVersion: "market-command-v1", domain: "annotations", command: command() });
  assert.deepEqual(seen[1].body, { contractVersion: "market-annotation-control-query-v1", command: command() });
});

test("twenty pending controls are preserved; the twenty-first and malformed storage fail closed", async () => {
  const saved = Array.from({ length: 20 }, (_, index) => ({ ...command(), jobId: "job-"+index,
    operationId: index.toString(16).padStart(8, "0")+"-1111-4111-8111-111111111111" }));
  const store = storage(); store.setItem("market-annotation-control-v1:actor%40example.test", JSON.stringify(saved));
  let posts = 0;
  const channel = setup(async () => { posts++; return Response.json({}); }, store);
  await assert.rejects(channel.submit(intent())); assert.equal(posts, 0); assert.equal(channel.hasPending(), true);
  for (const raw of [JSON.stringify([...saved, { ...command(), jobId: "overflow" }]), "not-json", "{}", JSON.stringify([{ bad: true }])]) {
    store.setItem("market-annotation-control-v1:actor%40example.test", raw);
    channel.selectScope("actor@example.test|operator|false", "different-"+raw.length);
    assert.equal(channel.hasPending(), true); assert.match(channel.problem(), /无法核实/);
    await assert.rejects(channel.submit({ ...intent(), jobId: "different-"+raw.length }));
  }
  assert.equal(posts, 0);
});
test("storage write failure stops transmission, and ignored abort is still bounded", async () => {
  let posts = 0;
  const failedStore = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const failed = setup(async () => { posts++; return Response.json({}); }, failedStore);
  await assert.rejects(failed.submit(intent()), /无法保存/); assert.equal(posts, 0);
  const bounded = createAnnotationControlChannel({ storage: storage(), newId: () => command().operationId,
    postTimeoutMs: 10, queryTimeoutMs: 10, confirmationMs: 15, fetchImpl: () => new Promise(() => undefined) });
  bounded.selectScope("actor@example.test|operator|false", "test-job");
  assert.equal((await bounded.submit(intent()))?.outcome, "unknown"); assert.equal(bounded.hasPending(), true);
});
