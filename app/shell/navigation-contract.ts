import {
  getDefaultModuleView,
  isImportSourceKey,
  isModuleKey,
  type ImportSourceKey,
  type ModuleKey,
  type ModuleViewKey,
} from "./navigation-catalog";
import { normalizeModuleView, parseModuleView } from "./module-view-contract";
import { defaultShopLocationContext, parseShopLocationContext, writeShopLocationContext, shopContextKeys, validShopReturn, type ShopLocationContext } from "./shop-context";
import type { ProductIdentity } from "@/lib/netshop/insights-contract";

export const shellPeriodKeys = [
  "today",
  "yesterday",
  "last7",
  "last15",
  "last30",
  "previous_year",
  "current_month",
  "calendar_month",
  "custom",
] as const;

export type ShellPeriodKey = (typeof shellPeriodKeys)[number];

export type ShellPeriodState =
  | { kind: "today" | "yesterday" | "last7" | "last15" | "last30" | "current_month" }
  | { kind: "calendar_month"; month: string }
  | { kind: "custom"; from: string; to: string; intent?: "rolling" | "quarter" }
  | { kind: "previous_year"; from: string; to: string };

export type StoreOverviewLocation = {
  view: "classic" | "balanced";
  platform: "天猫" | "京东";
  outlets: string[];
  trend: "day" | "week" | "month";
  detail: "day" | "seven_days";
  previous: boolean;
  yearAgo: boolean;
};
export const defaultStoreOverviewLocation: StoreOverviewLocation = { view: "classic", platform: "天猫", outlets: [], trend: "day", detail: "day", previous: true, yearAgo: true };
function parseStoreOverview(params: URLSearchParams): StoreOverviewLocation {
  const platform = singleQueryValue(params, "overviewPlatform") === "京东" ? "京东" : "天猫";
  const outlets = [...new Set(params.getAll("overviewOutlet"))].filter(k => k.startsWith(platform + "\u001f") && k.split("\u001f").length === 2 && k.length <= 201 && k.split("\u001f")[1].trim().length > 0).slice(0, 50).sort();
  const trend = singleQueryValue(params, "overviewTrend");
  return { view: singleQueryValue(params, "overviewView") === "balanced" ? "balanced" : "classic", platform, outlets,
    trend: trend === "week" || trend === "month" ? trend : "day",
    detail: singleQueryValue(params, "overviewDetail") === "seven_days" ? "seven_days" : "day",
    previous: singleQueryValue(params, "overviewPrevious") !== "0", yearAgo: singleQueryValue(params, "overviewYearAgo") !== "0" };
}

export type ShellLocationState<M extends ModuleKey = ModuleKey> = {
  module: M;
  view: ModuleViewKey<M>;
  source?: ImportSourceKey;
  period: ShellPeriodState;
  overview?: StoreOverviewLocation;
  shop?: ShopLocationContext;
};

export type ShellLocationInput<M extends ModuleKey = ModuleKey> =
  Omit<ShellLocationState<M>, "view"> & { view?: ModuleViewKey<M> };

export const shellOwnedQueryKeys = ["module", "view", "salesTab", "source", "period", "month", "from", "to", "overviewView", "overviewPlatform", "overviewOutlet", "overviewTrend", "overviewDetail", "overviewPrevious", "overviewYearAgo", "periodIntent", ...shopContextKeys] as const;

const relativeOrCurrentPeriodKeys: ReadonlySet<string> = new Set([
  "today",
  "yesterday",
  "last7",
  "last15",
  "last30",
  "current_month",
]);

const LOCAL_URL_ORIGIN = "https://teruisi-shell.invalid";

function toUrl(input: string | URL): URL {
  return input instanceof URL ? new URL(input.toString()) : new URL(input, LOCAL_URL_ORIGIN);
}

function toRelativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function singleQueryValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parsePeriod(params: URLSearchParams): ShellPeriodState {
  const period = singleQueryValue(params, "period");
  if (period === null || period === "current_month") return { kind: "current_month" };
  if (relativeOrCurrentPeriodKeys.has(period)) {
    return { kind: period as "today" | "yesterday" | "last7" | "last15" | "last30" };
  }
  if (period === "calendar_month") {
    const month = singleQueryValue(params, "month");
    return month !== null && isIsoMonth(month)
      ? { kind: "calendar_month", month }
      : { kind: "current_month" };
  }
  if (period === "custom" || period === "previous_year") {
    const from = singleQueryValue(params, "from");
    const to = singleQueryValue(params, "to");
    return from !== null && to !== null && isIsoDate(from) && isIsoDate(to) && from <= to
      ? { kind: period, from, to, ...(period === "custom" && ["rolling", "quarter"].includes(singleQueryValue(params, "periodIntent") ?? "") ? { intent: singleQueryValue(params, "periodIntent") as "rolling" | "quarter" } : {}) }
      : { kind: "current_month" };
  }
  return { kind: "current_month" };
}

