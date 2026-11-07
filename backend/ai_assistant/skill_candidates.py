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

from . import models as m, output_schemas, pi_sources, pi_service, prompt_settings, report_library
from .pi_models import PiEvent, PiOperation, PiSession
from .candidate_models import STATUSES
from .policy import (AiError, canonical, cas, current_principal, digest, fields,
                     identifier, integer, mutation, passive, scope_covers,
                     scope_filter, text, text_bytes, uid)

SCHEMA_REF = "skill-candidate-v1"
MAX_CONTENT_BYTES = 32768
MAX_NOTE = 2000
MAX_KEYWORDS = 8
MAX_DOMAINS = 6
PUBLICATION_EVENT = "skill_candidate_published"
PUBLICATION_PAGE_SIZE = 10


def source_operation(operation_id, principal):
    row = (PiOperation.objects.select_related("session")
           .filter(id=identifier(operation_id)).first())
    if (row is None or row.session.owner_email.lower() != principal.email.lower()
            or row.actor_role != principal.role or not scope_covers(principal.scope, row.scope_json)):
        raise AiError("任务不存在或超出当前权限", "not_found", 404)
    return row


def _owned(candidate_id, principal, *, lock=False):
    query = m.AiSkillCandidate.objects.select_for_update() if lock else m.AiSkillCandidate.objects
    row = query.select_related("operation").filter(id=identifier(candidate_id)).first()
    if (row is None or row.owner_email.lower() != principal.email.lower()
            or row.operation.actor_role != principal.role
            or not scope_covers(principal.scope, row.operation.scope_json)):
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
    source_operation(operation_id, principal)
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
    if not isinstance(content["steps"], list):
        raise AiError("steps 必须是数组", "invalid_request", 400)
    for index, step in enumerate(content["steps"]):
        if not isinstance(step, dict):
            raise AiError(f"第 {index + 1} 步必须是对象", "invalid_request", 400)
        # No-tool steps may omit toolName or use strict output's empty string.
        # Check registration only; requiredTools need not mirror the steps,
        # and this catalog is not an execution permission grant.
        name = step.get("toolName", "")
        if not isinstance(name, str):
            raise AiError(f"steps[{index}].toolName 必须是字符串", "invalid_request", 400)
        if name and name not in registry_tools:
            raise AiError(f"候选引用了未登记的工具：{name}（steps[{index}].toolName）",
                          "invalid_request", 400)
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
    with mutation(principal):
        request = request_schema(operation_id, principal)
        allowed = set(request["citableExportIds"]) | set(request["citableFileIds"])
        content = _validate_content(body["content"], allowed, set(registry_tools))
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
    if "publicationPage" in params or "publicationId" in params:
        return _publication_listing(params, principal)
    fields(params, {"status"})
    current_principal(principal)
    rows = scope_filter(m.AiSkillCandidate.objects.filter(
        owner_email=principal.email.lower(), operation__actor_role=principal.role),
        principal, field="operation__scope_json")
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
            if target != "rejected" and not _reviewable(json.loads(row.content_json)):
                raise AiError("候选正文与登记格式不一致，请退回候选", "invalid_candidate_output", 422)
            if target == "approved" and request_schema(row.operation_id, principal)["reportVersionDigest"] != row.report_version_digest:
                raise AiError("报告版本已变化，请退回候选并重新提炼", "version_conflict", 409)
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


def _slug_from_candidate(row):
    # report_library ids are 1-64 lowercase/digit/hyphen slugs (library.slug);
    # the candidate id itself (uuid-based, "ai-candidate-<uuid4>") is not one.
    # Deriving a stable slug from it (rather than letting the caller invent an
    # id) is what makes "has this candidate already been published" checkable
    # at all: the skills list is otherwise just named entries with no back
    # reference to the candidate they came from. Keep the full uuid (not just
    # its last dash-segment): "candidate-<full uuid>" is 46 chars, well under
    # slug()'s 64-char limit, and there is no reason to shorten it and invite
    # a collision between two different candidates' trailing segments.
    return "candidate-" + row.id.removeprefix("ai-candidate-")


def _method(row, content):
    goal = text(content["goal"], "goal", 240)
    return {"id": _slug_from_candidate(row), "name": goal[:80].strip(),
            "description": goal, "body": text(content["body"], "body", 2000)}


def _reviewable(content):
    if not isinstance(content, dict) or not isinstance(content.get("steps"), list):
        return False
    # The legacy save API allowed toolName to be omitted for a no-tool step.
    # Normalize only that field for validation, leaving stored content intact.
    value = {**content, "steps": [{"toolName": "", **step} if isinstance(step, dict) else step
                                  for step in content["steps"]]}
    return output_schemas.matches(value, output_schemas.CATALOG[SCHEMA_REF])


