ALTER TABLE `market_annotation_jobs` ADD COLUMN `work_key` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `market_annotation_jobs` ADD COLUMN `reuse_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `market_annotation_jobs` ADD COLUMN `reuse_started_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `market_annotation_jobs_active_work_uq`
  ON `market_annotation_jobs` (`work_key`)
  WHERE `work_key`<>'' AND `status` IN ('queued','running','failed','review_ready','committing');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_annotation_items_job_inference_unit_idx`
  ON `market_annotation_items` (`job_id`,`category`,`scope`,`sku_code`,`ranking_dimension`,`image_content_sha256`,`status`,`id`);
--> statement-breakpoint
PRAGMA optimize;
