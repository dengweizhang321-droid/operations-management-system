CREATE TABLE `ai_tool_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_role` text NOT NULL,
	`surface` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`row_count` integer,
	`duration_ms` integer,
	`response_digest` text,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_tool_audit_logs_actor_created_idx` ON `ai_tool_audit_logs` (`actor_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_tool_audit_logs_tool_created_idx` ON `ai_tool_audit_logs` (`tool_name`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`scope_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_users_role_status_idx` ON `app_users` (`role`,`status`);
--> statement-breakpoint
INSERT INTO `app_users` (`email`, `display_name`, `role`, `status`, `scope_json`)
VALUES ('dengweizhang321@gmail.com', '系统管理员', 'admin', 'active', NULL)
ON CONFLICT(`email`) DO NOTHING;
