import assert from "node:assert/strict";
import test from "node:test";
import { decodeProductsPresentationPrefs, type ProductsPresentationPrefs } from "../app/shell/shop-products-prefs";
import { bindShopPresentationHistory, readBoundShopLocationContext, shopPresentationHistoryMatches } from "../app/shell/shop-presentation-history";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation } from "../app/shell/navigation-contract";

const prefs: ProductsPresentationPrefs = { schemaVersion: "products-ui-v1", sort: "growth_desc", columns: { traffic: false, comparison: true, association: false, coverage: true }, gallery: true, detailSource: "erp", topic: "traffic" };
const account = "synthetic-account-a";
const today = "2026-10-01";
const list = serializeShellLocation({ module: "shop", view: "products", period: { kind: "yesterday" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001fA", "京东\u001fB"], page: 3, productsPrefs: prefs } });

test("strict presentation schema refuses extra fields, coercion, missing columns and unknown versions", () => {
  assert.deepEqual(decodeProductsPresentationPrefs(JSON.stringify(prefs)), prefs);
  for (const value of [{ ...prefs, schemaVersion: "v2" }, { ...prefs, token: "forbidden" }, { ...prefs, topic: ["home"] }, { ...prefs, detailSource: ["erp"] }, { ...prefs, columns: [] }, { ...prefs, columns: { ...prefs.columns, traffic: 1 } }, { ...prefs, columns: { ...prefs.columns, extra: true } }, { ...prefs, gallery: "true" }, [prefs]]) assert.equal(decodeProductsPresentationPrefs(JSON.stringify(value)), null);
  assert.equal(decodeProductsPresentationPrefs(" ".repeat(1501)), null);
  const duplicate = new URL(list, "https://synthetic.test"); duplicate.searchParams.append("shopProductsPrefs", JSON.stringify(prefs));
  assert.equal(parseShellLocation(duplicate).shop?.productsPrefs, undefined);
});

test("only the same account and actual day scope may restore shared preferences", () => {
  const state = bindShopPresentationHistory({ unrelated: "preserved" }, list, account, today);
  assert.equal(state.unrelated, "preserved");
  assert.equal(shopPresentationHistoryMatches(state, list, account, today), true);
  assert.deepEqual(readBoundShopLocationContext(list, state, account, today).productsPrefs, prefs);
  for (const [history, url, identity, date] of [[null, list, account, today], [state, list, "synthetic-account-b", today], [state, list, null, today], [state, list, account, "2026-10-02"], [state, list + "&shopQ=manual", account, today]] as const) {
    assert.equal(shopPresentationHistoryMatches(history, url, identity, date), false);
    assert.equal(readBoundShopLocationContext(url, history, identity, date).productsPrefs, null);
  }
  assert.equal(new URL(list, "https://synthetic.test").search.includes(account), false);
});

test("legitimate scoped drill rebinds one history entry and restores detail then multi-store list preferences", () => {
  const product = { platform: "京东" as const, shopName: "A", dimension: "spu" as const, id: "P1" };
  const detail = drillShopLocation(list, "products", product, "daily");
  const detailPage = updateShopContextLocation(detail, { page: 2 });
  const promotion = drillShopLocation(detailPage, "promotion", product, "product");
  const state = bindShopPresentationHistory({}, promotion, account, today);
  const valid = readBoundShopLocationContext(promotion, state, account, today);
  assert.deepEqual(valid.productsPrefs, prefs);
  const returnedDetail = returnShopLocation(promotion);
  assert.equal(returnedDetail, detailPage);
  assert.equal(returnShopLocation(returnedDetail), list);
  const invalid = readBoundShopLocationContext(promotion, state, "synthetic-other", today);
  assert.equal(invalid.returnOrigin, null); assert.equal(invalid.returnTo, null);
});

test("an unbound or another-account single return cannot rebind preferences hidden in its destination", () => {
  const product = { platform: "京东" as const, shopName: "A", dimension: "spu" as const, id: "P1" };
  const detail = drillShopLocation(list, "products", product, "daily");
  const bound = bindShopPresentationHistory({}, detail, account, today);
  for (const [history, identity] of [[null, account], [bound, "synthetic-account-b"]] as const) {
    const safe = readBoundShopLocationContext(detail, history, identity, today);
    assert.equal(safe.productsPrefs, null);
    const sanitizedDetail = serializeShellLocation({ ...parseShellLocation(detail), shop: safe }, detail);
    const returned = returnShopLocation(sanitizedDetail);
    const rebound = bindShopPresentationHistory({}, returned, identity, today);
    const restored = readBoundShopLocationContext(returned, rebound, identity, today);
    assert.equal(restored.productsPrefs, undefined);
    assert.equal(restored.page, 3);
    assert.deepEqual(restored.outlets, ["京东\u001fA", "京东\u001fB"]);
  }
});

test("sort resets a list page while display columns keep it; changed scope resets preferences", () => {
  const changedSort = updateShopContextLocation(list, { productsPrefs: { ...prefs, sort: "payment_asc" } });
  assert.equal(parseShellLocation(changedSort).shop?.page, 1);
  const changedColumns = updateShopContextLocation(list, { productsPrefs: { ...prefs, gallery: false } });
  assert.equal(parseShellLocation(changedColumns).shop?.page, 3);
  const otherShop = updateShopContextLocation(list, { outlets: ["京东\u001fB"] });
  assert.equal(parseShellLocation(otherShop).shop?.productsPrefs, undefined);
});
