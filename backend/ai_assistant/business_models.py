from django.db import models
from django.utils import timezone


class AiBusinessEvidenceRun(models.Model):
    id = models.CharField(primary_key=True, max_length=160)
    owner_email = models.CharField(max_length=320)
    scope_json = models.TextField(default="null")
    client_request_id = models.CharField(max_length=160)
    request_digest = models.CharField(max_length=64)
    plan_json = models.TextField()
    state_json = models.TextField(default="{}")
    status = models.CharField(max_length=20, default="collecting")
    version = models.PositiveIntegerField(default=1)
    stored_bytes = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_business_evidence_runs"
        constraints = [models.UniqueConstraint(fields=["owner_email", "client_request_id"], name="ai_business_client_uq")]
        indexes = [models.Index(fields=["owner_email", "-created_at"], name="ai_business_owner_idx")]


class AiBusinessEvidenceChunk(models.Model):
    id = models.CharField(primary_key=True, max_length=160)
    run = models.ForeignKey(AiBusinessEvidenceRun, on_delete=models.PROTECT)
    source_key = models.CharField(max_length=160)
    sequence = models.PositiveIntegerField()
    payload_json = models.TextField()
    payload_digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_business_evidence_chunks"
        constraints = [models.UniqueConstraint(fields=["run", "source_key", "sequence"], name="ai_business_chunk_uq")]
