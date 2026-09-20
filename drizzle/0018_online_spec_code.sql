ALTER TABLE `sales_order_lines` ADD COLUMN `online_spec_code` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `sales_order_lines_online_spec_code_idx` ON `sales_order_lines` (`online_spec_code`);
