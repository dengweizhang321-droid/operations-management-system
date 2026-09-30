import assert from "node:assert/strict";
import test from "node:test";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation } from "../app/shell/navigation-contract";
import { defaultShopLocationContext, validShopReturn } from "../app/shell/shop-context";

const product = { platform: "京东" as const, shopName: "A", dimension: "spu" as const, id: "P1" };
const list = serializeShellLocation({ module: "shop", view: "products", period: { kind: "custom", from: "2026-09-01", to: "2026-09-07", intent: "rolling" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001fA"], category: "厨具", q: "测试", page: 3, pageSize: 50 } });

test("list to product to promotion to product preserves the original list with flat return siblings", () => {
  const detail = drillShopLocation(list, "products", product, "daily");
  const promotion = drillShopLocation(detail, "promotion", product, "product");
  const context = parseShellLocation(promotion).shop!;
  assert.equal(context.q, ""); assert.equal(context.category, "");
  assert.equal(context.returnOrigin, list);
  for (const target of [context.returnTo, context.returnOrigin]) {
    assert.ok(validShopReturn(target!));
    const query = new URL(target!, "https://synthetic.test").searchParams;
    assert.equal(query.has("shopReturn"), false);
    assert.equal(query.has("shopReturnOrigin"), false);
  }
  const returnedDetail = returnShopLocation(promotion);
  assert.equal(returnedDetail, detail);
  assert.equal(returnShopLocation(returnedDetail), list);
  // Parsing the copied URL preserves the same route, without another history owner.
  assert.equal(returnShopLocation(serializeShellLocation(parseShellLocation(promotion), promotion)), detail);
});

test("changing selected shops or date scope clears obsolete return locations", () => {
  const promotion = drillShopLocation(drillShopLocation(list, "products", product, "daily"), "promotion", product);
  const changed = parseShellLocation(updateShopContextLocation(promotion, { outlets: ["京东\u001fB"], product: null })).shop!;
  assert.equal(changed.returnTo, null); assert.equal(changed.returnOrigin, undefined);
  const state = parseShellLocation(promotion);
  const period = parseShellLocation(serializeShellLocation({ ...state, period: { kind: "yesterday" } }, promotion)).shop!;
  assert.equal(period.returnTo, null); assert.equal(period.returnOrigin, undefined); assert.equal(period.page, 1);
});

test("both return locations reject external, nested, duplicated or fragment destinations", () => {
  for (const target of ["https://example.test/", "//example.test/", "/?module=sales", "/?module=shop&module=shop", "/?module=shop&view=products&view=promotion", "/?module=shop&view=unknown", "/?module=shop&shopReturn=x", "/?module=shop&shopReturnOrigin=x", "/?module=shop&shopReturnV2=x", "/?module=shop#detail"]) {
    assert.equal(validShopReturn(target), null);
    const params = new URLSearchParams({ module: "shop", view: "promotion", shopReturn: target, shopReturnOrigin: target });
    const parsed = parseShellLocation("/?" + params).shop!;
    assert.equal(parsed.returnTo, null); assert.equal(parsed.returnOrigin, undefined);
  }
});

test("ordinary product drill and legacy return keep their existing route", () => {
  const detail = drillShopLocation(list, "products", product, "catalog");
  assert.equal(returnShopLocation(detail), list);
  assert.equal(parseShellLocation(detail).shop?.returnOrigin, undefined);
});
