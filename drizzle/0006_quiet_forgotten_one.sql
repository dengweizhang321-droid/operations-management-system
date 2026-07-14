CREATE TABLE `inventory_age_metrics` (
	`batch_id` text NOT NULL,
	`row_key` text NOT NULL,
	`sales_7d_quantity` integer DEFAULT 0 NOT NULL,
	`sales_30d_quantity` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_age_metrics_batch_row_uq` ON `inventory_age_metrics` (`batch_id`,`row_key`);--> statement-breakpoint
CREATE INDEX `inventory_age_metrics_batch_idx` ON `inventory_age_metrics` (`batch_id`);