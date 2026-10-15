"""Task model binding and independently observable schedule stages."""
from django.db import migrations, models


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""ALTER TABLE ai_dingtalk_schedules ADD CONSTRAINT ai_schedule_execution_mode
            CHECK (execution_mode IN ('open_analysis','guangdong_monitor') AND
                   (execution_mode='open_analysis' OR content_type='text') AND
                   octet_length(model_id)<=200 AND (content_type='text' OR model_id=''))""")
        cursor.execute("""ALTER TABLE ai_dingtalk_schedule_runs ADD CONSTRAINT ai_schedule_artifacts_bound
            CHECK (octet_length(model_snapshot_json)<=8000 AND jsonb_typeof(model_snapshot_json::jsonb)='object'
              AND octet_length(facts_json)<=160000 AND jsonb_typeof(facts_json::jsonb)='object'
              AND octet_length(stage_details_json)<=8000 AND jsonb_typeof(stage_details_json::jsonb)='object'
              AND octet_length(content_text)<=16000)""")
        for column in ("data_status", "analysis_status", "delivery_status"):
            cursor.execute(f"""ALTER TABLE ai_dingtalk_schedule_runs ADD CONSTRAINT ai_schedule_{column}
                CHECK ({column} IN ('pending','running','succeeded','failed','unknown','not_required'))""")


class Migration(migrations.Migration):
    dependencies = [("ai_assistant", "0082_no_new_keys_profile")]
    operations = [
        migrations.AddField("aidingtalkschedule", "model_id", models.TextField(default="")),
        migrations.AddField("aidingtalkschedule", "execution_mode", models.CharField(max_length=32, default="open_analysis")),
        *[migrations.AddField("aidingtalkschedulerun", field, models.CharField(max_length=16, default="pending"))
          for field in ("data_status", "analysis_status", "delivery_status")],
        migrations.AddField("aidingtalkschedulerun", "model_snapshot_json", models.TextField(default="{}")),
        migrations.AddField("aidingtalkschedulerun", "facts_json", models.TextField(default="{}")),
        migrations.AddField("aidingtalkschedulerun", "content_text", models.TextField(default="")),
        migrations.AddField("aidingtalkschedulerun", "stage_details_json", models.TextField(default="{}")),
        migrations.RunPython(install),
    ]
