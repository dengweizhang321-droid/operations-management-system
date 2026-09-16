"""Versioned report tables from complete evidence, never model arithmetic."""
from .aggregation import DimensionAccumulator
from .contracts import AnalysisContractError, PageReconciler, canonical, compare, digest

VIEWS = {"shop": ["shopName"], "category": ["category"], "spu": ["spuId"],
         "sku": ["skuId"], "keyword": ["keyword"], "searchTerm": ["searchTerm"], "daily": ["date"]}
RATE_METRICS = {"ctr", "orderLineConversionRate"}


def _group(pages, dimension, expected):
    verifier = PageReconciler()
    metrics = sorted(expected["metrics"])
    if not metrics:
        raise AnalysisContractError("身份主数据没有可加总经营指标")
    accumulator = DimensionAccumulator(VIEWS[dimension], metrics)
    header = None
    for page in pages:
        if header is None:
            header = {key: page.get(key) for key in ("filters", "source", "sourceDataset", "coverage", "metricSemantics")}
        elif any(page.get(key) != header[key] for key in ("filters", "source", "sourceDataset")):
            raise AnalysisContractError("来源页范围变化")
        scope = (header["filters"]["platform"], header["filters"]["shop"])
        if any((r["platform"], r["shopName"]) != scope for r in page["items"]):
            raise AnalysisContractError("来源包含其他店铺")
        verifier.consume(page, request_cursor=verifier.expected_cursor)
        accumulator.consume(page["items"])
    actual = verifier.result()
    if actual != expected:
        raise AnalysisContractError("分析结果与封存核对记录不一致")
    return header, accumulator.result(actual)["items"]


def _compatible(current, baseline):
    a, b = current["filters"], baseline["filters"]
    if (current["source"], current["sourceDataset"]) != (baseline["source"], baseline["sourceDataset"]):
        return False
    ignored = {"window", "limit"}
    return (a.get("window", "current") == "current" and b.get("window") in {"previous", "yearAgo"}
            and {k: v for k, v in a.items() if k not in ignored} == {k: v for k, v in b.items() if k not in ignored})


def build_table(pages, dimension, expected, *, baseline_pages=None, baseline_expected=None):
    if not isinstance(dimension, str) or dimension not in VIEWS:
        raise AnalysisContractError("分析表维度无效")
    header, current = _group(pages, dimension, expected)
    baseline, previous_header = [], None
    if baseline_pages is not None:
        if dimension == "daily":
            raise AnalysisContractError("日表不得按日期字符串直接比较不同期间")
        previous_header, baseline = _group(baseline_pages, dimension, baseline_expected)
        if not _compatible(header, previous_header):
            raise AnalysisContractError("比较来源、身份、口径或日期窗口不一致")
    complete_dates = bool(previous_header and all((h.get("coverage") or {}).get("status") == "dates_present" for h in (header, previous_header)))
    indexed = [{canonical(item["entity"]): item for item in rows} for rows in (current, baseline)]
    keys = sorted(set(indexed[0]) | set(indexed[1]))
    result = []
    for row_index, key in enumerate(keys):
        a, b = (index.get(key) for index in indexed)
        item = a or b
        metrics, rates, comparisons = {}, {}, {}
        for metric in sorted(set((a or {}).get("metrics", {})) | set((b or {}).get("metrics", {}))):
            left, right = (record["metrics"][metric] if record and metric in record["metrics"] else None for record in (a, b))
            metrics[metric] = left
            if previous_header:
                comparisons[metric] = compare(left["value"] if left else None, right["value"] if right else None,
                    comparable=complete_dates and bool(left and right and not left["missingRows"] and not right["missingRows"]))
        for metric in sorted(set((a or {}).get("ratios", {})) | set((b or {}).get("ratios", {}))):
            left, right = ((record or {}).get("ratios", {}).get(metric) for record in (a, b))
            rates[metric] = left
            if previous_header:
                comparisons[metric] = compare(left, right, comparable=complete_dates, is_rate=metric in RATE_METRICS)
        result.append({"id": digest([expected["evidenceDigest"], baseline_expected, dimension, item["entity"]]), "rowIndex": row_index,
            "entity": item["entity"], "currentRowCount": a["rowCount"] if a else None,
            "baselineRowCount": b["rowCount"] if b else None, "metrics": metrics, "ratios": rates,
            "baselineMetrics": b["metrics"] if b else None,
            "comparisons": comparisons, "dimensionMissing": any(item["entity"].get(d) is None for d in VIEWS[dimension])})
    return {"schemaVersion": "business-result-table-v1", "dimension": dimension, "source": expected,
        "baselineSource": baseline_expected, "sourceMetadata": header, "baselineMetadata": previous_header,
        "comparisonWindow": previous_header["filters"]["window"] if previous_header else None,
        "dateCoverageComparable": complete_dates, "total": len(result), "rows": result,
        "limitations": ["缺失分组不补零，缺日或字段缺失不计算增长率", "店铺表为所选来源金额汇总，不是跨源相加或店铺去重UV",
            "关键词与搜索词分开，原生SPU不等于SKU映射，空身份单独保留", "数据日期存在不证明结算完成或因果关系"]}
