"""Pure finance.0003 readiness catalog probes; no real database connection."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from teruisi_backend import health


def guard():
    return {"triggers":list(health.FINANCE_MARKER_TRIGGERS),
        "functions":[(name,True,["search_path=pg_catalog, public"])
            for name in sorted(health.FINANCE_MARKER_FUNCTIONS)],
        "primaryKey":[("PRIMARY KEY (transaction_id)",)],
        "privileges":(False,)*28,
        "columns":[("transaction_id",True,"bigint"),
            ("baseline_revision",True,"bigint"),
            ("baseline_digest",True,"character varying(64)")]}


class Cursor:
    def __init__(self, *, migrated=False, present=False, state=None):
        self.migrated = migrated
        self.present = present
        self.state = deepcopy(state or guard())
        self.rows = []

    def execute(self, query, params=None):
        if "FROM django_migrations" in query:
            self.rows = [(self.migrated,)]
        elif "to_regclass('public.finance_source_revision_markers')" in query:
            self.rows = [(self.present,)]
        elif "FROM pg_catalog.pg_attribute a" in query:
            self.rows = self.state["columns"]
        elif "pg_get_constraintdef" in query:
            self.rows = self.state["primaryKey"]
        elif "FROM pg_catalog.pg_trigger t" in query:
            self.rows = self.state["triggers"]
        elif "FROM pg_catalog.pg_proc p" in query:
            self.rows = self.state["functions"]
        elif "pg_catalog.has_table_privilege" in query:
            self.rows = [self.state["privileges"]]
        elif "FROM pg_collation" in query:
            self.rows = [(1,)]
        else:
            raise AssertionError("unexpected finance health query: "+query)

    def fetchone(self):
        return self.rows[0]

    def fetchall(self):
        return self.rows


class Introspection:
    def __init__(self, present, state):
        self.present, self.state = present, state

    def table_names(self, _cursor):
        return [*health.REQUIRED_FINANCE_WRITER_COLUMNS,
            *([health.FINANCE_MARKER_TABLE] if self.present else [])]

    def get_table_description(self, _cursor, table):
        keys = health.REQUIRED_FINANCE_WRITER_COLUMNS[table]
        return [SimpleNamespace(name=name) for name in keys]

    def get_constraints(self, _cursor, table):
        if table == "finance_lines":
            return {name:{"index":True} for name in health.REQUIRED_FINANCE_INDEXES}
        raise AssertionError(table)


class FinanceSourceRevisionHealthTests(SimpleTestCase):
    def ready(self, *, migrated=False, present=False, state=None, writer=False):
        cursor = Cursor(migrated=migrated,present=present,state=state)
        connection = SimpleNamespace(vendor="postgresql",
            introspection=Introspection(present,cursor.state))
        with patch.object(health,"connection",connection):
            health._validate_finance_schema(cursor,writer=writer)

    def test_finance_0002_retains_old_health_semantics(self):
        self.ready(writer=False)
        self.ready(writer=True)

    def test_migration_and_marker_must_be_bidirectional(self):
        self.ready(migrated=True,present=True,writer=False)
        self.ready(migrated=True,present=True,writer=True)
        with self.assertRaisesMessage(health.ReadinessError,
                "finance_source_marker_schema_missing"):
            self.ready(migrated=True,present=False)
        with self.assertRaisesMessage(health.ReadinessError,
                "finance_source_marker_without_migration"):
            self.ready(migrated=False,present=True)

    def test_missing_trigger_function_key_column_or_excess_grant_reject(self):
        cases = []
        value = guard(); value["triggers"].pop(); cases.append(value)
        value = guard(); value["functions"].pop(); cases.append(value)
        value = guard(); value["functions"][0] = (value["functions"][0][0],
            False,value["functions"][0][2]); cases.append(value)
        value = guard(); value["functions"][0] = (value["functions"][0][0],
            True,["search_path=public"]); cases.append(value)
        value = guard(); value["primaryKey"] = []; cases.append(value)
        value = guard(); value["columns"].pop(); cases.append(value)
        value = guard(); value["privileges"] = (True,)+(False,)*27; cases.append(value)
        value = guard(); value["privileges"] = (False,)*9+(True,)+(False,)*18; cases.append(value)
        for state in cases:
            with self.subTest(state=state), self.assertRaises(health.ReadinessError):
                self.ready(migrated=True,present=True,state=state)
