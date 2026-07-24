CREATE TABLE `market_image_cache` (
	`source_url` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`object_key` text DEFAULT '' NOT NULL,
	`content_sha256` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT '' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`image_source` text DEFAULT '' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_image_cache_object_key_idx` ON `market_image_cache` (`object_key`);
--> statement-breakpoint
CREATE INDEX `market_image_cache_status_idx` ON `market_image_cache` (`status`,`updated_at`);
