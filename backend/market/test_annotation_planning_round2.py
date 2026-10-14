from __future__ import annotations

import ast
import hashlib
import inspect
import json
import os
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from time import perf_counter
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from market import annotations
from market.annotation_planning import build_job_items, record_human_reviews, record_selected_reviews
from market.models import (MarketAnnotationItem, MarketAnnotationJob, MarketAnnotationPromptVersion,
    MarketAnnotationValidationSample, MarketDataRevision, MarketImageCache, MarketMasterAuditLog, MarketMasterIdentity,
    MarketPriceSnapshot, MarketRankingEntry, MarketSkuAnnotation, MarketSubcategoryTaxonomy, MarketWriteAuthority)
from market.tests.factories import body_bytes
from market.tests.test_api import AUTHORITY_EPOCH, CUTOVER_ID
from sales.auth import Principal
from sales.tests.factories import TEST_SECRET, signed_headers

ROOT = Path(__file__).resolve().parents[2]
BASELINE = "cabf97f1a29b097334cf91dcb1f1f8a55d385116"
PRINCIPAL = Principal("fixture@example.invalid", "Fixture", "admin", None)


def baseline_create_job(*, batched=False):
    """Execute the unchanged baseline function, or only replace its row loop.

    The old source is taken from its immutable Git commit, never approximated.
    Surrounding atomic/work-key/audit behavior is retained by both functions.
    """
    source = subprocess.check_output(["git", "show", BASELINE + ":backend/market/annotations.py"],
        cwd=ROOT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0).decode("utf-8")
    node = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "_create_job")
    source = ast.get_source_segment(source, node)
    if batched:
        start = source.index("    items: list[MarketAnnotationItem] = []")
        end = source.index("    job = MarketAnnotationJob.objects.create", start)
        source = source[:start] + "    items = build_job_items(_candidate_rows(category), prompt, job_id, model_id=model_id, executor=executor, local_model_name=local_model, limit=limit)\n" + source[end:]
    namespace = {**annotations.__dict__, "build_job_items": build_job_items}
    exec(compile(source, "<immutable-baseline-create-job>", "exec"), namespace)
    return transaction.atomic(namespace["_create_job"])


def normalized_items(job_id):
    fields = [field.name for field in MarketAnnotationItem._meta.fields
        if field.name not in {"id", "job_id", "created_at", "updated_at", "reviewed_at"}]
    return list(MarketAnnotationItem.objects.filter(job_id=job_id).order_by("month", "scope", "sku_code")
                .values(*fields))


