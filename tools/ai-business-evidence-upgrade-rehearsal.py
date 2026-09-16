"""0013 -> 0020, live restricted roles and independent restore; synthetic only."""
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
from django.db import connection, transaction
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
volume_table = "ai_business_volume_chunks"
new_tables = {"ai_business_evidence_runs", "ai_business_evidence_chunks", "ai_business_file_runs", "ai_business_file_chunks", "ai_business_evidence_sources", volume_table}
directory_target = [("ai_assistant", "0019_business_source_directory")]
volume_target = [("ai_assistant", "0020_business_volume_files")]

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
# Seed the previous schema before installing the directory table. These are
# synthetic persistence fixtures, not accepted business reports or source facts.
previous_target = [("ai_assistant", "0018_business_excel_renderer")]
executor = MigrationExecutor(connection)
executor.migrate(previous_target)
previous_apps = executor.loader.project_state(previous_target).apps
legacy_run = previous_apps.get_model("ai_assistant", "AiBusinessEvidenceRun")
for name, status, collection in (("manual", "collecting", "manual"), ("queued", "collecting", "queued"),
        ("paused", "collecting", "paused"), ("sealed", "sealed", "manual"), ("cancelled", "cancelled", "manual")):
    legacy_run.objects.create(id="legacy-directory-"+name, owner_email="legacy@example.invalid",
        client_request_id="legacy-"+name, request_digest="9"*64,
        plan_json=json.dumps({"schemaVersion": "business-evidence-v1", "sources": []}),
        status=status, collection_status=collection)
legacy_workflow = previous_apps.get_model("ai_assistant", "AiWorkflowRuns").objects.create(
    id="legacy-file-workflow", owner_email="legacy@example.invalid", client_request_id="legacy-file-workflow",
    request_digest="8"*64, scope_json="null", name="旧版合成持久任务", graph_json="{}", graph_digest="7"*64)
legacy_report = previous_apps.get_model("ai_assistant", "AiReportRun").objects.create(
    id="legacy-file-report", owner_email=legacy_workflow.owner_email, client_request_id="legacy-file-report",
    request_digest="8"*64, workflow=legacy_workflow, snapshot_json="{}")
for renderer in (1, 2, 3):
    previous_apps.get_model("ai_assistant", "AiBusinessFileRun").objects.create(
        id="legacy-renderer-"+str(renderer), owner_email=legacy_workflow.owner_email,
        report=legacy_report, binding_digest="6"*64, renderer_version=renderer)
previous_tables = set(AI_TABLES)-{"ai_business_evidence_sources", volume_table}
previous_digest = snapshot(database["NAME"], previous_tables)
MigrationExecutor(connection).migrate(directory_target)
assert snapshot(database["NAME"], previous_tables) == previous_digest
assert MigrationExecutor(connection).migration_plan(directory_target) == []
from ai_assistant.control_models import AiDataRevision, AiWriteAuthority, AiMigrationRun
from ai_assistant.database_contract import provision
epoch = str(uuid.uuid4())
AiDataRevision.objects.filter(domain="ai-assistant").update(revision=1, source_digest="c"*64)
AiWriteAuthority.objects.filter(pk=1).update(status="postgres", authority_epoch=epoch, cutover_id="business-synthetic", migration_verify_run_id="ai-apply-"+"d"*32, activated_at=timezone.now())
AiMigrationRun.objects.create(id="ai-apply-"+"d"*32, mode="apply", status="verified", source_path_digest="0"*64, source_snapshot_digest="c"*64, target_snapshot_digest="c"*64, source_counts={}, target_counts={})
# Synthetic transport fixture only: verify bytea preservation and restricted
# writer guards independently of analysis/report content acceptance.
from ai_assistant import models as m
with connection.cursor() as cursor:
    cursor.execute("SELECT set_config('teruisi.ai_epoch',%s,false),set_config('teruisi.ai_cutover','business-synthetic',false)", [epoch])
