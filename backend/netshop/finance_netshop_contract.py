"""Pure closed finance wire validation; no queries, grants or producer imports.

Native amounts/progress stay owner-produced. The consumer verifies their source
presence annotations and exact identity, rather than trusting legacy defaults.
"""
import json
import math
import re

METRICS = ("grossSalesCents", "returnAmountCents", "netSalesCents", "netCostCents", "grossProfitCents",
           "grossMarginBps", "returnRateBps", "sellingExpenseCents", "smallProfitCents", "smallMarginBps",
           "otherExpenseCents", "profitCents", "profitMarginBps", "promotionExpenseCents", "promotionFeeRatioBps")
FIELDS = {"gross_margin", "gross_profit", "gross_sales", "net_cost", "net_sales", "other_expense_total",
          "profit", "profit_margin", "return_amount", "selling_expense_total", "small_margin", "small_profit"}
AMOUNTS = {"grossSalesCents": "gross_sales", "returnAmountCents": "return_amount", "netSalesCents": "net_sales",
           "netCostCents": "net_cost", "grossProfitCents": "gross_profit", "sellingExpenseCents": "selling_expense_total",
           "smallProfitCents": "small_profit", "otherExpenseCents": "other_expense_total"}
SEMANTICS = {"monthlyBasis": "finance_month", "annualProgressBasis": "finance_year_progress",
             "targetBasis": "finance_year_target", "nativeRatioUnit": "BASIS_POINT",
             "netshopIdentityMapping": "unverified", "dailyAllocation": False, "distributedSnapshot": False}
MAX_SAFE = 9_007_199_254_740_991
MONTH = re.compile(r"(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])")
TARGET_FIELDS = {"id", "periodType", "periodKey", "platform", "shopName", "category", "manager",
                 "salesTargetCents", "profitTargetCents", "grossMarginBps", "smallMarginBps",
                 "inventoryCleanupTargetCents", "promotionFeeRatioBps", "stagnantInventoryTargetCents",
                 "version", "createdAt", "updatedAt"}
TARGET_TOTALS = {"salesTargetCents", "profitTargetCents", "smallMarginBps", "inventoryCleanupTargetCents",
                 "promotionFeeRatioBps", "stagnantInventoryTargetCents", "targetCount"}


def require(valid):
    if not valid:
        raise ValueError("Invalid closed finance wire contract")


def closed(value, keys):
    require(type(value) is dict and set(value) == set(keys))
    return value


def integer(value, minimum=-MAX_SAFE):
    return type(value) is int and minimum <= value <= MAX_SAFE


def text(value):
    return type(value) is str and len(value) <= 1000


def nullable_number(value):
    return value is None or type(value) in {int, float} and math.isfinite(value) and (type(value) is not int or abs(value) <= MAX_SAFE)


def strings(value, maximum, pattern=None):
    return type(value) is list and len(value) <= maximum and all(type(v) is str and (pattern is None or pattern.fullmatch(v)) for v in value) and len(set(value)) == len(value)


def pair(key):
    require(type(key) is str)
    value = json.loads(key)
    require(type(value) is list and len(value) == 2 and all(type(v) is str and v and v == v.strip() and len(v) <= 100
            and not re.search(r"[\x00-\x1f\x7f]", v) for v in value))
    require(json.dumps(value, ensure_ascii=False, separators=(",", ":")) == key)
    return value


def metrics(value):
    require(all(integer(v) for v in closed(value, METRICS).values()))


def shift_month(month, delta):
    index = int(month[:4]) * 12 + int(month[5:]) - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def target(value):
    closed(value, TARGET_FIELDS)
    for key, number in value.items():
        require(integer(number) if key.endswith("Cents") or key.endswith("Bps") or key == "version" else text(number))


def pagination(value, returned=None):
    closed(value, {"total", "returned", "truncated"})
    require(integer(value["total"], 0) and integer(value["returned"], 0) and value["returned"] <= value["total"]
            and type(value["truncated"]) is bool and (returned is None or value["returned"] == returned))


def progress(value):
    closed(value, {"sales", "profit", "smallMarginGapBps", "promotionFeeGapBps"})
    require(all(nullable_number(v) for v in value.values()))


