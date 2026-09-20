CREATE TABLE IF NOT EXISTS `market_subcategory_taxonomy` (
  `id` text PRIMARY KEY NOT NULL,
  `category` text NOT NULL,
  `subcategory` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `updated_by` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `market_subcategory_taxonomy_category_name_uq`
ON `market_subcategory_taxonomy` (`category`,`subcategory`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_subcategory_taxonomy_lookup_idx`
ON `market_subcategory_taxonomy` (`category`,`status`,`sort_order`);
