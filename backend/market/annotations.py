from __future__ import annotations

import hashlib
import math
import secrets
import uuid
from collections import Counter
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Avg, Count, Exists, F, Max, OuterRef, Q, Subquery
from django.db.models.functions import Substr
from django.utils import timezone

from sales.auth import Principal

from .errors import MarketApiError
from .models import (
    MarketAnnotationCloudRun,
    MarketAnnotationCommitReceipt,
    MarketAnnotationConcurrencySetting,
    MarketAnnotationItem,
    MarketAnnotationJob,
    MarketAnnotationLocalAgent,
    MarketAnnotationPromptAudit,
    MarketAnnotationPromptVersion,
    MarketAnnotationValidationResult,
    MarketAnnotationValidationRun,
    MarketAnnotationValidationSample,
    MarketImageCache,
    MarketMasterAuditLog,
    MarketMasterIdentity,
    MarketPriceSnapshot,
    MarketRankingEntry,
    MarketSkuAnnotation,
    MarketSubcategoryTaxonomy,
)
from .revisions import bump_revision, canonical_json, iso


MAX_JOB_ITEMS = 10_000
MAX_PAGE = 50_000
MAX_PAGE_SIZE = 200
MAX_FILTERED_SELECTION = 50_000
LEASE_MINUTES = 5
VALID_PRICE_TYPES = {
    "",
    "标准售价",
    "到手价",
    "券后价",
    "起售价",
    "价格区间",
    "最低规格价格",
    "定金",
    "分期金额",
    "无法判断",
}
FORMAL_PRICE_TYPES = {"标准售价", "到手价", "券后价"}


def _error(message: str, *, code: str = "invalid_request", status: int = 400) -> MarketApiError:
    return MarketApiError(message, code=code, status=status)


def _text(value: object, label: str, maximum: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise _error(f"{label} 必须是字符串")
    normalized = value.strip()
    if required and not normalized:
        raise _error(f"{label} 不能为空")
    if len(normalized) > maximum:
        raise _error(f"{label} 超出长度上限")
    return normalized


def _integer(
    value: object,
    label: str,
    *,
    fallback: int | None = None,
    minimum: int = 0,
    maximum: int = 100_000_000,
    nullable: bool = False,
) -> int | None:
    if value is None and nullable:
        return None
    if value is None and fallback is not None:
        return fallback
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum or value > maximum:
        raise _error(f"{label} 参数无效")
    return value


def _texts(value: object, label: str, maximum: int = 50) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > maximum:
        raise _error(f"{label} 参数无效")
    result: list[str] = []
    for item in value:
        normalized = _text(item, label, 200, required=True)
        if normalized not in result:
            result.append(normalized)
    return result


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _audit(principal: Principal, action: str, entity_type: str, entity_id: str, before: object, after: object) -> None:
    MarketMasterAuditLog.objects.create(
        actor_email=principal.email.lower(),
        actor_role=principal.role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_json=before if isinstance(before, (dict, list)) else {"value": before},
        after_json=after if isinstance(after, (dict, list)) else {"value": after},
    )


def _prompt_value(row: MarketAnnotationPromptVersion) -> dict[str, object]:
    return {
        "id": row.id,
        "category": row.category,
        "version": int(row.version),
        "parentId": row.parent_id,
        "source": row.source,
        "status": row.status,
        "segments": row.segments_json,
        "promptBody": row.prompt_body,
        "changeNote": row.change_note,
        "metrics": row.metrics_json,
        "createdBy": row.created_by,
        "createdAt": iso(row.created_at),
        "activatedBy": row.activated_by,
        "activatedAt": iso(row.activated_at),
    }


def _job_value(row: MarketAnnotationJob) -> dict[str, object]:
    remaining = MarketAnnotationItem.objects.filter(job_id=row.id).filter(
        Q(status__in=["queued", "claimed", "inferencing"])
        | Q(status="failed", attempt_count__lt=3)
    ).count()
    return {
        "id": row.id,
        "category": row.category,
        "promptVersionId": row.prompt_version_id,
        "executor": row.executor,
        "modelId": row.model_id,
        "localModelName": row.local_model_name,
        "status": row.status,
        "totalCount": int(row.total_count),
        "completedCount": int(row.completed_count),
        "failedCount": int(row.failed_count),
        "reviewedCount": int(row.reviewed_count),
        "committedCount": int(row.committed_count),
        "remainingInferenceCount": remaining,
        "createdBy": row.created_by,
        "createdAt": iso(row.created_at),
        "startedAt": iso(row.started_at),
        "completedAt": iso(row.completed_at),
        "updatedAt": iso(row.updated_at),
    }


def _item_value(row: MarketAnnotationItem) -> dict[str, object]:
    ai_recognition = bool(
        row.ai_segment
        or row.ai_image_price_cents is not None
        or row.ai_confidence_bps is not None
        or row.ai_reason
    )
    return {
        "id": row.id,
        "candidateId": row.id,
        "jobId": row.job_id,
        "category": row.category,
        "skuCode": row.sku_code,
        "rankingDimension": row.ranking_dimension,
        "month": row.month,
        "imageContentSha256": row.image_content_sha256,
        "productName": row.product_name,
        "brand": row.brand,
        "sourceImageUrl": row.source_image_url,
        "resolvedImageUrl": row.resolved_image_url,
        "imageSource": row.image_source,
        "status": row.status,
        "aiSegment": row.ai_segment,
        "aiImagePriceCents": row.ai_image_price_cents,
        "aiPriceType": row.ai_price_type,
        "aiPriceLowCents": row.ai_price_low_cents,
        "aiPriceHighCents": row.ai_price_high_cents,
        "aiConfidenceBps": row.ai_confidence_bps,
        "aiReason": row.ai_reason,
        "modelInputBytes": int(row.model_input_bytes),
        "imageLoadMs": int(row.image_load_ms),
        "imagePrepareMs": int(row.image_prepare_ms),
        "modelCallMs": int(row.model_call_ms),
        "totalInferenceMs": int(row.total_inference_ms),
        "reviewedSegment": row.reviewed_segment,
        "reviewedImagePriceCents": row.reviewed_image_price_cents,
        "reviewedPriceType": row.reviewed_price_type,
        "reviewedPriceLowCents": row.reviewed_price_low_cents,
        "reviewedPriceHighCents": row.reviewed_price_high_cents,
        "reviewPriceSource": "ai" if ai_recognition else "manual",
        "selected": bool(row.selected),
        "reviewedBy": row.reviewed_by,
        "reviewedAt": iso(row.reviewed_at),
        "attemptCount": int(row.attempt_count),
        "errorMessage": row.error_message,
        "version": int(row.version),
        "createdAt": iso(row.created_at),
        "updatedAt": iso(row.updated_at),
    }


def _cloud_run_value(row: MarketAnnotationCloudRun, configured: int) -> dict[str, object]:
    return {
        "jobId": row.job_id,
        "state": row.state,
        "runConcurrency": configured,
        "targetConcurrency": configured,
        "recovering": False,
        "nextRunAt": iso(row.next_run_at),
        "lastFailureCode": row.last_failure_code,
        "lastFailureMessage": row.last_failure_message,
        "lastStartedAt": iso(row.last_started_at),
        "lastHeartbeatAt": iso(row.last_heartbeat_at),
        "completedAt": iso(row.completed_at),
        "updatedAt": iso(row.updated_at),
    }


def _refresh_job(job_id: str) -> MarketAnnotationJob:
    job = MarketAnnotationJob.objects.get(id=job_id)
    items = MarketAnnotationItem.objects.filter(job_id=job_id).exclude(status="superseded")
    counts = Counter(items.values_list("status", flat=True))
    total = items.count()
    remaining = sum(counts[item] for item in ("queued", "claimed", "inferencing")) + items.filter(status="failed", attempt_count__lt=3).count()
    job.total_count = total
    job.completed_count = sum(counts[item] for item in ("review_pending", "approved", "rejected", "committed"))
    job.failed_count = counts["failed"]
    job.reviewed_count = sum(counts[item] for item in ("approved", "rejected", "committed"))
    job.committed_count = counts["committed"]
    if job.status not in {"cancelled", "committed", "deleted"}:
        if total and counts["committed"] == total:
            job.status = "committed"
        elif remaining == 0:
            job.status = "review_ready"
        else:
            job.status = "running" if job.started_at else "queued"
    if job.status in {"review_ready", "committed"}:
        job.completed_at = job.completed_at or timezone.now()
    job.save()
    return job


def _current_snapshot(item: MarketAnnotationItem) -> MarketPriceSnapshot | None:
    snapshot = MarketPriceSnapshot.objects.filter(
        category=item.category,
        scope=item.scope,
        sku_code=item.sku_code,
        ranking_dimension=item.ranking_dimension,
        month=item.month,
    ).first()
    if snapshot is None:
        return None
    cache = MarketImageCache.objects.filter(source_url=snapshot.image_url, status="ready").first()
    current_hash = cache.content_sha256 if cache and cache.content_sha256 else snapshot.image_content_sha256
    if current_hash != item.image_content_sha256:
        return None
    if not MarketRankingEntry.objects.filter(
        category=item.category,
        scope=item.scope,
        sku_code=item.sku_code,
        ranking_dimension=item.ranking_dimension,
        period_end__startswith=item.month,
    ).exists():
        return None
    return snapshot


def _taxonomy(category: str) -> list[str]:
    return list(
        MarketSubcategoryTaxonomy.objects.filter(category=category, status="active")
        .values_list("subcategory", flat=True)
        .order_by("sort_order", "subcategory")
    )


def candidate_counts() -> dict[str, object]:
    categories = list(
        MarketRankingEntry.objects.exclude(category="")
        .values_list("category", flat=True)
        .distinct()
        .order_by("category")
    )
    latest_rows = (
        MarketRankingEntry.objects.filter(
            id__in=MarketMasterIdentity.objects.values("latest_entry_id")
        )
        .exclude(category="")
        .annotate(latest_month=Substr("period_end", 1, 7))
    )
    snapshot_hash = (
        MarketPriceSnapshot.objects.filter(
            category=OuterRef("category"),
            scope=OuterRef("scope"),
            sku_code=OuterRef("sku_code"),
            ranking_dimension=OuterRef("ranking_dimension"),
            month=OuterRef("latest_month"),
        )
        .exclude(image_content_sha256="")
        .values("image_content_sha256")[:1]
    )
    with_hash = latest_rows.annotate(candidate_image_hash=Subquery(snapshot_hash))
    already_annotated = MarketSkuAnnotation.objects.filter(
        category=OuterRef("category"),
        scope=OuterRef("scope"),
        ranking_dimension=OuterRef("ranking_dimension"),
        sku_code=OuterRef("sku_code"),
        image_content_sha256=OuterRef("candidate_image_hash"),
    )
    candidate_rows = (
        with_hash.exclude(candidate_image_hash__isnull=True)
        .annotate(already_annotated=Exists(already_annotated))
        .filter(already_annotated=False)
        .values("category")
        .annotate(candidate_count=Count("id"))
    )
    values = {str(row["category"]): int(row["candidate_count"]) for row in candidate_rows}
    return {
        "categories": [
            {"value": category, "candidateCount": values.get(category, 0)}
            for category in categories
        ]
    }


def _catalog(params: dict[str, object]) -> dict[str, object]:
    page = int(_integer(params.get("page"), "page", fallback=1, minimum=1, maximum=MAX_PAGE) or 1)
    page_size = int(_integer(params.get("pageSize"), "pageSize", fallback=30, minimum=10, maximum=100) or 30)
    q = _text(params.get("q", ""), "q", 120)
    rows = MarketRankingEntry.objects.filter(id__in=MarketMasterIdentity.objects.values("latest_entry_id"))
    if q:
        rows = rows.filter(Q(sku_code__icontains=q) | Q(product_name__icontains=q) | Q(brand__icontains=q))
    total = rows.count()
    items = []
    for row in rows.order_by("-period_end", "rank", "id")[(page - 1) * page_size : page * page_size]:
        snapshot = MarketPriceSnapshot.objects.filter(
            category=row.category,
            scope=row.scope,
            sku_code=row.sku_code,
            ranking_dimension=row.ranking_dimension,
            month=row.period_end[:7],
        ).first()
        image_hash = snapshot.image_content_sha256 if snapshot else ""
        annotation = MarketSkuAnnotation.objects.filter(
            category=row.category,
            scope=row.scope,
            ranking_dimension=row.ranking_dimension,
            sku_code=row.sku_code,
            image_content_sha256=image_hash,
        ).first()
        items.append(
            {
                "category": row.category,
                "scope": row.scope,
                "skuCode": row.sku_code,
                "rankingDimension": row.ranking_dimension,
                "productName": row.product_name,
                "brand": row.brand,
                "imageUrl": row.image_url,
                "imageContentSha256": image_hash,
                "segment": annotation.segment if annotation else "",
                "annotationStatus": "committed" if annotation else "pending",
            }
        )
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "pageCount": max(1, math.ceil(total / page_size)),
        "query": q,
    }


