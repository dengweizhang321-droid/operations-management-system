CREATE INDEX IF NOT EXISTS market_annotation_items_reuse_idx
  ON market_annotation_items(category, scope, sku_code, ranking_dimension, image_content_sha256, status, updated_at);
