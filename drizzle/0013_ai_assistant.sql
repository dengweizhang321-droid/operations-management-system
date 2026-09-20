CREATE TABLE `ai_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`protocol` text NOT NULL,
	`model_type` text NOT NULL,
	`model_name` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`api_key_encrypted` text DEFAULT '' NOT NULL,
	`api_key_suffix` text DEFAULT '' NOT NULL,
	`is_default_text_model` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`last_test_result` text,
	`last_tested_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_default_text_uq` ON `ai_models` (`is_default_text_model`) WHERE `is_default_text_model` = 1 AND `status` = 'enabled' AND `model_type` = 'text';
--> statement-breakpoint
CREATE INDEX `ai_models_status_idx` ON `ai_models` (`status`,`model_type`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ai_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`send_enabled` integer DEFAULT 0 NOT NULL,
	`callback_enabled` integer DEFAULT 0 NOT NULL,
	`webhook_url` text DEFAULT '' NOT NULL,
	`callback_token_encrypted` text DEFAULT '' NOT NULL,
	`callback_token_suffix` text DEFAULT '' NOT NULL,
	`aes_key_encrypted` text DEFAULT '' NOT NULL,
	`aes_key_suffix` text DEFAULT '' NOT NULL,
	`last_test_result` text,
	`last_tested_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_channels_status_idx` ON `ai_channels` (`status`,`kind`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`model_id` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_creator_updated_idx` ON `ai_conversations` (`created_by`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ai_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_conversation_messages_conversation_idx` ON `ai_conversation_messages` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `ai_system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
