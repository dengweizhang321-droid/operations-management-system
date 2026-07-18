import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeShopIdentity,
  expandShopAliases,
  parseShopFilterKey,
  shopFilterKey,
} from "@/lib/sales/shop-identity";

test("normalizes the two JD self-operated shop aliases", () => {
  const current = canonicalizeShopIdentity("京东", "志高商用厨电自营旗舰店", "京东-志高商用厨电自营旗舰店");
  const legacy = canonicalizeShopIdentity("京东", "志高商用厨电京东自营旗舰店", "京东志高商用自营旗舰店");
  assert.deepEqual(legacy, current);
});

test("canonical keys round-trip and expand to every raw alias", () => {
  const canonical = canonicalizeShopIdentity("京东", "志高商用厨电自营旗舰店", "");
  assert.deepEqual(parseShopFilterKey(shopFilterKey(canonical)), canonical);
  assert.deepEqual(expandShopAliases(canonical).sort(), ["志高商用厨电京东自营旗舰店", "志高商用厨电自营旗舰店"]);
});

test("does not alter unrelated shops", () => {
  const other = canonicalizeShopIdentity("天猫", "志高厨电旗舰店", "天猫-志高厨电旗舰店");
  assert.deepEqual(other, { platform: "天猫", shopName: "志高厨电旗舰店" });
});
