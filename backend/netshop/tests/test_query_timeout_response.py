import json
from unittest import skipUnless
from unittest.mock import patch

from django.db import OperationalError, connection, transaction
from django.test import SimpleTestCase
from psycopg.errors import QueryCanceled, ConnectionFailure

from netshop.views import _error


class QueryTimeoutResponseTests(SimpleTestCase):
    databases = {"default"}

    def wrapped(self, cause):
        error = OperationalError(str(cause))
        error.__cause__ = cause
        return error

    @patch("netshop.views.logger")
    def test_statement_timeout_is_bounded_503_without_database_text(self, logger):
        error = self.wrapped(QueryCanceled(
            "canceling statement due to statement timeout; private-query-marker"
        ))
        response = _error(error, "读取失败")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), {
            "error": "当前范围查询超时，请稍后重新读取。", "code": "source_not_ready",
        })
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertNotIn(b"private-query-marker", response.content)
        logger.warning.assert_called_once()
        logger.exception.assert_not_called()

    @patch("netshop.views.logger")
    def test_other_cancellation_connection_error_and_plain_text_keep_500(self, logger):
        for error in [self.wrapped(QueryCanceled("canceling statement due to user request")),
                      self.wrapped(ConnectionFailure("statement timeout")),
                      OperationalError("statement timeout")]:
            with self.subTest(error=error):
                response = _error(error, "读取失败")
                self.assertEqual(response.status_code, 500)
                self.assertEqual(json.loads(response.content)["code"], "internal_error")

    @patch("netshop.views.logger")
    def test_import_error_contract_is_unchanged(self, logger):
        error = self.wrapped(QueryCanceled("canceling statement due to statement timeout"))
        response = _error(error, "导入失败", import_shape=True)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(json.loads(response.content), {
            "ok": False, "status": "rejected", "message": "导入失败", "code": "internal_error",
        })

    @skipUnless(connection.vendor == "postgresql", "Real PostgreSQL cancellation")
    @patch("netshop.views.logger")
    def test_real_driver_statement_timeout_keeps_connection_usable(self, logger):
        with self.assertRaises(OperationalError) as cancelled:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("SET LOCAL statement_timeout=10")
                cursor.execute("SELECT pg_sleep(0.05)")
        response = _error(cancelled.exception, "读取失败")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)["code"], "source_not_ready")
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual(cursor.fetchone(), (1,))
