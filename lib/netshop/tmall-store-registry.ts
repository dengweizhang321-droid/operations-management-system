import { readFile } from "node:fs/promises";
import path from "node:path";

import { tmallStoreRegistryData } from "@/lib/netshop/tmall-store-catalog";

export type TmallStore = {
  storeKey: string;
  platform: "天猫";
  shopName: string;
  enabled: boolean;
  loginMode?: "manual" | "saved_browser_credentials" | "windows_dpapi_credentials";
  initialStartDate: string | null;
  portalUrl: string;
  browser: {
    executablePath?: string;
    userDataDir?: string;
    profileName?: string;
    profileDir: string;
    debugPort: number;
    downloadDir: string;
  };
};

type Registry = { version: 1; stores: TmallStore[] };
const projectRoot = path.resolve(process.cwd());
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function resolveRegistryPath(value: string, rootDirectory: string, localAppData: string | undefined): string {
  const localAppDataPrefix = /^%LOCALAPPDATA%(?:[\\/]|$)/i;
  let expanded = value;
  if (localAppDataPrefix.test(value)) {
    if (!localAppData?.trim()) throw new Error("天猫店铺注册表使用了 %LOCALAPPDATA%，但当前环境未提供 LOCALAPPDATA。");
    expanded = path.join(localAppData, value.replace(localAppDataPrefix, ""));
  }
  if (/%[^%]+%/.test(expanded)) throw new Error(`天猫店铺注册表包含不受支持的环境变量路径：${value}`);
  return path.resolve(rootDirectory, expanded);
}

function assertNoSecrets(value: unknown, location: string): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextLocation = `${location}.${key}`;
    if (/password|secret|token|cookie|session/i.test(key)) {
      throw new Error(`天猫店铺注册表不得保存敏感字段: ${nextLocation}`);
    }
    assertNoSecrets(child, nextLocation);
  }
}

function validIsoDate(value: string | null) {
  return value === null || (isoDatePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

export function validateTmallStoreRegistry(
  parsed: unknown,
  rootDirectory = projectRoot,
  localAppData = process.env.LOCALAPPDATA,
): TmallStore[] {
  if (!parsed || typeof parsed !== "object") throw new Error("天猫店铺注册表格式无效");
  const registry = parsed as { version?: unknown; stores?: unknown };
  if (registry.version !== 1 || !Array.isArray(registry.stores)) throw new Error("天猫店铺注册表格式无效");
  const storeKeys = new Set<string>();
  const shopNames = new Set<string>();
  const ports = new Set<number>();
  const profiles = new Set<string>();
  const downloads = new Set<string>();
  return registry.stores.map((rawStore, index) => {
    if (!rawStore || typeof rawStore !== "object") throw new Error(`天猫店铺注册表第 ${index + 1} 项无效`);
    const store = rawStore as TmallStore;
    assertNoSecrets(store, `stores.${store.storeKey ?? index}`);
    const usesSharedUserData = store.browser && (
      store.browser.executablePath !== undefined
      || store.browser.userDataDir !== undefined
      || store.browser.profileName !== undefined
    );
    if (!store.storeKey?.trim() || !/^[a-z0-9][a-z0-9-]*$/.test(store.storeKey)
      || store.platform !== "天猫" || !store.shopName?.trim() || typeof store.enabled !== "boolean"
      || store.loginMode !== undefined && !["manual", "saved_browser_credentials", "windows_dpapi_credentials"].includes(store.loginMode)
      || !validIsoDate(store.initialStartDate) || store.portalUrl !== "https://sycm.taobao.com/portal/home.htm"
      || !store.browser || !store.browser.profileDir?.trim() || !store.browser.downloadDir?.trim()
      || usesSharedUserData && (
        typeof store.browser.executablePath !== "string" || !store.browser.executablePath.trim()
        || typeof store.browser.userDataDir !== "string" || !store.browser.userDataDir.trim()
        || typeof store.browser.profileName !== "string"
        || !/^(?:Default|Profile [1-9]\d*)$/.test(store.browser.profileName)
      )
      || !Number.isInteger(store.browser.debugPort) || store.browser.debugPort < 1 || store.browser.debugPort > 65_535) {
      throw new Error(`天猫店铺注册表字段无效: stores[${index}]`);
    }
    const executablePath = store.browser.executablePath
      ? resolveRegistryPath(store.browser.executablePath, rootDirectory, localAppData)
      : undefined;
    const userDataDir = store.browser.userDataDir
      ? resolveRegistryPath(store.browser.userDataDir, rootDirectory, localAppData)
      : undefined;
    const profileDir = resolveRegistryPath(store.browser.profileDir, rootDirectory, localAppData);
    const downloadDir = resolveRegistryPath(store.browser.downloadDir, rootDirectory, localAppData);
    if (userDataDir && store.browser.profileName
      && profileDir.toLowerCase() !== path.join(userDataDir, store.browser.profileName).toLowerCase()) {
      throw new Error(`天猫店铺注册表 profileDir 必须精确等于 userDataDir/profileName：${store.storeKey}`);
    }
    const storeKey = store.storeKey.toLowerCase();
    const shopKey = store.shopName.toLocaleLowerCase("zh-CN");
    if (storeKeys.has(storeKey) || shopNames.has(shopKey) || ports.has(store.browser.debugPort)
      || profiles.has(profileDir.toLowerCase()) || downloads.has(downloadDir.toLowerCase())) {
      throw new Error(`天猫店铺注册表存在重复键、店铺、端口、profileDir 或 downloadDir: ${store.storeKey}`);
    }
    storeKeys.add(storeKey);
    shopNames.add(shopKey);
    ports.add(store.browser.debugPort);
    profiles.add(profileDir.toLowerCase());
    downloads.add(downloadDir.toLowerCase());
    return { ...store, browser: { ...store.browser, executablePath, userDataDir, profileDir, downloadDir } };
  });
}

export function resolveTmallBrowserLaunchTarget(store: TmallStore, fallbackExecutablePath: string) {
  return {
    executablePath: store.browser.executablePath ?? fallbackExecutablePath,
    profileDirectory: store.browser.userDataDir ?? store.browser.profileDir,
    profileName: store.browser.profileName,
  };
}

export async function loadTmallStores(): Promise<TmallStore[]> {
  const file = path.join(projectRoot, "config", "tmall-store-accounts.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as Registry;
  return validateTmallStoreRegistry(parsed, projectRoot);
}

export function bundledTmallStores(): TmallStore[] {
  return validateTmallStoreRegistry(tmallStoreRegistryData, projectRoot);
}

export async function getTmallStore(storeKey: string): Promise<TmallStore> {
  const store = (await loadTmallStores()).find((item) => item.storeKey === storeKey);
  if (!store) throw new Error(`未找到天猫店铺注册项: ${storeKey}`);
  if (!store.enabled) throw new Error(`天猫店铺尚未启用: ${storeKey}`);
  return store;
}
