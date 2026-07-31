WITH ranked_standard_prices AS (
  SELECT source.category, source.scope, source.sku_code, source.ranking_dimension,
    source.image_content_sha256,
    source.confirmed_market_price_cents, source.price_low_cents, source.price_high_cents,
    source.source_job_item_id, source.prompt_version_id,
    ROW_NUMBER() OVER (
      PARTITION BY source.category, source.scope, source.sku_code, source.ranking_dimension, source.image_content_sha256
      ORDER BY datetime(COALESCE(source.confirmed_at, source.updated_at)) DESC,
        source.month DESC, source.id DESC
    ) standard_rank
  FROM market_price_snapshots source
  WHERE source.ranking_dimension='SKU'
    AND source.confirmed_market_price_cents IS NOT NULL
    AND source.confirmation_status='confirmed'
    AND source.ai_price_type='标准售价'
    AND source.image_content_sha256<>''
), latest_standard_prices AS (
  SELECT * FROM ranked_standard_prices WHERE standard_rank=1
)
UPDATE market_price_snapshots AS target
SET ai_image_price_cents=(SELECT source.confirmed_market_price_cents FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256),
  ai_price_type='标准售价',
  confirmed_market_price_cents=(SELECT source.confirmed_market_price_cents FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256),
  price_low_cents=COALESCE((SELECT source.price_low_cents FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256), price_low_cents),
  price_high_cents=COALESCE((SELECT source.price_high_cents FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256), price_high_cents),
  confirmation_status='confirmed', confirmed_by='system:history_same_image', confirmed_at=CURRENT_TIMESTAMP,
  source_job_item_id=COALESCE((SELECT NULLIF(source.source_job_item_id, '') FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256), source_job_item_id),
  prompt_version_id=COALESCE((SELECT NULLIF(source.prompt_version_id, '') FROM latest_standard_prices source
      WHERE source.category=target.category AND source.scope=target.scope
        AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
        AND source.image_content_sha256=target.image_content_sha256), prompt_version_id),
  updated_at=CURRENT_TIMESTAMP
WHERE target.ranking_dimension='SKU' AND target.image_content_sha256<>'' AND target.confirmed_market_price_cents IS NULL
  AND EXISTS (SELECT 1 FROM latest_standard_prices source
    WHERE source.category=target.category AND source.scope=target.scope
      AND source.sku_code=target.sku_code AND source.ranking_dimension=target.ranking_dimension
      AND source.image_content_sha256=target.image_content_sha256);
