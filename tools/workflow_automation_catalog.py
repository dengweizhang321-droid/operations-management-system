"""Exact PostgreSQL17 workflow automation projection schema; owner-only tables.

This generation adopts two migrations that were already merged to main by the
京准通 B1 / 京东客服链 B4 feature work. It freezes their resulting structure as
an expectation; it does not design new structure. No role grant is issued here
because neither migration issues one and neither
teruisi_backend.health.WORKFLOW_WRITER_TABLE_PRIVILEGES nor
tools/django-workflow-service.ps1 lists any automation_* table, so the adopted
tables stay owner-only. That owner-only state is the expectation this catalogue
asserts, not an omission.
"""
import importlib
import json
from pathlib import Path

from psycopg import sql

STEPS = ("workflow.0009_automation_projection_b1",
         "workflow.0010_customer_service_chain_modules")
# Frozen after the migration's mandatory syntax/closure checks.
FILES = {"backend/workflow/migrations/0009_automation_projection_b1.py":
             "adafff9db82c661409e16488be6461f6a52d436f226360254d8af82a9b6c89bc",
         "backend/workflow/migrations/0010_customer_service_chain_modules.py":
             "f5cf004563db635baa29fcb57e3965f26c085eb14ba2eb13eaf78a85f53de8cd"}
TABLES = tuple(sorted(("automation_logical_runs", "automation_modules",
                       "automation_attempts", "automation_module_results")))
# Only this table has a BigAutoField; the other three key on UUID or CharField.
SEQUENCE_TABLE = "automation_module_results"
REGISTRY_TABLE = "automation_modules"
EMPTY_TABLES = tuple(name for name in TABLES if name != REGISTRY_TABLE)


def registry_rows():
    """The exact rows 0010 seeds, read from the migration rather than copied.

    0010 is a RunPython step whose CUSTOMER_SERVICE_MODULES literal is the only
    definition of this registry content. Importing it keeps one source of truth:
    editing that literal changes FILES' hash and fails admission first.
    """
    migration = importlib.import_module("workflow.migrations.0010_customer_service_chain_modules")
    rows = migration.CUSTOMER_SERVICE_MODULES
    if type(rows) is not list or len(rows) != 3:
        raise ValueError("Workflow156 registry seed is not the reviewed three modules")
    result = {}
    for row in rows:
        if type(row) is not dict or "module_key" not in row:
            raise ValueError("Workflow156 registry seed row is malformed")
        if row["module_key"] in result:
            raise ValueError("Workflow156 registry seed has a duplicate module")
        result[row["module_key"]] = row
    return result


def models_at_revision():
    """Migration state only: no database query, model instance or application call."""
    from django.db.migrations.loader import MigrationLoader
    state = MigrationLoader(None).project_state([tuple(STEPS[-1].split(".", 1))])
    return {model._meta.db_table: model for model in state.apps.get_app_config("workflow").get_models()
            if model._meta.db_table in TABLES}


