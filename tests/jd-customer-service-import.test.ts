import assert from "node:assert/strict";
import test from "node:test";
import { customerServiceLocalBaseUrl, importCustomerServiceDay, verifyCustomerServiceBatch, type CustomerServiceBatchProof } from "../tools/jd-customer-service-import";
import { jdCustomerServiceWorkflow } from "../lib/jd/customer-service-workflow";
import type { CustomerServiceDailyFile } from "../tools/jd-customer-service-daily-files";
const batch = { id: `cs_${"a".repeat(64)}`, fileHash: "b".repeat(64), shopName: jdCustomerServiceWorkflow.shopName,
  status: "completed", completedAt: "2026-10-06T01:00:00Z", conversationCount: 1, matchedCount: 1,
  sessionOnlyCount: 0, chatOnlyCount: 0, ambiguousCount: 0, warningTotalCount: 0 };
const day: CustomerServiceDailyFile = { date: "2026-10-05", sessionBytes: new Uint8Array([1]), chatBytes: new Uint8Array([2]),
  sessionSha256: "c".repeat(64), chatSha256: "d".repeat(64), contentSha256: "e".repeat(64), conversationCount: 1, normalizedBytes: 1,
  summary: { sessionCount: 1, chatSessionCount: 1, matchedCount: 1, timeOnlyMatchedCount: 0, sessionOnlyCount: 0, chatOnlyCount: 0, ambiguousCount: 0 } };
const proof: CustomerServiceBatchProof = { ...batch, batchId: batch.id, date: day.date, status: "imported" };
test("导入只允许固定本机回环入口，拒绝重定向和外部地址", () => {
  assert.equal(customerServiceLocalBaseUrl("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["http://localhost:3001", "http://localhost.attacker.invalid:3000", "http://user@localhost:3000", "http://127.0.0.1:3000/path"])
    assert.throws(() => customerServiceLocalBaseUrl(value));
});
test("导入只提交一次，HTTP和精确店铺计数都必须吻合", async () => {
  let calls = 0;
  const request = (async (_url, init) => { calls++; assert.equal(init?.redirect, "error");
    assert.equal((init?.body as FormData).get("shopName"), jdCustomerServiceWorkflow.shopName);
    return Response.json({ ok: true, status: "imported", batch }, { status: 201 }); }) as typeof fetch;
  assert.equal((await importCustomerServiceDay(day, "http://localhost:3000", request)).batchId, batch.id);
  assert.equal(calls, 1);
  for (const changed of [{ ...batch, shopName: "wrong" }, { ...batch, conversationCount: 2 }]) {
    await assert.rejects(importCustomerServiceDay(day, "http://localhost:3000", (async () => Response.json({ ok: true, status: "imported", batch: changed }, { status: 201 })) as typeof fetch));
  }
  await assert.rejects(importCustomerServiceDay(day, "http://localhost:3000", (async () => { throw new Error("connection lost"); }) as typeof fetch));
});
test("回查在完整有界分页中寻找精确批次，不能使用首条替代", async () => {
  let calls = 0;
  await verifyCustomerServiceBatch(proof, "http://localhost:3000", (async () => {
    calls++;
    return Response.json({ items: calls === 1 ? [{ ...batch, id: `cs_${"f".repeat(64)}` }] : [batch],
      pagination: { page: calls, pageSize: 100, total: 101, returned: 1, truncated: calls === 1 } });
  }) as typeof fetch);
  assert.equal(calls, 2);
});
test("缺失批次、损坏分页、变动指纹均不得确认导入成功", async () => {
  for (const payload of [
    { items: [], pagination: { page: 1, pageSize: 100, total: 0, returned: 0, truncated: false } },
    { items: [batch], pagination: { page: 1, pageSize: 100, total: 1, returned: 2, truncated: false } },
    { items: [{ ...batch, fileHash: "c".repeat(64) }], pagination: { page: 1, pageSize: 100, total: 1, returned: 1, truncated: false } },
  ]) await assert.rejects(verifyCustomerServiceBatch(proof, "http://localhost:3000", (async () => Response.json(payload)) as typeof fetch));
});
const okPage = (page: number, truncated = false) => Response.json({ items: page === 2 || !truncated ? [batch] : [{ ...batch, id: `cs_${"f".repeat(64)}` }],
  pagination: { page, pageSize: 100, total: 101, returned: 1, truncated } });
test("回查仅对503有界重试，每次从第1页重扫，退避1s/3s/6s", async () => {
  const urls: string[] = []; const waits: number[] = []; let n = 0;
  await verifyCustomerServiceBatch(proof, "http://localhost:3000", (async (url: string) => { urls.push(url); n++;
    if (n === 1) return okPage(1, true);                                  // attempt 1, page 1 fine
    if (n === 2) return new Response("{}", { status: 503 });              // attempt 1, page 2 revision moved
    if (n === 3) return new Response("{}", { status: 503 });              // attempt 2, page 1
    return okPage(n === 4 ? 1 : 2, n === 4); }) as typeof fetch, undefined, { sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [1000, 3000]);
  assert.deepEqual(urls.map(u => new URL(u).searchParams.get("page")), ["1", "2", "1", "1", "2"]);
});
test("503耗尽后仍为BATCH_READBACK_FAILED，共4次尝试", async () => {
  const waits: number[] = []; let calls = 0;
  await assert.rejects(verifyCustomerServiceBatch(proof, "http://localhost:3000", (async () => { calls++; return new Response("{}", { status: 503 }); }) as typeof fetch,
    undefined, { sleep: async ms => { waits.push(ms); } }), /BATCH_READBACK_FAILED/);
  assert.equal(calls, 4); assert.deepEqual(waits, [1000, 3000, 6000]);
});
test("非503状态不重试且保持原拒绝码", async () => {
  for (const status of [500, 502, 404, 429]) {
    let calls = 0; let slept = 0;
    await assert.rejects(verifyCustomerServiceBatch(proof, "http://localhost:3000", (async () => { calls++; return new Response("{}", { status }); }) as typeof fetch,
      undefined, { sleep: async () => { slept++; } }), /BATCH_READBACK_FAILED/);
    assert.equal(calls, 1); assert.equal(slept, 0);
  }
});
