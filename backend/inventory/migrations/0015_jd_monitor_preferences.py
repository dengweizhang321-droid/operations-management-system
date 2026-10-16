from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0014_jd_logistics_replenishment_cycle")]
    operations = [
        migrations.AddField(model_name="jdlogisticsdepartment", name="warehouse_preferences", field=models.JSONField(default=list)),
        migrations.AddField(model_name="jdlogisticsdepartment", name="product_order", field=models.JSONField(default=list)),
    ]
