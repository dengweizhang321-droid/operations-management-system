"""Bounded annotation planning and explicit human no-price provenance.

Only persisted review events or an explicitly linked gold annotation establish a
human decision. A model result, a high confidence, and the commit actor do not.
All reads stay inside the supplied category and the existing market identity;
shop_name is not an additional identity field in the current market schema.
"""
from __future__ import annotations

import hashlib
import uuid
from itertools import islice

from django.db.models import F, Q, Window
from django.db.models.functions import Coalesce, Greatest, RowNumber
from django.utils import timezone

from .models import (
    MarketAnnotationItem, MarketAnnotationJob, MarketAnnotationValidationSample,
    MarketImageCache, MarketMasterAuditLog, MarketPriceSnapshot, MarketSkuAnnotation,
)
from .revisions import canonical_json


PLANNING_CHUNK_SIZE = 256
HUMAN_REVIEW_ENTITY = "market_annotation_human_review"
FORMAL_PRICE_TYPES = {"标准售价", "到手价", "券后价"}
IDENTITY_FIELDS = ("category", "scope", "sku_code", "ranking_dimension")
IMAGE_FIELDS = (*IDENTITY_FIELDS, "image_content_sha256")


def _key(row, fields=IDENTITY_FIELDS):
    return tuple(getattr(row, field) for field in fields)


def _predicate(keys, fields):
    # Group exact keys by every field except SKU. This keeps tuple identity
    # semantics while avoiding hundreds of repeated category/scope clauses.
    sku_index = fields.index("sku_code")
    groups = {}
    other_fields = tuple(field for field in fields if field != "sku_code")
    for key in set(keys):
        group = tuple(value for index, value in enumerate(key) if index != sku_index)
        groups.setdefault(group, []).append(key[sku_index])
    predicate = Q(pk__in=[])
    for key, skus in groups.items():
        predicate |= Q(**dict(zip(other_fields, key)), sku_code__in=skus)
    return predicate


def _latest(query, fields, time_field="reviewed_at"):
    """Return at most one row per exact identity, without materializing history."""
    order_time = F(time_field) if isinstance(time_field, str) else time_field
    return query.order_by().annotate(_planning_row=Window(
        expression=RowNumber(), partition_by=[F(field) for field in fields],
        order_by=[order_time.desc(nulls_last=True), F("pk").asc()],
    )).filter(_planning_row=1)


def _human(actor):
    return bool(actor and "@" in actor and actor not in {
        "history_same_image", "history_same_sku_segment",
    })


def _revision_time(row):
    # The master editor updates updated_at without rewriting reviewed_at.
    # Both are authoritative modification clocks in the existing schema.
    return max(row.updated_at, row.reviewed_at or row.updated_at)


def _review_digest(item, prompt_id):
    values = {field: getattr(item, field) for field in (*IMAGE_FIELDS,
        "reviewed_segment", "reviewed_image_price_cents", "reviewed_price_type",
        "reviewed_price_low_cents", "reviewed_price_high_cents")}
    values["promptVersionId"] = prompt_id
    return hashlib.sha256(canonical_json(values).encode("utf-8")).hexdigest()


def record_human_reviews(items, principal, prompt_ids):
    """Record the final saved review versions, in the caller's transaction.

    prompt_ids is a job-id -> prompt-id map (or one prompt-id for a single job).
    Called only by the authenticated review/selection commands, never completion
    or commit. Store a digest, not image URLs or raw model/customer material.
    """
    records = []
    for item in items:
        prompt_id = prompt_ids if isinstance(prompt_ids, str) else prompt_ids[item.job_id]
        records.append(MarketMasterAuditLog(actor_email=principal.email.lower(), actor_role=principal.role,
            action="market_annotation_human_review", entity_type=HUMAN_REVIEW_ENTITY, entity_id=item.id,
            after_json={"jobId": item.job_id, "promptVersionId": prompt_id,
                "itemVersion": item.version, "reviewDigest": _review_digest(item, prompt_id)}))
        if len(records) == PLANNING_CHUNK_SIZE:
            MarketMasterAuditLog.objects.bulk_create(records, batch_size=PLANNING_CHUNK_SIZE)
            records = []
    MarketMasterAuditLog.objects.bulk_create(records, batch_size=PLANNING_CHUNK_SIZE)


def record_selected_reviews(item_ids, principal):
    """Bounded audit of rows just changed by explicit filtered human selection."""
    source = iter(item_ids)
    while ids := list(islice(source, PLANNING_CHUNK_SIZE)):
        items = list(MarketAnnotationItem.objects.filter(id__in=ids))
        prompts = dict(MarketAnnotationJob.objects.filter(id__in={item.job_id for item in items})
                       .values_list("id", "prompt_version_id"))
        record_human_reviews(items, principal, prompts)


