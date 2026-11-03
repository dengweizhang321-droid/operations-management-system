"""One-shot Windows Task Scheduler runner. No independent notification transport."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import uuid

from n8n_schedule_watch_incidents import atomic_json, check_path, state_root, observation_lock

ROOT = Path(__file__).resolve().parents[1]


def stamp():
    return datetime.now(timezone.utc).isoformat()


def run(root, execute=False):
    check_path(root)
    root.mkdir(parents=True, exist_ok=True)
    # A separate root for the runner's OS lock: never take the observer or
    # sender lock while waiting on that child. No delivery ledger lives here.
    with observation_lock(root / "schedule-watch-runner"):
        path = root / ("schedule-watch-latest.json" if execute else "schedule-watch-preview.json")
        attempt = {"version": 1, "attemptId": uuid.uuid4().hex, "startedAt": stamp(),
                   "finishedAt": None, "status": "running", "mode": "execute" if execute else "dry-run",
                   "exitCode": None}
        atomic_json(path, attempt)
        # pythonw has no console; capture the normal python child's JSON.
        interpreter = Path(sys.executable).with_name("python.exe") if sys.platform == "win32" else Path(sys.executable)
        command = [str(interpreter), str(ROOT / "tools/n8n_schedule_watch.py"),
                   "--execute" if execute else "--dry-run", "--continuous-incidents", "--state-root", str(root)]
        code = 2
        try:
            result = subprocess.run(command, capture_output=True, encoding="utf-8", timeout=1200,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if len(result.stdout.encode("utf-8")) > 900_000:
                raise ValueError("report_too_large")
            report = json.loads(result.stdout)
            if not isinstance(report, dict) or result.returncode not in (0, 1, 2):
                raise ValueError("invalid_report")
            code = result.returncode
            attempt.update(status="completed" if code < 2 else "unconfirmed", report=report)
        except (OSError, ValueError, subprocess.SubprocessError):
            # A timeout may interrupt a send. Original sender reservations are
            # retained and this wrapper never retries or deletes a ledger.
            attempt.update(status="unconfirmed", reason="inspection_or_delivery_unconfirmed")
        attempt.update(finishedAt=stamp(), exitCode=code)
        atomic_json(path, attempt)
        return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--state-root", type=Path)
    args = parser.parse_args()
    try:
        return run(state_root(args.state_root), args.execute)
    except (OSError, ValueError):
        # Task Scheduler preserves this even if heartbeat storage itself fails.
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