def _review(params: dict[str, object]) -> dict[str, object]:
    item_page = int(_integer(params.get("itemPage"), "itemPage", fallback=1, minimum=1, maximum=MAX_PAGE) or 1)
    item_page_size = int(_integer(params.get("itemPageSize"), "itemPageSize", fallback=20, minimum=10, maximum=MAX_PAGE_SIZE) or 20)
    job_id = _text(params.get("jobId", ""), "jobId", 128)
    aggregate = params.get("aggregateJobs") is True
    categories = _texts(params.get("itemCategories"), "itemCategories")
    query = MarketAnnotationItem.objects.exclude(status="superseded").exclude(
        job_id__in=MarketAnnotationJob.objects.filter(status="deleted").values("id")
    )
    if aggregate:
        if categories:
            query = query.filter(category__in=categories)
    elif job_id:
        query = query.filter(job_id=job_id)
    else:
        query = query.none()
    scope_query = query
    segments = _texts(params.get("itemSegments"), "itemSegments")
    if segments:
        query = query.filter(Q(reviewed_segment__in=segments) | Q(reviewed_segment="", ai_segment__in=segments))
    storage = _texts(params.get("storageStatuses"), "storageStatuses")
    if storage == ["committed"]:
        query = query.filter(status="committed")
    elif storage == ["pending"]:
        query = query.exclude(status="committed")
    recognition = _texts(params.get("recognitionSources"), "recognitionSources")
    if recognition == ["ai"]:
        query = query.exclude(ai_segment="", ai_image_price_cents__isnull=True, ai_confidence_bps__isnull=True, ai_reason="")
    elif recognition == ["non_ai"]:
        query = query.filter(ai_segment="", ai_image_price_cents__isnull=True, ai_confidence_bps__isnull=True, ai_reason="")
    total = query.count()
    items = [_item_value(item) for item in query.order_by("-created_at", "id")[(item_page - 1) * item_page_size : item_page * item_page_size]]
    reviewable = query.filter(status__in=["review_pending", "approved", "rejected"]).count()
    selected = query.filter(selected=True, status__in=["review_pending", "approved", "rejected"]).count()
    return {
        "items": items,
        "itemPagination": {"page": item_page, "pageSize": item_page_size, "total": total, "pageCount": max(1, math.ceil(total / item_page_size))},
        "reviewSummary": {
            "jobCount": scope_query.values("job_id").distinct().count(),
            "recordCount": scope_query.count(),
            "uniqueCandidateCount": scope_query.values("category", "scope", "sku_code", "ranking_dimension", "month", "image_content_sha256").distinct().count(),
        },
        "selection": {
            "filteredReviewableCount": reviewable,
            "filteredSelectedCount": selected,
            "scopeSelectedCount": scope_query.filter(selected=True).count(),
        },
    }


