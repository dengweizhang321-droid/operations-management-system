ALTER TABLE `ai_models` ADD COLUMN `timeout_ms` integer DEFAULT 20000 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_models` ADD COLUMN `max_tokens` integer DEFAULT 1024 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_models` ADD COLUMN `temperature_milli` integer DEFAULT 200 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_models` ADD COLUMN `max_tool_rounds` integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_models` ADD COLUMN `max_total_tool_calls` integer DEFAULT 12 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_conversation_messages` ADD COLUMN `message_kind` text DEFAULT 'message' NOT NULL;
--> statement-breakpoint
CREATE INDEX `ai_conversation_messages_context_idx`
  ON `ai_conversation_messages` (`conversation_id`,`message_kind`,`created_at`);
