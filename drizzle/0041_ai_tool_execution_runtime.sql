ALTER TABLE `ai_tool_audit_logs` ADD COLUMN `invocation_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_tool_audit_logs` ADD COLUMN `provider_call_id` text;
--> statement-breakpoint
CREATE INDEX `ai_tool_audit_logs_invocation_created_idx`
  ON `ai_tool_audit_logs` (`invocation_id`,`created_at`);
