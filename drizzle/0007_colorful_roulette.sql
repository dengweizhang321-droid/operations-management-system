CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_order_lines_ship_time_idx` ON `sales_order_lines` (`ship_time`);--> statement-breakpoint
CREATE INDEX `sales_order_lines_ship_time_inventory_demand_idx` ON `sales_order_lines` (`ship_time`,`product_code`,`warehouse`);