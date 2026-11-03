"""Continuous observations only; delivery remains owned by the existing alert ledger."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

MAX_STATE_BYTES = 1024 * 1024
MAX_KEYS = 4096
MAX_ANCHOR = 4102444800
CODES = {"schedule_not_ready", "error_workflow_missing", "error_workflow_failed"}


def state_root(value=None):
    if value is not None:
        return Path(value).absolute()
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise ValueError("local_app_data_unavailable")
    return Path(local) / "TERUISI" / "n8n-manual-action-alert"


def check_path(path):
    for item in (path, *path.parents):
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise ValueError("invalid_observation_path")


def read_state(root):
    path = root / "schedule-watch-incidents.json"
    check_path(path)
    if not path.exists():
        return {"version": 1, "active": {}, "lastAnchors": {}}
    if not path.is_file() or path.stat().st_size > MAX_STATE_BYTES:
        raise ValueError("invalid_observation_state")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {"version", "active", "lastAnchors"} or value["version"] != 1:
        raise ValueError("invalid_observation_state")
    for field in ("active", "lastAnchors"):
        entries = value[field]
        if not isinstance(entries, dict) or len(entries) > MAX_KEYS:
            raise ValueError("invalid_observation_state")
        for key, entry in entries.items():
            if not re.fullmatch(r"[a-f0-9]{64}", key):
                raise ValueError("invalid_observation_state")
            anchor = entry
            if field == "active":
                if not isinstance(entry, dict) or set(entry) != {"workflowId", "code", "anchorEpoch"}:
                    raise ValueError("invalid_observation_state")
                if (not isinstance(entry["workflowId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", entry["workflowId"])
                        or entry["code"] not in CODES):
                    raise ValueError("invalid_observation_state")
                anchor = entry["anchorEpoch"]
            if type(anchor) is not int or not 0 <= anchor <= MAX_ANCHOR:
                raise ValueError("invalid_observation_state")
    return value


def atomic_json(path, value):
    check_path(path)
    raw = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
    if len(raw) > MAX_STATE_BYTES:
        raise ValueError("observation_state_limit_exceeded")
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def observation_lock(root):
    check_path(root)
    root.mkdir(parents=True, exist_ok=True)
    path = root / "schedule-watch-incidents.lock"
    check_path(path)
    with path.open("a+b") as stream:
        if stream.seek(0, 2) == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def bind_observations(report, previous):
    """Called only after a complete inspect. Mutates payload anchors, not findings."""
    if report.get("status") not in ("healthy", "anomalies") or report.get("readOnly") is not True:
        raise ValueError("incomplete_inspection")
    from datetime import datetime
    now = int(datetime.fromisoformat(report["checkedAt"].replace("Z", "+00:00")).timestamp())
    coverage = report["observationCoverage"]
    if not isinstance(coverage, dict) or set(coverage) != CODES or any(not isinstance(v, list) for v in coverage.values()):
        raise ValueError("incomplete_observation_coverage")
    # Removal from the catalog is loss of scope, not evidence of recovery.
    active = {key: entry for key, entry in previous["active"].items()
              if entry["workflowId"] not in coverage[entry["code"]]}
    last = dict(previous["lastAnchors"])
    for finding in report["findings"]:
        group = json.dumps([finding["workflowId"], finding["code"]], separators=(",", ":"))
        group_key = hashlib.sha256(group.encode()).hexdigest()
        key = hashlib.sha256((group + json.dumps(sorted(set(finding.get("reasons", []))))).encode()).hexdigest()
        old = previous["active"].get(key)
        anchor = old["anchorEpoch"] if old else None
        if anchor is None:
            anchor = max(now, last.get(group_key, -1) + 1)
        elif anchor > last.get(group_key, -1):
            raise ValueError("invalid_observation_anchor")
        if not 0 <= anchor <= MAX_ANCHOR:
            raise ValueError("invalid_observation_anchor")
        active[key] = {"workflowId": finding["workflowId"], "code": finding["code"], "anchorEpoch": anchor}
        last[group_key] = max(anchor, last.get(group_key, -1))
        finding["payload"]["anchorEpoch"] = anchor
    if len(active) > MAX_KEYS or len(last) > MAX_KEYS:
        raise ValueError("observation_key_limit_exceeded")
    report["notificationPolicy"] = "continuous_incident"
    return {"version": 1, "active": active, "lastAnchors": last}
