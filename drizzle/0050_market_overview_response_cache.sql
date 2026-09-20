CREATE TABLE IF NOT EXISTS `market_overview_response_cache` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `revision_key` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_overview_response_cache_updated_idx`
ON `market_overview_response_cache` (`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_image_cache_updated_idx`
ON `market_image_cache` (`updated_at`);
