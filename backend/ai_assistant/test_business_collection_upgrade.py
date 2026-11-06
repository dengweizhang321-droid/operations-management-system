import copy
import uuid
from unittest import skipUnless

from django.db import connection, connections, DatabaseError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import override_settings, TransactionTestCase


def _isolated_sqlite_alias(base_connection):
    """Register a throwaway in-memory sqlite alias so migrations can run
    forward-only from an empty schema, instead of walking the shared test
    database backwards through ai_assistant's irreversible install-type
    RunPython migrations (0082/0083/0084 and any future addition to that
    set). See docs/fix-shanghai-attr-20261106 review notes: the earlier
    backwards-migrate approach broke the first time an irreversible
    migration landed anywhere between 0014 and the current leaf, and
    mis-attributed the break to whichever one happened to be hit first.

    ENGINE is what keeps this alias off the real server: without it the dict
    inherited django.db.backends.postgresql and asked the isolated rehearsal
    cluster for a database named ":memory:" (FATAL: database ":memory:" does
    not exist). Blanking USER/HOST/PORT would not have helped -- the rehearsal
    exports PGHOST/PGPORT/PGUSER, and libpq reads those. The test passed on
    sqlite only because the engine it never declared happened to be right
    there. OPTIONS must be replaced rather than inherited: sqlite3's
    get_connection_params splats them into sqlite3.connect(), where a psycopg
    key such as sslmode is a TypeError. The deepcopy stays for AUTOCOMMIT,
    which base.connect() reads unconditionally -- assigning into
    connections.databases after ConnectionHandler is built skips
    configure_settings, so a hand-written dict has to spell out every
    scaffolding key and breaks on the next one Django adds."""
    base_cfg = copy.deepcopy(base_connection.settings_dict)
    base_cfg.update(ENGINE="django.db.backends.sqlite3", NAME=":memory:", OPTIONS={},
        TIME_ZONE=None, TEST={"NAME": None, "MIRROR": None})
    alias = "collection_upgrade_" + uuid.uuid4().hex
    connections.databases[alias] = base_cfg
    return alias


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class CollectionUpgradeTests(TransactionTestCase):
    databases = "__all__"

    def _migrate_isolated(self, alias):
        original_databases = type(self).databases
        type(self).databases = set(original_databases) | {alias}
        self.addCleanup(lambda: setattr(type(self), "databases", original_databases))
        db = connections[alias]
        self.addCleanup(db.close)
        self.addCleanup(connections.databases.pop, alias, None)
        self.addCleanup(connections.__delitem__, alias)
        return db

    def test_old_rows_survive_new_manual_defaults(self):
        """0014 -> 0015 upgrade keeps legacy rows intact and fills the new
        collection_* columns with their manual defaults. Forward-only: no
        backwards migration plan, so this is unaffected by any current or
        future irreversible migration later in the ai_assistant chain."""
        alias = _isolated_sqlite_alias(connection)
        db = self._migrate_isolated(alias)
        executor = MigrationExecutor(db)
        old = [("ai_assistant", "0014_business_evidence")]
        plan = executor.migration_plan(old)
        self.assertFalse(any(backwards for _, backwards in plan), "expected a forward-only plan to 0014")
        executor.migrate(old)
        apps = executor.loader.project_state(old).apps
        model = apps.get_model("ai_assistant", "AiBusinessEvidenceRun")
        for index, status in enumerate(("collecting", "sealed")):
            model.objects.using(alias).create(id=f"legacy-{index}", owner_email="upgrade@example.test", client_request_id=f"legacy-{index}",
                request_digest="a"*64, plan_json='{"schemaVersion":"business-evidence-v1","sources":[]}', status=status)
        old_fields = [field.name for field in model._meta.fields]
        before = list(model.objects.using(alias).order_by("id").values(*old_fields))
        executor = MigrationExecutor(db)
        executor.migrate([("ai_assistant", "0015_business_collection")])
        from .business_models import AiBusinessEvidenceRun
        after = list(AiBusinessEvidenceRun.objects.using(alias).order_by("id").values(*old_fields))
        self.assertEqual(after, before)
        self.assertEqual(set(AiBusinessEvidenceRun.objects.using(alias).values_list("collection_status", flat=True)), {"manual"})
        self.assertEqual(set(AiBusinessEvidenceRun.objects.using(alias).values_list("collection_failures", flat=True)), {0})
        self.assertFalse(AiBusinessEvidenceRun.objects.using(alias).filter(next_collect_at__isnull=True).exists())

    @skipUnless(connection.vendor == "postgresql", "ai_business_terminal trigger is PostgreSQL-only (0014_business_evidence.py install() "
        "is a no-op on every other vendor); this assertion never ran on sqlite and must not be folded back into the data-preservation test above")
    def test_sealed_row_update_is_rejected_by_terminal_guard(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            from .business_models import AiBusinessEvidenceRun
            AiBusinessEvidenceRun.objects.create(id="legacy-1", owner_email="upgrade@example.test", client_request_id="legacy-1",
                request_digest="a"*64, plan_json='{"schemaVersion":"business-evidence-v1","sources":[]}', status="sealed")
            AiBusinessEvidenceRun.objects.filter(pk="legacy-1").update(collection_status="queued", version=2)
