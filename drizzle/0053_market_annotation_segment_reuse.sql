CREATE INDEX IF NOT EXISTS market_annotation_items_segment_reuse_idx
ON market_annotation_items(category, scope, sku_code, ranking_dimension, status, updated_at);