def _publication_receipts(rows):
    by_operation = {row.operation_id: row for row in rows}
    events = PiEvent.objects.filter(operation_id__in=by_operation, event_type=PUBLICATION_EVENT)
    receipts = {}
    for operation_id, raw in events.order_by("event_seq").values_list("operation_id", "data_json"):
        event = json.loads(raw)
        row = by_operation[operation_id]
        if event.get("candidateId") == row.id and event.get("skillId") == _slug_from_candidate(row):
            receipts[row.id] = event
    return receipts


def _publication(row, library, receipt):
    skill_id = _slug_from_candidate(row)
    skill = next((item for item in library["config"]["skills"] if item["id"] == skill_id), None)
    content = json.loads(row.content_json)
    if (skill and receipt and all(skill.get(key) == value for key, value in _method(row, content).items())):
        state = "enabled" if skill["enabled"] else "disabled"
    else:
        state = "unavailable" if skill or receipt or not _reviewable(content) else "unpublished"
    return {"state": state, "skillId": skill_id, "libraryVersion": library["version"],
            "publishedLibraryVersion": receipt["libraryVersion"] if receipt else None}


def publication(row):
    library, receipts = _publication_state([row])
    return _publication(row, library, receipts.get(row.id))


def _publication_state(rows):
    library = report_library.snapshot()
    receipts = _publication_receipts(rows)
    # The read can straddle publication's atomic revision + event commit.
    if any(receipt["libraryVersion"] > library["version"] for receipt in receipts.values()):
        library = report_library.snapshot()
    return library, receipts


def _publication_listing(params, principal):
    current_principal(principal, admin=True)
    rows = m.AiSkillCandidate.objects.filter(status="approved").order_by("-reviewed_at", "id")
    if "publicationId" in params:
        fields(params, {"publicationId"})
        items = list(rows.filter(id=identifier(params["publicationId"]))[:1])
        if not items:
            raise AiError("已批准的候选不存在", "not_found", 404)
    else:
        fields(params, {"publicationPage"})
        page = params["publicationPage"]
        if not isinstance(page, str) or not page.isascii() or not page.isdecimal() or len(page) > 5:
            raise AiError("页码无效")
        offset = (integer(int(page), "页码", 1, 99999) - 1) * PUBLICATION_PAGE_SIZE
        items = list(rows[offset:offset + PUBLICATION_PAGE_SIZE + 1])
    library, receipts = _publication_state(items[:PUBLICATION_PAGE_SIZE])
    return {
        "items": [{
            "id": row.id, "operationId": row.operation_id, "version": row.version,
            "reportVersionDigest": row.report_version_digest, "contentDigest": row.content_digest,
            "reviewedBy": row.reviewed_by, "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
            "reviewNote": row.review_note, "unverifiedRecommendations": row.unverified_count,
            "method": _method(row, json.loads(row.content_json)),
            "publication": _publication(row, library, receipts.get(row.id)),
        } for row in items[:PUBLICATION_PAGE_SIZE]],
        "domains": prompt_settings.DOMAINS,
        "hasMore": len(items) > PUBLICATION_PAGE_SIZE,
    }


def _round_robin_keywords(domains):
    """Pick up to MAX_KEYWORDS trigger words, rotating across every domain.

    Measured against 12 operations-style questions: using only the Chinese
    domain label (e.g. just "网店") as the sole keyword matched 3/12, because
    real questions use words like "京东" or "转化" that never appear verbatim
    in the label. Rotating through `prompt_settings.ALIASES` -- the same
    table prompt_settings.py already uses to trigger its own domain rules --
    matched 12/12. Round-robin (one word per domain per pass) instead of
    draining the first domain's list first is what keeps a multi-domain
    candidate from losing every later domain's words to the 8-word cap.
    """
    pools = [list(prompt_settings.ALIASES.get(domain, ())) for domain in domains]
    picked, seen = [], set()
    while len(picked) < MAX_KEYWORDS and any(pools):
        for pool in pools:
            if not pool:
                continue
            word = pool.pop(0)
            if word not in seen:
                seen.add(word)
                picked.append(word)
                if len(picked) >= MAX_KEYWORDS:
                    break
    return picked


