CREATE TABLE IF NOT EXISTS `market_monthly_summary_cache` (
  `category` text NOT NULL,
  `scope` text NOT NULL,
  `ranking_dimension` text NOT NULL,
  `sku_code` text NOT NULL,
  `month` text NOT NULL,
  `representative_entry_id` integer NOT NULL,
  `coverage_period_start` text NOT NULL,
  `coverage_period_end` text NOT NULL,
  `operation_mode` text NOT NULL,
  `subcategory` text NOT NULL,
  `rank` integer,
  `product_name` text NOT NULL,
  `brand` text NOT NULL,
  `gmv_cents` integer,
  `quantity` integer,
  `page_views` integer NOT NULL,
  `visitors` integer NOT NULL,
  `conversion_bps` integer,
  `official_market_price_cents` integer,
  `confirmation_status` text,
  `market_price_source` text NOT NULL,
  `display_price_band` text NOT NULL,
  `confirmed_price_band` text NOT NULL,
  `is_own` integer NOT NULL,
  `refreshed_revision` integer NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_monthly_summary_cache_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `source_revision` integer NOT NULL DEFAULT 1,
  `built_revision` integer NOT NULL DEFAULT -1,
  `status` text NOT NULL DEFAULT 'stale',
  `lease_token` text NOT NULL DEFAULT '',
  `lease_expires_at` text,
  `row_count` integer NOT NULL DEFAULT 0,
  `refreshed_at` text,
  `error_code` text NOT NULL DEFAULT ''
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_monthly_summary_dirty_keys` (
  `category` text NOT NULL,
  `scope` text NOT NULL,
  `ranking_dimension` text NOT NULL,
  `sku_code` text NOT NULL,
  `month` text NOT NULL,
  `dirty_revision` integer NOT NULL,
  PRIMARY KEY (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_monthly_summary_dirty_scopes` (
  `category` text PRIMARY KEY NOT NULL,
  `dirty_revision` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_monthly_summary_dirty_products` (
  `product_code` text PRIMARY KEY NOT NULL,
  `dirty_revision` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_monthly_summary_month_idx` ON `market_monthly_summary_cache` (`month`,`category`,`ranking_dimension`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_monthly_summary_brand_idx` ON `market_monthly_summary_cache` (`brand`,`month`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_monthly_summary_subcategory_idx` ON `market_monthly_summary_cache` (`subcategory`,`month`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_monthly_summary_display_band_idx` ON `market_monthly_summary_cache` (`display_price_band`,`month`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_monthly_summary_confirmed_band_idx` ON `market_monthly_summary_cache` (`confirmed_price_band`,`month`);--> statement-breakpoint
INSERT OR IGNORE INTO `market_monthly_summary_cache_state` (`id`,`source_revision`,`built_revision`,`status`) VALUES (1,1,-1,'stale');--> statement-breakpoint
INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`) VALUES ('*',1)
ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_market_insert`
AFTER INSERT ON `market_ranking_entries` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (NEW.`category`,NEW.`scope`,NEW.`ranking_dimension`,NEW.`sku_code`,substr(NEW.`period_end`,1,7),(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_market_update`
AFTER UPDATE ON `market_ranking_entries` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (OLD.`category`,OLD.`scope`,OLD.`ranking_dimension`,OLD.`sku_code`,substr(OLD.`period_end`,1,7),(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (NEW.`category`,NEW.`scope`,NEW.`ranking_dimension`,NEW.`sku_code`,substr(NEW.`period_end`,1,7),(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_market_delete`
AFTER DELETE ON `market_ranking_entries` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (OLD.`category`,OLD.`scope`,OLD.`ranking_dimension`,OLD.`sku_code`,substr(OLD.`period_end`,1,7),(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_price_insert`
AFTER INSERT ON `market_price_snapshots` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (NEW.`category`,NEW.`scope`,NEW.`ranking_dimension`,NEW.`sku_code`,NEW.`month`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_price_update`
AFTER UPDATE ON `market_price_snapshots` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (OLD.`category`,OLD.`scope`,OLD.`ranking_dimension`,OLD.`sku_code`,OLD.`month`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (NEW.`category`,NEW.`scope`,NEW.`ranking_dimension`,NEW.`sku_code`,NEW.`month`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_price_delete`
AFTER DELETE ON `market_price_snapshots` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_keys` (`category`,`scope`,`ranking_dimension`,`sku_code`,`month`,`dirty_revision`)
  VALUES (OLD.`category`,OLD.`scope`,OLD.`ranking_dimension`,OLD.`sku_code`,OLD.`month`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`,`scope`,`ranking_dimension`,`sku_code`,`month`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_version_insert`
AFTER INSERT ON `market_price_band_versions` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`)
  VALUES (NEW.`category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_version_update`
AFTER UPDATE ON `market_price_band_versions` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`) VALUES (OLD.`category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`) VALUES (NEW.`category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_version_delete`
BEFORE DELETE ON `market_price_band_versions` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`) VALUES (OLD.`category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_item_insert`
AFTER INSERT ON `market_price_band_items` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`)
  SELECT `category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM `market_price_band_versions` WHERE `id`=NEW.`version_id`
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_item_update`
AFTER UPDATE ON `market_price_band_items` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`)
  SELECT `category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM `market_price_band_versions` WHERE `id` IN (OLD.`version_id`,NEW.`version_id`)
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_band_item_delete`
BEFORE DELETE ON `market_price_band_items` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_scopes` (`category`,`dirty_revision`)
  SELECT `category`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM `market_price_band_versions` WHERE `id`=OLD.`version_id`
  ON CONFLICT(`category`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_netshop_insert`
AFTER INSERT ON `netshop_rows` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM json_each(json_array(NEW.`sku_id`,NEW.`spu_id`,NEW.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_netshop_update`
AFTER UPDATE ON `netshop_rows` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM json_each(json_array(OLD.`sku_id`,OLD.`spu_id`,OLD.`product_code`,NEW.`sku_id`,NEW.`spu_id`,NEW.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_netshop_delete`
AFTER DELETE ON `netshop_rows` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM json_each(json_array(OLD.`sku_id`,OLD.`spu_id`,OLD.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_sales_insert`
AFTER INSERT ON `sales_order_lines` WHEN NEW.`product_code`<>'' BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`) VALUES (NEW.`product_code`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_sales_update`
AFTER UPDATE ON `sales_order_lines` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1) FROM json_each(json_array(OLD.`product_code`,NEW.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `market_monthly_summary_sales_delete`
AFTER DELETE ON `sales_order_lines` WHEN OLD.`product_code`<>'' BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`) VALUES (OLD.`product_code`,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1))
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;
