import { env } from "cloudflare:workers";

import { encodeAnnotationImageBase64, fetchAnnotationImage, resolveAnnotationImageCandidates, type AnnotationImageSource } from "@/lib/market/annotation-image";
import { optimizeAnnotationImageWithRuntime } from "@/lib/market/annotation-image-runtime";
import { annotationModelImageObjectKey, cachedAnnotationModelImage } from "@/lib/market/annotation-model-image";
import { ensureMarketSchema, getMarketDatabase, type MarketDatabase } from "@/lib/market/database";
import { claimMarketImageCache, completeMarketImageCacheClaim, failMarketImageCacheClaim } from "@/lib/market/image-cache-state";

const MAX_CACHE_BATCH = 24;
const CACHE_CONCURRENCY = 4;
const CACHE_MAX_BYTES = 6 * 1024 * 1024;
const CACHE_TIMEOUT_MS = 8_000;

type CacheCandidate = { source_url: string };
type CacheResult = { cached: boolean; skipped?: boolean; reason?: string; contentHash?: string };

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

async function cacheOne(db: MarketDatabase, sourceUrl: string): Promise<CacheResult> {
  const attemptCount = await claimMarketImageCache(db, sourceUrl);
  if (attemptCount === null) return { cached: false, skipped: true, reason: "already_claimed" };
  try {
    const result = await fetchAnnotationImage(sourceUrl, { maxBytes: CACHE_MAX_BYTES, timeoutMs: CACHE_TIMEOUT_MS });
    if (result.kind !== "image") {
      const failed = await failMarketImageCacheClaim(db, { sourceUrl, attemptCount, errorCode: result.reason, errorMessage: result.message });
      if (!failed) return { cached: false, skipped: true, reason: "lost_claim" };
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
    await cacheAnnotationModelVariant(contentHash, result).catch(() => undefined);
    const completed = await completeMarketImageCacheClaim(db, {
      sourceUrl, attemptCount, objectKey, contentHash, mimeType: result.mimeType,
      sizeBytes: result.bytes.byteLength, imageSource: result.source,
    });
    if (!completed.completed) return { cached: false, skipped: true, reason: "lost_claim" };
    return { cached: true, contentHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片缓存失败";
    const failed = await failMarketImageCacheClaim(db, { sourceUrl, attemptCount, errorCode: "cache_failed", errorMessage: message }).catch(() => false);
    if (!failed) return { cached: false, skipped: true, reason: "lost_claim" };
    return { cached: false, reason: "cache_failed" };
  }
}

async function cacheAnnotationModelVariant(contentHash: string, image: Extract<Awaited<ReturnType<typeof fetchAnnotationImage>>, { kind: "image" }>) {
  const objectKey = annotationModelImageObjectKey(contentHash);
  if (await bucket().head(objectKey)) return;
  const optimized = await optimizeAnnotationImageWithRuntime(image);
  if (!optimized.optimizedForModel) return;
  await bucket().put(objectKey, optimized.bytes, {
    httpMetadata: { contentType: optimized.mimeType, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { source: "market-annotation-model-input", sha256: contentHash },
  });
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
  const results: CacheResult[] = [];
  const worker = async () => {
    while (queue.length) {
      const candidate = queue.shift();
      if (candidate) results.push(await cacheOne(db, candidate.source_url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CACHE_CONCURRENCY, queue.length) }, worker));
  return {
    processed: results.filter((item) => !item.skipped).length,
    cachedThisRun: results.filter((item) => item.cached).length,
    failedThisRun: results.filter((item) => !item.cached && !item.skipped).length,
    skippedThisRun: results.filter((item) => item.skipped).length,
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

export async function getCachedMarketImageForAnnotation(sourceUrl: string, db: MarketDatabase) {
  if (!sourceUrl) return null;
  const row = await db.prepare(`SELECT object_key objectKey, content_sha256 contentHash, mime_type mimeType, size_bytes sizeBytes, image_source imageSource
    FROM market_image_cache WHERE source_url=? AND status='ready' AND object_key<>'' LIMIT 1`)
    .bind(sourceUrl).first<{ objectKey: string; contentHash: string; mimeType: string; sizeBytes: number; imageSource: string }>();
  if (!row?.objectKey || !["image/jpeg", "image/png", "image/webp"].includes(row.mimeType)) return null;
  const source = (row.imageSource === "n5" ? "n5" : "imgzone") as AnnotationImageSource;
  const resolvedUrl = resolveAnnotationImageCandidates(sourceUrl).find((candidate) => candidate.source === source)?.url;
  if (!resolvedUrl) return null;
  const modelObject = row.contentHash
    ? await bucket().get(annotationModelImageObjectKey(row.contentHash)).catch(() => null)
    : null;
  if (modelObject) {
    const modelBytes = new Uint8Array(await modelObject.arrayBuffer());
    if (modelBytes.byteLength > 0 && modelBytes.byteLength < Number(row.sizeBytes) && modelBytes.byteLength <= CACHE_MAX_BYTES) {
      const optimized = cachedAnnotationModelImage({ kind: "image", source, url: resolvedUrl }, modelBytes);
      if (optimized) return optimized;
    }
  }
  const object = await bucket().get(row.objectKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength !== Number(row.sizeBytes) || bytes.byteLength > CACHE_MAX_BYTES) return null;
  return {
    kind: "image" as const,
    source,
    url: resolvedUrl,
    mimeType: row.mimeType,
    bytes,
    base64: encodeAnnotationImageBase64(bytes),
  };
}
