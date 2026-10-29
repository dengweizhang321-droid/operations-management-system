"""Finite153-to154 sales exclusion index; no business-data mutation."""

STEPS = ("sales.0012_excluded_business_date_index",)
FILES = {"backend/sales/migrations/0012_excluded_business_date_index.py": "0649724d2b94867efe42f56ef8d1b7992bd3878f3e1db7652422743b7f4ac238"}
INDEX = "sales_excluded_date_idx"


def verify_index(cursor, *, installed=True):
    cursor.execute("SELECT to_regclass(%s)", ["public." + INDEX])
    present = cursor.fetchone()[0] is not None
    if not installed:
        if present:
            raise ValueError("Sales154 index exists without its migration receipt")
        return
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
        "WHERE c.oid=to_regclass(%s)", ["public." + INDEX],
    )
    expected = ("sales_order_lines", "i", "p", "teruisi_sales_owner", "btree",
                False, True, True, 1, 1, "(NOT is_business_row)", None,
                ["business_date"], ["date_ops"])
    if not present or cursor.fetchone() != expected:
        raise ValueError("Sales154 partial date index identity or predicate differs")


def verify_catalog(cursor, *, installed=True, permissions=True):
    import pi_native_catalog as parent
    # No new table or role is introduced;153's existing grants stay mandatory.
    parent.verify_catalog(cursor, installed=True, permissions=True)
    verify_index(cursor, installed=installed)


def preservation(cursor):
    # Preserve the unchanged parent's original row/ACL contract and its own tables.
    import bi_app_addition as common
    import pi_native_catalog as parent
    from psycopg import sql
    original = parent.preservation(cursor)
    values, permissions, count = {}, {}, original["rows"]
    for table in parent.TABLES:
        cursor.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY id LIMIT 100001").format(sql.Identifier(table)))
        rows = cursor.fetchall()
        if len(rows) > 100000:
            raise ValueError("Sales154 parent preservation exceeded bound")
        count += len(rows)
        values[table] = common.digest(rows)
        cursor.execute("SELECT relacl::text FROM pg_class WHERE oid=to_regclass(%s)", ["public." + table])
        permissions[table] = cursor.fetchone()
    return {"rows": count, "legacyRowsSha256": common.digest([original["legacyRowsSha256"], values]),
            "permissionsSha256": common.digest([original["permissionsSha256"], permissions])}


def verify_initial_values(cursor):
    # This addition creates no table or defaults and never seeds business data.
    verify_index(cursor)


def verify_defaults(apps):
    model = apps.get_model("sales", "SalesOrderLine")
    selected = [index for index in model._meta.indexes if index.name == INDEX]
    if len(selected) != 1:
        raise ValueError("Sales154 migration state lacks its unique index")
    index = selected[0]
    if (index.fields != ["business_date"] or index.expressions
            or index.condition.deconstruct() != ("django.db.models.Q", (("is_business_row", False),), {})):
        raise ValueError("Sales154 migration-state index differs")
