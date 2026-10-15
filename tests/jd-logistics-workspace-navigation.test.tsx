import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Server rendering checks the actual navigation without a browser or API calls.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context); }')}`, import.meta.url);
const { default: Workspace } = await import("../app/jd-logistics-cwarehouse-view");

function render(input: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: `http://localhost/${input}` } } });
  try { return renderToStaticMarkup(createElement(Workspace, { currentUser: null })); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}

test("actual JD workspace exposes exactly four direct tabs with inventory monitor as default", () => {
  const html = render("?module=inventory&view=inbound");
  assert.match(html, /aria-label="京东入仓监控工作区"/);
  assert.equal((html.slice(0, html.indexOf("</div>")).match(/role="tab"/g) ?? []).length, 4);
  assert.match(html, /aria-selected="true"[^>]*>库存监控<\/button>/);
  for (const label of ["库存监控", "商品对照", "库存流水", "调拨核对"]) assert.ok(html.includes(`>${label}</button>`));
  assert.doesNotMatch(html, /京东 POP|C仓监控|账号设置|导入记录<\/button>/);
  assert.match(html, /<h2>库存监控<\/h2>/);
});

test("actual workspace selects legacy and canonical links without an intermediate source row", () => {
  for (const [query, label] of [
    ["jdTab=mappings", "商品对照"], ["jdTab=flows", "库存流水"], ["jdTab=transfers", "调拨核对"],
    ["jdInbound=pop&jdPopTab=mappings", "商品对照"], ["jdInbound=cwarehouse&jdCTab=flows", "库存流水"],
  ]) {
    const html = render(`?module=inventory&view=inbound&${query}`);
    assert.match(html, new RegExp(`aria-selected="true"[^>]*>${label}</button>`));
    assert.match(html, new RegExp(`<h2>${label}</h2>`));
    assert.equal((html.slice(0, html.indexOf("</div>")).match(/role="tab"/g) ?? []).length, 4);
    assert.doesNotMatch(html, /京东入仓监控来源|京东 POP|<h2>C仓/);
  }
});
