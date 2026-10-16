"""Exact 147 catalogue; the immutable 146 reference remains unchanged."""
import json
from pathlib import Path

from jd_logistics_catalog import TABLES, inspect_tables

STEPS = ("inventory.0015_jd_monitor_preferences",)
FILES = {"backend/inventory/migrations/0015_jd_monitor_preferences.py":
         "edc51662d51ef09a6e62a566892bee3afda953c48601a2d3856c5ba6f332c2e0"}
TABLE = "inventory_jd_logistics_departments"
FIELDS = ("warehouse_preferences", "product_order")


def verify_catalog(cursor, *, permissions=True):
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                   "WHERE n.nspname='public' AND relname LIKE 'inventory_jd_logistics_%%' "
                   "AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    if [row[0] for row in cursor.fetchall()] != list(TABLES):
        raise ValueError("JD147 tables are absent, partial or extra")
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    reference = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf8"))
    for table in TABLES:
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("JD147 complete schema/owner/index/guard/ACL differs: " + table)


def verify_defaults(apps):
    from jd_logistics_catalog import verify_defaults as original_defaults
    original_defaults(apps)
    value = apps.get_model("inventory", "JdLogisticsDepartment")()
    if any(getattr(value, field) != [] for field in FIELDS):
        raise ValueError("JD147 display defaults differ")


def preservation(cursor):
    """Only digests leave the affected table; no business values are published."""
    import bi_app_addition as common
    cursor.execute("SELECT to_jsonb(t) - %s::text[] FROM public.inventory_jd_logistics_departments t ORDER BY id LIMIT 10001", [list(FIELDS)])
    rows = cursor.fetchall()
    if len(rows) > 10000:
        raise ValueError("JD147 department preservation projection exceeded its bound")
    cursor.execute("SELECT c.relacl::text FROM pg_class c WHERE c.oid=to_regclass(%s)", ["public." + TABLE])
    acl = cursor.fetchone()
    cursor.execute("SELECT a.attname,a.attacl::text FROM pg_attribute a WHERE a.attrelid=to_regclass(%s) "
                   "AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>ALL(%s) ORDER BY a.attname", ["public." + TABLE, list(FIELDS)])
    return {"rows": len(rows), "legacyRowsSha256": common.digest(rows),
            "permissionsSha256": common.digest([acl, cursor.fetchall()])}


def verify_initial_values(cursor):
    cursor.execute("SELECT EXISTS(SELECT 1 FROM public.inventory_jd_logistics_departments "
                   "WHERE warehouse_preferences <> '[]'::jsonb OR product_order <> '[]'::jsonb)")
    if cursor.fetchone() != (False,):
        raise ValueError("JD147 installation may only create empty display preferences")
