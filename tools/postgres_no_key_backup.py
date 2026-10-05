"""Snapshot evidence for the closed integration profile; no recovery keys.

Called only by the existing PostgreSQL maintenance entry point. Credentials
remain with that operator. This module never reads password hashes/key bytes,
starts a server, changes a release gate, or activates a signing role.
"""
from __future__ import annotations

import hashlib
from importlib import import_module
import json
from pathlib import Path
import re
import sys

from psycopg import sql
from protected_ai_shadow_evidence_0073 import _catalog_roots

PROFILE = "teruisi-postgres-no-new-keys-v1"
GENERATION = "0082_no_new_keys_profile"
MAX_TABLES = 512
MAX_ROWS = 100_000_000
MAX_ROLES = 128
MAX_ROW_DIGEST_BYTES = MAX_ROWS * 32
HEX = re.compile(r"[0-9a-f]{64}\Z")
ROLE = re.compile(r"teruisi_[a-z][a-z0-9_]{0,54}\Z")
SETTING = {"default_transaction_read_only", "statement_timeout",
    "idle_in_transaction_session_timeout", "lock_timeout"}
KEY_TABLE = "public.protected_business_budget_v11_verifier_keys"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
        ensure_ascii=True, allow_nan=False).encode("ascii")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def verify_receipt_generation(cursor):
    """Two exact catalogues, never a row-count-based admission shortcut."""
    from integration_migration_plan import load_policy, LEGACY_CATALOGUE_SHA256, DELTA_STEP
    policy = load_policy(Path(__file__).resolve().parents[1] / "config/integration-migration-policy-v3.json")
    baseline = sorted(policy.baseline + policy.steps)
    if len(baseline) != 138 or digest(baseline) != LEGACY_CATALOGUE_SHA256:
        raise RuntimeError("reviewed baseline migration catalogue changed")
    cursor.execute("SELECT app,name FROM public.django_migrations ORDER BY app,name")
    receipts = [".".join(row) for row in cursor.fetchall()]
    if receipts == baseline:
        # A 138 receipt set with partial/unrecorded cache schema is not legacy.
        cursor.execute("SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.netshop_rows') "
                       "AND NOT attisdropped AND attname=ANY(%s)", [[
            "numeric_presence_mask", "numeric_presence_null_mask", "numeric_presence_rule",
            "numeric_presence_row_hash", "numeric_presence_batch_id"]])
        if cursor.fetchone() != (0,):
            raise RuntimeError("legacy generation contains unrecorded cache columns")
        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='netshop_presence_invalidate' "
                       "AND NOT tgisinternal),to_regprocedure('public.netshop_presence_invalidate()') IS NOT NULL")
        if cursor.fetchone() != (False, False):
            raise RuntimeError("legacy generation contains unrecorded cache invalidator")
        return 138
    if receipts == sorted([*baseline, DELTA_STEP]):
        from netshop.promotion_presence import verify_cache_catalog
        verify_cache_catalog(cursor)
        return 139
    if receipts == sorted([*baseline, DELTA_STEP, "finance.0007_finance_erp_targets"]):
        from netshop.promotion_presence import verify_cache_catalog
        verify_cache_catalog(cursor)
        cursor.execute("SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('public.finance_erp_targets') AND attnum>0 AND NOT attisdropped ORDER BY attname")
        if [row[0] for row in cursor.fetchall()] != sorted(["id","period_type","period_key","platform","shop_name","sales_target_cents","version","created_at","updated_at","updated_by"]):
            raise RuntimeError("ERP-goal addition schema differs")
        cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('public.finance_erp_targets') ORDER BY conname")
        if [row[0] for row in cursor.fetchall()] != sorted(["finance_erp_targets_pkey","fin_erp_target_scope_uq","fin_erp_target_period_ck","fin_erp_target_values_ck"]):
            raise RuntimeError("ERP-goal addition constraints differ")
        cursor.execute("SELECT t.tgtype,p.proname,t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=to_regclass('public.finance_erp_targets') AND t.tgname='finance_erp_target_revision_required' AND NOT t.tgisinternal")
        if cursor.fetchall()!=[(30,"finance_source_mark_revision_required","O")]:
            raise RuntimeError("ERP-goal addition revision guard differs")
        return 140
    raise RuntimeError("no-key backup migration catalogue is not a reviewed generation")