from business_analysis.evidence_v2 import build_catalog
from business_analysis.contracts import canonical
directory = build_catalog([{"key": "source-"+str(i), "domain": "sales", "query": {
    "platform": "京东", "shop": "合成目录店", "channel": "合成渠道"+str(i),
    "startDate": "2026-08-01", "endDate": "2026-08-01"}} for i in range(2)])
with transaction.atomic():
    directory_run = m.AiBusinessEvidenceRun.objects.create(id="directory-restore", owner_email="fixture@example.invalid",
        client_request_id="directory-restore", request_digest=directory["planDigest"], plan_json=canonical(directory["header"]))
    for entry in directory["entries"]:
        m.AiBusinessEvidenceSource.objects.create(id="directory-source-"+str(entry["ordinal"]), run=directory_run,
            source_key=entry["key"], ordinal=entry["ordinal"], domain=entry["domain"],
            query_json=canonical(entry["query"]), query_digest=entry["queryDigest"])
workflow = m.AiWorkflowRuns.objects.create(id="file-restore-workflow", owner_email="fixture@example.invalid",
    client_request_id="file-restore", request_digest="e"*64, scope_json="null", name="合成文件恢复",
    graph_json="{}", graph_digest="f"*64)
report = m.AiReportRun.objects.create(id="file-restore-report", owner_email=workflow.owner_email,
    client_request_id="file-restore", request_digest="e"*64, workflow=workflow, snapshot_json="{}")
m.AiBusinessFileRun.objects.create(id="file-restore", owner_email=workflow.owner_email, report=report,
    binding_digest="a"*64, status="building", attempt=1)
m.AiBusinessFileRun.objects.create(id="offline-file-restore", owner_email=workflow.owner_email, report=report,
    binding_digest="a"*64, renderer_version=2)
m.AiBusinessFileRun.objects.create(id="excel-file-restore", owner_email=workflow.owner_email, report=report,
    binding_digest="a"*64, renderer_version=3)
binary_payload = bytes(range(256))*2048
binary_digest = hashlib.sha256(binary_payload).hexdigest()

# Exercise the directory rollback guard before renderer 4 exists; otherwise the
# later volume guard would mask this older, independently required protection.
directory_tables = set(AI_TABLES)-{volume_table}
directory_digest = snapshot(database["NAME"], directory_tables)
try:
    MigrationExecutor(connection).migrate(previous_target)
except RuntimeError as error:
    assert "v2" in str(error).lower(), str(error)
else:
    raise AssertionError("Reverse migration discarded a v2 directory")
assert snapshot(database["NAME"], directory_tables) == directory_digest
assert MigrationExecutor(connection).migration_plan(directory_target) == []

executor = MigrationExecutor(connection)
assert [(m.app_label, m.name) for m, backwards in executor.migration_plan(volume_target)] == volume_target
executor.migrate(volume_target)
assert snapshot(database["NAME"], directory_tables) == directory_digest
assert MigrationExecutor(connection).migration_plan(volume_target) == []
call_command("migrate", interactive=False, verbosity=0)
call_command("makemigrations", check=True, dry_run=True, verbosity=0)
passwords = {role: secrets.token_hex(32) for role in ("reader", "writer")}
with psycopg.connect(os.environ["TERUISI_DJANGO_DATABASE_URL"]) as owner:
    provision(owner, passwords["reader"], passwords["writer"])

# This is intentionally a paused partial delivery, not a forged ready report.
# Its arbitrary transport bytes prove persistence/role guards, not file format
# validity or acceptance by the public download API.
m.AiBusinessFileRun.objects.create(id="volume-file-restore", owner_email=workflow.owner_email, report=report,
    binding_digest="b"*64, renderer_version=4)
with connection.cursor() as cursor:
    cursor.execute("UPDATE ai_business_file_runs SET status='building',version=2,attempt=1 WHERE id='volume-file-restore' AND version=1")
    assert cursor.rowcount == 1
