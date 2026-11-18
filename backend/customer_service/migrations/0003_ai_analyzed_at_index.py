from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("customer_service", "0002_seed_control_rows"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="customerserviceconversation",
            index=models.Index(
                fields=["analyzed_at"],
                name="cs_conv_ai_analyzed_idx",
                condition=models.Q(analysis_source="ai"),
            ),
        ),
    ]
