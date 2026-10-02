"""Nullable derived cache plus conservative business-update invalidation.

The original source revision guard remains unchanged, including cache updates.
"""
from django.db import migrations, models

INSTALL = """
CREATE FUNCTION public.netshop_presence_invalidate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  NEW.numeric_presence_mask := NULL;
  NEW.numeric_presence_null_mask := NULL;
  NEW.numeric_presence_rule := NULL;
  NEW.numeric_presence_row_hash := NULL;
  NEW.numeric_presence_batch_id := NULL;
  RETURN NEW;
END $$;
-- STEP --
REVOKE ALL ON FUNCTION public.netshop_presence_invalidate() FROM PUBLIC;
-- STEP --
CREATE TRIGGER netshop_presence_invalidate
BEFORE UPDATE OF metrics_json, source, dataset, source_row_hash, last_import_batch_id
ON public.netshop_rows FOR EACH ROW
EXECUTE FUNCTION public.netshop_presence_invalidate();
"""


def install(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            for statement in INSTALL.split("\n-- STEP --\n"):
                cursor.execute(statement)


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER netshop_presence_invalidate ON public.netshop_rows")
            cursor.execute("DROP FUNCTION public.netshop_presence_invalidate()")


class Migration(migrations.Migration):
    dependencies = [("netshop", "0003_netshop_source_revision_guard")]
    operations = [
        migrations.AddField("netshoprow", "numeric_presence_mask", models.BigIntegerField(null=True)),
        migrations.AddField("netshoprow", "numeric_presence_null_mask", models.BigIntegerField(null=True)),
        migrations.AddField("netshoprow", "numeric_presence_rule", models.CharField(max_length=32, null=True)),
        migrations.AddField("netshoprow", "numeric_presence_row_hash", models.CharField(max_length=64, null=True)),
        migrations.AddField("netshoprow", "numeric_presence_batch_id", models.CharField(max_length=1024, null=True)),
        migrations.RunPython(install, uninstall),
    ]
