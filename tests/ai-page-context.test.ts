import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_PAGE_CONTEXT_CATALOG,
  AI_PAGE_FILTER_KEYS,
  buildAiPageContextPrompt,
  createAiPageContext,
  normalizeAiPageContext,
  serializeAiPageContextForSystemPrompt,
} from "../lib/ai/page-context";
import { moduleViewCatalog } from "../app/shell/navigation-catalog";
import { resolvePendingAiChatRequest } from "../app/ai-assistant-view";

test("AI page context covers every shell module and canonical subview", () => {
  assert.deepEqual(Object.keys(AI_PAGE_CONTEXT_CATALOG).sort(), Object.keys(moduleViewCatalog).sort());
  for (const [moduleKey, definition] of Object.entries(moduleViewCatalog)) {
    assert.deepEqual(
      [...AI_PAGE_CONTEXT_CATALOG[moduleKey as keyof typeof AI_PAGE_CONTEXT_CATALOG].views],
      [...definition.views],
      `${moduleKey} views must stay aligned`,
    );
  }
});

test("AI page context is normalized from a strict allowlist", () => {
  const context = createAiPageContext({
    module: "sales",
    view: "category",
    startDate: "2026-08-01",
    endDate: "2026-08-27",
  });
  assert.equal(context.moduleLabel, "销售分析");
  assert.deepEqual(context.period, { startDate: "2026-08-01", endDate: "2026-08-27" });
  assert.ok(context.suggestedTools.includes("get_sales_category_analysis"));
  assert.equal(normalizeAiPageContext({ module: "sales", view: "not-real" }), null);
  assert.equal(normalizeAiPageContext({ module: "sales", view: "category", period: { startDate: "bad", endDate: "2026-08-27" } }), null);
  assert.equal(normalizeAiPageContext({ module: "__proto__", view: "overview" }), null);
});

test("inventory and collector destinations create valid page context on navigation and refresh", () => {
  for (const [module, view] of [["inventory", "tmall_warehouse"], ["n8n_workflows", "tmall_warehouse"], ["n8n_workflows", "jd_logistics"]]) {
    const context = createAiPageContext({ module, view, startDate: "2026-10-01", endDate: "2026-10-18" });
    assert.equal(context.view, view);
    assert.deepEqual(normalizeAiPageContext(JSON.parse(serializeAiPageContextForSystemPrompt(context))), context);
  }
  assert.equal(normalizeAiPageContext({ module: "inventory", view: "unregistered_warehouse" }), null);
});

test("page context stays separate from user text and participates in retry intent", () => {
  const context = createAiPageContext({ module: "inventory", view: "age", startDate: "2026-08-01", endDate: "2026-08-27" });
  const prompt = buildAiPageContextPrompt(context);
  const serialized = serializeAiPageContextForSystemPrompt(context);
  assert.match(prompt, /库存管理 \/ age/);
  assert.equal(JSON.parse(serialized).module, "inventory");

  const first = resolvePendingAiChatRequest(null, { message: "分析异常", title: "小特对话", pageContext: context }, () => "request-1");
  const changed = resolvePendingAiChatRequest(first, {
    message: "分析异常",
    title: "小特对话",
    pageContext: createAiPageContext({ module: "inventory", view: "inbound", startDate: "2026-08-01", endDate: "2026-08-27" }),
  }, () => "request-2");
  assert.equal(first.clientRequestId, "request-1");
  assert.equal(changed.clientRequestId, "request-2");
});

test("product kind filter is preserved in page context", () => {
  const context = createAiPageContext({
    module: "product",
    view: "overview",
    filters: { productKind: "combo", query: "KIT-1" },
  });
  assert.deepEqual(context.filters, { productKind: "combo", query: "KIT-1" });
  assert.equal(
    normalizeAiPageContext({ module: "product", view: "overview", filters: { productKind: "combo" } })
      ?.filters?.productKind,
    "combo",
  );
});

test("shell page-context views and filter keys stay inside the backend allowlist", () => {
  const backend = readFileSync("backend/ai_assistant/page_context.py", "utf8");
  const backendViews = new Map<string, Set<string>>();
  for (const match of backend.matchAll(/"([a-z0-9_]+)":\s*\{([^}]*)\}/g)) {
    backendViews.set(match[1], new Set([...match[2].matchAll(/"([a-z0-9_\-]+)"/g)].map((item) => item[1])));
  }
  for (const [moduleKey, definition] of Object.entries(AI_PAGE_CONTEXT_CATALOG)) {
    const allowed = backendViews.get(moduleKey);
    assert.ok(allowed, `backend must know ${moduleKey}`);
    for (const view of definition.views) {
      assert.ok(allowed.has(view), `backend page context must accept ${moduleKey}/${view}`);
    }
  }
  const filtersBlock = /FILTERS = \{([\s\S]*?)\n\}/.exec(backend)?.[1] ?? "";
  const backendFilters = new Set([...filtersBlock.matchAll(/"([A-Za-z0-9_]+)"/g)].map((item) => item[1]));
  for (const key of AI_PAGE_FILTER_KEYS) {
    assert.ok(backendFilters.has(key), `backend page context must accept filter ${key}`);
  }
});

test("chat route validates page context and workflow injects it outside the user message", () => {
  const route = readFileSync("lib/ai/django-route.ts", "utf8");
  const workflow = readFileSync("backend/ai_assistant/chat.py", "utf8");
  assert.match(route, /normalizeAiPageContext\(payload\.pageContext\)/);
  assert.match(workflow, /<page_context>/);
  assert.match(workflow, /prompt = text\(body\["message"\]/);
  assert.match(workflow, /shortcut/);
});
