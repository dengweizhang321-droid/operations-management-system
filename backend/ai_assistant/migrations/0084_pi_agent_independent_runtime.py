import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models

PI_TABLES = ("ai_pi_sessions", "ai_pi_operations", "ai_pi_dispatches", "ai_pi_events", "ai_pi_files", "ai_pi_exports", "ai_pi_export_pages", "ai_pi_gateway_nonces")
PI_APPEND_ONLY = ("ai_pi_events", "ai_pi_files", "ai_pi_export_pages", "ai_pi_gateway_nonces")
PI_IDENTITIES = {
    "ai_pi_sessions": "id owner_email client_request_id request_digest created_at",
    "ai_pi_operations": "id session_id client_request_id request_digest kind epoch generation seq actor_role scope_json payload_json model_id model_version skills_json created_at",
    "ai_pi_dispatches": "id operation_id kind request_id request_digest created_at",
    "ai_pi_exports": "id operation_id request_digest query_json created_at",
}
STATE_GUARD = """CREATE FUNCTION public.ai_pi_state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='ai_pi_operations' THEN
    IF TG_OP='UPDATE' AND OLD.status IN ('unknown','succeeded','failed','canceled','frozen') AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'pi_terminal_operation_frozen';
    END IF;
  ELSIF TG_TABLE_NAME='ai_pi_sessions' AND TG_OP='UPDATE' THEN
    IF NEW.generation<>OLD.generation THEN
      IF NEW.generation<>OLD.generation+1 OR NEW.epoch<>OLD.epoch+1 OR EXISTS(
        SELECT 1 FROM public.ai_pi_operations WHERE session_id=OLD.id AND generation<=OLD.generation AND status IN ('queued','running','canceling','unknown')) THEN
        RAISE EXCEPTION 'pi_generation_fence';
      END IF;
    ELSIF NEW.epoch<>OLD.epoch OR NEW.scope_json<>OLD.scope_json OR NEW.selection_json<>OLD.selection_json OR NEW.actor_role<>OLD.actor_role THEN
      RAISE EXCEPTION 'pi_environment_identity_changed';
    END IF;
  ELSIF TG_TABLE_NAME='ai_pi_dispatches' AND TG_OP='UPDATE' THEN
    IF OLD.status IN ('completed','unknown') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'pi_dispatch_frozen'; END IF;
  END IF;
  RETURN NEW;
END $$"""
BINDING_GUARD = """CREATE FUNCTION public.ai_pi_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target text; s public.ai_pi_sessions; o public.ai_pi_operations;
BEGIN
  IF TG_TABLE_NAME='ai_pi_sessions' THEN target := NEW.id; ELSE target := NEW.session_id; END IF;
  SELECT * INTO s FROM public.ai_pi_sessions WHERE id=target;
  IF s.active_operation_id<>'' THEN
    SELECT * INTO o FROM public.ai_pi_operations WHERE id=s.active_operation_id;
    IF NOT FOUND OR o.session_id<>s.id OR o.generation<>s.generation OR o.epoch<>s.epoch OR o.status NOT IN ('queued','running','canceling','unknown') THEN
      RAISE EXCEPTION 'pi_active_operation_binding';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.ai_pi_operations WHERE session_id=s.id AND status IN ('queued','running','canceling','unknown') AND id<>s.active_operation_id) THEN
    RAISE EXCEPTION 'pi_unowned_active_operation';
  END IF;
  RETURN NULL;
END $$"""


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(STATE_GUARD)
        cursor.execute(BINDING_GUARD)
        for table in PI_TABLES:
            cursor.execute(f'CREATE TRIGGER ai_write_fence BEFORE INSERT OR UPDATE OR DELETE ON public."{table}" FOR EACH ROW EXECUTE FUNCTION public.ai_runtime_write_fence()')
        for table in PI_APPEND_ONLY:
            cursor.execute(f'CREATE TRIGGER ai_immutable_evidence BEFORE UPDATE OR DELETE ON public."{table}" FOR EACH ROW EXECUTE FUNCTION public.ai_immutable_record_guard()')
        for table, names in PI_IDENTITIES.items():
            arguments = ",".join("'"+name+"'" for name in names.split())
            cursor.execute(f'CREATE TRIGGER ai_immutable_identity BEFORE UPDATE ON public."{table}" FOR EACH ROW EXECUTE FUNCTION public.ai_immutable_record_guard({arguments})')
        for table in ("ai_pi_sessions", "ai_pi_operations", "ai_pi_dispatches"):
            cursor.execute(f'CREATE TRIGGER ai_pi_state BEFORE INSERT OR UPDATE ON public."{table}" FOR EACH ROW EXECUTE FUNCTION public.ai_pi_state_guard()')
        for table in ("ai_pi_sessions", "ai_pi_operations"):
            cursor.execute(f'CREATE CONSTRAINT TRIGGER ai_pi_binding AFTER INSERT OR UPDATE ON public."{table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ai_pi_binding_guard()')
        for table, names in {"ai_pi_sessions": ["request_digest"], "ai_pi_operations": ["request_digest"],
                "ai_pi_dispatches": ["request_digest"], "ai_pi_files": ["request_digest", "sha256"], "ai_pi_exports": ["request_digest"]}.items():
            for name in names:
                cursor.execute(f'ALTER TABLE public."{table}" ADD CONSTRAINT "{table}_{name}_hash" CHECK ({name} ~ \'^[a-f0-9]{{64}}$\')')
        cursor.execute("ALTER TABLE public.ai_pi_files ADD CONSTRAINT ai_pi_file_payload_hash CHECK (octet_length(payload)=size_bytes)")