def annotation_workspace(params: dict[str, object], principal: Principal, *, candidate_count: bool = True) -> dict[str, object]:
    review = _review(params)
    categories = []
    counts_by_category = {item["value"]: item["candidateCount"] for item in candidate_counts()["categories"]} if candidate_count else {}
    for row in MarketRankingEntry.objects.exclude(category="").values("category").annotate(count=Count("sku_code", distinct=True)).order_by("-count", "category")[:200]:
        categories.append({"value": row["category"], "count": row["count"], "candidateCount": counts_by_category.get(row["category"]) if candidate_count else None})
    review_categories = list(
        MarketAnnotationItem.objects.exclude(category="").values(value=F("category"))
        .annotate(jobCount=Count("job_id", distinct=True), recordCount=Count("id"))
        .order_by("-jobCount", "-recordCount", "value")[:200]
    )
    prompts = [_prompt_value(row) for row in MarketAnnotationPromptVersion.objects.exclude(status="deleted").order_by("category", "-version")[:300]]
    jobs = [_job_value(row) for row in MarketAnnotationJob.objects.exclude(status="deleted").order_by("-created_at")[:50]]
    settings = [
        {"category": row.category, "executor": row.executor, "concurrency": row.concurrency, "updatedBy": row.updated_by, "updatedAt": iso(row.updated_at)}
        for row in MarketAnnotationConcurrencySetting.objects.order_by("category", "executor")[:400]
    ]
    setting_map = {(item["category"], item["executor"]): int(item["concurrency"]) for item in settings}
    cloud_runs = []
    for run in MarketAnnotationCloudRun.objects.order_by("-updated_at")[:100]:
        job = MarketAnnotationJob.objects.filter(id=run.job_id).first()
        cloud_runs.append(_cloud_run_value(run, setting_map.get((job.category if job else "", "cloud"), 2)))
    validation_runs = []
    for run in MarketAnnotationValidationRun.objects.order_by("-created_at")[:30]:
        validation_runs.append(
            {
                "id": run.id,
                "category": run.category,
                "baselinePromptId": run.baseline_prompt_id,
                "candidatePromptId": run.candidate_prompt_id,
                "modelId": run.model_id,
                "status": run.status,
                "seed": run.seed,
                "requestedSampleCount": run.requested_sample_count,
                "sampleCount": run.sample_count,
                "sampleHash": run.sample_hash,
                "metrics": run.metrics_json,
                "gate": run.gate_json,
                "createdBy": run.created_by,
                "createdAt": iso(run.created_at),
                "completedAt": iso(run.completed_at),
            }
        )
    validation_results = [
        {
            "id": row.id,
            "runId": row.run_id,
            "promptVersionId": row.prompt_version_id,
            "status": row.status,
            "predictedSegment": row.predicted_segment,
            "predictedImagePriceCents": row.predicted_image_price_cents,
            "confidenceBps": row.confidence_bps,
            "isCorrect": row.is_correct,
            "errorMessage": row.error_message,
            **row.sample_snapshot_json,
        }
        for row in MarketAnnotationValidationResult.objects.order_by("-created_at")[:500]
    ]
    agents = []
    if principal.role == "admin":
        agents = [
            {
                "id": row.id,
                "name": row.name,
                "status": row.status,
                "capabilities": row.capabilities_json,
                "createdBy": row.created_by,
                "createdAt": iso(row.created_at),
                "lastSeenAt": iso(row.last_seen_at),
                "revokedAt": iso(row.revoked_at),
            }
            for row in MarketAnnotationLocalAgent.objects.order_by("-created_at")[:50]
        ]
    return {
        "categories": categories,
        "reviewCategories": review_categories,
        "taxonomy": list(MarketSubcategoryTaxonomy.objects.filter(status="active").values("category", value=F("subcategory")).order_by("category", "sort_order", "subcategory")[:2000]),
        "prompts": prompts,
        "jobs": jobs,
        "concurrencySettings": settings,
        "cloudRuns": cloud_runs,
        **review,
        "models": [],
        "textModels": [],
        "catalog": _catalog(params) if params.get("includeCatalog") is True else {"items": [], "page": 1, "pageSize": 30, "total": 0, "pageCount": 1, "query": ""},
        "validationRuns": validation_runs,
        "validationResults": validation_results,
        "agents": agents,
    }


