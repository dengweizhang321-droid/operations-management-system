"""Private real pi_worker.main with an empty SQLite ledger; never a runner start."""
import json
import os
from pathlib import Path
import socket
import sys
import uuid

root = Path(sys.argv.pop(1)).resolve()
if not root.name.startswith("pi-native-exit-") or not root.is_dir():
    raise SystemExit("private root required")
for key in list(os.environ):
    if key.startswith(("TERUISI_", "DJANGO_", "PI_", "AI_")):
        del os.environ[key]
os.environ.update({
    "DJANGO_SETTINGS_MODULE": "teruisi_backend.settings",
    "TERUISI_DJANGO_ENVIRONMENT": "test",
    "TERUISI_DJANGO_SQLITE_PATH": str(root / "empty.sqlite3"),
    "TERUISI_DJANGO_PROCESS_ROLE": "ai_writer",
    "TERUISI_DJANGO_AI_AUTHORITY_EPOCH": "c6c4dbd2-3d51-4a77-834a-e1c82a3d2608",
    "TERUISI_DJANGO_AI_CUTOVER_ID": "private-pi-exit",
    "PYTHONDONTWRITEBYTECODE": "1",
})
def no_network(*args, **kwargs):
    raise AssertionError("private empty-worker fixture cannot connect to any network")
socket.socket.connect = no_network
socket.create_connection = no_network

import django
django.setup()
from django.db import connection
from ai_assistant.control_models import AiDataRevision, AiWriteAuthority
from ai_assistant.pi_models import PiSession, PiOperation, PiDispatch, PiEvent, PiFile, PiExport, PiExportPage, PiGatewayNonce

with connection.schema_editor() as editor:
    for model in [AiDataRevision, AiWriteAuthority, PiSession, PiOperation, PiDispatch, PiEvent, PiFile, PiExport, PiExportPage, PiGatewayNonce]:
        editor.create_model(model)
AiDataRevision.objects.create(domain="ai-assistant")
AiWriteAuthority.objects.create(id=1, status="postgres", authority_epoch=uuid.UUID(os.environ["TERUISI_DJANGO_AI_AUTHORITY_EPOCH"]), cutover_id="private-pi-exit")
assert PiOperation.objects.count() == 0

queries = 0
def observe(execute, sql, params, many, context):
    global queries
    value = execute(sql, params, many, context)
    if sql.lstrip().upper().startswith("SELECT") and '"ai_pi_operations"' in sql and params and "queued" in params:
        queries += 1
        if queries == 2:
            with (root / "READY.json").open("x", encoding="utf-8") as output:
                json.dump({"mainLoopQueries": queries, "queuedOperations": 0, "database": str(root / "empty.sqlite3")}, output)
    return value

# Only observe successful real SQL. claim/export/main and lifecycle_control are
# the original functions; no job or provider request is manufactured.
from ai_assistant.pi_worker import main
with connection.execute_wrapper(observe):
    main()
