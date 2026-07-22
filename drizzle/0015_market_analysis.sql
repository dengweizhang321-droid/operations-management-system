CREATE TABLE `market_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`sheet_name` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`period_start` text,
	`period_end` text,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_import_batches_file_hash_uq` ON `market_import_batches` (`file_hash`);
--> statement-breakpoint
CREATE INDEX `market_import_batches_created_idx` ON `market_import_batches` (`created_at`);
--> statement-breakpoint
CREATE TABLE `market_ranking_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`natural_key` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '全部' NOT NULL,
	`rank` integer,
	`sku_code` text NOT NULL,
	`product_name` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`price_cents` integer,
	`gmv_cents` integer DEFAULT 0 NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	`conversion_bps` integer,
	`cart_customers` integer DEFAULT 0 NOT NULL,
	`search_clicks` integer DEFAULT 0 NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`product_url` text DEFAULT '' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`last_import_batch_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_ranking_entries_natural_key_uq` ON `market_ranking_entries` (`natural_key`);
--> statement-breakpoint
CREATE INDEX `market_entries_period_idx` ON `market_ranking_entries` (`period_end`,`period_start`);
--> statement-breakpoint
CREATE INDEX `market_entries_category_idx` ON `market_ranking_entries` (`category`,`period_end`);
--> statement-breakpoint
CREATE INDEX `market_entries_sku_idx` ON `market_ranking_entries` (`sku_code`,`period_end`);
--> statement-breakpoint
CREATE INDEX `market_entries_brand_idx` ON `market_ranking_entries` (`brand`,`period_end`);
