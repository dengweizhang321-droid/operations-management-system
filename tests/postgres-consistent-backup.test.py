from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "postgres-consistent-backup.py"
SPEC = importlib.util.spec_from_file_location("postgres_consistent_backup", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
sys.path.insert(0, str(ROOT / "backend"))
from ai_assistant.table_manifest import AI_TABLES as CURRENT_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V4_CONSUMPTIONS as PRE_CONSUMPTION_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V4_TICKETS as PRE_TICKET_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V4_SEALS as PRE_SEAL_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V4_VALIDATION as PRE_VALIDATION_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V4_LEDGER as PRE_V4_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_V3_REPORT_INTENTS as PRE_INTENT_AI_TABLES
from ai_assistant.table_manifest import AI_TABLES_PRE_TOOL_RECEIPTS as AI_TABLES
SCREENING_TABLES = {"ai_business_screening_runs", "ai_business_screening_pages"}
PRE_EVIDENCE_TABLES = set(AI_TABLES) - {"ai_business_evidence_runs", "ai_business_evidence_chunks", "ai_business_file_runs", "ai_business_file_chunks", "ai_business_evidence_sources", "ai_business_volume_chunks", "ai_business_budget_plans"} - SCREENING_TABLES


def _finance_guard():
    return {"columns": [("transaction_id", True, "bigint"),
                ("baseline_revision", True, "bigint"),
                ("baseline_digest", True, "character varying(64)")],
        "primaryKey": [("PRIMARY KEY (transaction_id)",)],
        "triggers": list(MODULE.FINANCE_MARKER_TRIGGERS),
        "functions": [(name, True, ["search_path=pg_catalog, public"])
            for name in sorted(MODULE.FINANCE_MARKER_FUNCTIONS)],
        "privileges": (False,)*28}


def _finance_monotonic():
    return {"triggers":[MODULE.FINANCE_MONOTONIC_TRIGGER],
        "functions":[(MODULE.FINANCE_MONOTONIC_FUNCTION,False,
            ["search_path=pg_catalog, public"])],
        "privileges":(False,)*4,"ownership":(False,False)}


def _netshop_guard():
    return {"columns": [("transaction_id",True,"bigint"),
                ("baseline_revision",True,"bigint"),
                ("baseline_digest",True,"character varying(64)")],
        "primaryKey":[("PRIMARY KEY (transaction_id)",)],
        "triggers":list(MODULE.NETSHOP_MARKER_TRIGGERS),
        "functions":[(name,definer,["search_path=pg_catalog, public"])
            for name,definer in MODULE.NETSHOP_MARKER_FUNCTIONS.items()],
        "privileges":(False,)*34}


def _market_v2_guards():
    import importlib
    profile = importlib.import_module(
        "ai_assistant.migrations.0044_business_market_v2_profile")
    return [
        ("ai_report_runs", "ai_market_v2_report_guard", 31, False, False,
         "O", "ai_market_v2_parked_report_guard", "public", "",
         profile.REPORT_GUARD.split("$$")[1], ["search_path=pg_catalog,public"],
         False, "plpgsql"),
        ("ai_workflow_runs", "ai_market_v2_workflow_guard", 31, False, False,
         "O", "ai_market_v2_parked_workflow_guard", "public", "",
         profile.WORKFLOW_GUARD.split("$$")[1], ["search_path=pg_catalog,public"],
         False, "plpgsql"),
        ("ai_workflow_runs", "ai_market_v2_workflow_complete", 5, True, True,
         "O", "ai_market_v2_parked_orphan_guard", "public", "",
         profile.ORPHAN_GUARD.split("$$")[1], ["search_path=pg_catalog,public"],
         False, "plpgsql"),
        ("ai_agent_jobs", "ai_market_v2_job_guard", 7, False, False,
         "O", "ai_market_v2_parked_job_guard", "public", "",
         profile.JOB_GUARD.split("$$")[1], ["search_path=pg_catalog,public"],
         False, "plpgsql"),
    ]


class _EvidenceCursor:
    def __init__(self, tables, migrations, finance_guard=None,
                  finance_monotonic=None, netshop_guard=None,
                  seal_guard_body_override=None,
                  verifier_body_override=None, market_guards=None):
        self.tables = sorted(tables)
        self.migrations = sorted(migrations)
        self.finance_guard = finance_guard or _finance_guard()
        self.finance_monotonic = finance_monotonic if finance_monotonic is not None else (
            _finance_monotonic() if ("finance",MODULE.FINANCE_MONOTONIC_MIGRATION)
            in self.migrations else {"triggers":[],"functions":[]})
        self.netshop_guard = netshop_guard or _netshop_guard()
        self.seal_guard_body_override = seal_guard_body_override
        self.verifier_body_override = verifier_body_override
        self.market_guards = market_guards if market_guards is not None else _market_v2_guards()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, statement, params=None):
        query = statement if isinstance(statement, str) else statement.as_string()
        if "current_database()" in query:
            self.rows = [("fixture", "fixture_owner", "127.0.0.1/32", 15479, False, 170011)]
        elif "pg_catalog.pg_tables" in query:
            self.rows = [(table,) for table in self.tables]
        elif "pg_catalog.pg_get_function_identity_arguments" in query and "ai_market_v2_report_guard" in query:
            self.rows = self.market_guards
        elif "SELECT app, name FROM django_migrations" in query:
            self.rows = self.migrations
        elif "FROM pg_catalog.pg_attribute a" in query and "finance_source_revision_markers" in query:
            self.rows = self.finance_guard["columns"]
        elif "FROM pg_catalog.pg_attribute a" in query and "netshop_source_revision_markers" in query:
            self.rows = self.netshop_guard["columns"]
        elif "pg_catalog.pg_get_constraintdef" in query and "finance_source_revision_markers" in query:
            self.rows = self.finance_guard["primaryKey"]
        elif "pg_catalog.pg_get_constraintdef" in query and "netshop_source_revision_markers" in query:
            self.rows = self.netshop_guard["primaryKey"]
        elif "t.tgname='finance_revision_monotonic'" in query:
            self.rows = self.finance_monotonic["triggers"]
        elif "p.proname='finance_revision_monotonic_guard'" in query:
            self.rows = self.finance_monotonic["functions"]
        elif "FROM pg_catalog.pg_trigger t" in query and "finance_source_revision" in str(params):
            self.rows = self.finance_guard["triggers"]
        elif "FROM pg_catalog.pg_trigger t" in query and "netshop_source_revision" in str(params):
            self.rows = self.netshop_guard["triggers"]
        elif "FROM pg_catalog.pg_proc p" in query and "finance_source_revision" in str(params):
            self.rows = self.finance_guard["functions"]
        elif "FROM pg_catalog.pg_proc p" in query and "netshop_source_revision" in str(params):
            self.rows = self.netshop_guard["functions"]
        elif "pg_catalog.has_table_privilege" in query and "finance_source_revision_markers" in str(params):
            self.rows = [self.finance_guard["privileges"]]
        elif "pg_catalog.has_table_privilege" in query and "public.finance_data_revisions" in str(params):
            self.rows = [self.finance_monotonic["privileges"]]
        elif "pg_catalog.pg_has_role" in query and "finance_data_revisions" in query:
            self.rows = [self.finance_monotonic["ownership"]]
        elif "pg_catalog.has_table_privilege" in query and "netshop_source_revision_markers" in str(params):
            self.rows = [self.netshop_guard["privileges"]]
        elif "WHERE rolname='teruisi_ai_seal_writer'" in query:
            self.rows = [(False,) * 7]
        elif "t.tgname IN ('ai_v4_ticket_immutable'" in query:
            self.rows = [(2,)]
        elif "c.relname='ai_business_v4_seal_consumptions'" in query:
            self.rows = [(3,)]
        elif "t.tgname='ai_v4_seal_consumption_required'" in query:
            import importlib
            guard = importlib.import_module(
                "ai_assistant.migrations.0043_business_v4_seal_consumption_candidate"
            ).REQUIRE_CONSUMPTION.split("$$")[1]
            if self.seal_guard_body_override is not None:
                guard = self.seal_guard_body_override
            self.rows = [(5, True, True, "O", True, True,
                          ["search_path=pg_catalog,public"], guard, False)]
        elif "FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(%s)" in query:
            import importlib
            body = importlib.import_module(
                "ai_assistant.migrations.0043_business_v4_seal_consumption_candidate"
            ).VERIFY_CONSUMPTION.split("$$")[1]
            if self.verifier_body_override is not None:
                body = self.verifier_body_override
            self.rows = [(body, True, ["search_path=pg_catalog,public"],
                          "fixture_owner")]
        elif "has_any_column_privilege(%s,%s,'SELECT')" in query:
            self.rows = [(False,) * 5]
        elif "SELECT to_regprocedure(%s)" in query:
            self.rows = [(params[0],)]
        elif "has_function_privilege('teruisi_ai_seal_writer',%s,'EXECUTE')" in query:
            name = params[0]
            self.rows = [(
                name.startswith("public.ai_v4_claim_seal_ticket(") or
                name.startswith("public.ai_v4_sealer_consumption_result(") or
                name.startswith("public.ai_v4_sealer_ticket_"),
                name.startswith("public.ai_v4_issue_seal_ticket(") or
                name.startswith("public.ai_v4_verify_seal_consumption(") or
                name == "public.ai_v4_lock_source_revisions_for_admission()",
                False)]
        elif query.startswith("SELECT COUNT(*)"):
            self.rows = [(0,)]
        elif "FROM sales_data_revisions" in query:
            self.rows = [("sales", 1), ("erp", 1)]
        elif "FROM netshop_data_revisions" in query:
            self.rows = [("netshop",1,"a"*64)]
        elif "FROM netshop_write_authority" in query:
            self.rows = [("d1","","","")]
        elif "FROM sales_write_authority" in query:
            self.rows = [("active", "11111111-1111-1111-1111-111111111111", "fixture-cutover")]
        elif "FROM ai_data_revisions" in query:
            self.rows = [(0, "")]
        elif "FROM ai_write_authority" in query:
            self.rows = [("d1", "", "", "")]
        else:
            raise AssertionError("Unexpected evidence query: " + query)

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0]