class PlanningFixtures:
    def setUp(self):
        MarketDataRevision.objects.get_or_create(domain="market",defaults={"revision":1,"source_digest":"a"*64})
        MarketWriteAuthority.objects.get_or_create(pk=1)
        self.prompt = MarketAnnotationPromptVersion.objects.create(id="planning-prompt", category="Synthetic planning",
            version=1, source="manual", status="active", segments_json=["A", "B"], prompt_body="Synthetic", created_by=PRINCIPAL.email)
        for segment in self.prompt.segments_json:
            MarketSubcategoryTaxonomy.objects.create(id="taxonomy-" + segment, category=self.prompt.category, subcategory=segment)
        self.payload = dict(category=self.prompt.category, promptVersionId=self.prompt.id, executor="cloud", modelId="synthetic-model", limit=100)
        self.history_job = MarketAnnotationJob.objects.create(id="history-job", category=self.prompt.category,
            prompt_version_id=self.prompt.id, executor="cloud", model_id="synthetic-model", status="committed", created_by=PRINCIPAL.email)

    def candidate(self, sku="sku", month="2026-09", *, scope="全部", image="a" * 64, dimension="SKU", category=None):
        identity = dict(category=category or self.prompt.category, scope=scope, ranking_dimension=dimension, sku_code=sku)
        natural_key=month+scope+sku+dimension+identity["category"]
        row = MarketRankingEntry.objects.create(natural_key=natural_key, **identity, period_start=month + "-01",
            period_end=month + "-30", source_row_number=1, last_import_batch_id="synthetic", rank=1)
        MarketMasterIdentity.objects.update_or_create(**identity, defaults={"latest_entry_id": row.id})
        MarketPriceSnapshot.objects.create(id=natural_key, **identity, month=month, image_content_sha256=image,
            image_url="https://synthetic.invalid/" + month + scope + sku)
        return row

    def history(self, row, *, item_id="history-item", human=False, price_type="明确无标价", price=None,
                segment="A", image="a" * 64):
        job_id=self.history_job.id
        if MarketAnnotationItem.objects.filter(job_id=job_id,sku_code=row.sku_code,scope=row.scope,image_content_sha256=image).exists():
            job_id="revision-job-"+item_id
            MarketAnnotationJob.objects.create(id=job_id,category=self.prompt.category,prompt_version_id=self.prompt.id,
                executor="cloud",model_id="synthetic-model",status="committed",created_by=PRINCIPAL.email)
        item = MarketAnnotationItem.objects.create(id=item_id, job_id=job_id,
            category=row.category, scope=row.scope, ranking_dimension=row.ranking_dimension, sku_code=row.sku_code,
            month="2026-08", image_content_sha256=image, status="committed", reviewed_segment=segment,
            reviewed_price_type=price_type, reviewed_image_price_cents=price, reviewed_by=PRINCIPAL.email,
            reviewed_at=timezone.now(), version=2, ai_price_type="无法判断", ai_confidence_bps=1)
        if human:
            item.version -= 1
            record_human_reviews([item], PRINCIPAL, self.prompt.id)
            item.version += 1
        return item

    def plan(self, rows):
        return build_job_items(rows, self.prompt, "new-job", model_id="synthetic-model", executor="cloud", limit=100)


