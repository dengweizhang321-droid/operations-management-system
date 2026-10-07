import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Dialog, Page } from "playwright-core";
import type { TmallStore } from "../lib/netshop/tmall-store-registry";
import { installPromotionNativeDialogGuard } from "../tools/tmall-promotion-export";
import { captureTmallMtopListTemplate } from "../tools/tmall-direct-product-master-export";

function fixture() {
  const context = new EventEmitter();
  const page = new EventEmitter();
  const pages = [page];
  Object.assign(context, { pages: () => pages });
  Object.assign(page, { context: () => context });
  return { page: page as unknown as Page, context, pages };
}

test("M navigation failure observes the outstanding request promise instead of crashing the thread later", async () => {
  const errors: unknown[] = [];
  const onUnhandled = (error: unknown) => errors.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const page = { waitForRequest: () => Promise.reject(new Error("request capture failed")),
      goto: async () => { throw new Error("navigation failed"); } } as unknown as Page;
    await assert.rejects(captureTmallMtopListTemplate(page, {} as TmallStore), /navigation failed/);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("protocol rejection during informational dialog dismissal is caught and fails the stage closed", async () => {
  const { page } = fixture();
  const guard = installPromotionNativeDialogGuard(page, "货品");
  (page as unknown as EventEmitter).emit("dialog", {
    type: () => "alert", message: () => "暂无数据", page: () => page,
    dismiss: async () => { throw new Error("Protocol error (Page.handleJavaScriptDialog)"); },
  } as unknown as Dialog);
  await assert.rejects(guard.assertSafe(), /关闭结果未确认/);
  await assert.rejects(guard.dispose(), /关闭结果未确认/);
  assert.equal((page as unknown as EventEmitter).listenerCount("dialog"), 0);
});

test("unknown confirmation never accepts or leaks identifiers; new pages receive the same guard", async () => {
  const { page, context } = fixture();
  const another = new EventEmitter();
  let accepts = 0, dismisses = 0, closes = 0;
  Object.assign(another, { close: async () => { closes++; } });
  const guard = installPromotionNativeDialogGuard(page, "货品");
  context.emit("page", another);
  another.emit("dialog", {
    type: () => "confirm", message: () => "确认操作 https://example.test/private abcdefghijklmnopqrstuvwxyz12345",
    dismiss: async () => { dismisses++; }, accept: async () => { accepts++; },
    page: () => another,
  } as unknown as Dialog);
  await assert.rejects(guard.assertSafe(), error => {
    assert.match(String(error), /未允许的 confirm/);
    assert.doesNotMatch(String(error), /example\.test|abcdefghijklmnopqrstuvwxyz12345/);
    return true;
  });
  assert.equal(accepts, 0); assert.equal(dismisses, 1); assert.equal(closes, 1);
  await assert.rejects(guard.dispose());
  assert.equal(another.listenerCount("dialog"), 0);
  assert.equal(context.listenerCount("page"), 0);
});
