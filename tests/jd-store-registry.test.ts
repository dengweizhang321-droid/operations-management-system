import assert from "node:assert/strict";
import test from "node:test";
import { validateJdStoreRegistry } from "../lib/jd/store-registry";

const store = (storeKey: string, shopId: string, port: number, profileDir: string, downloadDir: string) => ({
  storeKey, accountLabel: storeKey, platform: "京东", shopName: storeKey, shopId, enabled: true,
  browser: { profileDir, debugPort: port, downloadDir },
});

test("store registry resolves and rejects shared browser or download isolation paths", () => {
  const registry = { version: 1, stores: [store("one", "1", 9222, ".runtime/one", "D:/downloads/one"), store("two", "2", 9223, ".runtime/two", "D:/downloads/two")] };
  assert.match(validateJdStoreRegistry(registry, "D:/repo")[0]!.browser.profileDir, /repo/);
  assert.throws(() => validateJdStoreRegistry({ ...registry, stores: [registry.stores[0], store("two", "2", 9223, ".runtime/one", "D:/downloads/two")] }, "D:/repo"), /profileDir/);
  assert.throws(() => validateJdStoreRegistry({ version: 1, stores: [{ ...registry.stores[0], platform: "淘宝" }] }, "D:/repo"), /字段无效/);
  assert.throws(() => validateJdStoreRegistry({ version: 1, stores: [{ ...registry.stores[0], storeKey: "Store" }] }, "D:/repo"), /字段无效/);
  assert.throws(() => validateJdStoreRegistry({ version: 1, stores: [{ ...registry.stores[0], shopId: "A-1" }] }, "D:/repo"), /字段无效/);
});
