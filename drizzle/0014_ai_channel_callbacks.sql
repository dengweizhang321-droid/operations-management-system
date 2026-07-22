ALTER TABLE `ai_channels` ADD COLUMN `receiver_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `ai_channel_callback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`event_key` text NOT NULL,
	`payload_digest` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_channel_callback_events_channel_event_uq` ON `ai_channel_callback_events` (`channel_id`,`event_key`);
--> statement-breakpoint
CREATE INDEX `ai_channel_callback_events_received_idx` ON `ai_channel_callback_events` (`channel_id`,`received_at`);
