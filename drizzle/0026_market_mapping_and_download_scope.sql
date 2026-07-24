ALTER TABLE market_ranking_entries ADD COLUMN source_brand TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN source_operation_mode TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN source_subcategory TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE market_ranking_entries
SET source_brand = brand,
    source_operation_mode = operation_mode,
    source_subcategory = subcategory
WHERE source_brand = '' AND source_operation_mode = '' AND source_subcategory = '';
--> statement-breakpoint
ALTER TABLE market_download_configs ADD COLUMN scope TEXT NOT NULL DEFAULT '全部';
--> statement-breakpoint
ALTER TABLE market_download_tasks ADD COLUMN scope TEXT NOT NULL DEFAULT '全部';
--> statement-breakpoint
DROP INDEX IF EXISTS market_download_configs_unique_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX market_download_configs_unique_uq
ON market_download_configs (category, scope, ranking_dimension, month_start, month_end);
--> statement-breakpoint
DROP INDEX IF EXISTS market_download_tasks_unique_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX market_download_tasks_unique_uq
ON market_download_tasks (category, scope, month, ranking_dimension);
