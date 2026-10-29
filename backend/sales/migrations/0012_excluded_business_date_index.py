from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sales", "0011_jackyun_upload_audit_binding"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="salesorderline",
            index=models.Index(
                fields=["business_date"],
                name="sales_excluded_date_idx",
                condition=models.Q(is_business_row=False),
            ),
        ),
    ]
