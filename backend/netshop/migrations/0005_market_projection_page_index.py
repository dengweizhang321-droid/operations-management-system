from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("netshop", "0004_promotion_presence_cache"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="netshoprow",
            index=models.Index(
                fields=["source", "source_row_key"],
                name="net_projection_page_idx",
                condition=models.Q(dataset__in=["sku_daily", "spu_daily"]),
            ),
        ),
    ]
