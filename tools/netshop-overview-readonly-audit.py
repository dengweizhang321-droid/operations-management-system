"""Local owning reader audit. Password supplied only through child environment.

Uses the existing minimum netshop reader, a read-only repeatable-read
transaction and a 7s per-statement bound. Writes only aggregate evidence to
the isolated worktree; never facts, credentials, or customer records.
"""
import json
import os
from pathlib import Path
import sys
import time
import secrets
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
os.environ["DJANGO_SECRET_KEY"] = secrets.token_hex(48)
os.environ["TERUISI_DJANGO_INTERNAL_SECRET"] = secrets.token_hex(48)
import django
django.setup()
from django.db import connection, transaction
from django.http import QueryDict
from sales.auth import Principal
from netshop.store_overview import read, validate
from netshop.models import NetshopImportBatch
from django.utils import timezone

if connection.vendor != "postgresql" or connection.settings_dict["USER"] != "teruisi_netshop_reader" or connection.settings_dict["HOST"] != "127.0.0.1" or str(connection.settings_dict["PORT"]) != "5432":
    raise RuntimeError("Audit requires the existing loopback minimum netshop reader")
output = ROOT / "docs/evidence/netshop-overview-01-local-data-20260930.json"
if "--metadata" in sys.argv:
    with transaction.atomic():
        with connection.cursor() as c:
            c.execute("SET TRANSACTION READ ONLY")
            c.execute("SET LOCAL statement_timeout='7s'")
            c.execute("SELECT shop_name, COUNT(*) AS total, COUNT(*) FILTER (WHERE sku_id <> '') AS eligible, SUM(spend_cents) FILTER (WHERE sku_id = '') AS excluded_spend, SUM(net_transaction_amount_cents) FILTER (WHERE sku_id = '') AS excluded_payment FROM netshop_rows WHERE source=%s AND dataset=%s AND business_date >= %s AND business_date < %s GROUP BY shop_name", ["jd_promotion", "ad", "2026-09-01", "2026-09-30"])
            print(json.dumps(c.fetchall(), ensure_ascii=False))
        transaction.set_rollback(True)
    sys.exit(0)
