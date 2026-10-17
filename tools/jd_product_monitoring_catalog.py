"""Exact 148 catalogue; the immutable 147 reference remains unchanged."""
import json
from pathlib import Path

from jd_logistics_catalog import TABLES, inspect_tables

STEPS = ("inventory.0016_jd_product_monitoring",)
FILES = {"backend/inventory/migrations/0016_jd_product_monitoring.py":
         "3a446544a231f84691579596bca1e3ad7f0f102605ef2d68204360d8adc0d899"}
TABLE = "inventory_jd_logistics_departments"
FIELDS = ("unmonitored_product_codes",)


def reference_catalog():
    # New projection only: never mutate or relax the stored parent reference.
    reference = json.loads(Path(__file__).with_name("jd_monitor_preferences_catalog.json").read_text(encoding="utf8"))
    reference[TABLE]["columns"].append([FIELDS[0], "jsonb", True, None, "", "", None])
    return reference


def verify_catalog(cursor, *, permissions=True):
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                   "WHERE n.nspname='public' AND relname LIKE 'inventory_jd_logistics_%%' "
                   "AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    if [row[0] for row in cursor.fetchall()] != list(TABLES):
        raise ValueError("JD148 tables are absent, partial or extra")
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    reference = reference_catalog()
    for table in TABLES:
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("JD148 complete schema/owner/index/guard/ACL differs: " + table)


def verify_defaults(apps):
    from jd_monitor_preferences_catalog import verify_defaults as original_defaults
    original_defaults(apps)
    value = apps.get_model("inventory", "JdLogisticsDepartment")()
    if any(getattr(value, field) != [] for field in FIELDS):
        raise ValueError("JD148 display defaults differ")


def preservation(cursor):
    """Only digests leave the affected table; no business values are published."""
    import bi_app_addition as common
    cursor.execute("SELECT to_jsonb(t) - %s::text[] FROM public.inventory_jd_logistics_departments t ORDER BY id LIMIT 10001", [list(FIELDS)])
    rows = cursor.fetchall()
    if len(rows) > 10000:
        raise ValueError("JD148 department preservation projection exceeded its bound")
    cursor.execute("SELECT c.relacl::text FROM pg_class c WHERE c.oid=to_regclass(%s)", ["public." + TABLE])
    acl = cursor.fetchone()
    cursor.execute("SELECT a.attname,a.attacl::text FROM pg_attribute a WHERE a.attrelid=to_regclass(%s) "
                   "AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>ALL(%s) ORDER BY a.attname", ["public." + TABLE, list(FIELDS)])
    return {"rows": len(rows), "legacyRowsSha256": common.digest(rows),
            "permissionsSha256": common.digest([acl, cursor.fetchall()])}


def verify_initial_values(cursor):
    cursor.execute("SELECT EXISTS(SELECT 1 FROM public.inventory_jd_logistics_departments "
                   "WHERE unmonitored_product_codes <> '[]'::jsonb)")
    if cursor.fetchone() != (False,):
        raise ValueError("JD148 installation may only create empty product monitoring preferences")
