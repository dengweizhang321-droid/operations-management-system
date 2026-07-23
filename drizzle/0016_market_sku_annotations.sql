CREATE TABLE `market_annotation_prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`version` integer NOT NULL,
	`parent_id` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`segments_json` text NOT NULL,
	`prompt_body` text NOT NULL,
	`change_note` text DEFAULT '' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`activated_by` text,
	`activated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_prompts_category_version_uq` ON `market_annotation_prompt_versions` (`category`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_prompts_active_uq` ON `market_annotation_prompt_versions` (`category`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE TABLE `market_annotation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`prompt_version_id` text NOT NULL,
	`executor` text NOT NULL,
	`model_id` text,
	`local_model_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`reviewed_count` integer DEFAULT 0 NOT NULL,
	`committed_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_annotation_jobs_category_created_idx` ON `market_annotation_jobs` (`category`,`created_at`);
--> statement-breakpoint
CREATE TABLE `market_annotation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sku_code` text NOT NULL,
	`product_name` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`source_image_url` text DEFAULT '' NOT NULL,
	`resolved_image_url` text DEFAULT '' NOT NULL,
	`image_source` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`ai_segment` text DEFAULT '' NOT NULL,
	`ai_image_price_cents` integer,
	`ai_confidence_bps` integer,
	`ai_reason` text DEFAULT '' NOT NULL,
	`ai_raw_digest` text DEFAULT '' NOT NULL,
	`reviewed_segment` text DEFAULT '' NOT NULL,
	`reviewed_image_price_cents` integer,
	`selected` integer DEFAULT 0 NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`lease_token_hash` text DEFAULT '' NOT NULL,
	`lease_agent_id` text DEFAULT '' NOT NULL,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_items_job_sku_uq` ON `market_annotation_items` (`job_id`,`sku_code`);
--> statement-breakpoint
CREATE INDEX `market_annotation_items_job_status_idx` ON `market_annotation_items` (`job_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `market_annotation_items_lease_idx` ON `market_annotation_items` (`lease_expires_at`,`status`);
--> statement-breakpoint
CREATE TABLE `market_sku_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`sku_code` text NOT NULL,
	`segment` text NOT NULL,
	`image_price_cents` integer,
	`image_url` text DEFAULT '' NOT NULL,
	`image_source` text DEFAULT 'none' NOT NULL,
	`confidence_bps` integer,
	`source_job_item_id` text NOT NULL,
	`prompt_version_id` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_sku_annotations_category_sku_uq` ON `market_sku_annotations` (`category`,`sku_code`);
--> statement-breakpoint
CREATE INDEX `market_sku_annotations_segment_idx` ON `market_sku_annotations` (`category`,`segment`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `market_annotation_commit_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_item_id` text NOT NULL,
	`annotation_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text NOT NULL,
	`committed_by` text NOT NULL,
	`committed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_commits_item_uq` ON `market_annotation_commit_receipts` (`job_item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_commits_idempotency_uq` ON `market_annotation_commit_receipts` (`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `market_annotation_validation_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`sku_code` text NOT NULL,
	`product_name` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`gold_segment` text NOT NULL,
	`gold_image_price_cents` integer,
	`source_annotation_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_samples_category_sku_uq` ON `market_annotation_validation_samples` (`category`,`sku_code`);
--> statement-breakpoint
CREATE TABLE `market_annotation_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`baseline_prompt_id` text,
	`candidate_prompt_id` text NOT NULL,
	`model_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`seed` text NOT NULL,
	`requested_sample_count` integer DEFAULT 50 NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`sample_hash` text DEFAULT '' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`gate_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `market_annotation_validation_runs_prompt_idx` ON `market_annotation_validation_runs` (`candidate_prompt_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `market_annotation_validation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sample_id` text NOT NULL,
	`prompt_version_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`predicted_segment` text DEFAULT '' NOT NULL,
	`predicted_image_price_cents` integer,
	`confidence_bps` integer,
	`is_correct` integer DEFAULT 0 NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_validation_result_uq` ON `market_annotation_validation_results` (`run_id`,`sample_id`,`prompt_version_id`);
--> statement-breakpoint
CREATE TABLE `market_annotation_local_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_annotation_agents_token_uq` ON `market_annotation_local_agents` (`token_hash`);
