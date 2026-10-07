"""Bounded, read-only n8n status projection; node payloads never leave this reader."""
from __future__ import annotations

import json
import math
import sqlite3
import time
from datetime import datetime, time as day_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings

from .errors import WorkflowApiError

SHANGHAI = ZoneInfo("Asia/Shanghai")
CATALOG = Path(__file__).with_name("import_chain_catalog.json")
MAX_ROWS = 2000
SYNTHETIC_APPLICATION_ID = 0x54525349
MAX_MANUAL_RUNS = 64
MAX_EVIDENCE_BYTES = 1024 * 1024
MAX_TOTAL_EVIDENCE_BYTES = 8 * 1024 * 1024


def _complete_manual_run(row, evidence, contract):
    """Inspect only run metadata, not HTTP parameters, credentials or output values.

    A successful editor execution can be a single-node test. Require the original
    manual entry and every registered business stage to actually finish in this
    execution, without pinned/cached input or a partial-execution destination.
    n8n stores execution data as a flatted table; dereference only known fields,
    avoiding recursive expansion of arbitrary payloads or cyclic references.
    """
    if not evidence or not contract:
        return False
    try:
        definition = json.loads(evidence["workflowData"])
        values = json.loads(evidence["data"])
        if not isinstance(values, list) or not 1 <= len(values) <= 10000:
            return False

        def ref(value):
            if isinstance(value, str) and value.isascii() and value.isdigit():
                return values[int(value)]
            return value

        def obj(value):
            value = ref(value)
            if not isinstance(value, dict):
                raise ValueError("Invalid metadata object")
            return value

        root = obj(values[0])
        result = obj(root["resultData"])
        if (definition["id"] != row["workflowId"] or definition.get("pinData")
                or obj(root["startData"]) or ref(result.get("pinData")) or result.get("error")):
            return False
        run = obj(result["runData"])
        started, stopped = _instant(row["startedAt"]), _instant(row["stoppedAt"])
        if not started or not stopped or stopped < started:
            return False
        prior_index, prior_time = -1, started.timestamp() * 1000
        optional_presence, repeated = [], {}
        for expected in contract:
            aliases = expected.get("aliases", [])
            if not isinstance(aliases, list) or len(aliases) > 1:
                return False
            names = [expected["name"], *aliases]
            if (any(not isinstance(name, str) or not name or len(name) > 200 for name in names)
                    or len(set(names)) != len(names)):
                return False
            nodes = [n for n in definition["nodes"] if n["name"] in names]
            if expected.get("optional") is True:
                optional_presence.append(bool(nodes))
                if not nodes:
                    if any(name in run for name in names):
                        return False
                    continue
            if (len(nodes) != 1 or nodes[0]["type"] != expected["type"] or nodes[0].get("disabled")
                    or nodes[0].get("continueOnFail") or nodes[0].get("onError", "stopWorkflow") != "stopWorkflow"):
                return False
            attempts = ref(run[nodes[0]["name"]])
            if not isinstance(attempts, list) or not attempts:
                return False
            maximum = expected.get("maximumAttempts", 10000)
            if type(maximum) is not int or not 1 <= maximum <= 10000 or len(attempts) > maximum:
                return False
            # Every recorded attempt must be real and successful. Use the final
            # attempt for ordering; loops in other coordination nodes are allowed.
            for attempt in attempts:
                attempt = obj(attempt)
                if ref(attempt.get("executionStatus")) != "success" or attempt.get("error"):
                    return False
            group = expected.get("repeatGroup")
            if group:
                repeated.setdefault(group, []).append((attempts, prior_index, prior_time))
            last = obj(attempts[-1])
            index, stamp, duration = last["executionIndex"], last["startTime"], last["executionTime"]
            if (type(index) is not int or type(stamp) not in (int, float) or type(duration) not in (int, float)
                    or not math.isfinite(stamp) or not math.isfinite(duration)
                    or index <= prior_index or not prior_time <= stamp <= stopped.timestamp() * 1000
                    or duration < 0 or stamp + duration > stopped.timestamp() * 1000):
                return False
            prior_index, prior_time = index, stamp
        if optional_presence and any(optional_presence) != all(optional_presence):
            return False
        if optional_presence and all(optional_presence):
            for group in repeated.values():
                count = len(group[0][0])
                if len(group) != 4 or any(len(attempts) != count for attempts, _, _ in group):
                    return False
                index, stamp = group[0][1:]
                for cycle in range(count):
                    for attempts, _, _ in group:
                        attempt = obj(attempts[cycle])
                        next_index, next_stamp, duration = (attempt["executionIndex"], attempt["startTime"], attempt["executionTime"])
                        if (type(next_index) is not int or type(next_stamp) not in (int, float)
                                or type(duration) not in (int, float) or not math.isfinite(next_stamp)
                                or not math.isfinite(duration) or next_index <= index or next_stamp < stamp
                                or duration < 0 or next_stamp + duration > stopped.timestamp() * 1000):
                            return False
                        index, stamp = next_index, next_stamp + duration
        return True
    except (ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError):
        return False


def _unavailable():
    return WorkflowApiError("暂时无法读取 n8n 执行状态，不能据此判断今天是否完成。", code="n8n_status_unavailable", status=503)


def _instant(value):
    if value is None:
        return None
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)


