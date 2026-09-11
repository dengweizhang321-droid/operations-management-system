"""Synthetic inputs only. Never execute generated Python in the test host."""
from copy import deepcopy
from unittest.mock import patch
from django.test import SimpleTestCase, TestCase, override_settings
from sales.auth import Principal
from pandas_runner.protocol import encode, signature, validate_job, validate_result
from . import pandas_sandbox as sandbox, datasets, chat, models as m
from .policy import AiError, canonical
from .test_datasets import catalog_fixture
from . import tests as support
from .test_dataset_chat import catalog as chat_catalog, wire
from . import provider

ADMIN = Principal("local-admin@teruisi.local", "Fixture", "admin", None)
IMAGE = "sha256:" + "a" * 64
INPUT = {"name": "sales", "dataset": "rows_erp_product_master", "query": {"columns": ["product_code"], "pageSize": 1}}
PAYLOAD = {"operation": "pandas-analysis", "surface": "ai_chat", "inputsJson": canonical([INPUT]), "code": "result = frames['sales']"}


def page(rows=None, more=False, cursor=None, **extra):
    return {"source": {"domain": "erp_reference", "storage": "Django/PostgreSQL"},
        "dataCutoffDate": None, "queriedAt": "2026-09-11T00:00:00Z", "freshness": {},
        "data": {"rows": rows if rows is not None else [{"product_code": "合成货品"}],
            "hasMore": more, "nextCursor": cursor, "truncated": more, "truncatedFields": [], "cellWindows": {}, **extra}}


