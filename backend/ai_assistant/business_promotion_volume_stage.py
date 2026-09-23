"""Internal renderer-7 durable staging; publication remains DB-blocked.

Only an already approved promotion report may issue a queued file run. A
complete attempt stores immutable volume chunks and compact receipt, then
pauses as staged_unpublished. No public create/download or ready transition.
"""
from datetime import timedelta
import hashlib
import json
import time

from django.db import connection
from django.utils import timezone

from business_analysis import volume_delivery
from business_analysis.contracts import AnalysisContractError
from . import business_files as files, business_promotion_approved_content as approved_content
from . import business_promotion_content_contract as content_contract
from . import business_promotion_export as promotion_export
from . import business_promotion_file_proof as file_proof
from . import business_promotion_formal_volumes as temporary
from . import business_volume_files as volume_files
from . import models as m, reports
from .policy import AiError, authorize_owner, canonical, cas, current_principal, digest, mutation, passive, uid


VERSION = 7
SCHEMA = "business-promotion-file-staging-v1"


def _conflict(message="词货文件暂存与已批准报告不一致"):
    raise AiError(message, "conflict", 409)


def binding(report, principal, draft=False):
    """Full owning proof outside the short mutation; never a public token."""
    if draft is not False or connection.in_atomic_block:
        _conflict("词货文件仅支持事务外完整核验的正式批准报告")
    actual = reports.get(report.id, principal)
    value = approved_content.build(actual.id, principal)
    if (value["binding"]["reportId"] != actual.id
            or value["binding"]["humanReview"]["status"] != "approved"
            or json.loads(actual.snapshot_json).get("executionProfile") != content_contract.PROFILE):
        _conflict("词货文件缺少当前五角色与人审固定根")
    return digest([SCHEMA, actual.id, value["dtoDigest"], actual.snapshot_json,
        actual.workflow.input_json, False])


def create(report_id, principal):
    """Internal only: queue a formal run after full approval, without a route."""
    current_principal(principal, admin=True, write=True)
    report = reports.get(report_id, principal)
    fingerprint = binding(report, principal)
    with mutation(principal):
        current_principal(principal, admin=True, write=True)
        latest = reports.get(report_id, principal)
        if (latest.snapshot_json != report.snapshot_json
                or latest.workflow.input_json != report.workflow.input_json):
            _conflict("文件创建期间报告固定根已变化")
        old = m.AiBusinessFileRun.objects.filter(report=latest, draft=False,
            renderer_version=VERSION, binding_digest=fingerprint).first()
        if old:
            return {"item": files.mapping(authorize_owner(old, principal)), "replayed": True}
        if m.AiBusinessFileRun.objects.filter(owner_email=principal.email.lower(),
                status__in=["queued", "building", "paused"]).count() >= 2:
            raise AiError("未完成文件任务已达到上限", "rate_limited", 429)
        if m.AiBusinessFileRun.objects.count() >= 1000:
            raise AiError("文件任务存储容量已满", "rate_limited", 429)
        row = m.AiBusinessFileRun.objects.create(id=uid("promotion-file"), report=latest,
            owner_email=principal.email.lower(), draft=False, renderer_version=VERSION,
            binding_digest=fingerprint)
        files.audit(row, principal, "promotion_queued")
        return {"item": files.mapping(row), "replayed": False}


