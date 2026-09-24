"""Keep the finance source revision pair strictly monotonic across transactions.

0003 couples source-table writes to a same-transaction revision advance. This
guard prevents a later finance-writer transaction from restoring the old pair
and reusing a prior owning-reader sourceRef (revision ABA).
"""
from django.db import migrations


INSTALL = """
CREATE FUNCTION public.finance_revision_monotonic_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.domain='finance' THEN
      RAISE EXCEPTION 'finance_revision_delete_denied';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.domain='finance' AND
       (NEW.revision IS DISTINCT FROM 0 OR
        NEW.source_digest IS DISTINCT FROM repeat('0',64))
    THEN RAISE EXCEPTION 'finance_revision_initial_invalid'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.domain='finance' OR NEW.domain='finance' THEN
    IF OLD.domain IS DISTINCT FROM 'finance'
       OR NEW.domain IS DISTINCT FROM 'finance'
       OR NEW.revision IS NULL OR NEW.revision<=OLD.revision
       OR NEW.revision>9007199254740991
       OR NEW.source_digest IS NULL
       OR NEW.source_digest !~ '^[0-9a-f]{64}$'
       OR NEW.source_digest IS NOT DISTINCT FROM OLD.source_digest
    THEN RAISE EXCEPTION 'finance_revision_not_monotonic'; END IF;
  END IF;
  RETURN NEW;
END $$;
"""


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(INSTALL)
        cursor.execute("REVOKE ALL ON FUNCTION public.finance_revision_monotonic_guard() FROM PUBLIC")
        cursor.execute("CREATE TRIGGER finance_revision_monotonic "
            "BEFORE INSERT OR UPDATE OR DELETE ON public.finance_data_revisions "
            "FOR EACH ROW EXECUTE FUNCTION public.finance_revision_monotonic_guard()")


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP TRIGGER IF EXISTS finance_revision_monotonic "
            "ON public.finance_data_revisions")
        cursor.execute("DROP FUNCTION IF EXISTS public.finance_revision_monotonic_guard()")


class Migration(migrations.Migration):
    dependencies = [("finance", "0003_finance_source_revision_guard")]
    operations = [migrations.RunPython(install, uninstall)]
