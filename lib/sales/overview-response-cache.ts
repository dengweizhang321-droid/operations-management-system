import type { SalesRange } from "@/lib/sales/summary";

type CacheStatement = {
  bind(...values: unknown[]): CacheStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type SalesOverviewResponseCacheDatabase = {
  prepare(sql: string): CacheStatement;
};

export type SalesOverviewCacheIdentity = {
  range: SalesRange;
  projection?: "full" | "dashboard";
  startDate?: string;
  endDate?: string;
  productQueries?: string[];
  platforms?: string[];
  shop?: string;
  outlets?: Array<{ platform: string; shop: string }>;
  categories?: string[];
  businessDate: string;
};

type CacheRevisionRow = {
  sales_revision: number;
  erp_product_revision: number;
};

type CachePayloadRow = {
  payload_json: string;
};

export type SalesOverviewCacheResult<T> = {
  payload: T;
  status: "hit" | "miss" | "coalesced";
};

export class SalesOverviewRevisionChangedError extends Error {
  readonly code = "sales_overview_revision_changed";

  constructor() {
    super("销售数据版本持续变化，请稍后重试。");
    this.name = "SalesOverviewRevisionChangedError";
  }
}

const CACHE_FORMAT_VERSION = 2;
const CACHE_MAX_ROWS = 80;
const inFlight = new Map<string, Promise<SalesOverviewCacheResult<unknown>>>();

function normalizedList(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizedOutlets(values: SalesOverviewCacheIdentity["outlets"]) {
  return [...new Map((values ?? [])
    .map((value) => ({ platform: value.platform.trim(), shop: value.shop.trim() }))
    .filter((value) => value.platform && value.shop)
    .map((value) => [`${value.platform}\u001f${value.shop}`, value])).values()]
    .sort((left, right) => `${left.platform}\u001f${left.shop}`.localeCompare(`${right.platform}\u001f${right.shop}`));
}

export function canonicalSalesOverviewCacheIdentity(identity: SalesOverviewCacheIdentity) {
  return JSON.stringify({
    formatVersion: CACHE_FORMAT_VERSION,
    businessDate: identity.businessDate,
    range: identity.range,
    projection: identity.projection ?? "full",
    startDate: identity.startDate?.trim() || "",
    endDate: identity.endDate?.trim() || "",
    productQueries: normalizedList(identity.productQueries),
    platforms: normalizedList(identity.platforms),
    shop: identity.shop?.trim() || "",
    outlets: normalizedOutlets(identity.outlets),
    categories: normalizedList(identity.categories),
  });
}

export function salesOverviewBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getSalesOverviewCacheRevision(db: SalesOverviewResponseCacheDatabase) {
  const row = await db.prepare(`SELECT sales_revision, erp_product_revision
    FROM sales_overview_cache_state WHERE id = 1`)
    .first<CacheRevisionRow>();
  return `${Number(row?.sales_revision ?? 0)}:${Number(row?.erp_product_revision ?? 0)}`;
}

async function readCachedPayload<T>(
  db: SalesOverviewResponseCacheDatabase,
  cacheKey: string,
  revisionKey: string,
): Promise<T | null> {
  const row = await db.prepare(`SELECT cache.payload_json
    FROM sales_overview_response_cache cache
    JOIN sales_overview_cache_state state ON state.id = 1
    WHERE cache.cache_key = ? AND cache.revision_key = ?
      AND cache.revision_key = CAST(state.sales_revision AS TEXT)
        || ':' || CAST(state.erp_product_revision AS TEXT)`)
    .bind(cacheKey, revisionKey)
    .first<CachePayloadRow>();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    await db.prepare(`DELETE FROM sales_overview_response_cache
      WHERE cache_key = ? AND revision_key = ? AND payload_json = ?`)
      .bind(cacheKey, revisionKey, row.payload_json).run().catch(() => undefined);
    return null;
  }
}

async function writeCachedPayload<T>(
  db: SalesOverviewResponseCacheDatabase,
  cacheKey: string,
  revisionKey: string,
  payload: T,
) {
  await db.prepare(`INSERT INTO sales_overview_response_cache
    (cache_key, revision_key, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      revision_key = excluded.revision_key,
      payload_json = excluded.payload_json,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(cacheKey, revisionKey, JSON.stringify(payload)).run();
  await db.prepare(`DELETE FROM sales_overview_response_cache
    WHERE updated_at < datetime('now', '-1 day') OR cache_key NOT IN (
      SELECT cache_key FROM sales_overview_response_cache ORDER BY updated_at DESC LIMIT ?
    )`).bind(CACHE_MAX_ROWS).run().catch(() => undefined);
}

export async function getCachedSalesOverview<T>(
  db: SalesOverviewResponseCacheDatabase,
  identity: SalesOverviewCacheIdentity,
  load: () => Promise<T>,
): Promise<SalesOverviewCacheResult<T>> {
  const [cacheKey, revisionKey] = await Promise.all([
    sha256(canonicalSalesOverviewCacheIdentity(identity)),
    getSalesOverviewCacheRevision(db),
  ]);
  const flightKey = `${cacheKey}:${revisionKey}`;
  const running = inFlight.get(flightKey);
  if (running) {
    const result = await running as SalesOverviewCacheResult<T>;
    return { payload: result.payload, status: "coalesced" };
  }

  const task = (async (): Promise<SalesOverviewCacheResult<T>> => {
    let activeRevisionKey = revisionKey;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cached = await readCachedPayload<T>(db, cacheKey, activeRevisionKey);
      if (cached !== null) return { payload: cached, status: "hit" };

      const payload = await load();
      const revisionAfterLoad = await getSalesOverviewCacheRevision(db);
      if (revisionAfterLoad === activeRevisionKey) {
        await writeCachedPayload(db, cacheKey, activeRevisionKey, payload);
        return { payload, status: "miss" };
      }
      activeRevisionKey = revisionAfterLoad;
    }
    throw new SalesOverviewRevisionChangedError();
  })();
  inFlight.set(flightKey, task as Promise<SalesOverviewCacheResult<unknown>>);
  try {
    return await task;
  } finally {
    inFlight.delete(flightKey);
  }
}
