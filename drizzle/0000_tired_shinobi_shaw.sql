CREATE TABLE `sales_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`sheet_name` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`totals_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_import_batches_file_hash_uq` ON `sales_import_batches` (`file_hash`);--> statement-breakpoint
CREATE INDEX `sales_import_batches_created_at_idx` ON `sales_import_batches` (`created_at`);--> statement-breakpoint
CREATE TABLE `sales_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_line_key` text NOT NULL,
	`source_row_hash` text NOT NULL,
	`first_import_batch_id` text NOT NULL,
	`last_import_batch_id` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`order_no` text NOT NULL,
	`online_order_no` text NOT NULL,
	`channel` text NOT NULL,
	`platform` text NOT NULL,
	`shop_name` text NOT NULL,
	`logistics_company` text NOT NULL,
	`warehouse` text NOT NULL,
	`product_code` text NOT NULL,
	`product_name` text NOT NULL,
	`specification` text NOT NULL,
	`barcode` text NOT NULL,
	`supplier` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer NOT NULL,
	`list_unit_price_cents` integer NOT NULL,
	`cost_amount_cents` integer NOT NULL,
	`allocated_unit_price_cents` integer NOT NULL,
	`allocated_amount_cents` integer NOT NULL,
	`fee_allocation_cents` integer NOT NULL,
	`gross_profit_cents` integer NOT NULL,
	`gross_margin_bps` integer NOT NULL,
	`untaxed_gross_profit_cents` integer NOT NULL,
	`untaxed_gross_margin_bps` integer NOT NULL,
	`order_time` text NOT NULL,
	`sales_time` text NOT NULL,
	`ship_time` text NOT NULL,
	`line_ship_time` text NOT NULL,
	`business_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_order_lines_source_line_key_uq` ON `sales_order_lines` (`source_line_key`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_sales_time_idx` ON `sales_order_lines` (`sales_time`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_channel_idx` ON `sales_order_lines` (`channel`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_platform_idx` ON `sales_order_lines` (`platform`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_last_batch_idx` ON `sales_order_lines` (`last_import_batch_id`);