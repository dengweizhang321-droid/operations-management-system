"""Non-author cache seam probes; no DB socket, source business math unchanged.

Run from the isolated venv with PYTHONPATH including backend and perf docs.
The DB adapter and version seam are explicit doubles; this supplements PG checks.
"""
import hashlib
import json
import os
from pathlib import Path
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "inventory_test_settings")
import django
django.setup()
from inventory import read_cache as rc
from inventory.errors import InventoryApiError

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / ".runtime/inventory-independent-ui"
OUT.mkdir(parents=True, exist_ok=True)
checks = []
principal = SimpleNamespace(email="cache-probe@example.invalid", role="admin", scope=None)
db = SimpleNamespace(vendor="sqlite", settings_dict={"ENGINE":"isolated-double","HOST":"127.0.0.1","PORT":"1","NAME":"probe","USER":"probe"}, in_atomic_block=False, get_autocommit=lambda:True)
version = [1]
count = [0]
def loader():
    count[0] += 1
    return {"items":[{"quantity":9,"zeroCost":0}],"load":count[0]}
def call(p=principal, scope="complete"):
    return rc.cached_base("probe", p, scope, loader)

with patch.object(rc,"connection",db), patch.object(rc,"snapshot",lambda:tuple(version)):
    rc.cache.clear()
    first = call(); first["items"][0]["quantity"] = -999
    second = call(); assert second["items"][0]["quantity"] == 9 and count[0] == 1
    second["items"].append({"quantity":500}); assert len(call()["items"]) == 1
    checks.append("miss-and-hit-caller-mutation-cannot-poison-base")
    call(SimpleNamespace(email="other@example.invalid",role="admin",scope=None))
    call(SimpleNamespace(email=principal.email,role="viewer",scope=None))
    call(SimpleNamespace(email=principal.email,role="admin",scope={"brands":["B"]}))
    call(scope="different-complete-base")
    assert count[0] == 5
    db.settings_dict["NAME"]="probe-2";call();assert count[0]==6
    checks.append("account-role-scope-base-and-database-isolation")
    version[0]+=1; call(); assert count[0]==7
    checks.append("source-version-invalidation")
    db.in_atomic_block=True; call();call();assert count[0]==9
    db.in_atomic_block=False
    db.get_autocommit=lambda:False;call();call();assert count[0]==11
    db.get_autocommit=lambda:True
    call(None);call(None);assert count[0]==13
    checks.append("transaction-autocommit-and-no-principal-bypass")
    rc.cache.clear()
    def racing_loader():
        version[0]+=1
        return loader()
    try:rc.cached_base("probe",principal,"race",racing_loader)
    except InventoryApiError as e:assert e.status==503
    else:raise AssertionError("Source changed but response accepted")
    assert not rc.cache.entries
    checks.append("source-change-during-loader-fails-without-cache-publish")
    rc.cache.clear();call()
    current=tuple(version)
    with patch.object(rc,"snapshot",side_effect=[current,(current[0]+1,)]):
        try:call()
        except InventoryApiError as e:assert e.status==503
        else:raise AssertionError("Cache hit skipped source recheck")
    checks.append("cache-hit-rechecks-source")

small = rc.InventoryReadCache(capacity=2, maximum_bytes=500, ttl=.02)
validate=lambda:None
small.read("a",lambda:{"n":1},validate); small.read("b",lambda:{"n":2},validate)
small.read("a",lambda:None,validate);small.read("c",lambda:{"n":3},validate)
assert list(small.entries)==["a","c"] and small.bytes<=500
time.sleep(.03);small.read("d",lambda:{"n":4},validate)
assert list(small.entries)==["d"]
small.read("too-big",lambda:{"data":"x"*1000},validate);assert "too-big" not in small.entries
checks.append("entry-byte-capacity-lru-ttl-and-oversize-bypass")

flight = rc.InventoryReadCache(); started=Event(); release=Event(); calls=[0]
def load_once():
    calls[0]+=1;started.set();assert release.wait(2);return {"quantity":7}
with ThreadPoolExecutor(max_workers=2) as pool:
    a=pool.submit(flight.read,"same",load_once,validate)
    assert started.wait(2)
    b=pool.submit(flight.read,"same",load_once,validate)
    release.set();av,bv=a.result(3),b.result(3)
assert calls[0]==1 and av==bv and av is not bv
checks.append("overlapping-identical-miss-calculated-once")

result={"status":"passed","sourceSha256":hashlib.sha256((ROOT/"backend/inventory/read_cache.py").read_bytes()).hexdigest(),"checks":checks,"databaseSockets":0,"limitations":"Explicit version/connection doubles, not a substitute for PG source-race or actual-role validation."}
(OUT/"cache-independent-result.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
print(json.dumps(result,indent=2))
