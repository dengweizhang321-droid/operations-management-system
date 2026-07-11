CREATE TABLE `inventory_import_upload_results` (
	`upload_id` text PRIMARY KEY NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replenishment_plan_items_draft_key_uq` ON `replenishment_plan_items` (`source_batch_id`,`product_code`,`warehouse`) WHERE "replenishment_plan_items"."status" = 'draft';