def control(run_id, action, expected_version, principal):
    """Internal pause/resume/rebuild/cancel with CAS and attempt isolation."""
    if action not in {"pause", "resume", "rebuild", "cancel"}:
        raise AiError("词货暂存动作无效")
    candidate = files.get(run_id, principal)
    if candidate.renderer_version != VERSION:
        _conflict("此控制器仅用于词货暂存任务")
    cas(candidate, expected_version)
    fingerprint = binding(candidate.report, principal) if action in {"resume", "rebuild"} else None
    with mutation(principal):
        row = files.get(run_id, principal)
        cas(row, expected_version)
        if row.status in {"ready", "cancelled"}:
            _conflict("词货文件任务已终止")
        if action in {"resume", "rebuild"}:
            if row.status != "paused" or fingerprint != row.binding_digest:
                _conflict("已暂停报告的批准内容或人审已变化")
            if action == "rebuild": row.manifest_json = "{}"
            if row.manifest_json == "{}" and row.attempt >= 5:
                _conflict("词货暂存重建已达到五次上限")
        row.status = {"pause": "paused", "resume": "queued",
            "rebuild": "queued", "cancel": "cancelled"}[action]
        row.error_code = ""
        row.lease_until = timezone.now()
        row.version += 1
        row.save()
        files.audit(row, principal, "promotion_"+action)
        return {"item": files.mapping(row)}


def _verify_staged(row, principal, checkpoint):
    """Read every persisted byte and compare to current completed roots."""
    try:
        compact = volume_delivery.validate(json.loads(row.manifest_json),
            binding_digest=row.binding_digest, attempt=row.attempt,
            draft=False, renderer_version=VERSION)
    except (ValueError, TypeError, KeyError, AnalysisContractError) as error:
        raise AiError("词货暂存紧凑清单无效", "conflict", 409) from error
    descriptors = [*compact["files"], compact["manifestFile"]]
    full_raw = bytearray()
    total_parts = 0
    for descriptor in descriptors:
        sha, size, count = hashlib.sha256(), 0, 0
        query = m.AiBusinessVolumeChunk.objects.filter(run=row, attempt=row.attempt,
            volume_index=descriptor["volumeIndex"], format=descriptor["format"]).order_by("sequence")
        for part in query.iterator(chunk_size=4):
            checkpoint()
            count += 1
            raw = bytes(part.content)
            expected_length = min(files.CHUNK_BYTES, descriptor["bytes"]-size)
            if (part.sequence != count or len(raw) != expected_length
                    or hashlib.sha256(raw).hexdigest() != part.content_digest):
                _conflict("词货卷分块序号、大小或摘要不符")
            size += len(raw); sha.update(raw)
            if descriptor["format"] == "json": full_raw.extend(raw)
        if (count, size, sha.hexdigest()) != (descriptor["chunkCount"],
                descriptor["bytes"], descriptor["sha256"]):
            _conflict("词货卷文件与紧凑清单不一致")
        total_parts += count
    if m.AiBusinessVolumeChunk.objects.filter(run=row, attempt=row.attempt).count() != total_parts:
        _conflict("词货暂存存在未声明分片")
    actual = approved_content.build(row.report_id, principal)
    snapshot = json.loads(row.report.snapshot_json)
    try:
        full = volume_delivery.verify_full(compact, bytes(full_raw),
            binding_digest=row.binding_digest, attempt=row.attempt, draft=False,
            report_id=row.report_id, evidence_digest=actual["binding"]["sealedDigest"],
            renderer_version=VERSION)
        selector = snapshot["promotionSelector"]
        material = promotion_export.prepare(row.report_id, selector["sourceKey"], principal,
            baseline_key=selector.get("baselineKey"), checkpoint=checkpoint).manifest
        completed = content_contract.prepare(actual["binding"], actual["content"])
        proof = file_proof.prepare(completed, material).value
    except (AnalysisContractError, file_proof.FileProofError,
            content_contract.ContentContractError) as error:
        raise AiError("词货暂存完整证明与当前封存来源不一致", "conflict", 409) from error
    if (full.get("promotionFileProof") != proof
            or full["reportId"] != row.report_id
            or full["evidenceDigest"] != snapshot["sealedDigest"]):
        _conflict("词货暂存清单跨报告、证据或人审")
    return compact


