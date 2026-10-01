"""Named loopback UI adapter over actual S/F/P/A readers and synthetic private PG.

No production environment, account, cookie, connection, import or business
source is used. Named source-503 and delay controls are fault injection only.
Lifetime is bounded and stopped through this run's stop.request, never stdin.
"""
from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
EVIDENCE_ROOT = Path(r"E:\codex-artifacts\netshop-panorama-M5-20261001")
HTTP_PORT = 18160
FIXTURE = "panorama-ui-synthetic-postgresql-v1"
EMAIL = "panorama-ui@example.test"
STORES = (("京东", "合成店A", 1), ("京东", "合成店B", 2), ("天猫", "合成天猫A", 1))
ROUTES = {
    "/api/netshop/store-panorama", "/api/netshop/insights-context",
    "/api/netshop/product-insights", "/api/netshop/product-insights/detail",
    "/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail",
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--evidence-directory")
parser.add_argument("--timeout-seconds", type=int, default=900)
args = parser.parse_args()
if not 30 <= args.timeout_seconds <= 3600:
    raise RuntimeError("Fixture lifetime must be 30—3600 seconds")
EVIDENCE = Path(args.evidence_directory).resolve() if args.evidence_directory else EVIDENCE_ROOT / ("ui-private-" + secrets.token_hex(12))
if EVIDENCE.parent != EVIDENCE_ROOT.resolve() or not re.fullmatch(r"ui-private-[a-f0-9]{12,64}", EVIDENCE.name):
    raise RuntimeError("Evidence must be an exclusive ui-private-{hex} child of the panorama evidence root")
for port in (3162, HTTP_PORT, 13160):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PG_PORT = probe.getsockname()[1]
if PG_PORT in {5432, 3162, HTTP_PORT, 13160}:
    raise RuntimeError("Refusing production or reserved fixture ports")
RUN = ROOT / ".runtime" / ("panorama-ui-pg-" + secrets.token_hex(10))
RUN.mkdir(parents=True, exist_ok=False)
EVIDENCE.mkdir(parents=True, exist_ok=False)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
with pwfile.open("x", encoding="ascii") as output:
    output.write(password)
env = {key: value for key, value in os.environ.items() if key.upper() in {
    "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES",
}}
env.update(
    PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
    PYTHONPATH=str(ROOT / "tools") + os.pathsep + str(ROOT / "backend"),
    DJANGO_SETTINGS_MODULE="netshop_products_test_settings", TERUISI_DJANGO_ENVIRONMENT="test",
    TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://panorama_ui_fixture:{password}@127.0.0.1:{PG_PORT}/panorama_ui_fixture",
)
# Explicitly block any later owning adapter's loopback-default fallback. This
# bound, non-listening private port cannot be taken by a production service.
upstream_guard = socket.socket()
upstream_guard.bind(("127.0.0.1", 0))
blocked_upstream_port = upstream_guard.getsockname()[1]
for domain in ("SALES", "FINANCE", "WORKFLOW", "INVENTORY", "ERP_REFERENCE", "PRODUCTS", "NETSHOP", "MARKET", "BI", "ACCESS_CONTROL"):
    for suffix in ("READER_BASE_URL", "BASE_URL"):
        env[f"TERUISI_DJANGO_{domain}_{suffix}"] = f"http://127.0.0.1:{blocked_upstream_port}"
steps, started, server, request_log = [], False, None, None
log_lock, control_lock = threading.Lock(), threading.Lock()
controls = {"sourceFailure": None, "delayShop": None, "delayMilliseconds": 0}
request_context = threading.local()


def exclusive_json(name, value):
    with (EVIDENCE / name).open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, allow_nan=False, indent=2)


def run(command, label, timeout=120):
    before = time.monotonic()
    with (EVIDENCE / (label + ".log")).open("x", encoding="utf-8") as log:
        result = subprocess.run([str(part) for part in command], cwd=ROOT, env=env,
                                stdout=log, stderr=subprocess.STDOUT, timeout=timeout,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    steps.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic() - before, 3)})
    if result.returncode:
        raise RuntimeError(f"{label} failed; see this private fixture's evidence")