class AnnotationPlanningRulesTests(PlanningFixtures, TestCase):
    def test_human_clear_no_price_needs_no_model_assertion_or_confidence_and_stays_unselected(self):
        row = self.candidate()
        self.history(row, human=True)
        item = self.plan([row])[0]
        self.assertEqual((item.status, item.reviewed_price_type, item.reviewed_image_price_cents, item.selected),
            ("review_pending", "明确无标价", None, False))
        self.assertEqual(item.reviewed_by, "history_same_image")

    def test_model_claim_and_commit_actor_cannot_establish_human_review(self):
        row = self.candidate()
        item = self.history(row)
        MarketAnnotationItem.objects.filter(pk=item.id).update(ai_price_type="明确无标价", ai_confidence_bps=9999, ai_reason="valid json")
        self.assertEqual(self.plan([row])[0].status, "queued")

    def test_effective_human_no_price_review_can_reuse_before_formal_commit(self):
        row=self.candidate()
        item=self.history(row)
        for status in ("approved","review_pending"):
            MarketAnnotationItem.objects.filter(pk=item.id).update(status=status,version=1)
            item.refresh_from_db()
            record_human_reviews([item],PRINCIPAL,self.prompt.id)
            planned=self.plan([row])[0]
            self.assertEqual((planned.status,planned.selected,planned.reviewed_image_price_cents),("review_pending",False,None))
            self.assertFalse(MarketSkuAnnotation.objects.exists())
        MarketAnnotationItem.objects.filter(pk=item.id).update(status="rejected")
        self.assertEqual(self.plan([row])[0].status,"queued")

    def test_new_manual_unknown_or_price_revision_invalidates_prior_no_price(self):
        row=self.candidate()
        self.history(row,human=True)
        newer=self.history(row,item_id="uncommitted-revision")
        for kind,value in (("无法判断",None),("标准售价",14900)):
            MarketAnnotationItem.objects.filter(pk=newer.id).update(status="approved",version=1,
                reviewed_price_type=kind,reviewed_image_price_cents=value)
            newer.refresh_from_db()
            record_human_reviews([newer],PRINCIPAL,self.prompt.id)
            self.assertEqual(self.plan([row])[0].status,"queued")

    def test_unknown_and_deposit_cannot_be_reused_as_clear_no_price(self):
        for kind in ("无法判断", "定金", "分期金额", "起售价"):
            row = self.candidate(kind)
            self.history(row, item_id=kind, human=True, price_type=kind)
            self.assertEqual(self.plan([row])[0].status, "queued")

    def test_nonnull_bounds_invalidate_explicit_no_price(self):
        row = self.candidate()
        item = self.history(row, human=True)
        MarketAnnotationItem.objects.filter(pk=item.id).update(reviewed_price_low_cents=1)
        self.assertEqual(self.plan([row])[0].status, "queued")

    def test_prompt_model_executor_and_local_model_are_conservative_policy_boundaries(self):
        row = self.candidate()
        self.history(row, human=True)
        for changes in ({"prompt_version_id": "different"}, {"model_id": "different"}, {"executor": "local"}):
            old = {key: getattr(self.history_job, key) for key in changes}
            MarketAnnotationJob.objects.filter(pk=self.history_job.id).update(**changes)
            self.assertEqual(self.plan([row])[0].status, "queued")
            MarketAnnotationJob.objects.filter(pk=self.history_job.id).update(**old)
        MarketAnnotationJob.objects.filter(pk=self.history_job.id).update(executor="local", model_id=None, local_model_name="local-a")
        planned = build_job_items([row], self.prompt, "new", model_id="", executor="local", local_model_name="local-b", limit=100)
        self.assertEqual(planned[0].status, "queued")

    def test_changed_image_uses_only_classification_and_cache_hash_is_authoritative(self):
        row = self.candidate(image="b" * 64)
        item = self.history(row, human=True)
        MarketSkuAnnotation.objects.create(id="annotation", category=row.category, scope=row.scope, sku_code=row.sku_code,
            ranking_dimension="SKU", image_content_sha256=item.image_content_sha256, segment="A", reviewed_by=PRINCIPAL.email,
            reviewed_at=timezone.now(), source_job_item_id=item.id, prompt_version_id=self.prompt.id)
        planned = self.plan([row])[0]
        self.assertEqual((planned.status, planned.reviewed_segment, planned.reviewed_price_type), ("queued", "A", ""))
        snapshot = MarketPriceSnapshot.objects.get(sku_code=row.sku_code)
        MarketImageCache.objects.create(source_url=snapshot.image_url, status="ready", content_sha256="a" * 64)
        self.assertEqual(self.plan([row])[0].status, "review_pending")

    def test_identity_and_month_boundaries(self):
        row = self.candidate()
        self.history(row, human=True)
        other_scope = self.candidate(scope="自营")
        self.assertEqual(self.plan([other_scope])[0].status, "queued")
        later = self.candidate(month="2026-10")
        candidates = self.plan([row, later])
        self.assertEqual([item.month for item in candidates], ["2026-09", "2026-10"])
        self.assertTrue(all(item.status == "review_pending" for item in candidates))
        self.assertEqual(len({(item.category,item.scope,item.sku_code,item.ranking_dimension,item.image_content_sha256) for item in candidates}), 1)

    def test_category_and_sku_spu_identity_never_cross_reuse(self):
        row=self.candidate()
        self.history(row,human=True)
        different_category=self.candidate(category="Other synthetic category")
        self.assertEqual(self.plan([different_category]),[])
        spu=self.candidate(dimension="SPU")
        self.assertEqual(self.plan([spu])[0].status,"queued")
        self.assertEqual(list(annotations._candidate_rows(self.prompt.category).values_list("ranking_dimension",flat=True)),["SKU"])

    def test_newer_human_revision_beats_old_human_and_stale_gold(self):
        row = self.candidate()
        old = self.history(row, human=True)
        annotation = MarketSkuAnnotation.objects.create(id="gold-annotation", category=row.category, scope=row.scope,
            sku_code=row.sku_code, ranking_dimension="SKU", image_content_sha256="a" * 64, segment="A", reviewed_by=PRINCIPAL.email,
            reviewed_at=timezone.now()-timedelta(days=1), source_job_item_id=old.id, prompt_version_id=self.prompt.id)
        MarketAnnotationValidationSample.objects.create(id="gold", category=row.category, scope=row.scope, sku_code=row.sku_code,
            ranking_dimension="SKU", image_content_sha256="a" * 64, gold_segment="A", source_annotation_id=annotation.id, created_by=PRINCIPAL.email)
        newer = self.history(row, item_id="new-review", human=True, segment="B", price_type="无法判断")
        planned = self.plan([row])[0]
        self.assertEqual((planned.status, planned.reviewed_segment), ("queued", "B"))
        MarketAnnotationItem.objects.filter(pk=newer.id).update(reviewed_price_type="明确无标价")
        self.assertEqual(self.plan([row])[0].status, "queued")

    def test_gold_null_alone_is_not_a_no_price_assertion_and_stale_link_is_rejected(self):
        row = self.candidate()
        history = self.history(row, price_type="无法判断")
        annotation = MarketSkuAnnotation.objects.create(id="annotation", category=row.category, scope=row.scope, sku_code=row.sku_code,
            ranking_dimension="SKU", image_content_sha256="a" * 64, segment="A", reviewed_by=PRINCIPAL.email,
            reviewed_at=timezone.now(), source_job_item_id=history.id, prompt_version_id=self.prompt.id)
        sample = MarketAnnotationValidationSample.objects.create(id="gold", category=row.category, scope=row.scope, sku_code=row.sku_code,
            ranking_dimension="SKU", image_content_sha256="a" * 64, gold_segment="A", source_annotation_id=annotation.id, created_by=PRINCIPAL.email)
        self.assertEqual(self.plan([row])[0].status, "queued")
        MarketAnnotationItem.objects.filter(pk=history.id).update(reviewed_price_type="明确无标价",updated_at=timezone.now())
        self.assertEqual(self.plan([row])[0].status, "queued")
        sample.delete()
        sample=MarketAnnotationValidationSample.objects.create(id="fresh-gold",category=row.category,scope=row.scope,sku_code=row.sku_code,
            ranking_dimension="SKU",image_content_sha256="a"*64,gold_segment="A",source_annotation_id=annotation.id,created_by=PRINCIPAL.email)
        self.assertEqual(self.plan([row])[0].status,"review_pending")
        sample.source_annotation_id = "stale"
        sample.save()
        self.assertEqual(self.plan([row])[0].status, "queued")

    def test_newer_authoritative_annotation_invalidates_old_human_no_price(self):
        row = self.candidate()
        old = self.history(row, human=True)
        annotation = MarketSkuAnnotation.objects.create(id="new-formal", category=row.category, scope=row.scope,
            sku_code=row.sku_code, ranking_dimension="SKU", image_content_sha256="a"*64, segment="B",
            image_price_cents=12900, reviewed_by=PRINCIPAL.email, reviewed_at=timezone.now(),
            source_job_item_id="new-human-item", prompt_version_id=self.prompt.id)
        self.assertEqual((self.plan([row])[0].status,self.plan([row])[0].reviewed_segment),("queued","B"))
        annotation.segment="A"; annotation.image_price_cents=None; annotation.save()
        self.assertEqual(self.plan([row])[0].status,"queued")
        annotation.source_job_item_id=old.id; annotation.save()
        self.assertEqual(self.plan([row])[0].status,"review_pending")

    def test_real_master_editor_updated_at_fences_stale_reviewed_at(self):
        from market.admin import _update_sku_master
        row=self.candidate()
        old=self.history(row,human=True)
        MarketSkuAnnotation.objects.create(id="master-formal",category=row.category,scope=row.scope,sku_code=row.sku_code,
            ranking_dimension="SKU",image_content_sha256="a"*64,segment="A",source_job_item_id=old.id,
            prompt_version_id=self.prompt.id,reviewed_by=PRINCIPAL.email,reviewed_at=old.reviewed_at-timedelta(days=1))
        self.assertEqual(self.plan([row])[0].status,"review_pending")
        with patch("market.admin._master_item",side_effect=lambda value:{"id":value.id}):
            _update_sku_master(dict(originalCategory=row.category,category=row.category,scope=row.scope,rankingDimension="SKU",
                skuCode=row.sku_code,month="2026-09",productName="Synthetic",operationMode="未知",subcategory="B",
                priceCents=None,imageContentSha256="a"*64),PRINCIPAL)
        item=self.plan([row])[0]
        self.assertEqual((item.status,item.reviewed_segment,item.reviewed_price_type),("queued","B",""))

    def test_history_sentinel_and_automatic_commit_dont_pollute_provenance(self):
        row = self.candidate()
        old = self.history(row, human=True)
        automatic = self.history(row, item_id="copied-no-review")
        MarketAnnotationItem.objects.filter(pk=automatic.id).update(reviewed_by="history_same_image")
        self.assertEqual(self.plan([row])[0].status, "queued")
        MarketAnnotationItem.objects.filter(pk=automatic.id).update(reviewed_by=PRINCIPAL.email)
        self.assertEqual(self.plan([row])[0].status, "queued")
        self.assertNotEqual(old.id, automatic.id)

    def test_unknown_capped_identity_is_not_replayed_but_changed_image_can_plan(self):
        row = self.candidate()
        failed = MarketAnnotationItem.objects.create(id="protected", job_id=self.history_job.id, category=row.category,
            scope=row.scope, sku_code=row.sku_code, ranking_dimension="SKU", image_content_sha256="a"*64,
            status="failed", attempt_count=3, error_message="inference_result_unknown")
        before = MarketAnnotationItem.objects.values().get(pk=failed.id)
        self.assertEqual(self.plan([row]), [])
        self.history(row,item_id="late-untrusted-copy")
        self.assertEqual(self.plan([row]), [])
        MarketPriceSnapshot.objects.filter(sku_code=row.sku_code).update(image_content_sha256="b"*64)
        self.assertEqual(self.plan([row])[0].image_content_sha256,"b"*64)
        self.assertEqual(MarketAnnotationItem.objects.values().get(pk=failed.id), before)

    def test_capped_unknown_with_new_real_human_unknown_is_still_blocked(self):
        row=self.candidate()
        protected=MarketAnnotationItem.objects.create(id="protected-old",job_id=self.history_job.id,category=row.category,
            scope=row.scope,sku_code=row.sku_code,ranking_dimension="SKU",month="2026-07",image_content_sha256="a"*64,
            status="failed",attempt_count=3,error_message="inference_result_unknown")
        before=MarketAnnotationItem.objects.values().get(pk=protected.id)
        newer=self.history(row,item_id="new-human-unknown",segment="B",price_type="无法判断")
        MarketAnnotationItem.objects.filter(pk=newer.id).update(status="approved",version=1)
        newer.refresh_from_db()
        record_human_reviews([newer],PRINCIPAL,self.prompt.id)
        self.assertEqual(self.plan([row]),[])
        self.assertEqual(MarketAnnotationItem.objects.values().get(pk=protected.id),before)

    def test_actual_archive_or_cancel_draft_cannot_override_formal_classification(self):
        for status in ("approved","review_pending"):
            for archive in ("deleted","cancelled"):
                row=self.candidate(sku=status+archive)
                draft=self.history(row,item_id=status+archive,segment="B",price_type="无法判断")
                MarketAnnotationItem.objects.filter(pk=draft.id).update(status=status,version=1)
                MarketAnnotationJob.objects.filter(pk=draft.job_id).update(status="review_ready")
                draft.refresh_from_db()
                record_human_reviews([draft],PRINCIPAL,self.prompt.id)
                MarketSkuAnnotation.objects.create(id="formal-"+draft.id,category=row.category,scope=row.scope,sku_code=row.sku_code,
                    ranking_dimension="SKU",image_content_sha256="a"*64,segment="A",source_job_item_id="old-committed",
                    prompt_version_id=self.prompt.id,reviewed_by=PRINCIPAL.email,reviewed_at=timezone.now()-timedelta(days=1))
                MarketSkuAnnotation.objects.filter(sku_code=row.sku_code).update(updated_at=timezone.now()-timedelta(days=1))
                self.assertEqual(self.plan([row])[0].reviewed_segment,"B")
                if archive=="deleted":
                    annotations.execute_annotation_command({"action":"delete_job","jobId":draft.job_id},PRINCIPAL)
                else:
                    MarketAnnotationJob.objects.filter(pk=draft.job_id).update(status="cancelled")
                planned=self.plan([row])[0]
                self.assertEqual((planned.status,planned.reviewed_segment,planned.reviewed_price_type),("queued","A",""))

    def test_archived_committed_human_facts_remain_valid(self):
        row=self.candidate()
        committed=self.history(row,human=True)
        annotations.execute_annotation_command({"action":"delete_job","jobId":committed.job_id},PRINCIPAL)
        planned=self.plan([row])[0]
        self.assertEqual((planned.status,planned.reviewed_segment,planned.reviewed_price_type),("review_pending","A","明确无标价"))

    def test_unreviewed_noncommitted_model_classification_is_not_fixed(self):
        row=self.candidate()
        draft=self.history(row,segment="B",price_type="无法判断")
        MarketAnnotationItem.objects.filter(pk=draft.id).update(status="review_pending",version=1)
        self.assertEqual(self.plan([row])[0].reviewed_segment,"")

    def test_invalid_first_chunks_do_not_truncate_candidates_and_order_is_preserved(self):
        rows = [self.candidate(f"sku-{index:03}", image="" if index<260 else "a"*64) for index in range(270)]
        result = build_job_items(rows, self.prompt, "new", model_id="synthetic-model", executor="cloud", limit=3)
        self.assertEqual([item.sku_code for item in result], ["sku-260","sku-261","sku-262"])

    def test_candidate_and_provenance_transaction_rollback(self):
        row = self.candidate()
        create = baseline_create_job(batched=True)
        with transaction.atomic():
            created = create(self.payload, PRINCIPAL)
            item = MarketAnnotationItem.objects.get(job_id=created["id"])
            record_human_reviews([item], PRINCIPAL, self.prompt.id)
            transaction.set_rollback(True)
        self.assertFalse(MarketAnnotationJob.objects.filter(pk=created["id"]).exists())
        self.assertFalse(MarketMasterAuditLog.objects.filter(entity_id=item.id).exists())

    def test_existing_job_reuse_and_formal_price_reuse_remain_idempotent(self):
        row = self.candidate()
        self.history(row, human=True, price_type="标准售价", price=12900)
        self.candidate("still-runnable")
        create = baseline_create_job(batched=True)
        first, second = create(self.payload, PRINCIPAL), create(self.payload, PRINCIPAL)
        self.assertEqual(first["id"],second["id"])
        self.assertTrue(second["reused"])
        self.assertEqual(MarketAnnotationItem.objects.get(job_id=first["id"],sku_code="sku").reviewed_image_price_cents,12900)