def publish(candidate_id, body, principal):
    """Turn an approved candidate into a live report_library skill entry.

    This is the only path from a reviewed candidate to something the Pi
    runtime's guidance() can actually select -- report_library.guidance()
    only looks at report_library.snapshot()["config"]["skills"], never at
    AiSkillCandidate. Publishing is deliberately a *copy*, not a status flip:
    the candidate row stays the audit trail of what was approved and by whom,
    while the library row is the thing guidance() reads at request time.

    Permission is unscoped admin (current_principal(principal, admin=True)),
    not ownership. report_library.save() already requires the same; a
    candidate's owner is who proposed it, not who is trusted to make it live
    system-wide, so publish does not use _owned()/row-level ownership at all
    -- an admin must be able to publish someone else's approved candidate.
    """
    fields(body, {"domains", "keywords", "expectedLibraryVersion", "expectedVersion", "contentDigest"},
           {"domains", "expectedLibraryVersion"})
    expected = integer(body["expectedLibraryVersion"], "资源库版本", 0)
    current_principal(principal, admin=True)
    candidate_id = identifier(candidate_id)
    bound = "expectedVersion" in body or "contentDigest" in body
    if bound and not {"expectedVersion", "contentDigest"} <= set(body):
        raise AiError("须同时提交候选版本和内容摘要")
    domains = body["domains"]
    if (not isinstance(domains, list) or not 1 <= len(domains) <= MAX_DOMAINS
            or any(not isinstance(d, str) or d not in prompt_settings.DOMAINS for d in domains)
            or len(set(domains)) != len(domains)):
        raise AiError("领域无效", "invalid_request", 400)
    # keywords: explicit body value wins (an admin publishing with domain
    # knowledge the ALIASES table does not capture yet), otherwise derive by
    # round robin across the chosen domains' ALIASES.
    if "keywords" in body:
        keywords = body["keywords"]
        if (not isinstance(keywords, list) or not 1 <= len(keywords) <= MAX_KEYWORDS
                or any(not isinstance(k, str) for k in keywords)
                or len(set(keywords)) != len(keywords)):
            raise AiError("触发词无效", "invalid_request", 400)
        keywords = [text(k, "触发词", 32) for k in keywords]
    else:
        keywords = _round_robin_keywords(domains)
        if not keywords:
            raise AiError("所选领域没有可用触发词，请显式提供 keywords", "invalid_request", 400)
    with mutation(principal):
        current_principal(principal, admin=True)
        row = m.AiSkillCandidate.objects.select_for_update().filter(id=candidate_id).first()
        if row is None:
            raise AiError("候选不存在", "not_found", 404)
        if row.status != "approved" or not row.reviewed_by or not row.reviewed_at:
            raise AiError("只有已批准的候选可以发布", "conflict", 409)
        if bound:
            cas(row, body["expectedVersion"])
            if body["contentDigest"] != row.content_digest:
                raise AiError("候选内容已变化，请重新读取", "version_conflict", 409)
        content = json.loads(row.content_json)
        if not _reviewable(content):
            raise AiError("候选正文与登记格式不一致，无法发布", "invalid_candidate_output", 422)
        item = report_library.validate_item("skills", {
            **_method(row, content), "enabled": True,
            "keywords": keywords, "domains": domains,
        })
        slug = item["id"]
        current = report_library.snapshot()
        prior = _publication_receipts([row]).get(row.id)
        if prior:
            # A lost HTTP response can be recovered using the exact same approved
            # version, library precondition and published selection.
            if bound and prior["libraryVersion"] == expected + 1:
                original = report_library.snapshot(prior["libraryVersion"])
                if item in original["config"]["skills"]:
                    return {"item": record(row), "library": original,
                            "publication": _publication(row, current, prior)}
            raise AiError("该候选已经发布，不能重复发布", "conflict", 409)
        if any(skill["id"] == slug for skill in current["config"]["skills"]):
            raise AiError("方法标识已存在，未找到此候选的发布回执", "conflict", 409)
        result = report_library.save(
            {"kind": "skills", "item": item, "expectedVersion": expected}, principal, candidate_publication=True)
        session = PiSession.objects.select_for_update().get(pk=row.operation.session_id)
        receipt = {
            "candidateId": row.id, "skillId": slug,
            "libraryVersion": result["item"]["version"],
            "candidateVersion": row.version, "contentDigest": row.content_digest,
            "reportVersionDigest": row.report_version_digest,
            "actor": principal.email.lower(),
        }
        pi_service.event(session, PUBLICATION_EVENT, receipt, row.operation)
    return {"item": record(row), "library": result["item"],
            "publication": _publication(row, result["item"], receipt)}
