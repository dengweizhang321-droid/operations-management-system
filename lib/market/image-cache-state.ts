import type { MarketSchemaDatabase } from "@/lib/market/schema-core";

export async function claimMarketImageCache(db: MarketSchemaDatabase, sourceUrl: string) {
  const claim = await db.prepare(`INSERT INTO market_image_cache (source_url, status, attempt_count, updated_at)
    VALUES (?, 'fetching', 1, CURRENT_TIMESTAMP)
    ON CONFLICT(source_url) DO UPDATE SET status='fetching', attempt_count=attempt_count+1,
      error_code='', error_message='', updated_at=CURRENT_TIMESTAMP
    WHERE market_image_cache.status IN ('pending','failed') AND market_image_cache.attempt_count<3
    RETURNING attempt_count attemptCount`).bind(sourceUrl).first<{ attemptCount: number }>();
  return claim ? Number(claim.attemptCount) : null;
}

export async function failMarketImageCacheClaim(
  db: MarketSchemaDatabase,
  input: { sourceUrl: string; attemptCount: number; errorCode: string; errorMessage: string },
) {
  const failed = await db.prepare(`UPDATE market_image_cache SET status='failed', error_code=?, error_message=?, updated_at=CURRENT_TIMESTAMP
    WHERE source_url=? AND status='fetching' AND attempt_count=?`)
    .bind(input.errorCode, input.errorMessage.slice(0, 300), input.sourceUrl, input.attemptCount).run() as { meta?: { changes?: number } };
  return Number(failed.meta.changes ?? 0) === 1;
}

export async function completeMarketImageCacheClaim(
  db: MarketSchemaDatabase,
  input: {
    sourceUrl: string;
    attemptCount: number;
    objectKey: string;
    contentHash: string;
    mimeType: string;
    sizeBytes: number;
    imageSource: string;
  },
) {
  const writes = await db.batch([
    db.prepare(`UPDATE market_image_cache SET status='ready', object_key=?, content_sha256=?, mime_type=?,
      size_bytes=?, image_source=?, error_code='', error_message='', updated_at=CURRENT_TIMESTAMP
      WHERE source_url=? AND status='fetching' AND attempt_count=?`)
      .bind(input.objectKey, input.contentHash, input.mimeType, input.sizeBytes, input.imageSource, input.sourceUrl, input.attemptCount),
    db.prepare(`UPDATE market_price_snapshots SET image_content_sha256=?,
      image_url=CASE WHEN image_url='' THEN ? ELSE image_url END, updated_at=CURRENT_TIMESTAMP
      WHERE image_content_sha256=''
        AND (image_url=? OR (image_url='' AND EXISTS (
          SELECT 1 FROM market_ranking_entries ranking
          WHERE ranking.category=market_price_snapshots.category
            AND ranking.scope=market_price_snapshots.scope
            AND ranking.sku_code=market_price_snapshots.sku_code
            AND ranking.ranking_dimension=market_price_snapshots.ranking_dimension
            AND substr(ranking.period_end,1,7)=market_price_snapshots.month
            AND ranking.image_url=?
        )))
        AND EXISTS (SELECT 1 FROM market_image_cache cache
          WHERE cache.source_url=? AND cache.status='ready' AND cache.content_sha256=? AND cache.attempt_count=?)`)
      .bind(input.contentHash, input.sourceUrl, input.sourceUrl, input.sourceUrl, input.sourceUrl, input.contentHash, input.attemptCount),
  ]) as Array<{ meta?: { changes?: number } }>;
  return {
    completed: Number(writes[0]?.meta?.changes ?? 0) === 1,
    snapshotsUpdated: Number(writes[1]?.meta?.changes ?? 0),
  };
}
