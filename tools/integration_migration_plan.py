"""Immutable-source plans for the reviewed 62 -> 136 migration generation.

This module validates plans and outcomes; it never grants database privileges,
opens a production connection, changes a release gate, or replays a step.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re

VERSION = "teruisi-integration-migration-plan-v1"
SOURCE_FORMAT = "python-utf8-lf-sha256-v1"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
NODE = re.compile(r"[a-z][a-z0-9_]*\.[0-9]{4}_[a-zA-Z0-9_]+\Z")
PRIVILEGED_STEPS = frozenset({
    "ai_assistant.0068_business_promotion_budget_v11_verifier_receipt",
    "ai_assistant.0070_business_promotion_budget_v11_limited_identity",
    "ai_assistant.0073_business_promotion_budget_v11_login_attestation",
    "ai_assistant.0074_business_market_v2_human_cap_approval",
    "ai_assistant.0076_business_promotion_budget_v11_ticket_bound_signer",
    "ai_assistant.0077_business_market_v6_paused_topology",
    "ai_assistant.0078_business_promotion_budget_v11_signed_publication",
    "ai_assistant.0079_business_market_v6_source_ticket",
})


class PlanBlocked(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
        ensure_ascii=True, allow_nan=False).encode("ascii")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def python_source_sha256(content: bytes):
    """Python's loader normalizes CRLF; Git checkout must not invalidate a plan."""
    try:
        content.decode("utf-8-sig")
    except UnicodeError:
        raise PlanBlocked("migration source must be UTF-8 Python") from None
    normalized = content.replace(b"\r\n", b"\n")
    if b"\r" in normalized:
        raise PlanBlocked("standalone carriage return in migration source")
    return hashlib.sha256(normalized).hexdigest()


def migration_key(value):
    if (not isinstance(value, (list, tuple)) or len(value) != 2
            or not all(type(part) is str for part in value)):
        raise PlanBlocked("migration identity shape invalid")
    key = ".".join(value)
    if not NODE.fullmatch(key):
        raise PlanBlocked("migration identity invalid")
    return key


@dataclass(frozen=True)
class Policy:
    baseline: tuple[str, ...]
    steps: tuple[str, ...]
    files: tuple[tuple[str, str], ...]
    bootstrap_roles: tuple[str, ...]

    def __post_init__(self):
        if (len(self.baseline) != 62 or len(self.steps) != 74
                or len(set(self.baseline + self.steps)) != 136
                or any(not NODE.fullmatch(key) for key in self.baseline + self.steps)
                or not PRIVILEGED_STEPS <= set(self.steps)
                or "ai_assistant.0080_model_tool_budget_300" not in self.steps
                or len(self.bootstrap_roles) != 24
                or len(set(self.bootstrap_roles)) != 24
                or any(not re.fullmatch(r"teruisi_ai_[a-z0-9_]+", name)
                    for name in self.bootstrap_roles)
                or not self.files or len(self.files) > 4096
                or len({path for path, _ in self.files}) != len(self.files)):
            raise PlanBlocked("integration generation inventory invalid")
        for path, expected in self.files:
            relative = Path(path)
            if (relative.is_absolute() or ".." in relative.parts or "\\" in path
                    or ":" in path or "\x00" in path or relative.as_posix() != path
                    or not path.startswith(("backend/", "tools/"))
                    or not path.endswith(".py") or not HEX64.fullmatch(expected)):
                raise PlanBlocked("source inventory path or digest invalid")

    @property
    def sha256(self):
        return digest({"version": VERSION, "sourceFormat": SOURCE_FORMAT, "baseline": self.baseline,
            "steps": self.steps, "files": self.files,
            "bootstrapRoles": self.bootstrap_roles})

    def verify_source(self, root: Path):
        root = root.resolve()
        for relative, expected in self.files:
            path = root / relative
            current = path
            while current != root:
                if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
                    raise PlanBlocked("source path is redirected")
                current = current.parent
            if (not path.is_file() or path.stat().st_nlink != 1
                    or python_source_sha256(path.read_bytes()) != expected):
                raise PlanBlocked("approved migration source changed")
        actual_python = {str(path.relative_to(root)).replace("\\", "/")
            for directory in ("backend", "tools")
            for path in (root / directory).rglob("*.py")}
        if actual_python != {path for path, _ in self.files}:
            raise PlanBlocked("Python source inventory expanded or disappeared")
        return digest(self.files)


@dataclass(frozen=True)
class Plan:
    policy_sha256: str
    source_sha256: str
    binding_sha256: str
    completed: tuple[str, ...]
    remaining: tuple[str, ...]

    @property
    def sha256(self):
        return digest({"version": VERSION, "policy": self.policy_sha256,
            "source": self.source_sha256, "databaseBinding": self.binding_sha256,
            "completed": self.completed, "remaining": self.remaining})

    @property
    def next_step(self):
        return self.remaining[0] if self.remaining else None

    @property
    def next_identity(self):
        if self.next_step is None:
            return None
        return "privileged" if self.next_step in PRIVILEGED_STEPS else "owner"


def build_plan(policy: Policy, root: Path, applied, pending, binding_sha256: str):
    """Require an exact forward prefix and the planner's complete remainder."""
    if not isinstance(binding_sha256, str) or not HEX64.fullmatch(binding_sha256):
        raise PlanBlocked("database/lifecycle binding digest invalid")
    source = policy.verify_source(root)
    keys = tuple(migration_key(node) for node in applied)
    if len(keys) != len(set(keys)) or not set(policy.baseline) <= set(keys):
        raise PlanBlocked("baseline receipts missing or duplicated")
    completed = tuple(key for key in policy.steps if key in keys)
    if (set(keys) != set(policy.baseline + completed)
            or completed != policy.steps[:len(completed)]):
        raise PlanBlocked("migration receipts are not an exact known prefix")
    wanted = policy.steps[len(completed):]
    actual = []
    for entry in pending:
        if (not isinstance(entry, (tuple, list)) or len(entry) != 3
                or entry[2] is not False):
            raise PlanBlocked("migration planner includes a reverse or invalid step")
        actual.append(migration_key(entry[:2]))
    if tuple(actual) != wanted:
        raise PlanBlocked("migration planner differs from the reviewed order")
    return Plan(policy.sha256, source, binding_sha256, completed, wanted)


def confirm_single_step(before: Plan, after: Plan):
    """A lost/failed response must be audited, never treated as retry permission."""
    if (before.next_step is None or before.policy_sha256 != after.policy_sha256
            or before.source_sha256 != after.source_sha256
            or before.binding_sha256 != after.binding_sha256
            or after.completed != before.completed + (before.next_step,)
            or after.remaining != before.remaining[1:]):
        raise PlanBlocked("operation outcome is not one exact committed step")
    return True


def load_policy(path: Path):
    if not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise PlanBlocked("migration policy is absent or oversized")
    def unique_pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise PlanBlocked("migration policy contains a duplicate key")
            result[key] = value
        return result
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)
        if (type(value) is not dict or set(value) != {"version", "sourceFormat", "baseline", "steps",
                "files", "bootstrapRoles"} or value["version"] != VERSION
                or value["sourceFormat"] != SOURCE_FORMAT):
            raise PlanBlocked("migration policy schema invalid")
        return Policy(tuple(value["baseline"]), tuple(value["steps"]),
            tuple(sorted(value["files"].items())), tuple(value["bootstrapRoles"]))
    except (ValueError, TypeError, AttributeError, KeyError):
        raise PlanBlocked("migration policy is invalid") from None