def inspect_tables(cursor):
    from postgres_restore_semantics import normalize_dump_expression
    result = {}
    for table in TABLES:
        target = "public." + table
        cursor.execute("SELECT pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity "
                       "FROM pg_class WHERE oid=to_regclass(%s)", [target])
        identity = cursor.fetchone()
        cursor.execute("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,"
                       "pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity,"
                       "CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END "
                       "FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
                       "WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [target])
        columns = cursor.fetchall()
        cursor.execute("SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) "
                       "FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname", [target])
        constraints = [(*row[:-1], normalize_dump_expression(row[-1])) for row in cursor.fetchall()]
        cursor.execute("SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,pg_get_indexdef(i.indexrelid) "
                       "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass(%s) ORDER BY c.relname", [target])
        indexes = cursor.fetchall()
        cursor.execute("SELECT t.tgname,t.tgtype,t.tgenabled,n.nspname,p.proname,encode(t.tgargs,'hex'),pg_get_triggerdef(t.oid) "
                       "FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace "
                       "WHERE t.tgrelid=to_regclass(%s) AND NOT t.tgisinternal ORDER BY t.tgname", [target])
        triggers = cursor.fetchall()
        cursor.execute("SELECT CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a "
                       "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s) ORDER BY 1,2,3", [target])
        acl = cursor.fetchall()
        cursor.execute("SELECT t.attname,CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,"
                       "a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid "
                       "CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee "
                       "WHERE c.oid=to_regclass(%s) AND t.attnum>0 AND NOT t.attisdropped ORDER BY 1,2,3,4", [target])
        column_acl = cursor.fetchall()
        cursor.execute("SELECT polname FROM pg_policy WHERE polrelid=to_regclass(%s) ORDER BY polname", [target])
        result[table] = {"identity": identity, "columns": columns, "constraints": constraints,
                         "indexes": indexes, "triggers": triggers, "acl": acl, "columnAcl": column_acl,
                         "policies": cursor.fetchall()}
    return result


def sequence_catalog(cursor):
    cursor.execute("SELECT pg_get_serial_sequence(%s,'id')", ["public." + SEQUENCE_TABLE])
    sequence = cursor.fetchone()[0]
    if not sequence:
        raise ValueError("Workflow156 result sequence is absent or unrecorded")
    cursor.execute("SELECT pg_get_userbyid(c.relowner),c.relkind,c.relpersistence, "
        "a.privilege_type,a.is_grantable,CASE WHEN a.grantee=c.relowner THEN 'OWNER' "
        "WHEN a.grantee=0 THEN 'PUBLIC' ELSE r.rolname END FROM pg_class c "
        "CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) a "
        "LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE c.oid=to_regclass(%s) ORDER BY 6,4,5", [sequence])
    return {"name": sequence, "acl": cursor.fetchall()}


def verify_tables(cursor, *, installed=True, permissions=True):
    """This generation's own four tables only; no parent recursion.

    verify_receipt_generation already walks every ancestor catalogue itself, so
    it calls this narrow form -- the same split sales_preflight_catalog uses
    between verify_index and verify_catalog.
    """
    cursor.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND relname LIKE 'automation\\_%%' "
        "AND relkind IN ('r','p','v','m','f') ORDER BY relname")
    if [row[0] for row in cursor.fetchall()] != (list(TABLES) if installed else []):
        raise ValueError("Workflow156 automation tables absent, partial, extra or unrecorded")
    if not installed:
        return
    reference = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf8"))
    actual = json.loads(json.dumps(inspect_tables(cursor)))
    for table in TABLES:
        wanted = reference[table]
        if not permissions:
            actual[table].pop("acl")
            wanted = {key: value for key, value in wanted.items() if key != "acl"}
        if actual[table] != wanted:
            raise ValueError("Workflow156 schema/owner/index/constraint/ACL differs: " + table)
    actual_sequence = json.loads(json.dumps(sequence_catalog(cursor)))
    wanted_sequence = reference["sequence"]
    if not permissions:
        actual_sequence = {"name": actual_sequence["name"],
                           "identity": sorted({tuple(row[:3]) for row in actual_sequence["acl"] if row[-1] == "OWNER"})}
        wanted_sequence = {"name": wanted_sequence["name"],
                           "identity": sorted({tuple(row[:3]) for row in wanted_sequence["acl"] if row[-1] == "OWNER"})}
    if actual_sequence != wanted_sequence:
        raise ValueError("Workflow156 sequence ownership or exact privileges differ")


def verify_catalog(cursor, *, installed=True, permissions=True):
    import sales_preflight_catalog as parent
    # No new role is introduced;154's existing grants stay mandatory.
    parent.verify_catalog(cursor, installed=True, permissions=True)
    verify_tables(cursor, installed=installed, permissions=permissions)


def preservation(cursor):
    """Protect the unchanged parent's original rows and ACL contract.

    This generation's own four tables do not exist before install, so they are
    deliberately not part of the preserved set: preservation means "rows that
    must not change", and a table being created cannot have any. The parent's
    contract is therefore returned verbatim rather than re-digested through an
    empty layer, so the intent/result comparison is exactly the parent's.
    """
    import sales_preflight_catalog as parent
    return parent.preservation(cursor)


def verify_initial_values(cursor):
    """The three row-bearing tables must be empty: no business data is seeded.

    This deliberately says nothing about automation_modules. That table is NOT
    empty after install -- 0010's RunPython seeds three registry rows into it --
    and folding that fact in here would make this function's name lie to the
    next reader, who would take a pass as "the new tables are empty". The
    registry is verified separately by verify_registry_rows.
    """
    for table in EMPTY_TABLES:
        cursor.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)").format(sql.Identifier(table)))
        if cursor.fetchone() != (False,):
            raise ValueError("Schema-only Workflow156 adoption cannot seed or import business rows")


