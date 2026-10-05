from django.db import migrations, models


def install_guard(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("CREATE TRIGGER finance_erp_target_revision_required BEFORE INSERT OR UPDATE OR DELETE ON public.finance_erp_targets FOR EACH STATEMENT EXECUTE FUNCTION public.finance_source_mark_revision_required()")


def uninstall_guard(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SELECT EXISTS(SELECT 1 FROM public.finance_erp_targets)")
            if cursor.fetchone()[0]:
                raise RuntimeError("ERP目标已有配置，不能逆迁移丢失目标")
        schema_editor.execute("DROP TRIGGER finance_erp_target_revision_required ON public.finance_erp_targets")


class Migration(migrations.Migration):
    dependencies = [("finance", "0006_raw_workbook_bytes_v2")]
    operations = [
        migrations.CreateModel(
            name="FinanceErpTarget",
            fields=[
                ("id", models.CharField(max_length=128, primary_key=True, serialize=False)),
                ("period_type", models.CharField(max_length=8)),
                ("period_key", models.CharField(max_length=7)),
                ("platform", models.CharField(default="", max_length=100)),
                ("shop_name", models.CharField(default="", max_length=100)),
                ("sales_target_cents", models.BigIntegerField()),
                ("version", models.PositiveBigIntegerField(default=1)),
                ("created_at", models.DateTimeField()),
                ("updated_at", models.DateTimeField()),
                ("updated_by", models.CharField(max_length=320)),
            ],
            options={"db_table": "finance_erp_targets", "indexes": [models.Index(fields=["period_type", "period_key"], name="fin_erp_target_period_idx")],
                "constraints": [models.UniqueConstraint(fields=("period_type", "period_key", "platform", "shop_name"), name="fin_erp_target_scope_uq"),
                    models.CheckConstraint(condition=models.Q(period_type__in=["year", "month"]), name="fin_erp_target_period_ck"),
                    models.CheckConstraint(condition=models.Q(sales_target_cents__gte=0, version__gte=1), name="fin_erp_target_values_ck")]},
        ),
        migrations.RunPython(install_guard, uninstall_guard),
    ]