volume_payloads = [
    ("volume-json", 0, "json", 1, canonical({"synthetic": True, "meaning": "未完成交付"}).encode("utf-8")),
    ("volume-1-html", 1, "html", 1, "<p>合成第一卷，未完成交付</p>".encode("utf-8")),
    ("volume-1-xlsx", 1, "xlsx", 1, binary_payload),
    ("volume-2-html", 2, "html", 1, "<p>合成第二卷，未完成交付</p>".encode("utf-8")),
    ("volume-2-xlsx-1", 2, "xlsx", 1, binary_payload),
    ("volume-2-xlsx-2", 2, "xlsx", 2, b"synthetic-last-block"),
]
volume_bytes = sum(len(item[4]) for item in volume_payloads)
volume_insert = "INSERT INTO ai_business_volume_chunks(id,run_id,attempt,volume_index,format,sequence,content,content_digest,created_at) VALUES (%s,%s,1,%s,%s,%s,%s,%s,now())"

def volume_parameters(item, *, run_id="volume-file-restore"):
    key, volume, format, sequence, content = item
    return [key, run_id, volume, format, sequence, content, hashlib.sha256(content).hexdigest()]

def denied(db, statement, parameters=None):
    try:
        db.execute(statement, parameters)
    except psycopg.Error:
        return
    raise AssertionError("Forbidden database action accepted")

