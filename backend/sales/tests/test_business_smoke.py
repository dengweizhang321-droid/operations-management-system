"""Business-level smoke probe: the readiness schema/privilege checks prove the
database connects and the right columns exist, but they never execute a real
query. This exercises `_validate_sales_business_smoke`, the function that runs
the same aggregate query shape the `/summary` endpoint issues, directly
against the ORM so a broken join, annotation, or serialization regression
fails readiness even though every column still exists.
"""

from __future__ import annotations

from unittest.mock import patch

from django.db import connection
from django.test import TestCase

from sales.models import SalesOrderLine
from sales.tests.factories import install_fixture
from teruisi_backend import health


class SalesBusinessSmokeTests(TestCase):
    def test_passes_against_an_empty_table(self) -> None:
        # A fresh environment with no imported sales yet must not fail the
        # smoke probe: there is no business data to find broken, only a query
        # that has to execute successfully and return the expected shape.
        with connection.cursor() as cursor:
            health._validate_sales_business_smoke(cursor)

    def test_passes_against_real_fixture_rows(self) -> None:
        install_fixture()
        with connection.cursor() as cursor:
            health._validate_sales_business_smoke(cursor)

    def test_fails_when_the_query_raises(self) -> None:
        install_fixture()
        with patch("sales.query.sales_queryset", side_effect=RuntimeError("boom")):
            with connection.cursor() as cursor:
                with self.assertRaises(health.ReadinessError) as caught:
                    health._validate_sales_business_smoke(cursor)
        self.assertEqual(caught.exception.code, "sales_business_smoke_query_failed")

    def test_fails_when_the_aggregate_shape_is_wrong(self) -> None:
        # A real but incomplete/non-integer aggregate result (e.g. a column
        # rename or a serialization regression) must fail closed even though
        # the query executed without raising.
        install_fixture()
        with patch(
            "django.db.models.QuerySet.aggregate",
            return_value={"gross_sales_cents": "not-an-int"},
        ):
            with connection.cursor() as cursor:
                with self.assertRaises(health.ReadinessError) as caught:
                    health._validate_sales_business_smoke(cursor)
        self.assertEqual(caught.exception.code, "sales_business_smoke_shape_invalid")

    def test_fails_when_scope_is_unexpectedly_restricted(self) -> None:
        # The internal readiness caller always passes principal=None and must
        # get the unrestricted scope back. If that ever regresses to a
        # filtered scope, the probe must fail closed rather than silently
        # smoke-test a narrower (or wrong) slice of the business data.
        install_fixture()
        with patch(
            "sales.query.sales_queryset",
            side_effect=lambda **kwargs: (SalesOrderLine.objects.none(), "restricted"),
        ):
            with connection.cursor() as cursor:
                with self.assertRaises(health.ReadinessError) as caught:
                    health._validate_sales_business_smoke(cursor)
        self.assertEqual(caught.exception.code, "sales_business_smoke_scope_invalid")
