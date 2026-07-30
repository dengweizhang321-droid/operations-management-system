CREATE TABLE IF NOT EXISTS `netshop_schema_migrations` (
  `migration_key` text PRIMARY KEY NOT NULL,
  `completed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint

DROP TRIGGER IF EXISTS `market_monthly_summary_netshop_update`;--> statement-breakpoint
CREATE TRIGGER `market_monthly_summary_netshop_update`
AFTER UPDATE OF `sku_id`,`spu_id`,`product_code` ON `netshop_rows`
WHEN OLD.`sku_id` IS NOT NEW.`sku_id`
  OR OLD.`spu_id` IS NOT NEW.`spu_id`
  OR OLD.`product_code` IS NOT NEW.`product_code` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1)
  FROM json_each(json_array(OLD.`sku_id`,OLD.`spu_id`,OLD.`product_code`,NEW.`sku_id`,NEW.`spu_id`,NEW.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;--> statement-breakpoint

DROP TRIGGER IF EXISTS `market_monthly_summary_sales_update`;--> statement-breakpoint
CREATE TRIGGER `market_monthly_summary_sales_update`
AFTER UPDATE OF `product_code` ON `sales_order_lines`
WHEN OLD.`product_code` IS NOT NEW.`product_code` BEGIN
  UPDATE `market_monthly_summary_cache_state` SET `source_revision`=`source_revision`+1,`status`='stale' WHERE `id`=1;
  INSERT INTO `market_monthly_summary_dirty_products` (`product_code`,`dirty_revision`)
  SELECT value,(SELECT `source_revision` FROM `market_monthly_summary_cache_state` WHERE `id`=1)
  FROM json_each(json_array(OLD.`product_code`,NEW.`product_code`)) WHERE value<>''
  ON CONFLICT(`product_code`) DO UPDATE SET `dirty_revision`=MAX(`dirty_revision`,excluded.`dirty_revision`);
END;
