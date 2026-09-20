CREATE TABLE IF NOT EXISTS `market_annotation_concurrency_settings` (
	`category` text NOT NULL,
	`executor` text NOT NULL CHECK (`executor` IN ('cloud','local')),
	`concurrency` integer NOT NULL CHECK (`concurrency` BETWEEN 1 AND 50),
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`category`,`executor`)
);

CREATE INDEX IF NOT EXISTS `market_annotation_concurrency_settings_updated_idx`
	ON `market_annotation_concurrency_settings` (`updated_at`);
