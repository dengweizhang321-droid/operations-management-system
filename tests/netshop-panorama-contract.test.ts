import test from "node:test";
import assert from "node:assert/strict";
import { decodeStorePanorama, PanoramaResponseError, panoramaProductQuery, panoramaPromotionQuery, validatePanoramaQuery } from "../app/netshop/panorama/contract";
import { panoramaFixture, panoramaFixtureQuery } from "./netshop-panorama-fixture";

const revision = "1:aaaaaaaaaaaa";
test("single exact shop, search and bounded bottom pagination accept only the owned request", () => {
  const query = panoramaFixtureQuery();
  assert.deepEqual(validatePanoramaQuery(query).tableScope, { q: "", page: 1, pageSize: 5, section: "performance", grain: "day" });
  query.set("q", " P01 "); query.set("page", "2"); query.set("pageSize", "10");
  assert.equal(validatePanoramaQuery(query).tableScope.q, "P01");
  for (const extra of ["platform=京东", "outlet=京东%1F别店", "page=0", "pageSize=101", "q=a&q=b", "principal=admin", "category=官方", "section=unknown", "source=sales", "productIdentity=P01"]) assert.throws(() => validatePanoramaQuery(new URLSearchParams(panoramaFixtureQuery()+"&"+extra)));
  const empty = panoramaFixtureQuery(); empty.delete("outlet"); assert.throws(() => validatePanoramaQuery(empty));
});
test("P table filtering and A independent SKU query preserve distinct owning requests", () => {
  const query = panoramaFixtureQuery(); query.set("q", "标题"); query.set("page", "3"); query.set("snapshotToken", "b".repeat(64)); query.set("sectionToken", "c".repeat(64));
  const p = panoramaProductQuery(query), a = panoramaPromotionQuery(query);
  assert.equal(p.get("q"), "标题"); assert.equal(p.get("page"), "3"); assert.equal(p.get("sectionToken"), null);
  assert.equal(a.get("q"), ""); assert.equal(a.get("page"), "1"); assert.equal(a.get("dimension"), "sku"); assert.equal(a.get("snapshotToken"), null); assert.equal(a.get("sectionToken"), null);
});
test("eight sections and unavailable dependencies remain explicit, without invented zero", () => {
  const data = decodeStorePanorama(panoramaFixture(), panoramaFixtureQuery(), revision);
  assert.equal(Object.keys(data.sections).length, 8); assert.equal(data.sources.sales.state, "unavailable");
  assert.equal(data.sources.sales.data, null);
});
test("owning P full envelope, official shop separator and true zero survive decoding", () => {
  const data = decodeStorePanorama(panoramaFixture(true), panoramaFixtureQuery(), revision);
  assert.equal(data.sources.products.state, "ready");
  if (data.sources.products.state === "ready") assert.equal(data.sources.products.data.sections.summary.payment.value, 0);
  assert.equal(data.sections.performance.state, "partial"); assert.equal(data.sections.traffic.state, "partial");
});
test("a local sales 503 leaves independently trusted product sections intact", () => {
  const value = panoramaFixture(true); value.sources.sales = { state: "error", data: null, code: "service_unavailable", message: "销售暂不可用" }; value.sections.margin.state = "error";
  assert.equal(decodeStorePanorama(value, panoramaFixtureQuery(), revision).sources.products.state, "ready");
});
test("embedded source permissions and revision failures reject the whole protected read", () => {
  for (const [code, status] of [["access_denied", 403], ["unauthenticated", 401], ["insights_revision_changed", 409]] as const) {
    const value = panoramaFixture(true); (value.sources as unknown as Record<string, unknown>).sales = { state: "error", data: null, code, message: "来源失效" };
    assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision), error => error instanceof PanoramaResponseError && error.status === status);
    for (const malformed of [{ state: "error", code, data: {} }, { state: "error", code, data: null, message: [] }]) {
      (value.sources as unknown as Record<string, unknown>).sales = malformed;
      assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision), error => error instanceof PanoramaResponseError && error.status === status);
    }
  }
});
test("P HTTP200 embedded denied baseline does not leak current business results", () => {
  const value = panoramaFixture(true);
  if (value.sources.products.state === "ready") value.sources.products.data.sections.baselineReads.previous = { state: "error", data: null, code: "access_denied", message: "基期权限失效" };
  assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision), error => error instanceof PanoramaResponseError && error.status === 403);
});
test("cross-shop, wrong page/query, omitted chapters/capabilities and mixed revisions fail closed", () => {
  const mutations: Array<(value: ReturnType<typeof panoramaFixture>) => void> = [
    value => { value.context.effectiveScope.shopKeys = ["京东\u001f别店"]; },
    value => { value.tableScope.q = "wrong"; }, value => { value.tableScope.page = 2; },
    value => { delete (value.sections as Partial<typeof value.sections>).traffic; },
    value => { value.sections.customers.capabilities.pop(); },
    value => { value.joinedSourceRevisions = []; },
    value => { value.joinedSourceRevisions = [...value.joinedSourceRevisions, { domain: "inventory", kind: "unused", scopeKey: "other", revision: "17" }]; },
    value => { value.sections.margin.capabilities[0] = { ...value.sections.margin.capabilities[0], status: "available", reasonCode: null }; },
  ];
  for (const mutate of mutations) { const value = panoramaFixture(); mutate(value); assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision)); }
  assert.throws(() => decodeStorePanorama(panoramaFixture(), panoramaFixtureQuery(), "2:bbbbbbbbbbbb"));
});
test("full response limit counts all source envelopes and explanations in UTF8", () => {
  const value = panoramaFixture(); value.limitations = ["界".repeat(800_000)];
  assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision), /2MiB/);
});
test("scalar protocol enums and specific capability ownership cannot be bypassed by arrays or another ready domain", () => {
  const mutations: Array<(value: ReturnType<typeof panoramaFixture>) => void> = [
    value => { (value.sections.traffic as unknown as Record<string, unknown>).state = ["ready"]; },
    value => { (value.sections.traffic.capabilities[0] as unknown as Record<string, unknown>).status = ["available"]; },
    value => { (value.joinedSourceRevisions[0] as unknown as Record<string, unknown>).domain = ["netshop"]; },
    value => { const cap = value.sections.performance.capabilities.find(c => c.id === "erp_net_sales")!; cap.status = "available"; cap.reasonCode = null; },
    value => { const cap = value.sections.customers.capabilities.find(c => c.id === "b2b_payment")!; cap.status = "available"; cap.reasonCode = null; },
    value => { const cap = value.sections.traffic.capabilities.find(c => c.id === "bounce_rate")!; cap.status = "available"; cap.reasonCode = null; },
  ];
  for (const mutate of mutations) { const value = panoramaFixture(true); mutate(value); assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), revision)); }
});