def native_monthly(value, months, keys):
    closed(value, {"hasData", "months", "monthPagination", "selectedMonth", "selectedMonths", "periodLabel",
        "previousMonth", "previousMonths", "yearAgoMonth", "yearAgoMonths", "current", "previous", "yearAgo", "yearToDate",
        "timeline", "targets", "progress", "expenses", "expensePagination", "shops", "shopPagination", "anomalies",
        "filters", "selection", "sync"})
    require(bool(months) and bool(keys) and value["hasData"] is True and value["selectedMonths"] == months
            and type(value["selectedMonth"]) is str and value["selectedMonth"] == months[-1] and text(value["periodLabel"]))
    for kind in ("previous", "yearAgo"):
        periods = value[kind + "Months"]
        require(strings(periods, 24, MONTH) and (value[kind] is None) == (not periods))
        require(value[kind + "Month"] == (periods[0] if len(periods) == 1 else None))
        if value[kind] is not None: metrics(value[kind])
    metrics(value["current"]); metrics(value["yearToDate"])
    selection = closed(value["selection"], {"allMonths", "truncated", "availableMonthCount", "months",
        "requestedMonths", "fallbackApplied", "platforms", "shops"})
    require(selection["allMonths"] is False and selection["truncated"] is False and selection["fallbackApplied"] is False
            and selection["shops"] == keys and selection["months"] == months and selection["requestedMonths"] == months
            and integer(selection["availableMonthCount"], 0) and strings(selection["platforms"], 50))
    require(type(value["months"]) is list and len(value["months"]) <= 144)
    for row in value["months"]:
        closed(row, {"month", "fileName", "importedAt", "shopCount", "subjectCount"})
        require(type(row["month"]) is str and MONTH.fullmatch(row["month"]) and text(row["fileName"]) and text(row["importedAt"])
                and integer(row["shopCount"], 0) and integer(row["subjectCount"], 0))
    available = [row["month"] for row in value["months"]]
    require(available == sorted(set(available)) and all(m in available for m in months))
    for kind, candidates in (("previous", [shift_month(months[0], i - len(months)) for i in range(len(months))]),
                             ("yearAgo", [shift_month(m, -12) for m in months])):
        require(value[kind + "Months"] == (candidates if all(m in available for m in candidates) else []))
    sync = closed(value["sync"], {"dataCutoffMonth", "sourceFileName", "importedAt"})
    require(sync["dataCutoffMonth"] == months[-1] and text(sync["sourceFileName"]) and text(sync["importedAt"]))
    require(type(value["shops"]) is list and len(value["shops"]) <= 500)
    seen = set()
    for row in value["shops"]:
        closed(row, {"name", "key", "groupName", "manager", "actual", "target", "progress"})
        require(type(row["key"]) is str and row["key"] in keys and row["key"] not in seen
                and pair(row["key"]) == [row["groupName"], row["name"]] and text(row["manager"]))
        seen.add(row["key"]); metrics(row["actual"]); progress(row["progress"])
        require(all(integer(v) for v in closed(row["target"], TARGET_TOTALS).values()) and integer(row["target"]["targetCount"], 0))
    require(type(value["timeline"]) is list and len(value["timeline"]) <= 24)
    for row in value["timeline"]:
        closed(row, {*METRICS, "month"}); require(type(row["month"]) is str and MONTH.fullmatch(row["month"]))
        metrics({k: row[k] for k in METRICS})
    require([r["month"] for r in value["timeline"]] ==
            ([m for m in available if m <= months[-1]][-24:] if len(months) == 1 else months))
    targets = closed(value["targets"], {"month", "year", "projects", "projectPagination", "periodPagination", "legacyCompatibility"})
    for kind in ("month", "year"):
        require(all(integer(v) for v in closed(targets[kind], TARGET_TOTALS).values()) and integer(targets[kind]["targetCount"], 0))
    require(type(targets["projects"]) is list and len(targets["projects"]) <= 100)
    for row in targets["projects"]: target(row)
    pagination(targets["projectPagination"], len(targets["projects"])); pagination(targets["periodPagination"])
    legacy = closed(targets["legacyCompatibility"], {"excluded", "reason"})
    require(integer(legacy["excluded"], 0) and text(legacy["reason"]))
    for value_progress in closed(value["progress"], {"month", "year"}).values(): progress(value_progress)
    require(type(value["expenses"]) is list and len(value["expenses"]) <= 1000)
    for row in value["expenses"]:
        closed(row, {"name", "current", "previous", "yearAgo", "sortOrder", "feeRateBps", "yearAgoFeeRateBps",
                     "momRate", "yoyRate", "abnormal"})
        require(text(row["name"]) and integer(row["current"]) and integer(row["sortOrder"], 0) and integer(row["feeRateBps"])
                and all(nullable_number(row[k]) for k in ("previous", "yearAgo", "yearAgoFeeRateBps", "momRate", "yoyRate"))
                and type(row["abnormal"]) is bool)
    require(type(value["anomalies"]) is list and len(value["anomalies"]) <= 20)
    for row in value["anomalies"]:
        closed(row, {"level", "title", "detail"})
        require(type(row["level"]) is str and row["level"] in {"info", "warning", "critical"} and text(row["title"]) and text(row["detail"]))
    filters = closed(value["filters"], {"platforms", "shops", "pagination"})
    require(strings(filters["platforms"], 100) and type(filters["shops"]) is list and len(filters["shops"]) <= 550)
    for row in filters["shops"]:
        closed(row, {"key", "platform", "name"}); require(pair(row["key"]) == [row["platform"], row["name"]])
    for kind, length in (("platforms", len(filters["platforms"])), ("shops", len(filters["shops"]))):
        pagination(closed(filters["pagination"], {"platforms", "shops"})[kind], length)
    pagination(value["monthPagination"], len(value["months"]))
    pagination(value["expensePagination"], len(value["expenses"]))
    pagination(value["shopPagination"], len(value["shops"]))


