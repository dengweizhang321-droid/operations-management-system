"""Source-isolated daily alignment never fabricates totals or attribution."""
from copy import deepcopy
import hashlib
import json
from unittest import TestCase

from . import (cross_source_daily_columns as service, cross_source_kpi_plan,
    erp_fact_assignment, erp_fact_rollups)
from .contracts import AnalysisContractError, PageReconciler, comparison_periods, coverage, digest
from .test_erp_fact_assignment import fixture as erp_fixture


CONTEXT = {"reportId": "report-1", "evidenceRunId": "run-1",
    "evidenceVersion": 8, "sealedDigest": "a"*64,
    "ownerEmail": "owner@example.invalid", "scope": None}
COMMON = {"platform": "京东", "shop": "合成店",
    "startDate": "2026-08-16", "endDate": "2026-08-17"}


def native_page(source, items):
    query = source["query"]
    family = query["dataset"]
    source_name, dataset = service._NATIVE[
        {"sku": "netshopSku", "spu": "netshopSpu", "promotion": "promotion"}[family]]
    keys = (cross_source_kpi_plan.PROMOTION_METRICS if family == "promotion"
        else cross_source_kpi_plan.PRODUCT_METRICS)
    period = comparison_periods(query["startDate"], query["endDate"])
    observed = {item["date"] for item in items}
    page = {"schemaVersion": "business-analysis-v1", "source": source_name,
        "sourceDataset": dataset, "sourceRef": digest(query),
        "sourceRevision": "1:aaaaaaaaaaaa", "monetaryUnit": "CNY_CENT",
        "filters": {"platform": query["platform"], "shop": query["shop"],
            "dataset": family, "window": query["window"], "periods": period},
        "coverage": coverage(period[query["window"]], observed),
        "control": {"rowCount": len(items), "typedTotals":
            {key: sum(item["metrics"][key] or 0 for item in items) for key in keys}},
        "items": items, "pageEvidence": {"rowCount": len(items),
            "sha256": digest(items)},
        "pagination": {"hasMore": False, "nextCursor": None, "limit": 100}}
    verifier = PageReconciler(); verifier.consume(page)
    return [page], {"metadata": {"sourceRevision": page["sourceRevision"],
        "coverage": page["coverage"]}, "expected": verifier.result(), "pageCount": 1}


def product(number, day, sku, spu, payment, visitors):
    metrics = {key: 0 for key in cross_source_kpi_plan.PRODUCT_METRICS}
    metrics.update(paymentCents=payment, productDayVisitors=visitors)
    return {"rowId": str(number), "sourceRowHash": digest(["product", number]),
        "platform": "京东", "shopName": "合成店", "date": day,
        "skuId": sku, "spuId": spu, "metrics": metrics}


def promotion(number, day, sku, spend, gmv):
    metrics = {key: 0 for key in cross_source_kpi_plan.PROMOTION_METRICS}
    metrics.update(spendCents=spend, reportedGmvCents=gmv)
    return {"rowId": str(number), "sourceRowHash": digest(["promotion", number]),
        "platform": "京东", "shopName": "合成店", "date": day,
        "dimensions": {"promotedSkuId": sku}, "metrics": metrics}


def fixture():
    sources = [{"key": "master", "domain": "netshop",
        "query": {**COMMON, "dataset": "master", "window": "current"}},
        {"key": "sales", "domain": "sales",
            "query": {**COMMON, "channel": "京东-合成店", "window": "current"}}]
    keys = {"master": "master"}
    for family, dataset in (("erpSales", None), ("netshopSku", "sku"),
            ("netshopSpu", "spu"), ("promotion", "promotion")):
        keys[family] = {"current": "sales" if family == "erpSales" else family,
            "previous": None, "yearAgo": None}
        if dataset is not None:
            sources.append({"key": family, "domain": "netshop",
                "query": {**COMMON, "dataset": dataset, "window": "current"}})
    sales, se, master, me = erp_fixture()
    infos = {"sales": {"metadata": {"sourceRevision": sales[0]["sourceRevision"],
        "coverage": sales[0]["coverage"]}, "expected": se, "pageCount": 1},
        "master": {"metadata": {"sourceRevision": master[0]["sourceRevision"],
            "coverage": master[0]["coverage"]}, "expected": me, "pageCount": 1}}
    native = {}
    entries = {
        "netshopSku": [product(10, COMMON["startDate"], "S1", "P1", 0, 3)],
        "netshopSpu": [product(11, COMMON["startDate"], None, "P1", 70, 4)],
        "promotion": [promotion(12, COMMON["startDate"], "S1", 20, 60),
            promotion(13, COMMON["endDate"], None, 5, 10)]}
    for source in sources:
        if source["key"] in entries:
            native[source["key"]], infos[source["key"]] = native_page(
                source, entries[source["key"]])
    plan = cross_source_kpi_plan.prepare_candidate(sources, infos, CONTEXT, keys)
    with erp_fact_assignment.assign_facts(sources, plan["mappingPlan"],
            plan["currentMappingPairKey"], sales, master, se, me) as ledger:
        summary = ledger.summary()
        with erp_fact_rollups.prepare(ledger) as prepared:
            raw = {kind: list(prepared.ndjson_pages(kind))
                for kind in service._ERP_KINDS}
            rollup = prepared.manifest
    binding = {"reportId": CONTEXT["reportId"],
        "evidenceRunId": CONTEXT["evidenceRunId"],
        "evidenceVersion": CONTEXT["evidenceVersion"],
        "sealedDigest": CONTEXT["sealedDigest"],
        "principalKey": digest([CONTEXT["ownerEmail"], "null"]),
        "mappingPlanDigest": plan["mappingPlanDigest"]}
    manifest = {"schemaVersion": service.ERP_SCHEMA,
        "reportBinding": binding, "pairKey": plan["currentMappingPairKey"],
        "salesKey": "sales", "masterKey": "master",
        "salesQueryDigest": digest(sources[1]["query"]),
        "masterQueryDigest": digest(sources[0]["query"]),
        "sourceProofs": summary["sourceProofs"],
        "assignmentSummaryDigest": summary["resultDigest"],
        "rollupManifestDigest": rollup["manifestDigest"],
        "tables": rollup["tables"], "sourceRowCount": rollup["sourceRowCount"],
        "sourceTotals": rollup["sourceTotals"],
        "matchedTotals": rollup["matchedTotals"],
        "unassignedTotals": rollup["unassignedTotals"],
        "authorityVerified": False, "registeredRenderer": False,
        "netshopAdFinanceCombined": False,
        "historicalOwnershipVerified": False}
    manifest["manifestDigest"] = digest(manifest)
    return plan, sources, infos, keys, manifest, raw, native