def _usable_source(item, job):
    """Archived drafts cannot supply price or classification; committed facts can."""
    return bool(item and (item.status == "committed" or (
        item.status in {"approved", "review_pending"} and job and job.status not in {"deleted", "cancelled"}
    )))


def _trusted_review(item, job, event):
    if not _usable_source(item, job) or not job or not event or not _human(event.actor_email):
        return False
    data = event.after_json
    # Commit advances a genuinely reviewed item once. It also overwrites the
    # actor, so that field alone must never establish human provenance.
    return bool(event.actor_role in {"operator", "admin"}
        and data.get("jobId") == item.job_id
        and data.get("promptVersionId") == job.prompt_version_id
        and data.get("itemVersion") == item.version - (1 if item.status == "committed" else 0)
        and data.get("reviewDigest") == _review_digest(item, job.prompt_version_id))


def _clear_no_price(item, job, prompt, model_id, executor, local_model_name,
                    annotation, gold, event):
    if not item or not job or not item.reviewed_at or job.prompt_version_id != prompt.id:
        return False
    if not _usable_source(item, job):
        return False
    if job.executor != executor or job.model_id != (model_id or None):
        return False
    if executor == "local" and job.local_model_name != local_model_name:
        return False
    if item.reviewed_price_type != "明确无标价" or any(value is not None for value in (
        item.reviewed_image_price_cents, item.reviewed_price_low_cents, item.reviewed_price_high_cents,
    )):
        return False
    if item.reviewed_segment not in prompt.segments_json:
        return False
    if annotation and _revision_time(annotation) >= _revision_time(item) and (
        annotation.source_job_item_id != item.id or annotation.segment != item.reviewed_segment
        or annotation.image_price_cents is not None or annotation.prompt_version_id != prompt.id
    ):
        # The newer authoritative formal revision wins over older no-price
        # evidence, including revisions whose type cannot be inferred here.
        return False
    # Gold null is never itself a no-price assertion: the linked current
    # committed source must explicitly say no-price and agree with the gold.
    trusted_gold = bool(item.status == "committed" and gold and annotation and _human(gold.created_by)
        and gold.source_annotation_id == annotation.id
        and annotation.source_job_item_id == item.id
        and annotation.prompt_version_id == prompt.id
        and annotation.segment == item.reviewed_segment == gold.gold_segment
        and annotation.image_price_cents is None and gold.gold_image_price_cents is None
        and gold.created_at >= _revision_time(annotation)
        and gold.created_at >= _revision_time(item))
    return _trusted_review(item, job, event) or trusted_gold


def _bounded_context(rows, prompt):
    identity_filter = _predicate((_key(row) for row in rows), IDENTITY_FIELDS)
    snapshot_filter = _predicate(((*_key(row), row.period_end[:7]) for row in rows), (*IDENTITY_FIELDS, "month"))
    snapshots = {_key(row, (*IDENTITY_FIELDS, "month")): row for row in
        MarketPriceSnapshot.objects.filter(snapshot_filter, category=prompt.category)}
    caches = {row.source_url: row for row in MarketImageCache.objects.filter(
        source_url__in={row.image_url for row in snapshots.values()}, status="ready")}
    image_filter = _predicate(((*_key(row), caches[row.image_url].content_sha256 if row.image_url in caches
        and caches[row.image_url].content_sha256 else row.image_content_sha256) for row in snapshots.values()), IMAGE_FIELDS)
    annotations = {_key(row, IMAGE_FIELDS): row for row in
        MarketSkuAnnotation.objects.filter(image_filter, category=prompt.category).exclude(image_content_sha256="")}
    fallback = {_key(row): row for row in _latest(MarketSkuAnnotation.objects.filter(
        identity_filter, category=prompt.category, segment__in=prompt.segments_json), IDENTITY_FIELDS,
        Greatest(F("updated_at"), Coalesce(F("reviewed_at"), F("updated_at"))))}
    histories = {_key(row, IMAGE_FIELDS): row for row in _latest(MarketAnnotationItem.objects.filter(
        image_filter, category=prompt.category, status__in=["committed", "approved", "review_pending", "rejected"])
        .exclude(reviewed_segment="").exclude(image_content_sha256=""), IMAGE_FIELDS)}
    jobs = {row.id: row for row in MarketAnnotationJob.objects.filter(id__in={row.job_id for row in histories.values()})}
    events = {row.entity_id: row for row in _latest(MarketMasterAuditLog.objects.filter(
        entity_type=HUMAN_REVIEW_ENTITY, entity_id__in={row.id for row in histories.values()}),
        ("entity_id",), "created_at")}
    gold = {_key(row, IMAGE_FIELDS): row for row in MarketAnnotationValidationSample.objects.filter(
        image_filter, category=prompt.category).exclude(image_content_sha256="")}
    blocked = {_key(row, IMAGE_FIELDS): row for row in _latest(MarketAnnotationItem.objects.filter(
        image_filter, category=prompt.category, status="failed", attempt_count__gte=3).exclude(image_content_sha256=""), IMAGE_FIELDS, "updated_at")}
    return snapshots, caches, annotations, fallback, histories, jobs, events, gold, blocked


