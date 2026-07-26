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

export function marketEffectiveFactsCtes() {
  const group = "category, period_start, period_end, scope, price_band_filter, ranking_dimension";
  const order = "COALESCE(rank, 2147483647), id";
  const reverseOrder = "COALESCE(rank, 2147483647) DESC, id DESC";
  return `market_basis_ids AS MATERIALIZED (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY period_start, period_end, category, scope, ranking_dimension, sku_code
      ORDER BY CASE COALESCE(price_band_filter,'') WHEN '全部' THEN 0 WHEN '' THEN 1 ELSE 2 END,
        COALESCE(price_band_filter,''), id DESC
    ) price_band_preference
    FROM market_ranking_entries
  ), market_basis_rows AS MATERIALIZED (
    SELECT source.* FROM market_ranking_entries source
    JOIN market_basis_ids chosen ON chosen.id=source.id AND chosen.price_band_preference=1
  ), real_gmv_anchor_rows AS MATERIALIZED (
    SELECT m.id, CAST(json_extract(n.metrics_json, '$."成交金额"') AS REAL) real_gmv_yuan
    FROM market_basis_rows m JOIN netshop_rows n
      ON m.ranking_dimension<>'SPU' AND n.sku_id=m.sku_code
      AND n.source='jd_sku_daily' AND n.dataset='sku_daily'
      AND n.business_date BETWEEN m.period_start AND m.period_end
    UNION ALL
    SELECT m.id, CAST(json_extract(n.metrics_json, '$."成交金额"') AS REAL) real_gmv_yuan
    FROM market_basis_rows m JOIN netshop_rows n
      ON m.ranking_dimension='SPU' AND n.spu_id=m.sku_code
      AND n.source='jd_sku_daily' AND n.dataset='spu_daily'
      AND n.business_date BETWEEN m.period_start AND m.period_end
  ), real_gmv_anchors AS MATERIALIZED (
    SELECT id, CAST(ROUND(SUM(COALESCE(real_gmv_yuan,0))*100) AS INTEGER) real_gmv_cents
    FROM real_gmv_anchor_rows GROUP BY id HAVING real_gmv_cents>0
  ), anchor_groups AS MATERIALIZED (
    SELECT DISTINCT ${group}
    FROM market_basis_rows source JOIN real_gmv_anchors anchors ON anchors.id=source.id
  ), range_texts AS MATERIALIZED (
    SELECT m.*, COALESCE(a.real_gmv_cents,0) real_gmv_cents,
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        COALESCE(NULLIF(m.gmv_raw,''),json_extract(m.raw_json,'$."成交金额"'),json_extract(m.raw_json,'$."交易金额"'),json_extract(m.raw_json,'$."GMV"'),json_extract(m.raw_json,'$."销售额"'),''),
        ',',''),'，',''),'￥',''),'¥',''),'元',''),'～','~'),'至','~') gmv_range_text
    FROM market_basis_rows m JOIN anchor_groups USING (${group}) LEFT JOIN real_gmv_anchors a ON a.id=m.id
  ), range_parts AS MATERIALIZED (
    SELECT source.*,
      CASE WHEN instr(gmv_range_text,'~')>0 THEN substr(gmv_range_text,1,instr(gmv_range_text,'~')-1) ELSE gmv_range_text END gmv_low_text,
      CASE WHEN instr(gmv_range_text,'~')>0 THEN substr(gmv_range_text,instr(gmv_range_text,'~')+1) ELSE gmv_range_text END gmv_high_text
    FROM range_texts source
  ), parsed_ranges AS MATERIALIZED (
    SELECT source.*,
      CASE WHEN gmv_low_text<>'' THEN CAST(ROUND(CAST(REPLACE(REPLACE(REPLACE(TRIM(gmv_low_text),'亿',''),'万',''),'千','') AS REAL)
        * CASE WHEN instr(gmv_low_text,'亿')>0 THEN 100000000 WHEN instr(gmv_low_text,'万')>0 THEN 10000 WHEN instr(gmv_low_text,'千')>0 THEN 1000 ELSE 1 END * 100) AS INTEGER) END parsed_gmv_low_cents,
      CASE WHEN gmv_high_text<>'' THEN CAST(ROUND(CAST(REPLACE(REPLACE(REPLACE(TRIM(gmv_high_text),'亿',''),'万',''),'千','') AS REAL)
        * CASE WHEN instr(gmv_high_text,'亿')>0 THEN 100000000 WHEN instr(gmv_high_text,'万')>0 THEN 10000 WHEN instr(gmv_high_text,'千')>0 THEN 1000 ELSE 1 END * 100) AS INTEGER) END parsed_gmv_high_cents
    FROM range_parts source
  ), rank_source AS MATERIALIZED (
    SELECT m.*,
      CASE WHEN m.real_gmv_cents>0 THEN m.real_gmv_cents ELSE COALESCE(m.gmv_low_cents,m.parsed_gmv_low_cents,0) END rank_low,
      CASE WHEN m.real_gmv_cents>0 THEN m.real_gmv_cents ELSE COALESCE(m.gmv_high_cents,m.parsed_gmv_high_cents,9223372036854775807) END rank_high,
      CASE WHEN m.real_gmv_cents>0
        AND ((COALESCE(m.gmv_low_cents,m.parsed_gmv_low_cents) IS NOT NULL AND m.real_gmv_cents<COALESCE(m.gmv_low_cents,m.parsed_gmv_low_cents)) OR (COALESCE(m.gmv_high_cents,m.parsed_gmv_high_cents) IS NOT NULL AND m.real_gmv_cents>COALESCE(m.gmv_high_cents,m.parsed_gmv_high_cents)))
        THEN 1 ELSE 0 END gmv_out_of_band
    FROM parsed_ranges m
  ), narrowed AS MATERIALIZED (
    SELECT source.*,
      MIN(rank_high) OVER (PARTITION BY ${group} ORDER BY ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) narrowed_high,
      MAX(rank_low) OVER (PARTITION BY ${group} ORDER BY ${order} ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) narrowed_low
    FROM rank_source source
  ), anchor_segments AS MATERIALIZED (
    SELECT source.*,
      SUM(CASE WHEN real_gmv_cents>0 THEN 1 ELSE 0 END) OVER (PARTITION BY ${group} ORDER BY ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) left_segment,
      SUM(CASE WHEN real_gmv_cents>0 THEN 1 ELSE 0 END) OVER (PARTITION BY ${group} ORDER BY ${reverseOrder} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) right_segment
    FROM narrowed source
  ), anchor_values AS MATERIALIZED (
    SELECT source.*,
      MAX(CASE WHEN real_gmv_cents>0 THEN rank END) OVER (PARTITION BY ${group}, left_segment) left_anchor_rank,
      MAX(CASE WHEN real_gmv_cents>0 THEN real_gmv_cents END) OVER (PARTITION BY ${group}, left_segment) left_anchor_value,
      MAX(CASE WHEN real_gmv_cents>0 THEN rank END) OVER (PARTITION BY ${group}, right_segment) right_anchor_rank,
      MAX(CASE WHEN real_gmv_cents>0 THEN real_gmv_cents END) OVER (PARTITION BY ${group}, right_segment) right_anchor_value
    FROM anchor_segments source
  ), raw_candidates AS MATERIALIZED (
    SELECT source.*,
      CASE WHEN real_gmv_cents>0 THEN real_gmv_cents
        WHEN left_anchor_value>0 AND right_anchor_value>0 AND right_anchor_rank<>left_anchor_rank AND rank IS NOT NULL
          THEN CAST(ROUND(EXP(LN(left_anchor_value) + ((rank-left_anchor_rank)*1.0/(right_anchor_rank-left_anchor_rank))*(LN(right_anchor_value)-LN(left_anchor_value)))) AS INTEGER)
        ELSE gmv_cents END raw_effective_gmv_cents
    FROM anchor_values source
  ), candidates AS MATERIALIZED (
    SELECT source.*, MAX(MIN(raw_effective_gmv_cents, MAX(narrowed_low,narrowed_high)), MIN(narrowed_low,narrowed_high)) candidate_gmv_cents
    FROM raw_candidates source
  ), adjusted_rows AS MATERIALIZED (
    SELECT source.*,
      CASE WHEN real_gmv_cents>0 THEN real_gmv_cents
        ELSE MIN(candidate_gmv_cents) OVER (PARTITION BY ${group} ORDER BY ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      END effective_gmv_cents
    FROM candidates source
  ), effective_values AS MATERIALIZED (
    SELECT id, effective_gmv_cents, real_gmv_cents, gmv_out_of_band FROM adjusted_rows
  ), effective_seeds AS MATERIALIZED (
    SELECT source.*,
      COALESCE(adjusted.effective_gmv_cents,source.gmv_cents) effective_gmv_cents,
      COALESCE(adjusted.real_gmv_cents,0) real_gmv_cents,
      COALESCE(adjusted.gmv_out_of_band,0) gmv_out_of_band
    FROM market_basis_rows source LEFT JOIN effective_values adjusted ON adjusted.id=source.id
  ), refined_quantities AS MATERIALIZED (
    SELECT source.*,
      CASE
        WHEN COALESCE(NULLIF(price_cents,0), CASE WHEN quantity>0 THEN effective_gmv_cents*1.0/quantity END) IS NULL THEN MAX(1,quantity)
        WHEN gmv_out_of_band=1 THEN MAX(1,CAST(ROUND(effective_gmv_cents*1.0/COALESCE(NULLIF(price_cents,0),effective_gmv_cents*1.0/NULLIF(quantity,0))) AS INTEGER))
        ELSE MAX(1,MIN(
          MAX(CAST(ROUND(effective_gmv_cents*1.0/COALESCE(NULLIF(price_cents,0),effective_gmv_cents*1.0/NULLIF(quantity,0))) AS INTEGER),COALESCE(quantity_low,1)),
          COALESCE(quantity_high,9223372036854775807)
        ))
      END effective_quantity
    FROM effective_seeds source
  ), market_effective_rows AS MATERIALIZED (
    SELECT source.*,
      CASE WHEN effective_quantity>0 THEN CAST(ROUND(effective_gmv_cents*1.0/effective_quantity) AS INTEGER) END effective_average_transaction_price_cents,
      CASE WHEN visitors<=0 THEN NULL
        WHEN gmv_out_of_band=1 THEN MIN(10000,MAX(0,CAST(ROUND(effective_quantity*10000.0/visitors) AS INTEGER)))
        ELSE MIN(10000,MAX(
          COALESCE(conversion_low_bps,0),
          MIN(CAST(ROUND(effective_quantity*10000.0/visitors) AS INTEGER),COALESCE(conversion_high_bps,10000))
        ))
      END effective_conversion_bps
    FROM refined_quantities source
  )`;
}

export function buildMarketOverviewEnrichedSql(options: MarketOverviewSqlOptions = {}) {
  const materialized = options.materialized ? "MATERIALIZED " : "";
  return `WITH ${marketEffectiveFactsCtes()}, enriched AS ${materialized}(
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
    FROM market_effective_rows m
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
  return `WITH ${marketEffectiveFactsCtes()}, analytics_base AS MATERIALIZED (
    SELECT m.period_start, m.period_end, m.category, m.scope, m.ranking_dimension, m.operation_mode,
      m.subcategory, m.rank, m.sku_code, m.brand, m.effective_gmv_cents gmv_cents, m.effective_quantity quantity, m.page_views, m.visitors,
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
    FROM market_effective_rows m
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