def build(row, principal, state):
    """Called only by the file builder's existing advisory-lock tick."""
    if row.renderer_version != VERSION or row.draft:
        _conflict("词货暂存版本或草稿状态无效")
    started, last_check, last_saved = time.monotonic(), 0, 0
    def checkpoint(progress=None, force=False):
        nonlocal last_check, last_saved
        now = time.monotonic()
        if now-started > files.BUILD_SECONDS:
            raise AiError("词货暂存超过原600秒构建预算", "file_build_timeout", 409)
        if not force and now-last_check < 1:
            return
        current_principal(principal, admin=True)
        files._current(row.id, principal, state)
        last_check = now
        if progress is not None and now-last_saved >= 5:
            with mutation(principal):
                saved = files._current(row.id, principal, state)
                saved.progress_json = canonical(passive(progress, 4096))
                saved.lease_until = timezone.now()+timedelta(seconds=files.LEASE_SECONDS)
                saved.version += 1
                saved.save()
                files.audit(saved, principal, "promotion_progress")
            state["version"], last_saved = saved.version, now
    if row.manifest_json == "{}":
        with temporary.open_volumes(row.report_id, principal, checkpoint=checkpoint) as prepared:
            temp = prepared.manifest
            source_raw = prepared.path(0, "json").read_bytes()
            try:
                full = volume_delivery.verify_full(temp["compactManifest"], source_raw,
                    binding_digest=temp["compactManifest"]["bindingDigest"],
                    attempt=1, draft=False, report_id=row.report_id,
                    evidence_digest=json.loads(row.report.snapshot_json)["sealedDigest"],
                    renderer_version=VERSION)
                compact, raw_manifest = volume_delivery.make(full,
                    binding_digest=row.binding_digest, attempt=state["attempt"],
                    draft=False, renderer_version=VERSION)
            except AnalysisContractError as error:
                raise AiError("词货临时卷不能绑定当前持久尝试", "conflict", 409) from error
            if raw_manifest != source_raw:
                _conflict("临时多卷清单与持久绑定规范字节不同")
            for descriptor in [*compact["files"], compact["manifestFile"]]:
                checkpoint(force=True)
                volume_files._save_file(row, principal, state, descriptor,
                    prepared.path(descriptor["volumeIndex"], descriptor["format"]), checkpoint)
            checkpoint(force=True)
            with mutation(principal):
                saved = files._current(row.id, principal, state)
                saved.manifest_json = canonical(passive(compact, 131072))
                saved.progress_json = canonical({"stage": "verifying_unpublished"})
                saved.version += 1
                saved.save()
                files.audit(saved, principal, "promotion_staged")
            state["version"] = saved.version
    checkpoint(force=True)
    _verify_staged(files._current(row.id, principal, state), principal, checkpoint)
    checkpoint(force=True)
    if binding(row.report, principal) != row.binding_digest:
        _conflict("暂存完成前实际批准内容发生变化")
    checkpoint(force=True)
    with mutation(principal):
        saved = files._current(row.id, principal, state)
        saved.status = "paused"
        saved.error_code = "renderer_unpublished"
        saved.progress_json = canonical({"stage": "staged_unpublished", "attempt": saved.attempt})
        saved.version += 1
        saved.save()
        files.audit(saved, principal, "promotion_staged_unpublished")
    return {"status": "staged_unpublished", "runId": saved.id,
        "version": saved.version, "attempt": saved.attempt}


