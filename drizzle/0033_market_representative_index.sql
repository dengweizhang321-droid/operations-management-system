CREATE INDEX IF NOT EXISTS `market_entries_representative_idx`
ON `market_ranking_entries` (`category`,`scope`,`ranking_dimension`,`sku_code`,`period_end` DESC,`period_start` DESC,`id` DESC);
