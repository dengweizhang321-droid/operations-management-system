"""Generate only synthetic, RAM-backed projections for the standalone demo."""
import gzip
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
os.environ.pop("TERUISI_DJANGO_DATABASE_URL", None)
os.environ.update(TERUISI_DJANGO_SQLITE_PATH=":memory:", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_SETTINGS_MODULE="teruisi_backend.settings")
import django
django.setup()
from django.core.management import call_command
from django.db import connection
from inventory import jd_logistics as service
from inventory.tests.test_jd_monitor_preferences import MonitorPreferencesTests

assert connection.vendor == "sqlite" and str(connection.settings_dict["NAME"]) == ":memory:"
call_command("migrate", verbosity=0)
fixture = MonitorPreferencesTests()
fixture.setUp()
options = service.options()
options["departments"] = [row for row in options["departments"] if row["id"] == "ONE"]
options["monitorWarehouses"] = [row for row in options["monitorWarehouses"] if row["departmentId"] == "ONE"]
projections = {}
for window in (7, 30):
    rows = service.inventory_monitor({"departmentId": "ONE", "layout": "warehouse", "page": 1, "pageSize": 100, "salesWindow": window})["items"]
    for warehouse_mask in range(8):
        for product_mask in range(16):
            scoped = [row for row in rows if warehouse_mask & (1 << (int(row["warehouseCode"][-1]) - 1)) and product_mask & (1 << "ABCD".index(row["goodsCode"]))]
            for health in service.HEALTH_FILTER_STATES:
                selected, counts, filter_counts = service._health_filter_scope(scoped, health)
                data = service._product_matrix(selected, {"page": 1, "pageSize": 25}, window)
                data.update(healthState=health, healthCounts=counts, healthFilterCounts=filter_counts, summary={"monitoredCount": len(selected), "qualifiedCount": sum(row["qualified"] for row in selected), "stockoutRiskCount": 0}, coverageWarnings=["此文件仅包含合成演示数据；指标由隔离内存后台预计算。"], notificationAvailable=False)
                projections[f"{warehouse_mask}:{product_mask}:{window}:{health}"] = data
target = root / ".codex-tmp" / "jd-monitor-demo.json.gz"
target.parent.mkdir(exist_ok=True)
target.write_bytes(gzip.compress(json.dumps({"options": options, "projections": projections}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
print(f"Synthetic projections: {len(projections)}; compressed bytes: {target.stat().st_size}")
