CREATE TABLE IF NOT EXISTS `market_sku_gmv_totals` (
  `sku_code` text PRIMARY KEY NOT NULL,
  `gmv_total_cents` integer DEFAULT 0 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
