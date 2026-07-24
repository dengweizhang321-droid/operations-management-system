import { officialPriceBandSql } from "@/lib/market/schema-core";

type MarketOverviewSqlOptions = {
  where?: string;
  priceBandWhere?: string;
  materialized?: boolean;
};

function overviewPriceBandSql() {
  return officialPriceBandSql("ps.confirmed_market_price_cents", {
    confirmationStatusSql: "ps.confirmation_status",
    aiPriceTypeSql: "ps.ai_price_type",
    categorySql: "m.category",
    periodEndSql: "m.period_end",
  });
}

export function buildMarketOverviewEnrichedSql(options: MarketOverviewSqlOptions = {}) {
  const materialized = options.materialized ? "MATERIALIZED " : "";
  return `WITH enriched AS ${materialized}(
    SELECT m.*,
      mic.status AS image_cache_status_raw,
      mic.content_sha256 AS image_content_sha256,
      ps.confirmed_market_price_cents,
      ps.source_price_cents,
      ps.ai_image_price_cents,
      ps.ai_price_type,
      ps.ai_confidence_bps,
      ps.confirmation_status,
      ps.average_transaction_price_cents,
      ps.confirmed_market_price_cents AS official_market_price_cents,
      COALESCE(ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) AS candidate_price_cents,
      CASE
        WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认'
        ELSE '未确认价格'
      END AS market_price_source,
      CASE
        WHEN ps.source_price_cents IS NOT NULL THEN '源表价格'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN '系统计算'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'AI待确认'
        ELSE '暂无价格'
      END AS candidate_price_source,
      ${overviewPriceBandSql()} AS price_band,
      CASE WHEN EXISTS (
        SELECT 1 FROM netshop_rows n
        WHERE n.sku_id = m.sku_code OR n.product_code = m.sku_code OR n.spu_id = m.sku_code
      ) OR EXISTS (
        SELECT 1 FROM sales_order_lines s WHERE s.product_code = m.sku_code
      ) THEN 1 ELSE 0 END AS is_own
    FROM market_ranking_entries m
    LEFT JOIN market_image_cache mic ON mic.source_url = m.image_url
    LEFT JOIN market_price_snapshots ps ON ps.category = m.category
      AND ps.scope = m.scope
      AND ps.sku_code = m.sku_code
      AND ps.ranking_dimension = m.ranking_dimension
      AND ps.month = substr(m.period_end, 1, 7)
    ${options.where ?? ""}
  ), filtered AS ${materialized}(SELECT * FROM enriched ${options.priceBandWhere ?? ""})`;
}

