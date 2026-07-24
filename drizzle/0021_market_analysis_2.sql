ALTER TABLE `market_ranking_entries` ADD COLUMN `ranking_dimension` text DEFAULT 'SKU' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_ranking_entries` ADD COLUMN `operation_mode` text DEFAULT '未知' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_ranking_entries` ADD COLUMN `subcategory` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `market_ranking_entries` ADD COLUMN `price_low_cents` integer;--> statement-breakpoint
ALTER TABLE `market_ranking_entries` ADD COLUMN `price_high_cents` integer;--> statement-breakpoint
ALTER TABLE `market_ranking_entries` ADD COLUMN `price_estimated` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `market_entries_dimension_idx` ON `market_ranking_entries` (`ranking_dimension`,`operation_mode`,`period_end`);--> statement-breakpoint
CREATE INDEX `market_entries_subcategory_idx` ON `market_ranking_entries` (`subcategory`,`period_end`);--> statement-breakpoint
CREATE TABLE `market_price_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL,
  `sku_code` text NOT NULL,
  `ranking_dimension` text DEFAULT 'SKU' NOT NULL,
  `month` text NOT NULL,
  `source_price_cents` integer,
  `ai_image_price_cents` integer,
  `ai_price_type` text DEFAULT '' NOT NULL,
  `ai_confidence_bps` integer,
  `ai_reason` text DEFAULT '' NOT NULL,
  `confirmed_market_price_cents` integer,
  `average_transaction_price_cents` integer,
  `price_low_cents` integer,
  `price_high_cents` integer,
  `image_content_sha256` text DEFAULT '' NOT NULL,
  `image_url` text DEFAULT '' NOT NULL,
  `confirmation_status` text DEFAULT 'source_table' NOT NULL,
  `confirmed_by` text DEFAULT '' NOT NULL,
  `confirmed_at` text,
  `source_job_item_id` text DEFAULT '' NOT NULL,
  `prompt_version_id` text DEFAULT '' NOT NULL,
  `source_import_batch_id` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `market_price_snapshots_sku_month_uq` ON `market_price_snapshots` (`category`,`sku_code`,`ranking_dimension`,`month`);--> statement-breakpoint
CREATE INDEX `market_price_snapshots_status_idx` ON `market_price_snapshots` (`confirmation_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `market_price_snapshots_hash_idx` ON `market_price_snapshots` (`sku_code`,`image_content_sha256`,`confirmed_at`);