def month_evidence(values, expected=None):
    require(type(values) is list and len(values) <= 120)
    for row in values:
        closed(row, {"month", "status", "batchRef", "metadataVerified"})
        require(type(row["month"]) is str and MONTH.fullmatch(row["month"]) and type(row["status"]) is str
                and row["status"] in {"completed", "processing", "absent", "failed"}
                and (row["batchRef"] is None or type(row["batchRef"]) is str) and type(row["metadataVerified"]) is bool
                and (not row["metadataVerified"] or row["status"] == "completed" and bool(row["batchRef"])))
    names = [row["month"] for row in values]
    require(names == sorted(set(names)) and (expected is None or names == expected))
    return values


def metric_states(states, native, evidence, months, meta):
    closed(states, METRICS)
    selected = [e for e in evidence if e["month"] in months]
    completed = {m["month"] for m in meta if m["status"] == "completed"}
    verified = {m["month"] for m in meta if m["metadataVerified"]}
    def present(row, field):
        value = row["fields"][field]
        return value["rows"] > 0 and value["rows"] == value["amountPresent"]
    for key in METRICS:
        value = closed(states[key], {"value", "unit", "status", "reasonCode"})
        require(type(value["unit"]) is str and value["unit"] == ("BASIS_POINT" if key.endswith("Bps") else "CNY_CENT"))
        valid = all(present(row, AMOUNTS[key]) for row in selected) if key in AMOUNTS else (
            all(present(row, "profit") for row in selected) or all(row["fields"]["profit"]["rows"] == 0
                and present(row, "small_profit") and present(row, "other_expense_total") for row in selected)) if key == "profitCents" else False
        reason = None if native is not None and all(m in verified for m in months) and valid else "missing_month" if any(m not in completed for m in months) else "unverified_source" if any(m not in verified for m in months) else "missing_field" if native is not None else "no_records"
        if native is not None and key not in AMOUNTS and key != "profitCents": reason = "unverified_source"
        require(type(value["status"]) is str and value["status"] == ("available" if reason is None else "unavailable")
                and (value["reasonCode"] is None if reason is None else type(value["reasonCode"]) is str and value["reasonCode"] == reason))
        expected = native[key] if reason is None else None
        require(value["value"] is None if expected is None else integer(value["value"]) and value["value"] == expected)