def verify_closed_profile(db):
    with db.cursor() as cursor:
        cursor.execute("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
        if cursor.fetchone() != (True,):
            raise RuntimeError("no-key backup requires the existing privileged maintenance identity")
        verify_receipt_generation(cursor)
        # Hold this lock until pg_dump exits. It blocks inserts/DDL even by an
        # administrator, closing the precheck-to-dump race for private keys.
        cursor.execute("LOCK TABLE " + KEY_TABLE + " IN SHARE MODE")
        import_module("ai_assistant.migrations." + GENERATION).verify_catalog(cursor)
        import_module("ai_assistant.migrations.0081_readiness_catalog_probe").verify_catalog(cursor)
        cursor.execute("SELECT has_table_privilege('teruisi_sales_owner',%s,'SELECT'),"
            "has_any_column_privilege('teruisi_sales_owner',%s,'SELECT')", [KEY_TABLE] * 2)
        if cursor.fetchone() != (False, False):
            raise RuntimeError("ordinary owner has private key access")
        # NOT EXISTS exposes only a boolean and does not fetch secret bytes.
        cursor.execute("SELECT NOT EXISTS(SELECT 1 FROM " + KEY_TABLE + ")")
        if cursor.fetchone() != (True,):
            raise RuntimeError("private key material exists; plain archive refused")


def stream_table_roots(db):
    names = [row[0] for row in db.execute("SELECT tablename FROM pg_tables "
        "WHERE schemaname='public' ORDER BY tablename").fetchall()]
    if not names or len(names) > MAX_TABLES:
        raise RuntimeError("backup table inventory exceeds the reviewed bound")
    result = {}
    total = 0
    # Sort fixed-size row hashes in PostgreSQL, stream just the digests. No raw
    # business rows enter Python, logs, or the manifest; duplicate rows count.
    for index, name in enumerate(names):
        hasher = hashlib.sha256()
        count = 0
        with db.cursor(name="backup_rows_" + str(index)) as cursor:
            cursor.itersize = 4096
            cursor.execute(sql.SQL("SELECT sha256(convert_to(row_to_json(t)::text,'UTF8')) AS h "
                "FROM public.{} t ORDER BY h").format(sql.Identifier(name)))
            for (row_hash,) in cursor:
                if not isinstance(row_hash, bytes) or len(row_hash) != 32:
                    raise RuntimeError("invalid row digest")
                total += 1
                count += 1
                if total > MAX_ROWS:
                    raise RuntimeError("backup row count exceeds the reviewed bound")
                hasher.update(row_hash)
        result[name] = {"rows": count, "sha256": hasher.hexdigest()}
    return result


def role_contract(db):
    roles = db.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,"
        "rolcreaterole,rolreplication,rolbypassrls,rolconnlimit "
        "FROM pg_roles WHERE rolname LIKE 'teruisi\\_%' ESCAPE '\\' ORDER BY rolname").fetchall()
    database = db.execute("SELECT current_database()").fetchone()[0]
    settings = db.execute("SELECT r.rolname,COALESCE(d.datname,''),s.setconfig "
        "FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole "
        "LEFT JOIN pg_database d ON d.oid=s.setdatabase "
        "WHERE r.rolname LIKE 'teruisi\\_%' ESCAPE '\\' ORDER BY r.rolname,d.datname").fetchall()
    contract = {"roles": [list(row) for row in roles],
        "settings": [list(row) for row in settings]}
    validate_roles(contract, database)
    if db.execute("SELECT count(*) FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid "
            "JOIN pg_roles c ON c.oid=m.member WHERE p.rolname LIKE 'teruisi\\_%' ESCAPE '\\' "
            "OR c.rolname LIKE 'teruisi\\_%' ESCAPE '\\'").fetchone() != (0,):
        raise RuntimeError("backup roles have unreviewed memberships")
    return contract


