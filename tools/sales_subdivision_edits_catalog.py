"""Finite162-to163 sales subdivision edit tables; two empty tables, no seed data.

Migration sales.0014 creates the label overlay table and the manual-assignment
table. The migration issues no GRANT: the ordinary Django start (migrate plus
sales_analysis_options_permissions.provision) provisions the reader/writer ACL,
so an installed generation is accepted either owner-only (before that start) or
with exactly the reviewed ACL (afterwards). Everything else is inherited
unchanged from the verified162 parent.
"""
STEPS = ("sales.0014_product_subdivision_edits",)
FILES = {
    "backend/sales/migrations/0014_product_subdivision_edits.py": "665c5450d54de691f30112ccf1cd5899efe6a15b387d9a9dddfd0ba2b9ee05ef",
}
OWNER = "teruisi_sales_owner"
READER = "teruisi_sales_reader"
WRITER = "teruisi_sales_writer"
TABLES = ("sales_product_subdivision_overrides", "sales_subdivision_labels")
SEQUENCE_TABLE = "sales_subdivision_labels"
OWNER_PRIVILEGES = frozenset({"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"})
# table -> role -> privileges once ProvisionRoles-equivalent grants ran.
GRANTS = {
    "sales_subdivision_labels": {READER: frozenset({"SELECT"}), WRITER: frozenset({"SELECT", "INSERT", "UPDATE"})},
    "sales_product_subdivision_overrides": {READER: frozenset({"SELECT"}),
                                            WRITER: frozenset({"SELECT", "INSERT", "UPDATE", "DELETE"})},
}
SEQUENCE_GRANTS = {WRITER: frozenset({"USAGE"})}
# table -> ordered (name, format_type, not null, default expression, identity, generated)
COLUMNS = {
    "sales_subdivision_labels": [
        ("id", "bigint", True, None, "d", ""),
        ("major_category", "text", True, None, "", ""),
        ("name", "text", True, None, "", ""),
        ("sort_order", "integer", True, None, "", ""),
        ("is_deleted", "boolean", True, None, "", ""),
        ("created_at", "timestamp with time zone", True, None, "", ""),
        ("updated_at", "timestamp with time zone", True, None, "", ""),
        ("updated_by", "text", True, None, "", ""),
    ],
    "sales_product_subdivision_overrides": [
        ("product_code", "text", True, None, "", ""),
        ("major_category", "text", True, None, "", ""),
        ("label", "text", True, None, "", ""),
        ("source_name", "text", True, None, "", ""),
        ("updated_at", "timestamp with time zone", True, None, "", ""),
        ("updated_by", "text", True, None, "", ""),
    ],
}
# table -> sorted (constraint name, type, definition)
CONSTRAINTS = {
    "sales_subdivision_labels": [
        ("sales_subdivision_label_uniq", "u", "UNIQUE (major_category, name)"),
        ("sales_subdivision_labels_pkey", "p", "PRIMARY KEY (id)"),
    ],
    "sales_product_subdivision_overrides": [
        ("sales_product_subdivision_overrides_pkey", "p", "PRIMARY KEY (product_code)"),
    ],
}
# table -> sorted (index name, unique, access method, key columns, opclass names)
INDEXES = {
    "sales_subdivision_labels": [
        ("sales_subdivision_label_uniq", True, "btree", ["major_category", "name"], ["text_ops", "text_ops"]),
        ("sales_subdivision_labels_pkey", True, "btree", ["id"], ["int8_ops"]),
    ],
    "sales_product_subdivision_overrides": [
        ("sales_product_subdivision_overrides_pkey", True, "btree", ["product_code"], ["text_ops"]),
        ("sales_product_subdivision_overrides_product_code_6767028a_like", False, "btree", ["product_code"], ["text_pattern_ops"]),
    ],
}


def _acl(cursor, query, target):
    cursor.execute(query, [target])
    result = {}
    for role, privilege, grantable in cursor.fetchall():
        if grantable:
            raise ValueError("Sales subdivision ACL must not be grantable")
        result.setdefault(role, set()).add(privilege)
    return {role: frozenset(values) for role, values in result.items()}


def _table_acl(cursor, table):
    return _acl(cursor,
        "SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
        "a.privilege_type,a.is_grantable FROM pg_class c "
        "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s)", "public." + table)


def _sequence_name(cursor):
    cursor.execute("SELECT pg_get_serial_sequence(%s,'id')", ["public." + SEQUENCE_TABLE])
    return cursor.fetchone()[0]


def _sequence_acl(cursor, sequence):
    return _acl(cursor,
        "SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
        "a.privilege_type,a.is_grantable FROM pg_class c "
        "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('s',c.relowner))) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s)", sequence)


def _expected_acl(table, provisioned):
    result = {"OWNER": OWNER_PRIVILEGES}
    if provisioned:
        result.update(GRANTS[table])
    return result


