from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0015_jd_monitor_preferences")]
    operations = [
        migrations.AddField(
            model_name="jdlogisticsdepartment", name="unmonitored_product_codes",
            field=models.JSONField(default=list),
        ),
    ]
