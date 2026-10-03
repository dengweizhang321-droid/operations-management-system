"""Synthetic metadata performance/equivalence check in an owned private PG.

No production connection, production credentials, migrations or data copies.
Both old and new SELECTs retain a 7-second statement timeout. Queries and
EXPLAIN run only against generated fixture rows in the independent instance.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN = Path(tempfile.gettempdir()) / ("teruisi-metadata-pg-" + secrets.token_hex(6))
EVIDENCE = Path(os.environ.get("TERUISI_METADATA_EVIDENCE_ROOT", str(ROOT / ".runtime" / "metadata-evidence"))) / RUN.name
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
if PORT == 5432:
    raise RuntimeError("Refusing production port")
RUN.mkdir(parents=True)
EVIDENCE.mkdir(parents=True)
password = secrets.token_hex(40)
pwfile = RUN / "fixture-password.txt"
pwfile.write_text(password, encoding="ascii")
env = {k: v for k, v in os.environ.items() if k in {
    "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE",
    "LOCALAPPDATA", "APPDATA", "PROGRAMFILES",
}}
env["PGPASSWORD"] = password
results = []


def run(args, label):
    with (EVIDENCE / (label + ".log")).open("w", encoding="utf-8") as log:
        result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise RuntimeError(f"{label} failed; see {EVIDENCE}")


def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


started = False
status = "failed"
try:
    run([BIN / "initdb.exe", "-D", RUN / "data", "-U", "metadata_fixture",
         "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", pwfile], "initdb")
    pwfile.unlink()
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='64MB'\n")
    run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-l", RUN / "postgres.log", "-w", "-t", "30", "start"], "start")
    started = True
    os.environ.update(DJANGO_SETTINGS_MODULE="netshop_overview_test_settings",
        TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development",
        DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://metadata_fixture:{password}@127.0.0.1:{PORT}/postgres")
    sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "tools")]
    import django
    django.setup()
    from django.db import connection
    from django.db.models import Max
    from django.test.utils import CaptureQueriesContext
    from netshop.context_queries import discover_shop_names, source_latest_date
    from netshop.models import NetshopRow
    with connection.cursor() as c:
        c.execute("SELECT inet_server_port(),current_setting('data_directory')")
        identity = c.fetchone()
        assert identity[0] == PORT and Path(identity[1]).resolve() == (RUN / "data").resolve()
        c.execute("CREATE TABLE netshop_import_batches(id varchar(1024) PRIMARY KEY,status varchar(64),platform varchar(100))")
        c.execute("INSERT INTO netshop_import_batches VALUES ('jd','completed','京东'),('tm','completed','天猫')")
        c.execute("CREATE TABLE netshop_rows(source varchar(64) NOT NULL,dataset varchar(64) NOT NULL,platform varchar(100) NOT NULL,shop_name varchar(100) NOT NULL,business_date varchar(10),last_import_batch_id varchar(1024),padding text)")
        c.execute("""INSERT INTO netshop_rows
          SELECT CASE g%4 WHEN 0 THEN 'jd_sku_daily' WHEN 1 THEN 'jd_promotion'
                 WHEN 2 THEN 'tmall_product_daily' ELSE 'tmall_promotion' END,
            CASE g%4 WHEN 0 THEN 'sku_daily' WHEN 1 THEN 'ad'
                 WHEN 2 THEN 'spu_daily' ELSE 'promotion_daily' END,
            CASE WHEN g%4<2 THEN '京东' ELSE '天猫' END,
            CASE WHEN g%4<2 THEN 'A-JD-' ELSE 'B-TM-' END || (g/4%4)::text,
            '2026-09-' || lpad((1+g%30)::text,2,'0'),
            CASE WHEN g%4<2 THEN 'jd' ELSE 'tm' END, repeat(md5(g::text),24)
          FROM generate_series(1,1000000) g""")
        for name, columns in [("net_scope_date_idx", "source,dataset,platform,shop_name,business_date"),
                              ("net_shop_date_idx", "shop_name,dataset,business_date")]:
            c.execute(f"CREATE INDEX {name} ON netshop_rows({columns})")
        c.execute("VACUUM (ANALYZE) netshop_rows")
        c.execute("ANALYZE netshop_import_batches")
        c.execute("SET statement_timeout=7000")
        c.execute("SET default_transaction_read_only=on")
        old_sql = """WITH RECURSIVE discovered(shop_name, ordinal) AS (
          (SELECT shop_name,1 FROM netshop_rows WHERE platform=%s AND shop_name<>%s ORDER BY shop_name LIMIT 1)
          UNION ALL SELECT following.shop_name, previous.ordinal+1 FROM discovered previous
          CROSS JOIN LATERAL (SELECT shop_name FROM netshop_rows WHERE platform=%s AND shop_name<>%s
            AND shop_name>previous.shop_name ORDER BY shop_name LIMIT 1) following
          WHERE previous.ordinal<%s) SELECT shop_name FROM discovered ORDER BY shop_name"""
        for platform, source, dataset, prefix in [
            ("京东", "jd_promotion", "ad", "A-JD-"),
            ("天猫", "tmall_product_daily", "spu_daily", "B-TM-"),
        ]:
            c.execute("SELECT DISTINCT shop_name FROM netshop_rows WHERE platform=%s AND shop_name<>'' ORDER BY shop_name LIMIT 51", [platform])
            expected = [r[0] for r in c.fetchall()]
            for label, operation in [("old-directory", lambda: (c.execute(old_sql, [platform, "", platform, "", 51]), [r[0] for r in c.fetchall()])[1]),
                                     ("new-directory", lambda: discover_shop_names(platform, 51))]:
                before = time.perf_counter()
                try:
                    with CaptureQueriesContext(connection) as captured:
                        actual = operation()
                    elapsed = time.perf_counter() - before
                    assert actual == expected
                    results.append({"platform": platform, "query": label, "seconds": elapsed, "sameResult": True})
                    c.execute("EXPLAIN (FORMAT JSON) " + captured.captured_queries[-1]["sql"])
                    save(f"{prefix}{label}-plan.json", c.fetchone()[0])
                except Exception as error:
                    if getattr(error, "sqlstate", getattr(error.__cause__, "sqlstate", None)) != "57014":
                        raise
                    results.append({"platform": platform, "query": label, "seconds": time.perf_counter()-before, "timeout": True})
                    if label.startswith("new-"):
                        raise
            names = [prefix+str(i) for i in range(4)]
            base = NetshopRow.objects.filter(platform=platform,source=source,dataset=dataset,
                shop_name__in=names,last_import_batch_id="jd" if platform=="京东" else "tm")
            for label, operation in [("old-freshness", lambda: base.aggregate(day=Max("business_date"))["day"]),
                                     ("new-freshness", lambda: source_latest_date(base,platform,names,source,dataset))]:
                before = time.perf_counter()
                with CaptureQueriesContext(connection) as captured:
                    actual = operation()
                elapsed = time.perf_counter() - before
                results.append({"platform": platform, "query": label, "seconds": elapsed, "date": actual})
                c.execute("EXPLAIN (FORMAT JSON) " + captured.captured_queries[-1]["sql"])
                save(f"{prefix}{label}-plan.json", c.fetchone()[0])
            assert results[-1]["date"] == results[-2]["date"]
    status = "passed"
finally:
    if pwfile.exists():
        pwfile.unlink()
    if started:
        if "django" in sys.modules:
            from django.db import connections
            connections.close_all()
        run([BIN / "pg_ctl.exe", "-D", RUN / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop")
    save("result.json", {"status": status, "syntheticRows": 1000000, "productionConnections": 0,
         "statementTimeoutMs": 7000, "privatePort": PORT, "runtime": str(RUN), "stopped": started,
         "results": results, "limitation": "One synthetic instance; not production latency or P95."})
    print(f"Private metadata PostgreSQL stopped; {status}; evidence {EVIDENCE}")
