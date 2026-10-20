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


class PiWorkspace(models.Model):
    session = models.OneToOneField(PiSession, primary_key=True, on_delete=models.PROTECT)
    generation = models.PositiveBigIntegerField(default=1)
    control_seq = models.PositiveBigIntegerField(default=0)
    status = models.TextField(default="uninitialized")
    model_id = models.TextField(default="")
    model_version = models.PositiveBigIntegerField(default=0)
    thinking_level = models.TextField(default="")
    state_json = models.TextField(default="{}")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_workspaces"
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["uninitialized", "ready", "paused", "unknown", "frozen"]), name="ai_pi_workspace_status")]


class PiControl(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT, null=True)
    client_request_id = models.TextField()
    request_digest = models.TextField()
    epoch = models.PositiveBigIntegerField()
    generation = models.PositiveBigIntegerField()
    control_seq = models.PositiveBigIntegerField()
    command = models.TextField()
    payload_json = models.TextField(default="{}")
    status = models.TextField(default="prepared")
    result_json = models.TextField(default="{}")
    error_code = models.TextField(default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_controls"
        constraints = [models.UniqueConstraint(fields=["session", "client_request_id"], name="ai_pi_control_client_unique"),
            models.UniqueConstraint(fields=["session", "control_seq"], name="ai_pi_control_seq_unique"),
            models.CheckConstraint(condition=models.Q(status__in=["prepared", "queued", "sent", "accepted", "handled", "completed", "failed", "unknown"]), name="ai_pi_control_status"),
            models.CheckConstraint(condition=models.Q(epoch__gte=1, generation__gte=1, control_seq__gte=1), name="ai_pi_control_fence")]
        indexes = [models.Index(fields=["session", "generation", "status"], name="ai_pi_control_pending_idx")]


class PiUiRequest(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    generation = models.PositiveBigIntegerField()
    runner_request_id = models.TextField()
    request_json = models.TextField()
    status = models.TextField(default="pending")
    response_control = models.ForeignKey(PiControl, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_ui_requests"
        constraints = [models.UniqueConstraint(fields=["operation", "runner_request_id"], name="ai_pi_ui_runner_unique"),
            models.CheckConstraint(condition=models.Q(status__in=["pending", "responded", "expired"]), name="ai_pi_ui_status")]


class PiBusinessIntent(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    parent_operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    action_id = models.TextField(unique=True)
    action_type = models.TextField()
    owner_email = models.TextField()
    actor_role = models.TextField()
    scope_json = models.TextField()
    epoch = models.PositiveBigIntegerField()
    generation = models.PositiveBigIntegerField()
    user_message_digest = models.TextField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_business_intents"
        constraints = [models.UniqueConstraint(fields=["parent_operation", "action_type"], name="ai_pi_business_intent_unique")]


class PiBusinessAction(models.Model):
    id = models.TextField(primary_key=True)
    session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    parent_operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    user_intent = models.OneToOneField(PiBusinessIntent, on_delete=models.PROTECT)
    invocation_id = models.TextField()
    action_type = models.TextField()
    owner_email = models.TextField()
    actor_role = models.TextField()
    scope_json = models.TextField()
    epoch = models.PositiveBigIntegerField()
    generation = models.PositiveBigIntegerField()
    status = models.TextField(default="prepared")
    version = models.PositiveBigIntegerField(default=1)
    request_digest = models.TextField()
    parameters_json = models.TextField(default="{}")
    preview_json = models.TextField(default="{}")
    preview_digest = models.TextField(default="")
    target_version = models.TextField(default="")
    confirmation_digest = models.TextField(default="")
    confirmation_expires_at = models.DateTimeField(null=True)
    lease_token = models.TextField(default="")
    lease_expires_at = models.DateTimeField(null=True)
    cancel_requested = models.BooleanField(default=False)
    result_json = models.TextField(default="{}")
    error_code = models.TextField(default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_business_actions"
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["prepared", "queued", "claimed", "dispatched", "succeeded", "failed", "canceled", "unknown"]), name="ai_pi_business_action_status")]
        indexes = [models.Index(fields=["status", "created_at"], name="ai_pi_business_queue_idx")]


class PiBusinessAudit(models.Model):
    id = models.TextField(primary_key=True)
    action = models.ForeignKey(PiBusinessAction, on_delete=models.PROTECT)
    event_type = models.TextField()
    data_json = models.TextField(default="{}")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_pi_business_audits"


class PiNativeState(models.Model):
    root_session = models.OneToOneField(PiSession, primary_key=True, on_delete=models.PROTECT)
    mode = models.TextField(default="execute")
    target_mode = models.TextField(default="execute")
    transition_status = models.TextField(default="stable")
    mode_revision = models.PositiveBigIntegerField(default=1)
    admission_epoch = models.PositiveBigIntegerField(default=1)
    tree_version = models.PositiveBigIntegerField(default=1)
    plan_revision = models.PositiveBigIntegerField(default=0)
    message_seq = models.PositiveBigIntegerField(default=0)
    max_concurrent_children = models.PositiveIntegerField(default=3)
    updated_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_native_states"
        constraints = [models.CheckConstraint(condition=models.Q(mode__in=["plan", "execute"], target_mode__in=["plan", "execute"], transition_status__in=["stable", "switching"]), name="ai_pi_native_mode")]


class PiAgent(models.Model):
    session = models.OneToOneField(PiSession, primary_key=True, on_delete=models.PROTECT)
    root_session = models.ForeignKey(PiSession, on_delete=models.PROTECT, related_name="native_agents")
    parent_session = models.ForeignKey(PiSession, on_delete=models.PROTECT, related_name="native_children", null=True)
    parent_operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT, null=True)
    lifecycle = models.TextField(default="open")
    dependencies_json = models.TextField(default="[]")
    settings_json = models.TextField(default="{}")
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_agents"
        constraints = [models.CheckConstraint(condition=models.Q(lifecycle__in=["open", "canceling", "closed"]), name="ai_pi_agent_lifecycle")]
        indexes = [models.Index(fields=["root_session", "lifecycle"], name="ai_pi_agent_root_idx")]


class PiPlanRevision(models.Model):
    id = models.TextField(primary_key=True)
    root_session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    revision = models.PositiveBigIntegerField()
    mode_revision = models.PositiveBigIntegerField()
    tree_version = models.PositiveBigIntegerField()
    scope_sha256 = models.TextField()
    plan_json = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_plan_revisions"
        constraints = [models.UniqueConstraint(fields=["root_session", "revision"], name="ai_pi_plan_revision_unique")]


class PiAgentMessage(models.Model):
    id = models.TextField(primary_key=True)
    root_session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    from_session = models.ForeignKey(PiSession, on_delete=models.PROTECT, related_name="native_sent_messages")
    to_session = models.ForeignKey(PiSession, on_delete=models.PROTECT, related_name="native_received_messages")
    seq = models.PositiveBigIntegerField()
    kind = models.TextField()
    message = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_agent_messages"
        constraints = [models.UniqueConstraint(fields=["root_session", "seq"], name="ai_pi_agent_message_seq")]


class PiAgentWait(models.Model):
    id = models.TextField(primary_key=True)
    root_session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    requester_session = models.ForeignKey(PiSession, on_delete=models.PROTECT, related_name="native_waits")
    requester_operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT, null=True)
    agent_ids_json = models.TextField()
    cursor = models.PositiveBigIntegerField(default=0)
    deadline_at = models.DateTimeField()
    status = models.TextField(default="pending")
    result_json = models.TextField(default="{}")
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_agent_waits"
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["pending", "ready", "canceled", "timeout"]), name="ai_pi_agent_wait_status")]
        indexes = [models.Index(fields=["root_session", "status"], name="ai_pi_agent_wait_root_idx")]


