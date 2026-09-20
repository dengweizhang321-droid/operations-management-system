CREATE TABLE IF NOT EXISTS `market_master_identities` (
  `category` text NOT NULL,
  `scope` text NOT NULL,
  `ranking_dimension` text NOT NULL,
  `sku_code` text NOT NULL,
  `latest_entry_id` integer NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`category`,`scope`,`ranking_dimension`,`sku_code`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `market_master_identities_entry_uq`
ON `market_master_identities` (`latest_entry_id`);
INSERT OR REPLACE INTO `market_master_identities`
  (`category`,`scope`,`ranking_dimension`,`sku_code`,`latest_entry_id`,`updated_at`)
SELECT `category`,`scope`,`ranking_dimension`,`sku_code`,`id`,CURRENT_TIMESTAMP
FROM (
  SELECT `id`,`category`,`scope`,`ranking_dimension`,`sku_code`,
    ROW_NUMBER() OVER (
      PARTITION BY `category`,`scope`,`ranking_dimension`,`sku_code`
      ORDER BY `period_end` DESC,`period_start` DESC,`id` DESC
    ) `identity_rank`
  FROM `market_ranking_entries`
) WHERE `identity_rank`=1;