def denied_volume_with_parent(db, item):
    """Do not let the missing-parent-byte guard mask bad coordinates/sequence."""
    try:
        with db.transaction():
            db.execute("SELECT id FROM ai_business_file_runs WHERE id='volume-file-restore' FOR UPDATE")
            db.execute(volume_insert, volume_parameters(item))
            result = db.execute("UPDATE ai_business_file_runs SET stored_bytes=%s,version=3 WHERE id='volume-file-restore' AND version=2", [len(item[4])])
            assert result.rowcount == 1
    except psycopg.Error:
        return
    raise AssertionError("Invalid volume coordinates/sequence accepted with matching parent bytes")

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
        denied(limited, volume_insert, volume_parameters(volume_payloads[0]))
        limited.execute("SELECT set_config('teruisi.ai_epoch',%s,false),set_config('teruisi.ai_cutover','business-synthetic',false)", [epoch])
        if role == "writer":
            limited.execute(insert)
            limited.execute("INSERT INTO ai_business_evidence_chunks(id,run_id,source_key,sequence,payload_json,payload_digest,created_at) VALUES ('chunk','synthetic','sales',1,'{}',repeat('b',64),now())")
            denied(limited, "UPDATE ai_business_evidence_chunks SET payload_json='[]'")
            denied(limited, "UPDATE ai_business_evidence_runs SET owner_email='other',version=2")
            limited.execute("UPDATE ai_business_evidence_runs SET status='sealed',version=2 WHERE id='synthetic'")
            denied(limited, "UPDATE ai_business_evidence_runs SET status='collecting',version=3")
            limited.execute("INSERT INTO ai_business_file_chunks(id,run_id,attempt,format,sequence,content,content_digest,created_at) VALUES ('binary-restore','file-restore',1,'xlsx',1,%s,%s,now())", [binary_payload, binary_digest])
            limited.execute("UPDATE ai_business_file_runs SET stored_bytes=524288,version=2 WHERE id='file-restore'")
            denied(limited, "UPDATE ai_business_file_chunks SET content='broken'::bytea")
            denied(limited, "UPDATE ai_business_file_runs SET status='ready',version=3 WHERE id='file-restore'")
            denied(limited, "UPDATE ai_business_evidence_sources SET query_digest=repeat('f',64),version=2 WHERE id='directory-source-1'")
            denied(limited, "UPDATE ai_business_evidence_sources SET version=2,checkpoint_run_version=2 WHERE id='directory-source-1'")
            denied(limited, "INSERT INTO ai_business_evidence_chunks(id,run_id,source_key,sequence,payload_json,payload_digest,created_at) VALUES ('orphan-v2-page','directory-restore','source-0',1,'{}',repeat('d',64),now())")
            with limited.transaction():
                limited.execute("INSERT INTO ai_business_evidence_chunks(id,run_id,source_key,sequence,payload_json,payload_digest,created_at) VALUES ('directory-v2-page','directory-restore',%s,1,'{}',%s,now())", [directory["entries"][0]["key"], hashlib.sha256(b'{}').hexdigest()])
                limited.execute("UPDATE ai_business_evidence_sources SET checkpoint_json='{\"synthetic\":true}',version=2,checkpoint_run_version=2,page_count=1,stored_bytes=2 WHERE id='directory-source-1'")
                limited.execute("UPDATE ai_business_evidence_runs SET version=2,stored_bytes=2 WHERE id='directory-restore'")
            denied(limited, "UPDATE ai_business_evidence_runs SET status='sealed',version=3 WHERE id='directory-restore'")
            # Every attempted write is individually rolled back by autocommit,
            # including deferred failures at the end of its statement.
            denied(limited, volume_insert, volume_parameters(volume_payloads[0]))  # parent bytes/CAS absent
            denied(limited, volume_insert, volume_parameters(volume_payloads[0], run_id="file-restore"))
            denied(limited, "INSERT INTO ai_business_file_chunks(id,run_id,attempt,format,sequence,content,content_digest,created_at) VALUES ('wrong-v4-table','volume-file-restore',1,'html',1,%s,%s,now())", [b"x", hashlib.sha256(b"x").hexdigest()])
            for volume, format, sequence in ((0, "html", 1), (1, "json", 1), (101, "html", 1), (1, "xlsx", 513), (1, "xlsx", 2)):
                denied_volume_with_parent(limited, ("invalid-volume-block", volume, format, sequence, b"x"))
            with limited.transaction():
                limited.execute("SELECT id FROM ai_business_file_runs WHERE id='volume-file-restore' FOR UPDATE")
                for item in volume_payloads:
                    limited.execute(volume_insert, volume_parameters(item))
                result = limited.execute("UPDATE ai_business_file_runs SET stored_bytes=%s,version=3 WHERE id='volume-file-restore' AND version=2", [volume_bytes])
                assert result.rowcount == 1
            denied(limited, "UPDATE ai_business_volume_chunks SET content='broken'::bytea")
            denied(limited, "UPDATE ai_business_volume_chunks SET volume_index=2 WHERE id='volume-1-html'")
            denied(limited, "UPDATE ai_business_file_runs SET status='ready',version=4 WHERE id='volume-file-restore'")
            limited.execute("UPDATE ai_business_file_runs SET status='paused',version=4 WHERE id='volume-file-restore'")
            denied(limited, volume_insert, volume_parameters(("paused-volume-block", 2, "xlsx", 3, b"paused")))
        else:
            denied(limited, insert)
            denied(limited, "UPDATE ai_business_evidence_sources SET version=2,checkpoint_run_version=2 WHERE id='directory-source-1'")
            denied(limited, volume_insert, volume_parameters(volume_payloads[0]))
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
try:
    MigrationExecutor(connection).migrate(directory_target)
except RuntimeError as error:
    assert "v4" in str(error).lower() or "renderer 4" in str(error).lower(), str(error)
else:
    raise AssertionError("Reverse migration discarded renderer-4 volume persistence")
assert snapshot(database["NAME"], AI_TABLES) == complete
assert MigrationExecutor(connection).migration_plan(volume_target) == []
binary = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
dump = run_root / "business-evidence.dump"
for executable, arguments in [("pg_dump.exe", ["-Fc", "-f", str(dump), "teruisi_ai_rehearsal"]), ("createdb.exe", ["teruisi_business_restore"]), ("pg_restore.exe", ["--exit-on-error", "-d", "teruisi_business_restore", str(dump)])]:
    subprocess.run([str(binary / executable), *arguments], check=True, capture_output=True, timeout=60)