class PiFileHandoff(models.Model):
    id = models.TextField(primary_key=True)
    source_file = models.ForeignKey(PiFile, on_delete=models.PROTECT)
    target_session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    source_generation = models.PositiveBigIntegerField()
    target_generation = models.PositiveBigIntegerField()
    scope_json = models.TextField()
    sha256 = models.TextField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_file_handoffs"
        constraints = [models.UniqueConstraint(fields=["source_file", "target_session", "target_generation"], name="ai_pi_handoff_unique")]


class PiBusinessDelegation(models.Model):
    intent = models.OneToOneField(PiBusinessIntent, primary_key=True, on_delete=models.PROTECT)
    owner_session = models.ForeignKey(PiSession, on_delete=models.PROTECT)
    owner_operation = models.ForeignKey(PiOperation, on_delete=models.PROTECT)
    version = models.PositiveBigIntegerField(default=1)
    action_version = models.PositiveBigIntegerField(default=0)
    admission_epoch = models.PositiveBigIntegerField()
    status = models.TextField(default="active")
    created_at = models.DateTimeField(default=timezone.now)
    class Meta:
        db_table = "ai_pi_business_delegations"
        constraints = [models.CheckConstraint(condition=models.Q(status__in=["active", "revoked"]), name="ai_pi_delegation_status")]


PI_MODELS = (PiSession, PiOperation, PiDispatch, PiEvent, PiFile, PiExport, PiExportPage, PiGatewayNonce, PiWorkspace, PiControl, PiUiRequest,
    PiBusinessIntent, PiBusinessAction, PiBusinessAudit, PiNativeState, PiAgent, PiPlanRevision, PiAgentMessage, PiAgentWait, PiFileHandoff, PiBusinessDelegation)
