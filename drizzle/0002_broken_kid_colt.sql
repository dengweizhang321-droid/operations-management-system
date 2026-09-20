CREATE TABLE `inventory_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`sheet_name` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`totals_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_import_batches_file_hash_uq` ON `inventory_import_batches` (`file_hash`);--> statement-breakpoint
CREATE INDEX `inventory_import_batches_completed_at_idx` ON `inventory_import_batches` (`completed_at`);--> statement-breakpoint
CREATE TABLE `inventory_stock_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`row_key` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`snapshot_date` text NOT NULL,
	`warehouse` text NOT NULL,
	`warehouse_type` text NOT NULL,
	`product_code` text NOT NULL,
	`product_name` text NOT NULL,
	`specification` text NOT NULL,
	`barcode` text NOT NULL,
	`category` text NOT NULL,
	`on_hand_quantity` integer NOT NULL,
	`available_quantity` integer NOT NULL,
	`locked_quantity` integer NOT NULL,
	`in_transit_quantity` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`inventory_age_days` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_stock_lines_batch_row_uq` ON `inventory_stock_lines` (`batch_id`,`row_key`);--> statement-breakpoint
CREATE INDEX `inventory_stock_lines_batch_idx` ON `inventory_stock_lines` (`batch_id`);--> statement-breakpoint
CREATE INDEX `inventory_stock_lines_product_idx` ON `inventory_stock_lines` (`product_code`);--> statement-breakpoint
CREATE INDEX `inventory_stock_lines_warehouse_idx` ON `inventory_stock_lines` (`warehouse`);--> statement-breakpoint
CREATE TABLE `replenishment_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_batch_id` text NOT NULL,
	`product_code` text NOT NULL,
	`product_name` text NOT NULL,
	`warehouse` text NOT NULL,
	`suggested_quantity` integer NOT NULL,
	`planned_quantity` integer NOT NULL,
	`coverage_days_tenths` integer,
	`reason` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `replenishment_plan_items_status_idx` ON `replenishment_plan_items` (`status`);--> statement-breakpoint
CREATE INDEX `replenishment_plan_items_product_idx` ON `replenishment_plan_items` (`product_code`);--> statement-breakpoint
CREATE INDEX `replenishment_plan_items_source_batch_idx` ON `replenishment_plan_items` (`source_batch_id`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_inventory_demand_idx` ON `sales_order_lines` (`sales_time`,`product_code`,`warehouse`);