try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "panorama_ui_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb", 60)
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PG_PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start", 45)
    started = True
    run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "panorama_ui_fixture", "panorama_ui_fixture"], "database", 30)
    run([sys.executable, "backend/manage.py", "migrate", "--settings=netshop_products_test_settings", "--noinput"], "fixture-migrate")
    os.environ.clear()
    os.environ.update(env)
    sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "backend")]
    import django
    django.setup()
    from django.db import close_old_connections, connections, transaction
    from django.db.models import F
    from django.http import QueryDict
    from django.utils import timezone
    from access_control.models import AppUser
    from netshop.errors import NetshopApiError
    from netshop.models import NetshopDataRevision
    from netshop.insights_common import actor_fence, read_context, validate_context
    from netshop.product_insights import ALL_FIELDS, read_product_insights, read_product_detail, validate_product_query
    from netshop.promotion_insights import read_promotion_insights, read_promotion_detail
    from netshop import store_panorama
    from netshop.tests.promotion_insights_fixtures import add_day
    from sales.auth import Principal

    actual_products, actual_promotion = store_panorama._read_products, store_panorama._read_promotion
    def injected_products(*reader_args):
        if getattr(request_context, "source_failure", None) == "products":
            raise NetshopApiError("Synthetic fixture product 503 injection", code="service_unavailable", status=503)
        return actual_products(*reader_args)
    def injected_promotion(*reader_args):
        if getattr(request_context, "source_failure", None) == "promotion":
            raise NetshopApiError("Synthetic fixture promotion 503 injection", code="service_unavailable", status=503)
        return actual_promotion(*reader_args)
    store_panorama._read_products, store_panorama._read_promotion = injected_products, injected_promotion

    with transaction.atomic():
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a" * 64})
        AppUser.objects.create(email=EMAIL, display_name="Synthetic panorama UI", role_id="admin", status="active", scope=None,
                               version=1, created_at=timezone.now(), updated_at=timezone.now())
        owner = SimpleNamespace(counter=0)
        periods = [("2026-09", 100), ("2026-08", 80), ("2025-09", 70)]
        for platform, shop, multiplier in STORES:
            for month, factor in periods:
                for day_index in range(1, 8):
                    day = f"{month}-{day_index:02d}"
                    for dimension in (["spu", "sku"] if platform == "京东" else ["spu"]):
                        product_rows = []
                        for number in range(1, 19):
                            identity = f"SKU-{number:03d}" if platform == "京东" else f"SPU-{number:03d}"
                            payment = ((3000 if dimension == "spu" else 1000) + number * 100 + day_index * 17) * factor // 100 * multiplier
                            values = {
                                "payment": payment, "quantity": 2 + number % 3, "visitors": 100 + number * 2,
                                "customers": 10 + number % 4, "addCartCustomers": 20 + number % 5, "refundPayment": number * 10,
                                "pageViews": 300 + number, "favorites": 10 + number, "addCartQuantity": 30 + number,
                                "orderCustomers": 12 + number % 4, "orderQuantity": 4 + number % 3, "orderPayment": payment + 100,
                                "transactionOrders": 11 + number % 4, "searchImpressions": 500 + number,
                                "searchClicks": 30 + number, "searchVisitors": 40 + number, "searchCustomers": 3 + number % 4,
                            }
                            aliases = {"payment": "transactionAmountCents", "quantity": "transactionQuantity", "customers": "transactionCustomers",
                                       "refundPayment": "refundAmountCents", "orderPayment": "orderAmountCents", "searchCustomers": "searchTransactionCustomers"}
                            metrics = {aliases.get(key, key): value for key, value in values.items()}
                            typed = {ALL_FIELDS[key]: value for key, value in values.items()}
                            typed.update(category="合成品类" + str(1 + number % 3), product_code=f"SYNTHETIC-ERP-{number:03d}")
                            product_rows.append({"id": identity, "spu": f"SPU-{number:03d}", "title": f"合成商品{number:02d}", "values": metrics, "typed": typed})
                        batch, rows = add_day(owner, shop=shop, day=day, platform=platform, promotion=False, rows=product_rows)
                        if platform == "京东" and dimension == "spu":
                            batch.dataset = "spu_daily"
                            batch.save(update_fields=["dataset"])
                            for row in rows:
                                row.dataset = "spu_daily"
                            type(rows[0]).objects.bulk_update(rows, ["dataset"])
                    advertisement_rows = []
                    for number in range(1, 4):
                        identity = f"SKU-{number:03d}" if platform == "京东" else f"SPU-{number:03d}"
                        spend = (100 + number * 20 + day_index * 5) * multiplier
                        advertisement_rows.append({"id": identity, "spu": f"SPU-{number:03d}", "title": f"合成商品{number:02d}",
                            "raw": {"跟单SKU": identity} if platform == "京东" else {},
                            "values": {"spendCents": spend, "netTransactionAmountCents": spend * 3, "impressions": 500 + number * 20,
                                       "clicks": 15 + number, "netOrders": 1 + number}})
                    add_day(owner, shop=shop, day=day, platform=platform, rows=advertisement_rows)
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(FIXTURE.encode()).hexdigest())
    paths = [Path(__file__), ROOT / "backend/netshop/store_panorama.py", ROOT / "backend/netshop/insights_common.py",
             ROOT / "backend/netshop/product_insights.py", ROOT / "backend/netshop/promotion_insights.py",
             ROOT / "backend/netshop/product_scope_series.py", ROOT / "backend/netshop/panorama_workflow_client.py",
             ROOT / "backend/netshop/panorama_sales_client.py",
             ROOT / "backend/netshop/sales_periods_client.py", ROOT / "backend/netshop/sales_client.py",
             ROOT / "backend/netshop/tests/promotion_insights_fixtures.py", ROOT / "tools/netshop_products_test_settings.py"]
    exclusive_json("fixture.json", {"fixture": FIXTURE, "adapter": "actual owning Python readers; public Edge/gateway registration tested separately",
                    "root": str(ROOT), "seededBatches": owner.counter, "productsPerStore": 18, "advertisementObjectsPerStore": 3,
                    "stores": [{"platform": p, "shopName": s} for p, s, _ in STORES], "periods": [m + "-01 through " + m + "-07" for m, _ in periods],
                    "readerPort": HTTP_PORT, "privatePgPort": PG_PORT, "fixtureActor": EMAIL, "role": "admin", "scope": None,
                    "crossDomainUpstreams": "disabled bound non-listening private port; no runtime fallback", "blockedUpstreamPort": blocked_upstream_port,
                    "faultInjectionControls": ["source-failure", "delay"], "lifetimeSeconds": args.timeout_seconds,
                    "sourceSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}})
    connections.close_all()
    request_log = (EVIDENCE / "requests.jsonl").open("x", encoding="utf-8")
    read_slots = threading.BoundedSemaphore(4)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_args):
            pass

        def send_payload(self, value, status=200, revision=None):
            payload = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
            if len(payload) > 2 * 1024 * 1024:
                status, payload = 422, b'{"code":"quality_incomplete","error":"Fixture complete response exceeds 2MiB"}'
            self.response_status = status
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(payload)))
                if revision is not None and status == 200:
                    self.send_header("X-Netshop-Data-Revision", revision)
                self.end_headers()
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.client_disconnected = True

        def do_GET(self):
            if not read_slots.acquire(timeout=5):
                self.send_payload({"code": "service_unavailable", "error": "Synthetic fixture read slots are busy"}, 503)
                return
            close_old_connections()
            before, parts, status = time.monotonic(), urlsplit(self.path), 200
            self.client_disconnected = False
            injected = {"sourceFailure": None, "delayMilliseconds": 0}
            try:
                if parts.path == "/health/live" and not parts.query:
                    self.send_payload({"fixture": FIXTURE, "evidenceDirectory": str(EVIDENCE)})
                    return
                if parts.path not in ROUTES or len(parts.query) > 16384:
                    raise NetshopApiError("Only six named read routes exist in this private fixture", code="not_found", status=404)
                params = QueryDict(parts.query)
                with control_lock:
                    snapshot = dict(controls)
                shops = [value.split("\x1f", 1)[1] for value in params.getlist("outlet") if value.count("\x1f") == 1]
                request_context.source_failure = snapshot["sourceFailure"]
                injected["sourceFailure"] = snapshot["sourceFailure"]
                if snapshot["delayShop"] in shops:
                    injected["delayMilliseconds"] = snapshot["delayMilliseconds"]
                    time.sleep(snapshot["delayMilliseconds"] / 1000)
                user = AppUser.objects.get(email=EMAIL)
                principal = Principal(user.email, user.display_name, user.role_id, user.scope)
                # Fault injection must never hide a real disabled-actor 403.
                actor_fence(principal)
                if parts.path == "/api/netshop/store-panorama":
                    value = store_panorama.read_store_panorama(principal, params)
                elif parts.path == "/api/netshop/insights-context":
                    value = read_context(principal, validate_context(params))
                elif parts.path.startswith("/api/netshop/product-insights"):
                    if snapshot["sourceFailure"] == "products":
                        raise NetshopApiError("Synthetic product 503 injection", code="service_unavailable", status=503)
                    detail = parts.path.endswith("/detail")
                    value = (read_product_detail if detail else read_product_insights)(principal, validate_product_query(params, detail=detail))
                else:
                    if snapshot["sourceFailure"] == "promotion":
                        raise NetshopApiError("Synthetic promotion 503 injection", code="service_unavailable", status=503)
                    value = (read_promotion_detail if parts.path.endswith("/detail") else read_promotion_insights)(principal, params)
                context = value if parts.path == "/api/netshop/insights-context" else value["context"]
                revision = next(r["revision"] for r in context["sourceRevisions"] if r["domain"] == "netshop" and r["kind"] == "owning_revision")
                self.send_payload(value, revision=revision)
            except NetshopApiError as error:
                status = error.status
                self.send_payload({"code": error.code, "error": str(error)}, status)
            except Exception as error:
                status = 500
                self.send_payload({"code": "fixture_error", "error": type(error).__name__}, status)
            finally:
                with log_lock:
                    request_log.write(json.dumps({"path": parts.path, "querySha256": hashlib.sha256(parts.query.encode()).hexdigest(), "status": 499 if getattr(self, "client_disconnected", False) else getattr(self, "response_status", status),
                                                  "seconds": round(time.monotonic() - before, 4), "faultInjection": injected}, ensure_ascii=False) + "\n")
                    request_log.flush()
                request_context.source_failure = None
                connections.close_all()
                read_slots.release()

        def do_POST(self):
            close_old_connections()
            try:
                if self.path not in {"/fixture/account-status", "/fixture/advance-revision", "/fixture/source-failure", "/fixture/delay"}:
                    self.send_payload({"code": "fixture_read_only", "error": "Only named synthetic fixture controls are writable"}, 403)
                    return
                if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
                    raise NetshopApiError("Fixture controls require JSON")
                length = self.headers.get("Content-Length", "")
                if not length.isdigit() or not 0 < int(length) <= 512:
                    raise NetshopApiError("Bounded JSON fixture control required")
                payload = json.loads(self.rfile.read(int(length)))
                if not isinstance(payload, dict):
                    raise NetshopApiError("Fixture control must be an object")
                if self.path == "/fixture/account-status" and set(payload) == {"status"} and payload["status"] in {"active", "disabled"}:
                    AppUser.objects.filter(email=EMAIL).update(status=payload["status"], version=F("version") + 1)
                    result = {"accountStatus": payload["status"]}
                elif self.path == "/fixture/advance-revision" and not payload:
                    NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision") + 1, source_digest=hashlib.sha256(secrets.token_bytes(32)).hexdigest())
                    result = {"revisionAdvanced": True}
                elif self.path == "/fixture/source-failure" and set(payload) == {"source"} and (payload["source"] is None or type(payload["source"]) is str and payload["source"] in {"products", "promotion", "none"}):
                    with control_lock:
                        controls["sourceFailure"] = None if payload["source"] in {None, "none"} else payload["source"]
                    result = {"faultInjection": "source503", "source": controls["sourceFailure"]}
                elif self.path == "/fixture/delay" and set(payload) == {"shopName", "milliseconds"} and (payload["shopName"] is None or payload["shopName"] in {s for _, s, _ in STORES}) and type(payload["milliseconds"]) is int and 0 <= payload["milliseconds"] <= 1500:
                    with control_lock:
                        controls.update(delayShop=payload["shopName"], delayMilliseconds=payload["milliseconds"])
                    result = {"faultInjection": "delay", "shopName": controls["delayShop"], "milliseconds": controls["delayMilliseconds"]}
                else:
                    raise NetshopApiError("Only named bounded synthetic fixture controls are writable")
                self.send_payload({"fixture": FIXTURE, **result})
            except (NetshopApiError, ValueError, TypeError) as error:
                self.send_payload({"code": "fixture_invalid_control", "error": str(error)}, 400)
            finally:
                connections.close_all()

    server = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    exclusive_json("ready.json", {"fixture": FIXTURE, "httpPort": HTTP_PORT, "privatePgPort": PG_PORT, "evidenceDirectory": str(EVIDENCE)})
    print(json.dumps({"state": "ready", "fixture": FIXTURE, "httpPort": HTTP_PORT, "evidenceDirectory": str(EVIDENCE)}), flush=True)
    timeout_at, polling = time.monotonic() + args.timeout_seconds, threading.Event()
    while not (EVIDENCE / "stop.request").exists():
        if not thread.is_alive():
            raise RuntimeError("Private HTTP fixture exited unexpectedly")
        if time.monotonic() >= timeout_at:
            try:
                with (EVIDENCE / "stop.request").open("x", encoding="ascii") as output:
                    output.write("bounded fixture lifetime reached")
            except FileExistsError:
                pass
        polling.wait(.25)
    exclusive_json("shutdown-begin.json", {"fixture": FIXTURE, "markerObserved": True, "lifetimeExpired": time.monotonic() >= timeout_at})
    server.shutdown()
    server.server_close()
    server = None
    thread.join(timeout=5)
finally:
    if server is not None:
        server.shutdown()
        server.server_close()
    if request_log is not None:
        request_log.close()
    if pwfile.exists():
        pwfile.unlink()
    try:
        if started or (RUN / "data/postmaster.pid").exists():
            run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", 45)
    finally:
        upstream_guard.close()
        exclusive_json("result.json", {"fixture": FIXTURE, "root": str(ROOT), "privatePgPort": PG_PORT, "runtime": str(RUN), "pgStarted": started,
                       "normalStop": any(s["step"] == "stop" and s["exitCode"] == 0 for s in steps), "steps": steps})
        print("Private panorama UI fixture stopped; evidence " + str(EVIDENCE), flush=True)
