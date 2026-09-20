CREATE INDEX IF NOT EXISTS `market_entries_rank_order_idx`
ON `market_ranking_entries` ((rank IS NULL), `rank`, `gmv_cents` DESC, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_entries_image_url_idx`
ON `market_ranking_entries` (`image_url`) WHERE `image_url`<>'';
