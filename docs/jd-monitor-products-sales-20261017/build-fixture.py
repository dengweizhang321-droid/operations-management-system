"""Synthetic projections for a file-only preview, using the actual backend."""
import gzip
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
environment = {key: value for key, value in os.environ.items() if key.upper() in {
    "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE",
    "LOCALAPPDATA", "APPDATA", "PROGRAMFILES",
}}
os.environ.clear()
os.environ.update(environment, PYTHONUTF8="1", TERUISI_DJANGO_SQLITE_PATH=":memory:",
                  TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
                  DJANGO_DEBUG="true", DJANGO_SETTINGS_MODULE="teruisi_backend.settings")
import django
django.setup()
from django.conf import settings
settings.DATABASES["default"]["NAME"] = ":memory:"
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from inventory import jd_logistics as service
from inventory.jd_logistics_models import JdLogisticsFact
from inventory.tests.test_jd_monitor_preferences import MonitorPreferencesTests

assert connection.vendor == "sqlite" and connection.settings_dict["NAME"] == ":memory:"
MigrationExecutor(connection).migrate([("inventory", "0016_jd_product_monitoring")])
MonitorPreferencesTests().setUp()
for row in JdLogisticsFact.objects.filter(department_id="ONE", source_kind="inventory_snapshot"):
    row.data = {**row.data, "sourceAttributes": {"近3天销售出库件数": "3", "近15天销售出库件数": "15"}}
    row.save(update_fields=["data"])
options = service.options()
options["departments"] = [row for row in options["departments"] if row["id"] == "ONE"]
options["monitorWarehouses"] = [row for row in options["monitorWarehouses"] if row["departmentId"] == "ONE"]
options["departments"][0]["unmonitoredProductCodes"] = ["D"]
projections = {}
for window in (7, 30):
    rows = service.inventory_monitor({"departmentId": "ONE", "layout": "warehouse", "page": 1, "pageSize": 100, "salesWindow": window, "applyWarehousePreferences": False})["items"]
    for warehouse_mask in range(8):
        for product_mask in range(16):
            scoped = service._products_with_inventory_values([row for row in rows if warehouse_mask & (1 << (int(row["warehouseCode"][-1]) - 1)) and product_mask & (1 << "ABCD".index(row["goodsCode"]))])
            for health in service.HEALTH_FILTER_STATES:
                selected, counts, filter_counts = service._health_filter_scope(scoped, health)
                data = service._product_matrix(selected, {"page": 1, "pageSize": 25}, window)
                data.update(healthState=health, healthCounts=counts, healthFilterCounts=filter_counts,
                            summary={"monitoredCount": len(selected), "qualifiedCount": sum(row["qualified"] for row in selected), "stockoutRiskCount": 0},
                            coverageWarnings=["合成演示：商品D已取消监控并折叠；可添加/取消，展开查看来源3日和15日销量。"], notificationAvailable=False)
                projections[f"{warehouse_mask}:{product_mask}:{window}:{health}"] = data
target = ROOT / ".codex-tmp" / "jd-monitor-products-sales.json.gz"
target.parent.mkdir(exist_ok=True)
target.write_bytes(gzip.compress(json.dumps({"options": options, "projections": projections}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
print(f"Synthetic projections: {len(projections)}; compressed bytes: {target.stat().st_size}")