def _publication_fence(report_id, principal):
    """Short database-only fence around the previously completed heavy proof."""
    from . import business_promotion_review as review
    current_principal(principal, admin=True, write=True)
    report = m.AiReportRun.objects.select_related("workflow").get(pk=report_id)
    flow = report.workflow
    roles = content_contract.ROLES
    nodes = list(m.AiWorkflowNodeRuns.objects.filter(run=flow,
        node_key__in=(*roles, "human_review")).order_by("position").values(
        "id", "node_key", "version", "status", "output_json", "agent_job_id",
        "reviewer_email", "reviewed_at", "completed_at"))
    jobs = list(m.AiAgentJobs.objects.filter(workflow_run_id=flow.id,
        workflow_node_key__in=roles).order_by("workflow_node_key").values(
        "id", "workflow_node_key", "version", "status", "output_json",
        "provider_round_count", "tool_call_count", "cancel_requested"))
    events = list(m.AiWorkflowEvents.objects.filter(run=flow,
        node_key="human_review", event_type="review_approved").order_by("id").values(
        "id", "actor_email", "owner_email", "run_version", "from_status",
        "to_status", "created_at"))
    if len(nodes) != 6 or len(jobs) != 5 or len(events) != 1:
        _conflict("正式文件人审或五角色持久身份不完整")
    actual_ledger_digest = review._ledger([job["id"] for job in jobs])
    for item in (*nodes, *events):
        for key, value in item.items():
            if hasattr(value, "isoformat"):
                item[key] = value.isoformat()
    return digest({"reportId": report.id, "snapshotJson": report.snapshot_json,
        "ownerEmail": report.owner_email, "scopeJson": report.scope_json,
        "workflow": {key: getattr(flow, key) for key in
            ("id", "version", "status", "current_node_key", "cancel_requested",
             "input_json", "output_json", "graph_json", "graph_digest",
             "tool_policy_digest", "allowed_tools_json", "model_id", "model_version")},
        "nodes": nodes, "jobs": jobs, "reviewEvents": events,
        "providerToolLedgerDigest": actual_ledger_digest})


def publish(run_id, expected_version, principal):
    """Internal verified paused→ready CAS; public download remains disconnected."""
    if connection.in_atomic_block:
        raise AiError("词货完整发布验证须在最外层事务之外", "invalid_request", 400)
    row = files.get(run_id, principal)
    cas(row, expected_version)
    if (row.renderer_version != VERSION or row.draft or row.status != "paused"
            or row.error_code != "renderer_unpublished" or row.manifest_json == "{}"
            or json.loads(row.progress_json).get("stage") != "staged_unpublished"):
        _conflict("只有已完整暂存且尚未发布的词货文件可以进入发布核验")
    if row.report.workflow.status != "completed":
        _conflict("正式文件发布须等待六节点工作流完成并保存总输出")
    fingerprint = binding(row.report, principal)
    if fingerprint != row.binding_digest:
        _conflict("词货文件绑定与当前人审结果不同")
    before = _publication_fence(row.report_id, principal)
    compact = _verify_staged(row, principal, lambda *args, **kwargs: None)
    if (_publication_fence(row.report_id, principal) != before
            or binding(row.report, principal) != row.binding_digest):
        _conflict("词货文件完整核验期间报告、人审或账本变化")
    with mutation(principal):
        saved = files.get(run_id, principal)
        cas(saved, expected_version)
        if (saved.renderer_version != VERSION or saved.draft or saved.status != "paused"
                or saved.error_code != "renderer_unpublished"
                or saved.attempt != row.attempt or saved.manifest_json != row.manifest_json
                or saved.stored_bytes != row.stored_bytes
                or json.loads(saved.progress_json).get("stage") != "staged_unpublished"
                or _publication_fence(saved.report_id, principal) != before):
            _conflict("词货文件发布事务内固定状态变化")
        try:
            checked = volume_delivery.validate(json.loads(saved.manifest_json),
                binding_digest=saved.binding_digest, attempt=saved.attempt,
                draft=False, renderer_version=VERSION)
        except (AnalysisContractError, ValueError, TypeError, KeyError) as error:
            raise AiError("词货发布事务内紧凑清单无效", "conflict", 409) from error
        if checked != compact:
            _conflict("词货文件发布事务内紧凑清单变化")
        saved.status = "ready"
        saved.error_code = ""
        saved.progress_json = canonical({"stage": "ready"})
        saved.version += 1
        saved.save()
        files.audit(saved, principal, "promotion_ready")
    return {"item": files.mapping(saved)}
