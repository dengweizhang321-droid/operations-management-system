import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeShopIdentity,
  expandShopAliases,
  parseShopFilterKey,
  shopFilterKey,
} from "../lib/sales/shop-identity";

test("京东自营店两个名称归一为同一标准店铺", () => {
  const legacy = canonicalizeShopIdentity(
    "京东",
    "志高商用厨电京东自营旗舰店",
    "志高商用厨电京东自营旗舰店",
  );
  const current = canonicalizeShopIdentity(
    "京东",
    "志高商用厨电自营旗舰店",
    "京东-志高商用厨电自营旗舰店",
  );

  assert.deepEqual(legacy, current);
  assert.equal(legacy.shopName, "志高商用厨电自营旗舰店");
});

test("标准店铺筛选会覆盖两个原始名称，且筛选键可逆", () => {
  const identity = canonicalizeShopIdentity("京东", "志高商用厨电自营旗舰店", "");
  const key = shopFilterKey(identity);

  assert.deepEqual(parseShopFilterKey(key), identity);
  assert.deepEqual(expandShopAliases(identity).sort(), [
    "志高商用厨电京东自营旗舰店",
    "志高商用厨电自营旗舰店",
  ].sort());
});

test("其他店铺不受自营店别名规则影响", () => {
  const identity = canonicalizeShopIdentity("京东", "志高商用设备旗舰店（亿用）", "京东-志高商用设备旗舰店（亿用）");
  assert.deepEqual(expandShopAliases(identity), ["志高商用设备旗舰店（亿用）"]);
});
