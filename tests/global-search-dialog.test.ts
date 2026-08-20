import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deriveGlobalSearchPresentation,
  globalSearchGroupKeys,
  nextGlobalSearchGroupPage,
  parseGlobalSearchTarget,
  type GlobalSearchResult,
  type GlobalSearchTarget,
} from "../app/global-search-dialog";

const emptyResult: GlobalSearchResult = {
  query: "净水器",
  page: 1,
  returned: 0,
  truncated: false,
  groups: [],
  unavailableDomains: [],
};

test("global search presentation preserves guide, short, loading, error, and result semantics", () => {
  assert.deepEqual(deriveGlobalSearchPresentation("   ", false, "", null), {
    showGuide: true,
    showShortQuery: false,
    showLoading: false,
    showError: false,
    showResult: false,
  });
  assert.deepEqual(deriveGlobalSearchPresentation("净", false, "", null), {
    showGuide: false,
    showShortQuery: true,
    showLoading: false,
    showError: false,
    showResult: false,
  });
  assert.deepEqual(deriveGlobalSearchPresentation("净水", true, "", emptyResult), {
    showGuide: false,
    showShortQuery: false,
    showLoading: true,
    showError: false,
    showResult: false,
  });
  assert.deepEqual(deriveGlobalSearchPresentation("净", true, "查询失败", emptyResult), {
    showGuide: false,
    showShortQuery: true,
    showLoading: true,
    showError: true,
    showResult: false,
  });
  assert.deepEqual(deriveGlobalSearchPresentation("净水", false, "查询失败", emptyResult), {
    showGuide: false,
    showShortQuery: false,
    showLoading: false,
    showError: true,
    showResult: false,
  });
  assert.deepEqual(deriveGlobalSearchPresentation("净水", false, "", emptyResult), {
    showGuide: false,
    showShortQuery: false,
    showLoading: false,
    showError: false,
    showResult: true,
  });
});

test("group pagination advances a bounded positive page", () => {
  assert.deepEqual(globalSearchGroupKeys, [
    "products", "orders", "jd_products", "inventory", "inventory_age", "combos", "replenishment",
    "market_skus", "market_annotations", "customer_service", "finance", "targets", "workflow", "imports",
  ]);
  assert.equal(nextGlobalSearchGroupPage(), 2);
  assert.equal(nextGlobalSearchGroupPage(3), 4);
  assert.equal(nextGlobalSearchGroupPage(3, 7), 8);
  assert.equal(nextGlobalSearchGroupPage(-5, Number.NaN), 2);
  assert.equal(nextGlobalSearchGroupPage(1, 1_000_000), 10_000);
});

test("optional deep-link targets accept only catalog modules, matching views, and bounded entities", () => {
  const typedTarget: GlobalSearchTarget<"market"> = {
    module: "market",
    view: "compare",
    entity: { kind: "market_sku", id: "sku-1001" },
  };
  assert.deepEqual(parseGlobalSearchTarget(typedTarget), typedTarget);
  assert.deepEqual(parseGlobalSearchTarget({ module: "workflow", view: "plan" }), {
    module: "workflow",
    view: "plan",
  });

  for (const unsafe of [
    { module: "market", view: "compare", url: "https://evil.example" },
    { module: "unknown", view: "overview" },
    { module: "inventory", view: "compare" },
    { module: "market", entity: { kind: "unknown", id: "1" } },
    { module: "market", entity: { kind: "market_sku", id: "bad\nvalue" } },
    { module: "market", entity: { kind: "market_sku", id: "1", url: "/admin" } },
  ]) {
    assert.equal(parseGlobalSearchTarget(unsafe), null);
  }
});

test("dialog is fully controlled, accessible, and contains no data or navigation side effects", async () => {
  const source = await readFile(new URL("../app/global-search-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /type GlobalSearchDialogProps = \{/);
  for (const prop of [
    "open", "query", "result", "loading", "error", "onQueryChange", "onClose",
    "onSelectItem", "onSelectQuickModule", "onLoadMoreGroup", "loadingGroup", "loadMoreError",
  ]) {
    assert.match(source, new RegExp(`\\b${prop}[?]?:`));
  }
  assert.match(source, /<Dialog/);
  assert.match(source, /initialFocusRef=\{inputRef\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-label=\{`加载更多\$\{group\.label\}结果`\}/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
  assert.match(source, /onLoadMoreGroup\(group\.key, nextPage\)/);
  assert.match(source, /onSelectItem\(item\)/);
  assert.match(source, /onSelectQuickModule\(item\.key\)/);
  assert.match(source, /\{loadMoreError && <div className="search-state search-state-error" role="alert">/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /window\.(?:history|location)/);
  assert.doesNotMatch(source, /\bhistory\.(?:pushState|replaceState)/);
  assert.doesNotMatch(source, /href\s*=/);
});
