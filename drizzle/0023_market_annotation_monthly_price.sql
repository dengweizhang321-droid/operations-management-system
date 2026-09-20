ALTER TABLE `market_annotation_items` ADD COLUMN `category` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `ranking_dimension` text DEFAULT 'SKU' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `month` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `image_content_sha256` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `ai_price_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `ai_price_low_cents` integer;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `ai_price_high_cents` integer;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `reviewed_price_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `reviewed_price_low_cents` integer;
--> statement-breakpoint
ALTER TABLE `market_annotation_items` ADD COLUMN `reviewed_price_high_cents` integer;
--> statement-breakpoint
DROP INDEX IF EXISTS `market_annotation_items_job_sku_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_items_job_snapshot_uq` ON `market_annotation_items` (`job_id`,`category`,`sku_code`,`ranking_dimension`,`month`,`image_content_sha256`);