class Migration(migrations.Migration):

    dependencies = [
        ('ai_assistant', '0083_schedule_execution_profile'),
    ]

    operations = [
        migrations.CreateModel(
            name='PiGatewayNonce',
            fields=[
                ('nonce', models.TextField(primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={
                'db_table': 'ai_pi_gateway_nonces',
            },
        ),
        migrations.CreateModel(
            name='PiOperation',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('client_request_id', models.TextField()),
                ('request_digest', models.TextField()),
                ('kind', models.TextField(default='prompt')),
                ('status', models.TextField(default='queued')),
                ('epoch', models.PositiveBigIntegerField()),
                ('generation', models.PositiveBigIntegerField()),
                ('seq', models.PositiveBigIntegerField()),
                ('actor_role', models.TextField()),
                ('scope_json', models.TextField(default='null')),
                ('payload_json', models.TextField(default='{}')),
                ('model_id', models.TextField(default='')),
                ('model_version', models.PositiveBigIntegerField(default=0)),
                ('skills_json', models.TextField(default='[]')),
                ('capability_hash', models.TextField(default='')),
                ('capability_expires_at', models.DateTimeField(null=True)),
                ('lease_token', models.TextField(default='')),
                ('lease_expires_at', models.DateTimeField(null=True)),
                ('cancel_requested', models.BooleanField(default=False)),
                ('error_code', models.TextField(default='')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={
                'db_table': 'ai_pi_operations',
            },
        ),
        migrations.CreateModel(
            name='PiFile',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('owner_email', models.TextField()),
                ('client_request_id', models.TextField()),
                ('request_digest', models.TextField()),
                ('generation', models.PositiveBigIntegerField()),
                ('scope_json', models.TextField(default='null')),
                ('file_name', models.TextField()),
                ('mime_type', models.TextField()),
                ('size_bytes', models.PositiveBigIntegerField()),
                ('sha256', models.TextField()),
                ('direction', models.TextField(default='input')),
                ('manifest_json', models.TextField(default='{}')),
                ('payload', models.BinaryField()),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('operation', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pioperation')),
            ],
            options={
                'db_table': 'ai_pi_files',
            },
        ),
        migrations.CreateModel(
            name='PiExport',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('request_digest', models.TextField()),
                ('status', models.TextField(default='queued')),
                ('query_json', models.TextField()),
                ('progress_json', models.TextField(default='{}')),
                ('manifest_json', models.TextField(default='{}')),
                ('error_code', models.TextField(default='')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('file', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pifile')),
                ('operation', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pioperation')),
            ],
            options={
                'db_table': 'ai_pi_exports',
            },
        ),
        migrations.CreateModel(
            name='PiDispatch',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('kind', models.TextField()),
                ('request_id', models.TextField()),
                ('request_digest', models.TextField()),
                ('status', models.TextField(default='prepared')),
                ('provider_request_id', models.TextField(default='')),
                ('usage_json', models.TextField(default='{}')),
                ('response_json', models.TextField(default='{}')),
                ('error_code', models.TextField(default='')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('completed_at', models.DateTimeField(null=True)),
                ('operation', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pioperation')),
            ],
            options={
                'db_table': 'ai_pi_dispatches',
            },
        ),
        migrations.CreateModel(
            name='PiSession',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('owner_email', models.TextField()),
                ('client_request_id', models.TextField()),
                ('request_digest', models.TextField()),
                ('title', models.TextField(default='新对话')),
                ('scope_json', models.TextField(default='null')),
                ('actor_role', models.TextField()),
                ('epoch', models.PositiveBigIntegerField(default=1)),
                ('generation', models.PositiveBigIntegerField(default=1)),
                ('operation_seq', models.PositiveBigIntegerField(default=0)),
                ('event_seq', models.PositiveBigIntegerField(default=0)),
                ('runner_event_seq', models.PositiveBigIntegerField(default=0)),
                ('active_operation_id', models.TextField(default='')),
                ('status', models.TextField(default='idle')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(default=django.utils.timezone.now)),
            ],
            options={
                'db_table': 'ai_pi_sessions',
                'indexes': [models.Index(fields=['owner_email', 'updated_at'], name='ai_pi_session_owner_idx')],
                'constraints': [models.UniqueConstraint(fields=('owner_email', 'client_request_id'), name='ai_pi_session_client_unique'), models.CheckConstraint(condition=models.Q(('status__in', ['idle', 'queued', 'running', 'canceling', 'unknown', 'frozen'])), name='ai_pi_session_status'), models.CheckConstraint(condition=models.Q(('epoch__gte', 1), ('generation__gte', 1)), name='ai_pi_session_generation')],
            },
        ),
        migrations.AddField(
            model_name='pioperation',
            name='session',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pisession'),
        ),
        migrations.AddField(
            model_name='pifile',
            name='session',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pisession'),
        ),
        migrations.CreateModel(
            name='PiEvent',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('generation', models.PositiveBigIntegerField()),
                ('event_seq', models.PositiveBigIntegerField()),
                ('event_type', models.TextField()),
                ('data_json', models.TextField(default='{}')),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('operation', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pioperation')),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.pisession')),
            ],
            options={
                'db_table': 'ai_pi_events',
            },
        ),
        migrations.CreateModel(
            name='PiExportPage',
            fields=[
                ('id', models.TextField(primary_key=True, serialize=False)),
                ('ordinal', models.PositiveBigIntegerField()),
                ('rows_json', models.TextField()),
                ('provenance_json', models.TextField()),
                ('export', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='ai_assistant.piexport')),
            ],
            options={
                'db_table': 'ai_pi_export_pages',
                'constraints': [models.UniqueConstraint(fields=('export', 'ordinal'), name='ai_pi_export_page_unique')],
            },
        ),
        migrations.AddConstraint(
            model_name='piexport',
            constraint=models.UniqueConstraint(fields=('operation', 'request_digest'), name='ai_pi_export_request_unique'),
        ),
        migrations.AddConstraint(
            model_name='piexport',
            constraint=models.CheckConstraint(condition=models.Q(('status__in', ['queued', 'running', 'succeeded', 'failed'])), name='ai_pi_export_status'),
        ),
        migrations.AddConstraint(
            model_name='pidispatch',
            constraint=models.UniqueConstraint(fields=('operation', 'kind', 'request_id'), name='ai_pi_dispatch_identity_unique'),
        ),
        migrations.AddConstraint(
            model_name='pidispatch',
            constraint=models.CheckConstraint(condition=models.Q(('status__in', ['prepared', 'sent', 'completed', 'unknown'])), name='ai_pi_dispatch_status'),
        ),
        migrations.AddIndex(
            model_name='pioperation',
            index=models.Index(fields=['status', 'created_at'], name='ai_pi_operation_queue_idx'),
        ),
        migrations.AddConstraint(
            model_name='pioperation',
            constraint=models.UniqueConstraint(fields=('session', 'client_request_id'), name='ai_pi_operation_client_unique'),
        ),
        migrations.AddConstraint(
            model_name='pioperation',
            constraint=models.UniqueConstraint(fields=('session', 'seq'), name='ai_pi_operation_seq_unique'),
        ),
        migrations.AddConstraint(
            model_name='pioperation',
            constraint=models.UniqueConstraint(condition=models.Q(('status__in', ['queued', 'running', 'unknown', 'canceling'])), fields=('session',), name='ai_pi_one_active_operation'),
        ),
        migrations.AddConstraint(
            model_name='pioperation',
            constraint=models.CheckConstraint(condition=models.Q(('status__in', ['queued', 'running', 'canceling', 'unknown', 'succeeded', 'failed', 'canceled', 'frozen'])), name='ai_pi_operation_status'),
        ),
        migrations.AddConstraint(
            model_name='pioperation',
            constraint=models.CheckConstraint(condition=models.Q(('epoch__gte', 1), ('generation__gte', 1), ('seq__gte', 1)), name='ai_pi_operation_generation'),
        ),
        migrations.AddConstraint(
            model_name='pifile',
            constraint=models.UniqueConstraint(fields=('session', 'client_request_id'), name='ai_pi_file_client_unique'),
        ),
        migrations.AddConstraint(
            model_name='pifile',
            constraint=models.CheckConstraint(condition=models.Q(('direction__in', ['input', 'output', 'export'])), name='ai_pi_file_direction'),
        ),
        migrations.AddConstraint(
            model_name='pifile',
            constraint=models.CheckConstraint(condition=models.Q(('generation__gte', 1), ('size_bytes__gte', 1), ('size_bytes__lte', 8388608)), name='ai_pi_file_bounds'),
        ),
        migrations.AddConstraint(
            model_name='pievent',
            constraint=models.UniqueConstraint(fields=('session', 'event_seq'), name='ai_pi_event_seq_unique'),
        ),
        migrations.AddConstraint(
            model_name='pievent',
            constraint=models.CheckConstraint(condition=models.Q(('event_seq__gte', 1), ('generation__gte', 1)), name='ai_pi_event_generation'),
        ),
        migrations.AddField('pisession', 'selection_json', models.TextField(default='null')),
        migrations.RunPython(install),
    ]