def verify_registry_rows(cursor):
    """automation_modules holds exactly 0010's three reviewed registry rows.

    These are code-side registry data, not business data: AutomationModule's
    docstring states the table is "not a user-editable table", the same
    convention workflow.0002_seed_control_rows established for this app's other
    control rows. Every field is compared with the migration's own literal, so a
    row edited after install is caught rather than merely counted.
    """
    expected = registry_rows()
    fields = sorted({key for row in expected.values() for key in row})
    cursor.execute(sql.SQL("SELECT {} FROM {} ORDER BY module_key").format(
        sql.SQL(",").join(sql.Identifier(name) for name in fields), sql.Identifier(REGISTRY_TABLE)))
    actual = [dict(zip(fields, row)) for row in cursor.fetchall()]
    if [row["module_key"] for row in actual] != sorted(expected):
        raise ValueError("Workflow156 module registry membership differs from its migration")
    for row in actual:
        wanted = expected[row["module_key"]]
        for name in fields:
            value = row[name]
            # jsonb/json columns arrive as text on a plain cursor (no Django
            # field adaptation here), so compare the decoded document.
            if isinstance(wanted[name], (list, dict)) and isinstance(value, str):
                value = json.loads(value)
            if value != wanted[name]:
                raise ValueError("Workflow156 module registry values differ: "
                                 + row["module_key"] + "." + name)
    # Every registry column 0010 does not set must still carry its own default.
    cursor.execute(sql.SQL("SELECT contract_version FROM {} ORDER BY module_key").format(
        sql.Identifier(REGISTRY_TABLE)))
    if [row[0] for row in cursor.fetchall()] != [1, 1, 1]:
        raise ValueError("Workflow156 module registry contract version differs")


def verify_defaults(apps):
    from sales_preflight_catalog import verify_defaults as verify_parent
    verify_parent(apps)
    models = models_at_revision()
    if set(models) != set(TABLES):
        raise ValueError("Workflow156 model membership differs")
    indexes = {name: sorted(index.name for index in models[name]._meta.indexes) for name in TABLES}
    if indexes != {"automation_attempts": ["automation_attempt_parent_idx", "automation_attempt_run_idx"],
                   "automation_logical_runs": ["automation_run_subj_date_idx"],
                   "automation_module_results": ["automation_result_evidence_idx", "automation_result_mod_subj_idx"],
                   "automation_modules": ["automation_module_chain_idx"]}:
        raise ValueError("Workflow156 migration-state indexes differ")
    constraints = {name: sorted(c.name for c in models[name]._meta.constraints) for name in TABLES}
    if constraints != {"automation_attempts": ["automation_attempt_native_execution_uq"],
                       "automation_logical_runs": ["automation_logical_run_identity_uq"],
                       "automation_module_results": ["automation_module_result_identity_uq"],
                       "automation_modules": []}:
        raise ValueError("Workflow156 migration-state constraints differ")
    keys = {name: models[name]._meta.pk.column for name in TABLES}
    if keys != {"automation_attempts": "attempt_id", "automation_logical_runs": "logical_run_id",
                "automation_module_results": "id", "automation_modules": "module_key"}:
        raise ValueError("Workflow156 primary keys differ")
    module = apps.get_model("workflow", "AutomationModule")()
    if (module.depends_on != [] or module.allowed_actions != [] or module.imports_data is not True
            or module.schedulable is not True or module.contract_version != 1):
        raise ValueError("Workflow156 module defaults differ")
    run = apps.get_model("workflow", "AutomationLogicalRun")()
    if run.overall_status != "not_due" or run.business_range != {} or run.plan_summary != {}:
        raise ValueError("Workflow156 logical run defaults differ")
    result = apps.get_model("workflow", "AutomationModuleResult")()
    if (result.execution_state != "not_due" or result.business_state != "not_started"
            or result.delivery_state != "not_required" or result.evidence_state != "missing"
            or any(getattr(result, name) != "not_started" for name in
                   ("download_status", "validate_status", "import_status", "verify_status", "release_status"))
            or result.current_row_count is not None or result.netshop_import_batch_id != ""):
        raise ValueError("Workflow156 module result defaults differ")