def validate_roles(value, database):
    if (type(value) is not dict or set(value) != {"roles", "settings"}
            or type(value["roles"]) is not list or not 1 <= len(value["roles"]) <= MAX_ROLES
            or type(value["settings"]) is not list or len(value["settings"]) > MAX_ROLES * 2):
        raise RuntimeError("invalid backup role contract")
    names = set()
    for row in value["roles"]:
        if (type(row) is not list or len(row) != 9 or not isinstance(row[0], str)
                or not ROLE.fullmatch(row[0]) or row[0] in names
                or any(type(flag) is not bool for flag in row[1:8])
                or any(row[3:8]) or type(row[8]) is not int or not -1 <= row[8] <= 1000):
            raise RuntimeError("privileged or invalid backup role")
        names.add(row[0])
    keys = set()
    for row in value["settings"]:
        if (type(row) is not list or len(row) != 3 or row[0] not in names
                or row[1] not in ("", database) or (row[0], row[1]) in keys
                or type(row[2]) is not list or len(row[2]) > len(SETTING)):
            raise RuntimeError("invalid role settings scope")
        keys.add((row[0], row[1]))
        seen = set()
        for item in row[2]:
            if type(item) is not str or "=" not in item:
                raise RuntimeError("invalid role setting")
            key, setting = item.split("=", 1)
            if (key not in SETTING or key in seen or not re.fullmatch(
                    r"(?:on|off|[0-9]{1,9}(?:ms|s|min)?)", setting)):
                raise RuntimeError("unreviewed role setting")
            seen.add(key)


def policy_rows(db):
    return db.execute("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,"
        "with_check FROM pg_policies ORDER BY 1,2,3").fetchall()


def normalized_policies(rows):
    from postgres_restore_semantics import normalize_dump_expression
    if not isinstance(rows, (list, tuple)) or len(rows) > 512:
        raise RuntimeError("RLS policy witness exceeds bound")
    normalized = []
    for row in rows:
        if (not isinstance(row, (list, tuple)) or len(row) != 8
                or not all(isinstance(row[i], str) for i in (0,1,2,3,5))
                or not isinstance(row[4], (list, tuple)) or len(row[4]) > MAX_ROLES
                or not all(isinstance(role, str) for role in row[4])
                or any(value is not None and (not isinstance(value, str) or len(value) > 262144)
                    for value in row[6:])):
            raise RuntimeError("invalid RLS policy witness")
        normalized.append([*row[:4], list(row[4]), row[5],
            *(normalize_dump_expression(value) if value is not None else None for value in row[6:])])
    return normalized


def read_policy_witness(path, approved_sha256):
    path = Path(path)
    if (not HEX.fullmatch(str(approved_sha256)) or not path.is_file() or path.is_symlink()
            or path.stat().st_nlink != 1 or path.stat().st_size > 1024*1024):
        raise RuntimeError("invalid policy witness file")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != approved_sha256:
        raise RuntimeError("policy witness file changed")
    def unique(items):
        result = {}
        for key, value in items:
            if key in result: raise RuntimeError("duplicate policy witness key")
            result[key] = value
        return result
    value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique)
    if type(value) is not dict or set(value) != {"readOnly","policies"} or value["readOnly"] is not True:
        raise RuntimeError("invalid policy witness shape")
    normalized_policies(value["policies"])
    return value["policies"]


