"""Distil one finished task's evidence into a reviewable Skill candidate.

This is the first consumer of structured output: the schema comes from the
registered catalog, not from the prompt, and the model's reply is validated
against it before anything is stored. A valid shape proves only shape — the
references inside it are then checked against what the run actually read, and
the tools against the central registry.

The candidate stays a proposal. Nothing here publishes a method, grants a
tool, or makes anything discoverable by the Pi runtime.
"""
import json

from django.db import transaction
from django.utils import timezone

from . import models as m, output_schemas, pi_sources
from .candidate_models import STATUSES
from .policy import (AiError, canonical, cas, digest, fields, identifier,
                     mutation, passive, text, text_bytes, uid)

SCHEMA_REF = "skill-candidate-v1"
MAX_CONTENT_BYTES = 32768
MAX_NOTE = 2000


def _owned(candidate_id, principal, *, lock=False):
    query = m.AiSkillCandidate.objects.select_for_update() if lock else m.AiSkillCandidate.objects
    row = query.filter(id=identifier(candidate_id)).first()
    if row is None or row.owner_email.lower() != principal.email.lower():
        raise AiError("候选不存在或不属于当前账号", "not_found", 404)
    return row


def record(row):
    return {
        "id": row.id,
        "operationId": row.operation_id,
        "status": row.status,
        "schemaRef": row.schema_ref,
        "schemaDigest": row.schema_digest,
        "contentDigest": row.content_digest,
        "reportVersionDigest": row.report_version_digest,
        "content": json.loads(row.content_json),
        "feedbackIds": json.loads(row.feedback_ids_json),
        # Surfaced at every read, not only at creation: an approved method is
        # still a method, never evidence that its recommendations worked.
        "unverifiedRecommendations": row.unverified_count,
        "reviewedBy": row.reviewed_by or None,
        "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "reviewNote": row.review_note or None,
        "version": row.version,
    }


def request_schema(operation_id, principal):
    """What a caller sends to the model, and the evidence it may cite.

    Returned rather than built inside the dispatch so the caller can show the
    user which run is being distilled before any paid call is made.
    """
    evidence = pi_sources.evidence(operation_id, {}, principal)
    if not evidence["citable"]:
        raise AiError("任务未成功结束，不能作为提炼依据", "conflict", 409)
    resolved = output_schemas.resolve(SCHEMA_REF)
    return {
        "purpose": "skill_candidate",
        "outputSchemaRef": SCHEMA_REF,
        "schemaVersion": 1,
        "schemaDigest": resolved["schemaDigest"],
        "outputSchema": resolved["schema"],
        "sourceOperationIds": [evidence["reportVersion"]["operationId"]],
        "confirmedFeedbackIds": evidence["reportVersion"]["confirmedFeedbackIds"],
        "citableExportIds": [item["exportId"] for item in evidence["sources"]],
        "citableFileIds": [item["fileId"] for item in evidence["artifacts"]],
        "reportVersion": evidence["reportVersion"],
        "reportVersionDigest": evidence["reportVersionDigest"],
        # Stated to the caller so a prompt can carry it: coverage gaps belong in
        # the candidate's own open questions, not silently dropped.
        "coverage": evidence["coverage"],
    }


def _validate_content(raw, allowed_refs, registry_tools):
    content = passive(raw, MAX_CONTENT_BYTES)
    schema = output_schemas.CATALOG[SCHEMA_REF]
    if not isinstance(content, dict):
        raise AiError("候选正文必须是对象")
    missing = set(schema["required"]) - set(content)
    unexpected = set(content) - set(schema["properties"])
    if missing or unexpected:
        raise AiError("候选正文字段与登记 schema 不一致")
    if len(canonical(content).encode("utf-8")) > MAX_CONTENT_BYTES:
        raise AiError("候选正文超过长度上限")
    text(content["goal"], "goal", 240)
    text(content["body"], "body", 2000)
    # A tool the registry does not declare cannot be a step's tool: a candidate
    # that cites one would be unrunnable, and finding that out at publication
    # is later than finding it out here.
    for name in content["requiredTools"]:
        if name not in registry_tools:
            raise AiError(f"候选引用了未登记的工具：{name}", "invalid_request", 400)
    # Evidence references must come from the run itself. Without this the model
    # could cite an export belonging to another task, and the candidate would
    # look traceable while pointing somewhere else.
    for reference in content["sourceEvidenceRefs"]:
        if reference not in allowed_refs:
            raise AiError("候选引用了本次任务之外的来源", "forbidden", 403)
    return content