def summarize_workflow(workflow_id, active, rows):
    # All rows have already been restricted to today's terminal executions or
    # currently active executions. Manual successes have full-run evidence.
    # n8n SQLite timestamps may omit the zone or include milliseconds. Return
    # explicit UTC instants so browsers never interpret database UTC as local.
    rows = [{**r, "startedAt": _instant(r["startedAt"]).isoformat() if r["startedAt"] else None,
             "stoppedAt": _instant(r["stoppedAt"]).isoformat() if r["stoppedAt"] else None} for r in rows]
    success = [r for r in rows if r["status"] == "success" and r["stoppedAt"]]
    success.sort(key=lambda r: _instant(r["stoppedAt"]), reverse=True)
    ongoing = [r for r in rows if r["status"] in {"new", "running", "waiting"} and not r["stoppedAt"]]
    rows = sorted(rows, key=lambda r: (_instant(r["stoppedAt"] or r["startedAt"]), int(r["id"])), reverse=True)
    latest = max(ongoing, key=lambda r: int(r["id"])) if ongoing else (rows[0] if rows else None)
    state = "no_record"
    if latest:
        state = {"success": "completed", "new": "pending", "running": "running", "waiting": "waiting",
                 "error": "failed", "crashed": "failed", "canceled": "cancelled"}.get(latest["status"], "unknown")
        if state == "completed" and not latest["stoppedAt"]:
            state = "unknown"
    return {"workflowId": workflow_id, "active": active, "state": state,
            "completedToday": bool(success), "completedAt": success[0]["stoppedAt"] if success else None,
            "completedMode": success[0]["mode"] if success else None,
            "executionId": str(latest["id"]) if latest else None,
            "executionMode": latest["mode"] if latest else None,
            "startedAt": latest["startedAt"] if latest else None,
            "finishedAt": latest["stoppedAt"] if latest else None}


def read_today_status(*, now=None):
    now = now or datetime.now(timezone.utc)
    local_day = now.astimezone(SHANGHAI).date()
    start = datetime.combine(local_day, day_time(), SHANGHAI).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    configured = getattr(settings, "N8N_STATUS_DATABASE_PATH", "")
    if not configured:
        raise _unavailable()
    database = Path(configured)
    if not database.is_absolute() or not database.is_file():
        raise _unavailable()
    if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (database, *database.parents)):
        raise _unavailable()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    workflow_ids = catalog["workflowIds"]
    if not workflow_ids or len(workflow_ids) > 32:
        raise _unavailable()
    deadline = time.monotonic() + 2
    connection = None
    try:
        connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=0.5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        connection.execute("BEGIN")
        marks = ",".join("?" for _ in workflow_ids)
        workflows = {r["id"]: bool(r["active"]) for r in connection.execute(
            f'SELECT id, active FROM workflow_entity WHERE id IN ({marks}) AND "isArchived" = 0', workflow_ids)}
        rows = connection.execute(f'''
            SELECT id, "workflowId", status, mode, COALESCE("startedAt", "createdAt") AS "startedAt", "stoppedAt"
            FROM execution_entity
            WHERE "workflowId" IN ({marks}) AND "deletedAt" IS NULL
              AND (mode IN ('trigger', 'webhook') OR (mode = 'manual' AND status = 'success' AND "stoppedAt" IS NOT NULL))
              AND datetime(COALESCE("startedAt", "createdAt")) <= datetime(?)
              AND ((datetime("stoppedAt") >= datetime(?) AND datetime("stoppedAt") < datetime(?)
                    AND datetime("stoppedAt") <= datetime(?))
                   OR (status IN ('new','running','waiting') AND "stoppedAt" IS NULL))
            ORDER BY id DESC LIMIT ?
        ''', [*workflow_ids, now.isoformat(), start.isoformat(), end.isoformat(), now.isoformat(), MAX_ROWS + 1]).fetchall()
        if len(rows) > MAX_ROWS:
            raise _unavailable()  # Never infer a missing success from truncated history.
        manual_rows = [r for r in rows if r["mode"] == "manual"]
        if len(manual_rows) > MAX_MANUAL_RUNS:
            raise _unavailable()
        accepted_manual, total_bytes = set(), 0
        for row in manual_rows:
            if time.monotonic() > deadline:
                raise _unavailable()
            evidence = connection.execute('''
                SELECT data, "workflowData" FROM execution_data WHERE "executionId" = ?
                AND length(CAST(data AS BLOB)) <= ? AND length(CAST("workflowData" AS BLOB)) <= ?
            ''', [row["id"], MAX_EVIDENCE_BYTES, MAX_EVIDENCE_BYTES]).fetchone()
            if evidence:
                total_bytes += sum(len(v.encode("utf-8")) for v in evidence)
                if total_bytes > MAX_TOTAL_EVIDENCE_BYTES:
                    raise _unavailable()
            if _complete_manual_run(row, evidence, catalog.get("manualCompletion", {}).get(row["workflowId"])):
                accepted_manual.add(row["id"])
        rows = [r for r in rows if r["mode"] != "manual" or r["id"] in accepted_manual]
        if time.monotonic() > deadline:
            raise _unavailable()
        synthetic = connection.execute("PRAGMA application_id").fetchone()[0] == SYNTHETIC_APPLICATION_ID
        items = []
        for workflow_id in workflow_ids:
            if workflow_id not in workflows:
                items.append({"workflowId": workflow_id, "active": None, "state": "unavailable", "completedToday": False,
                              "completedAt": None, "completedMode": None, "executionId": None, "executionMode": None,
                              "startedAt": None, "finishedAt": None})
            else:
                items.append(summarize_workflow(workflow_id, workflows[workflow_id], [dict(r) for r in rows if r["workflowId"] == workflow_id]))
        return {"date": local_day.isoformat(), "timezone": "Asia/Shanghai", "checkedAt": now.isoformat(),
                "source": "synthetic_n8n" if synthetic else "n8n_execution_metadata", "items": items}
    except (sqlite3.Error, ValueError, TypeError, OSError):
        raise _unavailable() from None
    finally:
        if connection:
            connection.close()