def validate_finance_body(data, spec, revision):
    require(len(json.dumps({"operation": "netshop_finance_read_v1", "data": data}, ensure_ascii=False,
                           allow_nan=False).encode()) <= 2 * 1024 * 1024)
    closed(data, {"schemaVersion", "operation", "scopeKey", "snapshotToken", "requestedScope", "sourceRevisions",
                  "monthly", "annual", "metricSemantics", "limitations"})
    require(data["schemaVersion"] == "finance-netshop-read-v1" and data["operation"] == "netshop_finance_read_v1")
    require(all(type(data[k]) is str and re.fullmatch(r"[a-f0-9]{64}", data[k]) for k in ("scopeKey", "snapshotToken")))
    require(data["requestedScope"] == {k: spec[k] for k in ("shopKeys", "months", "year")})
    require(type(revision) is str and re.fullmatch(r"(?:0|[1-9]\d*):[a-f0-9]{12}", revision)
            and data["sourceRevisions"] == [{"domain": "finance", "kind": "owning_revision", "scopeKey": data["scopeKey"], "revision": revision}])
    semantics = closed(data["metricSemantics"], SEMANTICS)
    require(all(type(semantics[k]) is type(v) and semantics[k] == v for k, v in SEMANTICS.items()))
    monthly = closed(data["monthly"], {"state", "reasonCode", "actualMonths", "effectiveShopKeys", "data", "monthEvidence",
        "fieldEvidence", "comparisonMonthEvidence", "currentMetricStates", "comparisonMetricStates"})
    meta = month_evidence(monthly["monthEvidence"], spec["months"])
    related = month_evidence(monthly["comparisonMonthEvidence"])
    require(strings(monthly["actualMonths"], 24, MONTH) and monthly["actualMonths"] == [m["month"] for m in meta if m["status"] == "completed"]
            and strings(monthly["effectiveShopKeys"], 50) and all(k in spec["shopKeys"] for k in monthly["effectiveShopKeys"]))
    fields, seen = monthly["fieldEvidence"], set()
    require(type(fields) is list and len(fields) == len(spec["shopKeys"]) * len(related))
    for row in fields:
        closed(row, {"shopKey", "month", "fields"})
        require(type(row["shopKey"]) is str and row["shopKey"] in spec["shopKeys"] and type(row["month"]) is str
                and row["month"] in [r["month"] for r in related] and (row["shopKey"], row["month"]) not in seen)
        seen.add((row["shopKey"], row["month"]))
        for value in closed(row["fields"], FIELDS).values():
            closed(value, {"rows", "amountPresent", "ratePresent"})
            require(all(integer(v, 0) for v in value.values()) and value["amountPresent"] <= value["rows"] and value["ratePresent"] <= value["rows"])
    known = [k for k in spec["shopKeys"] if any(e["shopKey"] == k and e["month"] in monthly["actualMonths"]
             and any(f["rows"] for f in e["fields"].values()) for e in fields)]
    require(monthly["effectiveShopKeys"] == known)
    native = monthly["data"]
    require(type(monthly["state"]) is str and monthly["state"] == ("ready" if native is not None else "unavailable")
            and (monthly["reasonCode"] is None if native is not None else monthly["reasonCode"] == "no_scope_records"))
    if native is not None: native_monthly(native, monthly["actualMonths"], known)
    else: require(not known)
    related_months = sorted(set(spec["months"] + (native["previousMonths"] + native["yearAgoMonths"]
        + [r["month"] for r in native["timeline"]] if native else [])))
    require([m["month"] for m in related] == related_months)
    metric_states(monthly["currentMetricStates"], native["current"] if native else None, fields, spec["months"], meta)
    comparisons = closed(monthly["comparisonMetricStates"], {"previous", "yearAgo"})
    for kind in ("previous", "yearAgo"):
        metric_states(comparisons[kind], native[kind] if native else None, fields, native[kind + "Months"] if native else [], related)
    annual = closed(data["annual"], {"state", "reasonCode", "data", "rateFieldsVerification"})
    require(annual["rateFieldsVerification"] == {"grossMarginBps": "unverified_source", "promotionFeeRatioBps": "unverified_source"})
    if annual["state"] == "dependency_pending":
        require(type(annual["state"]) is str and annual["data"] is None and annual["reasonCode"] == "annual_exact_scope_provider_pending")
    else:
        require(type(annual["state"]) is str and annual["state"] == "ready" and annual["reasonCode"] is None)
        value = closed(annual["data"], {"year", "cutoffMonth", "availableMonths", "missingMonths", "items", "pagination"})
        require(type(value["year"]) is str and value["year"] == spec["year"]
                and (value["cutoffMonth"] is None or type(value["cutoffMonth"]) is str and MONTH.fullmatch(value["cutoffMonth"]) and value["cutoffMonth"].startswith(spec["year"]))
                and strings(value["availableMonths"], 12, MONTH) and strings(value["missingMonths"], 12, MONTH)
                and all(m.startswith(spec["year"]) for m in value["availableMonths"])
                and type(value["items"]) is list and len(value["items"]) <= len(spec["shopKeys"]))
        available = value["availableMonths"]
        require(available == sorted(available) and value["cutoffMonth"] == (available[-1] if available else None))
        expected_months = [f'{spec["year"]}-{i:02d}' for i in range(1, int(value["cutoffMonth"][5:]) + 1)] if available else []
        require(value["missingMonths"] == [m for m in expected_months if m not in available])
        keys = set()
        for row in value["items"]:
            closed(row, {"key", "platform", "shopName", "manager", "target", "netSalesCents", "profitCents", "salesProgress",
                "profitProgress", "grossMarginBps", "grossMarginGapBps", "promotionFeeRatioBps", "promotionFeeGapBps",
                "availableMonths", "missingMonths", "missingGrossMarginMonths"})
            require(type(row["key"]) is str and row["key"] in spec["shopKeys"] and row["key"] not in keys
                    and pair(row["key"]) == [row["platform"], row["shopName"]] and text(row["manager"])
                    and strings(row["availableMonths"], 12, MONTH) and strings(row["missingMonths"], 12, MONTH)
                    and strings(row["missingGrossMarginMonths"], 12, MONTH))
            keys.add(row["key"])
            require(row["availableMonths"] == sorted(row["availableMonths"])
                    and all(m in available for m in row["availableMonths"])
                    and row["missingMonths"] == [m for m in expected_months if m not in row["availableMonths"]]
                    and all(m in expected_months for m in row["missingGrossMarginMonths"]))
            for key in ("netSalesCents", "profitCents", "grossMarginBps", "grossMarginGapBps", "promotionFeeRatioBps", "promotionFeeGapBps"):
                require(row[key] is None or integer(row[key]))
            require((row["netSalesCents"] is None) == (not row["availableMonths"]) and (row["profitCents"] is None) == (not row["availableMonths"]))
            goal = row["target"]
            if goal is not None:
                target(goal); require(goal["periodType"] == "year" and goal["periodKey"] == spec["year"]
                    and goal["platform"] == row["platform"] and goal["shopName"] == row["shopName"] and goal["category"] == "")
            for key, amount_key, target_key in (("salesProgress", "netSalesCents", "salesTargetCents"), ("profitProgress", "profitCents", "profitTargetCents")):
                expected = row[amount_key] / goal[target_key] if goal and goal[target_key] > 0 and row[amount_key] is not None else None
                require(row[key] is None if expected is None else type(row[key]) in {int, float} and type(row[key]) is not bool and math.isfinite(row[key]) and row[key] == expected)
        page = closed(value["pagination"], {"page", "pageSize", "total", "returned", "truncated"})
        require(all(type(page[k]) is int for k in ("page", "pageSize", "total", "returned")) and page["page"] == 1
                and page["pageSize"] == len(spec["shopKeys"]) and page["total"] == len(value["items"])
                and page["returned"] == len(value["items"]) and page["truncated"] is False)
    require(type(data["limitations"]) is list and len(data["limitations"]) <= 20 and all(text(v) for v in data["limitations"]))
    return data
