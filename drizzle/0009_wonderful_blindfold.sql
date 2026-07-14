CREATE TABLE `erp_combo_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_code` text NOT NULL,
	`parent_name` text DEFAULT '' NOT NULL,
	`child_code` text NOT NULL,
	`child_name` text DEFAULT '' NOT NULL,
	`child_quantity_milli` integer NOT NULL,
	`source_row_number` integer NOT NULL,
	`last_import_batch_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `erp_combo_items_parent_child_uq` ON `erp_combo_items` (`parent_code`,`child_code`);--> statement-breakpoint
CREATE INDEX `erp_combo_items_parent_idx` ON `erp_combo_items` (`parent_code`);--> statement-breakpoint
CREATE INDEX `erp_combo_items_child_idx` ON `erp_combo_items` (`child_code`);--> statement-breakpoint
CREATE TABLE `erp_inventory_age_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`warehouse` text NOT NULL,
	`warehouse_type` text NOT NULL,
	`product_code` text NOT NULL,
	`product_name` text DEFAULT '' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`available_quantity` integer DEFAULT 0 NOT NULL,
	`inventory_age_days` integer,
	`sales_7d_quantity` integer,
	`sales_30d_quantity` integer,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`stock_value_cents` integer DEFAULT 0 NOT NULL,
	`source_row_number` integer NOT NULL,
	`last_import_batch_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `erp_inventory_age_snapshot_warehouse_product_uq` ON `erp_inventory_age_lines` (`snapshot_date`,`warehouse`,`product_code`);--> statement-breakpoint
CREATE INDEX `erp_inventory_age_snapshot_idx` ON `erp_inventory_age_lines` (`snapshot_date`);--> statement-breakpoint
CREATE INDEX `erp_inventory_age_product_idx` ON `erp_inventory_age_lines` (`product_code`);--> statement-breakpoint
CREATE TABLE `erp_product_master` (
	`product_code` text PRIMARY KEY NOT NULL,
	`product_name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`barcode` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`product_status` text DEFAULT '' NOT NULL,
	`source_row_number` integer NOT NULL,
	`last_import_batch_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `erp_product_master_name_idx` ON `erp_product_master` (`product_name`);--> statement-breakpoint
CREATE INDEX `erp_product_master_barcode_idx` ON `erp_product_master` (`barcode`);--> statement-breakpoint
CREATE TABLE `erp_reference_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`source_label` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_hash` text NOT NULL,
	`sheet_name` text NOT NULL,
	`snapshot_date` text,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`excluded_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`totals_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `erp_reference_import_batches_source_hash_uq` ON `erp_reference_import_batches` (`source_key`,`file_hash`);--> statement-breakpoint
CREATE INDEX `erp_reference_import_batches_source_created_idx` ON `erp_reference_import_batches` (`source_key`,`created_at`);