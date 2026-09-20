CREATE TABLE IF NOT EXISTS `customer_service_import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_name` text DEFAULT '志高商用设备' NOT NULL,
  `session_file_name` text NOT NULL,
  `chat_file_name` text NOT NULL,
  `file_hash` text NOT NULL,
  `status` text NOT NULL,
  `conversation_count` integer DEFAULT 0 NOT NULL,
  `matched_count` integer DEFAULT 0 NOT NULL,
  `session_only_count` integer DEFAULT 0 NOT NULL,
  `chat_only_count` integer DEFAULT 0 NOT NULL,
  `ambiguous_count` integer DEFAULT 0 NOT NULL,
  `warnings_json` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `customer_service_import_batches_file_hash_uq` ON `customer_service_import_batches` (`file_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customer_service_conversations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_key` text NOT NULL,
  `first_import_batch_id` text NOT NULL,
  `last_import_batch_id` text NOT NULL,
  `shop_name` text DEFAULT '志高商用设备' NOT NULL,
  `consulted_at` text NOT NULL,
  `customer_id` text DEFAULT '' NOT NULL,
  `customer_alias` text DEFAULT '' NOT NULL,
  `consultation_type` text DEFAULT '' NOT NULL,
  `agent` text DEFAULT '' NOT NULL,
  `transferred_agent` text DEFAULT '' NOT NULL,
  `skill_group` text DEFAULT '' NOT NULL,
  `product_sku` text DEFAULT '' NOT NULL,
  `product_name` text DEFAULT '' NOT NULL,
  `first_response_at` text DEFAULT '' NOT NULL,
  `response_seconds` real,
  `duration_minutes` real,
  `customer_message_count` integer,
  `agent_message_count` integer,
  `satisfaction` text DEFAULT '' NOT NULL,
  `resolved` text DEFAULT '' NOT NULL,
  `conversation_id` text DEFAULT '' NOT NULL,
  `match_status` text NOT NULL,
  `match_confidence` text NOT NULL,
  `chat_started_at` text DEFAULT '' NOT NULL,
  `chat_ended_at` text DEFAULT '' NOT NULL,
  `chat_customer_alias` text DEFAULT '' NOT NULL,
  `messages_json` text DEFAULT '[]' NOT NULL,
  `robot_scope` text DEFAULT '' NOT NULL,
  `problem_type` text DEFAULT '' NOT NULL,
  `conversion_status` text DEFAULT '' NOT NULL,
  `service_issues` text DEFAULT '' NOT NULL,
  `summary_text` text DEFAULT '' NOT NULL,
  `analysis_source` text DEFAULT '' NOT NULL,
  `analyzed_at` text,
  `annotated_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `customer_service_conversations_key_uq` ON `customer_service_conversations` (`conversation_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `customer_service_conversations_consulted_idx` ON `customer_service_conversations` (`consulted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `customer_service_conversations_filter_idx` ON `customer_service_conversations` (`agent`,`match_status`,`consulted_at`);
