ALTER TABLE `market_annotation_jobs` ADD COLUMN `commit_token_hash` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `market_annotation_jobs` ADD COLUMN `commit_started_at` text;
--> statement-breakpoint
ALTER TABLE `market_annotation_commit_receipts` ADD COLUMN `batch_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `market_annotation_commit_receipts` ADD COLUMN `request_digest` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `market_annotation_commits_batch_idx` ON `market_annotation_commit_receipts` (`batch_id`);
--> statement-breakpoint
ALTER TABLE `market_annotation_validation_results` ADD COLUMN `sample_snapshot_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `market_annotation_validation_results` ADD COLUMN `claim_token_hash` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `market_annotation_validation_results` ADD COLUMN `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `market_annotation_validation_results` ADD COLUMN `attempt_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `market_annotation_validation_results` ADD COLUMN `updated_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `market_annotation_validation_result_lease_idx` ON `market_annotation_validation_results` (`run_id`,`status`,`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `market_annotation_prompt_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_annotation_prompt_audits_prompt_idx` ON `market_annotation_prompt_audits` (`prompt_id`,`created_at`);
