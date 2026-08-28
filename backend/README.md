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

SQLite at the repository-root `.runtime/django/teruisi.sqlite3` is the local/test default. Production configuration uses
`TERUISI_DJANGO_DATABASE_URL=postgresql://...`; credentials must not be committed.

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

Run against a local target first. Switching a production read route is a
separate, reversible edge configuration change; this command does not deploy or
change the existing D1 writer.