evidence = {"source": "authorized-local-readonly-postgresql-fallback", "auditedAt": timezone.now().isoformat(), "productionWrites": False, "schemaChanges": False, "requestScope": "2026-09-01 through 2026-09-29, exact platform + shop keys", "platforms": []}
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = '7s'")
        cursor.execute("SHOW transaction_read_only")
        if cursor.fetchone()[0] != "on": raise RuntimeError("Read-only transaction gate failed")
        evidence["transactionReadOnly"] = True
    for platform in ["天猫", "京东"]:
        started = time.perf_counter()
        params = QueryDict(urlencode({"platform": platform, "startDate": "2026-09-01", "endDate": "2026-09-29", "previous": "1", "yearAgo": "1"}))
        plans = []
        def explain_query(execute, sql, params, many, context):
            if sql.startswith("SELECT") and "SUM(" in sql:
                with connection.cursor() as explain_cursor:
                    explain_cursor.execute("EXPLAIN (FORMAT JSON) " + sql, params)
                    plan = explain_cursor.fetchone()[0]
                plans.append({"sql": sql, "plan": plan})
                (ROOT / ".runtime/preview/overview-plans.json").write_text(json.dumps(plans, indent=2), encoding="utf-8")
            return execute(sql, params, many, context)
        with connection.execute_wrapper(explain_query):
            result = read(Principal("local-readonly-audit@teruisi.local", "Read-only audit", "admin", None), validate(params))
        reader_elapsed = round(time.perf_counter()-started, 3)
        latest = list(NetshopImportBatch.objects.filter(platform=platform, status="completed", source__in=[f["sourceId"] for f in result["freshness"]]).order_by("-completed_at").values("id", "source", "dataset", "platform", "shop_name", "date_min", "date_max", "row_count", "content_hash", "published_state_token")[:20])
        with connection.cursor() as cursor:
            # Independent control totals, source field existence and exact date
            # enumerations. No raw_json or customer data leaves the database.
            cursor.execute("""SELECT r.source, r.dataset, r.platform, r.shop_name,
                MIN(r.business_date) AS first_date, MAX(r.business_date) AS last_date, COUNT(*) AS row_count, COUNT(DISTINCT r.business_date) AS day_count,
                SUM(r.transaction_amount_cents) AS payment_cents, SUM(r.visitors) AS visitors, SUM(r.transaction_customers) AS customers, SUM(r.spend_cents) AS spend_cents, SUM(r.net_transaction_amount_cents) AS promotion_payment_cents,
                ARRAY_AGG(DISTINCT r.business_date ORDER BY r.business_date) AS dates
                FROM netshop_rows r JOIN netshop_import_batches b ON b.id=r.last_import_batch_id AND b.status='completed'
                WHERE r.platform=%s AND r.business_date >= %s AND r.business_date < %s AND r.source IN (%s,%s)
                GROUP BY r.source,r.dataset,r.platform,r.shop_name ORDER BY r.source,r.dataset,r.shop_name""", [platform, "2026-09-01", "2026-09-30", *[f["sourceId"] for f in result["freshness"]]])
            columns = [d.name for d in cursor.description]
            controls = [dict(zip(columns, row)) for row in cursor.fetchall()]
        item = {"platform": platform, "readerElapsedSeconds": reader_elapsed, "elapsedSeconds": round(time.perf_counter()-started, 3), "overviewToken": result["overviewToken"], "sourceRevisions": result["sourceRevisions"], "periods": result["periods"], "freshness": result["freshness"], "coverageBySource": result["coverageBySource"], "summary": result["summary"], "comparisons": result["comparisons"], "shops": result["shops"], "sourceBatchEvidence": latest, "independentControls": controls}
        product_source = result["freshness"][0]["sourceId"]
        expected_dataset = "sku_daily" if platform == "京东" else "spu_daily"
        selected = [c for c in controls if c["source"] == product_source and c["dataset"] == expected_dataset]
        item["paymentReconciled"] = result["summary"]["payment"]["value"] == sum(c["payment_cents"] or 0 for c in selected)
        item["visitorsReconciled"] = result["summary"]["visitors"]["value"] == sum(c["visitors"] or 0 for c in selected)
        item["customersReconciled"] = result["summary"]["customers"]["value"] == sum(c["customers"] or 0 for c in selected)
        promotion_selected = [c for c in controls if c["source"] == result["freshness"][1]["sourceId"]]
        item["spendReconciled"] = result["summary"]["spend"]["value"] == sum(c["spend_cents"] or 0 for c in promotion_selected)
        item["promotionPaymentReconciled"] = result["summary"]["promotionPayment"]["value"] == sum(c["promotion_payment_cents"] or 0 for c in promotion_selected)
        key_columns = {"payment": (selected, "payment_cents"), "visitors": (selected, "visitors"), "customers": (selected, "customers"), "spend": (promotion_selected, "spend_cents"), "promotionPayment": (promotion_selected, "promotion_payment_cents")}
        item["reconciliations"] = {}
        for key, (records, column) in key_columns.items():
            m = result["summary"][key]
            typed_total = sum(c[column] or 0 for c in records)
            status = "unavailable" if m["value"] is None else "matched" if m["status"] == "available" and m["value"] == typed_total else "matched_partial_amount" if m["status"] == "partial" and m["value"] == typed_total else "not_full_period_comparable" if m["status"] == "partial" else "mismatch"
            item["reconciliations"][key] = {"status": status, "reportedValue": m["value"], "typedControlTotal": typed_total, "metricStatus": m["status"], "reasonCode": m["reasonCode"]}
        evidence["platforms"].append(item)
    transaction.set_rollback(True)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, default=str)+"\n", encoding="utf-8")
print(json.dumps({"evidence": str(output), "readOnly": True, "platforms": [{"platform": p["platform"], "elapsedSeconds": p["elapsedSeconds"], "dataThrough": p["freshness"], "shops": len(p["shops"]), "statuses": {k: v["status"] for k, v in p["summary"].items()}} for p in evidence["platforms"]]}, ensure_ascii=False))
