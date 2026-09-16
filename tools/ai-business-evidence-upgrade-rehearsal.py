"""0013 -> 0015, live restricted roles and independent restore; synthetic only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import django
django.setup()
import psycopg
from psycopg import sql
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from ai_assistant.table_manifest import AI_TABLES

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run-root", type=Path, required=True)
run_root = parser.parse_args().run_root.resolve()
database = settings.DATABASES["default"]
if (ROOT == Path(r"D:\运营管理系统") or settings.DJANGO_ENVIRONMENT != "test"
        or database["HOST"] != "127.0.0.1" or str(database["PORT"]) != os.getenv("TERUISI_AI_REHEARSAL_PORT")
        or not 55440 <= int(database["PORT"]) <= 55999 or database["NAME"] != "teruisi_ai_rehearsal"
        or connection.vendor != "postgresql" or connection.introspection.table_names() or run_root.parent != ROOT / ".runtime"):
    raise RuntimeError("Evidence upgrade requires a fresh isolated rehearsal database")

old_target, target = [("ai_assistant", "0013_dingtalk_schedule_media")], [("ai_assistant", "0014_business_evidence")]
executor = MigrationExecutor(connection)
executor.migrate(old_target)
old = executor.loader.project_state(old_target).apps
old.get_model("ai_assistant", "AiConversations").objects.create(id="retained-fixture", title="合成旧会话", created_by="fixture@example.invalid")
old.get_model("ai_assistant", "AiConversationMessages").objects.create(id="retained-message", conversation_id="retained-fixture", role="assistant", content="历史内容", ordinal=1)
new_tables = {"ai_business_evidence_runs", "ai_business_evidence_chunks"}

def snapshot(dbname, tables):
    result = {}
    with psycopg.connect(os.environ["TERUISI_DJANGO_DATABASE_URL"].replace("/teruisi_ai_rehearsal", "/"+dbname)) as db:
        for table in sorted(tables):
            result[table] = sorted(json.dumps(r[0], sort_keys=True, default=str) for r in db.execute(sql.SQL("SELECT row_to_json(t) FROM {} t").format(sql.Identifier(table))))
    return hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()

before = snapshot(database["NAME"], set(AI_TABLES) - new_tables)
executor = MigrationExecutor(connection)
assert [(m.app_label, m.name) for m, backwards in executor.migration_plan(target)] == target
executor.migrate(target)
assert snapshot(database["NAME"], set(AI_TABLES) - new_tables) == before
assert MigrationExecutor(connection).migration_plan(target) == []
call_command("migrate", interactive=False, verbosity=0)
call_command("makemigrations", check=True, dry_run=True, verbosity=0)
from ai_assistant.control_models import AiDataRevision, AiWriteAuthority, AiMigrationRun
from ai_assistant.database_contract import provision
epoch = str(uuid.uuid4())
AiDataRevision.objects.filter(domain="ai-assistant").update(revision=1, source_digest="c"*64)
AiWriteAuthority.objects.filter(pk=1).update(status="postgres", authority_epoch=epoch, cutover_id="business-synthetic", migration_verify_run_id="ai-apply-"+"d"*32, activated_at=timezone.now())
AiMigrationRun.objects.create(id="ai-apply-"+"d"*32, mode="apply", status="verified", source_path_digest="0"*64, source_snapshot_digest="c"*64, target_snapshot_digest="c"*64, source_counts={}, target_counts={})
passwords = {role: secrets.token_hex(32) for role in ("reader", "writer")}
with psycopg.connect(os.environ["TERUISI_DJANGO_DATABASE_URL"]) as owner:
    provision(owner, passwords["reader"], passwords["writer"])

def denied(db, statement):
    try:
        db.execute(statement)
    except psycopg.Error:
        return
    raise AssertionError("Forbidden database action accepted")

insert = "INSERT INTO ai_business_evidence_runs(id,owner_email,scope_json,client_request_id,request_digest,plan_json,state_json,status,version,stored_bytes,created_at,collection_status,next_collect_at,collection_failures,collection_error_code) VALUES ('synthetic','fixture@example.invalid','null','client',repeat('a',64),'{}','{}','collecting',1,0,now(),'manual',now(),0,'')"
for role in ("reader", "writer"):
    url = f"postgresql://teruisi_ai_{role}:{passwords[role]}@127.0.0.1:{database['PORT']}/teruisi_ai_rehearsal"
    env = {**os.environ, "TERUISI_DJANGO_DATABASE_URL": url, "TERUISI_DJANGO_PROCESS_ROLE": "ai_"+role,
        "TERUISI_DJANGO_EXPECT_READ_ONLY": str(role == "reader").lower(), "TERUISI_DJANGO_AI_AUTHORITY_EPOCH": epoch,
        "TERUISI_DJANGO_AI_CUTOVER_ID": "business-synthetic", "PYTHONPATH": str(ROOT / "backend")}
    def health():
        return subprocess.run([sys.executable, "-c", "import django; django.setup(); from ai_assistant.health import check; assert check()['status']=='ready'"], env=env, capture_output=True, timeout=30)
    checked = health()
    if checked.returncode:
        (run_root / "role-health-error.log").write_bytes(checked.stderr)
        raise RuntimeError("Role health failed; see role-health-error.log")
    with psycopg.connect(url, autocommit=True) as limited:
        denied(limited, insert)
        limited.execute("SELECT set_config('teruisi.ai_epoch',%s,false),set_config('teruisi.ai_cutover','business-synthetic',false)", [epoch])
        if role == "writer":
            limited.execute(insert)
            limited.execute("INSERT INTO ai_business_evidence_chunks(id,run_id,source_key,sequence,payload_json,payload_digest,created_at) VALUES ('chunk','synthetic','sales',1,'{}',repeat('b',64),now())")
            denied(limited, "UPDATE ai_business_evidence_chunks SET payload_json='[]'")
            denied(limited, "UPDATE ai_business_evidence_runs SET owner_email='other',version=2")
            limited.execute("UPDATE ai_business_evidence_runs SET status='sealed',version=2 WHERE id='synthetic'")
            denied(limited, "UPDATE ai_business_evidence_runs SET status='collecting',version=3")
        else:
            denied(limited, insert)
        for table in new_tables:
            limited.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
            denied(limited, "DELETE FROM " + table)
            denied(limited, "TRUNCATE " + table)
        denied(limited, "UPDATE sales_order_lines SET allocated_amount_cents=0")
    with psycopg.connect(os.environ["TERUISI_DJANGO_DATABASE_URL"], autocommit=True) as owner:
        for table in new_tables:
            owner.execute(sql.SQL("ALTER TABLE {} DISABLE TRIGGER ai_write_fence").format(sql.Identifier(table)))
            try:
                assert health().returncode != 0
            finally:
                owner.execute(sql.SQL("ALTER TABLE {} ENABLE TRIGGER ai_write_fence").format(sql.Identifier(table)))

complete = snapshot(database["NAME"], AI_TABLES)
binary = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
dump = run_root / "business-evidence.dump"
for executable, arguments in [("pg_dump.exe", ["-Fc", "-f", str(dump), "teruisi_ai_rehearsal"]), ("createdb.exe", ["teruisi_business_restore"]), ("pg_restore.exe", ["--exit-on-error", "-d", "teruisi_business_restore", str(dump)])]:
    subprocess.run([str(binary / executable), *arguments], check=True, capture_output=True, timeout=60)
assert snapshot("teruisi_business_restore", AI_TABLES) == complete
print(json.dumps({"upgrade": "0013->0014->0015", "oldAiTablesDigestPreserved": before, "tables": len(AI_TABLES),
    "secondApplyNoop": True, "migrationDryRun": True, "realRoleHealth": True, "fencesAndAppendOnly": True,
    "ownerAndTerminalGuards": True, "businessWritesDenied": True, "dumpRestoreDigest": complete, "productionWrites": False}))