export function buildMarketOverviewAnalyticsSql(options: Omit<MarketOverviewSqlOptions, "materialized"> = {}) {
  return `WITH analytics_base AS MATERIALIZED (
    SELECT m.period_start, m.period_end, m.category, m.scope, m.ranking_dimension, m.operation_mode,
      m.subcategory, m.rank, m.sku_code, m.brand, m.gmv_cents, m.quantity, m.page_views, m.visitors,
      ps.confirmed_market_price_cents AS official_market_price_cents,
      ps.confirmation_status,
      CASE WHEN ps.confirmed_market_price_cents IS NOT NULL THEN '人工确认' ELSE '未确认价格' END AS market_price_source,
      ${overviewPriceBandSql()} AS price_band,
      CASE WHEN EXISTS (
        SELECT 1 FROM netshop_rows n
        WHERE n.sku_id=m.sku_code OR n.product_code=m.sku_code OR n.spu_id=m.sku_code
      ) OR EXISTS (
        SELECT 1 FROM sales_order_lines s WHERE s.product_code=m.sku_code
      ) THEN 1 ELSE 0 END AS is_own
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category=m.category
      AND ps.scope=m.scope AND ps.sku_code=m.sku_code
      AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    ${options.where ?? ""}
  ), filtered AS MATERIALIZED (SELECT * FROM analytics_base ${options.priceBandWhere ?? ""}),
  summary AS (
    SELECT COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT category) category_count,
      COUNT(DISTINCT COALESCE(NULLIF(brand,''), '未识别品牌')) brand_count, COALESCE(SUM(gmv_cents), 0) gmv_cents,
      COALESCE(SUM(quantity), 0) quantity, COALESCE(SUM(page_views), 0) page_views,
      COALESCE(SUM(visitors), 0) visitors, COUNT(DISTINCT CASE WHEN is_own = 1 THEN sku_code END) own_product_count,
      COALESCE(SUM(CASE WHEN operation_mode = '自营' THEN gmv_cents ELSE 0 END), 0) self_operated_gmv_cents,
      COUNT(DISTINCT CASE WHEN COALESCE(confirmation_status, '') IN ('missing','ai_pending','review_pending') OR market_price_source = 'AI待确认' THEN sku_code END) pending_ai_count
    FROM filtered
  ), trend_rows AS (
    SELECT substr(period_end, 1, 7) period, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      SUM(visitors) visitors, COUNT(DISTINCT sku_code) product_count, COUNT(DISTINCT brand) brand_count,
      SUM(CASE WHEN operation_mode='POP' THEN gmv_cents ELSE 0 END) pop_gmv_cents,
      SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      CASE WHEN SUM(quantity)>0 THEN CAST(ROUND(SUM(gmv_cents)*1.0/SUM(quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents,
      CASE WHEN SUM(CASE WHEN official_market_price_cents IS NULL THEN 0 ELSE gmv_cents END)>0
        THEN CAST(ROUND(SUM(COALESCE(official_market_price_cents,0)*1.0*gmv_cents)/SUM(CASE WHEN official_market_price_cents IS NULL THEN 0 ELSE gmv_cents END)) AS INTEGER)
        ELSE NULL END weighted_market_price_cents
    FROM filtered GROUP BY substr(period_end, 1, 7)
  ), price_band_rows AS (
    SELECT price_band, COUNT(*) row_count, SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      COUNT(DISTINCT sku_code) sku_count,
      SUM(CASE WHEN operation_mode='POP' THEN gmv_cents ELSE 0 END) pop_gmv_cents,
      SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      GROUP_CONCAT(DISTINCT brand) brands
    FROM filtered GROUP BY price_band
  ), price_band_trend_rows AS (
    SELECT substr(period_end,1,7) period, price_band,
      SUM(gmv_cents) gmv_cents, SUM(quantity) quantity,
      SUM(SUM(gmv_cents)) OVER (PARTITION BY substr(period_end,1,7)) period_gmv_cents
    FROM filtered GROUP BY substr(period_end,1,7), price_band
  ), brand_rows AS (
    SELECT COALESCE(NULLIF(brand,''), '未识别品牌') brand,
      SUM(gmv_cents) gmv_cents, SUM(quantity) quantity, COUNT(DISTINCT sku_code) sku_count,
      MIN(rank) best_rank, GROUP_CONCAT(DISTINCT price_band) price_bands, GROUP_CONCAT(DISTINCT subcategory) subcategories
    FROM filtered GROUP BY COALESCE(NULLIF(brand,''), '未识别品牌')
  ), subcategory_rows AS (
    SELECT subcategory, COUNT(DISTINCT sku_code) sku_count, SUM(gmv_cents) gmv_cents,
      SUM(quantity) quantity, SUM(CASE WHEN operation_mode='自营' THEN gmv_cents ELSE 0 END) self_gmv_cents,
      CASE WHEN SUM(quantity)>0 THEN CAST(ROUND(SUM(gmv_cents)*1.0/SUM(quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents,
      COUNT(DISTINCT CASE WHEN official_market_price_cents IS NULL THEN sku_code END) pending_count,
      GROUP_CONCAT(DISTINCT brand) brands, GROUP_CONCAT(DISTINCT price_band) price_bands
    FROM filtered GROUP BY subcategory
  ), price_values AS MATERIALIZED (
    SELECT official_market_price_cents price, gmv_cents
    FROM filtered WHERE official_market_price_cents IS NOT NULL
  ), ranked_prices AS (
    SELECT price, ROW_NUMBER() OVER (ORDER BY price) price_row, COUNT(*) OVER () price_count
    FROM price_values
  )
  SELECT
    (SELECT json_object(
      'product_count', product_count, 'category_count', category_count, 'brand_count', brand_count,
      'gmv_cents', gmv_cents, 'quantity', quantity, 'page_views', page_views, 'visitors', visitors,
      'own_product_count', own_product_count, 'self_operated_gmv_cents', self_operated_gmv_cents,
      'pending_ai_count', pending_ai_count,
      'median_market_price_cents', (SELECT price FROM ranked_prices WHERE price_row=CAST((price_count+1)/2 AS INTEGER) LIMIT 1),
      'weighted_market_price_cents', (SELECT CASE WHEN SUM(gmv_cents)>0 THEN CAST(ROUND(SUM(price*1.0*gmv_cents)/SUM(gmv_cents)) AS INTEGER) ELSE NULL END FROM price_values)
    ) FROM summary) summary_json,
    (SELECT json_group_array(json_object(
      'period', period, 'gmv_cents', gmv_cents, 'quantity', quantity, 'visitors', visitors,
      'product_count', product_count, 'brand_count', brand_count, 'pop_gmv_cents', pop_gmv_cents,
      'self_gmv_cents', self_gmv_cents, 'average_transaction_price_cents', average_transaction_price_cents,
      'weighted_market_price_cents', weighted_market_price_cents
    )) FROM (SELECT * FROM trend_rows ORDER BY period ASC LIMIT 60)) trend_json,
    (SELECT json_group_array(json_object('value', price_band, 'count', row_count))
      FROM (SELECT * FROM price_band_rows ORDER BY CASE price_band WHEN '未确认价格' THEN 9 WHEN '3000+' THEN 8 ELSE 1 END, price_band)) price_bands_json,
    (SELECT json_group_array(json_object(
      'price_band', price_band, 'gmv_cents', gmv_cents, 'quantity', quantity, 'sku_count', sku_count,
      'pop_gmv_cents', pop_gmv_cents, 'self_gmv_cents', self_gmv_cents, 'brands', brands
    )) FROM (SELECT * FROM price_band_rows ORDER BY gmv_cents DESC)) price_band_summary_json,
    (SELECT json_group_array(json_object(
      'period', period, 'price_band', price_band, 'gmv_cents', gmv_cents, 'quantity', quantity,
      'period_gmv_cents', period_gmv_cents
    )) FROM (SELECT * FROM price_band_trend_rows ORDER BY period, gmv_cents DESC)) price_band_trend_json,
    (SELECT json_group_array(json_object(
      'brand', brand, 'gmv_cents', gmv_cents, 'quantity', quantity, 'sku_count', sku_count,
      'best_rank', best_rank, 'price_bands', price_bands, 'subcategories', subcategories
    )) FROM (SELECT * FROM brand_rows ORDER BY gmv_cents DESC)) brand_rows_json,
    (SELECT json_group_array(json_object(
      'subcategory', subcategory, 'sku_count', sku_count, 'gmv_cents', gmv_cents, 'quantity', quantity,
      'self_gmv_cents', self_gmv_cents, 'average_transaction_price_cents', average_transaction_price_cents,
      'pending_count', pending_count, 'brands', brands, 'price_bands', price_bands
    )) FROM (SELECT * FROM subcategory_rows ORDER BY gmv_cents DESC LIMIT 60)) subcategory_rows_json,
    (SELECT MIN(period_start) FROM filtered) date_min,
    (SELECT MAX(period_end) FROM filtered) date_max`;
}

export const marketOverviewFilterOptionsSql = `SELECT
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT category value, COUNT(*) count FROM market_ranking_entries WHERE category<>'' GROUP BY category ORDER BY count DESC, value LIMIT 100
  )) categories_json,
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT scope value, COUNT(*) count FROM market_ranking_entries WHERE scope<>'' GROUP BY scope ORDER BY count DESC, value LIMIT 30
  )) scopes_json,
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT brand value, COUNT(*) count FROM market_ranking_entries WHERE brand<>'' GROUP BY brand ORDER BY count DESC, value LIMIT 100
  )) brands_json,
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT ranking_dimension value, COUNT(*) count FROM market_ranking_entries GROUP BY ranking_dimension ORDER BY value
  )) dimensions_json,
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT operation_mode value, COUNT(*) count FROM market_ranking_entries GROUP BY operation_mode ORDER BY value
  )) modes_json,
  (SELECT json_group_array(json_object('value', value, 'count', count)) FROM (
    SELECT subcategory value, COUNT(*) count FROM market_ranking_entries WHERE subcategory<>'' GROUP BY subcategory ORDER BY count DESC, value LIMIT 100
  )) subcategories_json`;
