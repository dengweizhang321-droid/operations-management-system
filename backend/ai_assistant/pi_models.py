"""Pi owns an independent queue and immutable dispatch identities.

These records intentionally have no FK to the legacy Agent/DAG queues.
"""
from django.db import models
from django.utils import timezone


class PiSession(models.Model):
    id = models.TextField(primary_key=True)
    owner_email = models.TextField()
    client_request_id = models.TextField()
    request_digest = models.TextField()
    title = models.TextField(default="新对话")
    scope_json = models.TextField(default="null")
    selection_json = models.TextField(default="null")
    actor_role = models.TextField()
    epoch = models.PositiveBigIntegerField(default=1)
    generation = models.PositiveBigIntegerField(default=1)
    operation_seq = models.PositiveBigIntegerField(default=0)
    event_seq = models.PositiveBigIntegerField(default=0)
    runner_event_seq = models.PositiveBigIntegerField(default=0)
    active_operation_id = models.TextField(default="")
    status = models.TextField(default="idle")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_sessions"
        constraints = [models.UniqueConstraint(fields=["owner_email", "client_request_id"], name="ai_pi_session_client_unique"),
            models.CheckConstraint(condition=models.Q(status__in=["idle", "queued", "running", "canceling", "unknown", "frozen"]), name="ai_pi_session_status"),
            models.CheckConstraint(condition=models.Q(epoch__gte=1, generation__gte=1), name="ai_pi_session_generation")]
        indexes = [models.Index(fields=["owner_email", "updated_at"], name="ai_pi_session_owner_idx")]


class PiOperation(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    client_request_id = models.TextField()
    request_digest = models.TextField()
    kind = models.TextField(default="prompt")
    status = models.TextField(default="queued")
    epoch = models.PositiveBigIntegerField()
    generation = models.PositiveBigIntegerField()
    seq = models.PositiveBigIntegerField()
    actor_role = models.TextField()
    scope_json = models.TextField(default="null")
    payload_json = models.TextField(default="{}")
    model_id = models.TextField(default="")
    model_version = models.PositiveBigIntegerField(default=0)
    skills_json = models.TextField(default="[]")
    capability_hash = models.TextField(default="")
    capability_expires_at = models.DateTimeField(null=True)
    lease_token = models.TextField(default="")
    lease_expires_at = models.DateTimeField(null=True)
    cancel_requested = models.BooleanField(default=False)
    error_code = models.TextField(default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_operations"
        constraints = [
            models.UniqueConstraint(fields=["session", "client_request_id"], name="ai_pi_operation_client_unique"),
            models.UniqueConstraint(fields=["session", "seq"], name="ai_pi_operation_seq_unique"),
            models.UniqueConstraint(fields=["session"], condition=models.Q(status__in=["queued", "running", "unknown", "canceling"]), name="ai_pi_one_active_operation"),
            models.CheckConstraint(condition=models.Q(status__in=["queued", "running", "canceling", "unknown", "succeeded", "failed", "canceled", "frozen"]), name="ai_pi_operation_status"),
            models.CheckConstraint(condition=models.Q(epoch__gte=1, generation__gte=1, seq__gte=1), name="ai_pi_operation_generation"),
        ]
        indexes = [models.Index(fields=["status", "created_at"], name="ai_pi_operation_queue_idx")]


class PiDispatch(models.Model):
    id = models.TextField(primary_key=True)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    kind = models.TextField()
    request_id = models.TextField()
    request_digest = models.TextField()
    status = models.TextField(default="prepared")
    provider_request_id = models.TextField(default="")
    usage_json = models.TextField(default="{}")
    response_json = models.TextField(default="{}")
    error_code = models.TextField(default="")
    created_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "ai_pi_dispatches"
        constraints = [models.UniqueConstraint(fields=["operation", "kind", "request_id"], name="ai_pi_dispatch_identity_unique"),
            models.CheckConstraint(condition=models.Q(status__in=["prepared", "sent", "completed", "unknown"]), name="ai_pi_dispatch_status")]


class PiEvent(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT, null=True)
    generation = models.PositiveBigIntegerField()
    event_seq = models.PositiveBigIntegerField()
    event_type = models.TextField()
    data_json = models.TextField(default="{}")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_events"
        constraints = [models.UniqueConstraint(fields=["session", "event_seq"], name="ai_pi_event_seq_unique"),
            models.CheckConstraint(condition=models.Q(generation__gte=1, event_seq__gte=1), name="ai_pi_event_generation")]


class PiFile(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT, null=True)
    owner_email = models.TextField()
    client_request_id = models.TextField()
    request_digest = models.TextField()
    generation = models.PositiveBigIntegerField()
    scope_json = models.TextField(default="null")
    file_name = models.TextField()
    mime_type = models.TextField()
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.TextField()
    direction = models.TextField(default="input")
    manifest_json = models.TextField(default="{}")
    payload = models.BinaryField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_files"
        constraints = [models.UniqueConstraint(fields=["session", "client_request_id"], name="ai_pi_file_client_unique"),
            models.CheckConstraint(condition=models.Q(direction__in=["input", "output", "export"]), name="ai_pi_file_direction"),
            models.CheckConstraint(condition=models.Q(size_bytes__gte=1, size_bytes__lte=8388608, generation__gte=1), name="ai_pi_file_bounds")]


class PiExport(models.Model):
    id = models.TextField(primary_key=True)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    request_digest = models.TextField()
    status = models.TextField(default="queued")
    query_json = models.TextField()
    progress_json = models.TextField(default="{}")
    manifest_json = models.TextField(default="{}")
    file = models.ForeignKey(PiFile, on_delete=models.PROTECT, null=True)
    error_code = models.TextField(default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_exports"
        constraints = [models.UniqueConstraint(fields=["operation", "request_digest"], name="ai_pi_export_request_unique"),
            models.CheckConstraint(condition=models.Q(status__in=["queued", "running", "succeeded", "failed"]), name="ai_pi_export_status")]


class PiExportPage(models.Model):
    id = models.TextField(primary_key=True)
    export = models.ForeignKey(PiExport, on_delete=models.PROTECT)
    ordinal = models.PositiveBigIntegerField()
    rows_json = models.TextField()
    provenance_json = models.TextField()

    class Meta:
        db_table = "ai_pi_export_pages"
        constraints = [models.UniqueConstraint(fields=["export", "ordinal"], name="ai_pi_export_page_unique")]


class PiGatewayNonce(models.Model):
    nonce = models.TextField(primary_key=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_gateway_nonces"


PI_MODELS = (PiSession, PiOperation, PiDispatch, PiEvent, PiFile, PiExport, PiExportPage, PiGatewayNonce)
