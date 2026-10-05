"""Own private cluster only; clean environment; no production DB credentials."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[4]
assert (ROOT/".git").is_file()
assert subprocess.check_output(["git","branch","--show-current"],cwd=ROOT,encoding="utf-8").strip().startswith("codex/")
assert not list(ROOT.glob(".env*")) and not list(ROOT.glob(".dev.vars*"))
BIN=Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN=ROOT/".runtime"/("inventory-independent-pg-"+secrets.token_hex(8));RUN.mkdir(exist_ok=False)
with socket.socket() as probe:probe.bind(("127.0.0.1",0));port=probe.getsockname()[1]
assert port!=5432
password=secrets.token_hex(40);pwfile=RUN/"password.txt";pwfile.write_text(password,encoding="ascii")
env={k:v for k,v in os.environ.items() if k.upper() in {"PATH","SYSTEMROOT","WINDIR","TEMP","TMP","COMSPEC","USERPROFILE","LOCALAPPDATA","APPDATA"}}
env.update(PGPASSWORD=password,PYTHONUTF8="1",PYTHONDONTWRITEBYTECODE="1",PYTHONPATH=str(ROOT/"docs/performance/inventory")+os.pathsep+str(ROOT/"backend"),DJANGO_SETTINGS_MODULE="inventory_test_settings",TERUISI_DJANGO_ENVIRONMENT="test",TERUISI_DJANGO_PROCESS_ROLE="development",DJANGO_DEBUG="true",TERUISI_DJANGO_DATABASE_URL=f"postgresql://inventory_review:{password}@127.0.0.1:{port}/inventory_review",INVENTORY_REVIEW_EVIDENCE=str(RUN))
steps=[]
def run(args,name,timeout=60):
    with (RUN/(name+".log")).open("w",encoding="utf-8") as log:
        result=subprocess.run([str(a) for a in args],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
    steps.append({"step":name,"exitCode":result.returncode});assert result.returncode==0, f"{name} failed; see {RUN}"
started=False
try:
    run([BIN/"initdb.exe","-D",RUN/"data","-U","inventory_review","--auth=scram-sha-256","--encoding=UTF8","--locale=C","--pwfile",pwfile],"initdb")
    pwfile.unlink()
    with (RUN/"data/postgresql.conf").open("a") as conf:conf.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=10\nshared_buffers='32MB'\n")
    run([BIN/"pg_ctl.exe","-D",RUN/"data","-l",RUN/"postgres.log","-w","start"],"start");started=True
    run([BIN/"createdb.exe","-h","127.0.0.1","-p",port,"-U","inventory_review","inventory_review"],"database")
    run([sys.executable,"docs/performance/inventory/review/pg-independent.py"],"review",120)
finally:
    if pwfile.exists():pwfile.unlink()
    if started:run([BIN/"pg_ctl.exe","-D",RUN/"data","-m","fast","-w","stop"],"stop")
    (RUN/"runner-result.json").write_text(json.dumps({"privateCluster":True,"port":port,"steps":steps},indent=2),encoding="utf-8")
    print(RUN)
