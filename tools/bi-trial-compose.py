"""Compose only audited, local aggregate snapshots; no runtime DB or secrets."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
for key in list(os.environ):
    if key.startswith(("TERUISI_", "DJANGO_")): del os.environ[key]
os.environ.update(DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_DATABASE_URL="", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", PYTHONDONTWRITEBYTECODE="1")
import django
django.setup()
from bi.cockpit import goals
from bi.source_reader import _comparison
from netshop.bi_flow import _combined
from netshop.sales_client import CONTROLLED_JD_ALIASES

folder = ROOT / ".runtime" / "bi-live-audit"
records = []
for path in folder.glob("*.json"):
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(value, dict) and "data" in value and value.get("readOnly") is True: records.append(value)
records.sort(key=lambda value: value["capturedAt"])
sales = {}
for value in records:
    if value["source"] == "sales" and value["data"]["periods"]["current"]["startDate"] == "2026-09-01":
        if value.get("independentTotalsVerified") is not True: raise RuntimeError("Sales audit not independently verified")
        f = value["data"]["filters"]; sales[json.dumps([f["platform"], f["shop"]], ensure_ascii=False, separators=(",", ":"))] = value
def latest(source, condition=lambda _: True):
    found = [value for value in records if value["source"] == source and condition(value)]
    if not found: raise RuntimeError("Required owning snapshot missing: " + source)
    return found[-1]
all_sales = sales['["",""]']
inventory = latest("inventory")
operations = {str(int(mine)): latest("operations", lambda value: value["data"]["mine"] is mine) for mine in (False, True)}
flow = latest("flow", lambda value: value["data"].get("status") == "ready" and value["data"]["periods"]["current"]["startDate"] == "2026-09-01" and len(value["data"]["platforms"]) == 2)
prior = latest("flow", lambda value: value["data"].get("status") == "ready" and value["data"]["periods"]["current"] == flow["data"]["periods"]["previous"] and len(value["data"]["platforms"]) == 2)
if inventory["data"]["salesRevision"] != all_sales["revision"] or prior["revision"] != flow["revision"] or any(value["revision"] != all_sales["revision"] for value in sales.values()): raise RuntimeError("Snapshot revisions differ; recapture owning source")
flow_data = copy.deepcopy(flow["data"])
flow_data["summary"] = _combined([{"summary": item["metrics"]} for item in flow_data["platforms"]])
prior_data = prior["data"]
prior_summary = _combined([{"summary": item["metrics"]} for item in prior_data["platforms"]])
flow_data["comparisons"] = _comparison(flow_data["summary"], prior_summary)
for collection in ("platforms", "shops"):
    for row in flow_data[collection]:
        identity = lambda item: (item["platform"], item.get("shopName"))
        old = next((item for item in prior_data[collection] if identity(item) == identity(row)), None)
        row["comparisons"] = _comparison(row["metrics"], old["metrics"] if old else {})
targets = {"source": "targets", "status": "unavailable", "revision": None, "reasonCode": "candidate_target_configuration_not_deployed", "data": None}
def source(name, value): return {"source": name, "status": "ready", "revision": value["revision"], "data": value["data"]}
cases = {}
options = [item for item in all_sales["data"]["options"] if json.dumps([item["platform"], item["shop"]], ensure_ascii=False, separators=(",", ":")) in sales]
for key, value in sales.items():
    erp = copy.deepcopy(value["data"]); erp["options"] = options
    vector = {"salesErp": value["revision"], "inventory": inventory["revision"], "operations": operations["0"]["revision"], "flow": flow["revision"], "targets": None}
    cases[key] = {"contractVersion": "bi-cockpit-v1", "projection": "cockpit", "revision": hashlib.sha256(key.encode()).hexdigest(), "sourceRevisions": vector, "erp": erp, "goals": goals(erp, targets), "sources": {"targets": targets, "operations": source("operations", operations["0"]), "inventory": source("inventory", inventory), "flow": {"source": "flow", "status": "unavailable", "revision": None, "reasonCode": "deferred", "data": None}}, "limitations": ["本机真实只读聚合快照试用，非实时发布版；逐来源捕获时间不同", "目标配置尚未生产采用，不模拟已配置目标", "试用ERP筛选只提供已独立核对的范围，正式接口支持完整真实授权范围"]}
result = {"schemaVersion": "bi-audited-trial-v1", "cases": cases, "operations": {key: source("operations", value) for key, value in operations.items()}, "flow": flow_data, "priorFlow": prior_data, "flowRevision": flow["revision"], "erpStoreBindings": {pair[0]: name for name, pair in CONTROLLED_JD_ALIASES.items()}, "captureTimes": {"sales": all_sales["capturedAt"], "operations": operations["0"]["capturedAt"], "inventory": inventory["capturedAt"], "flow": flow["capturedAt"]}, "productionTouched": False}
destination = folder / "trial-aggregate.json"
destination.write_text(json.dumps(result, ensure_ascii=False), encoding="utf8")
print(json.dumps({"output": str(destination), "cases": len(cases), "erpShopOptions": len(options), "sources": list(result["captureTimes"]), "productionTouched": False}, ensure_ascii=True))