class PandasExportTests(SimpleTestCase):
    def test_broker_reply_signature_image_cleanup_and_shape_are_verified(self):
        from unittest.mock import Mock
        key = b"k" * 32
        valid = {"result": {"columns": ["amount"], "rows": [{"amount": 800}]}, "image": IMAGE, "cleanupVerified": True}
        for payload, bad_signature, rejected in [(valid, False, False), (valid, True, True),
                ({**valid, "cleanupVerified": False}, False, True), ({**valid, "image": "sha256:" + "b" * 64}, False, True),
                ({**valid, "result": {"rows": [], "columns": [], "forged": True}}, False, True)]:
            connection, response = Mock(), Mock()
            connection.sock = None
            response.status = 200
            raw = encode(payload)
            response.read.return_value = raw
            connection.getresponse.return_value = response
            def header(name):
                if name == "Content-Type":
                    return "application/json"
                headers = connection.request.call_args.kwargs["headers"]
                return "invalid" if bad_signature else signature(key, headers["X-Timestamp"], headers["X-Nonce"], raw, "response")
            response.getheader.side_effect = lambda name, default=None: header(name)
            with patch.object(sandbox.http.client, "HTTPConnection", return_value=connection) as http:
                if rejected:
                    with self.assertRaises(AiError):
                        sandbox.call_runner({"code": "result = frames['sales']", "frames": {"sales": []}}, (key, IMAGE))
                else:
                    result = sandbox.call_runner({"code": "result = frames['sales']", "frames": {"sales": []}}, (key, IMAGE))
                    self.assertEqual(result["rows"], [{"amount": 800}])
                self.assertEqual(http.call_args.args, ("127.0.0.1", 8121))
                connection.close.assert_called_once()

    def test_continuous_pages_keep_scope_query_and_disclose_non_atomic_source(self):
        with patch.object(datasets, "query", side_effect=[page(more=True, cursor="p2"), page([{"product_code": "合成货品2"}])]) as source:
            frames, sources = sandbox.export_frames([INPUT], ADMIN, "fixture", "ai_chat")
        self.assertEqual(len(frames["sales"]), 2)
        self.assertEqual(source.call_args.args[1]["query"], {**INPUT["query"], "cursor": "p2"})
        self.assertEqual(source.call_args.args[2], ADMIN)
        self.assertTrue(sources[0]["complete"])
        self.assertEqual(sources[0]["consistency"], "live_per_page")
        self.assertIsNone(sources[0]["dataCutoffDate"])

    def test_partial_text_cursor_cycles_and_inconsistent_pages_fail(self):
        cases = [page(truncatedFields=["0.product_code"]), page(cellWindows={"0.x": {"nextOffset": 2000}}),
                 page(more=True), page(more=True, cursor="p2", rows=[]), page(cursor="orphan"),
                 page(truncated=True), page(hasMore="false")]
        for value in cases:
            with self.subTest(value=value), patch.object(datasets, "query", return_value=value), self.assertRaises(AiError):
                sandbox.export_frames([INPUT], ADMIN, "fixture", "ai_chat")
        with patch.object(datasets, "query", return_value=page(more=True, cursor="cycle")), self.assertRaises(AiError):
            sandbox.export_frames([INPUT], ADMIN, "fixture", "ai_chat")

    def test_bounds_duplicate_aliases_and_no_model_provided_files_or_credentials(self):
        for items in [[{**INPUT, "path": "/etc/passwd"}], [{**INPUT, "query": {"cursor": "late-page"}}],
                      [{**INPUT, "query": {"textOffset": 1}}], [{**INPUT, "name": "../../host"}],
                      [{**INPUT, "collection": "rows[0]"}], [INPUT] * 4]:
            with self.subTest(items=items), self.assertRaises(AiError):
                sandbox.export_frames(items, ADMIN, "fixture", "ai_chat")
        with patch.object(datasets, "query", return_value=page()), self.assertRaises(AiError):
            sandbox.export_frames([INPUT, INPUT], ADMIN, "fixture", "ai_chat")
        with patch.object(datasets, "query", return_value=page([{"x": 1}] * 2001)), self.assertRaises(AiError):
            sandbox.export_frames([INPUT], ADMIN, "fixture", "ai_chat")

    def test_native_collection_requires_complete_evidence(self):
        item = {"name": "native", "dataset": "sales_category", "query": {}, "collection": "trend.items"}
        for data in [{"trend": {"items": [{"x": 1}]}}, {"truncated": True, "trend": {"items": [], "truncated": False}},
                     {"trend": {"items": [{"x": 1}], "truncated": False, "total": 4}}]:
            with patch.object(datasets, "query", return_value={**page(), "data": data}), self.assertRaises(AiError):
                sandbox.export_frames([item], ADMIN, "fixture", "ai_chat")
        with patch.object(datasets, "query", return_value={**page(), "data": {"trend": {"items": [{"x": 1}], "truncated": False, "total": 1}}}):
            frames, _ = sandbox.export_frames([item], ADMIN, "fixture", "ai_chat")
            self.assertEqual(frames["native"], [{"x": 1}])

    def test_unavailable_or_denied_never_exports_or_calls_container(self):
        with patch.object(sandbox, "config", side_effect=sandbox.unavailable()), patch.object(datasets, "query") as source, self.assertRaises(AiError):
            sandbox.run(PAYLOAD, ADMIN, "fixture")
        source.assert_not_called()
        viewer = Principal(ADMIN.email, "Fixture", "viewer", None)
        with patch.object(sandbox, "current_principal", return_value=viewer), patch.object(sandbox, "config") as config, self.assertRaises(AiError):
            sandbox.run(PAYLOAD, viewer, "fixture")
        config.assert_not_called()

    def test_permissions_change_before_and_after_container_suppresses_output(self):
        narrower = Principal(ADMIN.email, "Fixture", "admin", {"warehouses": ["A"], "channels": [], "platforms": []})
        for actors, runs in [([ADMIN, narrower], 0), ([ADMIN, ADMIN, narrower], 1)]:
            with patch.object(sandbox, "current_principal", side_effect=actors), patch.object(sandbox, "config", return_value=(b"a"*32, IMAGE)), \
                    patch.object(sandbox, "export_frames", return_value=({"sales": [{"x": 1}]}, [])), \
                    patch.object(sandbox, "call_runner", return_value={"columns": ["x"], "rows": [{"x": 1}]}) as runner, self.assertRaises(AiError):
                sandbox.run(PAYLOAD, ADMIN, "fixture")
            self.assertEqual(runner.call_count, runs)

    def test_single_slot_and_result_metadata(self):
        sandbox._slots.acquire()
        try:
            with patch.object(sandbox, "config", return_value=(b"a"*32, IMAGE)), self.assertRaises(AiError) as error:
                sandbox.run(PAYLOAD, ADMIN, "fixture")
            self.assertEqual(error.exception.status, 429)
        finally:
            sandbox._slots.release()
        with patch.object(sandbox, "config", return_value=(b"a"*32, IMAGE)), patch.object(datasets, "query", return_value=page()), \
                patch.object(sandbox, "call_runner", return_value={"columns": ["x"], "rows": [{"x": -100}]}):
            result = sandbox.run(PAYLOAD, ADMIN, "fixture")
        self.assertEqual(result["items"], [{"x": -100}])
        self.assertTrue(result["cleanupVerified"])
        self.assertNotIn("code", result)
        self.assertFalse(result["truncated"])

    def test_existing_dataset_permission_and_field_filters_not_bypassed(self):
        entries = catalog_fixture()
        with patch.object(datasets.transport, "catalog", return_value=entries), patch.object(datasets.transport, "execute_tool") as tool, self.assertRaises(AiError):
            sandbox.export_frames([INPUT], Principal("analyst@example.invalid", "Analyst", "analyst", None), "fixture", "ai_chat")
        tool.assert_not_called()


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class PandasDispatchTests(TestCase):
    user = support.AiDomainTests.user
    call = support.AiDomainTests.call

    def setUp(self):
        support.AiDomainTests.setUp(self)

    def test_signed_consumer_receipt_replays_without_second_export_and_is_owner_bound(self):
        with patch.object(sandbox, "config", return_value=(b"a"*32, IMAGE)), \
                patch.object(sandbox, "export_frames", return_value=({"sales": [{"x": 1}]}, [])) as export, \
                patch.object(sandbox, "call_runner", return_value={"columns": ["x"], "rows": [{"x": 1}]}) as runner:
            first = self.call("/api/ai/consumer", PAYLOAD, self.owner, request_id="pandas-receipt")
            second = self.call("/api/ai/consumer", PAYLOAD, self.owner, request_id="pandas-receipt")
            crossed = self.call("/api/ai/consumer", PAYLOAD, self.other, request_id="pandas-receipt")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.json(), second.json())
        self.assertGreaterEqual(crossed.status_code, 400)
        self.assertEqual(runner.call_count, 1)
        self.assertEqual(export.call_count, 1)

    def test_failed_dispatch_is_not_replayed_and_audit_contains_only_digest(self):
        with patch.object(sandbox, "config", return_value=(b"a"*32, IMAGE)), \
                patch.object(sandbox, "export_frames", return_value=({"sales": []}, [])), \
                patch.object(sandbox, "call_runner", side_effect=sandbox.unavailable()) as runner:
            first = self.call("/api/ai/consumer", PAYLOAD, self.owner, request_id="pandas-failed")
            second = self.call("/api/ai/consumer", PAYLOAD, self.owner, request_id="pandas-failed")
        self.assertEqual(first.status_code, 503)
        self.assertGreaterEqual(second.status_code, 400)
        self.assertEqual(runner.call_count, 1)
        chat.audit(self.owner, "audit-fixture", "run_pandas_analysis", "started", arguments={"code": "sensitive-literal", "inputsJson": "query-literal"})
        summary = m.AiToolAuditLogs.objects.get(request_id="audit-fixture").arguments_json
        self.assertNotIn("sensitive-literal", summary)
        self.assertNotIn("query-literal", summary)
        self.assertIn("argumentsDigest", summary)

    def test_pandas_tool_flows_through_both_model_protocols_and_private_table_artifact(self):
        entries = chat_catalog()
        tool = deepcopy(entries[0])
        tool.update(name="run_pandas_analysis", title="pandas", inputSchema={"type": "object", "properties": {
            "code": {"type": "string"}, "inputsJson": {"type": "string"}}, "required": ["code", "inputsJson"], "additionalProperties": False})
        tool["execution"].update(environment="isolated_container", maxCallsPerRequest=1, timeoutMs=30000)
        entries.append(tool)
        for protocol in ["openai_compatible", "anthropic"]:
            self.model.protocol = protocol
            self.model.save(update_fields=["protocol"])
            args = {"code": PAYLOAD["code"], "inputsJson": PAYLOAD["inputsJson"]}
            responses = [wire(protocol, "run_pandas_analysis", args), wire(protocol, answer="合成测试计算结果为 800 分，来源日期未知。")]
            with patch.object(chat.transport, "catalog", return_value=entries), \
                    patch.object(chat.transport, "execute_tool", return_value={"ok": True, "toolName": "run_pandas_analysis", "data": {"items": [{"amountCents": 800}], "returned": 1, "truncated": False}}), \
                    patch.object(provider, "decrypt", return_value="isolated-fixture-key"), patch.object(provider, "bounded_json", side_effect=responses) as http:
                response = self.call("/api/ai/chat", {"clientRequestId": "pandas-chat-" + protocol, "message": "使用 pandas 计算合成样例"}, self.owner)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(http.call_count, 2)
            self.assertEqual(response.json()["artifacts"][0]["rows"], [[800]])