class CrossSourceDailyColumnTests(TestCase):
    def test_shop_sku_refund_missing_date_zero_and_promotion_missing_sku(self):
        plan, sources, infos, keys, manifest, raw, native = fixture()
        value = service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
            "current", manifest, raw, native)
        self.assertEqual(value["schemaVersion"], service.SCHEMA)
        self.assertEqual(len(value["shopDayRows"]), 2)
        first, second = value["shopDayRows"]
        self.assertEqual(first["erpSales"]["netSalesCents"], 155)
        self.assertEqual(first["erpSales"]["refundCents"], 30)
        self.assertEqual(first["erpUnassigned"]["netSalesCents"], 55)
        self.assertEqual(first["netshopSku"]["paymentCents"], 0)
        self.assertEqual(first["netshopSku"]["productDayVisitors"], 3)
        self.assertEqual(first["netshopSpuNative"]["paymentCents"], 70)
        self.assertEqual(first["promotion"]["spendCents"], 20)
        self.assertIsNone(second["netshopSku"]["paymentCents"])
        self.assertEqual(second["sourceDayStatus"]["netshopSku"], "date_not_covered")
        self.assertIsNone(second["erpSales"]["netSalesCents"])
        self.assertFalse(value["shopUniqueVisitorsAvailable"])
        self.assertFalse(value["crossDomainAmountsAdded"])
        missing = [row for row in value["skuDayRows"] if row["skuId"] is None]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["promotion"]["spendCents"], 5)
        self.assertIsNone(missing[0]["erpMatched"]["netSalesCents"])
        self.assertEqual(value["materialDigest"], digest({k:v for k,v in value.items()
            if k != "materialDigest"}))

    def test_cross_store_window_report_root_and_duplicate_pages_reject(self):
        plan, sources, infos, keys, manifest, raw, native = fixture()
        bad_sources = deepcopy(sources)
        next(s for s in bad_sources if s["key"] == "netshopSku")["query"]["shop"] = "另一店"
        with self.assertRaises(AnalysisContractError):
            service.prepare_candidate(plan, bad_sources, infos, CONTEXT, keys,
                "current", manifest, raw, native)
        for changed in ({"reportBinding": {**manifest["reportBinding"],
                    "reportId": "other-report"}},
                {"salesKey": "netshopSku"}, {"pairKey": "0"*64}):
            wrong = deepcopy(manifest); wrong.update(changed)
            wrong["manifestDigest"] = digest({k:v for k,v in wrong.items()
                if k != "manifestDigest"})
            with self.assertRaises(AnalysisContractError):
                service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
                    "current", wrong, raw, native)
        repeated = deepcopy(native)
        repeated["promotion"][0]["items"].append(
            deepcopy(repeated["promotion"][0]["items"][0]))
        repeated["promotion"][0]["pageEvidence"].update(
            rowCount=3, sha256=digest(repeated["promotion"][0]["items"]))
        with self.assertRaises(AnalysisContractError):
            service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
                "current", manifest, raw, repeated)
        wrong_window = deepcopy(native)
        wrong_window["netshopSku"][0]["filters"]["window"] = "previous"
        with self.assertRaises(AnalysisContractError):
            service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
                "current", manifest, raw, wrong_window)

    def test_missing_baseline_source_is_null_not_zero(self):
        plan, sources, infos, keys, _, _, _ = fixture()
        value = service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
            "yearAgo", None, None, {})
        self.assertEqual(value["sourceKeys"], {family: None
            for family in cross_source_kpi_plan.FAMILIES})
        self.assertTrue(all(row["sourceDayStatus"]["promotion"] == "missing_source"
            and row["promotion"]["spendCents"] is None
            and row["erpSales"]["netSalesCents"] is None
            for row in value["shopDayRows"]))
        self.assertEqual(value["skuDayRows"], [])

    def test_rehashed_erp_amount_cannot_break_source_conservation(self):
        plan, sources, infos, keys, manifest, raw, native = fixture()
        wrong = deepcopy(raw)
        rows = [json.loads(line) for line in b"".join(wrong["shop_day"]).splitlines()]
        rows[0]["metrics"]["netSalesCents"] += 1
        blob = b"".join((json.dumps(row, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"))+"\n").encode() for row in rows)
        wrong["shop_day"] = [blob]
        changed = deepcopy(manifest)
        spec = changed["tables"][0]
        spec["ndjsonBytes"] = len(blob)
        spec["ndjsonSha256"] = hashlib.sha256(blob).hexdigest()
        changed["manifestDigest"] = digest({k:v for k,v in changed.items()
            if k != "manifestDigest"})
        with self.assertRaises(AnalysisContractError):
            service.prepare_candidate(plan, sources, infos, CONTEXT, keys,
                "current", changed, wrong, native)
