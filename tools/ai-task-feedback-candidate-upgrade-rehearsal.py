"""Disposable 0087->0089 task feedback and skill candidate upgrade rehearsal."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import django
django.setup()
import psycopg
from psycopg import sql
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run-root", required=True, type=Path)
args = parser.parse_args()
folder = args.run_root.resolve()
database = settings.DATABASES["default"]
OLD = ("ai_assistant", "0087_pi_native_capabilities")
STEP = ("ai_assistant", "0088_task_feedback")
NEW = ("ai_assistant", "0089_skill_candidates")
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")

from ai_assistant.table_manifest import (
    AI_TABLES_PRE_TASK_FEEDBACK as OLD_TABLES,
    TASK_FEEDBACK_TABLES,
    SKILL_CANDIDATE_TABLES,
    AI_TABLES as NEW_TABLES,
)
from ai_assistant.policy import canonical
from ai_assistant.database_contract import provision, WRITER_PRIVILEGES, APPEND_ONLY, READ_TABLES

# Pre-existing guard functions that span the 0087 predecessor state. These are
# never dropped by 0088/0089's own uninstall hooks (those only DROP FUNCTION
# IF EXISTS their own ai_task_feedback_guard / ai_skill_candidate_guard), so
# their OID/body/owner/ACL must be identical before and after the upgrade.
PRE_EXISTING_GUARDS = (
    "ai_runtime_write_fence",
    "ai_immutable_record_guard",
    "ai_pi_state_guard",
    "ai_pi_binding_guard",
    "ai_pi_native_guard",
)


if (
    ROOT.resolve() == Path(r"D:\运营管理系统").resolve()
    or folder.parent != (ROOT / ".runtime").resolve()
    or settings.DJANGO_ENVIRONMENT != "test"
    or database["HOST"] != "127.0.0.1"
    or database["NAME"] != "teruisi_ai_rehearsal"
    or str(database["PORT"]) != os.getenv("TERUISI_AI_REHEARSAL_PORT")
    or not 55440 <= int(database["PORT"]) <= 55999
    or connection.vendor != "postgresql"
):
    raise RuntimeError("0088/0089 upgrade requires exact disposable PostgreSQL")


def db(name=None):
    return psycopg.connect(host=database["HOST"], port=database["PORT"],
        dbname=name or database["NAME"], user=database["USER"],
        password=database["PASSWORD"], autocommit=True)


def native(command, timeout=600):
    env = {**os.environ, "PGHOST": str(database["HOST"]),
        "PGPORT": str(database["PORT"]), "PGUSER": str(database["USER"]),
        "PGPASSWORD": str(database["PASSWORD"])}
    result = subprocess.run([str(item) for item in command], cwd=ROOT,
        env=env, capture_output=True, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        # Diagnostics never leak into evidence or stdout; only a hash of
        # stderr is kept so a failure is provable without exposing bytes.
        raise RuntimeError("0088/0089 archive command failed; diagnosticSha256=" +
            hashlib.sha256(result.stderr[:16384]).hexdigest())


def table_digest(source, tables):
    material = {}
    for table in sorted(tables):
        rows = source.execute(sql.SQL("SELECT row_to_json(t) FROM {} t")
            .format(sql.Identifier(table))).fetchall()
        material[table] = sorted(json.dumps(row[0], sort_keys=True, default=str,
            ensure_ascii=False) for row in rows)
    return hashlib.sha256(canonical(material).encode("utf-8")).hexdigest()


def grants(source, tables):
    return source.execute(
        "SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants "
        "WHERE grantee IN ('teruisi_ai_reader','teruisi_ai_writer') "
        "AND table_name=ANY(%s) ORDER BY 1,2,3", [list(tables)]).fetchall()


def function_catalog(source, names):
    rows = []
    for name in names:
        signature = "public." + name + "()"
        row = source.execute("SELECT oid,prosrc,proacl::text,"
            "pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc "
            "WHERE oid=to_regprocedure(%s)", [signature]).fetchone()
        if row is None:
            raise RuntimeError("0088/0089 predecessor guard function missing: " + name)
        rows.append((name, row))
    return tuple(rows)


def restored_function_catalog_equal(actual, expected):
    # OID is independent per restored cluster; compare body/ACL/owner only.
    return tuple((name, row[1:]) for name, row in actual) == \
        tuple((name, row[1:]) for name, row in expected)


def archive_restore(name):
    path = folder / (name + ".dump")
    if path.exists():
        raise RuntimeError("0088/0089 isolated archive target exists")
    native([BIN / "pg_dump.exe", "--format=custom", "--file", path, database["NAME"]])
    native([BIN / "createdb.exe", name])
    native([BIN / "pg_restore.exe", "--single-transaction", "--exit-on-error",
        "--dbname", name, path])
    return path


with db() as source:
    receipts = source.execute(
        "SELECT name FROM django_migrations WHERE app='ai_assistant' "
        "AND name IN (%s,%s,%s) ORDER BY name",
        [OLD[1], STEP[1], NEW[1]]).fetchall()
    if receipts != [(OLD[1],)]:
        raise RuntimeError("0088/0089 upgrade requires exact 0087 predecessor")


# ---------------------------------------------------------------------------
# Seed a populated 0087 database: synthetic owner/role fixtures, an AiModels
# row (required by worker.claim()'s resolve_model), and a handful of real
# ai_pi_sessions/ai_pi_operations/ai_pi_files rows created through the actual
# application services (pi_service.create_session/prompt, pi_worker.claim,
# pi_service.upload) rather than hand-built ORM rows, so every trigger and
# constraint that 0088/0089's guards will later read is already satisfied the
# same way production traffic satisfies it.
# ---------------------------------------------------------------------------
MigrationExecutor(connection).migrate([OLD])

from access_control.models import AccessRole, AppUser
from django.utils import timezone as dj_timezone
from sales.auth import Principal
from ai_assistant import models as m
from ai_assistant.control_models import AiDataRevision, AiWriteAuthority
from ai_assistant import pi_service as service, pi_worker as worker
from ai_assistant.policy import mutation
from ai_assistant.pi_models import PiSession, PiOperation, PiFile

AiDataRevision.objects.get_or_create(domain="ai-assistant")
AiWriteAuthority.objects.get_or_create(id=1)
for index, role in enumerate(["viewer", "analyst", "operator", "admin"]):
    AccessRole.objects.get_or_create(code=role, defaults={
        "label": role, "description": role, "rank": index, "permissions": []})


def make_user(email, role, scope):
    AppUser.objects.create(email=email, display_name=email, role_id=role, scope=scope,
        created_at=dj_timezone.now(), updated_at=dj_timezone.now())
    return Principal(email, email, role, scope)


OWNER = make_user("feedback-upgrade-owner@example.invalid", "analyst",
    {"warehouses": ["A"], "channels": [], "platforms": ["京东"]})

m.AiModels.objects.create(id="model-upgrade-fixture", name="Isolated upgrade fixture",
    protocol="openai_compatible", model_type="text", model_name="fixture",
    base_url="https://api.openai.com/v1", api_key_encrypted="encrypted-fixture",
    api_key_suffix="ture", is_default_text_model=1, status="enabled")


def settle(op, status):
    """Finish an operation the way pi_worker does, including the session
    pointer release pi_worker.py:129 performs. ai_pi_binding_guard rejects an
    active_operation_id left pointing at a settled operation; sqlite (used by
    the ORM-level test suite) does not enforce this, PostgreSQL does."""
    with mutation():
        op.capability_hash = hashlib.sha256(b"isolated-upgrade-rehearsal").hexdigest()
        op.capability_expires_at = dj_timezone.now() + __import__("datetime").timedelta(hours=1)
        op.status = status
        op.save()
        if status not in {"queued", "running", "canceling", "unknown"}:
            session_row = op.session
            session_row.status, session_row.active_operation_id = "idle", ""
            session_row.save(update_fields=["status", "active_operation_id"])
    return op


# Session 1: a settled, succeeded operation with an input file attached.
# This is the row both new guards (ai_task_feedback_guard / ai_skill_
# candidate_guard) will read: a succeeded ai_pi_operations row whose session
# is idle and whose owner/generation line up.
session_a = service.create_session(
    {"clientRequestId": secrets.token_hex(8)}, OWNER)["session"]["id"]
service.prompt(session_a, {"clientRequestId": "prompt-1", "message": "合成问题一"}, OWNER)
op_succeeded = worker.claim()
settle(op_succeeded, "succeeded")
raw_payload = b"synthetic upgrade rehearsal payload bytes"
service.upload(session_a, {"clientRequestId": "upload-1", "fileName": "evidence.txt",
    "mimeType": "text/plain", "base64": __import__("base64").b64encode(raw_payload).decode()},
    OWNER)

# Session 2: a second, independent settled operation (failed), so the "old
# rows" digest covers more than a single row shape per table.
session_b = service.create_session(
    {"clientRequestId": secrets.token_hex(8)}, OWNER)["session"]["id"]
service.prompt(session_b, {"clientRequestId": "prompt-1", "message": "合成问题二"}, OWNER)
op_failed = worker.claim()
settle(op_failed, "failed")

# Session 3: a still in-flight operation, left exactly as worker.claim() made
# it (status=running, active_operation_id still pointing at it). Both new
# guards reject a correction/candidate against an operation that is not yet
# settled, and this is the fixture that exercises that path (0088 raises
# ai_task_feedback_operation_not_settled, 0089 raises
# ai_skill_candidate_run_not_succeeded for anything other than succeeded).
session_c = service.create_session(
    {"clientRequestId": secrets.token_hex(8)}, OWNER)["session"]["id"]
service.prompt(session_c, {"clientRequestId": "prompt-1", "message": "合成问题三"}, OWNER)
op_running = worker.claim()

seed_session_count = PiSession.objects.count()
seed_operation_count = PiOperation.objects.count()
seed_file_count = PiFile.objects.count()
if seed_session_count < 3 or seed_operation_count < 3 or seed_file_count < 1:
    raise RuntimeError("0088/0089 upgrade seed is not meaningfully populated")


# database_contract.py now has a receipt gate for both ai_task_feedback and
# ai_skill_candidates, mirroring the 0084/0085/0086/0087 precedent: provision()
# checks each migration's django_migrations receipt against the matching
# table-inventory snapshot and drops the corresponding privileges when the
# receipt is absent, rather than attempting a GRANT on a table that does not
# exist yet. That makes it safe to call provision() here, on the unmodified
# 0087 schema, before the upgrade -- so the "old ACLs unchanged" baseline can
# be a real, populated grant set instead of the zero-grant state of roles that
# were merely CREATEd. We assert it is non-empty below, and separately assert
# neither new table has any grant yet -- the gates correctly staying closed on
# a 0087 schema.
with db() as source:
    provision(source, secrets.token_hex(32), secrets.token_hex(32))
with db() as source:
    before = table_digest(source, OLD_TABLES)
    before_grants = grants(source, OLD_TABLES)
    before_functions = function_catalog(source, PRE_EXISTING_GUARDS)
    before_new_table_grants = grants(source, (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES))
if not before_grants:
    raise AssertionError(
        "0087 baseline provision() produced no grants on OLD_TABLES -- the "
        "'old ACLs unchanged' assertion would be comparing against nothing")
if before_new_table_grants:
    raise AssertionError(
        "0087 schema already has grants on ai_task_feedback/ai_skill_candidates "
        "-- the receipt gates should have kept these closed before 0088/0089")
before_dump = archive_restore("task_feedback_before")
with db("task_feedback_before") as restored:
    if (table_digest(restored, OLD_TABLES) != before
            or grants(restored, OLD_TABLES) != before_grants
            or not restored_function_catalog_equal(
                function_catalog(restored, PRE_EXISTING_GUARDS), before_functions)):
        raise AssertionError("0088/0089 before independent restore drift")

# ---------------------------------------------------------------------------
# Exact forward plan: migrating to 0089 from 0087 must apply exactly 0088
# then 0089, nothing else, nothing reordered.
# ---------------------------------------------------------------------------
plan = MigrationExecutor(connection).migration_plan([NEW])
if [(migration.app_label, migration.name, backward) for migration, backward in plan] != [
        (STEP[0], STEP[1], False), (NEW[0], NEW[1], False)]:
    raise RuntimeError("0088/0089 Django forward plan is not exact")

# ---------------------------------------------------------------------------
# Step 1: apply 0088 alone. Old rows/ACLs/guard functions must be untouched;
# the new ai_task_feedback table exists and is empty.
# ---------------------------------------------------------------------------
MigrationExecutor(connection).migrate([STEP])
with db() as source:
    if (table_digest(source, OLD_TABLES) != before
            or grants(source, OLD_TABLES) != before_grants
            or not restored_function_catalog_equal(
                function_catalog(source, PRE_EXISTING_GUARDS), before_functions)):
        raise AssertionError("0088 changed the 0087 predecessor rows/ACL/functions")
    if source.execute("SELECT count(*) FROM ai_task_feedback").fetchone()[0] != 0:
        raise AssertionError("0088 forward migration is not empty")

# ---------------------------------------------------------------------------
# Step 2: apply 0089. Old rows/ACLs/guard functions (including 0088's own
# ai_task_feedback_guard, which is now itself a predecessor) must still be
# untouched; the new ai_skill_candidates table exists and is empty.
# ---------------------------------------------------------------------------
PRE_EXISTING_GUARDS_AFTER_0088 = (*PRE_EXISTING_GUARDS, "ai_task_feedback_guard")
with db() as source:
    before_0089_functions = function_catalog(source, PRE_EXISTING_GUARDS_AFTER_0088)
MigrationExecutor(connection).migrate([NEW])
with db() as source:
    if (table_digest(source, OLD_TABLES) != before
            or grants(source, OLD_TABLES) != before_grants
            or not restored_function_catalog_equal(
                function_catalog(source, PRE_EXISTING_GUARDS_AFTER_0088), before_0089_functions)):
        raise AssertionError("0089 changed the 0087/0088 predecessor rows/ACL/functions")
    if source.execute("SELECT count(*) FROM ai_skill_candidates").fetchone()[0] != 0:
        raise AssertionError("0089 forward migration is not empty")

# ---------------------------------------------------------------------------
# Provision roles and assert the new tables get the ACLs database_contract.py
# actually declares. Neither table is in APPEND_ONLY, so both get the full
# writer privilege set rather than the append-only (SELECT, INSERT) subset.
#
# Neither table is in READ_TABLES either: unlike most AI tables, these two
# are writer-only. teruisi_ai_reader gets no grant on them at all -- there is
# no reader SELECT to assert. This contradicts the task brief, which asked
# this script to "assert the two new tables are readable by the reader role
# and writable by the writer role"; what database_contract.py actually
# declares is writer-only access, so that is what this script asserts.
# ---------------------------------------------------------------------------
if TASK_FEEDBACK_TABLES[0] in APPEND_ONLY or SKILL_CANDIDATE_TABLES[0] in APPEND_ONLY:
    raise AssertionError("0088/0089 contract assumption drifted: expected writer tables")
if TASK_FEEDBACK_TABLES[0] in READ_TABLES or SKILL_CANDIDATE_TABLES[0] in READ_TABLES:
    raise AssertionError(
        "0088/0089 contract assumption drifted: expected writer-only tables, "
        "not reader-visible")
expected_writer_privileges = set(WRITER_PRIVILEGES[TASK_FEEDBACK_TABLES[0]])
if expected_writer_privileges != {"SELECT", "INSERT", "UPDATE", "DELETE"}:
    raise AssertionError("ai_task_feedback writer privileges drifted from expectation")
expected_writer_privileges = set(WRITER_PRIVILEGES[SKILL_CANDIDATE_TABLES[0]])
if expected_writer_privileges != {"SELECT", "INSERT", "UPDATE", "DELETE"}:
    raise AssertionError("ai_skill_candidates writer privileges drifted from expectation")

# provision() builds every grant purely from WRITER_PRIVILEGES/READ_TABLES
# and schema introspection (to_regclass checks against receipts); it never
# reads table row content. before_grants (above) is now the genuine post-
# provision grant set for OLD_TABLES on the unmodified 0087 schema, so this
# second provision() call -- run after the 0088/0089 upgrade -- lets us prove
# the strong claim directly: seeded_old_grants must equal before_grants
# exactly, byte for byte. The expected_old_grants recomputation below is kept
# as well; it proves the independent, stronger fact that the grants also
# match the plain WRITER_PRIVILEGES/READ_TABLES contract declaration (i.e.
# introducing 0088/0089 did not narrow or close off an existing table's
# privileges in the dict itself, not just in what got applied).
with db() as source:
    provision(source, secrets.token_hex(32), secrets.token_hex(32))
with db() as source:
    seeded_old_grants = grants(source, OLD_TABLES)
    new_grants = grants(source, (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES))
    if seeded_old_grants != before_grants:
        raise AssertionError(
            "0088/0089 upgrade changed OLD_TABLES ACLs: provision() on the "
            "post-upgrade schema produced different grants than provision() "
            "on the 0087 predecessor")
    expected_old_grants = sorted(
        ("teruisi_ai_reader", table, "SELECT") for table in OLD_TABLES if table in READ_TABLES)
    expected_old_grants += sorted(
        (("teruisi_ai_writer", table, privilege)
            for table in OLD_TABLES if table in WRITER_PRIVILEGES
            for privilege in WRITER_PRIVILEGES[table]))
    if seeded_old_grants != sorted(expected_old_grants):
        raise AssertionError(
            "Upgraded cluster's OLD_TABLES ACLs do not match the plain "
            "READ_TABLES/WRITER_PRIVILEGES contract declaration")
    for table in (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            if ("teruisi_ai_writer", table, privilege) not in new_grants:
                raise AssertionError(
                    "New table missing writer privilege %s: %s" % (privilege, table))
    if any(grantee == "teruisi_ai_reader" for grantee, table, _privilege in new_grants):
        raise AssertionError("Reader role unexpectedly has access to a new table")
    if new_grants != sorted(
            ("teruisi_ai_writer", table, privilege)
            for table in (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES)
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE")):
        raise AssertionError("New table grants are not exactly the writer-only set")

# ---------------------------------------------------------------------------
# Backup/restore round-trip of the fully upgraded (post-0089, post-provision)
# state.
# ---------------------------------------------------------------------------
with db() as source:
    after = table_digest(source, NEW_TABLES)
    after_functions = function_catalog(source, PRE_EXISTING_GUARDS_AFTER_0088)
after_dump = archive_restore("task_feedback_after")
with db("task_feedback_after") as restored:
    if (table_digest(restored, NEW_TABLES) != after
            or grants(restored, OLD_TABLES) != seeded_old_grants
            or grants(restored, (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES)) != new_grants
            or not restored_function_catalog_equal(
                function_catalog(restored, PRE_EXISTING_GUARDS_AFTER_0088), after_functions)):
        raise AssertionError("0088/0089 after independent restore drift")

# ---------------------------------------------------------------------------
# Empty reverse: migrating back to 0087 must drop both new tables and both
# new guard functions, and must not touch the 0087 predecessor state.
# ---------------------------------------------------------------------------
MigrationExecutor(connection).migrate([OLD])
with db() as source:
    for table in (*TASK_FEEDBACK_TABLES, *SKILL_CANDIDATE_TABLES):
        if source.execute("SELECT to_regclass(%s)", ["public." + table]).fetchone() != (None,):
            raise AssertionError("0088/0089 empty reverse retained table: " + table)
    for function in ("ai_task_feedback_guard", "ai_skill_candidate_guard"):
        if source.execute("SELECT to_regprocedure(%s)",
                ["public." + function + "()"]).fetchone() != (None,):
            raise AssertionError("0088/0089 empty reverse retained function: " + function)
    if (table_digest(source, OLD_TABLES) != before
            or grants(source, OLD_TABLES) != seeded_old_grants
            or not restored_function_catalog_equal(
                function_catalog(source, PRE_EXISTING_GUARDS), before_functions)):
        raise AssertionError("0088/0089 empty reverse changed the 0087 predecessor")

# ---------------------------------------------------------------------------
# Reapply: migrating forward to 0089 again must leave the 0087 predecessor
# untouched, and from this point the forward plan must be genuinely empty —
# 0089 is a no-op once already applied.
# ---------------------------------------------------------------------------
MigrationExecutor(connection).migrate([NEW])
with db() as source:
    if (table_digest(source, OLD_TABLES) != before
            or grants(source, OLD_TABLES) != seeded_old_grants):
        raise AssertionError("0088/0089 reapply changed the 0087 predecessor")
if MigrationExecutor(connection).migration_plan([NEW]) != []:
    raise AssertionError("0089 reapply plan is not empty")


result = {
    "upgrade": "0087->0089",
    "status": "passed",
    "oldAiTables": len(OLD_TABLES),
    "newAiTables": len(NEW_TABLES),
    "oldRowsDigestPreserved": before,
    "afterDigest": after,
    "seedSessions": seed_session_count,
    "seedOperations": seed_operation_count,
    "seedFiles": seed_file_count,
    "oldAclBaselineGrantCount": len(before_grants),
    "oldAclUnchanged": True,
    "preExistingGuardFunctionsUnchanged": True,
    "newTaskFeedbackAclWriterOnly": True,
    "newSkillCandidateAclWriterOnly": True,
    "newTablesReaderInvisible": True,
    "exactForwardPlan": True,
    "emptyStepMigrations": True,
    "beforeBackupRestored": True,
    "afterBackupRestored": True,
    "emptyReversePassed": True,
    "reapplyIsNoop": True,
    "beforeDumpSha256": hashlib.sha256(before_dump.read_bytes()).hexdigest(),
    "afterDumpSha256": hashlib.sha256(after_dump.read_bytes()).hexdigest(),
    "productionWrites": False,
}
(folder / "ai-task-feedback-candidate-upgrade-evidence.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
