"""Only own dynamic synthetic PostgreSQL; no production fallback or services."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
BIN=Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN=ROOT/".runtime"/("crossdomain-pg-"+secrets.token_hex(8))
EVIDENCE=Path(os.environ.get("TERUISI_CROSSDOMAIN_EVIDENCE_ROOT",r"E:\codex-artifacts\netshop-scheme2-20261001\cross-domain"))/RUN.name
if EVIDENCE.drive.upper()!="E:":raise RuntimeError("Evidence must use external E drive")
RUN.mkdir(parents=True);EVIDENCE.mkdir(parents=True)
with socket.socket() as probe:probe.bind(("127.0.0.1",0));PORT=probe.getsockname()[1]
if PORT==5432:raise RuntimeError("Production/default port forbidden")
password=secrets.token_hex(40);pwfile=RUN/"fixture-password.txt";pwfile.write_text(password,encoding="ascii")
allowed={"SYSTEMROOT","WINDIR","TEMP","TMP","PATH","COMSPEC","USERPROFILE","LOCALAPPDATA","APPDATA","PROGRAMFILES"}
env={key:value for key,value in os.environ.items() if key in allowed}
env.update(PGPASSWORD=password,PYTHONUTF8="1",PYTHONDONTWRITEBYTECODE="1",PYTHONPATH=str(ROOT/"tools")+os.pathsep+str(ROOT/"backend"),TERUISI_DJANGO_ENVIRONMENT="test",TERUISI_DJANGO_PROCESS_ROLE="development",DJANGO_DEBUG="true",TERUISI_DJANGO_DATABASE_URL=f"postgresql://crossdomain_fixture:{password}@127.0.0.1:{PORT}/crossdomain_fixture",TERUISI_DJANGO_SALES_READER_BASE_URL="http://127.0.0.1:1",TERUISI_CROSSDOMAIN_CAPACITY_EVIDENCE_DIR=str(EVIDENCE/"capacity"))
results=[];started=False;stopped=False
def run(args,label):
    before=time.monotonic()
    with (EVIDENCE/(label+".log")).open("x",encoding="utf8") as log:result=subprocess.run([str(item) for item in args],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    results.append({"step":label,"exitCode":result.returncode,"seconds":round(time.monotonic()-before,3)})
    if result.returncode:raise RuntimeError(f"{label} failed; see {EVIDENCE}")
try:
    run([BIN/"initdb.exe","-D",RUN/"data","-U","crossdomain_fixture","--auth=scram-sha-256","--encoding=UTF8","--locale=C","--pwfile",pwfile],"initdb");pwfile.unlink()
    with (RUN/"data/postgresql.conf").open("a",encoding="utf8") as conf:conf.write(f"\nport={PORT}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
    run([BIN/"pg_ctl.exe","-D",RUN/"data","-l",RUN/"postgres.log","-w","-t","30","start"],"start");started=True
    run([BIN/"createdb.exe","-h","127.0.0.1","-p",str(PORT),"-U","crossdomain_fixture","crossdomain_fixture"],"database")
    labels=sys.argv[1:] or ["sales.tests.test_netshop_periods","netshop.tests.test_sales_periods_client"]
    if any(not item.startswith(("sales.tests.test_netshop_","netshop.tests.test_sales_periods","finance.tests.test_netshop_")) for item in labels):raise RuntimeError("Only scoped synthetic test prefixes allowed")
    run([sys.executable,"backend/manage.py","test",*labels,"--settings=netshop_overview_test_settings","--noinput"],"tests")
finally:
    if pwfile.exists():pwfile.unlink()
    if started:
        run([BIN/"pg_ctl.exe","-D",RUN/"data","-m","fast","-w","-t","30","stop"],"stop");stopped=True
    meta={"fixture":"crossdomain-synthetic-v1","sourceHead":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"port":PORT,"runtime":str(RUN),"started":started,"normalStop":stopped,"results":results,"productionFallback":False}
    with (EVIDENCE/"result.json").open("x",encoding="utf8") as out:json.dump(meta,out,indent=2)
    print(f"Private cross-domain PG normalStop={stopped}; evidence {EVIDENCE}")
