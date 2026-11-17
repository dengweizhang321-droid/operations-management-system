import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// 与 netshop-promotion-ai-scale.test.ts 相同：工具模块需要 cloudflare:workers 绑定，这里只用视图计划，不发请求。
const environment = { TERUISI_DJANGO_NETSHOP_READER_BASE_URL: "https://scale-reader.example.test", TERUISI_DJANGO_NETSHOP_WRITER_BASE_URL: "https://scale-writer.example.test", TERUISI_DJANGO_INTERNAL_SECRET: "synthetic-scale-secret-0123456789abcdef" };
(globalThis as typeof globalThis & { __scaleEnv?: typeof environment }).__scaleEnv = environment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env=globalThis.__scaleEnv;", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { projectNetshopAiView } = await import("../lib/ai/netshop-ai-view");
const { NETSHOP_PROMOTION_VIEW_PLAN } = await import("../lib/ai/netshop-promotion-insights-tool");
import { NETSHOP_AI_VIEWS } from "../lib/ai/netshop-ai-view";

const storeLevel = { definition: "店铺级推广", unit: "CNY_CENT", reconciled: true, periods: { current: { spendCents: 4000, attributedPaymentCents: null, rowCount: 1 } } };
const payload = () => ({ sections: { storeLevel, summary: {}, items: [], pagination: {}, contributions: {}, coverage: {}, limitations: [], dataQuality: {}, objectKind: "product", listScope: {} } });

test("storeLevel survives every AI view and is never reported as omitted", () => {
  for (const view of NETSHOP_AI_VIEWS) {
    const projected = projectNetshopAiView(payload(), view, NETSHOP_PROMOTION_VIEW_PLAN) as { sections: Record<string, unknown>; aiView: { omitted: Array<{ path?: string }> } };
    assert.deepEqual(projected.sections.storeLevel, storeLevel, view);
    assert.equal(projected.aiView.omitted.some(item => String(item.path ?? "").includes("storeLevel")), false, view);
  }
});

test("a payload without storeLevel stays without it", () => {
  const source = payload(); delete (source.sections as Record<string, unknown>).storeLevel;
  for (const view of NETSHOP_AI_VIEWS) {
    const projected = projectNetshopAiView(source, view, NETSHOP_PROMOTION_VIEW_PLAN) as { sections: Record<string, unknown> };
    assert.equal("storeLevel" in projected.sections, false, view);
  }
});