class AnnotationPlanningConcurrencyTests(PlanningFixtures, TransactionTestCase):
    available_apps = ["market"]

    def test_prompt_lock_serializes_concurrent_creation_into_one_valid_job(self):
        self.candidate()
        create = baseline_create_job(batched=True)
        def worker():
            try:
                return create(self.payload, PRINCIPAL)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _n: worker(), range(2)))
        self.assertEqual(results[0]["id"],results[1]["id"])
        self.assertEqual(sum(row["reused"] for row in results),1)
        self.assertEqual(MarketAnnotationJob.objects.exclude(pk=self.history_job.id).count(),1)


@override_settings(MARKET_WRITE_AUTHORITY_EPOCH=AUTHORITY_EPOCH, MARKET_WRITE_CUTOVER_ID=CUTOVER_ID)
class AnnotationPlanningPermissionsTests(PlanningFixtures, TestCase):
    @patch.dict("os.environ", {"TERUISI_DJANGO_INTERNAL_SECRET": TEST_SECRET})
    def test_current_signed_roles_scope_and_human_review_provenance(self):
        self.candidate()
        MarketWriteAuthority.objects.filter(pk=1).update(status="postgres", authority_epoch=AUTHORITY_EPOCH,
            cutover_id=CUTOVER_ID, migration_verify_run_id="synthetic", activated_at=timezone.now())
        path="/api/market/commands"
        def post(role, command, scope=None):
            body=body_bytes({"contractVersion":"market-command-v1","domain":"annotations","command":command})
            return self.client.post(path,data=body,content_type="application/json",headers=signed_headers(path,
                method="POST",body=body,request_id="planning-"+role+hashlib.sha256(body+str(scope).encode()).hexdigest()[:12],role=role,scope=scope))
        for role in ("viewer","analyst"):
            self.assertEqual(post(role,{"action":"create_job",**self.payload}).status_code,403)
        scoped=post("admin",{"action":"create_job",**self.payload},{"warehouses":[],"channels":[],"platforms":["京东"]})
        self.assertEqual(scoped.status_code,403)
        with patch("market.annotations._create_job",baseline_create_job(batched=True)):
            accepted=post("operator",{"action":"create_job",**self.payload})
        self.assertEqual(accepted.status_code,200,accepted.content)
        item=MarketAnnotationItem.objects.get(job_id=accepted.json()["result"]["id"])
        MarketAnnotationItem.objects.filter(pk=item.id).update(status="review_pending",reviewed_segment="A",reviewed_price_type="明确无标价")
        # Directly exercise authenticated review's unchanged boundary; integration
        # tests additionally assert the production hook is present once applied.
        item.refresh_from_db()
        result=post("operator",{"action":"review","jobId":item.job_id,"updates":[{"id":item.id,"version":item.version,
            "segment":"A","priceType":"明确无标价","imagePriceCents":None,"selected":True}]})
        self.assertEqual(result.status_code,200,result.content)
        item.refresh_from_db()
        self.assertEqual((item.status,item.selected,item.reviewed_image_price_cents),("approved",True,None))
        self.assertIn("record_human_reviews",annotations._update_review.__code__.co_names)
        self.assertTrue(MarketMasterAuditLog.objects.filter(entity_id=item.id,entity_type="market_annotation_human_review").exists())
        later=self.candidate(month="2026-10")
        planned=self.plan([later])[0]
        self.assertEqual((planned.status,planned.reviewed_price_type,planned.selected),("review_pending","明确无标价",False))
        self.assertFalse(MarketSkuAnnotation.objects.exists())


