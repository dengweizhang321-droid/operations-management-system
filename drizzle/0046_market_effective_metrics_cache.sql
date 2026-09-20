CREATE TABLE IF NOT EXISTS `market_effective_metrics_cache` (
  `market_entry_id` integer PRIMARY KEY NOT NULL,
  `effective_gmv_cents` integer,
  `real_gmv_cents` integer,
  `gmv_out_of_band` integer,
  `effective_quantity` integer,
  `effective_average_transaction_price_cents` integer,
  `effective_conversion_bps` integer
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_effective_metrics_cache_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `market_row_count` integer NOT NULL,
  `market_updated_at` text NOT NULL,
  `netshop_row_count` integer NOT NULL,
  `netshop_updated_at` text NOT NULL,
  `refreshed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_market_insert`
AFTER INSERT ON `market_ranking_entries` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_market_update`
AFTER UPDATE ON `market_ranking_entries` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_market_delete`
AFTER DELETE ON `market_ranking_entries` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_netshop_insert`
AFTER INSERT ON `netshop_rows` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_netshop_update`
AFTER UPDATE ON `netshop_rows` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_effective_cache_netshop_delete`
AFTER DELETE ON `netshop_rows` BEGIN DELETE FROM `market_effective_metrics_cache_state` WHERE `id`=1; END;
