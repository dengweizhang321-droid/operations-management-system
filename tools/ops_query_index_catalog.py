"""Finite159-to162 operations query indexes; no table, role, grant or business-data change.

Three ordinary partial B-tree indexes on three existing tables, one migration per
owning app. Everything else is inherited unchanged from the verified159 parent.
"""
import re

STEPS = (
    "sales.0013_customer_service_online_spec_index",
    "netshop.0005_market_projection_page_index",
    "customer_service.0003_ai_analyzed_at_index",
)
FILES = {
    "backend/sales/migrations/0013_customer_service_online_spec_index.py": "75fb4c4d24114dd5d35bc73ce2453d31993a551c148b1c1920c8fab8c4379d09",
    "backend/netshop/migrations/0005_market_projection_page_index.py": "8eb17873b003a98cc5e54ced612289d9a61771efe4198f2f92292900f2fda42b",
    "backend/customer_service/migrations/0003_ai_analyzed_at_index.py": "1daac3fb522af39e2d2a2a1b54d2bd73a33cfbc302dd98721df42a9960e395e3",
}
OWNER = "teruisi_sales_owner"
# name -> (app, model, table, key columns, accepted btree operator classes per column,
#          accepted predicate renderings after normalize_predicate).
# PostgreSQL may print "NOT (a = '')" or the negator form "a <> ''" and may print
# varchar casts differently, so the predicate is compared after removing casts,
# parentheses and blanks. Both accepted renderings are semantically identical.
INDEXES = {
    "sales_cs_online_spec_idx": (
        "sales", "SalesOrderLine", "sales_order_lines", ["online_spec_code"],
        [("text_ops",)],
        {"is_business_rowandnotonline_spec_code=''", "is_business_rowandonline_spec_code<>''"},
    ),
    "net_projection_page_idx": (
        "netshop", "NetshopRow", "netshop_rows", ["source", "source_row_key"],
        [("text_ops", "varchar_ops"), ("text_ops",)],
        {"dataset=anyarray['sku_daily','spu_daily']", "dataset=any'{sku_daily,spu_daily}'"},
    ),
    "cs_conv_ai_analyzed_idx": (
        "customer_service", "CustomerServiceConversation", "customer_service_conversations", ["analyzed_at"],
        [("timestamptz_ops",)],
        {"analysis_source='ai'"},
    ),
}


def normalize_predicate(text):
    """Drop casts, parentheses, blanks and case so equivalent PostgreSQL renderings compare equal."""
    plain = re.sub(r"::(?:character varying|text)(?:\[\])?", "", text or "")
    return re.sub(r"[()\s]", "", plain).lower()


def verify_indexes(cursor, *, installed=True):
    """All three indexes, exactly as reviewed, or none of them (never a partial state)."""
    cursor.execute("SELECT to_regclass(%s),to_regclass(%s),to_regclass(%s)",
                   ["public." + name for name in INDEXES])
    present = [value is not None for value in cursor.fetchone()]
    if not installed:
        if any(present):
            raise ValueError("Operations query index exists without its migration receipt")
        return
    if not all(present):
        raise ValueError("Operations query index is missing")
    for name, (_, _, table, columns, classes, predicates) in INDEXES.items():
        cursor.execute(
            "SELECT t.relname,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner),m.amname,"
            "i.indisunique,i.indisvalid,i.indisready,i.indnkeyatts,i.indnatts,"
            "pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid),"
            "ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord) "
            "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord),"
            "ARRAY(SELECT o.opcname FROM unnest(i.indclass) WITH ORDINALITY k(num,ord) "
            "JOIN pg_opclass o ON o.oid=k.num ORDER BY k.ord) "
            "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
            "JOIN pg_class t ON t.oid=i.indrelid JOIN pg_am m ON m.oid=c.relam "
            "WHERE c.oid=to_regclass(%s)", ["public." + name],
        )
        row = cursor.fetchone()
        if (row is None or row[:10] != (table, "i", "p", OWNER, "btree", False, True, True, len(columns), len(columns))
                or row[11] is not None or list(row[12]) != columns
                or len(row[13]) != len(columns)
                or any(actual not in allowed for actual, allowed in zip(row[13], classes))
                or normalize_predicate(row[10]) not in predicates):
            raise ValueError("Operations query index identity or predicate differs: " + name)


def verify_catalog(cursor, *, installed=True, permissions=True):
    import ai_unified_tasks_catalog as parent
    # No new table, function or role is introduced; 159's closed catalogue and
    # grants stay mandatory in every state.
    parent.verify_catalog(cursor, installed=True, permissions=True)
    verify_indexes(cursor, installed=installed)


def preservation(cursor):
    """Extend the parent's row/ACL digest to the five unified-task tables it introduced."""
    import bi_app_addition as common
    import ai_unified_tasks_catalog as parent
    from psycopg import sql
    from sales_preflight_catalog import order_columns
    original = parent.preservation(cursor)
    order = order_columns(parent.TABLES, parent.models_at_revision())
    objects = parent.inspect_tables(cursor)
    values, permissions, count = {}, {}, original["rows"]
    for table in parent.TABLES:
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY {} LIMIT 100001").format(
            sql.Identifier(table), sql.Identifier(order[table])))
        rows = cursor.fetchall()
        if len(rows) > 100000 or count + len(rows) > 500000:
            raise ValueError("Operations query index parent preservation exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        permissions[table] = {key: objects[table][key] for key in ("acl", "columnAcl")}
    return {"rows": count, "legacyRowsSha256": common.digest([original["legacyRowsSha256"], values]),
            "permissionsSha256": common.digest([original["permissionsSha256"], permissions])}


def verify_initial_values(cursor):
    # This addition creates no table or defaults and never seeds business data.
    verify_indexes(cursor, installed=True)


def verify_defaults(apps):
    from django.db import models
    import ai_unified_tasks_catalog as parent
    parent.verify_defaults(apps)
    conditions = {
        "sales_cs_online_spec_idx": models.Q(is_business_row=True) & ~models.Q(online_spec_code=""),
        "net_projection_page_idx": models.Q(dataset__in=["sku_daily", "spu_daily"]),
        "cs_conv_ai_analyzed_idx": models.Q(analysis_source="ai"),
    }
    for name, (app, model_name, _, columns, _, _) in INDEXES.items():
        selected = [index for index in apps.get_model(app, model_name)._meta.indexes if index.name == name]
        if len(selected) != 1:
            raise ValueError("Operations query index migration state lacks its unique index: " + name)
        index = selected[0]
        if index.fields != columns or index.expressions or index.condition != conditions[name]:
            raise ValueError("Operations query index migration-state definition differs: " + name)
