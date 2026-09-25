"""Bounded streaming measurement of supplied v4 JD promotion owning pages.

This verifies a complete, internally consistent page stream and measures its
actual canonical UTF-8 row/page envelope widths. It neither fetches pages nor
authenticates the source, tool audit, account, revision fence or HMAC. The
result is never an admission, seal, Agent or report permission.
"""
from __future__ import annotations

import hashlib
import json
import re
import time

from . import evidence_v4, promotion_views
from .contracts import (AnalysisContractError, PageReconciler, canonical,
    comparison_periods, coverage, digest)


SCHEMA = "business-v4-jd-promotion-page-capacity-candidate-v1"
MAX_SECONDS = 600
MAX_PAGE_BYTES = evidence_v4.MAX_DAILY_PAGE_BYTES
MAX_PAGES = evidence_v4.MAX_SOURCE_PAGES
MAX_ROWS = MAX_PAGES * evidence_v4.MAX_ROWS_PER_PAGE
MAX_BYTES = evidence_v4.MAX_SOURCE_BYTES
PAGE_FIELDS = {"schemaVersion", "sourceRef", "sourceRevision", "filters",
    "source", "sourceDataset", "monetaryUnit", "consistency",
    "metricSemantics", "control", "coverage", "availableDates", "items",
    "pageEvidence", "pagination"}
SHA = re.compile(r"[0-9a-f]{64}\Z")


def _need(value, message="v4推广拥有方页容量候选不完整"):
    if not value:
        raise AnalysisContractError(message)


def _pairs(items):
    value = {}
    for key, item in items:
        _need(key not in value, "推广页含重复JSON键")
        value[key] = item
    return value


def _source(source):
    _need(type(source) is dict and set(source) == {"key", "domain", "query"}
        and type(source["key"]) is str
        and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", source["key"])
        and source["domain"] == "netshop"
        and type(source["query"]) is dict
        and set(source["query"]) == {"platform", "shop", "dataset",
            "startDate", "endDate", "window"},
        "仅支持精确京东推广日来源")
    query = source["query"]
    _need(query["platform"] == "京东" and query["dataset"] == "promotion"
        and query["window"] in {"current", "previous", "yearAgo"}
        and type(query["shop"]) is str and query["shop"] == query["shop"].strip()
        and 0 < len(query["shop"]) <= 100,
        "推广平台、店铺或窗口无效")
    periods = comparison_periods(query["startDate"], query["endDate"])
    _need(1 <= periods[query["window"]]["days"] <= 93)
    return json.loads(canonical(source)), periods