def collect(db, *, legacy_catalog=False):
    verify_closed_profile(db)
    db.execute("SET LOCAL TIME ZONE 'UTC'")
    db.execute("SET LOCAL search_path=pg_catalog,public")
    db.execute("SET LOCAL extra_float_digits=3")
    schemas = db.execute("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
        "AND nspname NOT IN ('public','information_schema')").fetchall()
    if schemas or db.execute("SELECT count(*) FROM pg_largeobject_metadata").fetchone() != (0,):
        raise RuntimeError("unreviewed schema or large objects in no-key backup")
    roles = role_contract(db)
    if db.execute("SELECT count(*) FROM pg_sequences WHERE schemaname='public' "
            "AND (increment_by<=0 OR cycle)").fetchone() != (0,):
        raise RuntimeError("sequence lower-bound recovery requires noncycling increasing sequences")
    catalog = _catalog_roots(db, logical_restore=True, sequence_positions=False)["sections"]
    # Include properties omitted by the historical synthetic collector.
    details = {
        "triggers": db.execute("SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) "
            "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n "
            "ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal "
            "ORDER BY c.relname,t.tgname").fetchall(),
        "defaultAcl": db.execute("SELECT pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),"
            "d.defaclobjtype,d.defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n "
            "ON n.oid=d.defaclnamespace ORDER BY 1,2,3").fetchall(),
        "policies": policy_rows(db),
        "functionAttributes": db.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid),"
            "p.provolatile,p.proisstrict,p.proleakproof,p.proparallel,p.prorettype::regtype::text,"
            "p.proretset FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
            "WHERE n.nspname='public' ORDER BY 1,2").fetchall(),
        "extensions": db.execute("SELECT extname,extversion,pg_get_userbyid(extowner) "
            "FROM pg_extension ORDER BY extname").fetchall(),
    }
    if legacy_catalog:
        # Compatibility with the first, pre-adoption v1 evidence shape.
        details["functions"] = details.pop("functionAttributes")
    else:
        # Preserve the original function body/owner/ACL root. Additional
        # attributes must not overwrite it under the same section name.
        details["policies"] = normalized_policies(details["policies"])
    catalog.update({key: digest(rows) for key, rows in details.items()})
    tables = stream_table_roots(db)
    sequences = {}
    for (name,) in db.execute("SELECT sequencename FROM pg_sequences WHERE schemaname='public' "
            "ORDER BY sequencename").fetchall():
        last, called = db.execute(sql.SQL("SELECT last_value,is_called FROM public.{}").format(
            sql.Identifier(name))).fetchone()
        sequences[name] = {"minimumLastValue": last, "isCalled": called}
    content = {"profile": PROFILE, "roles": roles, "tables": tables, "catalog": catalog}
    return {**content, "contentSha256": digest(content), "sequenceLowerBounds": sequences,
        "archiveEncrypted": False, "newRecoveryKeyGenerated": False, "privateKeyRows": 0}


def verify_restored(expected, actual, *, source_policy_rows=None, restored_policy_rows=None):
    validate_evidence(expected)
    validate_evidence(actual)
    if actual["catalog"].get("policies") != expected["catalog"].get("policies"):
        # Legacy evidence stored only a raw policy digest. A witness must match
        # that exact archived digest before narrow parser equivalence is used.
        if (source_policy_rows is None or restored_policy_rows is None
                or digest(source_policy_rows) != expected["catalog"].get("policies")
                or digest(restored_policy_rows) != actual["catalog"].get("policies")
                or normalized_policies(source_policy_rows) != normalized_policies(restored_policy_rows)):
            raise RuntimeError("restored RLS policies differ without a bound equivalence witness")
        actual = {**actual, "catalog": {**actual["catalog"], "policies": expected["catalog"]["policies"]}}
        actual["contentSha256"] = digest({key: actual[key] for key in ("profile","roles","tables","catalog")})
    if actual["contentSha256"] != expected["contentSha256"]:
        raise RuntimeError("restored rows/roles/owner/ACL differ from backup snapshot")
    if set(expected["sequenceLowerBounds"]) != set(actual["sequenceLowerBounds"]):
        raise RuntimeError("restored sequence inventory differs")
    for name, before in expected["sequenceLowerBounds"].items():
        after = actual["sequenceLowerBounds"][name]
        if (after["minimumLastValue"] < before["minimumLastValue"]
                or before["isCalled"] and not after["isCalled"]):
            raise RuntimeError("restored sequence is behind the backup snapshot")
    return actual


