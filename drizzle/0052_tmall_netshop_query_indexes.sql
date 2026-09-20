CREATE INDEX IF NOT EXISTS `netshop_rows_scope_date_product_idx`
  ON `netshop_rows` (`dataset`,`platform`,`shop_name`,`business_date`,`spu_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `netshop_rows_master_snapshot_idx`
  ON `netshop_rows` (`source`,`platform`,`shop_name`,`snapshot_date`);
