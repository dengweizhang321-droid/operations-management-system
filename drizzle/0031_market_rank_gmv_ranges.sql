ALTER TABLE market_ranking_entries ADD COLUMN price_band_filter TEXT NOT NULL DEFAULT '全部';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN price_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN gmv_low_cents INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN gmv_high_cents INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN gmv_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN quantity_low INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN quantity_high INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN quantity_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN page_views_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN visitors_low INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN visitors_high INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN visitors_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN conversion_low_bps INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN conversion_high_bps INTEGER;
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN conversion_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN cart_customers_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE market_ranking_entries ADD COLUMN search_clicks_raw TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE market_ranking_entries SET
  price_raw = COALESCE(json_extract(raw_json, '$."价格"'), json_extract(raw_json, '$."成交客单价"'), ''),
  gmv_raw = COALESCE(json_extract(raw_json, '$."成交金额"'), json_extract(raw_json, '$."交易金额"'), json_extract(raw_json, '$."GMV"'), json_extract(raw_json, '$."销售额"'), ''),
  quantity_raw = COALESCE(json_extract(raw_json, '$."成交商品件数"'), json_extract(raw_json, '$."成交件数"'), json_extract(raw_json, '$."成交单量"'), json_extract(raw_json, '$."销量"'), ''),
  page_views_raw = COALESCE(json_extract(raw_json, '$."商品浏览量"'), json_extract(raw_json, '$."浏览量"'), json_extract(raw_json, '$."PV"'), ''),
  visitors_raw = COALESCE(json_extract(raw_json, '$."访客数"'), json_extract(raw_json, '$."UV"'), ''),
  conversion_raw = COALESCE(json_extract(raw_json, '$."成交转化率"'), json_extract(raw_json, '$."转化率"'), ''),
  cart_customers_raw = COALESCE(json_extract(raw_json, '$."加购人数"'), json_extract(raw_json, '$."加购客户数"'), ''),
  search_clicks_raw = COALESCE(json_extract(raw_json, '$."搜索点击次数"'), json_extract(raw_json, '$."搜索点击数"'), '');
--> statement-breakpoint
UPDATE market_ranking_entries
SET natural_key = period_start || '|' || period_end || '|' || category || '|' || scope || '|' || price_band_filter || '|' || ranking_dimension || '|' || sku_code;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_entries_canonical_price_band_uq
  ON market_ranking_entries (period_start, period_end, category, scope, price_band_filter, ranking_dimension, sku_code);
--> statement-breakpoint
DROP INDEX IF EXISTS market_entries_canonical_uq;
