import { env } from "cloudflare:workers";

import { fetchAnnotationImage } from "@/lib/market/annotation-image";
import { ensureMarketSchema, getMarketDatabase, type MarketDatabase } from "@/lib/market/database";

const MAX_CACHE_BATCH = 24;
const CACHE_CONCURRENCY = 4;
const CACHE_MAX_BYTES = 6 * 1024 * 1024;
const CACHE_TIMEOUT_MS = 8_000;

type CacheCandidate = { source_url: string };

function bucket() {
  if (!env.SALES_IMPORT_FILES) throw new Error("R2 图片缓存未配置");
  return env.SALES_IMPORT_FILES;
}

function extension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cacheOne(db: MarketDatabase, sourceUrl: string) {
  await db.prepare(`INSERT INTO market_image_cache (source_url, status, attempt_count, updated_at)
    VALUES (?, 'fetching', 1, CURRENT_TIMESTAMP)
    ON CONFLICT(source_url) DO UPDATE SET status='fetching', attempt_count=attempt_count+1,
      error_code='', error_message='', updated_at=CURRENT_TIMESTAMP`).bind(sourceUrl).run();
  try {
    const result = await fetchAnnotationImage(sourceUrl, { maxBytes: CACHE_MAX_BYTES, timeoutMs: CACHE_TIMEOUT_MS });
    if (result.kind !== "image") {
      await db.prepare("UPDATE market_image_cache SET status='failed', error_code=?, error_message=?, updated_at=CURRENT_TIMESTAMP WHERE source_url=?")
        .bind(result.reason, result.message.slice(0, 300), sourceUrl).run();
      return { cached: false, reason: result.reason };
    }
    const contentHash = await sha256(result.bytes);
    const objectKey = `market-images/v1/${contentHash}.${extension(result.mimeType)}`;
    const existing = await bucket().head(objectKey);
    if (!existing) {
      await bucket().put(objectKey, result.bytes, {
        httpMetadata: { contentType: result.mimeType, cacheControl: "private, max-age=31536000, immutable" },
        customMetadata: { source: "jd-market-ranking", sha256: contentHash },
      });
    }
    await db.prepare(`UPDATE market_image_cache SET status='ready', object_key=?, content_sha256=?, mime_type=?,
      size_bytes=?, image_source=?, error_code='', error_message='', updated_at=CURRENT_TIMESTAMP WHERE source_url=?`)
      .bind(objectKey, contentHash, result.mimeType, result.bytes.byteLength, result.source, sourceUrl).run();
    return { cached: true, contentHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片缓存失败";
    await db.prepare("UPDATE market_image_cache SET status='failed', error_code='cache_failed', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE source_url=?")
      .bind(message.slice(0, 300), sourceUrl).run().catch(() => undefined);
    return { cached: false, reason: "cache_failed" };
  }
}

async function cacheStats(db: MarketDatabase, batchId?: string) {
  const batchClause = batchId ? "AND m.last_import_batch_id=?" : "";
  const row = await db.prepare(`WITH urls AS (
      SELECT DISTINCT m.image_url source_url FROM market_ranking_entries m
      WHERE m.image_url<>'' ${batchClause}
    )
    SELECT COUNT(*) total,
      SUM(CASE WHEN c.status='ready' THEN 1 ELSE 0 END) cached,
      SUM(CASE WHEN c.status='failed' AND c.attempt_count>=3 THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN c.status IS NULL OR c.status IN ('pending','fetching') OR (c.status='failed' AND c.attempt_count<3) THEN 1 ELSE 0 END) pending
    FROM urls u LEFT JOIN market_image_cache c ON c.source_url=u.source_url`)
    .bind(...(batchId ? [batchId] : [])).first<{ total: number; cached: number; failed: number; pending: number }>();
  return { total: Number(row?.total ?? 0), cached: Number(row?.cached ?? 0), failed: Number(row?.failed ?? 0), pending: Number(row?.pending ?? 0) };
}

export async function cacheMarketImages(input: { db?: MarketDatabase; batchId?: string; limit?: number } = {}) {
  const db = input.db ?? getMarketDatabase();
  await ensureMarketSchema(db);
  await db.prepare("UPDATE market_image_cache SET status='failed', error_code='stale_fetch', error_message='缓存任务超时，可安全重试', updated_at=CURRENT_TIMESTAMP WHERE status='fetching' AND datetime(updated_at)<datetime('now','-10 minutes')").run();
  const limit = Math.max(1, Math.min(MAX_CACHE_BATCH, Math.trunc(input.limit ?? 12)));
  const batchClause = input.batchId ? "AND m.last_import_batch_id=?" : "";
  const candidates = await db.prepare(`SELECT DISTINCT m.image_url source_url
    FROM market_ranking_entries m LEFT JOIN market_image_cache c ON c.source_url=m.image_url
    WHERE m.image_url<>'' ${batchClause}
      AND (c.source_url IS NULL OR c.status='pending' OR (c.status='failed' AND c.attempt_count<3))
    ORDER BY CASE WHEN m.rank IS NULL THEN 1 ELSE 0 END, m.rank, m.period_end DESC LIMIT ?`)
    .bind(...(input.batchId ? [input.batchId, limit] : [limit])).all<CacheCandidate>();
  const queue = [...(candidates.results ?? [])];
  const results: Array<{ cached: boolean; reason?: string }> = [];
  const worker = async () => {
    while (queue.length) {
      const candidate = queue.shift();
      if (candidate) results.push(await cacheOne(db, candidate.source_url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CACHE_CONCURRENCY, queue.length) }, worker));
  return {
    processed: results.length,
    cachedThisRun: results.filter((item) => item.cached).length,
    failedThisRun: results.filter((item) => !item.cached).length,
    ...(await cacheStats(db, input.batchId)),
  };
}

export async function getCachedMarketImage(contentHash: string, db: MarketDatabase = getMarketDatabase()) {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) return null;
  await ensureMarketSchema(db);
  const row = await db.prepare("SELECT object_key objectKey, mime_type mimeType, size_bytes sizeBytes FROM market_image_cache WHERE content_sha256=? AND status='ready' LIMIT 1")
    .bind(contentHash).first<{ objectKey: string; mimeType: string; sizeBytes: number }>();
  if (!row?.objectKey) return null;
  const object = await bucket().get(row.objectKey);
  return object ? { object, ...row } : null;
}
