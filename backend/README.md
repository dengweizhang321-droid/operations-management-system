# TERUISI Django backend

This is an API-only Django 5.2 LTS service. The first migration slice owns only
the read side of these endpoints:

- `GET /api/sales/summary`
- `GET /api/sales/category-analysis`
- `GET /api/sales/category-analysis/detail`

The existing React frontend and edge Worker remain the public boundary. The
Worker authenticates the user and forwards a short-lived, HMAC-signed principal
envelope. Django never accepts role or scope claims from unsigned headers.

## Local setup

```powershell
python -m venv .runtime\django-venv
.runtime\django-venv\Scripts\python -m pip install -r backend\requirements.txt
.runtime\django-venv\Scripts\python backend\manage.py migrate
.runtime\django-venv\Scripts\python backend\manage.py test sales
```

SQLite at the repository-root `.runtime/django/teruisi.sqlite3` remains the development/test default. The managed local service does not use that SQLite target: it runs PostgreSQL 17.11 under `D:\teruisi-runtime\django-sales`, with a least-privilege projection writer and a transaction-read-only Django reader. Credentials are Windows-user-bound DPAPI ciphertext and must not be committed or logged.

## D1 migration

The source is always opened in SQLite read-only mode. A complete apply is one
target transaction, streams bounded batches, upserts by stable business keys,
removes stale rows from the migrated snapshot, copies both authoritative source revisions,
and verifies row counts plus canonical SHA-256 digests before commit.

```powershell
python backend\manage.py migrate_sales_from_d1 --source "D:\path\to\database.sqlite" --dry-run
# Inspect the JSON output and copy its runId only after approval.
python backend\manage.py migrate_sales_from_d1 --source "D:\path\to\database.sqlite" --apply --approved-run-id "<dry-run-runId>"
python backend\manage.py migrate_sales_from_d1 --source "D:\path\to\database.sqlite" --verify-only
```

There is no implicit apply mode. `--apply` requires a successful, unconsumed
dry-run from the same resolved source path and stable filesystem object identity,
`sales-projection-v2` canonical format, source revisions, complete row counts,
and complete table digests. The approval is consumed atomically with the target
snapshot transaction and cannot be reused. `--verify-only` does not change the
projected business tables or revision waterlines.

The verified 2026-08-28 local PostgreSQL baseline contains 572,015 sales lines,
88 sales batches, and 8,443 ERP products at source revision `8:5`. That revision
is an audit observation, not a constant.

After the baseline, D1 remains the only writer. Sales and ERP imports publish a
transactional D1 outbox event with their facts and revision. The managed
`sync_sales_projection --watch --interval-seconds=15` consumer validates the
source epoch, sequence, batch, digest, and revision, then atomically publishes
PostgreSQL facts, revisions, and checkpoint. The current empty outbox/head and
checkpoint sequence are both 0; the checkpoint heartbeat is active.

## Managed local service

The installed runtime uses Django 5.2.17 and Waitress 3.0.2. PostgreSQL listens
only on `127.0.0.1:5432`; Waitress listens only on `127.0.0.1:8001`.

```powershell
$repo = "D:\运营管理系统"
$runtime = "D:\teruisi-runtime\django-sales"
$sourceD1 = "<authoritative D1 sqlite absolute path>"
$sourceTool = Join-Path $repo "tools\django-local-service.ps1"
$runtimeTool = Join-Path $runtime "app\tools\django-local-service.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action Configure -RuntimeRoot $runtime -SourceD1 $sourceD1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action DeployApp -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sourceTool -Action HardenAcl -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Start -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action Status -RuntimeRoot $runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeTool -Action InstallStartup -RuntimeRoot $runtime
```

`InstallStartup` creates a shortcut for the current Windows user's next login;
it is not a crash supervisor and does not restart a process that dies after
login. Stop the stack without deleting data by running the runtime script with
`-Action Stop`. The public read mode is still `legacy`; changing it to `django`
is a separate, reversible edge configuration change that requires explicit user
confirmation. See the [migration guide](../docs/DJANGO_SALES_MIGRATION.md) for evidence, performance,
backup/audit paths, and rollback.
