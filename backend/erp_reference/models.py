from django.db import models


class ErpReferenceSyncCheckpoint(models.Model):
    """Durable PG checkpoint for the ERP-only D1 reference stream."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    source_epoch = models.CharField(max_length=128)
    source_path_digest = models.CharField(max_length=64)
    last_event_sequence = models.BigIntegerField(default=0)
    last_event_id = models.TextField(default="")
    erp_revision = models.BigIntegerField()
    content_hash = models.CharField(max_length=64)
    row_count = models.BigIntegerField(default=0)
    source_batch_id = models.TextField(default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_checked_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "erp_reference_sync_checkpoint"
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="erp_ref_checkpoint_singleton_ck"),
            models.CheckConstraint(
                condition=models.Q(last_event_sequence__gte=0),
                name="erp_ref_checkpoint_sequence_ck",
            ),
            models.CheckConstraint(
                condition=models.Q(erp_revision__gte=1),
                name="erp_ref_checkpoint_revision_ck",
            ),
            models.CheckConstraint(
                condition=models.Q(row_count__gte=0),
                name="erp_ref_checkpoint_rows_ck",
            ),
        ]