class AnnotationPlanningFrozenBenchmark(PlanningFixtures, TransactionTestCase):
    available_apps = ["market"]

    def test_fixed_200_1000_5000_full_candidate_equivalence_and_queries(self):
        # Include older facts, same-image history, changed-image classification,
        # missing images, committed prices, competing scope and SPU identities.
        now=timezone.now()
        rows=[]; snapshots=[]; masters=[]; history=[]; formal=[]
        for n in range(7000):
            scope="自营" if n%3==0 else "全部"
            sku=f"frozen-{n:05}"
            identity=dict(category=self.prompt.category,scope=scope,sku_code=sku,ranking_dimension="SKU")
            rows.append(MarketRankingEntry(natural_key=sku,**identity,period_start="2026-09-01",period_end="2026-09-30",
                rank=n,source_row_number=n+1,last_import_batch_id="frozen"))
            snapshots.append(MarketPriceSnapshot(id=sku,**identity,month="2026-09",image_content_sha256="" if n%17==0 else "a"*64,
                confirmed_market_price_cents=12000 if n%7==0 else None))
            if n%4==0:
                history.append(MarketAnnotationItem(id="old-"+sku,job_id=self.history_job.id,**identity,month="2026-08",
                    image_content_sha256="a"*64,status="committed",reviewed_segment="A",reviewed_price_type="标准售价",
                    reviewed_image_price_cents=12000,reviewed_at=now))
            if n%7==0 or n%5==0:
                formal.append(MarketSkuAnnotation(id="annotation-"+sku,**identity,image_content_sha256="a"*64 if n%7==0 else "b"*64,
                    segment="A",image_price_cents=12000,reviewed_by=PRINCIPAL.email,reviewed_at=now,
                    source_job_item_id="old-"+sku,prompt_version_id=self.prompt.id))
        MarketRankingEntry.objects.bulk_create(rows,batch_size=500)
        MarketPriceSnapshot.objects.bulk_create(snapshots,batch_size=500)
        MarketMasterIdentity.objects.bulk_create([MarketMasterIdentity(category=row.category,scope=row.scope,
            sku_code=row.sku_code,ranking_dimension="SKU",latest_entry_id=row.id) for row in rows],batch_size=500)
        MarketAnnotationItem.objects.bulk_create(history,batch_size=500)
        MarketSkuAnnotation.objects.bulk_create(formal,batch_size=500)
        # Historical distribution is frozen and unrelated to selected candidates.
        MarketAnnotationItem.objects.bulk_create([MarketAnnotationItem(id=f"archive-{n}",job_id=self.history_job.id,
            category=self.prompt.category,scope="全部",sku_code=f"archive-{n%9000}",ranking_dimension="SKU",month=f"2026-0{n//9000+1}",
            image_content_sha256="c"*64,status="committed",reviewed_segment="A",reviewed_at=now) for n in range(27000)],batch_size=500)
        with connection.cursor() as cursor:
            cursor.execute("ANALYZE market_annotation_items")
        old=baseline_create_job()
        self.assertIn("build_job_items",inspect.unwrap(annotations._create_job).__code__.co_names)
        new=annotations._create_job
        measurements=[]
        for count in (200,1000,5000):
            pair=[]
            for name,create in (("baseline",old),("batched",new)):
                counter={"count":0}
                def count_sql(execute,sql,params,many,context):
                    counter["count"]+=1
                    return execute(sql,params,many,context)
                with transaction.atomic(), connection.execute_wrapper(count_sql):
                    started=perf_counter()
                    result=create({**self.payload,"limit":count},PRINCIPAL)
                    elapsed=(perf_counter()-started)*1000
                    sql_count=counter["count"]
                    content=normalized_items(result["id"])
                    item_count=len(content)
                    digest=hashlib.sha256(json.dumps(content,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                    pair.append(content)
                    measurements.append(dict(size=count,variant=name,creationMs=round(elapsed,3),sqlCount=sql_count,
                        returned=item_count,candidateDigest=digest,rolledBack=True))
                    transaction.set_rollback(True)
                self.assertFalse(MarketAnnotationJob.objects.filter(pk=result["id"]).exists())
            self.assertEqual(pair[0],pair[1])
            self.assertEqual(len(pair[0]),count)
        path=os.environ.get("MARKET_PLANNING_BENCHMARK_PATH")
        if path:
            Path(path).write_text(json.dumps({"baseline":BASELINE,"frozenRankingRows":7000,"frozenArchiveItems":27000,
                "measurements":measurements,"completeCandidateContentEqual":True,"externalModelCalls":0,
                "businessAccuracyEstablished":False},ensure_ascii=False,indent=2),encoding="utf-8")
        print("PLANNING_BENCHMARK "+json.dumps(measurements),flush=True)