function parseShellView<M extends ModuleKey>(module: M, params: URLSearchParams): ModuleViewKey<M> {
  if (params.has("view") || module !== "sales") return parseModuleView(module, params);
  const legacySalesView = singleQueryValue(params, "salesTab");
  return normalizeModuleView(module, legacySalesView);
}

export function parseShellLocation(input: string | URL): ShellLocationState {
  const url = toUrl(input);
  const moduleValue = singleQueryValue(url.searchParams, "module");
  const activeModule = moduleValue !== null && isModuleKey(moduleValue) ? moduleValue : "dashboard";
  const sourceValue = singleQueryValue(url.searchParams, "source");
  const source = activeModule === "import" && sourceValue !== null && isImportSourceKey(sourceValue)
    ? sourceValue
    : undefined;
  return {
    module: activeModule,
    view: parseShellView(activeModule, url.searchParams),
    ...(source ? { source } : {}),
    period: parsePeriod(url.searchParams),
    ...(activeModule === "shop" && parseShellView(activeModule, url.searchParams) === "outlets" ? { overview: parseStoreOverview(url.searchParams) } : {}),
    ...(activeModule === "shop" && shopContextKeys.some(k => url.searchParams.has(k)) ? { shop: parseShopLocationContext(url.searchParams) } : {}),
  };
}

function writeShellState<M extends ModuleKey>(url: URL, state: ShellLocationInput<M>): void {
  const currentModuleValue = singleQueryValue(url.searchParams, "module");
  const currentModule = currentModuleValue !== null && isModuleKey(currentModuleValue)
    ? currentModuleValue
    : "dashboard";
  const requestedView = state.view ?? (currentModule === state.module
    ? parseShellView(state.module, url.searchParams)
    : undefined);

  const existingOverview = currentModule === "shop" ? parseStoreOverview(url.searchParams) : defaultStoreOverviewLocation;
  const existingShop = currentModule === "shop" ? parseShopLocationContext(url.searchParams) : undefined;
  const existingPeriod = parsePeriod(url.searchParams);
  for (const key of shellOwnedQueryKeys) url.searchParams.delete(key);

  if (state.module !== "dashboard") url.searchParams.append("module", state.module);
  const view = normalizeModuleView(state.module, requestedView);
  if (view !== getDefaultModuleView(state.module)) url.searchParams.append("view", view);
  if (state.module === "import" && state.source && isImportSourceKey(state.source)) {
    url.searchParams.append("source", state.source);
  }
  if (state.module === "shop" && (state.shop || existingShop)) {
    const nextShop = { ...(state.shop ?? existingShop!) };
    if (existingShop && JSON.stringify(existingPeriod) !== JSON.stringify(state.period)) {
      nextShop.page = 1;
      nextShop.returnTo = null;
      nextShop.returnOrigin = null;
      nextShop.productsPrefs = null;
    }
    writeShopLocationContext(url.searchParams, nextShop);
  }

  if (state.module === "shop" && view === "outlets") {
    const overview = state.overview ?? existingOverview;
    if (overview.view === "balanced") url.searchParams.append("overviewView", "balanced");
    if (overview.platform === "京东") url.searchParams.append("overviewPlatform", "京东");
    overview.outlets.forEach(k => url.searchParams.append("overviewOutlet", k));
    if (overview.trend !== "day") url.searchParams.append("overviewTrend", overview.trend);
    if (overview.detail !== "day") url.searchParams.append("overviewDetail", overview.detail);
    if (!overview.previous) url.searchParams.append("overviewPrevious", "0");
    if (!overview.yearAgo) url.searchParams.append("overviewYearAgo", "0");
  }
  if (state.period.kind === "current_month") return;
  url.searchParams.append("period", state.period.kind);
  if (state.period.kind === "calendar_month") url.searchParams.append("month", state.period.month);
  if (state.period.kind === "custom" || state.period.kind === "previous_year") {
    url.searchParams.append("from", state.period.from);
    url.searchParams.append("to", state.period.to);
    if (state.period.kind === "custom") {
      const intent = state.period.intent;
      if (intent) url.searchParams.append("periodIntent", intent);
    }
  }
}

