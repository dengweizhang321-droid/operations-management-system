import assert from "node:assert/strict";
import test from "node:test";

import { enabledTmallStoreCatalog, resolveEnabledTmallShop } from "../lib/netshop/tmall-store-catalog";
import {
  resolveTmallBrowserLaunchTarget,
  type TmallStore,
  validateTmallStoreRegistry,
} from "../lib/netshop/tmall-store-registry";

function store(storeKey: string, shopName: string, port: number): TmallStore {
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
  assert.throws(() => validateTmallStoreRegistry({
    version: 1,
    stores: [{ ...store("c", "C店", 9303), loginMode: "plain_password" }],
  }), /字段无效/);
});

test("天猫店铺注册表支持共享 Chromium 根目录下的独立 Profile", () => {
  const shared = store("tmall-yijiu", "天猫-志高亿玖专卖店", 9334);
  shared.browser = {
    ...shared.browser,
    executablePath: "%LOCALAPPDATA%/Chromium/Application/chrome.exe",
    userDataDir: "%LOCALAPPDATA%/Chromium/User Data",
    profileName: "Profile 4",
    profileDir: "%LOCALAPPDATA%/Chromium/User Data/Profile 4",
  };
  const [result] = validateTmallStoreRegistry(
    { version: 1, stores: [shared] },
    "D:\\workspace",
    "C:\\Users\\test\\AppData\\Local",
  );
  assert.equal(result!.browser.profileName, "Profile 4");
  assert.match(result!.browser.userDataDir!, /Chromium[\\/]User Data$/);
  assert.match(result!.browser.profileDir, /Chromium[\\/]User Data[\\/]Profile 4$/);
  assert.match(result!.browser.executablePath!, /Chromium[\\/]Application[\\/]chrome\.exe$/);
  assert.deepEqual(resolveTmallBrowserLaunchTarget(result!, "D:\\fallback\\chrome.exe"), {
    executablePath: result!.browser.executablePath,
    profileDirectory: result!.browser.userDataDir,
    profileName: "Profile 4",
  });
});

test("天猫店铺注册表拒绝 userDataDir 与 profileDir 错位", () => {
  const mismatched = store("tmall-yijiu", "天猫-志高亿玖专卖店", 9334);
  mismatched.browser = {
    ...mismatched.browser,
    executablePath: "%LOCALAPPDATA%/Chromium/Application/chrome.exe",
    userDataDir: "%LOCALAPPDATA%/Chromium/User Data",
    profileName: "Profile 4",
    profileDir: "%LOCALAPPDATA%/Chromium/User Data/Profile 3",
  };
  assert.throws(() => validateTmallStoreRegistry(
    { version: 1, stores: [mismatched] },
    "D:\\workspace",
    "C:\\Users\\test\\AppData\\Local",
  ), /profileDir 必须精确等于 userDataDir\/profileName/);
});

test("服务端只接受注册表中启用的天猫店铺", () => {
  assert.equal(enabledTmallStoreCatalog().length, 1);
  assert.equal(resolveEnabledTmallShop().shopName, "天猫-志高亿玖专卖店");
  const yijiu = resolveEnabledTmallShop("天猫-志高亿玖专卖店");
  assert.equal(yijiu.storeKey, "tmall-yijiu");
  assert.equal(yijiu.browser.userDataDir, "%LOCALAPPDATA%/Chromium-Tmall-Yijiu/User Data");
  assert.equal(yijiu.browser.profileName, "Default");
  assert.equal(yijiu.browser.profileDir, "%LOCALAPPDATA%/Chromium-Tmall-Yijiu/User Data/Default");
  assert.equal(yijiu.browser.debugPort, 9334);
  assert.equal(yijiu.loginMode, "windows_dpapi_credentials");
  assert.throws(() => resolveEnabledTmallShop("天猫-志高丽力专卖店"), /未注册或未启用/);
});
