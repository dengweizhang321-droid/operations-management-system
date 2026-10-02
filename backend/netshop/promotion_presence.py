"""Versioned, derived JSON number-presence bits; no ORM or metric algorithms.

The first *existing* key wins, including JSON null. All keys absent (or a
non-object root) yields SQL NULL, distinct from an existing non-number.
"""
from decimal import Decimal
import math

RULE = "jd-ad-presence-v1"
ALIASES = (
    ("spendCents", "花费"),
    ("netTransactionAmountCents", "总订单金额"),
    ("impressions", "展现数"),
    ("clicks", "点击数"),
    ("netOrders", "总订单行"),
)
BITS = {names: 1 << i for i, names in enumerate(ALIASES)}
MAX_MASK = (1 << len(ALIASES)) - 1
FIELDS = (
    "numeric_presence_mask", "numeric_presence_null_mask", "numeric_presence_rule",
    "numeric_presence_row_hash", "numeric_presence_batch_id",
)


def cache_values(source, dataset, metrics, row_hash, batch_id):
    empty = dict.fromkeys(FIELDS)
    if (source, dataset) != ("jd_promotion", "ad"):
        return empty
    numbers, nulls = 0, 0
    for names, bit in BITS.items():
        if not isinstance(metrics, dict) or not any(key in metrics for key in names):
            nulls |= bit
            continue
        value = next(metrics[key] for key in names if key in metrics)
        if type(value) in (int, float, Decimal):
            if (isinstance(value, Decimal) and not value.is_finite()) or (
                isinstance(value, float) and not math.isfinite(value)
            ):
                return empty  # Invalid JSON numbers cannot be certified.
            numbers |= bit
    return dict(zip(FIELDS, (numbers, nulls, RULE, row_hash, batch_id)))


def verify_cache_catalog(cursor):
    """Catalog-only readiness for netshop.0004; never a business read."""
    cursor.execute("SELECT EXISTS(SELECT 1 FROM django_migrations "
                   "WHERE app='netshop' AND name='0004_promotion_presence_cache')")
    if cursor.fetchone()[0] is not True:
        raise RuntimeError("netshop_presence_migration_missing")
    cursor.execute(
        "SELECT a.attname,a.attnotnull,pg_catalog.format_type(a.atttypid,a.atttypmod),d.adbin IS NULL "
        "FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d "
        "ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
        "WHERE a.attrelid=pg_catalog.to_regclass('public.netshop_rows') "
        "AND a.attname=ANY(%s) AND NOT a.attisdropped ORDER BY a.attname",
        [["numeric_presence_mask", "numeric_presence_null_mask", "numeric_presence_rule",
          "numeric_presence_row_hash", "numeric_presence_batch_id"]],
    )
    if cursor.fetchall() != [
        ("numeric_presence_batch_id", False, "character varying(1024)", True),
        ("numeric_presence_mask", False, "bigint", True),
        ("numeric_presence_null_mask", False, "bigint", True),
        ("numeric_presence_row_hash", False, "character varying(64)", True),
        ("numeric_presence_rule", False, "character varying(32)", True),
    ]:
        raise RuntimeError("netshop_presence_columns_invalid")
    cursor.execute(
        "SELECT n.nspname,c.relname,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,"
        "fn.nspname,p.proname,t.tgqual IS NULL,octet_length(t.tgargs),"
        "ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY k(num,ord) "
        "JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k.num ORDER BY k.ord) "
        "FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid "
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
        "JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid "
        "JOIN pg_catalog.pg_namespace fn ON fn.oid=p.pronamespace "
        "WHERE t.tgname='netshop_presence_invalidate' AND NOT t.tgisinternal"
    )
    if cursor.fetchall() != [("public", "netshop_rows", "O", 19, False, False, "public",
            "netshop_presence_invalidate", True, 0,
            ["metrics_json", "source", "dataset", "source_row_hash", "last_import_batch_id"])]:
        raise RuntimeError("netshop_presence_trigger_invalid")
    cursor.execute(
        "SELECT p.prosecdef,p.proisstrict,p.provolatile,p.proconfig,l.lanname,"
        "pg_catalog.pg_get_function_result(p.oid),p.prosrc,"
        "EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl "
        "WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') "
        "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace "
        "JOIN pg_catalog.pg_language l ON l.oid=p.prolang "
        "WHERE n.nspname='public' AND p.proname='netshop_presence_invalidate' "
        "AND pg_catalog.pg_get_function_identity_arguments(p.oid)=''"
    )
    functions = cursor.fetchall()
    body = """BEGIN
  NEW.numeric_presence_mask := NULL;
  NEW.numeric_presence_null_mask := NULL;
  NEW.numeric_presence_rule := NULL;
  NEW.numeric_presence_row_hash := NULL;
  NEW.numeric_presence_batch_id := NULL;
  RETURN NEW;
END"""
    if len(functions) != 1:
        raise RuntimeError("netshop_presence_function_invalid")
    definer, strict, volatility, config, language, result, source, public_execute = functions[0]
    if (definer or strict or volatility != "v" or language != "plpgsql" or result != "trigger"
            or public_execute or str(source).strip() != body
            or [str(x).replace(" ", "") for x in (config or [])] != ["search_path=pg_catalog,public"]):
        raise RuntimeError("netshop_presence_function_invalid")