def build_job_items(candidate_rows, prompt, job_id, *, model_id, executor,
                    local_model_name="", limit, now=None):
    """Scan the complete ordered candidate source in bounded batches until limit.

    This returns unsaved candidates. The caller retains its existing Prompt row
    lock, work-key reuse, item/audit bulk insertion, and outer atomic transaction.
    Historical quarantine rows are never changed or granted a new attempt.
    """
    now = now or timezone.now()
    iterator = iter(candidate_rows.iterator(chunk_size=PLANNING_CHUNK_SIZE)
                    if hasattr(candidate_rows, "iterator") else candidate_rows)
    items = []
    while rows := list(islice(iterator, PLANNING_CHUNK_SIZE)):
        snapshots, caches, annotations, fallback, histories, jobs, events, gold, blocked = _bounded_context(rows, prompt)
        for row in rows:
            if len(items) >= limit:
                return items
            snapshot = snapshots.get((*_key(row), row.period_end[:7]))
            if not snapshot:
                continue
            cache = caches.get(snapshot.image_url)
            image_hash = cache.content_sha256 if cache and cache.content_sha256 else snapshot.image_content_sha256
            if not image_hash:
                continue
            key = (*_key(row), image_hash)
            annotation, history = annotations.get(key), histories.get(key)
            failed = blocked.get(key)
            history_job = jobs.get(history.job_id) if history else None
            event = events.get(history.id) if history else None
            trusted_review = _trusted_review(history, history_job, event)
            if annotation and annotation.segment in prompt.segments_json and snapshot.confirmed_market_price_cents is not None:
                continue
            valid_segment = (annotation.segment if annotation and annotation.segment in prompt.segments_json
                else history.reviewed_segment if history and (history.status == "committed" or trusted_review)
                and history.reviewed_segment in prompt.segments_json else "")
            if not valid_segment and _key(row) in fallback:
                valid_segment = fallback[_key(row)].segment
            # A current formal row is authoritative. A newer actual human
            # revision can supply classification before stale formal metadata.
            if trusted_review and history.reviewed_segment in prompt.segments_json:
                if not annotation or _revision_time(history) >= _revision_time(annotation):
                    valid_segment = history.reviewed_segment
            no_price = _clear_no_price(history, history_job, prompt, model_id, executor,
                local_model_name, annotation, gold.get(key), event)
            newer_formal = bool(annotation and history
                and _revision_time(annotation) >= _revision_time(history) and (
                    annotation.source_job_item_id != history.id or annotation.segment != history.reviewed_segment
                    or annotation.image_price_cents != history.reviewed_image_price_cents))
            formal_price = bool(history and history.status == "committed" and not newer_formal and history.reviewed_price_type in FORMAL_PRICE_TYPES
                and history.reviewed_image_price_cents is not None)
            reused = bool(valid_segment and history and (formal_price or no_price))
            if failed and (not reused or not history.reviewed_at or failed.updated_at >= history.reviewed_at):
                # A later untrusted/sentinel row must not reopen an exhausted
                # identity. Only a resolved later result that needs no new model
                # call can pass this fence.
                continue
            item = MarketAnnotationItem(id=f"market-annotation-item-{uuid.uuid4()}", job_id=job_id,
                category=row.category, scope=row.scope, sku_code=row.sku_code,
                ranking_dimension=row.ranking_dimension, month=row.period_end[:7], image_content_sha256=image_hash,
                product_name=row.product_name, brand=row.brand, source_image_url=snapshot.image_url or row.image_url,
                status="review_pending" if reused else "queued", reviewed_segment=valid_segment,
                reviewed_by="history_same_image" if reused else "history_same_sku_segment" if valid_segment else "",
                reviewed_at=now if reused else None)
            if reused:
                item.ai_segment = valid_segment
                item.ai_confidence_bps, item.ai_reason = history.ai_confidence_bps, history.ai_reason
                for suffix in ("image_price_cents", "price_type", "price_low_cents", "price_high_cents"):
                    value = getattr(history, "reviewed_" + suffix)
                    setattr(item, "ai_" + suffix, value)
                    setattr(item, "reviewed_" + suffix, value)
            items.append(item)
        if len(items) >= limit:
            break
    return items
