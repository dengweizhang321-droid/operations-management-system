import assert from "node:assert/strict";
import test from "node:test";
import { decodePromotionPresentationPrefs, type PromotionPresentationPrefs } from "../app/shell/shop-promotion-prefs";
import { bindShopPresentationHistory, readBoundShopLocationContext } from "../app/shell/shop-presentation-history";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation } from "../app/shell/navigation-contract";

const prefs: PromotionPresentationPrefs = { schemaVersion: "promotion-ui-v1", sort: "spend_change_asc", objectDateFocus: { startDate: "2026-09-01", endDate: "2026-09-06" } };
const actor = "synthetic-actor", today = "2026-10-01";
const list = serializeShellLocation({ module: "shop", view: "promotion", period: { kind: "custom", from: "2026-09-01", to: "2026-09-07" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001fA", "京东\u001fB"], dimension: "sku", grain: "week", q: "SKU001", page: 3, promotionPrefs: prefs } });

test("promotion prefs are closed and invalid dates reset only an otherwise valid focus", () => {
  assert.deepEqual(decodePromotionPresentationPrefs(JSON.stringify(prefs)), prefs);
  for (const v of [{ ...prefs, schemaVersion: "next" }, { ...prefs, sort: ["roas_desc"] }, { ...prefs, token: "forbidden" }, { ...prefs, objectDateFocus: [] }, { ...prefs, objectDateFocus: { startDate: "2026-09-01", endDate: "2026-09-06", extra: true } }]) assert.equal(decodePromotionPresentationPrefs(JSON.stringify(v)), null);
  assert.equal(decodePromotionPresentationPrefs(JSON.stringify({ ...prefs, objectDateFocus: { startDate: "2026-02-30", endDate: "2026-03-02" } }))?.objectDateFocus, null);
  assert.equal(decodePromotionPresentationPrefs(JSON.stringify({ ...prefs, objectDateFocus: { startDate: "2025-01-01", endDate: "2026-09-06" } }))?.objectDateFocus, null);
});

test("A week focus, sort, page and search survive an exact P drill and bound return", () => {
  const detail = drillShopLocation(list, "products", { platform: "京东", shopName: "B", dimension: "sku", id: "SKU001" }, "daily");
  const returned = returnShopLocation(detail);
  assert.equal(returned, list);
  const history = bindShopPresentationHistory({}, returned, actor, today);
  const restored = readBoundShopLocationContext(returned, history, actor, today);
  assert.deepEqual(restored.promotionPrefs, prefs);
  assert.equal(restored.page, 3); assert.equal(restored.q, "SKU001"); assert.equal(restored.grain, "week");
});

test("unbound or another account cannot revive A preferences through a return destination", () => {
  const detail = drillShopLocation(list, "products", { platform: "京东", shopName: "B", dimension: "sku", id: "SKU001" });
  for (const identity of [actor, "other-actor"]) {
    const safe = readBoundShopLocationContext(detail, null, identity, today);
    const current = serializeShellLocation({ ...parseShellLocation(detail), shop: safe }, detail);
    const returned = returnShopLocation(current);
    const rebound = bindShopPresentationHistory({}, returned, identity, today);
    assert.equal(readBoundShopLocationContext(returned, rebound, identity, today).promotionPrefs, undefined);
  }
});

test("scope resets A prefs while focus/sort resets only page; out-of-window focus is discarded", () => {
  const changed = updateShopContextLocation(list, { promotionPrefs: { ...prefs, sort: "roas_desc" } });
  assert.equal(parseShellLocation(changed).shop?.page, 1);
  assert.equal(parseShellLocation(updateShopContextLocation(list, { outlets: ["京东\u001fB"] })).shop?.promotionPrefs, undefined);
  const dated = serializeShellLocation({ ...parseShellLocation(list), period: { kind: "yesterday" } }, list);
  assert.equal(parseShellLocation(dated).shop?.promotionPrefs, undefined);
  const outside = updateShopContextLocation(list, { promotionPrefs: { ...prefs, objectDateFocus: { startDate: "2026-09-08", endDate: "2026-09-09" } } });
  const history = bindShopPresentationHistory({}, outside, actor, today);
  assert.equal(readBoundShopLocationContext(outside, history, actor, today).promotionPrefs?.objectDateFocus, null);
});
