CREATE TABLE IF NOT EXISTS `ai_knowledge_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL CHECK (`source_type` IN ('system_policy', 'business_metric', 'identity_mapping')),
  `source_ref` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `tags_json` text DEFAULT '[]' NOT NULL,
  `allowed_roles_json` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'disabled')),
  `version` integer DEFAULT 1 NOT NULL,
  `content_digest` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_knowledge_entries_status_type_idx`
  ON `ai_knowledge_entries` (`status`,`source_type`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `message_id` text NOT NULL,
  `owner_email` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('table')),
  `title` text NOT NULL,
  `file_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `source_tool` text NOT NULL,
  `columns_json` text DEFAULT '[]' NOT NULL,
  `rows_json` text DEFAULT '[]' NOT NULL,
  `row_count` integer DEFAULT 0 NOT NULL,
  `truncated` integer DEFAULT 0 NOT NULL,
  `content_digest` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_artifacts_conversation_message_idx`
  ON `ai_artifacts` (`conversation_id`,`message_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_artifacts_owner_created_idx`
  ON `ai_artifacts` (`owner_email`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_artifact_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `request_id` text NOT NULL,
  `actor_email` text NOT NULL,
  `actor_role` text NOT NULL,
  `surface` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('succeeded', 'failed')),
  `byte_size` integer,
  `content_digest` text,
  `error_code` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_artifact_deliveries_artifact_created_idx`
  ON `ai_artifact_deliveries` (`artifact_id`,`created_at`);