def verify_tables(cursor, *, installed=True, permissions=True):
    """permissions: True = exact reviewed ACL, False = owner only, "either" = one of the two."""
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                   "WHERE n.nspname='public' AND relname=ANY(%s) AND relkind IN ('r','p','v','m','f') ORDER BY relname",
                   [list(TABLES)])
    present = [row[0] for row in cursor.fetchall()]
    if present != (list(TABLES) if installed else []):
        raise ValueError("Sales subdivision tables absent, partial or unrecorded")
    if not installed:
        return
    for table in TABLES:
        target = "public." + table
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity,relispartition "
                       "FROM pg_class WHERE oid=to_regclass(%s)", [target])
        if cursor.fetchone() != (OWNER, "r", "p", False, False, False):
            raise ValueError("Sales subdivision table identity differs: " + table)
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),"
                       "a.attidentity,a.attgenerated FROM pg_attribute a "
                       "LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
                       "WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        if [tuple(row) for row in cursor.fetchall()] != [tuple(row) for row in COLUMNS[table]]:
            raise ValueError("Sales subdivision columns differ: " + table)
        cursor.execute("SELECT conname,contype,pg_get_constraintdef(oid),convalidated,condeferrable,condeferred "
                       "FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname", [target])
        rows = cursor.fetchall()
        if ([row[:3] for row in rows] != [tuple(row) for row in CONSTRAINTS[table]]
                or any(row[3:] != (True, False, False) for row in rows)):
            raise ValueError("Sales subdivision constraints differ: " + table)
        cursor.execute("SELECT c.relname,i.indisunique,m.amname,"
                       "ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord) "
                       "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord),"
                       "ARRAY(SELECT o.opcname FROM unnest(i.indclass) WITH ORDINALITY k(num,ord) "
                       "JOIN pg_opclass o ON o.oid=k.num ORDER BY k.ord),"
                       "i.indisvalid,i.indisready,pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid) "
                       "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am m ON m.oid=c.relam "
                       "WHERE i.indrelid=to_regclass(%s) ORDER BY c.relname", [target])
        indexes = cursor.fetchall()
        if ([(r[0], r[1], r[2], list(r[3]), list(r[4])) for r in indexes] != [tuple(row) for row in INDEXES[table]]
                or any(r[5:] != (True, True, None, None) for r in indexes)):
            raise ValueError("Sales subdivision indexes differ: " + table)
        cursor.execute("SELECT count(*) FROM pg_trigger WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal", [target])
        if cursor.fetchone() != (0,):
            raise ValueError("Sales subdivision tables must not have triggers: " + table)
        cursor.execute("SELECT count(*) FROM pg_policy WHERE polrelid=to_regclass(%s)", [target])
        if cursor.fetchone() != (0,):
            raise ValueError("Sales subdivision tables must not have policies: " + table)
        cursor.execute("SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass(%s) AND attacl IS NOT NULL", [target])
        if cursor.fetchone() != (0,):
            raise ValueError("Sales subdivision tables must not have column ACL: " + table)
    sequence = _sequence_name(cursor)
    if sequence != "public." + SEQUENCE_TABLE + "_id_seq":
        raise ValueError("Sales subdivision label sequence differs")
    modes = {True: (True,), False: (False,), "either": (False, True)}[permissions]
    actual_tables = {table: _table_acl(cursor, table) for table in TABLES}
    actual_sequence = _sequence_acl(cursor, sequence)
    for provisioned in modes:
        if (all(actual_tables[table] == _expected_acl(table, provisioned) for table in TABLES)
                and actual_sequence == ({"OWNER": frozenset({"USAGE", "SELECT", "UPDATE"}),
                                         **(SEQUENCE_GRANTS if provisioned else {})})):
            return
    raise ValueError("Sales subdivision table or sequence ACL differs")


def verify_catalog(cursor, *, installed=True, permissions=True):
    import ops_query_index_catalog as parent
    # Nothing in 162's closed catalogue or grants changes in any state.
    parent.verify_catalog(cursor, installed=True, permissions=True)
    verify_tables(cursor, installed=installed, permissions=permissions)


def preservation(cursor):
    """The two new tables are empty before install, so the verified162 digest is the whole preserved state."""
    import ops_query_index_catalog as parent
    return parent.preservation(cursor)


def verify_initial_values(cursor):
    from psycopg import sql
    for table in TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Schema-only sales subdivision adoption cannot seed or import business rows")


def verify_defaults(apps):
    import ops_query_index_catalog as parent
    parent.verify_defaults(apps)
    label = apps.get_model("sales", "SalesSubdivisionLabel")
    override = apps.get_model("sales", "SalesProductSubdivisionOverride")
    if label._meta.db_table != "sales_subdivision_labels" or override._meta.db_table != "sales_product_subdivision_overrides":
        raise ValueError("Sales subdivision migration-state tables differ")
    constraints = [(c.name, tuple(c.fields)) for c in label._meta.constraints]
    if constraints != [("sales_subdivision_label_uniq", ("major_category", "name"))]:
        raise ValueError("Sales subdivision migration-state unique constraint differs")
    values = label()
    if (values.sort_order, values.is_deleted, values.updated_by) != (0, False, ""):
        raise ValueError("Sales subdivision label migration-state defaults differ")
    values = override()
    if (values.label, values.source_name, values.updated_by) != ("", "", ""):
        raise ValueError("Sales subdivision override migration-state defaults differ")
