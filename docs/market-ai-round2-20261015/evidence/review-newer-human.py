"""Independent synthetic SQLite checks. No production connection or network."""
from pathlib import Path
import hashlib
import json
import os
import sys
from datetime import timedelta
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
for key in list(os.environ):
    if key.upper().startswith(("TERUISI_", "AI_", "PG", "DJANGO_", "OPENAI_", "ARK_", "OLLAMA_", "CLOUDFLARE_")):
        os.environ.pop(key)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_SQLITE_PATH=":memory:",
                  DJANGO_SETTINGS_MODULE="teruisi_backend.settings", PYTHONDONTWRITEBYTECODE="1")
sys.path.insert(0, str(ROOT / "backend"))
import django
django.setup()
from django.db import connection
from django.utils import timezone
from market import models
from market.annotation_planning import build_job_items, record_human_reviews
from market.admin import _update_sku_master
from market.annotations import execute_annotation_command
from sales.auth import Principal

assert connection.vendor == "sqlite" and str(connection.settings_dict["NAME"]) == ":memory:"
with connection.schema_editor() as schema:
    for model in models.__dict__.values():
        if isinstance(model, type) and getattr(model, "__module__", "") == "market.models" and hasattr(model, "_meta"):
            schema.create_model(model)
models.MarketDataRevision.objects.create(domain="market", revision=0, source_digest="a" * 64)
principal = Principal("review@example.invalid", "Synthetic review", "admin", None)
prompt = models.MarketAnnotationPromptVersion.objects.create(id="review-prompt", category="Synthetic", version=1,
    status="active", segments_json=["A", "B"], prompt_body="Synthetic", created_by=principal.email)
for segment in ("A", "B"):
    models.MarketSubcategoryTaxonomy.objects.create(id="tax-" + segment, category="Synthetic", subcategory=segment)
job = models.MarketAnnotationJob.objects.create(id="old-job", category="Synthetic", prompt_version_id=prompt.id,
    executor="cloud", model_id="synthetic-model", status="committed", created_by=principal.email)

def setup(sku):
    identity = dict(category="Synthetic", scope="全部", ranking_dimension="SKU", sku_code=sku)
    row = models.MarketRankingEntry.objects.create(natural_key=sku, **identity, period_start="2026-10-01",
        period_end="2026-10-14", source_row_number=1, last_import_batch_id="synthetic", product_name="Synthetic")
    models.MarketMasterIdentity.objects.create(**identity, latest_entry_id=row.id)
    models.MarketPriceSnapshot.objects.create(id=sku, **identity, month="2026-10", image_content_sha256="b"*64)
    item = models.MarketAnnotationItem.objects.create(id="history-" + sku, job_id=job.id, **identity,
        image_content_sha256="b"*64, month="2026-09", status="committed", reviewed_segment="A",
        reviewed_price_type="明确无标价", reviewed_at=timezone.now()-timedelta(days=1), reviewed_by=principal.email, version=1)
    record_human_reviews([item], principal, prompt.id)
    item.version = 2
    item.save()
    models.MarketSkuAnnotation.objects.create(id="annotation-"+sku, **identity, image_content_sha256="b"*64,
        segment="A", source_job_item_id=item.id, prompt_version_id=prompt.id, reviewed_by=principal.email,
        reviewed_at=item.reviewed_at-timedelta(seconds=1))
    return row, item

def plan(row):
    value = build_job_items([row], prompt, "new-job", model_id="synthetic-model", executor="cloud", limit=1)[0]
    return {"status": value.status, "segment": value.reviewed_segment, "priceType": value.reviewed_price_type}

row, history = setup("master-change")
before = plan(row)
with patch("market.admin._master_item", side_effect=lambda row: {"id": row.id}):
    _update_sku_master(dict(originalCategory="Synthetic", category="Synthetic", scope="全部", rankingDimension="SKU",
        skuCode=row.sku_code, month="2026-10", productName="Synthetic", operationMode="未知", subcategory="B",
        priceCents=None, imageContentSha256="b"*64), principal)
after_master = plan(row)
annotation = models.MarketSkuAnnotation.objects.get(sku_code=row.sku_code)
snapshot = models.MarketPriceSnapshot.objects.get(sku_code=row.sku_code)

row2, history2 = setup("approved-change")
new_job = models.MarketAnnotationJob.objects.create(id="newer-job", category="Synthetic", prompt_version_id=prompt.id,
    executor="cloud", model_id="synthetic-model", status="review_ready", created_by=principal.email)
newer = models.MarketAnnotationItem.objects.create(id="newer-reviewed", job_id=new_job.id, category=row2.category,
    scope=row2.scope, sku_code=row2.sku_code, ranking_dimension="SKU", image_content_sha256="b"*64, month="2026-10",
    status="approved", selected=True, reviewed_segment="B", reviewed_price_type="无法判断", reviewed_at=timezone.now(),
    reviewed_by=principal.email, version=1)
record_human_reviews([newer], principal, prompt.id)
before_archive = plan(row2)
execute_annotation_command({"action": "delete_job", "jobId": new_job.id}, principal)
after_archive = plan(row2)
row3, history3 = setup("protected-change")
failed = models.MarketAnnotationItem.objects.create(id="protected-unknown", job_id=job.id, category=row3.category,
    scope=row3.scope, sku_code=row3.sku_code, ranking_dimension="SKU", image_content_sha256="b"*64, month="2026-08",
    status="failed", attempt_count=3, error_message="inference_result_unknown")
models.MarketAnnotationItem.objects.filter(pk=failed.id).update(updated_at=timezone.now()-timedelta(days=2))
newer3 = models.MarketAnnotationItem.objects.create(id="newer-protected-review", job_id=new_job.id, category=row3.category,
    scope=row3.scope, sku_code=row3.sku_code, ranking_dimension="SKU", image_content_sha256="b"*64, month="2026-10",
    status="approved", selected=True, reviewed_segment="B", reviewed_price_type="无法判断", reviewed_at=timezone.now(),
    reviewed_by=principal.email, version=1)
record_human_reviews([newer3], principal, prompt.id)
protected_plan = build_job_items([row3], prompt, "new-job", model_id="synthetic-model", executor="cloud", limit=1)
result = {"helperSha256": hashlib.sha256((ROOT/"backend/market/annotation_planning.py").read_bytes()).hexdigest(),
    "environment": "private SQLite :memory:", "externalCalls": 0, "before": before,
    "newerMaster": {"formalSegment": annotation.segment, "snapshotStatus": snapshot.confirmation_status,
                    "planned": after_master}, "newerApprovedHuman": {"humanSegment": newer.reviewed_segment,
                    "humanPriceType": newer.reviewed_price_type, "planned": before_archive},
    "archivedUncommittedHuman": {"jobStatus": models.MarketAnnotationJob.objects.get(pk=new_job.id).status,
                                 "currentFormalSegment": "A", "planned": after_archive},
    "protectedUnknownWithNewerHumanUnknown": {"protectedAttemptCount": failed.attempt_count,
        "newPlanned": [{"status": item.status, "segment": item.reviewed_segment, "priceType": item.reviewed_price_type} for item in protected_plan]}}
output = Path(__file__).with_name("review-newer-human-" + (sys.argv[1] if len(sys.argv) > 1 else "result") + ".json")
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=True, indent=2))
