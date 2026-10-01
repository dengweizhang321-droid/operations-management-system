"""Only the shared deadline; facts and permission semantics use existing suites."""
from unittest.mock import patch

from django.db import connection
from django.test import TestCase

from netshop.errors import NetshopApiError
from netshop.product_insights import read_product_detail, read_product_insights
from netshop.promotion_insights import read_promotion_detail, read_promotion_insights


class NestedOwningDeadlineTests(TestCase):
    def readers(self):
        return [
            (read_product_insights, "netshop.product_insights._read_product_insights"),
            (read_product_detail, "netshop.product_insights._read_product_detail"),
            (read_promotion_insights, "netshop.promotion_insights._read_once"),
            (read_promotion_detail, "netshop.promotion_insights._read_once"),
        ]

    def test_default_and_future_deadline_never_extend_owning_65_seconds(self):
        for reader, implementation in self.readers():
            for supplied in [None, 1000.0, 103.0]:
                with self.subTest(reader=reader.__name__, supplied=supplied):
                    with patch("netshop.insights_common.time.monotonic", return_value=100.0), patch(implementation, side_effect=lambda *args: args[-1]):
                        self.assertEqual(reader(None, {}, deadline=supplied), 103.0 if supplied == 103.0 else 165.0)

    def test_expired_or_invalid_deadline_is_refused_before_reader_or_sql(self):
        for reader, implementation in self.readers():
            for supplied in [99.0, 100.0, float("nan"), float("inf"), True, "103", 10**1000]:
                with self.subTest(reader=reader.__name__, supplied=supplied):
                    with patch("netshop.insights_common.time.monotonic", return_value=100.0), patch(implementation) as body:
                        with self.assertNumQueries(0), self.assertRaises(NetshopApiError) as failure:
                            reader(None, {}, deadline=supplied)
                        self.assertEqual(failure.exception.status, 503 if type(supplied) is float and supplied in [99.0, 100.0] else 400)
                        body.assert_not_called()

    def test_actual_second_select_does_not_execute_after_outer_deadline(self):
        if connection.vendor != "postgresql":
            self.skipTest("Needs the private PostgreSQL sequence as actual-execution proof")
        for reader, implementation in self.readers():
            with self.subTest(reader=reader.__name__):
                clock = [100.0]
                with connection.cursor() as cursor:
                    cursor.execute("CREATE TEMP SEQUENCE nested_deadline_probe")
                def execute_body(*args):
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT nextval('nested_deadline_probe')")
                        self.assertEqual(cursor.fetchone()[0], 1)
                        clock[0] = args[-1] + 0.1
                        cursor.execute("SELECT nextval('nested_deadline_probe')")
                try:
                    with patch("netshop.insights_common.time.monotonic", side_effect=lambda: clock[0]), patch(implementation, side_effect=execute_body):
                        with self.assertRaises(NetshopApiError) as failure:
                            reader(None, {}, deadline=103.0)
                    self.assertEqual(failure.exception.code, "source_not_ready")
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT last_value FROM nested_deadline_probe")
                        self.assertEqual(cursor.fetchone()[0], 1)
                finally:
                    with connection.cursor() as cursor:
                        cursor.execute("DROP SEQUENCE nested_deadline_probe")
