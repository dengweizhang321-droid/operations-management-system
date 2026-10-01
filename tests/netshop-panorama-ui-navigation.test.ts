import test from "node:test";
import assert from "node:assert/strict";
import { defaultShopLocationContext } from "../app/shell/shop-context";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation } from "../app/shell/navigation-contract";
import { ScopedReadGate } from "../app/netshop/shared/request-state";
import { panoramaQuery, panoramaSearchChange, panoramaShopChange } from "../app/netshop/panorama/ui-state";

const origin = serializeShellLocation({ module: "shop", view: "analysis", period: { kind: "custom", from: "2026-09-01", to: "2026-09-29" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001f甲店"], dimension: "spu", q: "设备", page: 3, pageSize: 5, section: "products" } });

test("S exact product drill keeps shop, actual period and identity, and returns its search/page/chapter", () => {
  const product = { platform: "京东" as const, shopName: "甲店", dimension: "spu" as const, id: "SPU-123" };
  const detail = drillShopLocation(origin, "products", product, "overview");
  const destination = parseShellLocation(detail);
  assert.equal(destination.view, "products");
  assert.deepEqual(destination.shop?.product, product);
  assert.deepEqual(destination.period, parseShellLocation(origin).period);
  assert.deepEqual(destination.shop?.outlets, ["京东\u001f甲店"]);
  assert.equal(destination.shop?.q, "");
  assert.equal(returnShopLocation(detail), origin);
});
test("S promotion date focus filters A objects inside the same full period and preserves original S pagination on return", () => {
  const source = updateShopContextLocation(origin, { section: "promotion" });
  const promotion = drillShopLocation(source, "promotion", null, "products");
  const focused = updateShopContextLocation(promotion, { promotionPrefs: { schemaVersion: "promotion-ui-v1", sort: "spend_desc", objectDateFocus: { startDate: "2026-09-12", endDate: "2026-09-12" } } });
  const destination = parseShellLocation(focused);
  assert.equal(destination.view, "promotion");
  assert.deepEqual(destination.shop?.outlets, ["京东\u001f甲店"]);
  assert.deepEqual(destination.period, parseShellLocation(source).period);
  assert.equal(destination.shop?.page, 1);
  assert.deepEqual(destination.shop?.promotionPrefs?.objectDateFocus, { startDate: "2026-09-12", endDate: "2026-09-12" });
  assert.equal(returnShopLocation(focused), source);
  assert.equal(parseShellLocation(returnShopLocation(focused)).shop?.page, 3);
});
test("S search and single-shop changes use canonical shell scope resets, not custom history", () => {
  const searched = updateShopContextLocation(origin, panoramaSearchChange("  SPU-123  "));
  assert.equal(parseShellLocation(searched).shop?.q, "SPU-123");
  assert.equal(parseShellLocation(searched).shop?.page, 1);
  const switched = updateShopContextLocation(searched, panoramaShopChange("天猫\u001f乙店"));
  const shop = parseShellLocation(switched).shop!;
  assert.equal(shop.q, ""); assert.equal(shop.page, 1); assert.equal(shop.product, null);
  assert.deepEqual(shop.outlets, ["天猫\u001f乙店"]);
  assert.equal(panoramaQuery({ context: shop, startDate: "2026-09-01", endDate: "2026-09-29", periodKind: "custom" })?.get("platform"), "天猫");
});
test("quick shop/date/page changes and unmount reject late data even when upstream ignores cancellation", () => {
  const gate = new ScopedReadGate();
  const oldShop = gate.begin("甲店/2026-09/1");
  const newShop = gate.begin("乙店/2026-09/1");
  assert.equal(oldShop.signal.aborted, true); assert.equal(oldShop.current(), false);
  const newDate = gate.begin("乙店/2026-08/1");
  assert.equal(newShop.current(), false); assert.equal(newDate.current(), true);
  const newPage = gate.begin("乙店/2026-08/2");
  assert.equal(newDate.current(), false); assert.equal(newPage.current(), true);
  gate.cancel();
  assert.equal(newPage.signal.aborted, true); assert.equal(newPage.current(), false);
});
