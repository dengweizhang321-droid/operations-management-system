"""PostgreSQL channel state; business facts stay in their owning domains."""
from django.db import models
from django.utils import timezone


class AiDingTalkSession(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    config_digest = models.CharField(max_length=64)
    corp_id = models.CharField(max_length=160)
    robot_code = models.CharField(max_length=160)
    sender_id = models.CharField(max_length=160)
    conversation_type = models.CharField(max_length=1)
    external_conversation_id = models.CharField(max_length=256)
    owner_email = models.CharField(max_length=320)
    scope_json = models.TextField(default="null")
    conversation = models.OneToOneField("AiConversations", null=True, on_delete=models.PROTECT, related_name="dingtalk_session")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_dingtalk_sessions"
        constraints = [models.CheckConstraint(condition=models.Q(conversation_type__in=["1", "2"]), name="ai_ding_session_type")]


class AiDingTalkReceipt(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    session = models.ForeignKey(AiDingTalkSession, on_delete=models.PROTECT)
    payload_digest = models.CharField(max_length=64)
    prompt = models.TextField()
    reply = models.TextField(default="")
    status = models.CharField(max_length=16, default="queued")
    ack_status = models.CharField(max_length=16, default="pending")
    error_code = models.CharField(max_length=64, default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_dingtalk_receipts"
        indexes = [models.Index(fields=["status", "created_at"], name="ai_ding_queue"), models.Index(fields=["session", "status"], name="ai_ding_session_queue")]
        constraints = [
            models.CheckConstraint(condition=models.Q(status__in=["queued", "running", "ready", "sending", "sent", "unknown", "denied", "failed"]), name="ai_ding_receipt_status"),
            models.CheckConstraint(condition=models.Q(ack_status__in=["pending", "sending", "sent", "unknown"]), name="ai_ding_ack_status"),
        ]
