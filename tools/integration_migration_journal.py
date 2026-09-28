"""Durable single-step outcomes for an already approved integration plan.

The lifecycle controller owns its mutex, protected directory and credentials.
This module has no connection/service operations and never retries a migration.
"""
from dataclasses import asdict, replace
import hashlib
import json
import os
from pathlib import Path
import re

from integration_migration_plan import Plan, PlanBlocked, canonical, confirm_single_step

VERSION = "teruisi-integration-migration-journal-v1"


def _safe_directory(directory):
    path = Path(directory).absolute()
    if not path.is_dir():
        raise PlanBlocked("journal directory is missing")
    for item in (path, *path.parents):
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise PlanBlocked("journal directory is redirected")
    return path


def _write_new(path, value):
    # A crashed/short write remains an explicit blocking artifact. Never replace
    # it with a newly generated intent or guess that the database rolled back.
    try:
        with path.open("xb") as output:
            output.write(canonical(value))
            output.flush()
            os.fsync(output.fileno())
    except FileExistsError:
        raise PlanBlocked("migration journal entry already exists; audit required") from None


def _read(path):
    if (not path.is_file() or path.is_symlink() or path.stat().st_nlink != 1
            or path.stat().st_size > 128 * 1024):
        raise PlanBlocked("migration journal file is missing or unsafe")
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise PlanBlocked("migration journal repeats a key")
            result[key] = value
        return result
    try:
        return json.loads(path.read_bytes(), object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise PlanBlocked("migration journal is incomplete or corrupt") from None


class Journal:
    def __init__(self, directory, operation_id):
        self.directory = _safe_directory(directory)
        if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{32}", operation_id):
            raise PlanBlocked("migration operation identity invalid")
        self.operation_id = operation_id

    def initialize(self, initial):
        if initial.completed or initial.next_step is None:
            raise PlanBlocked("new operation requires the exact unmodified baseline")
        _write_new(self.directory / "operation.json", {"version": VERSION,
            "operationId": self.operation_id, "initialPlan": asdict(initial),
            "initialPlanSha256": initial.sha256})

    def _initial(self):
        value = _read(self.directory / "operation.json")
        if (type(value) is not dict or set(value) != {"version", "operationId", "initialPlan",
                "initialPlanSha256"} or value["version"] != VERSION
                or value["operationId"] != self.operation_id):
            raise PlanBlocked("migration operation binding changed")
        try:
            fields = dict(value["initialPlan"])
            fields["completed"] = tuple(fields["completed"])
            fields["remaining"] = tuple(fields["remaining"])
            plan = Plan(**fields)
        except (TypeError, KeyError, ValueError):
            raise PlanBlocked("migration initial plan invalid") from None
        if plan.sha256 != value["initialPlanSha256"] or plan.completed:
            raise PlanBlocked("migration initial plan digest changed")
        return plan

    def _path(self, index, phase):
        return self.directory / f"{index:03d}-{phase}.json"

    def _intent(self, current):
        return {"version": VERSION, "operationId": self.operation_id,
            "before": asdict(current), "beforeSha256": current.sha256,
            "step": current.next_step, "identity": current.next_identity}

    def _check_history(self, current):
        initial = self._initial()
        if (initial.policy_sha256 != current.policy_sha256
                or initial.source_sha256 != current.source_sha256
                or initial.binding_sha256 != current.binding_sha256
                or current.completed + current.remaining != initial.remaining):
            raise PlanBlocked("migration source, lifecycle or database binding changed")
        for index, step in enumerate(current.completed):
            result = _read(self._path(index, "outcome"))
            intent = _read(self._path(index, "intent"))
            before = replace(initial, completed=initial.remaining[:index], remaining=initial.remaining[index:])
            after = replace(initial, completed=initial.remaining[:index+1], remaining=initial.remaining[index+1:])
            expected = {"version": VERSION, "operationId": self.operation_id, "status": "committed",
                "step": step, "intentSha256": hashlib.sha256(canonical(intent)).hexdigest(),
                "afterSha256": after.sha256}
            if canonical(intent) != canonical(self._intent(before)) or result != expected:
                raise PlanBlocked("a previous migration has no verified committed outcome")

    def reserve(self, current):
        if current.next_step is None:
            raise PlanBlocked("no migration remains")
        self._check_history(current)
        index = len(current.completed)
        intent = self._intent(current)
        _write_new(self._path(index, "intent"), intent)
        return hashlib.sha256(canonical(intent)).hexdigest()

    def complete(self, before, after, intent_sha256):
        confirm_single_step(before, after)
        intent = _read(self._path(len(before.completed), "intent"))
        if (hashlib.sha256(canonical(intent)).hexdigest() != intent_sha256
                or intent.get("beforeSha256") != before.sha256
                or intent.get("operationId") != self.operation_id):
            raise PlanBlocked("reserved migration intent changed")
        _write_new(self._path(len(before.completed), "outcome"), {
            "version": VERSION, "operationId": self.operation_id, "status": "committed",
            "step": before.next_step, "intentSha256": intent_sha256, "afterSha256": after.sha256})

    def complete_digest(self, final):
        if final.remaining:
            raise PlanBlocked("migration operation is incomplete")
        self._check_history(final)
        expected = {"operation.json"} | {self._path(index, phase).name
            for index in range(len(final.completed)) for phase in ("intent", "outcome")}
        if {item.name for item in self.directory.iterdir()} != expected:
            raise PlanBlocked("unexpected migration journal artifacts")
        return hashlib.sha256(canonical({name: hashlib.sha256(canonical(_read(
            self.directory / name))).hexdigest() for name in sorted(expected)})).hexdigest()


def apply_one(journal, approved, inspect, execute):
    before = inspect()
    if before != approved:
        raise PlanBlocked("approved migration plan no longer matches")
    intent_sha256 = journal.reserve(before)
    # Any exception/crash leaves an unmatched intent. Even if inspect() shows
    # the next receipt, this operation cannot replay or silently continue.
    execute(before.next_step, before.next_identity)
    after = inspect()
    journal.complete(before, after, intent_sha256)
    return after
