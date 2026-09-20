WITH ranked_published AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY category
    ORDER BY effective_from DESC, version DESC, COALESCE(published_at, '') DESC, id DESC
  ) AS published_rank
  FROM market_price_band_versions
  WHERE status = 'published'
)
UPDATE market_price_band_versions
SET status = 'archived'
WHERE id IN (
  SELECT id FROM ranked_published WHERE published_rank > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_price_band_versions_published_category_uq
  ON market_price_band_versions (category)
  WHERE status = 'published';
