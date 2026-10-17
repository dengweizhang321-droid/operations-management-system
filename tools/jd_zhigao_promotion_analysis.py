"""Read-only promotion diagnosis for JD's 志高商用设备旗舰店.

This script is intentionally standalone and reproducible.  It reads the
authoritative PostgreSQL projections through the existing minimum read-only
roles, reconciles promotion aggregates to retained source rows, joins the
controlled sales alias and latest product master, and writes derived report
artifacts only.  It never imports, updates, deletes, or sends anything.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import os
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row


PLATFORM = "京东"
PROMOTION_SHOP = "志高商用设备旗舰店"
SALES_SHOP = "志高商用设备旗舰店（亿用）"
SALES_CHANNEL = "京东-志高商用设备旗舰店（亿用）"
EXCLUDED_WAREHOUSE = "刷刷仓"
SOURCE = "jd_promotion"
DATASET = "ad"
PRESENCE_RULE = "jd-ad-presence-v1"
PRESENCE_MASK = 31


def iso(value: date) -> str:
    return value.isoformat()


def dates_between(start: date, end_exclusive: date) -> list[str]:
    return [iso(start + timedelta(days=offset)) for offset in range((end_exclusive - start).days)]


def ratio(numerator: int | float | None, denominator: int | float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return float(numerator) / float(denominator)


def change(current: int | float | None, previous: int | float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return (float(current) - float(previous)) / abs(float(previous))


def percentile(values: Iterable[int | float], fraction: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def money(cents: int | float | None) -> str:
    if cents is None:
        return "—"
    return f"¥{float(cents) / 100:,.2f}"


def pct(value: float | None) -> str:
    return "—" if value is None else f"{value:.1%}"


def multiple(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def fetch_all(connection: psycopg.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return list(cursor.fetchall())


def enforce_read_only(connection: psycopg.Connection, expected_user: str) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = '60s'")
        cursor.execute(
            """
            SELECT current_user,
                   current_setting('transaction_read_only'),
                   rolsuper, rolcreaterole, rolcreatedb
            FROM pg_roles WHERE rolname = current_user
            """
        )
        row = cursor.fetchone()
    if not row or row["current_user"] != expected_user or row["current_setting"] != "on":
        raise RuntimeError(f"Expected read-only role {expected_user}")
    if row["rolsuper"] or row["rolcreaterole"] or row["rolcreatedb"]:
        raise RuntimeError(f"Role {expected_user} is not minimally privileged")
    return {"role": row["current_user"], "transactionReadOnly": True}


def sum_metrics(rows: Iterable[dict[str, Any]], start: str, end_exclusive: str, fields: tuple[str, ...]) -> dict[str, int]:
    result = {field: 0 for field in fields}
    for row in rows:
        if start <= row["business_date"] < end_exclusive:
            for field in fields:
                result[field] += int(row.get(field) or 0)
    return result


def index_rows(rows: Iterable[dict[str, Any]], key: str) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        result[str(row.get(key) or "")].append(row)
    return result


def metric_block(values: dict[str, int]) -> dict[str, Any]:
    spend = values.get("spend_cents", 0)
    gmv = values.get("attributed_gmv_cents", 0)
    impressions = values.get("impressions", 0)
    clicks = values.get("clicks", 0)
    orders = values.get("orders", 0)
    return {
        **values,
        "roas": ratio(gmv, spend),
        "ctr": ratio(clicks, impressions),
        "cpcCents": ratio(spend, clicks),
        "cvr": ratio(orders, clicks),
        "cpoCents": ratio(spend, orders),
    }


def sales_block(
    values: dict[str, int], spend_cents: int, *, available: bool = True,
    spend_is_owned: bool = True,
) -> dict[str, Any]:
    if not available:
        return {
            "net_sales_cents": None,
            "cost_cents": None,
            "quantity": None,
            "reported_gross_profit_cents": None,
            "order_product_day_count": None,
            "gross_profit_cents": None,
            "gross_margin": None,
            "breakEvenRoas": None,
            "after_ad_gross_profit_cents": None,
            "after_ad_margin": None,
            "ad_spend_rate": None,
            "mappingAvailable": False,
        }
    net_sales = values.get("net_sales_cents", 0)
    cost = values.get("cost_cents", 0)
    gross_profit = net_sales - cost
    margin = ratio(gross_profit, net_sales)
    after_ad = gross_profit - spend_cents if spend_is_owned else None
    return {
        **values,
        "gross_profit_cents": gross_profit,
        "gross_margin": margin,
        "breakEvenRoas": ratio(1, margin) if margin and margin > 0 else None,
        "after_ad_gross_profit_cents": after_ad,
        "after_ad_margin": ratio(after_ad, net_sales) if spend_is_owned else None,
        "ad_spend_rate": ratio(spend_cents, net_sales) if spend_is_owned else None,
        "mappingAvailable": True,
    }


def make_windows(as_of: date) -> dict[str, dict[str, str]]:
    end_exclusive = as_of + timedelta(days=1)
    last30_start = end_exclusive - timedelta(days=30)
    previous30_start = last30_start - timedelta(days=30)
    month_start = as_of.replace(day=1)
    prior_month_end = month_start
    prior_month_start = (month_start - timedelta(days=1)).replace(day=1)
    comparable_days = (end_exclusive - month_start).days
    prior_mtd_end = prior_month_start + timedelta(days=comparable_days)
    if prior_mtd_end > prior_month_end:
        prior_mtd_end = prior_month_end
    return {
        "last30": {"start": iso(last30_start), "endExclusive": iso(end_exclusive), "label": f"{iso(last30_start)} 至 {iso(as_of)}"},
        "previous30": {"start": iso(previous30_start), "endExclusive": iso(last30_start), "label": f"{iso(previous30_start)} 至 {iso(last30_start - timedelta(days=1))}"},
        "mtd": {"start": iso(month_start), "endExclusive": iso(end_exclusive), "label": f"{iso(month_start)} 至 {iso(as_of)}"},
        "priorMtd": {"start": iso(prior_month_start), "endExclusive": iso(prior_mtd_end), "label": f"{iso(prior_month_start)} 至 {iso(prior_mtd_end - timedelta(days=1))}"},
    }


def extract(netshop_dsn: str, bi_dsn: str, windows: dict[str, dict[str, str]]) -> dict[str, Any]:
    earliest = min(window["start"] for window in windows.values())
    latest = max(window["endExclusive"] for window in windows.values())
    result: dict[str, Any] = {"readOnly": {}, "quality": {}}

    with psycopg.connect(netshop_dsn, row_factory=dict_row) as connection:
        with connection.transaction():
            result["readOnly"]["netshop"] = enforce_read_only(connection, "teruisi_netshop_reader")
            promo_daily = fetch_all(
                connection,
                """
                SELECT business_date, product_id, max(product_name) AS product_name,
                       max(product_line) AS product_line,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(gross_transaction_amount_cents)::bigint AS gross_attributed_gmv_cents,
                       sum(impressions)::bigint AS impressions,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders,
                       sum(favorites)::bigint AS favorites,
                       sum(cart_quantity)::bigint AS cart_quantity,
                       sum(source_row_count)::bigint AS source_row_count
                FROM netshop_promotion_product_daily
                WHERE platform=%s AND shop_name=%s AND source=%s
                  AND business_date >= %s AND business_date < %s
                GROUP BY business_date, product_id
                ORDER BY business_date, product_id
                """,
                (PLATFORM, PROMOTION_SHOP, SOURCE, earliest, latest),
            )
            shop_daily = fetch_all(
                connection,
                """
                SELECT business_date, spend_cents, net_transaction_amount_cents AS attributed_gmv_cents,
                       gross_transaction_amount_cents AS gross_attributed_gmv_cents,
                       impressions, clicks, net_orders AS orders, favorites, cart_quantity,
                       source_row_count, product_count, source_batch_id
                FROM netshop_promotion_shop_daily
                WHERE platform=%s AND shop_name=%s AND source=%s
                  AND business_date >= %s AND business_date < %s
                ORDER BY business_date
                """,
                (PLATFORM, PROMOTION_SHOP, SOURCE, earliest, latest),
            )
            state_rows = fetch_all(
                connection,
                """
                SELECT business_date, ready, raw_row_count, product_row_count, source_batch_id
                FROM netshop_promotion_aggregate_state
                WHERE platform=%s AND shop_name=%s AND source=%s
                  AND business_date >= %s AND business_date < %s
                ORDER BY business_date
                """,
                (PLATFORM, PROMOTION_SHOP, SOURCE, earliest, latest),
            )
            raw_controls = fetch_all(
                connection,
                """
                SELECT business_date, count(*)::bigint AS row_count,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(impressions)::bigint AS impressions,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders,
                       count(*) FILTER (
                           WHERE numeric_presence_rule=%s
                             AND numeric_presence_mask=%s
                             AND coalesce(numeric_presence_null_mask,0)=0
                             AND numeric_presence_row_hash=source_row_hash
                             AND numeric_presence_batch_id=last_import_batch_id
                       )::bigint AS complete_presence_rows
                FROM netshop_rows
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND business_date >= %s AND business_date < %s
                GROUP BY business_date ORDER BY business_date
                """,
                (PRESENCE_RULE, PRESENCE_MASK, SOURCE, DATASET, PLATFORM, PROMOTION_SHOP, earliest, latest),
            )
            batch_rows = fetch_all(
                connection,
                """
                SELECT id, file_name, status, row_count, warning_count, date_min, date_max,
                       completed_at, content_hash, warnings_json
                FROM netshop_import_batches
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND status='completed' AND date_max >= %s AND date_min < %s
                ORDER BY completed_at DESC
                """,
                (SOURCE, DATASET, PLATFORM, PROMOTION_SHOP, earliest, latest),
            )
            latest_master = fetch_all(
                connection,
                """
                SELECT id, snapshot_date, completed_at, row_count, warning_count, content_hash
                FROM netshop_import_batches
                WHERE source='jd_product_master' AND dataset='product_master'
                  AND platform=%s AND shop_name=%s AND status='completed'
                ORDER BY completed_at DESC, created_at DESC LIMIT 1
                """,
                (PLATFORM, PROMOTION_SHOP),
            )
            master_rows: list[dict[str, Any]] = []
            if latest_master:
                master_rows = fetch_all(
                    connection,
                    """
                    SELECT sku_id, product_code AS jd_product_code,
                           coalesce(nullif(raw_json->>'商家SKU',''), '') AS erp_product_code,
                           product_name, product_status, category,
                           brand, price_cents, inventory_quantity,
                           coalesce(nullif(raw_json->>'商品可用库存',''), nullif(raw_json->>'商品总库存',''), '') AS inventory_raw,
                           snapshot_date
                    FROM netshop_rows
                    WHERE source='jd_product_master' AND dataset='product_master'
                      AND last_import_batch_id=%s
                    ORDER BY sku_id, product_code
                    """,
                    (latest_master[0]["id"],),
                )
            sku_daily = fetch_all(
                connection,
                """
                SELECT business_date, sku_id, max(product_name) AS product_name,
                       sum(transaction_amount_cents)::bigint AS transaction_amount_cents,
                       sum(transaction_quantity)::bigint AS transaction_quantity,
                       sum(transaction_customers)::bigint AS transaction_customers,
                       sum(visitors)::bigint AS visitors,
                       sum(page_views)::bigint AS page_views
                FROM netshop_rows r
                JOIN netshop_import_batches b ON b.id=r.last_import_batch_id AND b.status='completed'
                WHERE r.source='jd_sku_daily' AND r.dataset='sku_daily'
                  AND r.platform=%s AND r.shop_name=%s
                  AND r.business_date >= %s AND r.business_date < %s
                GROUP BY business_date, sku_id ORDER BY business_date, sku_id
                """,
                (PLATFORM, PROMOTION_SHOP, earliest, latest),
            )
            identity_spend = fetch_all(
                connection,
                """
                WITH identity_rows AS (
                    SELECT DISTINCT r.id, r.business_date, identity.sku_id, r.spend_cents
                    FROM netshop_rows r
                    CROSS JOIN LATERAL (
                        VALUES
                            (nullif(r.sku_id,'')),
                            (nullif(r.raw_json->>'智能投放推广SKU ID','')),
                            (nullif(r.raw_json->>'触发SKU ID',''))
                    ) AS identity(sku_id)
                    WHERE r.source=%s AND r.dataset=%s AND r.platform=%s AND r.shop_name=%s
                      AND r.business_date >= %s AND r.business_date < %s
                      AND identity.sku_id IS NOT NULL
                )
                SELECT business_date, sku_id, sum(spend_cents)::bigint AS spend_cents,
                       count(*)::bigint AS source_row_count
                FROM identity_rows
                GROUP BY business_date, sku_id
                ORDER BY business_date, sku_id
                """,
                (SOURCE, DATASET, PLATFORM, PROMOTION_SHOP, earliest, latest),
            )
            plan_daily = fetch_all(
                connection,
                """
                SELECT business_date,
                       coalesce(nullif(raw_json->>'计划ID',''), '') AS plan_id,
                       coalesce(nullif(raw_json->>'推广计划',''), nullif(raw_json->>'计划名称',''), '（未提供计划）') AS plan_name,
                       coalesce(nullif(raw_json->>'智能投放推广SKU ID',''), '') AS promoted_sku_id,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(impressions)::bigint AS impressions,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders,
                       count(*)::bigint AS source_row_count
                FROM netshop_rows
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND business_date >= %s AND business_date < %s
                GROUP BY business_date, plan_id, plan_name, promoted_sku_id
                ORDER BY business_date, plan_id, plan_name, promoted_sku_id
                """,
                (SOURCE, DATASET, PLATFORM, PROMOTION_SHOP, earliest, latest),
            )
            follow_order_breakdown = fetch_all(
                connection,
                """
                SELECT sku_id AS follow_order_sku_id,
                       coalesce(nullif(raw_json->>'智能投放推广SKU ID',''), '（空）') AS promoted_sku_id,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders
                FROM netshop_rows
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND business_date >= %s AND business_date < %s
                  AND sku_id<>''
                GROUP BY sku_id, promoted_sku_id
                ORDER BY sku_id, spend_cents DESC
                """,
                (
                    SOURCE, DATASET, PLATFORM, PROMOTION_SHOP,
                    windows["last30"]["start"], windows["last30"]["endExclusive"],
                ),
            )
            root_rows = fetch_all(
                connection,
                """
                SELECT 'keyword'::text AS dimension, sku_id,
                       coalesce(nullif(raw_json->>'关键词',''),'（空）') AS item,
                       coalesce(nullif(raw_json->>'推广计划',''), nullif(raw_json->>'计划名称',''), '（未提供计划）') AS plan_name,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(impressions)::bigint AS impressions,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders,
                       count(*)::bigint AS source_row_count
                FROM netshop_rows
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND business_date >= %s AND business_date < %s
                GROUP BY sku_id, item, plan_name
                HAVING sum(spend_cents) > 0
                UNION ALL
                SELECT 'search_term'::text AS dimension, sku_id,
                       coalesce(nullif(raw_json->>'搜索词',''),'（空）') AS item,
                       coalesce(nullif(raw_json->>'推广计划',''), nullif(raw_json->>'计划名称',''), '（未提供计划）') AS plan_name,
                       sum(spend_cents)::bigint AS spend_cents,
                       sum(net_transaction_amount_cents)::bigint AS attributed_gmv_cents,
                       sum(impressions)::bigint AS impressions,
                       sum(clicks)::bigint AS clicks,
                       sum(net_orders)::bigint AS orders,
                       count(*)::bigint AS source_row_count
                FROM netshop_rows
                WHERE source=%s AND dataset=%s AND platform=%s AND shop_name=%s
                  AND business_date >= %s AND business_date < %s
                GROUP BY sku_id, item, plan_name
                HAVING sum(spend_cents) > 0
                ORDER BY spend_cents DESC
                """,
                (
                    SOURCE, DATASET, PLATFORM, PROMOTION_SHOP,
                    windows["last30"]["start"], windows["last30"]["endExclusive"],
                    SOURCE, DATASET, PLATFORM, PROMOTION_SHOP,
                    windows["last30"]["start"], windows["last30"]["endExclusive"],
                ),
            )
            result["quality"]["promotionManifest"] = fetch_all(
                connection,
                """
                SELECT ready, historical_data_cutoff, source_shop_count, raw_row_count,
                       product_row_count, shop_day_count, state_day_count, completed_at, data_version
                FROM netshop_promotion_aggregate_manifest WHERE platform=%s
                """,
                (PLATFORM,),
            )

    with psycopg.connect(bi_dsn, row_factory=dict_row) as connection:
        with connection.transaction():
            result["readOnly"]["sales"] = enforce_read_only(connection, "teruisi_bi_reader")
            sales_daily = fetch_all(
                connection,
                """
                SELECT business_date::text AS business_date, product_code,
                       max(product_name) AS product_name,
                       sum(allocated_amount_cents)::bigint AS net_sales_cents,
                       sum(cost_amount_cents)::bigint AS cost_cents,
                       sum(quantity)::bigint AS quantity,
                       sum(gross_profit_cents)::bigint AS reported_gross_profit_cents,
                       count(DISTINCT order_identity)::bigint AS order_product_day_count
                FROM sales_order_lines
                WHERE platform=%s AND shop_name=%s AND channel=%s
                  AND business_date >= %s AND business_date < %s
                  AND is_business_row=true AND warehouse<>%s
                GROUP BY business_date, product_code ORDER BY business_date, product_code
                """,
                (PLATFORM, SALES_SHOP, SALES_CHANNEL, earliest, latest, EXCLUDED_WAREHOUSE),
            )
            sales_freshness = fetch_all(
                connection,
                """
                SELECT min(business_date)::text AS date_min, max(business_date)::text AS date_max,
                       count(*)::bigint AS row_count,
                       count(DISTINCT business_date)::bigint AS day_count,
                       count(DISTINCT product_code)::bigint AS product_count
                FROM sales_order_lines
                WHERE platform=%s AND shop_name=%s AND channel=%s
                  AND is_business_row=true AND warehouse<>%s
                """,
                (PLATFORM, SALES_SHOP, SALES_CHANNEL, EXCLUDED_WAREHOUSE),
            )

    # Raw/aggregate reconciliation.  Every retained day must have full numeric
    # presence, a ready state, and identical typed sums across all projections.
    shop_by_day = {row["business_date"]: row for row in shop_daily}
    state_by_day = {row["business_date"]: row for row in state_rows}
    raw_by_day = {row["business_date"]: row for row in raw_controls}
    reconciliation = []
    for business_date in sorted(set(shop_by_day) | set(state_by_day) | set(raw_by_day)):
        shop = shop_by_day.get(business_date)
        state = state_by_day.get(business_date)
        raw = raw_by_day.get(business_date)
        matched = bool(
            shop and state and raw and state["ready"]
            and int(raw["row_count"]) == int(raw["complete_presence_rows"])
            and int(raw["row_count"]) == int(shop["source_row_count"]) == int(state["raw_row_count"])
            and int(raw["spend_cents"] or 0) == int(shop["spend_cents"] or 0)
            and int(raw["attributed_gmv_cents"] or 0) == int(shop["attributed_gmv_cents"] or 0)
            and int(raw["impressions"] or 0) == int(shop["impressions"] or 0)
            and int(raw["clicks"] or 0) == int(shop["clicks"] or 0)
            and int(raw["orders"] or 0) == int(shop["orders"] or 0)
        )
        reconciliation.append({"businessDate": business_date, "matched": matched})

    master_by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in master_rows:
        master_by_sku[str(row["sku_id"] or "")].append(row)
    result.update(
        promoDaily=promo_daily,
        shopDaily=shop_daily,
        skuDaily=sku_daily,
        identitySpend=identity_spend,
        planDaily=plan_daily,
        followOrderBreakdown=follow_order_breakdown,
        salesDaily=sales_daily,
        rootRows=root_rows,
        masterRows=master_rows,
        promotionBatches=batch_rows,
        latestMaster=latest_master[0] if latest_master else None,
        salesFreshness=sales_freshness[0] if sales_freshness else None,
    )
    result["quality"].update(
        reconciliation=reconciliation,
        ambiguousMasterSkuIds=sorted(sku for sku, rows in master_by_sku.items() if sku and len({r["erp_product_code"] for r in rows if r["erp_product_code"]}) > 1),
        emptyMasterSkuIds=sum(1 for row in master_rows if not str(row["sku_id"] or "").strip()),
    )
    return result


def analyze(extracted: dict[str, Any], windows: dict[str, dict[str, str]], as_of: date) -> dict[str, Any]:
    promo_by_sku = index_rows(extracted["promoDaily"], "product_id")
    commerce_by_sku = index_rows(extracted["skuDaily"], "sku_id")
    identity_spend_by_sku = index_rows(extracted["identitySpend"], "sku_id")
    follow_order_breakdown_by_sku = index_rows(extracted["followOrderBreakdown"], "follow_order_sku_id")
    sales_by_code = index_rows(extracted["salesDaily"], "product_code")
    master_by_sku = index_rows(extracted["masterRows"], "sku_id")
    promo_fields = ("spend_cents", "attributed_gmv_cents", "impressions", "clicks", "orders", "favorites", "cart_quantity")
    commerce_fields = ("transaction_amount_cents", "transaction_quantity", "transaction_customers", "visitors", "page_views")
    sales_fields = ("net_sales_cents", "cost_cents", "quantity", "reported_gross_profit_cents", "order_product_day_count")

    shop_promo: dict[str, dict[str, Any]] = {}
    shop_sales: dict[str, dict[str, Any]] = {}
    for key, window in windows.items():
        promo_values = sum_metrics(extracted["shopDaily"], window["start"], window["endExclusive"], promo_fields)
        sales_values = sum_metrics(extracted["salesDaily"], window["start"], window["endExclusive"], sales_fields)
        shop_promo[key] = metric_block(promo_values)
        shop_sales[key] = sales_block(sales_values, promo_values["spend_cents"])

    all_skus = sorted(set(promo_by_sku) | set(commerce_by_sku) | set(master_by_sku))
    erp_code_to_skus: dict[str, set[str]] = defaultdict(set)
    for sku_id, masters in master_by_sku.items():
        for item in masters:
            code = str(item.get("erp_product_code") or "").strip()
            if code:
                erp_code_to_skus[code].add(sku_id)
    sku_rows: list[dict[str, Any]] = []
    for sku_id in all_skus:
        if not sku_id:
            continue
        masters = master_by_sku.get(sku_id, [])
        product_codes = sorted({str(item["erp_product_code"]) for item in masters if str(item.get("erp_product_code") or "").strip()})
        shared_codes = sorted(code for code in product_codes if len(erp_code_to_skus.get(code, set())) > 1)
        mapping_status = "unmapped" if not product_codes else "ambiguous" if len(product_codes) > 1 else "shared_erp_code" if shared_codes else "matched"
        sales_rows = [row for code in product_codes for row in sales_by_code.get(code, [])] if mapping_status == "matched" else []
        master = masters[0] if masters else {}
        names = [str(row.get("product_name") or "").strip() for row in promo_by_sku.get(sku_id, []) + commerce_by_sku.get(sku_id, []) + masters]
        product_name = max((name for name in names if name), key=len, default="未提供商品名称")
        periods: dict[str, Any] = {}
        for key, window in windows.items():
            promo = metric_block(sum_metrics(promo_by_sku.get(sku_id, []), window["start"], window["endExclusive"], promo_fields))
            commerce = sum_metrics(commerce_by_sku.get(sku_id, []), window["start"], window["endExclusive"], commerce_fields)
            sales = sales_block(
                sum_metrics(sales_rows, window["start"], window["endExclusive"], sales_fields),
                promo["spend_cents"],
                available=mapping_status == "matched",
                spend_is_owned=False,
            )
            associated_spend = sum_metrics(
                identity_spend_by_sku.get(sku_id, []),
                window["start"], window["endExclusive"], ("spend_cents",),
            )["spend_cents"]
            periods[key] = {
                "promotion": promo,
                "commerce": commerce,
                "sales": sales,
                "explicitSkuAssociatedSpendCents": associated_spend,
            }
        sku_rows.append(
            {
                "skuId": sku_id,
                "productName": product_name,
                "productCodes": product_codes,
                "mappingStatus": mapping_status,
                "sharedErpCodes": shared_codes,
                "productStatus": master.get("product_status") or "",
                "category": master.get("category") or "",
                "inventoryQuantity": int(master.get("inventory_raw")) if str(master.get("inventory_raw") or "").strip().isdigit() else None,
                "inventorySourceValue": master.get("inventory_raw") or "",
                "priceCents": master.get("price_cents"),
                "promotedSkuBreakdown": {
                    "sameSkuSpendCents": sum(
                        int(item["spend_cents"] or 0)
                        for item in follow_order_breakdown_by_sku.get(sku_id, [])
                        if str(item.get("promoted_sku_id") or "") == sku_id
                    ),
                    "unassignedPoolSpendCents": sum(
                        int(item["spend_cents"] or 0)
                        for item in follow_order_breakdown_by_sku.get(sku_id, [])
                        if str(item.get("promoted_sku_id") or "") in {"-1", "（空）", ""}
                    ),
                    "otherPromotedSkuSpendCents": sum(
                        int(item["spend_cents"] or 0)
                        for item in follow_order_breakdown_by_sku.get(sku_id, [])
                        if str(item.get("promoted_sku_id") or "") not in {sku_id, "-1", "（空）", ""}
                    ),
                },
                "periods": periods,
            }
        )

    plan_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in extracted["planDaily"]:
        plan_key = str(item.get("plan_id") or "").strip() or f"name:{item.get('plan_name') or '（未提供计划）'}"
        plan_groups[plan_key].append(item)
    plan_rows: list[dict[str, Any]] = []
    for plan_key, rows in plan_groups.items():
        periods: dict[str, Any] = {}
        for key, window in windows.items():
            periods[key] = metric_block(
                sum_metrics(
                    rows, window["start"], window["endExclusive"],
                    ("spend_cents", "attributed_gmv_cents", "impressions", "clicks", "orders"),
                )
            )
        current_rows = [
            item for item in rows
            if windows["last30"]["start"] <= item["business_date"] < windows["last30"]["endExclusive"]
        ]
        plan_rows.append(
            {
                "planKey": plan_key,
                "planId": "" if plan_key.startswith("name:") else plan_key,
                "planName": max((str(item.get("plan_name") or "") for item in rows), key=len, default="（未提供计划）"),
                "promotedSkuIds": sorted({str(item.get("promoted_sku_id") or "") for item in current_rows if str(item.get("promoted_sku_id") or "").strip()}),
                "periods": periods,
            }
        )

    total_spend = shop_promo["last30"]["spend_cents"]
    store_roas = shop_promo["last30"]["roas"] or 0
    mtd_store_roas = shop_promo["mtd"]["roas"] or 0
    active_spends = [row["periods"]["last30"]["promotion"]["spend_cents"] for row in sku_rows if row["periods"]["last30"]["promotion"]["spend_cents"] > 0]
    meaningful_spends = [value for value in active_spends if value >= 10_000]
    median_spend = percentile(meaningful_spends or active_spends, 0.5)
    p75_spend = percentile(meaningful_spends or active_spends, 0.75)
    high_spend_threshold = max(10_000, total_spend * 0.01, p75_spend)
    minimum_action_spend = max(10_000, total_spend * 0.005)
    plan_high_spend_threshold = max(20_000, total_spend * 0.01)
    positive_sales_profit = [
        row["periods"]["last30"]["sales"]["gross_profit_cents"]
        for row in sku_rows
        if row["periods"]["last30"]["sales"]["gross_profit_cents"] is not None
        and row["periods"]["last30"]["sales"]["gross_profit_cents"] > 0
    ]
    commerce_sales = [
        row["periods"]["last30"]["commerce"]["transaction_amount_cents"]
        for row in sku_rows if row["periods"]["last30"]["commerce"]["transaction_amount_cents"] > 0
    ]
    profit_p75 = percentile(positive_sales_profit, 0.75)
    commerce_p75 = percentile(commerce_sales, 0.75)

    plan_actions: list[dict[str, Any]] = []
    plan_watch: list[dict[str, Any]] = []
    for row in plan_rows:
        cur = row["periods"]["last30"]
        prev = row["periods"]["previous30"]
        mtd = row["periods"]["mtd"]
        spend = cur["spend_cents"]
        roas = cur["roas"]
        reasons: list[str] = []
        score = 0
        if spend >= plan_high_spend_threshold:
            if cur["orders"] == 0 and cur["clicks"] >= 20:
                reasons.append("近30天有点击但无归因订单")
                score += 4
            if roas is not None and store_roas > 0 and roas < store_roas * 0.65:
                reasons.append("计划ROAS低于店铺近30天水平的65%")
                score += 3
            spend_growth = change(spend, prev["spend_cents"])
            gmv_growth = change(cur["attributed_gmv_cents"], prev["attributed_gmv_cents"])
            if spend_growth is not None and spend_growth >= 0.30 and (gmv_growth is None or gmv_growth <= 0):
                reasons.append("花费较前30天增加但归因成交未增长")
                score += 2
            if mtd["spend_cents"] >= minimum_action_spend and mtd["roas"] is not None and mtd_store_roas > 0 and mtd["roas"] < mtd_store_roas * 0.70:
                reasons.append("本月截至昨日仍显著弱于店铺")
                score += 1
        if not reasons:
            continue
        severity = "高" if score >= 6 else "中" if score >= 3 else "观察"
        target_roas = max(store_roas, 1.0)
        efficient_spend = cur["attributed_gmv_cents"] / target_roas if target_roas > 0 else spend
        theoretical_excess = max(0, spend - efficient_spend)
        max_cut_rate = 0.50 if severity == "高" else 0.30 if severity == "中" else 0.0
        suggested_cut = int(min(spend * max_cut_rate, max(spend * 0.15, theoretical_excess * 0.5))) if max_cut_rate else 0
        if cur["orders"] == 0 and cur["clicks"] >= 20:
            suggested_cut = int(spend * 0.50)
        enriched = {
            **{key: value for key, value in row.items() if key != "periods"},
            "severity": severity,
            "score": score,
            "reasons": reasons,
            "targetRoas": target_roas,
            "suggestedCutCents": suggested_cut,
            "current": cur,
            "previous": prev,
            "mtd": mtd,
        }
        (plan_watch if severity == "观察" else plan_actions).append(enriched)
    plan_actions.sort(key=lambda item: (-item["score"], -item["current"]["spend_cents"], item["planKey"]))
    plan_watch.sort(key=lambda item: (-item["score"], -item["current"]["spend_cents"], item["planKey"]))

    over_rows: list[dict[str, Any]] = []
    under_rows: list[dict[str, Any]] = []
    for row in sku_rows:
        cur = row["periods"]["last30"]
        prev = row["periods"]["previous30"]
        mtd = row["periods"]["mtd"]
        promo = cur["promotion"]
        sales = cur["sales"]
        spend = promo["spend_cents"]
        associated_spend = cur["explicitSkuAssociatedSpendCents"]
        roas = promo["roas"]
        break_even = sales["breakEvenRoas"]
        reasons: list[str] = []
        score = 0
        if spend >= high_spend_threshold:
            if promo["orders"] == 0 and promo["clicks"] >= 20:
                reasons.append("近30天有点击但无归因订单")
                score += 3
            if roas is not None and store_roas > 0 and roas < store_roas * 0.65:
                reasons.append("ROAS低于店铺近30天水平的65%")
                score += 2
            if roas is not None and break_even is not None and roas < break_even * 1.15:
                reasons.append("ROAS低于毛利盈亏平衡安全线")
                score += 3
            spend_growth = change(spend, prev["promotion"]["spend_cents"])
            gmv_growth = change(promo["attributed_gmv_cents"], prev["promotion"]["attributed_gmv_cents"])
            if spend_growth is not None and spend_growth >= 0.30 and (gmv_growth is None or gmv_growth <= 0):
                reasons.append("花费较前30天增加但归因成交未增长")
                score += 2
            mtd_roas = mtd["promotion"]["roas"]
            if mtd["promotion"]["spend_cents"] >= minimum_action_spend and mtd_roas is not None and mtd_store_roas > 0 and mtd_roas < mtd_store_roas * 0.70:
                reasons.append("本月截至昨日仍显著弱于店铺")
                score += 1
        if reasons:
            severity = "高" if score >= 6 else "中" if score >= 3 else "观察"
            target_roas = max(store_roas, (break_even or 0) * 1.15, 1.0)
            efficient_spend = promo["attributed_gmv_cents"] / target_roas if target_roas > 0 else spend
            theoretical_excess = max(0, spend - efficient_spend)
            over_rows.append(
                {
                    **{key: value for key, value in row.items() if key != "periods"},
                    "severity": severity,
                    "score": score,
                    "reasons": reasons,
                    "suggestedCutCents": 0,
                    "actionScope": "diagnostic_only_use_plan_actions",
                    "targetRoas": target_roas,
                    "current": cur,
                    "previous": prev,
                    "mtd": mtd,
                }
            )

        inventory_ok = row["inventoryQuantity"] is None or row["inventoryQuantity"] > 0
        status_ok = row["productStatus"] in {"", "上架"}
        profitable = sales["gross_profit_cents"] is not None and sales["gross_profit_cents"] > 0
        scale_reasons: list[str] = []
        headroom = 0
        if profitable and inventory_ok and status_ok:
            target = max(store_roas * 1.25, (break_even or 0) * 1.20, 1.0)
            if spend >= 5_000 and associated_spend <= max(median_spend, minimum_action_spend) and promo["orders"] >= 3 and roas is not None and roas >= target:
                scale_reasons.append("跟单SKU视角ROAS高于店铺及毛利安全线，明确SKU关联花费低于活跃SKU中位数")
                headroom = int(min(max(10_000, spend * 0.20), max(10_000, sales["gross_profit_cents"] * 0.10)))
            elif associated_spend == 0 and (
                sales["gross_profit_cents"] >= profit_p75 > 0
                or cur["commerce"]["transaction_amount_cents"] >= commerce_p75 > 0
            ):
                scale_reasons.append("近30天在跟单SKU、智能投放推广SKU、触发SKU三种明确身份中均未观察到花费，但平台成交或映射大毛利位于高位")
                headroom = int(min(50_000, max(10_000, sales["gross_profit_cents"] * 0.05)))
        if scale_reasons:
            if row["inventoryQuantity"] is None:
                scale_reasons.append("商品主数据仅提供分区库存，增投前需核对可售库存")
            under_rows.append(
                {
                    **{key: value for key, value in row.items() if key != "periods"},
                    "reasons": scale_reasons,
                    "suggestedIncreaseCapCents": headroom,
                    "targetRoas": max(store_roas * 1.25, (break_even or 0) * 1.20, 1.0),
                    "inventoryCheckRequired": row["inventoryQuantity"] is None,
                    "current": cur,
                    "previous": prev,
                    "mtd": mtd,
                }
            )

    over_rows.sort(key=lambda item: (-item["score"], -item["current"]["promotion"]["spend_cents"], item["skuId"]))
    watch_rows = [item for item in over_rows if item["severity"] == "观察"]
    over_rows = [item for item in over_rows if item["severity"] != "观察"]
    under_rows.sort(key=lambda item: (-item["current"]["sales"]["gross_profit_cents"], -(item["current"]["promotion"]["roas"] or 0), item["skuId"]))

    cut_pool = sum(item["suggestedCutCents"] for item in plan_actions)
    seven_day_release_scenario = round(cut_pool * 7 / 30)
    requested = sum(item["suggestedIncreaseCapCents"] for item in under_rows)
    realloc_pool = min(seven_day_release_scenario // 2, requested)
    for item in under_rows:
        if requested > 0:
            item["allocatedSevenDayTestCents"] = int(min(item["suggestedIncreaseCapCents"], realloc_pool * item["suggestedIncreaseCapCents"] / requested))
        else:
            item["allocatedSevenDayTestCents"] = 0
    allocation_remainder = realloc_pool - sum(item["allocatedSevenDayTestCents"] for item in under_rows)
    for item in under_rows:
        if allocation_remainder <= 0:
            break
        capacity = item["suggestedIncreaseCapCents"] - item["allocatedSevenDayTestCents"]
        addition = min(capacity, allocation_remainder)
        item["allocatedSevenDayTestCents"] += addition
        allocation_remainder -= addition
    realloc_pool = sum(item["allocatedSevenDayTestCents"] for item in under_rows)

    over_ids = {item["skuId"] for item in over_rows}
    cause_rows: list[dict[str, Any]] = []
    targets = {item["skuId"]: item["targetRoas"] for item in over_rows}
    for row in extracted["rootRows"]:
        sku_id = str(row["sku_id"] or "")
        if sku_id not in over_ids:
            continue
        spend = int(row["spend_cents"] or 0)
        gmv = int(row["attributed_gmv_cents"] or 0)
        roas = ratio(gmv, spend)
        target = targets[sku_id]
        avoidable = max(0, spend - int(gmv / target)) if target > 0 else spend
        if spend >= 5_000 and (gmv == 0 or (roas is not None and roas < target)):
            cause_rows.append(
                {
                    "dimension": row["dimension"],
                    "skuId": sku_id,
                    "item": row["item"],
                    "planName": row["plan_name"],
                    "spendCents": spend,
                    "attributedGmvCents": gmv,
                    "impressions": int(row["impressions"] or 0),
                    "clicks": int(row["clicks"] or 0),
                    "orders": int(row["orders"] or 0),
                    "roas": roas,
                    "targetRoas": target,
                    "targetRoasGapSpendCents": avoidable,
                    "note": "按目标ROAS试算差额；不同维度为同一事实的替代视角，不可跨维度相加，也不代表已证可节省金额",
                }
            )
    cause_rows.sort(key=lambda item: (-item["targetRoasGapSpendCents"], -item["spendCents"], item["skuId"]))
    per_pair: dict[tuple[str, str], int] = defaultdict(int)
    filtered_causes = []
    for item in cause_rows:
        key = (item["skuId"], item["dimension"])
        if per_pair[key] < 5:
            filtered_causes.append(item)
            per_pair[key] += 1

    current_dates = dates_between(date.fromisoformat(windows["last30"]["start"]), date.fromisoformat(windows["last30"]["endExclusive"]))
    daily = []
    shop_daily_by_date = {row["business_date"]: row for row in extracted["shopDaily"]}
    spends = [int(shop_daily_by_date[day]["spend_cents"] or 0) for day in current_dates if day in shop_daily_by_date]
    daily_roases = [ratio(int(shop_daily_by_date[day]["attributed_gmv_cents"] or 0), int(shop_daily_by_date[day]["spend_cents"] or 0)) for day in current_dates if day in shop_daily_by_date]
    median_daily_spend = statistics.median(spends) if spends else 0
    spend_mad = statistics.median(abs(value - median_daily_spend) for value in spends) if spends else 0
    valid_roases = [value for value in daily_roases if value is not None]
    median_daily_roas = statistics.median(valid_roases) if valid_roases else None
    anomaly_rows = []
    for day in current_dates:
        source = shop_daily_by_date.get(day)
        if not source:
            daily.append({"businessDate": day, "missing": True})
            continue
        item = metric_block(
            {
                "spend_cents": int(source["spend_cents"] or 0),
                "attributed_gmv_cents": int(source["attributed_gmv_cents"] or 0),
                "impressions": int(source["impressions"] or 0),
                "clicks": int(source["clicks"] or 0),
                "orders": int(source["orders"] or 0),
                "favorites": int(source["favorites"] or 0),
                "cart_quantity": int(source["cart_quantity"] or 0),
            }
        )
        record = {"businessDate": day, "missing": False, **item}
        daily.append(record)
        high_spend = item["spend_cents"] > median_daily_spend + 3 * spend_mad if spend_mad > 0 else item["spend_cents"] > median_daily_spend * 1.5
        weak_return = median_daily_roas is not None and item["roas"] is not None and item["roas"] < median_daily_roas * 0.70
        if high_spend and weak_return:
            anomaly_rows.append({**record, "reason": "花费显著高于近30天日中位数，同时ROAS低于日中位数70%"})

    expected = set(current_dates)
    actual = set(shop_daily_by_date)
    reconciled = {row["businessDate"]: row["matched"] for row in extracted["quality"]["reconciliation"]}
    quality = {
        "promotionDataThrough": max(actual) if actual else None,
        "salesDataThrough": extracted["salesFreshness"]["date_max"] if extracted["salesFreshness"] else None,
        "expectedLast30Days": len(expected),
        "coveredLast30Days": len(expected & actual),
        "missingLast30Dates": sorted(expected - actual),
        "unreconciledLast30Dates": sorted(day for day in expected if not reconciled.get(day, False)),
        "promotionBatchWarnings": sum(int(row["warning_count"] or 0) for row in extracted["promotionBatches"]),
        "attributionMaturity": "unverified",
        "attributionMaturityReason": "当前导入批次仅证明业务日后的单次快照，未观察到同一业务日按平台归因窗口回溯重导的证据",
        "singleDayPromotionBatchCount": sum(1 for row in extracted["promotionBatches"] if row.get("date_min") and row.get("date_min") == row.get("date_max")),
        "latestProductMaster": extracted["latestMaster"],
        "ambiguousMasterSkuIds": extracted["quality"]["ambiguousMasterSkuIds"],
        "sharedErpCodeSkuCount": sum(1 for row in sku_rows if row["mappingStatus"] == "shared_erp_code"),
        "readOnlyRoles": extracted["readOnly"],
        "source": "本机PostgreSQL最小只读角色（运营MCP不可用时的授权替代来源）",
    }

    shop_summary = {}
    for key in windows:
        shop_summary[key] = {
            "promotion": shop_promo[key],
            "sales": shop_sales[key],
        }
    shop_summary["comparisons"] = {
        "last30VsPrevious30": {
            "spendChange": change(shop_promo["last30"]["spend_cents"], shop_promo["previous30"]["spend_cents"]),
            "attributedGmvChange": change(shop_promo["last30"]["attributed_gmv_cents"], shop_promo["previous30"]["attributed_gmv_cents"]),
            "roasChange": change(shop_promo["last30"]["roas"], shop_promo["previous30"]["roas"]),
            "netSalesChange": change(shop_sales["last30"]["net_sales_cents"], shop_sales["previous30"]["net_sales_cents"]),
            "afterAdGrossProfitChange": change(shop_sales["last30"]["after_ad_gross_profit_cents"], shop_sales["previous30"]["after_ad_gross_profit_cents"]),
        },
        "mtdVsPriorMtd": {
            "spendChange": change(shop_promo["mtd"]["spend_cents"], shop_promo["priorMtd"]["spend_cents"]),
            "attributedGmvChange": change(shop_promo["mtd"]["attributed_gmv_cents"], shop_promo["priorMtd"]["attributed_gmv_cents"]),
            "roasChange": change(shop_promo["mtd"]["roas"], shop_promo["priorMtd"]["roas"]),
            "netSalesChange": change(shop_sales["mtd"]["net_sales_cents"], shop_sales["priorMtd"]["net_sales_cents"]),
            "afterAdGrossProfitChange": change(shop_sales["mtd"]["after_ad_gross_profit_cents"], shop_sales["priorMtd"]["after_ad_gross_profit_cents"]),
        },
    }

    for row in sku_rows:
        spend = row["periods"]["last30"]["promotion"]["spend_cents"]
        gmv = row["periods"]["last30"]["promotion"]["attributed_gmv_cents"]
        row["spendShare"] = ratio(spend, total_spend)
        row["gmvShare"] = ratio(gmv, shop_promo["last30"]["attributed_gmv_cents"])
        row["spendChange"] = change(spend, row["periods"]["previous30"]["promotion"]["spend_cents"])
        row["gmvChange"] = change(gmv, row["periods"]["previous30"]["promotion"]["attributed_gmv_cents"])
        row["mtdRoasChange"] = change(row["periods"]["mtd"]["promotion"]["roas"], row["periods"]["priorMtd"]["promotion"]["roas"])

    return {
        "schemaVersion": "jd-zhigao-promotion-diagnosis-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "businessTimezone": "Asia/Shanghai",
        "asOfDate": iso(as_of),
        "scope": {
            "platform": PLATFORM,
            "promotionShopName": PROMOTION_SHOP,
            "salesShopName": SALES_SHOP,
            "salesChannel": SALES_CHANNEL,
            "excludedWarehouse": EXCLUDED_WAREHOUSE,
        },
        "windows": windows,
        "quality": quality,
        "shopSummary": shop_summary,
        "thresholds": {
            "highSpendCents": int(high_spend_threshold),
            "planHighSpendCents": int(plan_high_spend_threshold),
            "minimumActionSpendCents": int(minimum_action_spend),
            "activeSkuMedianSpendCents": int(median_spend),
            "activeSkuP75SpendCents": int(p75_spend),
            "storeRoas": store_roas,
            "mtdStoreRoas": mtd_store_roas,
            "rules": [
                "跟单SKU高花费门槛=max(¥100、店铺花费1%、近30天花费≥¥100的活跃跟单SKU花费P75)",
                "计划审计门槛=max(¥200、店铺花费1%)；计划只在归因成熟度回查后才允许执行条件性下调",
                "跟单SKU只用于发现异常归因终点：需达到高花费门槛，并出现低于店铺ROAS、低于毛利安全线、无订单高点击、花费增而成交不增或本月继续恶化之一；不得直接把跟单SKU当独立投放单元",
                "低投候选仅在商品上架、库存未明确为0、唯一映射大毛利为正时进入；分区库存无法量化的SKU须在增投前核对可售库存，且跟单SKU、智能投放推广SKU、触发SKU三种明确身份的关联花费均为0或低位",
                "盈亏平衡ROAS=1/映射销售大毛利率；推广归因窗口未知，因此只作方向性安全线，不解释广告增量利润",
            ],
        },
        "budgetPlan": {
            "conditionalThirtyDayCutScenarioCents": cut_pool,
            "sevenDayEquivalentReleaseScenarioCents": seven_day_release_scenario,
            "sevenDayReallocationPoolCents": realloc_pool,
            "reserveCents": seven_day_release_scenario - realloc_pool,
            "principle": "计划清单仅为归因成熟度回查后的条件性情景。30天历史收回量先折算为7天等速释放量，其中50%可用于小步试投，50%保留；未确认成熟归因前不承诺或执行预算收回。",
        },
        "planActions": plan_actions,
        "planWatch": plan_watch,
        "planAnalysis": plan_rows,
        "inefficientFollowOrderSkus": over_rows,
        "watchFollowOrderSkus": watch_rows,
        "underSpendSkus": under_rows,
        "skuAnalysis": sku_rows,
        "rootCauses": filtered_causes,
        "daily": daily,
        "dailyAnomalies": anomaly_rows,
        "limitations": [
            "京准通总订单金额属于平台归因口径，归因窗口未知；ROAS不能直接解释利润或广告增量。",
            "当前导入未提供同一业务日的成熟归因回溯重导证据；所有控费、止损和放量均为回查平台成熟归因后的条件动作。",
            "SKU主视图为跟单SKU归因视角，行内花费不是该SKU的独立投放预算；控费必须沿同一原始事实下钻到计划、关键词或搜索词执行。",
            "SKU利润使用商品主数据中的商家SKU受控映射到ERP货品编码，再按销售净额减货品成本计算大毛利；映射缺失、一个京东SKU对应多个商家SKU，或多个京东SKU共用同一商家SKU时不作SKU利润判断。",
            "本报告不含平台实时预算、出价、库存锁定、竞价环境和投放时段配置；调整建议需在京准通后台按计划/单元核对后执行。",
            "关键词、搜索词和计划是同一推广事实的替代视图，不得跨维度相加。",
        ],
    }


def write_csv(path: Path, rows: list[dict[str, Any]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def flatten_skus(report: dict[str, Any]) -> list[dict[str, Any]]:
    over = {row["skuId"]: row for row in report["inefficientFollowOrderSkus"]}
    watch = {row["skuId"]: row for row in report["watchFollowOrderSkus"]}
    under = {row["skuId"]: row for row in report["underSpendSkus"]}
    rows = []
    for item in report["skuAnalysis"]:
        current = item["periods"]["last30"]
        mtd = item["periods"]["mtd"]
        action = "归因异常" if item["skuId"] in over else "归因观察" if item["skuId"] in watch else "试投候选" if item["skuId"] in under else "保持/观察"
        recommendation = over.get(item["skuId"]) or watch.get(item["skuId"]) or under.get(item["skuId"]) or {}
        rows.append(
            {
                "action": action,
                "skuId": item["skuId"],
                "productName": item["productName"],
                "productCodes": ", ".join(item["productCodes"]),
                "mappingStatus": item["mappingStatus"],
                "productStatus": item["productStatus"],
                "inventoryQuantity": item["inventoryQuantity"],
                "inventorySourceValue": item["inventorySourceValue"],
                "spendCents": current["promotion"]["spend_cents"],
                "attributedGmvCents": current["promotion"]["attributed_gmv_cents"],
                "roas": current["promotion"]["roas"],
                "clicks": current["promotion"]["clicks"],
                "orders": current["promotion"]["orders"],
                "cpcCents": current["promotion"]["cpcCents"],
                "cvr": current["promotion"]["cvr"],
                "netSalesCents": current["sales"]["net_sales_cents"],
                "grossProfitCents": current["sales"]["gross_profit_cents"],
                "grossMargin": current["sales"]["gross_margin"],
                "afterAdGrossProfitCents": current["sales"]["after_ad_gross_profit_cents"],
                "breakEvenRoas": current["sales"]["breakEvenRoas"],
                "mtdSpendCents": mtd["promotion"]["spend_cents"],
                "explicitSkuAssociatedSpendCents": current["explicitSkuAssociatedSpendCents"],
                "samePromotedSkuSpendCents": item["promotedSkuBreakdown"]["sameSkuSpendCents"],
                "unassignedPromotedPoolSpendCents": item["promotedSkuBreakdown"]["unassignedPoolSpendCents"],
                "mtdRoas": mtd["promotion"]["roas"],
                "suggestedCutCents": 0,
                "suggestedIncreaseCapCents": recommendation.get("suggestedIncreaseCapCents", 0),
                "allocatedSevenDayTestCents": recommendation.get("allocatedSevenDayTestCents", 0),
                "reasons": "；".join(recommendation.get("reasons", [])),
            }
        )
    rows.sort(key=lambda row: ({"归因异常": 0, "归因观察": 1, "试投候选": 2, "保持/观察": 3}[row["action"]], -row["spendCents"], row["skuId"]))
    return rows


def html_report(report: dict[str, Any], sku_rows: list[dict[str, Any]]) -> str:
    summary = report["shopSummary"]
    last30 = summary["last30"]
    mtd = summary["mtd"]
    comp30 = summary["comparisons"]["last30VsPrevious30"]
    compm = summary["comparisons"]["mtdVsPriorMtd"]
    quality = report["quality"]
    critical = [
        "归因成熟度未验证：下列控费与试投均为在京准通后台核对成熟归因后的条件动作，本报告不直接执行预算调整。",
    ]
    if report["planActions"]:
        critical.append(
            f"识别出 {len(report['planActions'])} 个计划审计候选；条件性30天收回情景为 {money(report['budgetPlan']['conditionalThirtyDayCutScenarioCents'])}，折算7天等速释放情景为 {money(report['budgetPlan']['sevenDayEquivalentReleaseScenarioCents'])}。"
        )
    if report["inefficientFollowOrderSkus"]:
        critical.append(f"识别出 {len(report['inefficientFollowOrderSkus'])} 个跟单SKU异常归因终点；它们只用于定位计划和词，不是独立预算单元。")
    if report["underSpendSkus"]:
        critical.append(f"识别出 {len(report['underSpendSkus'])} 个零明确关联花费的试投候选；成熟归因和库存核对后，7天试投池情景上限为 {money(report['budgetPlan']['sevenDayReallocationPoolCents'])}。")
    if quality["missingLast30Dates"] or quality["unreconciledLast30Dates"]:
        critical.append("数据覆盖或对账存在缺口，动作建议应暂停。")
    else:
        critical.append("近30天推广逐日覆盖完整，原始行、聚合表和数值存在性检查全部对账。")

    payload = json.dumps({"daily": report["daily"], "skus": sku_rows}, ensure_ascii=False).replace("</", "<\\/")
    def tr(values: list[str], cls: str = "") -> str:
        return f'<tr class="{cls}">' + "".join(f"<td>{value}</td>" for value in values) + "</tr>"

    plan_html = "".join(
        tr([
            html.escape(item["planId"] or "—"),
            html.escape(item["planName"][:36]),
            html.escape("、".join(item["promotedSkuIds"][:4]) or "（空）"),
            money(item["current"]["spend_cents"]),
            money(item["current"]["attributed_gmv_cents"]),
            multiple(item["current"]["roas"]),
            money(item["suggestedCutCents"]),
            html.escape("；".join(item["reasons"])),
        ], "risk-high" if item["severity"] == "高" else "risk-mid") for item in report["planActions"][:30]
    ) or tr(["—", "未识别到达到条件门槛的计划", "—", "—", "—", "—", "—", "—"])
    control_rows = report["inefficientFollowOrderSkus"] + report["watchFollowOrderSkus"]
    over_html = "".join(
        tr([
            html.escape(item["skuId"]),
            html.escape(item["productName"][:42]),
            money(item["current"]["promotion"]["spend_cents"]),
            money(item["promotedSkuBreakdown"]["sameSkuSpendCents"]),
            money(item["promotedSkuBreakdown"]["unassignedPoolSpendCents"]),
            multiple(item["current"]["promotion"]["roas"]),
            multiple(item["current"]["sales"]["breakEvenRoas"]),
            html.escape("；".join(item["reasons"])),
        ], "risk-high" if item["severity"] == "高" else "risk-mid") for item in control_rows[:20]
    ) or tr(["—", "未识别到满足规则的跟单SKU异常", "—", "—", "—", "—", "—", "—"])
    under_html = "".join(
        tr([
            html.escape(item["skuId"]),
            html.escape(item["productName"][:42]),
            money(item["current"]["explicitSkuAssociatedSpendCents"]),
            multiple(item["current"]["promotion"]["roas"]),
            money(item["current"]["sales"]["gross_profit_cents"]),
            str(item["inventoryQuantity"]) if item["inventoryQuantity"] is not None else html.escape(item["inventorySourceValue"] or "待核对"),
            money(item["allocatedSevenDayTestCents"]),
            html.escape("；".join(item["reasons"])),
        ], "scale") for item in report["underSpendSkus"][:20]
    ) or tr(["—", "未识别到满足规则的增投SKU", "—", "—", "—", "—", "—", "—"])
    causes_html = "".join(
        tr([
            "关键词" if item["dimension"] == "keyword" else "搜索词",
            html.escape(item["skuId"]),
            html.escape(item["item"][:32]),
            html.escape(item["planName"][:28]),
            money(item["spendCents"]),
            money(item["attributedGmvCents"]),
            multiple(item["roas"]),
            money(item["targetRoasGapSpendCents"]),
        ]) for item in report["rootCauses"][:40]
    ) or tr(["—", "—", "暂无达到门槛的浪费根因", "—", "—", "—", "—", "—"])
    anomalies_html = "".join(
        tr([item["businessDate"], money(item["spend_cents"]), money(item["attributed_gmv_cents"]), multiple(item["roas"]), html.escape(item["reason"])])
        for item in report["dailyAnomalies"]
    ) or tr(["—", "—", "—", "—", "未发现同时满足高花费与低ROAS的异常日"])
    limitation_html = "".join(f"<li>{html.escape(item)}</li>" for item in report["limitations"])
    rules_html = "".join(f"<li>{html.escape(item)}</li>" for item in report["thresholds"]["rules"])
    critical_html = "".join(f"<li>{html.escape(item)}</li>" for item in critical)

    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>京东-志高商用设备旗舰店推广深度诊断</title>
<style>
:root{{--ink:#18212f;--muted:#607087;--line:#dbe3ec;--navy:#17324d;--blue:#2d6cdf;--soft:#f5f8fb;--red:#b42318;--redbg:#fff0ee;--amber:#9a6700;--amberbg:#fff8e6;--green:#157347;--greenbg:#edf8f2}}
*{{box-sizing:border-box}}body{{margin:0;background:#eef3f7;color:var(--ink);font:14px/1.55 Arial,"Microsoft YaHei",sans-serif}}main{{max-width:1420px;margin:0 auto;padding:28px}}header{{background:var(--navy);color:#fff;padding:28px 32px;border-radius:14px}}h1{{font-size:26px;margin:0 0 8px}}h2{{font-size:19px;margin:0 0 14px}}h3{{font-size:15px;margin:0 0 10px}}.scope{{color:#d6e4f0}}.grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}}.card,.panel{{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 3px 10px #1b2b3a0a}}.card{{padding:15px 16px}}.card .label{{color:var(--muted);font-size:12px}}.card .value{{font-size:23px;font-weight:700;margin:3px 0}}.card .delta{{font-size:12px;color:var(--muted)}}.panel{{padding:20px;margin:16px 0}}.callout{{border-left:5px solid var(--blue);background:#f3f7ff}}ul{{margin:8px 0;padding-left:22px}}table{{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}}th{{position:sticky;top:0;background:var(--navy);color:#fff;text-align:center;padding:9px 7px;border-right:1px solid #ffffff40}}td{{padding:8px 7px;border-bottom:1px solid var(--line);vertical-align:top}}tbody tr:hover{{background:#f7faff}}.table-wrap{{overflow:auto;max-height:620px;border:1px solid var(--line);border-radius:9px}}.risk-high{{background:var(--redbg)}}.risk-mid{{background:var(--amberbg)}}.scale{{background:var(--greenbg)}}.two{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}canvas{{width:100%;height:280px;border:1px solid var(--line);border-radius:8px}}.controls{{display:flex;gap:8px;align-items:center;margin-bottom:10px}}input,select{{border:1px solid var(--line);border-radius:7px;padding:7px 9px}}.note{{font-size:12px;color:var(--muted)}}.status-good{{color:var(--green);font-weight:700}}.status-bad{{color:var(--red);font-weight:700}}@media(max-width:900px){{.grid{{grid-template-columns:1fr 1fr}}.two{{grid-template-columns:1fr}}main{{padding:12px}}}}
</style></head><body><main>
<header><h1>京东-志高商用设备旗舰店推广深度诊断</h1><div class="scope">数据截至 {report['asOfDate']} · 近30天 {report['windows']['last30']['label']} · 本自然月 {report['windows']['mtd']['label']} · 金额单位人民币元</div></header>
<section class="panel callout"><h2>结论与动作</h2><ul>{critical_html}</ul><p><strong>预算动作：</strong>{html.escape(report['budgetPlan']['principle'])}</p></section>
<section><div class="grid">
<div class="card"><div class="label">近30天推广花费</div><div class="value">{money(last30['promotion']['spend_cents'])}</div><div class="delta">较前30天 {pct(comp30['spendChange'])}</div></div>
<div class="card"><div class="label">近30天归因成交</div><div class="value">{money(last30['promotion']['attributed_gmv_cents'])}</div><div class="delta">较前30天 {pct(comp30['attributedGmvChange'])}</div></div>
<div class="card"><div class="label">近30天ROAS</div><div class="value">{multiple(last30['promotion']['roas'])}</div><div class="delta">较前30天 {pct(comp30['roasChange'])}</div></div>
<div class="card"><div class="label">近30天广告后大毛利</div><div class="value">{money(last30['sales']['after_ad_gross_profit_cents'])}</div><div class="delta">较前30天 {pct(comp30['afterAdGrossProfitChange'])}</div></div>
<div class="card"><div class="label">本月推广花费</div><div class="value">{money(mtd['promotion']['spend_cents'])}</div><div class="delta">较上月同期 {pct(compm['spendChange'])}</div></div>
<div class="card"><div class="label">本月归因成交</div><div class="value">{money(mtd['promotion']['attributed_gmv_cents'])}</div><div class="delta">较上月同期 {pct(compm['attributedGmvChange'])}</div></div>
<div class="card"><div class="label">本月ROAS</div><div class="value">{multiple(mtd['promotion']['roas'])}</div><div class="delta">较上月同期 {pct(compm['roasChange'])}</div></div>
<div class="card"><div class="label">本月广告后大毛利</div><div class="value">{money(mtd['sales']['after_ad_gross_profit_cents'])}</div><div class="delta">较上月同期 {pct(compm['afterAdGrossProfitChange'])}</div></div>
</div></section>
<section class="panel"><h2>近30天每日花费与ROAS</h2><canvas id="dailyChart" width="1200" height="300"></canvas><p class="note">柱形为推广花费，折线为ROAS；不同量纲使用左右轴。</p></section>
<section class="panel"><h2>计划审计与条件性控费清单</h2><p class="note">归因成熟度未验证。先在京准通后台按计划ID核对成熟归因、预算和出价；表中金额是条件性情景，不是已确认可释放预算。</p><div class="table-wrap"><table><thead><tr><th>计划ID</th><th>计划</th><th>推广SKU池</th><th>近30天花费</th><th>归因成交</th><th>ROAS</th><th>条件性30天收回情景</th><th>入选依据</th></tr></thead><tbody>{plan_html}</tbody></table></div></section>
<section class="panel"><h2>跟单SKU归因异常终点</h2><p class="note">行内簇花费不是该SKU的独立投放预算；其中“-1/空池”无法直接按SKU控制。此表只用于定位上方计划和下方关键词/搜索词。</p><div class="table-wrap"><table><thead><tr><th>跟单SKU</th><th>商品</th><th>簇花费</th><th>同号推广SKU花费</th><th>-1/空池归集</th><th>ROAS</th><th>盈亏平衡ROAS</th><th>异常依据</th></tr></thead><tbody>{over_html}</tbody></table></div></section>
<section class="panel"><h2>未观察到明确SKU关联花费的试投候选</h2><div class="table-wrap"><table><thead><tr><th>SKU</th><th>商品</th><th>明确SKU关联花费</th><th>跟单视角ROAS</th><th>映射大毛利</th><th>库存</th><th>7天试投</th><th>入选依据</th></tr></thead><tbody>{under_html}</tbody></table></div></section>
<section class="panel"><h2>全量SKU检索</h2><div class="controls"><input id="skuSearch" placeholder="搜索SKU或商品"><select id="actionFilter"><option value="">全部动作</option><option>归因异常</option><option>归因观察</option><option>试投候选</option><option>保持/观察</option></select><span id="skuCount" class="note"></span></div><div class="table-wrap"><table><thead><tr><th>状态</th><th>SKU</th><th>商品</th><th>跟单簇花费</th><th>明确SKU关联花费</th><th>归因成交</th><th>ROAS</th><th>点击</th><th>订单行</th><th>净销售额</th><th>大毛利</th><th>大毛利减推广费</th><th>库存</th></tr></thead><tbody id="skuBody"></tbody></table></div></section>
<section class="two"><div class="panel"><h2>低效词与计划定位</h2><div class="table-wrap"><table><thead><tr><th>维度</th><th>跟单SKU</th><th>词</th><th>计划</th><th>花费</th><th>归因成交</th><th>ROAS</th><th>按目标ROAS试算差额</th></tr></thead><tbody>{causes_html}</tbody></table></div><p class="note">试算差额不是已证可节省金额；关键词与搜索词为同一事实的替代视图，不可相加。</p></div>
<div class="panel"><h2>每日异常</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>花费</th><th>归因成交</th><th>ROAS</th><th>原因</th></tr></thead><tbody>{anomalies_html}</tbody></table></div></div></section>
<section class="panel"><h2>数据质量与口径</h2><p>来源：{html.escape(quality['source'])}</p><p>推广截止：{quality['promotionDataThrough']}；销售截止：{quality['salesDataThrough']}；近30天覆盖：{quality['coveredLast30Days']}/{quality['expectedLast30Days']}天；未对账日期：{', '.join(quality['unreconciledLast30Dates']) or '无'}；归因成熟度：未验证。</p><h3>判定规则</h3><ul>{rules_html}</ul><h3>限制</h3><ul>{limitation_html}</ul></section>
<script type="application/json" id="reportData">{payload}</script><script>
const report=JSON.parse(document.getElementById('reportData').textContent);const yuan=v=>v==null?'—':'¥'+(v/100).toLocaleString('zh-CN',{{minimumFractionDigits:2,maximumFractionDigits:2}});const mult=v=>v==null?'—':Number(v).toFixed(2);
function draw(){{const c=document.getElementById('dailyChart'),x=c.getContext('2d'),d=report.daily.filter(v=>!v.missing);x.clearRect(0,0,c.width,c.height);const pad={{l:58,r:52,t:22,b:42}},w=c.width-pad.l-pad.r,h=c.height-pad.t-pad.b,maxS=Math.max(...d.map(v=>v.spend_cents),1),maxR=Math.max(...d.map(v=>v.roas||0),1);x.strokeStyle='#dbe3ec';x.beginPath();x.moveTo(pad.l,pad.t);x.lineTo(pad.l,pad.t+h);x.lineTo(pad.l+w,pad.t+h);x.stroke();const bw=w/d.length*.62;d.forEach((v,i)=>{{const px=pad.l+(i+.5)*w/d.length,bar=h*v.spend_cents/maxS;x.fillStyle='#9fc2ef';x.fillRect(px-bw/2,pad.t+h-bar,bw,bar)}});x.strokeStyle='#b42318';x.lineWidth=2;x.beginPath();d.forEach((v,i)=>{{const px=pad.l+(i+.5)*w/d.length,py=pad.t+h-h*(v.roas||0)/maxR;i?x.lineTo(px,py):x.moveTo(px,py)}});x.stroke();x.fillStyle='#607087';x.font='12px Arial';x.fillText('花费 '+yuan(maxS),6,pad.t+5);x.fillText('ROAS '+maxR.toFixed(1),c.width-pad.r+4,pad.t+5);d.forEach((v,i)=>{{if(i%5===0||i===d.length-1){{x.save();x.translate(pad.l+(i+.5)*w/d.length,pad.t+h+16);x.rotate(-.45);x.fillText(v.businessDate.slice(5),0,0);x.restore()}}}})}}
function renderSkus(){{const q=document.getElementById('skuSearch').value.trim().toLowerCase(),a=document.getElementById('actionFilter').value;const rows=report.skus.filter(v=>(!a||v.action===a)&&(!q||(v.skuId+' '+v.productName).toLowerCase().includes(q)));document.getElementById('skuCount').textContent=rows.length+' 条';document.getElementById('skuBody').innerHTML=rows.map(v=>`<tr class="${{v.action==='归因异常'?'risk-mid':v.action==='试投候选'?'scale':''}}"><td>${{v.action}}</td><td>${{v.skuId}}</td><td>${{v.productName.slice(0,46)}}</td><td>${{yuan(v.spendCents)}}</td><td>${{yuan(v.explicitSkuAssociatedSpendCents)}}</td><td>${{yuan(v.attributedGmvCents)}}</td><td>${{mult(v.roas)}}</td><td>${{v.clicks}}</td><td>${{v.orders}}</td><td>${{yuan(v.netSalesCents)}}</td><td>${{yuan(v.grossProfitCents)}}</td><td>${{yuan(v.afterAdGrossProfitCents)}}</td><td>${{v.inventorySourceValue||v.inventoryQuantity||'—'}}</td></tr>`).join('')}}
document.getElementById('skuSearch').addEventListener('input',renderSkus);document.getElementById('actionFilter').addEventListener('change',renderSkus);draw();renderSkus();
</script></main></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", default="2026-10-16", help="Inclusive business date, YYYY-MM-DD")
    parser.add_argument("--output-dir", required=True)
    arguments = parser.parse_args()
    as_of = date.fromisoformat(arguments.as_of)
    output_dir = Path(arguments.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    netshop_dsn = os.environ.get("TERUISI_NETSHOP_RO_DSN", "")
    bi_dsn = os.environ.get("TERUISI_BI_RO_DSN", "")
    if not netshop_dsn or not bi_dsn:
        raise RuntimeError("Read-only DSNs are required in the process environment")
    windows = make_windows(as_of)
    extracted = extract(netshop_dsn, bi_dsn, windows)
    report = analyze(extracted, windows, as_of)
    sku_rows = flatten_skus(report)
    json_path = output_dir / "analysis.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    write_csv(output_dir / "sku_analysis.csv", sku_rows, list(sku_rows[0]) if sku_rows else ["action", "skuId"])
    daily_rows = report["daily"]
    write_csv(output_dir / "daily.csv", daily_rows, list(daily_rows[0]) if daily_rows else ["businessDate"])
    causes = report["rootCauses"]
    write_csv(output_dir / "root_causes.csv", causes, list(causes[0]) if causes else ["dimension", "skuId"])
    html_path = output_dir / "京东-志高商用设备旗舰店-推广深度诊断-20261017.html"
    html_path.write_text(html_report(report, sku_rows), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "ok",
                "readOnly": True,
                "json": str(json_path),
                "html": str(html_path),
                "promotionDataThrough": report["quality"]["promotionDataThrough"],
                "salesDataThrough": report["quality"]["salesDataThrough"],
                "coveredDays": report["quality"]["coveredLast30Days"],
                "unreconciledDays": report["quality"]["unreconciledLast30Dates"],
                "planAuditCandidateCount": len(report["planActions"]),
                "inefficientFollowOrderSkuCount": len(report["inefficientFollowOrderSkus"]),
                "underSpendSkuCount": len(report["underSpendSkus"]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