def measure_complete_pages(source, raw_pages, *, expected_row_count=None,
                           checkpoint=None, clock=time.monotonic):
    """Consume exactly one complete iterable of canonical owning-page bytes.

    Per-page allocation is bounded by 128 KiB. No source rows or raw pages are
    retained. A caller-supplied iterator is not platform/DB authority.
    """
    source, periods = _source(source)
    if expected_row_count is not None:
        _need(type(expected_row_count) is int and 0 <= expected_row_count <= MAX_ROWS,
              "预期来源行数不在v4容量内")
    _need(not isinstance(raw_pages, (bytes, str, dict)),
          "须提供逐页迭代器而非截断响应")
    started = clock()
    verifier = PageReconciler()
    page_count = row_count = stored_bytes = max_row_bytes = max_envelope = 0
    max_page_bytes = 0
    revision = reference = None
    metadata = None
    actual_dates = set()
    byte_chain = digest([])
    expected_filters = {key: source["query"][key]
        for key in ("platform", "shop", "dataset", "window")}
    expected_filters["periods"] = periods
    period = periods[source["query"]["window"]]
    for raw in raw_pages:
        _need(0 <= clock() - started < MAX_SECONDS,
              "v4完整页容量测量超过固定时间")
        if checkpoint is not None:
            checkpoint({"stage": "v4_promotion_capacity", "page": page_count + 1})
        _need(type(raw) is bytes and 1 <= len(raw) <= MAX_PAGE_BYTES,
              "推广页不是有界UTF-8原字节")
        page_count += 1
        stored_bytes += len(raw)
        _need(page_count <= MAX_PAGES and stored_bytes <= MAX_BYTES,
              "推广页数或总字节超过v4单来源上限")
        try:
            page = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs)
            _need(type(page) is dict and set(page) == PAGE_FIELDS
                  and canonical(page).encode("utf-8") == raw,
                  "推广页不是唯一规范JSON")
            _need(page["schemaVersion"] == promotion_views.SOURCE_SCHEMA
                  and page["source"] == "jd_promotion"
                  and page["sourceDataset"] == "ad"
                  and page["monetaryUnit"] == "CNY_CENT"
                  and page["filters"] == expected_filters
                  and type(page["sourceRef"]) is str
                  and SHA.fullmatch(page["sourceRef"]) is not None
                  and type(page["sourceRevision"]) is str
                  and 1 <= len(page["sourceRevision"]) <= 128,
                  "推广页精确身份、筛选或修订不同")
            pagination = page["pagination"]
            _need(type(pagination) is dict and set(pagination) ==
                  {"hasMore", "nextCursor", "limit"}
                  and pagination["limit"] == 100
                  and type(pagination["hasMore"]) is bool
                  and (pagination["nextCursor"] is None or
                       type(pagination["nextCursor"]) is str and
                       0 < len(pagination["nextCursor"]) <= 1600),
                  "推广页游标或固定页长无效")
            items = page["items"]
            _need(type(items) is list and len(items) <= 100
                  and type(page["pageEvidence"]) is dict and
                  set(page["pageEvidence"]) == {"sha256", "rowCount"},
                  "推广页行或证明字段无效")
            if page_count == 1:
                reference, revision = page["sourceRef"], page["sourceRevision"]
                control, declared = page["control"], page["coverage"]
                _need(type(control) is dict and set(control) ==
                    {"rowCount", "typedTotals", "note"}
                    and type(control["rowCount"]) is int
                    and 0 <= control["rowCount"] <= MAX_ROWS
                    and set(control["typedTotals"]) == promotion_views.BASE_METRICS
                    and type(declared) is dict
                    and declared == coverage(period, declared["presentDates"]),
                    "推广首页控制汇总或日期覆盖无效")
                metadata = {key: page[key] for key in ("metricSemantics",
                    "consistency", "availableDates", "coverage")}
            else:
                _need(page["sourceRef"] == reference
                    and page["sourceRevision"] == revision
                    and page["control"] is None
                    and page["coverage"] is None
                    and page["availableDates"] is None
                    and page["metricSemantics"] == metadata["metricSemantics"]
                    and page["consistency"] == metadata["consistency"],
                    "推广续页元信息或来源修订变化")
            for row in items:
                _need(type(row) is dict and set(row) == promotion_views.ROW_FIELDS
                    and row["platform"] == source["query"]["platform"]
                    and row["shopName"] == source["query"]["shop"]
                    and row["date"] in coverage(period, [row["date"]])["presentDates"]
                    and type(row["metrics"]) is dict
                    and set(row["metrics"]) == promotion_views.METRICS
                    and type(row["dimensions"]) is dict
                    and set(row["dimensions"]) == promotion_views.DIMENSIONS,
                    "推广行身份、日期或指标字段不同")
                actual_dates.add(row["date"])
                max_row_bytes = max(max_row_bytes,
                    len(canonical(row).encode("utf-8")))
            row_count += len(items)
            _need(row_count <= MAX_ROWS, "推广来源行数超过v4容量")
            item_array_bytes = len(canonical(items).encode("utf-8"))
            envelope = len(raw) - item_array_bytes + 2
            _need(0 < envelope <= MAX_PAGE_BYTES)
            max_envelope = max(max_envelope, envelope)
            max_page_bytes = max(max_page_bytes, len(raw))
            verifier.consume(page, request_cursor=verifier.expected_cursor)
            byte_chain = digest([byte_chain, hashlib.sha256(raw).hexdigest(),
                len(raw), page_count])
        except (UnicodeError, ValueError, TypeError, KeyError, OverflowError,
                RecursionError) as error:
            raise AnalysisContractError("推广页原文、行或连续证明无法测量") from error
    _need(page_count >= 1 and 0 <= clock() - started < MAX_SECONDS,
          "推广完整页缺失或测量超时")
    result = verifier.result()
    _need(result["rowCount"] == row_count
          and result["sourceRef"] == reference
          and metadata["coverage"] == coverage(period, actual_dates)
          and (expected_row_count is None or row_count == expected_row_count),
          "推广完整行数、控制汇总或日期覆盖不一致")
    query_digest = digest(source["query"])
    measurement = {"sourceKey": source["key"],
        "measuredRowCount": row_count, "maxRowUtf8Bytes": max_row_bytes,
        "pageEnvelopeUtf8Bytes": max_envelope,
        "sourceRevisionHint": revision}
    entry = {"key": source["key"], "ordinal": 1,
        "domain": "netshop", "temporalRole": "daily_fact",
        "query": source["query"], "queryDigest": query_digest}
    estimated = evidence_v4._estimate(entry,
        {**measurement, "sampleRowCount": 0, "sampleMaxUtf8Bytes": 0})
    undercount = (estimated["estimatedPageCount"] is None or
        estimated["estimatedPageCount"] < page_count or
        estimated["estimatedBytesUpperBound"] is None or
        estimated["estimatedBytesUpperBound"] < stored_bytes)
    candidate = {"schemaVersion": SCHEMA,
        "sourceKey": source["key"], "queryDigest": query_digest,
        "sourceRef": reference, "sourceRevision": revision,
        "pageCount": page_count, "rowCount": row_count,
        "storedBytes": stored_bytes,
        "maxRowUtf8Bytes": max_row_bytes,
        "maxPageEnvelopeUtf8Bytes": max_envelope,
        "maxActualPageBytes": max_page_bytes,
        "pageByteChainDigest": byte_chain,
        "controlEvidenceDigest": result["evidenceDigest"],
        "coverage": metadata["coverage"],
        "v4Measurement": measurement,
        "estimatedPageCount": estimated["estimatedPageCount"],
        "estimatedBytesUpperBound": estimated["estimatedBytesUpperBound"],
        "estimatedUnderstatesObserved": undercount,
        "withinV4SourceHardCaps": (page_count <= MAX_PAGES
            and row_count <= MAX_ROWS and stored_bytes <= MAX_BYTES),
        "capacityArithmeticSupported": (
            estimated["sourceCapacitySupported"] and not undercount),
        "completeSuppliedPageStreamReconciled": True,
        "owningSourceAuthorityVerified": False,
        "signedToolAuditVerified": False,
        "upstreamSignatureVerified": False,
        "productionRowWidthApprovalRequired": True,
        "sealerOrReportAuthorityGranted": False,
        "limitations": [
            "仅证明调用方提供的规范页链内部完整及实测字节；尚未证明这些页来自当前拥有方。",
            "缺签名工具审计、当前修订/账号及跨域源证明，不能据此封存或发布。",
            "实际页数/字节已核；v4公式估算若低于已见页数/字节则明确不支持，不截断。",
        ]}
    return {**candidate, "measurementDigest": digest(candidate)}
