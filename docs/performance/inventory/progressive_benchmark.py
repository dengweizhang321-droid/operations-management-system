"""Measure actual private HTTP, region work and wire bytes at business scale."""
import hashlib
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Thread, Lock
from socketserver import ThreadingMixIn
import time
from urllib.request import Request, urlopen
from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server
from unittest.mock import patch

from django.http import JsonResponse
from django.core.handlers.wsgi import WSGIHandler
from django.db import connection, close_old_connections
from django.urls import path
from inventory import guangdong as gd
from inventory.read_cache import cache
from inventory.regions import regional_read
from inventory.views import _consistent_read
from sales.tests.factories import signed_headers, TEST_SECRET


def run(cases, principal, old_gd, baseline):
    import inventory_test_urls
    os.environ["TERUISI_DJANGO_INTERNAL_SECRET"] = TEST_SECRET
    stats=[]; wire=[]; equivalent=[]; lock=Lock()
    def endpoint(request, version, kind):
        close_old_connections()
        options={}
        if request.GET.get("category"): options["categories"]=[request.GET["category"]]
        if request.GET.get("page"): options["planPage" if kind=="plan" else "page"]=int(request.GET["page"])
        # Dates are intentionally ignored by inventory's fixed latest-snapshot
        # semantics; this explicitly verifies the original behavior.
        if request.GET.get("startDate"): options.update(startDate=request.GET["startDate"],endDate="2026-09-30")
        query_stats={"sqlMs":0,"queries":0}
        def execute(fn,sql,params,many,context):
            start=time.perf_counter()
            try:return fn(sql,params,many,context)
            finally:query_stats["sqlMs"]+=(time.perf_counter()-start)*1000;query_stats["queries"]+=1
        reader=cases[kind][0 if version=="before" else 1]
        start=time.perf_counter()
        with connection.execute_wrapper(execute):
            if version=="before":
                with patch.object(gd,"overview_risks",old_gd.overview_risks): payload=reader(options)
            else:
                payload,_=_consistent_read(lambda:regional_read(principal,kind,options,request.GET["section"],lambda:reader(options)))
        elapsed=(time.perf_counter()-start)*1000
        start=time.perf_counter(); response=JsonResponse(payload,json_dumps_params={"ensure_ascii":False})
        serialization=(time.perf_counter()-start)*1000
        with lock: stats.append({"request":request.get_full_path(),"queryMs":round(elapsed,2),
            "sqlMs":round(query_stats["sqlMs"],2),"queries":query_stats["queries"],
            "pythonFetchCopyMs":round(elapsed-query_stats["sqlMs"],2),
            "serializationMs":round(serialization,2),"responseBytes":len(response.content)})
        response["Cache-Control"]="no-store"
        return response
    inventory_test_urls.urlpatterns.insert(0,path("perf/<str:version>/<str:kind>",endpoint))
    class Server(ThreadingMixIn,WSGIServer): daemon_threads=True
    class Quiet(WSGIRequestHandler):
        def log_message(self,*args):pass
    server=make_server("127.0.0.1",0,WSGIHandler(),server_class=Server,handler_class=Quiet)
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    port=server.server_port
    def fetch(url,scenario):
        start=time.perf_counter()
        with urlopen(Request(url,headers=signed_headers(url)),timeout=30) as response:
            first=(time.perf_counter()-start)*1000
            body=response.read()
            end=(time.perf_counter()-start)*1000
        start=time.perf_counter(); payload=json.loads(body); decode=(time.perf_counter()-start)*1000
        with lock:wire.append({"scenario":scenario,"urlPath":url.split(str(port),1)[1],
            "firstByteMs":round(first,2),"bodyReadMs":round(end-first,2),
            "httpCompleteMs":round(end,2),"decodeMs":round(decode,2),"responseBytes":len(body)})
        return payload
    try:
        for kind in cases:
            cache.clear()
            for scenario,params in [("first",""),("reentry",""),("filter","category=Category+1"),
                ("page","page=2"),("refresh",""),("date-control","startDate=2025-01-01")]:
                before=f"http://127.0.0.1:{port}/perf/before/{kind}?{params}"
                expected=fetch(before,f"before/{kind}/{scenario}")
                after=f"http://127.0.0.1:{port}/perf/after/{kind}?{params}"
                start=time.perf_counter()
                with ThreadPoolExecutor(2) as pool:
                    pair=list(pool.map(lambda section:fetch(after+"&section="+section,f"after/{kind}/{scenario}/{section}"),["summary","detail"]))
                total=(time.perf_counter()-start)*1000
                summary,detail=pair
                for field in ("readSection","readScope","readSnapshot"):detail.pop(field)
                if detail!=expected:raise AssertionError(f"Regional detail changed business: {kind}/{scenario}")
                for field in summary:
                    if field not in {"items","plans","mapping","readSection","readScope","readSnapshot"} and summary[field]!=expected[field]:raise AssertionError(f"Regional summary changed {kind}/{field}")
                equivalent.append({"scenario":f"{kind}/{scenario}","pairCompleteMs":round(total,2)})
            print("regional completed "+kind,flush=True)
    finally:
        server.shutdown();server.server_close();thread.join(5)
    out=Path(os.environ["INVENTORY_PERFORMANCE_EVIDENCE"])/"progressive-benchmark.json"
    out.write_text(json.dumps({"baseline":baseline,"fixture":"private PostgreSQL synthetic business scale",
        "port":port,"products":8000,"stockRows":24000,"ageRows":24000,"salesRows":240000,
        "source":"same seeded fixture as benchmark.py",
        "sourceHashes":{str(p.relative_to(Path(__file__).resolve().parents[3])):hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__).resolve().parents[3]/"backend/inventory").glob("*.py")},"cacheLimitBytes":cache.maximum_bytes,
        "exactEquivalence":equivalent,"server":stats,"wire":wire,
        "conditions":"one before request then concurrent region pair; process cache empty only first; warm OS/database pages; private WSGI/owner role, no Worker/Home/auth gateway latency",
        "limitations":"one sample per action; no P95; Python residual includes ORM materialization/cache copies; total wire bytes include both requests"},indent=2),encoding="utf-8")
    print(out)
