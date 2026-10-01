import assert from "node:assert/strict";
import test from "node:test";
import { decodeComparisonIntent, decodeComparisonPresentationPrefs, type ComparisonIntentV1, type ComparisonPresentationPrefs } from "../app/shell/shop-comparison-prefs";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { bindShopPresentationHistory, readBoundShopLocationContext, shopPresentationHistoryMatches } from "../app/shell/shop-presentation-history";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation } from "../app/shell/navigation-contract";

const intent: ComparisonIntentV1 = { schemaVersion: "comparison-scope-v1", mode: "shop", metricSource: "platform", selectedBaseline: { kind: "custom", startDate: "2026-07-01", endDate: "2026-08-31" }, category: { mode: "label_only", platform: "京东", sourceId: "jd_sku_daily:spu_daily", label: "厨具", evidenceVersion: "source:1" }, coverageFilter: "all" };
const prefs: ComparisonPresentationPrefs = { schemaVersion: "comparison-ui-v1", metricKey: "payment", sort: "growth_desc", chartObjectKeys: ["京东\u001fA", "京东\u001fB"], columnKeys: ["payment", "coverage"] };
const location = serializeShellLocation({ module: "shop", view: "platforms", period: { kind: "custom", from: "2026-09-01", to: "2026-09-30" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001fA", "京东\u001fB"], q: "原比较搜索", page: 3, comparisonIntent: intent, comparisonPrefs: prefs } });

test("comparison intent and presentation refuse coercible enums, fake IDs and oversized scopes", () => {
  assert.deepEqual(decodeComparisonIntent(JSON.stringify(intent)), intent);
  assert.deepEqual(decodeComparisonPresentationPrefs(JSON.stringify(prefs)), prefs);
  for (const value of [{ ...intent, mode: ["shop"] }, { ...intent, schemaVersion: "future" }, { ...intent, principal: "admin" }, { ...intent, category: { mode: "verified_id", id: "invented" } }, { ...intent, selectedBaseline: { kind: "custom", startDate: "2024-01-01", endDate: "2025-01-01" } }, { ...intent, selectedBaseline: { kind: "previous", startDate: "2026-01-01" } }]) assert.equal(decodeComparisonIntent(JSON.stringify(value)), null);
  for (const value of [{ ...prefs, metricKey: ["payment"] }, { ...prefs, sort: "unknown" }, { ...prefs, authority: "admin" }, { ...prefs, chartObjectKeys: ["A", "A"] }, { ...prefs, chartObjectKeys: ["A", "B", "C", "D", "E"] }, { ...prefs, columnKeys: ["line\nbreak"] }]) assert.equal(decodeComparisonPresentationPrefs(JSON.stringify(value)), null);
  const duplicate = new URL(location, "https://synthetic.test"); duplicate.searchParams.append("shopComparisonIntent", JSON.stringify(intent));
  assert.equal(parseShellLocation(duplicate).shop?.comparisonIntent, undefined);
});

test("a fresh tab keeps its legal custom baseline while unbound or other-account hints reset", () => {
  const empty = readBoundShopLocationContext(location, null, "account-a", "2026-10-01");
  assert.deepEqual(empty.comparisonIntent, intent); assert.equal(empty.comparisonPrefs, null);
  const history = bindShopPresentationHistory({ unrelated: 1 }, location, "account-a", "2026-10-01");
  assert.deepEqual(readBoundShopLocationContext(location, history, "account-a", "2026-10-01").comparisonPrefs, prefs);
  assert.equal(readBoundShopLocationContext(location, history, "account-b", "2026-10-01").comparisonPrefs, null);
  const changed = updateShopContextLocation(location, { comparisonIntent: { ...intent, selectedBaseline: { kind: "previous" } } });
  assert.equal(shopPresentationHistoryMatches(history, changed, "account-a", "2026-10-01"), false);
  assert.equal(parseShellLocation(changed).shop?.page, 1);
});

test("comparison drills clear unsupported target scope and restore original baseline, category and page", () => {
  const detail = drillShopLocation(location, "products", { platform: "京东", shopName: "A", dimension: "spu", id: "P1" }, "daily");
  const target = parseShellLocation(detail).shop!;
  assert.equal(target.comparisonIntent, undefined); assert.equal(target.comparisonPrefs, undefined); assert.equal(target.q, ""); assert.equal(target.category, "");
  assert.equal(returnShopLocation(detail), location);
  assert.deepEqual(parseShellLocation(returnShopLocation(detail)).shop?.comparisonIntent, intent);
});

test("date or shop changes reset stale pages/hints without replacing explicit custom baseline", () => {
  const current = parseShellLocation(location);
  const moved = parseShellLocation(serializeShellLocation({ ...current, period: { kind: "custom", from: "2026-08-01", to: "2026-08-31" } }, location)).shop!;
  assert.deepEqual(moved.comparisonIntent?.selectedBaseline, intent.selectedBaseline); assert.equal(moved.page, 1); assert.equal(moved.comparisonPrefs, undefined);
  const changed = parseShellLocation(updateShopContextLocation(location, { outlets: ["京东\u001fB"] })).shop!;
  assert.deepEqual(changed.comparisonIntent?.selectedBaseline, intent.selectedBaseline); assert.deepEqual(changed.comparisonIntent?.category, { mode: "all" }); assert.equal(changed.comparisonPrefs, undefined); assert.equal(changed.page, 1);
});

test("a single drill narrows to the exact shop while saving the untouched comparison origin", () => {
  const detail = drillShopLocation(location, "analysis", null, "products", { platforms: ["京东"], outlets: ["京东\u001fB"] });
  assert.deepEqual(parseShellLocation(detail).shop?.outlets, ["京东\u001fB"]);
  assert.equal(returnShopLocation(detail), location);
  assert.equal(parseShellLocation(detail).shop?.comparisonIntent, undefined);
  const wholePlatform = drillShopLocation(location, "products", null, "home", { platforms: ["京东"], outlets: [] });
  assert.deepEqual(parseShellLocation(wholePlatform).shop?.outlets, ["京东\u001fA", "京东\u001fB"]);
  for (const patch of [{ platforms: ["天猫" as const], outlets: ["天猫\u001fOther"] }, { platforms: ["京东" as const], outlets: ["京东\u001fOther"] }, { platforms: ["京东" as const], outlets: ["天猫\u001fA"] }]) assert.equal(drillShopLocation(location, "analysis", null, "", patch), location);
});
