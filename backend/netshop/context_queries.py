"""Exact indexed metadata reads; no date/member truncation or new facts."""
from django.db import connection
from django.db.models import Max, Value, CharField
from django.db.models.functions import Greatest

from .models import NetshopRow


def discover_shop_names(platform, limit):
    if connection.vendor != "postgresql":
        return list(NetshopRow.objects.filter(platform=platform).exclude(shop_name="")
                    .values_list("shop_name", flat=True).distinct().order_by("shop_name")[:limit])
    # The existing shop-leading index can skip duplicate names. The recursive
    # step keeps the same platform, nonempty predicate and database collation.
    sql = """
      WITH RECURSIVE discovered(shop_name, ordinal) AS (
        (SELECT shop_name, 1 FROM netshop_rows
         WHERE platform = %s AND shop_name <> %s
         ORDER BY shop_name LIMIT 1)
        UNION ALL
        SELECT following.shop_name, previous.ordinal + 1
        FROM discovered previous CROSS JOIN LATERAL (
          SELECT shop_name FROM netshop_rows
          WHERE platform = %s AND shop_name <> %s
            AND shop_name > previous.shop_name
          ORDER BY shop_name LIMIT 1
        ) following WHERE previous.ordinal < %s
      ) SELECT shop_name FROM discovered ORDER BY shop_name
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [platform, "", platform, "", limit])
        return [row[0] for row in cursor.fetchall()]


def source_latest_date(base, platform, names, source, dataset):
    if not names:
        return None
    if connection.vendor != "postgresql":
        return base.aggregate(day=Max("business_date"))["day"]
    values = ",".join(["(%s::text)"] * len(names))
    sql = """
      WITH shop_scope(shop_name) AS (VALUES {values}), prefix_meta AS (
        SELECT s.shop_name, q.physical_count, q.complete_max
        FROM shop_scope s CROSS JOIN LATERAL (
          SELECT COUNT(*) AS physical_count,
            MAX(p.business_date) FILTER (WHERE EXISTS (
              SELECT 1 FROM netshop_import_batches b
              WHERE b.id = p.last_import_batch_id
                AND b.status = %s AND b.platform = %s
            )) AS complete_max
          FROM (
            SELECT business_date, last_import_batch_id FROM netshop_rows
            WHERE platform = %s AND source = %s AND dataset = %s
              AND shop_name = s.shop_name AND business_date IS NOT NULL
            ORDER BY business_date DESC LIMIT 64
          ) p
        ) q
      ) SELECT MAX(complete_max), ARRAY_AGG(shop_name) FILTER (
          WHERE physical_count = 64 AND complete_max IS NULL
        ) FROM prefix_meta
    """.format(values=values)
    with connection.cursor() as cursor:
        cursor.execute(sql, [*names, "completed", platform, platform, source, dataset])
        fast_max, fallback_shops = cursor.fetchone()
    if not fallback_shops:
        return fast_max
    # A prefix with no completed row cannot prove absence. Scan those exact
    # shops with the unchanged original predicate, including all history.
    # Database GREATEST preserves the original column's collation/NULL rules.
    return base.filter(shop_name__in=fallback_shops).aggregate(
        day=Greatest(Max("business_date"), Value(fast_max, output_field=CharField()))
    )["day"]
