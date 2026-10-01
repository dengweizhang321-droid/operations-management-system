"""Independent Q regression probes: private PG only, actual SQL boundaries."""
import json
import os
from pathlib import Path
from unittest.mock import patch

from django.db import connection, transaction
from django.test import TestCase

from netshop import promotion_insights as owning
from netshop.errors import NetshopApiError
from . import test_promotion_insights as fixtures


class PromotionQSqlTests(TestCase):
    # Reuse the real source writer fixtures, not the author's test methods.
    setUp = fixtures.PromotionInsightsTests.setUp
    tearDown = fixtures.PromotionInsightsTests.tearDown
    params = fixtures.PromotionInsightsTests.params
    day = fixtures.PromotionInsightsTests.day
    pair = fixtures.PromotionInsightsTests.pair
    read = fixtures.PromotionInsightsTests.read

    def preserve(self, name, value):
        directory = Path(os.environ["TERUISI_FOUNDATION_CAPACITY_EVIDENCE_DIR"])
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / name).open("x", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)

    def probe(self, query, detail=False, expire_before=False):
        clock = [0.0]
        proof = {"actualReadSql": [], "expiredActualReadSql": [], "cleanupSql": [], "triggeredSql": []}
        original = owning._read_once
        wrappers_before = tuple(connection.execute_wrappers)

        def observe(execute, sql, params, many, context):
            text = sql.lstrip().upper()
            read = text.startswith(("SELECT", "WITH", "SHOW", "EXPLAIN"))
            if read:
                proof["actualReadSql"].append(sql)
                if clock[0] > 65:
                    proof["expiredActualReadSql"].append(sql)
            elif clock[0] > 65:
                proof["cleanupSql"].append(sql)
            result = execute(sql, params, many, context)
            if read and '"netshop_promotion_aggregate_manifest"' in sql and not proof["triggeredSql"]:
                proof["triggeredSql"].append(sql)
                clock[0] = 66.0
            return result

        def run_inside_gate(*args):
            if expire_before:
                clock[0] = 66.0
            # The observer sits below the gate and sees only executed SQL.
            with connection.execute_wrapper(observe), transaction.atomic():
                return original(*args)

        with patch("netshop.promotion_insights.time.monotonic", side_effect=lambda: clock[0]), patch("netshop.promotion_insights._read_once", side_effect=run_inside_gate):
            with self.assertRaises(NetshopApiError) as failure:
                (owning.read_promotion_detail if detail else owning.read_promotion_insights)(self.principal, query)
        self.assertEqual(failure.exception.code, "source_not_ready")
        self.assertEqual(failure.exception.status, 503)
        self.assertEqual(proof["expiredActualReadSql"], [])
        self.assertTrue(any(sql.upper().startswith("ROLLBACK") for sql in proof["cleanupSql"]))
        self.assertTrue(any(sql.upper().startswith("RELEASE") for sql in proof["cleanupSql"]))
        self.assertEqual(tuple(connection.execute_wrappers), wrappers_before)
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual(cursor.fetchone(), (1,))
        proof.update(errorCode=failure.exception.code, wrapperRestored=True, connectionHealthy=True)
        return proof

    def test_q_expired_manifest_list_and_detail_execute_no_late_reads(self):
        self.pair()
        valid = self.read()
        item = valid["sections"]["items"][0]
        detail = self.params(objectKind="product", objectId=item["rowKey"], shopKey=item["shopKey"], sectionToken=valid["sectionToken"])
        proof = {}
        for name, params, is_detail in [("list", self.params(), False), ("detail", detail, True)]:
            proof[name] = self.probe(params, is_detail)
            self.assertTrue(proof[name]["triggeredSql"])
        self.preserve("q-sql-deadline-manifest.json", proof)

    def test_q_expired_before_actor_select_never_reaches_database(self):
        self.pair()
        proof = self.probe(self.params(), expire_before=True)
        self.assertEqual(proof["actualReadSql"], [])
        self.preserve("q-sql-deadline-before-actor.json", proof)

    def test_q_list_detail_only_parameters_fail_before_fact_reads(self):
        self.pair()
        valid = self.read()
        item = valid["sections"]["items"][0]
        rejected = []
        for values in [{"objectId": item["rowKey"]}, {"shopKey": item["shopKey"]}, {"objectId": item["rowKey"], "shopKey": item["shopKey"]}, {"objectId": ""}, {"shopKey": ""}]:
            with patch("netshop.promotion_insights._read_facts", side_effect=AssertionError("List misuse must not read business facts")):
                with self.assertRaises(NetshopApiError) as failure:
                    owning.read_promotion_insights(self.principal, self.params(**values))
            self.assertEqual(failure.exception.status, 400)
            rejected.append({"params": sorted(values), "status": failure.exception.status})
        self.preserve("q-list-detail-only-rejected.json", rejected)
