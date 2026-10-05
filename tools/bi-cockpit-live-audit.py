"""Explicit foreground read-only candidate audit; not a development fallback."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "teruisi_backend.settings"
import django
django.setup()
from django.db import connection, transaction
from django.http import QueryDict
from sales.auth import Principal
from teruisi_backend.read_budget import bounded_read
from bi.cockpit import parse_request, _fence, goals
from bi.cockpit_sales import sales_projection
from bi.errors import BiApiError

source = sys.argv[1]; destination = Path(sys.argv[2]).resolve()
allowed = {"sales": "teruisi_bi_reader", "operations": "teruisi_workflow_reader", "inventory": "teruisi_inventory_reader", "flow": "teruisi_netshop_reader"}
if source not in allowed or not destination.is_relative_to((ROOT / ".runtime" / "bi-live-audit").resolve()) or destination.exists():
    raise RuntimeError("Audit output must be a new private worktree file")
if connection.settings_dict["USER"] != allowed[source] or connection.settings_dict["HOST"] != "127.0.0.1" or str(connection.settings_dict["PORT"]) != "5432" or connection.settings_dict["NAME"] != "teruisi_sales":
    raise RuntimeError("Audit requires an exact existing owning read-only role")
actor = json.loads(os.environ.pop("TERUISI_BI_AUDIT_PRINCIPAL"))
principal = Principal(actor["email"], actor["displayName"], actor["role"], None)
if actor["role"] not in {"admin", "operator", "analyst", "viewer"} or actor.get("scopeRestricted") is not False:
    raise RuntimeError("Audit principal is not a verified unrestricted user")
options = parse_request(QueryDict(os.environ.pop("TERUISI_BI_AUDIT_QUERY")))
started = time.monotonic(); queries = []; plans = []
def measure(executor, sql, params, many, context):
    if source == "flow" and not plans and not sql.lstrip().upper().startswith("EXPLAIN") and "numeric_presence_rule" in sql and "GROUP BY" in sql:
        with connection.cursor() as cursor:
            cursor.execute("EXPLAIN (FORMAT JSON) " + sql, params)
            def tree(node):
                return {**{key: node[key] for key in ["Node Type", "Plan Rows", "Total Cost", "Relation Name", "Index Name"] if key in node}, "Plans": [tree(child) for child in node.get("Plans", [])]}
            plans.append(tree(cursor.fetchone()[0][0]["Plan"]))
    tick = time.monotonic()
    try:
        result = executor(sql, params, many, context)
    except Exception:
        failure = {"source": source, "status": "unavailable", "code": "bounded_read_failed", "readOnly": True, "seconds": round(time.monotonic()-started, 3), "failedSqlSeconds": round(time.monotonic()-tick, 3), "priorSqlSeconds": queries, "plans": plans}
        destination.with_suffix(".failure.json").write_text(json.dumps(failure), encoding="utf8")
        print(json.dumps(failure))
        raise
    queries.append(round(time.monotonic()-tick, 4)); return result
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION READ ONLY")
        cursor.execute("SELECT current_user, current_setting('transaction_read_only'), rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user")
        user, readonly, superuser, create_role, create_db = cursor.fetchone()
        if user != allowed[source] or readonly != "on" or superuser or create_role or create_db: raise RuntimeError("Owning role is not minimally read-only")
    with connection.execute_wrapper(measure):
        if source == "sales":
            from sales.query import revision_token
            with connection.execute_wrapper(_fence(time.monotonic()+65)):
                before = revision_token(); data = sales_projection(principal, options)
                # Independent SQL, no reuse of BI aggregation expressions.
                period = data["periods"]["current"]
                with connection.cursor() as cursor:
                    where = "is_business_row AND business_date >= %s AND business_date < %s"
                    bound = [period["startDate"], period["endExclusive"]]
                    if options["platform"]:
                        where += " AND platform=%s AND platform_key=%s"; bound.extend([options["platform"], options["platform"]])
                    if options["shop"]:
                        where += " AND shop_key=%s"; bound.append(options["shop"])
                    cursor.execute("SELECT SUM(allocated_amount_cents), SUM(cost_amount_cents), COUNT(*) FROM sales_order_lines WHERE " + where, bound)
                    net, cost, rows = cursor.fetchone()
                expected = data["sales"]["current"]
                if (net, cost, rows) != (expected["netSalesCents"], expected["costCents"], expected["rowCount"]): raise RuntimeError("Independent ERP SQL totals differ")
                if sum(row["current"]["netSalesCents"] or 0 for row in data["categories"]) != (net or 0): raise RuntimeError("Category total differs")
                for key in ("annual", "month"):
                    w = data["periods"]["goalWindows"][key]
                    goal_bound = [w["startDate"], w["endExclusive"], *bound[2:]]
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT SUM(allocated_amount_cents), COUNT(*), COUNT(DISTINCT business_date) FROM sales_order_lines WHERE " + where, goal_bound)
                        amount, count, dates = cursor.fetchone()
                    actual = data["goalActuals"][key]
                    if (amount, count, dates) != (actual["netSalesCents"], actual["rowCount"], actual["coverage"]["observedDays"]): raise RuntimeError("Independent ERP goal totals differ")
                if revision_token() != before: raise RuntimeError("ERP source changed during read")
            revision = before
        elif source == "operations":
            from workflow.bi_status import projection
            from workflow.revisions import revision_value
            from workflow.errors import WorkflowApiError
            with bounded_read(WorkflowApiError):
                revision = revision_value(); data = projection(principal, options["mine"] == "1")
                if revision_value() != revision: raise RuntimeError("Operations source changed")
        elif source == "inventory":
            from inventory.bi_projection import projection
            from inventory.revisions import revision_value
            from inventory.errors import InventoryApiError
            with bounded_read(InventoryApiError):
                revision = revision_value(); data = projection(principal)
                if revision_value() != revision: raise RuntimeError("Inventory source changed")
        else:
            from netshop.bi_flow import projection
            from netshop.query import revision_value
            from bi.cockpit_sales import periods
            window = periods(options)["current"]
            params = QueryDict(mutable=True); params.update({"startDate": window["startDate"], "endDate": window["endDate"], "periodKind": options["range"], "platform": options["flowPlatform"], "shop": options["flowShop"], "parentPlatform": options["platform"], "parentShop": options["shop"]})
            revision = revision_value(); data = projection(principal, params)
            if revision_value() != revision: raise RuntimeError("Netshop source changed")
payload = {"source": source, "revision": revision, "data": data, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seconds": round(time.monotonic()-started, 3), "sqlCount": len(queries) if source != "flow" else None, "maxSqlSeconds": max(queries, default=0) if source != "flow" else None, "readOnly": True, "independentTotalsVerified": source == "sales", "erpGoalTotalsVerified": source == "sales", "query": options}
destination.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")
print(json.dumps({key: value for key, value in payload.items() if key != "data"}, ensure_ascii=True))
