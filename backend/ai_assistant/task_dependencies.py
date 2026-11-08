"""Pure dependency contract, fed only by trusted readers."""
from datetime import timedelta
from zoneinfo import ZoneInfo
from .policy import canonical, digest


def evaluate(spec, scheduled_at, snapshots):
    gaps, bindings = [], []
    for dependency in spec["dataDependencies"]:
        dataset = dependency["dataset"]
        value = snapshots.get(dataset)
        day = (scheduled_at.astimezone(ZoneInfo("Asia/Shanghai")).date()-timedelta(days=dependency["dayOffset"])).isoformat()
        if not isinstance(value, dict):
            gaps.append({"dataset": dataset, "reason": "source_coverage_not_proven" if dataset in snapshots else "trusted_reader_missing"})
            continue
        expected_scope = ({"warehousePolicy": "全部计入库存的仓"} if dataset == "inventory_included_warehouses" else spec["shopSelection"])
        missing = [field for field in dependency["requiredFields"] if field not in value.get("fields", []) or value.get(field) is None]
        if (value.get("dataset") != dataset or value.get("scope") != expected_scope or value.get("date") != day
                or value.get("complete") is not True or not isinstance(value.get("revision"), str) or not value["revision"] or missing):
            gaps.append({"dataset": dataset, "reason": "scope_date_coverage_revision_or_fields_incomplete", "missingFields": missing})
            continue
        bindings.append({"dataset": dataset, "date": day, "scope": expected_scope, "revision": value["revision"],
            "digest": digest(canonical(value)), **({"batchId": value["batchId"]} if "batchId" in value else {})})
    return {"ready": not gaps, "gaps": gaps, "bindings": bindings}
