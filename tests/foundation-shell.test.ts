import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createReloadableLazyController } from "../app/shell/reloadable-lazy";
import Loading from "../app/shell/module-loading-state";

test("loading regions reserve space, expose text/status and hide decorative spinner", () => {
  const html = renderToStaticMarkup(createElement(Loading, { title: "正在加载销售" }, "请稍候"));
  assert.match(html, /min-height:160px/); assert.match(html, /role="status"/); assert.match(html, /aria-atomic="true"/); assert.match(html, /aria-hidden="true"/); assert.match(html, /正在加载销售/);
});
test("registration is lazy; explicit preload joins mount and reset permits failed chunk retry", async () => {
  let calls = 0; let release!: (value: { default: () => null }) => void;
  const controller = createReloadableLazyController<object>(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(calls, 0); const a = controller.preload(); const b = controller.preload(); assert.equal(a, b); await Promise.resolve(); assert.equal(calls, 1);
  release({ default: () => null }); await a;
  const lazy = controller.current as unknown as { _init: (p: unknown) => unknown; _payload: unknown };
  try { lazy._init(lazy._payload); } catch (pending) { await pending; }
  assert.equal(calls, 1); controller.reset(); const c = controller.preload(); await Promise.resolve(); assert.equal(calls, 2); release({ default: () => null }); await c;
  let attempts = 0; const failed = createReloadableLazyController<object>(async () => { if (++attempts === 1) throw Error("fixture"); return { default: () => null }; });
  await assert.rejects(failed.preload(), /fixture/); failed.reset(); await failed.preload(); assert.equal(attempts, 2);
});
