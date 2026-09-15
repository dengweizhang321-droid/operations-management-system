"""Read-only, database-side ranking pagination; never materialize the whole range.

The caller validates filters and runs inside the market revision read fence.
All user values are bound parameters. SQL names and expressions are fixed here.
"""
from django.db import connection


def _read(sql, params):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        names = [column[0] for column in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def _scope(queryset, price_bands):
    # Compile the existing ORM predicates: search escaping, dates and all domain
    # filters stay identical to the report path, before price-band preference.
    columns = ("id", "period_start", "period_end", "category", "scope",
               "ranking_dimension", "sku_code", "brand", "price_band_filter", "rank", "gmv_cents")
    source, params = queryset.order_by().values(*columns).query.sql_with_params()
    regex = "~" if connection.vendor == "postgresql" else "REGEXP"
    band_filter = ""
    if price_bands:
        band_filter = "WHERE price_band IN (" + ",".join(["%s"] * len(price_bands)) + ")"
    return f"""WITH source AS ({source}),
      preferred AS (
        SELECT source.*, ROW_NUMBER() OVER (
          PARTITION BY period_start,period_end,category,scope,ranking_dimension,sku_code
          ORDER BY CASE price_band_filter WHEN '全部' THEN 0 WHEN '' THEN 1 ELSE 2 END,
                   price_band_filter, id DESC
        ) preference FROM source
      ), priced AS (
        SELECT p.*, CASE WHEN s.confirmation_status='confirmed'
          AND s.ai_price_type IN ('标准售价','到手价','券后价')
          AND LENGTH(s.image_content_sha256)=64
          AND s.image_content_sha256 {regex} '^[a-f0-9]{{64}}$'
          AND s.confirmed_market_price_cents>0
          THEN s.confirmed_market_price_cents ELSE NULL END official
        FROM preferred p LEFT JOIN market_price_snapshots s ON
          s.category=p.category AND s.scope=p.scope AND s.ranking_dimension=p.ranking_dimension
          AND s.sku_code=p.sku_code AND s.month=SUBSTR(p.period_end,1,7)
        WHERE p.preference=1
      ), banded AS (
        SELECT p.*, COALESCE((SELECT b.label FROM market_price_band_items b
          JOIN market_price_band_versions v ON v.id=b.version_id
          WHERE p.official IS NOT NULL AND v.status='published'
            AND v.category IN (p.category,'*') AND v.effective_from<=p.period_end
            AND (b.min_cents IS NULL OR p.official>=b.min_cents)
            AND (b.max_cents IS NULL OR p.official<b.max_cents)
          ORDER BY CASE WHEN v.category='*' THEN 1 ELSE 0 END,
            v.effective_from DESC,v.version DESC,b.sort_order,b.id LIMIT 1), '未确认价格') price_band
        FROM priced p
      ), selected AS (SELECT * FROM banded {band_filter})
    """, [*params, *price_bands]


def ranking_page(queryset, price_bands, page, page_size):
    cte, params = _scope(queryset, price_bands)
    # Only aggregated scalars/options cross the DB boundary. COUNT DISTINCT is
    # over separate identity columns (never ambiguous concatenated strings).
    stats = _read(cte + """, identities AS (
        SELECT category,scope,ranking_dimension,sku_code,
          MAX(CASE WHEN official IS NULL THEN 1 ELSE 0 END) pending
        FROM selected GROUP BY category,scope,ranking_dimension,sku_code
      ) SELECT COUNT(*) total, COUNT(DISTINCT category) category_count,
        COUNT(DISTINCT COALESCE(NULLIF(brand,''),'未识别品牌')) brand_count,
        (SELECT COUNT(*) FROM identities) product_count,
        (SELECT COALESCE(SUM(pending),0) FROM identities) pending_count
      FROM selected""", params)[0]
    bands = _read(cte + "SELECT price_band value,COUNT(*) count FROM selected GROUP BY price_band ORDER BY count DESC,price_band", params)
    # Projection values affect ranking ties, so apply the existing positive-only
    # replacement before LIMIT. Aggregate by SKU/SPU and exact period once even
    # when several categories/scopes share that period.
    result = _read(cte + """, periods AS (
        SELECT DISTINCT ranking_dimension,sku_code,period_start,period_end FROM selected
      ), projected AS (
        SELECT p.ranking_dimension,p.sku_code,p.period_start,p.period_end,
          SUM(m.transaction_amount_cents) amount
        FROM periods p JOIN market_netshop_projection m ON
          m.projection_revision=(SELECT active_revision FROM market_netshop_projection_control WHERE id=1)
          AND m.kind='metric' AND m.source='jd_sku_daily'
          AND m.business_date>=p.period_start AND m.business_date<=p.period_end
          AND ((p.ranking_dimension='SPU' AND m.dataset='spu_daily' AND m.spu_id=p.sku_code)
            OR (p.ranking_dimension<>'SPU' AND m.dataset='sku_daily' AND m.sku_id=p.sku_code))
        GROUP BY p.ranking_dimension,p.sku_code,p.period_start,p.period_end
      ), ordered AS (
        SELECT s.id, CASE WHEN m.amount>0 THEN m.amount ELSE s.gmv_cents END effective_gmv,
          s.rank, s.official, s.price_band,
          LAG(s.rank) OVER (PARTITION BY s.category,s.scope,s.ranking_dimension,s.sku_code
            ORDER BY s.period_end, CASE WHEN s.rank IS NULL THEN 1 ELSE 0 END,
              COALESCE(s.rank,2147483647), CASE WHEN m.amount>0 THEN m.amount ELSE s.gmv_cents END DESC,s.id) previous_rank,
          COUNT(*) OVER (PARTITION BY s.category,s.scope,s.ranking_dimension,s.sku_code) period_count
        FROM selected s LEFT JOIN projected m ON m.ranking_dimension=s.ranking_dimension
          AND m.sku_code=s.sku_code AND m.period_start=s.period_start AND m.period_end=s.period_end
      ) SELECT * FROM ordered ORDER BY CASE WHEN rank IS NULL THEN 1 ELSE 0 END,
        COALESCE(rank,2147483647),effective_gmv DESC,id LIMIT %s OFFSET %s
    """, [*params, page_size, (page - 1) * page_size])
    return stats, bands, result