def execute_annotation_query(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    if set(payload) != {"operation", "view", "params"} or payload.get("operation") != "annotations":
        raise _error("市场标注查询字段无效")
    view = payload.get("view")
    params = payload.get("params")
    if not isinstance(params, dict):
        raise _error("市场标注查询参数无效")
    if view == "candidate_counts":
        return candidate_counts()
    if view == "progress":
        job_id = _text(params.get("jobId"), "jobId", 128, required=True)
        job = MarketAnnotationJob.objects.filter(id=job_id).first()
        if not job:
            raise _error("标注任务不存在", code="not_found", status=404)
        job = _refresh_job(job_id)
        now = timezone.now()
        active = MarketAnnotationItem.objects.filter(
            job_id=job_id,
            status="claimed",
            lease_expires_at__gt=now,
        ).count()
        base = MarketAnnotationItem.objects.filter(job_id=job_id).exclude(status="superseded")
        unique_units = base.values(
            "category", "scope", "sku_code", "ranking_dimension", "image_content_sha256"
        ).distinct().count()
        remaining_units = base.filter(
            Q(status__in=["queued", "claimed"])
            | Q(status="failed", attempt_count__lt=3)
        ).values(
            "category", "scope", "sku_code", "ranking_dimension", "image_content_sha256"
        ).distinct().count()
        measured = base.filter(total_inference_ms__gt=0)
        performance = measured.aggregate(
            imageLoadMs=Avg("image_load_ms"),
            imagePrepareMs=Avg("image_prepare_ms"),
            modelCallMs=Avg("model_call_ms"),
            totalInferenceMs=Avg("total_inference_ms"),
            modelInputBytes=Avg("model_input_bytes"),
        )
        cloud_run = MarketAnnotationCloudRun.objects.filter(job_id=job_id).first()
        configured = MarketAnnotationConcurrencySetting.objects.filter(
            category=job.category, executor="cloud"
        ).values_list("concurrency", flat=True).first() or 2
        return {
            "job": _job_value(job),
            "activeClaims": active,
            "uniqueInferenceUnits": unique_units,
            "remainingInferenceUnits": remaining_units,
            "cloudRun": _cloud_run_value(cloud_run, int(configured)) if cloud_run else None,
            "performance": {
                "measuredCount": measured.count(),
                "averageImageLoadMs": round(performance["imageLoadMs"] or 0),
                "averageImagePrepareMs": round(performance["imagePrepareMs"] or 0),
                "averageModelCallMs": round(performance["modelCallMs"] or 0),
                "averageTotalInferenceMs": round(performance["totalInferenceMs"] or 0),
                "averageModelInputBytes": round(performance["modelInputBytes"] or 0),
            },
        }
    if view == "catalog":
        return {"catalog": _catalog(params)}
    if view == "review":
        return _review(params)
    if view in {"workspace", "workspace_fast"}:
        return annotation_workspace(params, principal, candidate_count=view == "workspace")
    raise _error("不支持的市场标注视图")


def _create_prompt(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    category = _text(payload.get("category"), "category", 200, required=True)
    segments = _texts(payload.get("segments"), "segments", 200)
    if not segments:
        raise _error("Prompt 必须包含细分品类枚举")
    taxonomy = set(_taxonomy(category))
    if taxonomy and set(segments) != taxonomy:
        raise _error("Prompt 枚举必须与当前细分品类字典完全一致", code="version_conflict", status=409)
    body = _text(payload.get("promptBody"), "promptBody", 50_000, required=True)
    parent_id = _text(payload.get("parentId", ""), "parentId", 128)
    version = (MarketAnnotationPromptVersion.objects.filter(category=category).aggregate(value=Max("version"))["value"] or 0) + 1
    row = MarketAnnotationPromptVersion.objects.create(
        id=f"market-prompt-{uuid.uuid4()}",
        category=category,
        version=version,
        parent_id=parent_id or None,
        source=_text(payload.get("source", "manual"), "source", 32),
        segments_json=segments,
        prompt_body=body,
        change_note=_text(payload.get("changeNote", ""), "changeNote", 500),
        created_by=principal.email.lower(),
    )
    MarketAnnotationPromptAudit.objects.create(id=f"market-prompt-audit-{uuid.uuid4()}", prompt_id=row.id, category=category, action="create", reason=row.change_note, actor=principal.email.lower())
    _audit(principal, "create_market_annotation_prompt", "market_annotation_prompt", row.id, {}, _prompt_value(row))
    return _prompt_value(row)


def _candidate_rows(category: str):
    return MarketRankingEntry.objects.filter(
        category=category,
        ranking_dimension="SKU",
        id__in=MarketMasterIdentity.objects.values("latest_entry_id"),
    ).order_by("-period_end", "rank", "id")


@transaction.atomic
def _create_job(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    category = _text(payload.get("category"), "category", 200, required=True)
    prompt_id = _text(payload.get("promptVersionId"), "promptVersionId", 128, required=True)
    executor = _text(payload.get("executor", "cloud"), "executor", 16, required=True)
    if executor not in {"cloud", "local"}:
        raise _error("执行器必须是 cloud 或 local")
    prompt = MarketAnnotationPromptVersion.objects.filter(id=prompt_id, category=category).first()
    if not prompt or prompt.status != "active":
        raise _error("标注任务必须绑定当前激活 Prompt", code="version_conflict", status=409)
    if set(prompt.segments_json) != set(_taxonomy(category)) and _taxonomy(category):
        raise _error("Prompt 枚举已过期", code="version_conflict", status=409)
    limit = int(_integer(payload.get("limit"), "limit", fallback=100, minimum=1, maximum=MAX_JOB_ITEMS) or 100)
    model_id = _text(payload.get("modelId", ""), "modelId", 128)
    local_model = _text(payload.get("localModelName", ""), "localModelName", 200)
    if executor == "cloud" and not model_id:
        raise _error("云端标注必须选择视觉模型")
    if executor == "local" and not local_model:
        raise _error("本地标注必须指定本地模型")
    work_key = _digest(canonical_json({"category": category, "promptVersionId": prompt_id, "executor": executor, "modelId": model_id if executor == "cloud" else "", "localModelName": local_model if executor == "local" else ""}))
    existing = MarketAnnotationJob.objects.filter(work_key=work_key, status__in=["queued", "running", "failed"]).first()
    if existing:
        return {**_job_value(existing), "reused": True}
    job_id = f"market-annotation-job-{uuid.uuid4()}"
    items: list[MarketAnnotationItem] = []
    for row in _candidate_rows(category):
        if len(items) >= limit:
            break
        snapshot = MarketPriceSnapshot.objects.filter(
            category=row.category,
            scope=row.scope,
            sku_code=row.sku_code,
            ranking_dimension=row.ranking_dimension,
            month=row.period_end[:7],
        ).first()
        if snapshot is None:
            continue
        cache = MarketImageCache.objects.filter(source_url=snapshot.image_url, status="ready").first()
        image_hash = cache.content_sha256 if cache and cache.content_sha256 else snapshot.image_content_sha256
        if not image_hash:
            continue
        committed_annotation = MarketSkuAnnotation.objects.filter(
            category=row.category,
            scope=row.scope,
            sku_code=row.sku_code,
            ranking_dimension=row.ranking_dimension,
            image_content_sha256=image_hash,
        ).first()
        needs_price = snapshot.confirmed_market_price_cents is None
        if committed_annotation is not None and not needs_price:
            continue
        exact_history = MarketAnnotationItem.objects.filter(
            category=row.category,
            scope=row.scope,
            sku_code=row.sku_code,
            ranking_dimension=row.ranking_dimension,
            image_content_sha256=image_hash,
            status="committed",
        ).exclude(reviewed_segment="").order_by("-reviewed_at").first()
        valid_segment = (
            committed_annotation.segment
            if committed_annotation and committed_annotation.segment in prompt.segments_json
            else exact_history.reviewed_segment
            if exact_history and exact_history.reviewed_segment in prompt.segments_json
            else ""
        )
        status = "review_pending" if exact_history and exact_history.reviewed_price_type in FORMAL_PRICE_TYPES and exact_history.reviewed_image_price_cents is not None else "queued"
        items.append(
            MarketAnnotationItem(
                id=f"market-annotation-item-{uuid.uuid4()}",
                job_id=job_id,
                category=row.category,
                scope=row.scope,
                sku_code=row.sku_code,
                ranking_dimension=row.ranking_dimension,
                month=row.period_end[:7],
                image_content_sha256=image_hash,
                product_name=row.product_name,
                brand=row.brand,
                source_image_url=snapshot.image_url or row.image_url,
                status=status,
                ai_segment=valid_segment if status == "review_pending" else "",
                ai_image_price_cents=exact_history.reviewed_image_price_cents if status == "review_pending" else None,
                ai_price_type=exact_history.reviewed_price_type if status == "review_pending" else "",
                ai_price_low_cents=exact_history.reviewed_price_low_cents if status == "review_pending" else None,
                ai_price_high_cents=exact_history.reviewed_price_high_cents if status == "review_pending" else None,
                reviewed_segment=valid_segment,
                reviewed_image_price_cents=exact_history.reviewed_image_price_cents if status == "review_pending" else None,
                reviewed_price_type=exact_history.reviewed_price_type if status == "review_pending" else "",
                reviewed_price_low_cents=exact_history.reviewed_price_low_cents if status == "review_pending" else None,
                reviewed_price_high_cents=exact_history.reviewed_price_high_cents if status == "review_pending" else None,
                reviewed_by="history_same_image" if status == "review_pending" else "history_same_sku_segment" if valid_segment else "",
                reviewed_at=timezone.now() if status == "review_pending" else None,
            )
        )
    job = MarketAnnotationJob.objects.create(
        id=job_id,
        category=category,
        prompt_version_id=prompt_id,
        executor=executor,
        model_id=model_id or None,
        local_model_name=local_model,
        work_key=work_key,
        reuse_status="ready",
        status="queued" if items else "review_ready",
        total_count=len(items),
        completed_count=sum(1 for item in items if item.status == "review_pending"),
        created_by=principal.email.lower(),
        completed_at=timezone.now() if not items else None,
    )
    MarketAnnotationItem.objects.bulk_create(items, batch_size=500)
    if executor == "cloud":
        MarketAnnotationCloudRun.objects.create(job_id=job.id, state="paused", retry_state_json={})
    _audit(principal, "create_market_annotation_job", "market_annotation_job", job.id, {}, {"category": category, "promptVersionId": prompt_id, "executor": executor, "totalCount": len(items)})
    return {**_job_value(job), "reused": False}


def _set_concurrency(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    category = _text(payload.get("category"), "category", 200, required=True)
    executor = _text(payload.get("executor"), "executor", 16, required=True)
    if executor not in {"cloud", "local"}:
        raise _error("执行器必须是 cloud 或 local")
    concurrency = int(_integer(payload.get("concurrency"), "concurrency", minimum=1, maximum=50) or 1)
    row, _ = MarketAnnotationConcurrencySetting.objects.update_or_create(
        category=category,
        executor=executor,
        defaults={"concurrency": concurrency, "updated_by": principal.email.lower()},
    )
    _audit(principal, "set_market_annotation_concurrency", "market_annotation_concurrency", f"{category}|{executor}", {}, {"concurrency": concurrency})
    return {"category": category, "executor": executor, "concurrency": concurrency, "updatedBy": row.updated_by, "updatedAt": iso(row.updated_at)}


def _set_cloud_run(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    job_id = _text(payload.get("jobId"), "jobId", 128, required=True)
    state = _text(payload.get("state"), "state", 16, required=True)
    if state not in {"running", "paused"}:
        raise _error("云端后台状态必须是 running 或 paused")
    job = MarketAnnotationJob.objects.filter(id=job_id, executor="cloud").first()
    if not job or job.status in {"cancelled", "committed", "deleted"}:
        raise _error("云端标注任务不存在或已经结束", code="version_conflict", status=409)
    run, _ = MarketAnnotationCloudRun.objects.update_or_create(
        job_id=job_id,
        defaults={"state": state, "next_run_at": timezone.now() if state == "running" else None, "lease_token_hash": "", "lease_expires_at": None},
    )
    configured = MarketAnnotationConcurrencySetting.objects.filter(category=job.category, executor="cloud").values_list("concurrency", flat=True).first() or 2
    _audit(principal, "set_market_annotation_cloud_run_state", "market_annotation_cloud_run", job_id, {}, {"state": state})
    return _cloud_run_value(run, int(configured))


@transaction.atomic
def _claim_job_item(
    payload: dict[str, object],
    principal: Principal,
    *,
    agent_id: str = "",
) -> dict[str, object]:
    executor = _text(payload.get("executor", "cloud"), "executor", 16, required=True)
    job_id = _text(payload.get("jobId", ""), "jobId", 128)
    if executor not in {"cloud", "local"}:
        raise _error("执行器必须是 cloud 或 local")
    now = timezone.now()
    MarketAnnotationItem.objects.filter(status="claimed", lease_expires_at__lte=now).update(
        status="failed", lease_token_hash="", lease_agent_id="", lease_expires_at=None, error_message="标注执行租约已过期", version=F("version") + 1, updated_at=now
    )
    jobs = MarketAnnotationJob.objects.select_for_update().filter(
        executor=executor,
        status__in=["queued", "running", "failed"],
    )
    if job_id:
        jobs = jobs.filter(id=job_id)
    if executor == "cloud":
        jobs = jobs.filter(
            id__in=MarketAnnotationCloudRun.objects.filter(
                state="running",
            ).filter(Q(next_run_at__isnull=True) | Q(next_run_at__lte=now)).values("job_id")
        )
    job = jobs.order_by("created_at", "id").first()
    if not job:
        return {"task": None}
    if executor == "cloud":
        run = MarketAnnotationCloudRun.objects.select_for_update().filter(
            job_id=job.id,
            state="running",
        ).first()
        if run is None:
            return {"task": None}
    configured = int(
        MarketAnnotationConcurrencySetting.objects.filter(
            category=job.category,
            executor=executor,
        ).values_list("concurrency", flat=True).first()
        or (2 if executor == "cloud" else 1)
    )
    active_count = MarketAnnotationItem.objects.filter(
        job_id=job.id,
        status="claimed",
        lease_expires_at__gt=now,
    ).count()
    if active_count >= configured:
        return {"task": None, "waiting": True, "workerConcurrency": configured}
    item = MarketAnnotationItem.objects.select_for_update().filter(job_id=job.id).filter(
        Q(status="queued") | Q(status="failed", attempt_count__lt=3)
    ).order_by("updated_at", "id").first()
    if not item:
        _refresh_job(job.id)
        return {"task": None}
    prompt = MarketAnnotationPromptVersion.objects.filter(id=job.prompt_version_id).first()
    if not prompt:
        raise _error("任务绑定的 Prompt 不存在", code="version_conflict", status=409)
    token = secrets.token_hex(32)
    item.status = "claimed"
    item.lease_token_hash = _digest(token)
    item.lease_agent_id = agent_id or principal.email.lower()
    item.lease_expires_at = now + timedelta(minutes=LEASE_MINUTES)
    item.attempt_count += 1
    item.error_message = ""
    item.version += 1
    item.save()
    job.status = "running"
    job.started_at = job.started_at or now
    job.save()
    if executor == "cloud":
        run.last_started_at = now
        run.last_heartbeat_at = now
        run.next_run_at = now
        run.save(update_fields=["last_started_at", "last_heartbeat_at", "next_run_at", "updated_at"])
    fixed_segment = item.reviewed_segment if item.reviewed_by == "history_same_sku_segment" and item.reviewed_segment in prompt.segments_json else ""
    return {
        "workerConcurrency": configured,
        "task": {
            "itemId": item.id,
            "candidateId": item.id,
            "jobId": item.job_id,
            "category": item.category,
            "skuCode": item.sku_code,
            "rankingDimension": item.ranking_dimension,
            "month": item.month,
            "imageContentSha256": item.image_content_sha256,
            "productName": item.product_name,
            "brand": item.brand,
            "sourceImageUrl": item.source_image_url,
            "imageCandidates": (
                [{"source": "imgzone", "url": item.source_image_url}]
                if item.source_image_url
                else []
            ),
            "promptVersionId": prompt.id,
            "promptBody": prompt.prompt_body,
            "segments": [fixed_segment] if fixed_segment else prompt.segments_json,
            "recognitionMode": "price_only" if fixed_segment else "full",
            "fixedSegment": fixed_segment or None,
            "modelId": job.model_id,
            "localModelName": job.local_model_name,
            "leaseToken": token,
            "leaseExpiresAt": iso(item.lease_expires_at),
        }
    }


@transaction.atomic
def _complete_job_item(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    item_id = _text(payload.get("itemId"), "itemId", 128, required=True)
    token = _text(payload.get("leaseToken"), "leaseToken", 128, required=True)
    item = MarketAnnotationItem.objects.select_for_update().filter(id=item_id).first()
    if not item:
        raise _error("标注候选不存在", code="not_found", status=404)
    if item.status in {"review_pending", "approved", "committed"}:
        return {"ok": True, "duplicate": True, "itemId": item.id}
    if item.status != "claimed" or item.lease_token_hash != _digest(token) or item.lease_expires_at is None or item.lease_expires_at <= timezone.now():
        raise _error("标注执行租约已失效", code="version_conflict", status=409)
    error_message = _text(payload.get("error", ""), "error", 800)
    if error_message:
        item.status = "failed"
        item.error_message = error_message
        item.lease_token_hash = ""
        item.lease_agent_id = ""
        item.lease_expires_at = None
        item.version += 1
        item.save()
        _refresh_job(item.job_id)
        return {"ok": True, "failed": True}
    result = payload.get("result")
    if not isinstance(result, dict):
        raise _error("标注结果必须是对象")
    if "price_type" in result or "image_price_yuan" in result:
        def cents(value: object, label: str) -> int | None:
            if value is None:
                return None
            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                raise _error(f"{label} 无效")
            try:
                amount = Decimal(str(value))
            except InvalidOperation as error:
                raise _error(f"{label} 无效") from error
            if not amount.is_finite() or amount < 0 or amount > 1_000_000:
                raise _error(f"{label} 无效")
            return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

        confidence_value = result.get("confidence")
        if isinstance(confidence_value, bool) or not isinstance(confidence_value, (int, float, str)):
            raise _error("confidence 无效")
        try:
            confidence_decimal = Decimal(str(confidence_value))
        except InvalidOperation as error:
            raise _error("confidence 无效") from error
        if not confidence_decimal.is_finite() or confidence_decimal < 0 or confidence_decimal > 1:
            raise _error("confidence 无效")
        result = {
            "segment": result.get("segment"),
            "imagePriceCents": cents(result.get("image_price_yuan"), "image_price_yuan"),
            "priceType": result.get("price_type", "无法判断"),
            "priceLowCents": cents(result.get("price_low_yuan"), "price_low_yuan"),
            "priceHighCents": cents(result.get("price_high_yuan"), "price_high_yuan"),
            "confidenceBps": int((confidence_decimal * 10_000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
            "reason": result.get("reason", ""),
            "rawDigest": _digest(canonical_json(result)),
            "resolvedImageUrl": payload.get("resolvedImageUrl", ""),
            "imageSource": payload.get("imageSource", "none"),
            "timing": payload.get("timing", {}),
        }
    job = MarketAnnotationJob.objects.get(id=item.job_id)
    prompt = MarketAnnotationPromptVersion.objects.get(id=job.prompt_version_id)
    segment = _text(result.get("segment"), "segment", 200, required=True)
    if segment not in prompt.segments_json:
        raise _error("标注结果细分品类不在 Prompt 枚举中")
    price = _integer(result.get("imagePriceCents"), "imagePriceCents", nullable=True)
    price_type = _text(result.get("priceType", ""), "priceType", 32)
    if price_type not in VALID_PRICE_TYPES:
        raise _error("标注价格类型无效")
    low = _integer(result.get("priceLowCents"), "priceLowCents", nullable=True)
    high = _integer(result.get("priceHighCents"), "priceHighCents", nullable=True)
    confidence = _integer(result.get("confidenceBps"), "confidenceBps", nullable=True, maximum=10_000)
    reason = _text(result.get("reason", ""), "reason", 1_000)
    raw_digest = _text(result.get("rawDigest", ""), "rawDigest", 64)
    if raw_digest and (len(raw_digest) != 64 or any(char not in "0123456789abcdef" for char in raw_digest)):
        raise _error("模型原始响应摘要无效")
    item.status = "review_pending"
    item.ai_segment = segment
    item.ai_image_price_cents = price
    item.ai_price_type = price_type
    item.ai_price_low_cents = low
    item.ai_price_high_cents = high
    item.ai_confidence_bps = confidence
    item.ai_reason = reason
    item.ai_raw_digest = raw_digest
    timing = result.get("timing", {})
    if not isinstance(timing, dict):
        raise _error("标注性能数据必须是对象")
    item.model_input_bytes = _integer(timing.get("inputBytes", 0), "inputBytes", minimum=0) or 0
    item.image_load_ms = _integer(timing.get("imageLoadMs", 0), "imageLoadMs", minimum=0) or 0
    item.image_prepare_ms = _integer(timing.get("imagePrepareMs", 0), "imagePrepareMs", minimum=0) or 0
    item.model_call_ms = _integer(timing.get("modelCallMs", 0), "modelCallMs", minimum=0) or 0
    item.total_inference_ms = _integer(timing.get("totalMs", 0), "totalMs", minimum=0) or 0
    item.resolved_image_url = _text(result.get("resolvedImageUrl", ""), "resolvedImageUrl", 2_048)
    item.image_source = _text(result.get("imageSource", "none"), "imageSource", 32)
    item.reviewed_segment = segment
    item.reviewed_image_price_cents = price
    item.reviewed_price_type = price_type
    item.reviewed_price_low_cents = low
    item.reviewed_price_high_cents = high
    item.lease_token_hash = ""
    item.lease_agent_id = ""
    item.lease_expires_at = None
    item.version += 1
    item.save()
    snapshot = _current_snapshot(item)
    if snapshot and snapshot.confirmed_market_price_cents is None:
        snapshot.ai_image_price_cents = price
        snapshot.ai_price_type = price_type
        snapshot.ai_confidence_bps = confidence
        snapshot.ai_reason = reason
        snapshot.price_low_cents = low if low is not None else snapshot.price_low_cents
        snapshot.price_high_cents = high if high is not None else snapshot.price_high_cents
        snapshot.confirmation_status = "ai_pending"
        snapshot.source_job_item_id = item.id
        snapshot.prompt_version_id = prompt.id
        snapshot.save()
    _refresh_job(item.job_id)
    return {"ok": True, "itemId": item.id, "reusedCount": 0}


def _update_review(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    job_id = _text(payload.get("jobId"), "jobId", 128, required=True)
    updates = payload.get("updates")
    if not isinstance(updates, list) or not updates or len(updates) > 500:
        raise _error("updates 必须是有界对象数组")
    changed = 0
    with transaction.atomic():
        for value in updates:
            if not isinstance(value, dict):
                raise _error("updates 必须是对象数组")
            item = MarketAnnotationItem.objects.select_for_update().filter(
                id=_text(value.get("id"), "id", 128, required=True), job_id=job_id
            ).first()
            if not item or item.status not in {"review_pending", "approved", "rejected"}:
                raise _error("标注候选状态已变化", code="version_conflict", status=409)
            expected_version = _integer(value.get("version"), "version", minimum=0)
            if item.version != expected_version:
                raise _error("标注候选版本已变化", code="version_conflict", status=409)
            segment = _text(value.get("segment"), "segment", 200, required=True)
            prompt = MarketAnnotationPromptVersion.objects.get(id=MarketAnnotationJob.objects.get(id=job_id).prompt_version_id)
            if segment not in prompt.segments_json:
                raise _error("标注细分品类不在 Prompt 枚举中")
            price_type = _text(value.get("priceType", ""), "priceType", 32)
            if price_type not in VALID_PRICE_TYPES:
                raise _error("标注价格类型无效")
            item.reviewed_segment = segment
            item.reviewed_image_price_cents = _integer(value.get("imagePriceCents"), "imagePriceCents", nullable=True)
            item.reviewed_price_type = price_type
            item.reviewed_price_low_cents = _integer(value.get("priceLowCents"), "priceLowCents", nullable=True)
            item.reviewed_price_high_cents = _integer(value.get("priceHighCents"), "priceHighCents", nullable=True)
            item.selected = value.get("selected") is True
            item.status = "approved" if item.selected else "review_pending"
            item.reviewed_by = principal.email.lower()
            item.reviewed_at = timezone.now()
            item.version += 1
            item.save()
            changed += 1
        _refresh_job(job_id)
    return {"ok": True, "changed": changed}


def _select_filtered(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    selected = payload.get("selected") is True
    aggregate = payload.get("aggregateJobs") is True
    categories = _texts(payload.get("categories"), "categories")
    query = MarketAnnotationItem.objects.filter(status__in=["review_pending", "approved", "rejected"])
    if aggregate:
        query = query.filter(job_id__in=MarketAnnotationJob.objects.filter(status__in=["running", "review_ready"]).values("id"))
        if categories:
            query = query.filter(category__in=categories)
    else:
        query = query.filter(job_id=_text(payload.get("jobId"), "jobId", 128, required=True))
    segments = _texts(payload.get("itemSegments"), "itemSegments")
    if segments:
        query = query.filter(Q(reviewed_segment__in=segments) | Q(reviewed_segment="", ai_segment__in=segments))
    total = query.count()
    if selected and total > MAX_FILTERED_SELECTION:
        raise _error(f"当前筛选结果超过 {MAX_FILTERED_SELECTION} 条")
    affected_jobs = list(query.values_list("job_id", flat=True).distinct())
    changed = query.update(selected=selected, status="approved" if selected else "review_pending", reviewed_by=principal.email.lower(), reviewed_at=timezone.now(), version=F("version") + 1, updated_at=timezone.now())
    for job_id in affected_jobs:
        _refresh_job(job_id)
    return {"ok": True, "changed": changed, "selected": selected}


def _commit(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    job_id = _text(payload.get("jobId"), "jobId", 128)
    aggregate = payload.get("aggregateJobs") is True
    candidate_ids = _texts(payload.get("candidateIds"), "candidateIds", 5_000)
    idempotency_key = _text(payload.get("idempotencyKey"), "idempotencyKey", 128, required=True)
    request_digest = _digest(canonical_json({"jobId": job_id, "aggregate": aggregate, "candidateIds": sorted(candidate_ids), "categories": payload.get("categories", [])}))
    existing = MarketAnnotationCommitReceipt.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        if existing.request_digest != request_digest:
            raise _error("入库幂等键已绑定其他候选集合", code="version_conflict", status=409)
        return {"ok": True, "committed": 0, "duplicate": True, "batchId": existing.batch_id}
    query = MarketAnnotationItem.objects.select_for_update().filter(status="approved", selected=True)
    if aggregate:
        categories = _texts(payload.get("categories"), "categories")
        query = query.filter(job_id__in=MarketAnnotationJob.objects.filter(status__in=["review_ready", "committing"]).values("id"))
        if categories:
            query = query.filter(category__in=categories)
    elif job_id:
        query = query.filter(job_id=job_id)
    if candidate_ids:
        query = query.filter(id__in=candidate_ids)
    batch_id = f"market-annotation-commit-{uuid.uuid4()}"
    committed = 0
    with transaction.atomic():
        items = list(query[:5_000])
        if not items:
            raise _error("没有可入库的已选候选项", code="version_conflict", status=409)
        for item in items:
            snapshot = _current_snapshot(item)
            if snapshot is None:
                raise _error("候选项对应的当前快照或图片哈希已变化", code="version_conflict", status=409)
            prompt = MarketAnnotationPromptVersion.objects.get(id=MarketAnnotationJob.objects.get(id=item.job_id).prompt_version_id)
            segment = item.reviewed_segment or item.ai_segment
            if segment not in prompt.segments_json or segment not in set(_taxonomy(item.category)):
                raise _error("候选项细分品类不在当前字典", code="version_conflict", status=409)
            annotation_identity = {
                "category": item.category,
                "scope": item.scope,
                "ranking_dimension": item.ranking_dimension,
                "sku_code": item.sku_code,
                "image_content_sha256": item.image_content_sha256,
            }
            before = MarketSkuAnnotation.objects.filter(**annotation_identity).values().first() or {}
            annotation, created = MarketSkuAnnotation.objects.get_or_create(
                **annotation_identity,
                defaults={
                    "id": f"market-sku-annotation-{uuid.uuid4()}",
                    "segment": segment,
                    "image_price_cents": item.reviewed_image_price_cents,
                    "image_url": item.resolved_image_url or item.source_image_url,
                    "image_source": item.image_source,
                    "confidence_bps": item.ai_confidence_bps,
                    "source_job_item_id": item.id,
                    "prompt_version_id": prompt.id,
                    "reviewed_by": principal.email.lower(),
                    "reviewed_at": timezone.now(),
                },
            )
            if not created:
                annotation.segment = segment
                annotation.image_price_cents = item.reviewed_image_price_cents
                annotation.image_url = item.resolved_image_url or item.source_image_url
                annotation.image_source = item.image_source
                annotation.confidence_bps = item.ai_confidence_bps
                annotation.source_job_item_id = item.id
                annotation.prompt_version_id = prompt.id
                annotation.reviewed_by = principal.email.lower()
                annotation.reviewed_at = timezone.now()
                annotation.version += 1
                annotation.save()
            MarketRankingEntry.objects.filter(category=item.category, scope=item.scope, ranking_dimension=item.ranking_dimension, sku_code=item.sku_code).update(subcategory=segment, updated_at=timezone.now())
            price_type = item.reviewed_price_type or item.ai_price_type
            price = item.reviewed_image_price_cents
            if price is not None and price_type in FORMAL_PRICE_TYPES:
                snapshot.confirmed_market_price_cents = price
                snapshot.price_low_cents = item.reviewed_price_low_cents
                snapshot.price_high_cents = item.reviewed_price_high_cents
                snapshot.ai_price_type = price_type
                snapshot.confirmation_status = "confirmed"
                snapshot.confirmed_by = principal.email.lower()
                snapshot.confirmed_at = timezone.now()
                snapshot.source_job_item_id = item.id
                snapshot.prompt_version_id = prompt.id
                snapshot.save()
            item.status = "committed"
            item.selected = False
            item.reviewed_by = principal.email.lower()
            item.reviewed_at = timezone.now()
            item.version += 1
            item.save()
            after = {"annotationId": annotation.id, "segment": segment, "priceCents": price, "snapshotId": snapshot.id}
            MarketAnnotationCommitReceipt.objects.create(
                id=f"market-annotation-receipt-{uuid.uuid4()}",
                job_item_id=item.id,
                annotation_id=annotation.id,
                idempotency_key=f"{idempotency_key}:{item.id}",
                before_json=before,
                after_json=after,
                committed_by=principal.email.lower(),
                batch_id=batch_id,
                request_digest=request_digest,
            )
            committed += 1
        MarketAnnotationCommitReceipt.objects.create(
            id=f"market-annotation-receipt-{uuid.uuid4()}",
            job_item_id=f"batch:{batch_id}",
            annotation_id="",
            idempotency_key=idempotency_key,
            before_json={},
            after_json={"committed": committed},
            committed_by=principal.email.lower(),
            batch_id=batch_id,
            request_digest=request_digest,
        )
        for affected in sorted({item.job_id for item in items}):
            _refresh_job(affected)
        _audit(principal, "commit_market_annotations", "market_annotation_commit", batch_id, {}, {"committed": committed})
        bump_revision({"kind": "annotation_commit", "batchId": batch_id, "committed": committed})
    return {"ok": True, "committed": committed, "batchId": batch_id}


@transaction.atomic
def _activate_prompt(payload: dict[str, object], principal: Principal, *, rollback: bool = False) -> dict[str, object]:
    prompt_id = _text(payload.get("promptId"), "promptId", 128, required=True)
    reason = _text(payload.get("reason", ""), "reason", 500)
    prompt = MarketAnnotationPromptVersion.objects.select_for_update().filter(id=prompt_id).first()
    if not prompt or prompt.status == "deleted":
        raise _error("Prompt 不存在", code="not_found", status=404)
    if set(prompt.segments_json) != set(_taxonomy(prompt.category)) and _taxonomy(prompt.category):
        raise _error("Prompt 枚举与当前细分品类字典不一致", code="version_conflict", status=409)
    with transaction.atomic():
        MarketAnnotationPromptVersion.objects.filter(category=prompt.category, status="active").update(status="archived")
        prompt.status = "active"
        prompt.activated_by = principal.email.lower()
        prompt.activated_at = timezone.now()
        prompt.save()
        MarketAnnotationPromptAudit.objects.create(id=f"market-prompt-audit-{uuid.uuid4()}", prompt_id=prompt.id, category=prompt.category, action="rollback" if rollback else "activate", reason=reason, actor=principal.email.lower())
        _audit(principal, "rollback_market_annotation_prompt" if rollback else "activate_market_annotation_prompt", "market_annotation_prompt", prompt.id, {}, {"status": "active", "reason": reason})
    return _prompt_value(prompt)


def _create_agent(payload: dict[str, object], principal: Principal) -> dict[str, object]:
    name = _text(payload.get("name"), "name", 120, required=True)
    if len(name) < 2:
        raise _error("本地 agent 名称至少需要 2 个字符")
    token = "teruisi_ma_" + secrets.token_hex(32)
    row = MarketAnnotationLocalAgent.objects.create(
        id=f"market-agent-{uuid.uuid4()}",
        name=name,
        token_hash=_digest(token),
        status="enabled",
        capabilities_json={"scope": "market_annotation_worker", "protocols": ["ollama"]},
        created_by=principal.email.lower(),
    )
    return {"id": row.id, "name": name, "token": token, "status": "enabled", "note": "token 只在本次响应显示，请立即复制到本机环境变量"}


def _authenticated_agent(payload: dict[str, object]) -> MarketAnnotationLocalAgent:
    token = _text(payload.get("agentToken"), "agentToken", 160, required=True)
    if not token.startswith("teruisi_ma_") or len(token) < 40:
        raise _error("本地标注 agent 凭据无效", code="access_denied", status=403)
    agent = MarketAnnotationLocalAgent.objects.filter(
        token_hash=_digest(token), status="enabled"
    ).first()
    if not agent:
        raise _error("本地标注 agent 凭据无效或已撤销", code="access_denied", status=403)
    agent.last_seen_at = timezone.now()
    agent.save(update_fields=["last_seen_at"])
    return agent


def execute_annotation_command(payload: dict[str, object], principal: Principal) -> object:
    action = _text(payload.get("action"), "action", 64, required=True)
    if action == "agent_heartbeat":
        agent = _authenticated_agent(payload)
        return {"agent": {"id": agent.id, "name": agent.name}}
    if action == "agent_claim":
        agent = _authenticated_agent(payload)
        claimed = _claim_job_item(
            {**payload, "executor": "local"},
            principal,
            agent_id=agent.id,
        )
        task = claimed.get("task") if isinstance(claimed, dict) else None
        category = str(task.get("category", "")) if isinstance(task, dict) else ""
        configured = MarketAnnotationConcurrencySetting.objects.filter(
            category=category, executor="local"
        ).values_list("concurrency", flat=True).first() or 1
        return {**claimed, "workerConcurrency": int(configured)}
    if action == "agent_complete":
        agent = _authenticated_agent(payload)
        item_id = _text(payload.get("itemId"), "itemId", 128, required=True)
        item = MarketAnnotationItem.objects.filter(id=item_id).first()
        if not item or item.lease_agent_id != agent.id:
            raise _error("本地标注任务不属于当前 agent", code="access_denied", status=403)
        return _complete_job_item(payload, principal)
    if action == "create_job":
        if payload.get("concurrency") is not None:
            _set_concurrency(payload, principal)
        return _create_job(payload, principal)
    if action == "set_concurrency":
        return _set_concurrency(payload, principal)
    if action == "set_cloud_run_state":
        return _set_cloud_run(payload, principal)
    if action in {"claim_task", "run_next", "run_batch"}:
        return _claim_job_item({**payload, "executor": "cloud"}, principal)
    if action == "complete_task":
        return _complete_job_item(payload, principal)
    if action == "review":
        return _update_review(payload, principal)
    if action == "select_filtered":
        return _select_filtered(payload, principal)
    if action == "commit":
        return _commit(payload, principal)
    if action == "commit_selected":
        return _commit({**payload, "candidateIds": []}, principal)
    if action in {"create_prompt", "record_generated_prompt"}:
        return _create_prompt(payload, principal)
    if action == "activate_prompt":
        return _activate_prompt(payload, principal)
    if action == "rollback_prompt":
        return _activate_prompt(payload, principal, rollback=True)
    if action == "delete_prompt":
        prompt = MarketAnnotationPromptVersion.objects.filter(id=_text(payload.get("promptId"), "promptId", 128, required=True)).first()
        if not prompt or prompt.status == "active" or MarketAnnotationJob.objects.filter(prompt_version_id=prompt.id).exclude(status__in=["deleted", "cancelled"]).exists():
            raise _error("激活中或仍被任务引用的 Prompt 不能删除", code="version_conflict", status=409)
        prompt.status = "deleted"
        prompt.save()
        return {"ok": True, "promptId": prompt.id}
    if action == "delete_job":
        job = MarketAnnotationJob.objects.filter(id=_text(payload.get("jobId"), "jobId", 128, required=True)).first()
        if not job or job.status not in {"review_ready", "committed", "cancelled", "failed"}:
            raise _error("只能归档已结束的标注任务", code="version_conflict", status=409)
        job.status = "deleted"
        job.save()
        return {"ok": True, "jobId": job.id}
    if action == "mark_gold":
        ids = _texts(payload.get("annotationIds"), "annotationIds", 500)
        created = 0
        for annotation in MarketSkuAnnotation.objects.filter(id__in=ids):
            sample, sample_created = MarketAnnotationValidationSample.objects.get_or_create(
                category=annotation.category,
                scope=annotation.scope,
                sku_code=annotation.sku_code,
                ranking_dimension=annotation.ranking_dimension,
                image_content_sha256=annotation.image_content_sha256,
                defaults={"id": f"market-validation-sample-{uuid.uuid4()}", "gold_segment": annotation.segment, "gold_image_price_cents": annotation.image_price_cents, "image_url": annotation.image_url, "source_annotation_id": annotation.id, "created_by": principal.email.lower()},
            )
            if not sample_created:
                sample.gold_segment = annotation.segment
                sample.gold_image_price_cents = annotation.image_price_cents
                sample.image_url = annotation.image_url
                sample.source_annotation_id = annotation.id
                sample.created_by = principal.email.lower()
                sample.save()
            created += 1
        return {"ok": True, "created": created}
    if action == "create_agent":
        return _create_agent(payload, principal)
    if action == "revoke_agent":
        changed = MarketAnnotationLocalAgent.objects.filter(id=_text(payload.get("agentId"), "agentId", 128, required=True), status="enabled").update(status="revoked", revoked_at=timezone.now())
        return {"ok": True, "revoked": bool(changed)}
    if action in {"generate_prompt", "evolve_prompt", "create_validation", "run_validation_next", "rebuild_stale_selected", "rebuild_stale_item"}:
        raise _error("该 AI 操作必须使用市场任务 claim/complete 契约", code="version_conflict", status=409)
    raise _error("不支持的标注操作")
