import assert from "node:assert/strict";
import test from "node:test";

import { enabledTmallStoreCatalog, resolveEnabledTmallShop } from "../lib/netshop/tmall-store-catalog";
import { validateTmallStoreRegistry } from "../lib/netshop/tmall-store-registry";

function store(storeKey: string, shopName: string, port: number) {
  return {
    storeKey,
    platform: "天猫" as const,
    shopName,
    enabled: true,
    initialStartDate: "2026-07-31",
    portalUrl: "https://sycm.taobao.com/portal/home.htm",
    browser: { profileDir: `.runtime/${storeKey}`, debugPort: port, downloadDir: `downloads/${storeKey}` },
  };
}

test("天猫店铺注册表隔离 profile、端口和下载目录", () => {
  const result = validateTmallStoreRegistry({ version: 1, stores: [store("a", "A店", 9301), store("b", "B店", 9302)] }, "C:\\workspace");
  assert.equal(result.length, 2);
  assert.notEqual(result[0]!.browser.profileDir, result[1]!.browser.profileDir);
  assert.notEqual(result[0]!.browser.downloadDir, result[1]!.browser.downloadDir);
});

test("天猫店铺注册表拒绝敏感字段和跨店重复资源", () => {
  const withPassword = { ...store("a", "A店", 9301), password: "do-not-store" };
  assert.throws(() => validateTmallStoreRegistry({ version: 1, stores: [withPassword] }), /不得保存敏感字段/);
  const duplicate = store("b", "B店", 9301);
  duplicate.browser.profileDir = store("a", "A店", 9301).browser.profileDir;
  assert.throws(() => validateTmallStoreRegistry({ version: 1, stores: [store("a", "A店", 9301), duplicate] }), /存在重复/);
});

test("服务端只接受注册表中启用的天猫店铺", () => {
  assert.equal(enabledTmallStoreCatalog().length, 1);
  assert.equal(resolveEnabledTmallShop().shopName, "天猫-志高亿玖专卖店");
  assert.equal(resolveEnabledTmallShop("天猫-志高亿玖专卖店").storeKey, "tmall-yijiu");
  assert.throws(() => resolveEnabledTmallShop("天猫-志高丽力专卖店"), /未注册或未启用/);
});
