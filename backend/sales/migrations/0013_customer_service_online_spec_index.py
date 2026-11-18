from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sales", "0012_excluded_business_date_index"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="salesorderline",
            index=models.Index(
                fields=["online_spec_code"],
                name="sales_cs_online_spec_idx",
                condition=models.Q(is_business_row=True) & ~models.Q(online_spec_code=""),
            ),
        ),
    ]