def save(operation_id, body, principal, *, registry_tools=()):
    """Store a model reply as a draft candidate after validating it."""
    fields(body, {"content", "schemaRef", "schemaDigest"},
           {"content", "schemaRef", "schemaDigest"})
    if body["schemaRef"] != SCHEMA_REF:
        raise AiError("候选 schema 引用不匹配")
    resolved = output_schemas.resolve(SCHEMA_REF)
    if body["schemaDigest"] != resolved["schemaDigest"]:
        # The schema changed between the dispatch and the reply. Accepting it
        # would store content shaped by a contract that no longer holds.
        raise AiError("登记 schema 已变化，请重新发起提炼", "conflict", 409)
    request = request_schema(operation_id, principal)
    allowed = set(request["citableExportIds"]) | set(request["citableFileIds"])
    content = _validate_content(body["content"], allowed, set(registry_tools))

    with mutation(principal):
        with transaction.atomic():
            live = (m.AiSkillCandidate.objects.select_for_update()
                    .filter(operation_id=request["reportVersion"]["operationId"],
                            schema_ref=SCHEMA_REF,
                            status__in=("draft", "in_review", "approved")).first())
            if live is not None:
                raise AiError("该任务已有在用候选，请先审核或退回", "conflict", 409)
            row = m.AiSkillCandidate.objects.create(
                id=uid("ai-candidate"),
                operation_id=request["reportVersion"]["operationId"],
                owner_email=principal.email.lower(),
                report_version_digest=request["reportVersionDigest"],
                report_version_json=canonical(request["reportVersion"]),
                content_json=canonical(content),
                content_digest=digest(content),
                schema_ref=SCHEMA_REF,
                schema_digest=resolved["schemaDigest"],
                feedback_ids_json=canonical(request["confirmedFeedbackIds"]),
                unverified_count=len(content["unverifiedRecommendations"]),
            )
    return {"item": record(row)}


def listing(params, principal):
    fields(params, {"status"})
    rows = m.AiSkillCandidate.objects.filter(owner_email=principal.email.lower())
    if "status" in params:
        if params["status"] not in STATUSES:
            raise AiError("候选状态无效")
        rows = rows.filter(status=params["status"])
    rows = rows.order_by("-created_at", "id")
    items = [record(row) for row in rows[:100]]
    return {"items": items, "returned": len(items), "total": rows.count()}


def review(candidate_id, body, principal):
    """Move a candidate through review. Approval binds the reviewed content."""
    fields(body, {"status", "expectedVersion", "note", "contentDigest"},
           {"status", "expectedVersion", "contentDigest"})
    target = body["status"]
    if target not in {"in_review", "approved", "rejected"}:
        raise AiError("审核目标状态无效")
    with mutation(principal):
        with transaction.atomic():
            row = _owned(candidate_id, principal, lock=True)
            cas(row, body["expectedVersion"])
            if row.status in {"approved", "rejected", "superseded"}:
                raise AiError("该候选已终结，不能再次审核", "conflict", 409)
            if body["contentDigest"] != row.content_digest:
                # The reviewer approved something else. Re-reading the digest is
                # what stops an edited candidate inheriting an old approval.
                raise AiError("候选内容已变化，请重新审阅", "conflict", 409)
            if target in {"approved", "rejected"}:
                row.reviewed_by = principal.email.lower()
                row.reviewed_at = timezone.now()
                # MAX_NOTE mirrors the database's octet_length(review_note)<=2000
                # CHECK (migration 0089): a byte count, not a character count,
                # so Chinese review notes need the byte-counting helper.
                row.review_note = text_bytes(body.get("note", ""), "note", MAX_NOTE, empty=True)
            row.status, row.version = target, row.version + 1
            row.updated_at = timezone.now()
            row.save(update_fields=["status", "version", "reviewed_by", "reviewed_at",
                                    "review_note", "updated_at"])
    return {"item": record(row)}
