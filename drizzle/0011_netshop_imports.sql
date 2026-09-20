CREATE TABLE `netshop_import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `dataset` text DEFAULT '' NOT NULL,
  `platform` text DEFAULT '' NOT NULL,
  `shop_name` text DEFAULT '' NOT NULL,
  `file_name` text NOT NULL,
  `file_size_bytes` integer NOT NULL,
  `file_hash` text NOT NULL,
  `sheet_name` text DEFAULT '' NOT NULL,
  `status` text NOT NULL,
  `row_count` integer DEFAULT 0 NOT NULL,
  `inserted_count` integer DEFAULT 0 NOT NULL,
  `duplicate_count` integer DEFAULT 0 NOT NULL,
  `warning_count` integer DEFAULT 0 NOT NULL,
  `date_min` text,
  `date_max` text,
  `snapshot_date` text,
  `warnings_json` text DEFAULT '[]' NOT NULL,
  `totals_json` text DEFAULT '{}' NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  UNIQUE(`source`, `file_hash`)
);
--> statement-breakpoint
CREATE INDEX `netshop_import_batches_source_created_idx` ON `netshop_import_batches` (`source`,`created_at`);--> statement-breakpoint
CREATE INDEX `netshop_import_batches_shop_dataset_idx` ON `netshop_import_batches` (`shop_name`,`dataset`,`completed_at`);--> statement-breakpoint
CREATE TABLE `netshop_rows` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_row_key` text NOT NULL,
  `source_row_hash` text NOT NULL,
  `first_import_batch_id` text NOT NULL,
  `last_import_batch_id` text NOT NULL,
  `source_row_number` integer NOT NULL,
  `source` text NOT NULL,
  `dataset` text NOT NULL,
  `platform` text DEFAULT '' NOT NULL,
  `shop_name` text DEFAULT '' NOT NULL,
  `business_date` text,
  `snapshot_date` text,
  `product_code` text DEFAULT '' NOT NULL,
  `product_name` text DEFAULT '' NOT NULL,
  `sku_id` text DEFAULT '' NOT NULL,
  `spu_id` text DEFAULT '' NOT NULL,
  `warehouse_type` text DEFAULT '' NOT NULL,
  `metrics_json` text DEFAULT '{}' NOT NULL,
  `raw_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `netshop_rows_source_row_key_uq` ON `netshop_rows` (`source_row_key`);--> statement-breakpoint
CREATE INDEX `netshop_rows_shop_dataset_date_idx` ON `netshop_rows` (`shop_name`,`dataset`,`business_date`);--> statement-breakpoint
CREATE INDEX `netshop_rows_source_date_idx` ON `netshop_rows` (`source`,`business_date`);--> statement-breakpoint
CREATE INDEX `netshop_rows_snapshot_idx` ON `netshop_rows` (`source`,`snapshot_date`,`warehouse_type`);
