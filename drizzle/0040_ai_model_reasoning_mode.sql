ALTER TABLE `ai_models` ADD COLUMN `reasoning_mode` text DEFAULT 'auto' NOT NULL CHECK (`reasoning_mode` IN ('auto', 'disabled'));
