import assert from "node:assert/strict";
import { createServer, request, type IncomingMessage } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { forward, type SlotRecord } from "../tools/tmall-isolated-helper";

test("a claim still reaches its worker when the client deadline precedes worker readiness", async () => {
  let received = 0;
  let releaseReady!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const ready = new Promise<void>(resolve => { releaseReady = resolve; });
  let incoming!: IncomingMessage;
  let forwarded!: Promise<void>;
  const upstream = createServer((req, res) => {
    received += 1;
    assert.equal(req.url, "/coordination/claim");
    assert.equal(req.headers["x-teruisi-helper-slot-token"], "synthetic");
    assert.equal(req.headers["x-teruisi-n8n-execution-id"], "synthetic-owner");
    res.end(JSON.stringify({ ok: true, coordinationStatus: "granted" }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const record = { status: "running", stage: "ready", ready: ready.then(() => ({ port: address.port, token: "synthetic", stop: async () => undefined })) } as SlotRecord;
  const front = createServer((req, res) => {
    incoming = req;
    forwarded = forward(req, res, record);
    void forwarded.catch(() => undefined);
    started();
  });
  await new Promise<void>(resolve => front.listen(0, "127.0.0.1", resolve));
  const frontAddress = front.address();
  assert.ok(frontAddress && typeof frontAddress !== "string");
  const client = request({ hostname: "127.0.0.1", port: frontAddress.port, method: "POST", path: "/coordination/claim",
    headers: { "content-length": "0", "x-teruisi-n8n-execution-id": "synthetic-owner" } });
  client.on("error", () => undefined);
  try {
    client.end();
    await requestStarted;
    const disconnected = new Promise<void>(resolve => incoming.once("aborted", resolve));
    client.destroy();
    await disconnected;
    assert.equal(incoming.destroyed, true);
    releaseReady();
    await Promise.race([forwarded, delay(3000).then(() => { throw new Error("forward remained stuck after disconnected claim"); })]);
    assert.equal(received, 1);
  } finally {
    client.destroy();
    await Promise.all([front, upstream].map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
  }
});

test("disconnecting n8n does not cancel an already submitted business request", async () => {
  let releaseBusiness!: () => void;
  let reached!: () => void;
  const businessReady = new Promise<void>(resolve => { reached = resolve; });
  const businessGate = new Promise<void>(resolve => { releaseBusiness = resolve; });
  let completed = false;
  let forwarded!: Promise<void>;
  const upstream = createServer(async (_req, res) => {
    reached();
    await businessGate;
    completed = true;
    res.end(JSON.stringify({ ok: true, stage: "executed" }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const record = { status: "running", stage: "planned", ready: Promise.resolve({ port: address.port, token: "synthetic", stop: async () => undefined }) } as SlotRecord;
  const front = createServer((req, res) => { forwarded = forward(req, res, record); void forwarded.catch(() => undefined); });
  await new Promise<void>(resolve => front.listen(0, "127.0.0.1", resolve));
  const frontAddress = front.address();
  assert.ok(frontAddress && typeof frontAddress !== "string");
  const client = request({ hostname: "127.0.0.1", port: frontAddress.port, method: "POST", path: "/jd-logistics/run", headers: { "content-length": "0" } });
  client.on("error", () => undefined);
  try {
    client.end();
    await businessReady;
    client.destroy();
    releaseBusiness();
    await forwarded;
    assert.equal(completed, true);
    assert.equal(record.stage, "executed");
  } finally {
    releaseBusiness(); client.destroy();
    await Promise.all([front, upstream].map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
  }
});
