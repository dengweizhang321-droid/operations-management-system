"""The two reviewed audit migrations and their exact PostgreSQL additions."""
from psycopg import sql

STEPS = ("erp_reference.0003_jackyun_upload_audit_binding", "sales.0011_jackyun_upload_audit_binding")
FILES = {
    "backend/erp_reference/migrations/0003_jackyun_upload_audit_binding.py": "b8dbfdfad6cfbd0d870bd0781dc5853297bea3aadb55b4f9147c79476331323c",
    "backend/sales/migrations/0011_jackyun_upload_audit_binding.py": "b168f3e2fe79e701876ee910b9101677b9a14b52198233fd6d2c78e90a86991a",
}
COLUMNS = {
    "erp_reference_import_attempts": {"raw_upload_id": "character varying(36)", "upload_fingerprint": "character varying(255)"},
    "sales_import_attempts": {"raw_upload_id": "character varying(36)", "upload_fingerprint": "character varying(255)"},
    "sales_raw_upload_sessions": {"publication_baseline": "jsonb"},
}


def verify_catalog(cursor, *, installed):
    for table, expected in COLUMNS.items():
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef "
                       "FROM pg_attribute a WHERE a.attrelid=to_regclass(%s) AND NOT a.attisdropped "
                       "AND a.attname=ANY(%s) ORDER BY a.attname", ["public." + table, list(expected)])
        actual = cursor.fetchall()
        wanted = sorted((name, kind, True, False) for name, kind in expected.items()) if installed else []
        if actual != wanted:
            raise ValueError("Jackyun audit columns differ from the exact recorded generation")
        if installed and "upload_fingerprint" in expected:
            # Django creates both a normal btree and a varchar_pattern_ops
            # index; neither may be partial, invalid, expression or unique.
            cursor.execute("SELECT i.indisvalid,i.indisready,i.indisunique,i.indpred IS NULL,"
                           "i.indexprs IS NULL,am.amname,op.opcname,i.indnatts "
                           "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
                           "JOIN pg_am am ON am.oid=c.relam JOIN pg_attribute a "
                           "ON a.attrelid=i.indrelid AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum "
                           "JOIN pg_opclass op ON op.oid=i.indclass[0] "
                           "WHERE i.indrelid=to_regclass(%s) AND a.attname='upload_fingerprint'",
                           ["public." + table])
            expected_indexes = {(True, True, False, True, True, "btree", "text_ops", 1),
                                (True, True, False, True, True, "btree", "varchar_pattern_ops", 1)}
            if set(cursor.fetchall()) != expected_indexes:
                raise ValueError("Jackyun audit fingerprint indexes differ")


def original_rows(connection):
    """Bounded streaming hashes of only pre-existing columns; no raw rows saved."""
    import hashlib
    import uuid
    from django.db import transaction
    result = {}
    with transaction.atomic(), connection.cursor() as cursor:
        for table, additions in COLUMNS.items():
            cursor.execute("SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(%s) "
                           "AND attnum>0 AND NOT attisdropped ORDER BY attnum", ["public." + table])
            columns = [row[0] for row in cursor.fetchall() if row[0] not in additions]
            if "id" not in columns or len(columns) > 100:
                raise ValueError("Audit baseline columns are not recognized")
            query = sql.SQL("SELECT sha256(convert_to(row_to_json(r)::text,'UTF8')) AS h FROM (SELECT {} FROM {}) r ORDER BY h").format(
                sql.SQL(",").join(map(sql.Identifier, columns)), sql.Identifier("public", table))
            digest = hashlib.sha256(); count = 0
            with connection.connection.cursor(name="audit_" + uuid.uuid4().hex) as stream:
                stream.itersize = 512
                stream.execute(query)
                for (row_hash,) in stream:
                    if not isinstance(row_hash, bytes) or len(row_hash) != 32:
                        raise ValueError("Invalid original audit row digest")
                    digest.update(row_hash)
                    count += 1
                    if count > 10_000_000:
                        raise ValueError("Audit preservation check exceeded its bound")
            result[table] = {"columns": columns, "rows": count, "sha256": digest.hexdigest()}
    return result