assert snapshot("teruisi_business_restore", AI_TABLES) == complete
with psycopg.connect(os.environ["TERUISI_DJANGO_DATABASE_URL"].replace("/teruisi_ai_rehearsal", "/teruisi_business_restore")) as restored:
    content, digest = restored.execute("SELECT content,content_digest FROM ai_business_file_chunks WHERE id='binary-restore'").fetchone()
    assert bytes(content) == binary_payload and hashlib.sha256(content).hexdigest() == digest == binary_digest
    assert restored.execute("SELECT renderer_version FROM ai_business_file_runs WHERE id IN ('file-restore','offline-file-restore','excel-file-restore') ORDER BY renderer_version").fetchall() == [(1,), (2,), (3,)]
    assert restored.execute("SELECT renderer_version FROM ai_business_file_runs WHERE id LIKE 'legacy-renderer-%' ORDER BY renderer_version").fetchall() == [(1,), (2,), (3,)]
    assert restored.execute("SELECT source_key,ordinal,domain,query_json,query_digest FROM ai_business_evidence_sources ORDER BY ordinal").fetchall() == [
        (entry["key"], entry["ordinal"], entry["domain"], canonical(entry["query"]), entry["queryDigest"]) for entry in directory["entries"]]
    assert restored.execute("SELECT version,checkpoint_run_version,checkpoint_json FROM ai_business_evidence_sources WHERE id='directory-source-1'").fetchone() == (2,2,'{"synthetic":true}')
    assert restored.execute("SELECT page_count,stored_bytes FROM ai_business_evidence_sources WHERE id='directory-source-1'").fetchone() == (1,2)
    assert restored.execute("SELECT payload_json,payload_digest FROM ai_business_evidence_chunks WHERE id='directory-v2-page'").fetchone() == ('{}',hashlib.sha256(b'{}').hexdigest())
    assert restored.execute("SELECT renderer_version,status,version,attempt,stored_bytes,manifest_json FROM ai_business_file_runs WHERE id='volume-file-restore'").fetchone() == (4, "paused", 4, 1, volume_bytes, "{}")
    volume_rows = restored.execute("SELECT id,volume_index,format,sequence,content,content_digest FROM ai_business_volume_chunks WHERE run_id='volume-file-restore' ORDER BY id").fetchall()
    expected_rows = sorted(volume_payloads, key=lambda item: item[0])
    assert len(volume_rows) == len(expected_rows)
    for actual, expected in zip(volume_rows, expected_rows):
        assert actual[:4] == expected[:4]
        assert bytes(actual[4]) == expected[4]
        assert hashlib.sha256(actual[4]).hexdigest() == actual[5] == hashlib.sha256(expected[4]).hexdigest()
    assert restored.execute("SELECT count(*) FROM ai_business_file_chunks WHERE run_id='volume-file-restore'").fetchone() == (0,)
print(json.dumps({"upgrade": "0013->0014->0015->0016->0017->0018->0019->0020", "oldAiTablesDigestPreserved": before,
    "previous60TablesDigestPreserved": previous_digest, "tables": len(AI_TABLES), "allThreeRendererVersionsRestored": True,
    "previous61TablesDigestPreserved": directory_digest, "renderer4PausedDeliveryRestored": True,
    "volumeChunkCountRestored": len(volume_payloads), "volumeChunkBytesRestored": volume_bytes,
    "volumeRollbackWithDataDenied": True, "volumeReadyAcceptanceExercised": False,
    "secondApplyNoop": True, "migrationDryRun": True, "realRoleHealth": True, "fencesAndAppendOnly": True,
    "ownerAndTerminalGuards": True, "businessWritesDenied": True, "dumpRestoreDigest": complete,
    "directorySourceCountRestored": len(directory["entries"]), "directoryCatalogDigest": directory["header"]["catalogDigest"], "directoryRollbackWithDataDenied": True,
    "binaryRestoreBytes": len(binary_payload), "binaryRestoreSha256": binary_digest, "productionWrites": False}))
