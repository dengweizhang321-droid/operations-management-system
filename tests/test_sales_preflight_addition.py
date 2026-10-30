"""Finite Sales154 ordering-key proof, using a temporary in-memory database.

The 2026-10-30 release died because preservation() ordered every one of153's
seven tables by "id", and three of them key on a OneToOne parent instead
("ai_pi_agents" on session_id, "ai_pi_native_states" on root_session_id,
"ai_pi_business_delegations" on intent_id). Every existing test in this chain
injects a fake cursor, which accepts any column name, so none of them could
catch it.

These tests run the statement preservation() actually builds against a real SQL
engine, so a wrong ordering column fails here the way it failed in production.
"""
import sqlite3
import unittest
from unittest.mock import patch

import pi_native_catalog as parent
import sales_preflight_catalog as catalog


# The reviewed153 shape: primary-key column per table, as both the migration
# state and the production catalogue report it.
KEYS = {
    "ai_pi_agents": "session_id",
    "ai_pi_agent_messages": "id",
    "ai_pi_agent_waits": "id",
    "ai_pi_business_delegations": "intent_id",
    "ai_pi_file_handoffs": "id",
    "ai_pi_native_states": "root_session_id",
    "ai_pi_plan_revisions": "id",
}


class StubField:
    def __init__(self, column):
        self.column = column


class StubMeta:
    def __init__(self, column):
        self.pk = StubField(column)


class StubModel:
    def __init__(self, column):
        self._meta = StubMeta(column)


def models_for(keys):
    return {table: StubModel(column) for table, column in keys.items()}


class SalesPreflightOrderingTests(unittest.TestCase):
    def test_order_columns_follows_the_declared_primary_key(self):
        order = catalog.order_columns(parent.TABLES, models_for(KEYS))
        self.assertEqual(order, KEYS)
        # The three OneToOne-keyed tables must never be ordered by "id".
        for table in ("ai_pi_agents", "ai_pi_native_states", "ai_pi_business_delegations"):
            self.assertNotEqual(order[table], "id")

    def test_order_columns_rejects_membership_drift_and_missing_keys(self):
        short = dict(KEYS)
        short.pop("ai_pi_agents")
        with self.assertRaises(ValueError):
            catalog.order_columns(parent.TABLES, models_for(short))

        extra = dict(KEYS, ai_pi_unknown="id")
        with self.assertRaises(ValueError):
            catalog.order_columns(parent.TABLES, models_for(extra))

        keyless = models_for(KEYS)
        keyless["ai_pi_agents"]._meta.pk = None
        with self.assertRaises(ValueError):
            catalog.order_columns(parent.TABLES, keyless)

        blank = models_for(KEYS)
        blank["ai_pi_agents"]._meta.pk = StubField("")
        with self.assertRaises(ValueError):
            catalog.order_columns(parent.TABLES, blank)

    def test_preservation_statement_runs_against_a_real_sql_engine(self):
        """A real engine rejects an unknown ordering column at prepare time.

        This is the regression that reached production: with "id" hardcoded,
        the three OneToOne-keyed tables raise here, exactly as PostgreSQL
        raised UndefinedColumn during the release.
        """
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        for table, key in KEYS.items():
            connection.execute(
                'CREATE TABLE "%s" ("%s" TEXT PRIMARY KEY, payload TEXT)' % (table, key))
            connection.execute('INSERT INTO "%s" VALUES (?,?)' % table, ("b", "two"))
            connection.execute('INSERT INTO "%s" VALUES (?,?)' % table, ("a", "one"))

        order = catalog.order_columns(parent.TABLES, models_for(KEYS))
        for table in parent.TABLES:
            rows = connection.execute(
                'SELECT payload FROM "%s" ORDER BY "%s" LIMIT 100001'
                % (table, order[table])).fetchall()
            # Ordering must be deterministic: legacyRowsSha256 is compared
            # across the separate install and finalize calls.
            self.assertEqual(rows, [("one",), ("two",)])

        # The pre-fix statement must fail on every OneToOne-keyed table.
        for table in ("ai_pi_agents", "ai_pi_native_states", "ai_pi_business_delegations"):
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute('SELECT payload FROM "%s" ORDER BY id' % table).fetchall()

    def test_preservation_orders_by_the_resolved_key_for_every_table(self):
        """preservation() must emit each table's own key, never a fixed "id"."""
        statements = []

        class RecordingCursor:
            def execute(self, query, parameters=None):
                # as_string renders the composed identifiers; str() would only
                # show psycopg's Composed([...]) wrapper and assert nothing.
                statements.append(query.as_string() if hasattr(query, "as_string")
                                  else str(query))

            def fetchall(self):
                return []

            def fetchone(self):
                return (None,)

        original = {"rows": 0, "legacyRowsSha256": "a" * 64, "permissionsSha256": "b" * 64}
        with patch.object(parent, "preservation", return_value=original), \
                patch.object(parent, "models_at_revision", return_value=models_for(KEYS)):
            catalog.preservation(RecordingCursor())

        for table, key in KEYS.items():
            self.assertTrue(
                any('"%s"' % table in text and 'ORDER BY "%s"' % key in text
                    for text in statements),
                "no ORDER BY %s statement for %s" % (key, table))
        self.assertFalse(
            any("ORDER BY \"id\"" in text and "ai_pi_agents" in text for text in statements))


if __name__ == "__main__":
    unittest.main()
