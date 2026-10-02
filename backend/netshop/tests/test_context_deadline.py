from unittest.mock import patch

from django.db import connection
from django.test import SimpleTestCase

from sales.auth import Principal
from netshop.errors import NetshopApiError
from netshop.insights_common import read_context


class ContextDeadlineTests(SimpleTestCase):
    """No DB: exercise actual shared-reader ordering and its installed fence."""

    def setUp(self):
        self.clock = [0.0]
        self.actor = Principal("local-admin@teruisi.local", "test", "admin", None)
        self.spec = {"platforms": ["京东"], "outlets": [{"platform": "京东", "shopName": "fixture"}]}

    def test_exhausted_revision_read_never_reaches_source_loader(self):
        def revision():
            self.clock[0] = 66.0
            return "1"
        with patch("netshop.insights_common.time.monotonic", side_effect=lambda: self.clock[0]), \
             patch("netshop.insights_common.actor_fence", return_value={}), \
             patch("netshop.insights_common.revision_value", side_effect=revision), \
             patch("netshop.insights_common.context_versions") as versions:
            with self.assertRaises(NetshopApiError) as failure:
                read_context(self.actor, self.spec)
            self.assertEqual(failure.exception.code, "source_not_ready")
            self.assertEqual(failure.exception.status, 503)
            versions.assert_not_called()

    def test_actual_fence_refuses_sql_after_deadline_before_execute(self):
        executed = []
        def reader(*args, **kwargs):
            self.clock[0] = 65.0
            return connection.execute_wrappers[-1](lambda *a: executed.append(True), "SELECT 1", [], False, {})
        with patch("netshop.insights_common.time.monotonic", side_effect=lambda: self.clock[0]), \
             patch("netshop.insights_common._read_context", side_effect=reader):
            with self.assertRaises(NetshopApiError):
                read_context(self.actor, self.spec)
        self.assertEqual(executed, [])

    def test_actual_fence_cannot_return_late_sql_success(self):
        executed = []
        def execute(*args):
            executed.append(True)
            self.clock[0] = 66.0
            return "would-be-success"
        def reader(*args, **kwargs):
            return connection.execute_wrappers[-1](execute, "/* read */ SELECT 1", [], False, {})
        with patch("netshop.insights_common.time.monotonic", side_effect=lambda: self.clock[0]), \
             patch("netshop.insights_common._read_context", side_effect=reader):
            with self.assertRaises(NetshopApiError):
                read_context(self.actor, self.spec)
        self.assertEqual(executed, [True])

    def test_nested_caller_keeps_earlier_absolute_deadline(self):
        self.clock[0] = 8.0
        with patch("netshop.insights_common.time.monotonic", side_effect=lambda: self.clock[0]), \
             patch("netshop.insights_common._read_context", return_value={}) as reader:
            read_context(self.actor, self.spec, deadline=10.0)
            self.assertEqual(reader.call_args.kwargs["deadline"], 10.0)

    def test_expired_fence_does_not_block_transaction_cleanup(self):
        executed = []
        def reader(*args, **kwargs):
            self.clock[0] = 66.0
            return connection.execute_wrappers[-1](lambda *a: executed.append(True), "ROLLBACK", [], False, {})
        with patch("netshop.insights_common.time.monotonic", side_effect=lambda: self.clock[0]), \
             patch("netshop.insights_common._read_context", side_effect=reader):
            read_context(self.actor, self.spec)
        self.assertEqual(executed, [True])