export function serializeShellLocation<M extends ModuleKey>(
  state: ShellLocationInput<M>,
  current: string | URL = "/",
): string {
  const url = toUrl(current);
  writeShellState(url, state);
  return toRelativeUrl(url);
}

export function normalizeShellLocation(input: string | URL): string {
  const url = toUrl(input);
  writeShellState(url, parseShellLocation(url));
  return toRelativeUrl(url);
}

/**
 * Pure shell URL transition used by tabs and history navigation. The current
 * period and a valid import source survive a view change; unrelated query
 * fields and the hash are preserved by the serializer.
 */
export function updateModuleViewLocation<M extends ModuleKey>(
  input: string | URL,
  module: M,
  view: ModuleViewKey<M>,
): string {
  const current = parseShellLocation(input);
  return serializeShellLocation({
    module,
    view: normalizeModuleView(module, view),
    ...(module === "import" && current.module === "import" && current.source
      ? { source: current.source }
      : {}),
    period: current.period,
  }, input);
}

export type ShopContext = ShopLocationContext & { period: ShellPeriodState };
export function shopContextFromLocation(input: string | URL): ShopContext {
  const state = parseShellLocation(input);
  return { ...(state.shop ?? defaultShopLocationContext), period: state.period };
}
/** Range/list filters reset page; a refresh of the same normalized scope keeps it. */
export function updateShopContextLocation(input: string | URL, patch: Partial<ShopLocationContext>): string {
  const state = parseShellLocation(input), before = state.shop ?? defaultShopLocationContext;
  const next = { ...before, ...patch };
  const params = new URLSearchParams(); writeShopLocationContext(params, next);
  const canonical = parseShopLocationContext(params);
  const scope = (v: ShopLocationContext) => JSON.stringify([v.platforms, v.outlets, v.dimension, v.category, v.q, v.pageSize]);
  if (scope(before) !== scope(canonical)) canonical.page = 1;
  if (JSON.stringify([before.platforms, before.outlets, before.dimension]) !== JSON.stringify([canonical.platforms, canonical.outlets, canonical.dimension])) {
    canonical.returnTo = null;
    canonical.returnOrigin = null;
    canonical.productsPrefs = null;
  }
  if ((before.productsPrefs?.sort ?? "payment_desc") !== (canonical.productsPrefs?.sort ?? "payment_desc")) canonical.page = 1;
  return serializeShellLocation({ module: "shop", view: state.module === "shop" ? state.view as ModuleViewKey<"shop"> : "analysis", period: state.period, shop: canonical }, input);
}
export function drillShopLocation(input: string | URL, view: ModuleViewKey<"shop">, product: ProductIdentity | null, section = ""): string {
  const state = parseShellLocation(input), before = state.shop ?? defaultShopLocationContext;
  const returnTo = serializeShellLocation({ module: "shop", view: state.module === "shop" ? state.view as ModuleViewKey<"shop"> : "analysis", period: state.period, ...(state.overview ? { overview: state.overview } : {}), shop: { ...before, returnTo: null, returnOrigin: null } }, "/");
  const returnOrigin = state.module === "shop" && state.view === "products" && before.product && view === "promotion" ? validShopReturn(before.returnTo) : null;
  const shop = { ...before, product, section, page: 1, returnTo, returnOrigin, ...(product ? { platforms: [product.platform], outlets: [product.platform+"\u001f"+product.shopName], dimension: product.dimension } : {}) };
  return serializeShellLocation({ module: "shop", view, period: state.period, shop }, input);
}
export function returnShopLocation(input: string | URL): string {
  const state = parseShellLocation(input), target = validShopReturn(state.shop?.returnTo ?? null);
  if (target) {
    const destination = parseShellLocation(target);
    const origin = validShopReturn(state.shop?.returnOrigin ?? null);
    if (origin && destination.module === "shop" && destination.view === "products" && destination.shop?.product) {
      return serializeShellLocation({ ...destination, shop: { ...destination.shop, returnTo: origin, returnOrigin: null } }, target);
    }
    return normalizeShellLocation(target);
  }
  return serializeShellLocation({ module: "shop", view: "products", period: state.period, shop: { ...(state.shop ?? defaultShopLocationContext), product: null, returnTo: null, returnOrigin: null } }, input);
}
