CREATE INDEX IF NOT EXISTS `market_entries_annotation_catalog_idx`
ON `market_ranking_entries` (`category`,`sku_code`,`period_end` DESC,`updated_at` DESC,`id` DESC);
