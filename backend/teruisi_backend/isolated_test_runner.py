"""Isolated PostgreSQL test runner for protected SQL-only FK tables.

The protected ticket tables intentionally have no Django model. Django's
normal flush lists only managed model tables, so their foreign keys require
TRUNCATE CASCADE in the isolated rehearsal database. Production connections
never select this runner.
"""
from __future__ import annotations

from django.db import connections
from django.test.runner import DiscoverRunner


PROTECTED_SQL_TABLES = frozenset({
    "protected_business_budget_v11_verifier_keys",
    "protected_business_budget_v11_proof_tickets",
    "protected_business_budget_v11_proof_ticket_claims",
    "protected_business_v4_report_link_intents",
    "protected_business_v4_report_source_links",
    "protected_business_market_v2_rate_proposals",
    "protected_business_market_v2_cap_proposals",
    "protected_business_market_v2_authority_revocations",
})


class IsolatedPostgresTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        old_config = super().setup_databases(**kwargs)
        self._patched_flush = []
        for connection in connections.all():
            data = connection.settings_dict
            if connection.vendor != "postgresql":
                continue
            if (data["HOST"] != "127.0.0.1" or
                    data["NAME"] != "test_teruisi_ai_rehearsal" or
                    not 55440 <= int(data["PORT"]) <= 55999):
                raise RuntimeError("protected SQL flush requires isolated test database")
            operations = connection.ops
            original = operations.sql_flush

            def isolated_flush(style, tables, *, reset_sequences=False,
                               allow_cascade=False, _original=original,
                               _connection=connection):
                present = PROTECTED_SQL_TABLES.intersection(
                    _connection.introspection.table_names())
                selected = sorted(set(tables).union(present))
                return _original(style, selected,
                    reset_sequences=reset_sequences, allow_cascade=True)

            operations.sql_flush = isolated_flush
            self._patched_flush.append((operations, original))
        return old_config

    def teardown_databases(self, old_config, **kwargs):
        try:
            return super().teardown_databases(old_config, **kwargs)
        finally:
            for operations, original in getattr(self, "_patched_flush", ()):
                operations.sql_flush = original
