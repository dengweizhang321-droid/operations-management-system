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

from integration_migration_plan import (Plan, PlanBlocked, canonical, confirm_single_step,
    VERSION as LEGACY_GENERATION, DELTA_VERSION, LEGACY_CATALOGUE_SHA256, digest)

VERSION = "teruisi-integration-migration-journal-v1"
DELTA_JOURNAL = "teruisi-netshop-presence-delta-journal-v1"


def plan_fields(plan):
    value = asdict(plan)
    if plan.generation == LEGACY_GENERATION:
        value.pop("generation")  # Preserve the historical v1 journal bytes.
    return value


def validate_baseline_witness(value):
    keys = {"baselineCatalogueSha256", "parentReceiptSha256", "beforeBackupSha256",
            "beforeRestoreSha256", "rolesSha256", "authoritySha256", "protectedCatalogueSha256"}
    if (type(value) is not dict or set(value) != keys
            or any(not isinstance(item, str) or not re.fullmatch(r"[0-9a-f]{64}", item) for item in value.values())
            or value["baselineCatalogueSha256"] != LEGACY_CATALOGUE_SHA256):
        raise PlanBlocked("delta baseline witness invalid")
    return value


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
    def __init__(self, directory, operation_id, *, generation=LEGACY_GENERATION, baseline_witness=None):
        self.directory = _safe_directory(directory)
        if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{32}", operation_id):
            raise PlanBlocked("migration operation identity invalid")
        self.operation_id = operation_id
        if generation not in (LEGACY_GENERATION, DELTA_VERSION):
            raise PlanBlocked("unknown journal generation")
        self.generation = generation
        self.version = DELTA_JOURNAL if generation == DELTA_VERSION else VERSION
        self.witness = validate_baseline_witness(baseline_witness) if generation == DELTA_VERSION else None
        if generation == LEGACY_GENERATION and baseline_witness is not None:
            raise PlanBlocked("legacy journal cannot borrow delta witness")

    def envelope(self):
        result = {"version": self.version, "operationId": self.operation_id}
        if self.witness is not None:
            result["baselineWitness"] = self.witness
            result["baselineWitnessSha256"] = digest(self.witness)
        return result

    def initialize(self, initial):
        if initial.generation != self.generation or initial.completed or initial.next_step is None:
            raise PlanBlocked("new operation requires the exact unmodified baseline")
        _write_new(self.directory / "operation.json", {**self.envelope(), "initialPlan": plan_fields(initial),
            "initialPlanSha256": initial.sha256})

    def _initial(self):
        value = _read(self.directory / "operation.json")
        envelope = self.envelope()
        if (type(value) is not dict or set(value) != set(envelope) | {"initialPlan", "initialPlanSha256"}
                or any(value.get(key) != item for key, item in envelope.items())):
            raise PlanBlocked("migration operation binding changed")
        try:
            fields = dict(value["initialPlan"])
            fields["completed"] = tuple(fields["completed"])
            fields["remaining"] = tuple(fields["remaining"])
            plan = Plan(**fields)
        except (TypeError, KeyError, ValueError):
            raise PlanBlocked("migration initial plan invalid") from None
        if plan.generation != self.generation or plan.sha256 != value["initialPlanSha256"] or plan.completed:
            raise PlanBlocked("migration initial plan digest changed")
        return plan

    def _path(self, index, phase):
        return self.directory / f"{index:03d}-{phase}.json"

    def _intent(self, current):
        return {**self.envelope(), "before": plan_fields(current), "beforeSha256": current.sha256,
            "step": current.next_step, "identity": current.next_identity}

    def _check_history(self, current):
        initial = self._initial()
        if (initial.generation != current.generation or initial.policy_sha256 != current.policy_sha256
                or initial.source_sha256 != current.source_sha256
                or initial.binding_sha256 != current.binding_sha256
                or current.completed + current.remaining != initial.remaining):
            raise PlanBlocked("migration source, lifecycle or database binding changed")
        for index, step in enumerate(current.completed):
            result = _read(self._path(index, "outcome"))
            intent = _read(self._path(index, "intent"))
            before = replace(initial, completed=initial.remaining[:index], remaining=initial.remaining[index:])
            after = replace(initial, completed=initial.remaining[:index+1], remaining=initial.remaining[index+1:])
            expected = {**self.envelope(), "status": "committed",
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
            **self.envelope(), "status": "committed",
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
