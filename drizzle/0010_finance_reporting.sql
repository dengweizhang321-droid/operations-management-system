CREATE TABLE `finance_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`parsed_month_count` integer DEFAULT 0 NOT NULL,
	`imported_month_count` integer DEFAULT 0 NOT NULL,
	`skipped_month_count` integer DEFAULT 0 NOT NULL,
	`subject_count` integer DEFAULT 0 NOT NULL,
	`months_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_import_batches_file_hash_uq` ON `finance_import_batches` (`file_hash`);--> statement-breakpoint
CREATE INDEX `finance_import_batches_created_idx` ON `finance_import_batches` (`created_at`);--> statement-breakpoint
CREATE TABLE `finance_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`section` text NOT NULL,
	`metric_key` text NOT NULL,
	`subject_name` text NOT NULL,
	`scope_key` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_name` text NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	`value_type` text NOT NULL,
	`amount_cents` integer,
	`rate_bps` integer,
	`raw_value` text DEFAULT '' NOT NULL,
	`source_row_count` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_total` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_lines_month_section_scope_subject_uq` ON `finance_lines` (`month`,`section`,`scope_key`,`subject_name`);--> statement-breakpoint
CREATE INDEX `finance_lines_month_section_scope_idx` ON `finance_lines` (`month`,`section`,`scope_type`,`scope_name`);--> statement-breakpoint
CREATE INDEX `finance_lines_metric_month_idx` ON `finance_lines` (`metric_key`,`month`);--> statement-breakpoint
CREATE INDEX `finance_lines_subject_month_idx` ON `finance_lines` (`subject_name`,`month`);--> statement-breakpoint
CREATE TABLE `finance_months` (
	`month` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`sheet_name` text NOT NULL,
	`business_name` text NOT NULL,
	`source_file_name` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`shop_count` integer DEFAULT 0 NOT NULL,
	`subject_count` integer DEFAULT 0 NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finance_months_status_month_idx` ON `finance_months` (`status`,`month`);--> statement-breakpoint
CREATE TABLE `finance_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`period_type` text NOT NULL,
	`period_key` text NOT NULL,
	`shop_name` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`manager` text DEFAULT '' NOT NULL,
	`sales_target_cents` integer DEFAULT 0 NOT NULL,
	`profit_target_cents` integer DEFAULT 0 NOT NULL,
	`small_margin_bps` integer DEFAULT 0 NOT NULL,
	`inventory_cleanup_target_cents` integer DEFAULT 0 NOT NULL,
	`promotion_fee_ratio_bps` integer DEFAULT 0 NOT NULL,
	`stagnant_inventory_target_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_targets_period_scope_uq` ON `finance_targets` (`period_type`,`period_key`,`shop_name`,`category`);--> statement-breakpoint
CREATE INDEX `finance_targets_period_idx` ON `finance_targets` (`period_type`,`period_key`);