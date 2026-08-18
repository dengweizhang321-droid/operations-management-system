import type { MarketOverviewFilters } from "@/lib/market/database";

type CacheStatement = {
  bind(...values: unknown[]): CacheStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type MarketOverviewResponseCacheDatabase = {
  prepare(sql: string): CacheStatement;
};

type CacheIdentity = {
  view: "ranking" | "full";
  filters: MarketOverviewFilters;
  pagination?: { page: number; pageSize: number };
};

type CacheRevisionRow = {
  revision_key: string;
};

type CachePayloadRow = {
  payload_json: string;
};

export type MarketOverviewCacheResult<T> = {
  payload: T;
  status: "hit" | "miss" | "coalesced";
};

const CACHE_TTL_MINUTES = 5;
const CACHE_MAX_ROWS = 40;
const CACHE_FORMAT_VERSION = 3;
const inFlight = new Map<string, Promise<MarketOverviewCacheResult<unknown>>>();

function normalizedList(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function canonicalMarketOverviewCacheIdentity(identity: CacheIdentity) {
  const filters = identity.filters;
  return JSON.stringify({
    formatVersion: CACHE_FORMAT_VERSION,
    view: identity.view,
    query: filters.query?.trim() || "",
    categories: normalizedList(filters.categories),
    scopes: normalizedList(filters.scopes),
    brands: normalizedList(filters.brands),
    rankingDimensions: normalizedList(filters.rankingDimensions),
    operationModes: normalizedList(filters.operationModes),
    subcategories: normalizedList(filters.subcategories),
    priceBands: normalizedList(filters.priceBands),
    startDate: filters.startDate ?? "",
    endDate: filters.endDate ?? "",
    page: identity.view === "ranking" ? identity.pagination?.page ?? 1 : 1,
    pageSize: identity.view === "ranking" ? identity.pagination?.pageSize ?? 20 : 200,
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getMarketOverviewCacheRevision(db: MarketOverviewResponseCacheDatabase) {
  const row = await db.prepare(`SELECT
    CAST(COALESCE((SELECT source_revision FROM market_monthly_summary_cache_state WHERE id=1),0) AS TEXT)
      || ':' || CAST((SELECT COUNT(*) FROM market_image_cache) AS TEXT)
      || ':' || CAST(COALESCE((SELECT SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) FROM market_image_cache),0) AS TEXT)
      || ':' || CAST(COALESCE((SELECT SUM(CASE WHEN status='failed' AND attempt_count>=3 THEN 1 ELSE 0 END) FROM market_image_cache),0) AS TEXT)
      || ':' || COALESCE((SELECT MAX(updated_at) FROM market_image_cache),'')
      || ':' || COALESCE((SELECT GROUP_CONCAT(batch_signature,'|') FROM (
        SELECT id || ',' || status || ',' || file_name || ','
          || CAST(row_count AS TEXT) || ',' || CAST(inserted_count AS TEXT) || ','
          || CAST(updated_count AS TEXT) || ',' || CAST(warning_count AS TEXT) || ','
          || COALESCE(completed_at,'') AS batch_signature
        FROM market_import_batches ORDER BY created_at DESC LIMIT 8
      )),'')
      || ':' || CAST((SELECT COUNT(*) FROM market_subcategory_taxonomy) AS TEXT)
      || ':' || CAST(COALESCE((SELECT SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) FROM market_subcategory_taxonomy),0) AS TEXT)
      || ':' || COALESCE((SELECT MAX(updated_at) FROM market_subcategory_taxonomy),'') AS revision_key`)
    .first<CacheRevisionRow>();
  return row?.revision_key ?? "0";
}

async function readCachedPayload<T>(
  db: MarketOverviewResponseCacheDatabase,
  cacheKey: string,
  revisionKey: string,
): Promise<T | null> {
  const row = await db.prepare(`SELECT payload_json FROM market_overview_response_cache
    WHERE cache_key=? AND revision_key=?
      AND updated_at>=datetime('now', ?)`)
    .bind(cacheKey, revisionKey, `-${CACHE_TTL_MINUTES} minutes`)
    .first<CachePayloadRow>();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    await db.prepare("DELETE FROM market_overview_response_cache WHERE cache_key=?")
      .bind(cacheKey).run().catch(() => undefined);
    return null;
  }
}

async function writeCachedPayload<T>(
  db: MarketOverviewResponseCacheDatabase,
  cacheKey: string,
  revisionKey: string,
  payload: T,
) {
  await db.prepare(`INSERT INTO market_overview_response_cache
    (cache_key,revision_key,payload_json,created_at,updated_at)
    VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET
      revision_key=excluded.revision_key,
      payload_json=excluded.payload_json,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(cacheKey, revisionKey, JSON.stringify(payload)).run();
  await db.prepare(`DELETE FROM market_overview_response_cache
    WHERE updated_at<datetime('now','-1 day') OR cache_key NOT IN (
      SELECT cache_key FROM market_overview_response_cache ORDER BY updated_at DESC LIMIT ?
    )`).bind(CACHE_MAX_ROWS).run().catch(() => undefined);
}

export async function getCachedMarketOverview<T>(
  db: MarketOverviewResponseCacheDatabase,
  identity: CacheIdentity,
  load: () => Promise<T>,
): Promise<MarketOverviewCacheResult<T>> {
  const [cacheKey, revisionKey] = await Promise.all([
    sha256(canonicalMarketOverviewCacheIdentity(identity)),
    getMarketOverviewCacheRevision(db),
  ]);
  const flightKey = `${cacheKey}:${revisionKey}`;
  const running = inFlight.get(flightKey);
  if (running) {
    const result = await running as MarketOverviewCacheResult<T>;
    return { payload: result.payload, status: "coalesced" };
  }
  const task = (async (): Promise<MarketOverviewCacheResult<T>> => {
    const cached = await readCachedPayload<T>(db, cacheKey, revisionKey);
    if (cached !== null) return { payload: cached, status: "hit" };
    const payload = await load();
    await writeCachedPayload(db, cacheKey, revisionKey, payload);
    return { payload, status: "miss" };
  })();
  inFlight.set(flightKey, task as Promise<MarketOverviewCacheResult<unknown>>);
  try {
    return await task;
  } finally {
    inFlight.delete(flightKey);
  }
}
