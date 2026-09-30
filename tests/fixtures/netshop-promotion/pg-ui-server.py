"""A-only loopback UI fixture using real readers and a private synthetic PG.

This is a test adapter, not public URL/SDK registration. It never connects to
production, downloads business data, invokes AI, or inherits service secrets.
Create stop.request inside its exclusive evidence directory to close HTTP and
normally stop its own PG child. Closed shell stdin never determines lifetime.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = ROOT / ".runtime" / ("promotion-ui-pg-"+secrets.token_hex(6))
if len(sys.argv) != 2: raise RuntimeError("An exclusive evidence directory is required")
EVIDENCE = Path(sys.argv[1]).resolve()
if not str(EVIDENCE).lower().startswith("e:\\codex-artifacts\\netshop-scheme2-20261001\\promotion-integration\\"):
    raise RuntimeError("Unexpected evidence root")
EVIDENCE.mkdir(parents=True, exist_ok=False)
RUN.mkdir(parents=True, exist_ok=False)
for port in (3150, 18150, 18151, 13150):
    with socket.socket() as probe: probe.bind(("127.0.0.1", port))
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0)); PG_PORT = probe.getsockname()[1]
if PG_PORT == 5432: raise RuntimeError("Production port refused")
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"; pwfile.write_text(password, encoding="ascii")
env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}}
env.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT/"tools")+os.pathsep+str(ROOT/"backend"),
    DJANGO_SETTINGS_MODULE="netshop_overview_test_settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true",
    TERUISI_DJANGO_DATABASE_URL=f"postgresql://foundation_fixture:{password}@127.0.0.1:{PG_PORT}/foundation_fixture")
steps = []; started = False; server = None

def run(args, label):
    before = time.monotonic()
    with (EVIDENCE/(label+".log")).open("x", encoding="utf-8") as log:
        result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    steps.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic()-before, 3)})
    if result.returncode: raise RuntimeError(f"{label} failed; see the private evidence")

try:
    run([BIN/"initdb.exe", "-D", RUN/"data", "-U", "foundation_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb")
    pwfile.unlink()
    with (RUN/"data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PG_PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-l", RUN/"postgres.log", "-w", "-t", "30", "start"], "start"); started = True
    run([BIN/"createdb.exe", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", "foundation_fixture", "foundation_fixture"], "database")
    run([sys.executable, "backend/manage.py", "migrate", "--settings=netshop_overview_test_settings", "--noinput"], "fixture-migrate")
    os.environ.clear(); os.environ.update(env)
    sys.path[:0] = [str(ROOT/"tools"), str(ROOT/"backend")]
    import django
    django.setup()
    from django.db import close_old_connections, transaction
    from django.db.models import F
    from django.http import QueryDict
    from django.utils import timezone
    from access_control.models import AppUser
    from netshop.errors import NetshopApiError
    from netshop.models import NetshopDataRevision
    from netshop.promotion_diagnostic import SHOP_NAME, read_promotion_diagnostic
    from netshop.promotion_insights import read_promotion_insights, read_promotion_detail
    from netshop.query import revision_value
    from netshop.tests.promotion_insights_fixtures import add_day
    from sales.auth import Principal

    with transaction.atomic():
        NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": "a"*64})
        AppUser.objects.create(email="promotion-ui@example.test", display_name="Synthetic A", role_id="admin", status="active", scope=None, version=1, created_at=timezone.now(), updated_at=timezone.now())
        owner = SimpleNamespace(counter=0)
        all_dates = [f"2026-09-{d:02d}" for d in range(1, 8)]+[f"2026-08-{d:02d}" for d in range(1, 8)]+[f"2025-09-{d:02d}" for d in range(1, 8)]+[f"2026-08-{d:02d}" for d in range(25, 32)]
        for platform, shops in [("京东", [SHOP_NAME, "合成店A", "合成店B"]), ("天猫", ["合成天猫A", "合成天猫B"])]:
            for shop_index, name in enumerate(shops):
                for index, day in enumerate(all_dates):
                    spend = 10000+(index%7)*1300+shop_index*2500
                    if day.startswith("2026-08"): spend += 3000
                    if day.startswith("2025"): spend -= 1000
                    rows = []
                    for number, identity in enumerate(["SKU-001", "SKU-002", ""] if platform == "京东" else ["PRODUCT-001", "PRODUCT-002"]):
                        raw = {"计划ID": f"PLAN-{number+1}", "推广计划": "同名合成计划", "单元ID": f"UNIT-{number+1}", "推广单元": f"合成单元{number+1}", "关键词": f"商用切肉机{number+1}", "搜索词": f"商用肉片机{number+1}", "匹配方式": "精确", "推广SKU": "AD-SKU-001", "触发SKU": "TRIGGER-SKU-001", "跟单SKU": identity}
                        rows.append({"id": identity, "title": f"合成商品{number+1}", "raw": raw, "values": {"spendCents": spend//(number+1), "netTransactionAmountCents": (spend*3)//(number+1), "impressions": 6000+index*30, "clicks": 123+number*14, "netOrders": 7+number}})
                    add_day(owner, shop=name, day=day, platform=platform, rows=rows)
                    # A known missing paired product day exercises the main/aux scopes.
                    if not (name == "合成店B" and day == "2026-09-07"):
                        product_rows = [{"id": r["id"], "values": {"transactionAmountCents": 80000+(index%7)*1300}} for r in rows if r["id"]]
                        add_day(owner, shop=name, day=day, platform=platform, promotion=False, rows=product_rows)
        NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(b"promotion-ui-synthetic-v1").hexdigest())
    (EVIDENCE/"fixture.json").write_text(json.dumps({"fixture": "promotion-ui-synthetic-v1", "readerAdapter": "direct actual Python readers, public registration verified separately", "seededBatches": owner.counter, "readerPort": 18150, "privatePgPort": PG_PORT, "initialRole": "admin", "knownMissingPair": "京东×合成店B×2026-09-07", "startDate": "2026-09-01", "endDate": "2026-09-07"}, ensure_ascii=False, indent=2), encoding="utf-8")
    request_log = (EVIDENCE/"requests.jsonl").open("x", encoding="utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args): pass

        def send_payload(self, value, status=200, revision=None):
            payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(payload)))
            if revision is not None: self.send_header("X-Netshop-Data-Revision", revision)
            self.end_headers(); self.wfile.write(payload)

        def do_GET(self):
            close_old_connections(); before = time.monotonic(); parts = urlsplit(self.path); status = 200
            try:
                if parts.path == "/health/live": self.send_payload({"fixture": "promotion-ui-synthetic-v1"}); return
                params = QueryDict(parts.query); user = AppUser.objects.get(email="promotion-ui@example.test")
                principal = Principal(user.email, user.display_name, user.role_id, user.scope)
                if parts.path in {"/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail"}:
                    value = (read_promotion_detail if parts.path.endswith("/detail") else read_promotion_insights)(principal, params)
                    revision = next(r["revision"] for r in value["context"]["sourceRevisions"] if r["kind"] == "owning_revision")
                elif parts.path == "/api/netshop/promotion-diagnostic":
                    if user.role_id != "admin": raise NetshopApiError("Fixture role is not admin", code="access_denied", status=403)
                    if params.getlist("platform") != ["京东"] or params.getlist("outlet") != ["京东\x1f"+SHOP_NAME]: raise NetshopApiError("Original supported shop only")
                    from datetime import date
                    if not 1 <= (date.fromisoformat(params["endDate"])-date.fromisoformat(params["startDate"])).days+1 <= 7: raise NetshopApiError("Original 1-7 day UI boundary")
                    revision = revision_value()
                    value = read_promotion_diagnostic(start_date=params["startDate"], end_date=params["endDate"], source_revision=revision)
                    if revision != revision_value(): raise NetshopApiError("Source changed", code="insights_revision_changed", status=409)
                    value["sourceRevision"] = revision
                else: raise NetshopApiError("Fixture adapter has no such route", code="not_found", status=404)
                self.send_payload(value, revision=revision)
            except NetshopApiError as error:
                status = error.status; self.send_payload({"code": error.code, "error": str(error)}, status)
            except Exception as error:
                status = 500; self.send_payload({"code": "fixture_error", "error": type(error).__name__}, status)
            finally:
                request_log.write(json.dumps({"path": parts.path, "query": parts.query, "status": status, "seconds": round(time.monotonic()-before, 4)}, ensure_ascii=False)+"\n"); request_log.flush(); close_old_connections()

        def do_POST(self):
            close_old_connections()
            if self.path != "/fixture/advance-revision": self.send_payload({"code": "fixture_read_only", "error": "Only a synthetic revision fixture is writable"}, 403); return
            with transaction.atomic():
                NetshopDataRevision.objects.filter(domain="netshop").update(revision=F("revision")+1, source_digest=hashlib.sha256(secrets.token_bytes(32)).hexdigest())
            self.send_payload({"fixture": "promotion-ui-synthetic-v1", "revisionAdvanced": True}); close_old_connections()

    server = ThreadingHTTPServer(("127.0.0.1", 18150), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    print("Private synthetic PG and A reader adapter ready on 127.0.0.1:18150; create stop.request in its own evidence directory to stop.", flush=True)
    while not (EVIDENCE/"stop.request").exists(): thread.join(timeout=0.5)
    server.shutdown(); server.server_close(); server = None; thread.join(timeout=5); request_log.close()
finally:
    if server is not None: server.shutdown(); server.server_close()
    if pwfile.exists(): pwfile.unlink()
    if started: run([BIN/"pg_ctl.exe", "-D", RUN/"data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
    (EVIDENCE/"result.json").write_text(json.dumps({"fixture": "promotion-ui-synthetic-v1", "privatePgPort": PG_PORT, "runtime": str(RUN), "pgStarted": started, "normalStop": any(s["step"] == "stop" and s["exitCode"] == 0 for s in steps), "steps": steps}, indent=2), encoding="utf-8")
    print("Private promotion UI PG stopped; evidence", EVIDENCE, flush=True)