def _ai_evidence(tables, migrations, finance_guard=None,
                 finance_monotonic=None, netshop_guard=None,
                 seal_guard_body_override=None,
                 verifier_body_override=None, market_guards=None):
    base_tables = {
        "django_migrations", "sales_data_revisions", "sales_import_batches",
        "sales_order_lines", "sales_write_authority", "erp_product_master",
    }
    cursor = _EvidenceCursor(base_tables | set(tables),
        [("sales", "0001_initial"), *migrations], finance_guard,
        finance_monotonic, netshop_guard, seal_guard_body_override,
        verifier_body_override, market_guards)
    connection = mock.Mock()
    connection.cursor.return_value = cursor
    return MODULE.collect_evidence(connection, "fixture", "fixture_owner")


class _SnapshotCursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement):
        self.statement = statement

    def fetchone(self):
        return ("00000003-00000001-1",)


class _SnapshotConnection:
    def __init__(self):
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, statement):
        self.statement = statement

    def cursor(self):
        return _SnapshotCursor()

    def commit(self):
        self.committed = True


class ConsistentBackupTests(unittest.TestCase):
    def test_finance_0004_monotonic_trigger_function_and_writer_boundary(self):
        migrated = [("finance","0002_finance_target_gross_margin"),
            ("finance",MODULE.FINANCE_MARKER_MIGRATION),
            ("finance",MODULE.FINANCE_MONOTONIC_MIGRATION)]
        marker = {MODULE.FINANCE_MARKER_TABLE}
        self.assertIn(MODULE.FINANCE_MARKER_TABLE,
            _ai_evidence(marker,migrated)["tables"])
        for state in (
                {"triggers":[],"functions":_finance_monotonic()["functions"],
                    "privileges":(False,)*4,"ownership":(False,False)},
                {**_finance_monotonic(),"functions":[]},
                {**_finance_monotonic(),"functions":[
                    (MODULE.FINANCE_MONOTONIC_FUNCTION,True,
                        ["search_path=pg_catalog, public"])]},
                {**_finance_monotonic(),"privileges":(True,False,False,False)},
                {**_finance_monotonic(),"ownership":(True,False)}):
            with self.subTest(state=state),self.assertRaises(RuntimeError):
                _ai_evidence(marker,migrated,finance_monotonic=state)
        with self.assertRaisesRegex(RuntimeError,"no migration receipt"):
            _ai_evidence(marker,migrated[:-1],
                finance_monotonic=_finance_monotonic())

    def test_netshop_0003_marker_and_monotonic_guards_are_versioned(self):
        base = {"netshop_data_revisions","netshop_import_batches",
            "netshop_rows","netshop_write_authority"}
        old = [("netshop","0001_initial"),
            ("netshop","0002_migration_run_time_order")]
        current = [*old,("netshop",MODULE.NETSHOP_MARKER_MIGRATION)]
        self.assertIn("netshop_rows",_ai_evidence(base,old)["tables"])
        self.assertIn(MODULE.NETSHOP_MARKER_TABLE,
            _ai_evidence(base | {MODULE.NETSHOP_MARKER_TABLE},current)["tables"])
        with self.assertRaisesRegex(RuntimeError,"no migration receipt"):
            _ai_evidence(base | {MODULE.NETSHOP_MARKER_TABLE},old)
        with self.assertRaisesRegex(RuntimeError,"lacks table"):
            _ai_evidence(base,current)
        with self.assertRaisesRegex(RuntimeError,"predecessor"):
            _ai_evidence(base | {MODULE.NETSHOP_MARKER_TABLE},current[:1]+current[2:])
        changes = []
        value = _netshop_guard(); value["columns"].pop(); changes.append(value)
        value = _netshop_guard(); value["primaryKey"].clear(); changes.append(value)
        value = _netshop_guard(); value["triggers"].pop(); changes.append(value)
        value = _netshop_guard(); value["functions"].pop(); changes.append(value)
        value = _netshop_guard(); value["functions"][0] = (
            value["functions"][0][0],False,["search_path=public"]); changes.append(value)
        value = _netshop_guard(); value["privileges"] = (False,)*10+(True,)+(False,)*23; changes.append(value)
        for state in changes:
            with self.subTest(state=state),self.assertRaises(RuntimeError):
                _ai_evidence(base | {MODULE.NETSHOP_MARKER_TABLE},current,
                    netshop_guard=state)

    def test_finance_0003_marker_schema_requires_exact_migration_and_guards(self):
        old = [("finance", "0002_finance_target_gross_margin")]
        current = [*old, ("finance", MODULE.FINANCE_MARKER_MIGRATION)]
        marker = {MODULE.FINANCE_MARKER_TABLE}
        before = _ai_evidence(set(), old)
        adopted = _ai_evidence(marker, current)
        self.assertIn(MODULE.FINANCE_MARKER_TABLE, adopted["tables"])
        self.assertNotEqual(before["contentSha256"], adopted["contentSha256"])
        with self.assertRaisesRegex(RuntimeError, "no migration receipt"):
            _ai_evidence(marker, old)
        with self.assertRaisesRegex(RuntimeError, "lacks table"):
            _ai_evidence(set(), current)
        with self.assertRaisesRegex(RuntimeError, "predecessor"):
            _ai_evidence(marker, current[1:])
        for change in (
                lambda state: state["columns"].pop(),
                lambda state: state["primaryKey"].clear(),
                lambda state: state["triggers"].pop(),
                lambda state: state["functions"].pop(),
                lambda state: state["functions"].__setitem__(0,
                    (state["functions"][0][0], False, state["functions"][0][2])),
                lambda state: state["functions"].__setitem__(0,
                    (state["functions"][0][0], True, ["search_path=public"])),
                lambda state: state.update(privileges=(True,)+(False,)*27),
                lambda state: state.update(privileges=(False,)*9+(True,)+(False,)*18)):
            state = _finance_guard()
            change(state)
            with self.subTest(state=state), self.assertRaises(RuntimeError):
                _ai_evidence(marker, current, state)

    def test_v4_ledger_generation_has_explicit_71_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 35)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_VALIDATION_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 71)
        self.assertTrue({"ai_business_v4_runs", "ai_business_v4_sources",
            "ai_business_v4_chunks", "ai_business_v4_tool_receipts"} <= set(current["tables"]))
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_V4_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(CURRENT_AI_TABLES, migrations[:-1])

    def test_v4_validation_generation_has_explicit_73_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 36)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_SEAL_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 73)
        self.assertIn("ai_business_v4_validation_attempts", current["tables"])
        self.assertIn("ai_business_v4_validation_segments", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_VALIDATION_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(CURRENT_AI_TABLES, migrations[:-1])

    def test_v4_seal_generation_has_explicit_74_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 38)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_TICKET_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 74)
        self.assertIn("ai_business_v4_seals", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_SEAL_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_TICKET_AI_TABLES, migrations[:-1])

    def test_v4_ticket_generation_has_explicit_76_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 41)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_CONSUMPTION_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 76)
        self.assertIn("ai_business_v4_seal_tickets", current["tables"])
        self.assertIn("ai_business_v4_seal_claims", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_TICKET_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_CONSUMPTION_AI_TABLES, migrations[:-1])

    def test_v4_claimed_reader_retains_76_tables_and_closed_publication(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 42)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_CONSUMPTION_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 76)
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_CONSUMPTION_AI_TABLES,
                [item for item in migrations if item[1] != "0041_business_v4_seal_ticket"])

    def test_v4_consumption_candidate_has_explicit_77_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 43)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(CURRENT_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 77)
        self.assertIn("ai_business_v4_seal_consumptions", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_CONSUMPTION_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(CURRENT_AI_TABLES, migrations[:-1])
        with self.assertRaisesRegex(RuntimeError,
                "consumption commit fence missing"):
            _ai_evidence(CURRENT_AI_TABLES, migrations,
                seal_guard_body_override="BEGIN RETURN NULL; END")
        with self.assertRaisesRegex(RuntimeError,
                "consumption verifier missing"):
            _ai_evidence(CURRENT_AI_TABLES, migrations,
                verifier_body_override="BEGIN RETURN true; END")

    def test_market_v2_parked_guards_follow_exact_migration_receipt(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 44)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(CURRENT_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 77)
        before = _ai_evidence(CURRENT_AI_TABLES, migrations[:-1], market_guards=[])
        self.assertNotEqual(current["contentSha256"], before["contentSha256"])
        with self.assertRaisesRegex(RuntimeError, "predecessor"):
            _ai_evidence(CURRENT_AI_TABLES,
                [item for item in migrations if item[1] !=
                 "0043_business_v4_seal_consumption_candidate"])
        original = _market_v2_guards()
        for index, value in (
                (0, "ai_workflow_runs"), (1, "ai_market_v2_wrong_guard"),
                (2, 5), (3, True), (4, True), (5, "D"),
                (6, "ai_market_v2_parked_job_guard"), (7, "evil"),
                (8, "text"), (9, "BEGIN RETURN NEW; END"),
                (10, ["search_path=public"]), (11, True), (12, "sql")):
            damaged = list(original)
            row = list(damaged[0]); row[index] = value; damaged[0] = tuple(row)
            with self.subTest(column=index), self.assertRaisesRegex(RuntimeError,
                    "market v2 parked profile"):
                _ai_evidence(CURRENT_AI_TABLES, migrations, market_guards=damaged)
        for damaged in (original[:-1], original + [original[0]]):
            with self.assertRaisesRegex(RuntimeError, "market v2 parked profile"):
                _ai_evidence(CURRENT_AI_TABLES, migrations, market_guards=damaged)

    def test_paused_intent_generation_has_explicit_67_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 34)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_V4_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 67)
        self.assertIn("ai_business_v3_report_intents", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_INTENT_AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_V4_AI_TABLES, migrations[:-1])

    def test_receipt_generation_has_explicit_66_table_boundary(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py")
                       if p.stem[:4].isdigit() and int(p.stem[:4]) <= 32)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(PRE_INTENT_AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 66)
        self.assertIn("ai_business_source_tool_receipts", current["tables"])
        with self.assertRaises(RuntimeError):
            _ai_evidence(AI_TABLES, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(PRE_INTENT_AI_TABLES, migrations[:-1])

    def test_business_evidence_tables_require_exact_migration_generation(self):
        names = sorted(p.stem for p in (ROOT / "backend/ai_assistant/migrations").glob("*.py") if p.stem[:4].isdigit() and int(p.stem[:4]) <= 24)
        migrations = [("ai_assistant", name) for name in names]
        current = _ai_evidence(AI_TABLES, migrations)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 65)
        before_runtime = _ai_evidence(AI_TABLES, [m for m in migrations if int(m[1][:4]) <= 23])
        self.assertEqual(len([name for name in before_runtime["tables"] if name.startswith("ai_")]),65)
        self.assertNotEqual(current["contentSha256"],before_runtime["contentSha256"])
        # Removing both storage tables must not disguise 0024 without 0023 as a
        # legitimate historical 63-table backup.
        with self.assertRaisesRegex(RuntimeError,"storage predecessor"):
            _ai_evidence(set(AI_TABLES)-SCREENING_TABLES,[m for m in migrations if m[1] != "0023_business_screening_storage"])
        old_tables = set(AI_TABLES)-SCREENING_TABLES
        old_migrations = [m for m in migrations if int(m[1][:4]) <= 22]
        before_screening = _ai_evidence(old_tables, old_migrations)
        self.assertEqual(len([name for name in before_screening["tables"] if name.startswith("ai_")]), 63)
        self.assertNotEqual(current["contentSha256"],before_screening["contentSha256"])
        for table in SCREENING_TABLES:
            with self.assertRaises(RuntimeError): _ai_evidence(set(AI_TABLES)-{table}, migrations)
        for name in ("0022_business_integrated_reports","0023_business_screening_storage"):
            with self.assertRaises(RuntimeError): _ai_evidence(AI_TABLES,[m for m in migrations if m[1] != name])
        volume_tables = old_tables-{"ai_business_budget_plans"}
        volume_migrations = [m for m in migrations if int(m[1][:4]) <= 20]
        before_budgets = _ai_evidence(volume_tables, volume_migrations)
        self.assertEqual(len([name for name in before_budgets["tables"] if name.startswith("ai_")]), 62)
        self.assertNotEqual(current["contentSha256"], before_budgets["contentSha256"])
        directory_tables = volume_tables-{"ai_business_volume_chunks"}
        directory_migrations = [m for m in migrations if int(m[1][:4]) <= 19]
        before_volumes = _ai_evidence(directory_tables, directory_migrations)
        self.assertEqual(len([name for name in before_volumes["tables"] if name.startswith("ai_")]), 61)
        self.assertEqual(before_volumes["contentSha256"], _ai_evidence(directory_tables, directory_migrations)["contentSha256"])
        self.assertNotEqual(current["contentSha256"], before_volumes["contentSha256"])
        before_directory = _ai_evidence(directory_tables-{"ai_business_evidence_sources"}, [m for m in migrations if int(m[1][:4]) <= 18])
        self.assertEqual(len([name for name in before_directory["tables"] if name.startswith("ai_")]), 60)
        previous = [item for item in migrations if int(item[1][:4]) <= 13]
        self.assertEqual(len([name for name in _ai_evidence(PRE_EVIDENCE_TABLES, previous)["tables"] if name.startswith("ai_")]), 56)
        for tables, history in [(set(AI_TABLES)-{"ai_business_evidence_chunks"}, migrations), (set(AI_TABLES)-{"ai_business_file_chunks"}, migrations), (AI_TABLES, previous), (AI_TABLES, [m for m in migrations if m[1] != "0013_dingtalk_schedule_media"]), (AI_TABLES, [m for m in migrations if m[1] != "0015_business_collection"])]:
            with self.assertRaises(RuntimeError):
                _ai_evidence(tables, history)
        for missing in ("0014_business_evidence", "0015_business_collection", "0016_business_files", "0017_business_file_renderer", "0018_business_excel_renderer", "0019_business_source_directory", "0020_business_volume_files", "0021_business_budget_plans"):
            with self.subTest(missing=missing), self.assertRaises(RuntimeError):
                _ai_evidence(AI_TABLES, [m for m in migrations if m[1] != missing])
        with self.assertRaises(RuntimeError):
            _ai_evidence(set(AI_TABLES)-{"ai_business_evidence_sources"}, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(directory_tables, migrations)
        with self.assertRaises(RuntimeError):
            _ai_evidence(AI_TABLES, directory_migrations)

    def test_evidence_accepts_both_backup_generations_with_stable_content_digest(self):
        legacy_tables = set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_conversation_workspaces", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}
        legacy_migrations = [("ai_assistant", "0001_initial"), ("ai_assistant", "0005_postgres_image_payload")]
        legacy = _ai_evidence(legacy_tables, legacy_migrations)
        current = _ai_evidence(PRE_EVIDENCE_TABLES, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces"), ("ai_assistant", "0007_dingtalk_readonly"), ("ai_assistant", "0008_dingtalk_settings"), ("ai_assistant", "0009_model_generation_capabilities"), ("ai_assistant", "0010_dingtalk_schedules"), ("ai_assistant", "0011_prompt_settings"), ("ai_assistant", "0012_report_library"), ("ai_assistant", "0013_dingtalk_schedule_media")])
        pre_settings = _ai_evidence(set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces"), ("ai_assistant", "0007_dingtalk_readonly")])
        self.assertEqual(len([name for name in pre_settings["tables"] if name.startswith("ai_")]), 48)
        pre_dingtalk = _ai_evidence(set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, [*legacy_migrations, ("ai_assistant", "0006_conversation_workspaces")])
        self.assertEqual(len([name for name in pre_dingtalk["tables"] if name.startswith("ai_")]), 46)
        self.assertEqual(len([name for name in legacy["tables"] if name.startswith("ai_")]), 45)
        self.assertEqual(len([name for name in current["tables"] if name.startswith("ai_")]), 56)
        self.assertEqual(legacy["contentSha256"], _ai_evidence(legacy_tables, legacy_migrations)["contentSha256"])
        self.assertNotEqual(legacy["contentSha256"], current["contentSha256"])
        self.assertEqual(legacy["aiAssistant"], current["aiAssistant"])

    def test_evidence_rejects_inconsistent_ai_schema_and_migration_inventory(self):
        initial = ("ai_assistant", "0001_initial")
        workspace = ("ai_assistant", "0006_conversation_workspaces")
        legacy_tables = set(PRE_EVIDENCE_TABLES) - {"ai_library_revisions", "ai_execution_guidance", "ai_report_runs", "ai_report_deliveries", "ai_prompt_settings_revisions", "ai_conversation_workspaces", "ai_dingtalk_sessions", "ai_dingtalk_receipts", "ai_dingtalk_settings", "ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}
        for tables, migrations in [
            (legacy_tables, [initial, workspace]),
            (PRE_EVIDENCE_TABLES, [initial]),
            (PRE_EVIDENCE_TABLES, [workspace]),
            (PRE_EVIDENCE_TABLES, []),
            (set(), [initial]),
            (set(), [workspace]),
            (set(PRE_EVIDENCE_TABLES) | {"ai_unknown"}, [initial, workspace]),
        ]:
            with self.subTest(tables=len(tables), migrations=migrations):
                with self.assertRaisesRegex(RuntimeError, "AI .* (inventory|migration)"):
                    _ai_evidence(tables, migrations)

    def test_loopback_identity_normalizes_postgres_inet_cidr_text(self):
        self.assertEqual(
            MODULE._canonical_loopback_address("127.0.0.1/32"),
            "127.0.0.1",
        )
        self.assertEqual(MODULE._canonical_loopback_address("::1/128"), "::1")
        with self.assertRaisesRegex(RuntimeError, "not bound to a loopback"):
            MODULE._canonical_loopback_address("127.0.0.2/32")

    def test_backup_binds_dump_to_exported_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_dump = root / "pg_dump.exe"
            pg_dump.write_bytes(b"fixture")
            output = root / "backup.dump"
            connection = _SnapshotConnection()
            captured_command = []

            def fake_run(command, **kwargs):
                captured_command.extend(command)
                output.write_bytes(b"valid-custom-archive-fixture")
                self.assertEqual(kwargs["timeout"], 77)
                self.assertEqual(kwargs["stdout"], subprocess.PIPE)
                self.assertEqual(kwargs["stderr"], subprocess.PIPE)
                return subprocess.CompletedProcess(command, 0, b"", b"")

            args = argparse.Namespace(
                pg_dump=str(pg_dump),
                output=str(output),
                expected_database="teruisi_sales",
                expected_user="teruisi_sales_owner",
                port=5432,
                timeout_seconds=77,
            )
            with (
                mock.patch.object(MODULE.psycopg, "connect", return_value=connection),
                mock.patch.object(
                    MODULE,
                    "collect_evidence",
                    return_value={"contentSha256": "a" * 64},
                ),
                mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run),
            ):
                result = MODULE.run_backup(args)

            self.assertTrue(connection.committed)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(len(result["snapshotIdSha256"]), 64)
            self.assertIn("--snapshot=00000003-00000001-1", captured_command)
            self.assertIn("--format=custom", captured_command)
            self.assertIn("--no-owner", captured_command)
            self.assertIn("--no-privileges", captured_command)
            self.assertNotIn("password", " ".join(captured_command).lower())

    def test_failed_backup_removes_only_its_new_output(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_dump = root / "pg_dump.exe"
            pg_dump.write_bytes(b"fixture")
            output = root / "backup.dump"
            connection = _SnapshotConnection()

            def fake_run(command, **kwargs):
                output.write_bytes(b"partial")
                return subprocess.CompletedProcess(command, 9, b"", b"failure")

            args = argparse.Namespace(
                pg_dump=str(pg_dump),
                output=str(output),
                expected_database="teruisi_sales",
                expected_user="teruisi_sales_owner",
                port=5432,
                timeout_seconds=77,
            )
            with (
                mock.patch.object(MODULE.psycopg, "connect", return_value=connection),
                mock.patch.object(MODULE, "collect_evidence", return_value={}),
                mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run),
            ):
                with self.assertRaisesRegex(RuntimeError, "pg_dump failed"):
                    MODULE.run_backup(args)
            self.assertFalse(output.exists())
            self.assertTrue(pg_dump.exists())

    def test_restore_is_single_transaction_and_bounded(self):
        with tempfile.TemporaryDirectory(prefix="teruisi-pg-helper-") as temporary:
            root = Path(temporary)
            pg_restore = root / "pg_restore.exe"
            archive = root / "approved.dump"
            pg_restore.write_bytes(b"fixture")
            archive.write_bytes(b"archive")
            captured_command = []

            def fake_run(command, **kwargs):
                captured_command.extend(command)
                self.assertEqual(kwargs["timeout"], 91)
                return subprocess.CompletedProcess(command, 0, b"", b"")

            args = argparse.Namespace(
                pg_restore=str(pg_restore),
                archive=str(archive),
                expected_database="teruisi_sales",
                expected_user="postgres",
                port=55432,
                timeout_seconds=91,
            )
            with mock.patch.object(MODULE.subprocess, "run", side_effect=fake_run):
                result = MODULE.run_restore(args)
            self.assertEqual(result["status"], "completed")
            self.assertIn("--port=55432", captured_command)
            self.assertIn("--single-transaction", captured_command)
            self.assertIn("--no-owner", captured_command)
            self.assertIn("--no-privileges", captured_command)

    def test_native_diagnostic_is_bounded_and_contains_no_output(self):
        completed = subprocess.CompletedProcess(
            ["fixture"], 4, b"x" * 20000, b"secret-text" * 2000
        )
        diagnostic = MODULE._safe_native_diagnostic(completed)
        self.assertEqual(diagnostic["exitCode"], 4)
        self.assertEqual(diagnostic["capturedBytes"], MODULE.MAX_NATIVE_DIAGNOSTIC_BYTES)
        self.assertTrue(diagnostic["outputTruncated"])
        self.assertEqual(set(diagnostic), {
            "exitCode", "outputBytes", "capturedBytes", "outputTruncated", "outputSha256"
        })


if __name__ == "__main__":
    unittest.main()
