"""Closed opt-in gate for promotion paused-to-queued activation.

The prepared paused candidate proves current mandatory four-tool capacity and
the exact report/version/actor. It is intentionally insufficient to resume:

* workflow_tick must route a published, admitted promotion run to the new
  pipeline rather than back into readiness._park;
* the actual Agent dispatcher must check a process-local permission and the
  current lease immediately before each provider reservation;
* every subsequent provider/tool microstep must verify the full saved prefix,
  no-truncation context, tool call limits, semantic read receipts and unknown
  results before resuming;
* resume CAS and first child creation must share the same short mutation.

No current production path installs all four. This module never returns a
runtime grant or writes a queued state; it is an explicit opt-in boundary for a
future versioned activation rather than a general workflow resume endpoint.
"""
from dataclasses import dataclass

from django.db import connection

from . import business_promotion_readiness as readiness
from .policy import AiError, digest, mutation

SCHEMA = "business-promotion-activation-candidate-v1"
_TOKEN = object()
REQUIRED_HOOKS = ("promotion_workflow_tick_route_v1",
    "promotion_provider_pre_reservation_gate_v1",
    "promotion_per_microstep_context_ledger_v1",
    "promotion_resume_and_first_child_atomic_v1")


@dataclass(frozen=True, slots=True, init=False)
class PreparedActivation:
    _resume: object
    _digest: str

    def __init__(self, token, resume):
        if token is not _TOKEN or type(resume) is not readiness.PreparedResume:
            raise AiError("词货启用对象只能从当前停靠准备建立", "invalid_request", 400)
        object.__setattr__(self, "_resume", resume)
        object.__setattr__(self, "_digest", digest([resume._report_id,
            resume._run_id, resume._version, resume._reference_json]))


def prepare(report_id, principal):
    """Read-only full paused capacity preparation outside a transaction."""
    if connection.in_atomic_block:
        raise AiError("词货启用准备须在最外层事务之外", "invalid_request", 400)
    resume = readiness.prepare_resume_candidate(report_id, principal)
    return PreparedActivation(_TOKEN, resume)


def inspect(prepared, principal):
    """Recheck the versioned CAS precursor in a short mutation; no write."""
    if (type(prepared) is not PreparedActivation
            or digest([prepared._resume._report_id, prepared._resume._run_id,
                prepared._resume._version, prepared._resume._reference_json]) != prepared._digest):
        raise AiError("词货启用候选内部绑定变化", "conflict", 409)
    with mutation(principal):
        plan = readiness.check_resume_candidate(prepared._resume, principal)
    if not (plan["capacityVerified"] is True and plan["casApplied"] is False
            and plan["pipelineRegistered"] is False):
        raise AiError("词货启用前置状态不符合停靠协议", "conflict", 409)
    return {"schemaVersion": SCHEMA, "runId": plan["runId"],
        "reportId": plan["reportId"], "expectedVersion": plan["expectedVersion"],
        "screeningReferenceDigest": digest(plan["screeningReference"]),
        "mandatoryCapacityVerified": True, "runtimeAdmissionGranted": False,
        "initialProviderCallAllowed": False, "casApplied": False,
        "missingHooks": list(REQUIRED_HOOKS),
        "activationSupported": False}


def activate(prepared, principal):
    """No caller can turn the candidate into a queued run in this version."""
    inspect(prepared, principal)
    raise AiError("词货恢复缺少正式调度路由及逐步派发账本门禁",
        "promotion_activation_incomplete", 409)
