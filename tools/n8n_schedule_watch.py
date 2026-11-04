"""External, read-only n8n schedule inspection. Default: local alert preview only."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
DATABASE = Path("C:/Users/86137/.n8n/database.sqlite")
CATALOG = ROOT / "lib/imports/chain-catalog.generated.json"
RETRY_WORKFLOW = "TeruisiHourlyRetry2026"
# Legacy catalogs retain their declared zone. New rules inherit the host clock.
SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")
MAX_WORKFLOWS = 512
MAX_ERRORS = 1000


class InspectionUnavailable(ValueError):
    pass


def instant(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)  # n8n SQLite's unzoned UTC
    return result.astimezone(timezone.utc)


def stamp(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)


def schedule_start(rule, now):
    """Start of the current cron cycle, including the exact due instant.

    Support the catalog's fixed daily five-field crons (and optional zero
    seconds). Reject other syntax instead of silently treating it as daily.
    """
    zone = rule.get("timezone")
    if zone not in ("local", "Asia/Shanghai"):
        raise InspectionUnavailable("unsupported_schedule_timezone")
    schedules = rule["schedules"]
    if not isinstance(schedules, list) or not 1 <= len(schedules) <= 48:
        raise InspectionUnavailable("invalid_catalog_schedules")
    slots = []
    local = now.astimezone() if zone == "local" else now.astimezone(SHANGHAI)
    for cron in schedules:
        if not isinstance(cron, str):
            raise InspectionUnavailable("unsupported_cron")
        fields = cron.split()
        if len(fields) == 6 and fields[0] == "0":
            fields = fields[1:]
        if (len(fields) != 5 or fields[2:] != ["*", "*", "*"]
                or not all(re.fullmatch(r"[0-9]{1,2}", field) for field in fields[:2])):
            raise InspectionUnavailable("unsupported_cron")
        minute, hour = map(int, fields[:2])
        if minute > 59 or hour > 23:
            raise InspectionUnavailable("unsupported_cron")
        wall = local.replace(tzinfo=None, hour=hour, minute=minute, second=0, microsecond=0)
        def resolve_slot(wall):
            if zone != "local":
                return wall.replace(tzinfo=SHANGHAI)
            # Resolve each calendar date independently; today's offset is not
            # valid for every date. Do not guess n8n's DST fold/gap policy.
            first, second = wall.replace(fold=0).astimezone(), wall.replace(fold=1).astimezone()
            if (first.timestamp() != second.timestamp()
                    or first.replace(tzinfo=None) != wall):
                raise InspectionUnavailable("local_schedule_dst_transition")
            return first
        # Inspect today's fold/gap before comparing wall clocks: during a
        # repeated hour a later-looking wall time may already have occurred.
        slot = resolve_slot(wall)
        if slot > now:
            slot = resolve_slot(wall - timedelta(days=1))
        slots.append(slot)
    return max(slots).astimezone(timezone.utc)


def load_rules(path):
    if path.stat().st_size > 1024 * 1024:
        raise InspectionUnavailable("catalog_too_large")
    catalog = json.loads(path.read_text(encoding="utf-8"))
    rules = catalog["rules"]
    if not isinstance(rules, list) or not 1 <= len(rules) <= MAX_WORKFLOWS:
        raise InspectionUnavailable("invalid_catalog")
    scheduled = []
    seen = set()
    for rule in rules:
        workflow = rule["workflowId"]
        if not valid_id(workflow) or workflow in seen:
            raise InspectionUnavailable("invalid_catalog_workflow")
        seen.add(workflow)
        schedules = rule["schedules"]
        if not isinstance(schedules, list):
            raise InspectionUnavailable("invalid_catalog_schedules")
        if schedules:
            scheduled.append(rule)
    if not scheduled:
        raise InspectionUnavailable("no_scheduled_workflows")
    return scheduled


def open_metadata(database, deadline=None):
    database = Path(database).absolute()
    if not database.is_file() or any(p.is_symlink() or getattr(p, "is_junction", lambda: False)()
                                     for p in (database, *database.parents)):
        raise InspectionUnavailable("invalid_database_path")
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.5)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        deadline = deadline if deadline is not None else time.monotonic() + 5
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        connection.execute("BEGIN")
        return connection
    except BaseException:
        connection.close()
        raise


def inspect(database, catalog=CATALOG, *, now=None):
    now = instant(now or datetime.now(timezone.utc))
    rules = load_rules(Path(catalog))
    periods = {rule["workflowId"]: schedule_start(rule, now) for rule in rules}
    database = Path(database).absolute()
    if not database.is_file():
        raise InspectionUnavailable("database_missing")
    connection = None
    deadline = time.monotonic() + 5
    findings = []
    scheduled = []

    def finding(check, workflow, code, period, **evidence):
        payload = {"version": 2, "kind": "schedule_watch", "workflowId": workflow, "code": code,
                   "anchorEpoch": int(period.timestamp()),
                   "executionId": evidence.get("executionId", "")}
        if code == "error_workflow_failed":
            payload["failureCount"] = evidence["failureCount"]
        findings.append({"check": check, "workflowId": workflow, "code": code,
                         **evidence, "payload": payload})

    try:
        connection = open_metadata(database, deadline)
        rows = connection.execute('''SELECT id, active, "activeVersionId", "isArchived",
            length(settings) AS settingsLength, substr(settings,1,65537) AS settings
            FROM workflow_entity LIMIT ?''', (MAX_WORKFLOWS + 1,)).fetchall()
        if len(rows) > MAX_WORKFLOWS:
            raise InspectionUnavailable("workflow_limit_exceeded")
        workflows = {}
        for row in rows:
            if not valid_id(row["id"]) or row["active"] not in (0, 1):
                raise InspectionUnavailable("invalid_workflow_metadata")
            workflows[row["id"]] = row
        for workflow, period in periods.items():
            row = workflows.get(workflow)
            reasons = []
            if row is None:
                reasons.append("workflow_missing")
            else:
                if row["active"] != 1 or row["isArchived"] != 0:
                    reasons.append("inactive")
                if not str(row["activeVersionId"] or "").strip():
                    reasons.append("unpublished")
            # Existence, not success: manual/webhook/error/running all count.
            # Normalize timestamps in SQLite; ISO strings with offsets cannot
            # safely be ordered lexicographically. Verify exact bounds in Python.
            execution = connection.execute('''SELECT id, "startedAt"
                FROM execution_entity WHERE "workflowId"=? AND "deletedAt" IS NULL
                AND julianday("startedAt") <= julianday(?)
                ORDER BY julianday("startedAt") DESC LIMIT 1''',
                (workflow, stamp(now))).fetchone()
            ran = bool(execution and period <= instant(execution["startedAt"]) <= now)
            if not ran:
                reasons.append("missing_execution")
            scheduled.append({"workflowId": workflow, "periodStart": stamp(period),
                              "periodStartLocal": period.astimezone().isoformat(),
                              "hasExecution": ran, "reasons": reasons})
            if reasons:
                finding(1, workflow, "schedule_not_ready", period, reasons=reasons)
        local_midnight = now.astimezone().replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0).astimezone()
        for workflow, row in workflows.items():
            # Its empty errorWorkflow is expected: it cannot catch its own failure.
            # Check 3 observes it externally instead of recommending self-binding.
            if row["active"] != 1 or row["isArchived"] != 0 or workflow == RETRY_WORKFLOW:
                continue
            if (row["settingsLength"] or 0) > 65536:
                raise InspectionUnavailable("settings_limit_exceeded")
            settings = json.loads(row["settings"]) if row["settings"] else {}
            if not isinstance(settings, dict):
                raise InspectionUnavailable("invalid_workflow_settings")
            target = settings.get("errorWorkflow")
            if target is not None and not isinstance(target, str):
                raise InspectionUnavailable("invalid_error_workflow")
            if not target or not target.strip():
                finding(2, workflow, "error_workflow_missing", local_midnight)
        start = now - timedelta(hours=24)
        errors = connection.execute('''SELECT id, COALESCE("stoppedAt", "startedAt", "createdAt") AS failed_at FROM execution_entity
            WHERE "workflowId"=? AND status='error' AND "deletedAt" IS NULL
            AND julianday(COALESCE("stoppedAt", "startedAt", "createdAt")) >= julianday(?)
            AND julianday(COALESCE("stoppedAt", "startedAt", "createdAt")) <= julianday(?)
            ORDER BY id LIMIT ?''',
            (RETRY_WORKFLOW, stamp(start - timedelta(seconds=1)),
             stamp(now + timedelta(seconds=1)), MAX_ERRORS + 1)).fetchall()
        if len(errors) > MAX_ERRORS:
            raise InspectionUnavailable("error_limit_exceeded")
        window_errors = []
        for row in errors:
            at = instant(row["failed_at"])
            if start <= at <= now:
                execution_id = str(row["id"])
                if not re.fullmatch(r"[1-9][0-9]{0,19}", execution_id):
                    raise InspectionUnavailable("invalid_execution_id")
                window_errors.append((at, int(execution_id)))
        if window_errors:
            latest_at, latest_id = max(window_errors)
            # The query remains an exact rolling 24h window. Its notification
            # bucket changes hourly, not whenever count/latest execution changes.
            anchor = start.replace(minute=0, second=0, microsecond=0)
            finding(3, RETRY_WORKFLOW, "error_workflow_failed", anchor,
                    executionId=str(latest_id), failedAt=stamp(latest_at), failureCount=len(window_errors),
                    windowStart=stamp(start), windowEnd=stamp(now))
        if time.monotonic() > deadline:
            raise InspectionUnavailable("inspection_timeout")
    finally:
        if connection is not None:
            try:
                connection.rollback()
            finally:
                connection.close()
    return {"status": "anomalies" if findings else "healthy", "readOnly": True,
            "checkedAt": stamp(now), "checkedAtLocal": now.astimezone().isoformat(),
            "timezone": "local", "scheduledWorkflowCount": len(scheduled),
            "checks": {str(n): sum(item["check"] == n for item in findings) for n in (1, 2, 3)},
            "scheduled": scheduled, "findings": findings}


def alert(payload, *, execute=False, state_root=None):
    encoded = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")
    command = ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
               str(ROOT / "tools/n8n-manual-action-alert.ps1"), "-PayloadBase64", encoded]
    if execute:
        command.append("-Execute")
    if state_root:
        command.extend(["-StateRoot", str(state_root)])
    result = subprocess.run(command, capture_output=True, encoding="utf-8", timeout=180,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    response = json.loads(result.stdout)
    if not isinstance(response, dict):
        raise InspectionUnavailable("invalid_alert_response")
    response["exitCode"] = result.returncode
    return response


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DATABASE)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--now", help="Inject a UTC/offset timestamp for historical dry-runs")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Local preview (default); no identity lookup or send")
    mode.add_argument("--execute", action="store_true", help="Explicitly send via the existing private alert chain")
    parser.add_argument("--state-root", type=Path, help="Optional alert ledger directory")
    args = parser.parse_args(argv)
    if args.execute and (args.now or args.database != DATABASE or args.catalog != CATALOG):
        parser.error("--execute cannot be combined with injected time/database/catalog")
    try:
        report = inspect(args.database, args.catalog, now=args.now)
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError, OverflowError):
        print(json.dumps({"status": "unavailable", "readOnly": True,
                          "reason": "inspection_incomplete", "executed": False}))
        return 2
    report["mode"] = "execute" if args.execute else "dry-run"
    report["alerts"] = []
    for item in report["findings"]:
        try:
            result = alert(item["payload"], execute=args.execute, state_root=args.state_root)
        except (OSError, subprocess.SubprocessError, ValueError, InspectionUnavailable):
            # An external timeout can mean a send is still unknown. Never retry.
            result = {"status": "notification_unconfirmed", "exitCode": 2}
        report["alerts"].append({"workflowId": item["workflowId"], "code": item["code"], **result})
        # A prior unknown send stays suppressed by its own ledger; it must not
        # starve unrelated findings forever on every later inspection.
        if result["exitCode"] != 0 and not (result.get("status") == "unknown" and result.get("suppressed") is True):
            break
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if any(item["exitCode"] != 0 for item in report["alerts"]):
        return 2
    return 1 if report["findings"] else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