def validate_evidence(value):
    wanted = {"profile", "roles", "tables", "catalog", "contentSha256", "sequenceLowerBounds",
        "archiveEncrypted", "newRecoveryKeyGenerated", "privateKeyRows"}
    if (type(value) is not dict or set(value) != wanted or value["profile"] != PROFILE
            or value["archiveEncrypted"] is not False or value["newRecoveryKeyGenerated"] is not False
            or type(value["privateKeyRows"]) is not int or value["privateKeyRows"] != 0):
        raise RuntimeError("invalid no-key archive evidence")
    for section in ("tables", "catalog", "sequenceLowerBounds"):
        if type(value[section]) is not dict or len(value[section]) > MAX_TABLES:
            raise RuntimeError("invalid bounded evidence section")
    for name, row in value["tables"].items():
        if (not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", name) or type(row) is not dict
                or set(row) != {"rows", "sha256"} or type(row["rows"]) is not int
                or not 0 <= row["rows"] <= MAX_ROWS or not HEX.fullmatch(str(row["sha256"]))):
            raise RuntimeError("invalid table evidence")
    if not value["tables"] or any(not HEX.fullmatch(str(item)) for item in value["catalog"].values()):
        raise RuntimeError("empty or invalid content evidence")
    for row in value["sequenceLowerBounds"].values():
        if (type(row) is not dict or set(row) != {"minimumLastValue", "isCalled"}
                or type(row["minimumLastValue"]) is not int or type(row["isCalled"]) is not bool):
            raise RuntimeError("invalid sequence evidence")
    core = {key: value[key] for key in ("profile", "roles", "tables", "catalog")}
    if value["contentSha256"] != digest(core):
        raise RuntimeError("no-key evidence digest mismatch")


def provision_restore_roles(db, contract, *, expected_database, expected_port):
    """Only a fresh isolated cluster. LOGIN flags have NULL credentials until
    an explicit runtime recovery supplies its separately held credentials.
    """
    validate_roles(contract, expected_database)
    identity = db.execute("SELECT current_database(),inet_server_addr()::text,inet_server_port(),"
        "rolsuper FROM pg_roles WHERE rolname=current_user").fetchone()
    if (identity is None or identity[0] != "postgres" or identity[1] not in ("127.0.0.1", "127.0.0.1/32")
            or identity[2] != expected_port or not 55432 <= expected_port <= 55999 or identity[3] is not True):
        raise RuntimeError("role restoration requires a fresh loopback rehearsal cluster")
    if db.execute("SELECT count(*) FROM pg_roles WHERE rolname LIKE 'teruisi\\_%' ESCAPE '\\'"
            ).fetchone() != (0,):
        raise RuntimeError("restore cluster already contains application roles")
    for name, login, inherit, *flags in contract["roles"]:
        db.execute(sql.SQL("CREATE ROLE {} {} {} NOSUPERUSER NOCREATEDB NOCREATEROLE "
            "NOREPLICATION NOBYPASSRLS CONNECTION LIMIT {} PASSWORD NULL").format(
            sql.Identifier(name), sql.SQL("LOGIN" if login else "NOLOGIN"),
            sql.SQL("INHERIT" if inherit else "NOINHERIT"), sql.Literal(flags[-1])))


def apply_restore_role_settings(db, contract, database):
    validate_roles(contract, database)
    for name, scope, values in contract["settings"]:
        for item in values:
            key, value = item.split("=", 1)
            clause = sql.SQL(" IN DATABASE {} ").format(sql.Identifier(scope)) if scope else sql.SQL(" ")
            db.execute(sql.SQL("ALTER ROLE {}{}").format(sql.Identifier(name), clause)
                + sql.SQL("SET {}={}").format(sql.Identifier(key), sql.Literal(value)))


def read_manifest(path, approved_sha256, archive, database):
    path = Path(path)
    if (not isinstance(approved_sha256, str) or not HEX.fullmatch(approved_sha256)
            or not path.is_file() or path.is_symlink() or path.stat().st_nlink != 1
            or path.stat().st_size > 4 * 1024 * 1024):
        raise RuntimeError("no-key restore requires an approved bounded manifest")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != approved_sha256:
        raise RuntimeError("backup manifest changed")
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError("duplicate backup manifest key")
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=unique)
    if (not isinstance(value, dict) or value.get("version") != "teruisi-postgres-daily-backup-v2-no-keys"
            or value.get("status") != "completed" or value.get("database", {}).get("name") != database):
        raise RuntimeError("unreviewed backup manifest")
    profile = value.get("profileEvidence")
    validate_evidence(profile)
    validate_roles(profile["roles"], database)
    with Path(archive).open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if value.get("dump", {}).get("sha256") != actual:
        raise RuntimeError("backup archive changed")
    return profile
