"""Only task-owned synthetic endpoints; signed business requests stay local."""
import json
import os
import threading
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from django.db import connection, close_old_connections, connections
from django.test import RequestFactory
from sales import views
from finance import views as finance_views


def serve(root, run, baseline_views):
    token = os.environ["SALES_PERFORMANCE_LAB_TOKEN"]
    port = int(os.environ["SALES_PERFORMANCE_LAB_PORT"])
    if not 18481 <= port < 18581:
        raise RuntimeError("Invalid task-owned lab port")
    original_identity = baseline_views._cache_identity
    baseline_views._cache_identity = lambda request, principal: "baseline:" + original_identity(request, principal)
    routes = {
        "/api/sales/summary": "summary", "/api/sales/category-analysis": "category_analysis",
        "/api/sales/category-analysis/detail": "category_detail", "/api/sales/consumers/query": "consumer_query",
        "/api/finance/analysis": "analysis", "/api/finance/targets": "targets",
        "/api/finance/targets/import": "target_import",
    }
    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            close_old_connections()
            path = urlsplit(self.path).path
            if path == "/health" and self.command == "GET" and self.headers.get("Authorization") == "Bearer " + token:
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"fixture":"sales-performance-pg-v1"}'); return
            if path == "/__stop" and self.command == "POST" and self.headers.get("Authorization") == "Bearer " + token:
                self.send_response(200); self.end_headers()
                threading.Thread(target=self.server.shutdown, daemon=True).start(); return
            if path == "/__reset" and self.command == "POST" and self.headers.get("Authorization") == "Bearer " + token:
                from django.core.cache import cache
                from sales.calculation_cache import clear
                cache.clear(); clear()
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"reset":"synthetic-only"}'); return
            if path not in routes or self.command not in {"GET", "POST", "DELETE"}:
                self.send_response(403); self.end_headers(); return
            if self.command != "GET" and path not in {"/api/finance/targets", "/api/finance/targets/import", "/api/sales/consumers/query"}:
                self.send_response(403); self.end_headers(); return
            length = int(self.headers.get("Content-Length", "0"))
            if length > 3*1024*1024:
                self.send_response(413); self.end_headers(); return
            body = self.rfile.read(length) if length else b""
            request = RequestFactory().generic(self.command, self.path, data=body,
                content_type=self.headers.get("Content-Type", "application/json"), headers=dict(self.headers))
            impl = self.headers.get("X-Lab-Implementation", "candidate")
            target = finance_views if path.startswith("/api/finance/") else baseline_views if impl == "baseline" else views
            stats = {"sqlMs": 0, "queries": 0}
            def execute(fn, sql, params, many, context):
                started = time.perf_counter()
                try: return fn(sql, params, many, context)
                finally:
                    stats["sqlMs"] += (time.perf_counter()-started)*1000
                    stats["queries"] += 1
            started = time.perf_counter()
            with connection.execute_wrapper(execute):
                response = getattr(target, routes[path])(request)
            elapsed = (time.perf_counter()-started)*1000
            self.send_response(response.status_code)
            for name, value in response.items(): self.send_header(name, value)
            self.send_header("Content-Length", str(len(response.content)))
            self.send_header("Server-Timing", f'domain;dur={elapsed:.3f},sql;dur={stats["sqlMs"]:.3f}')
            self.send_header("X-Lab-Queries", str(stats["queries"]))
            self.end_headers()
            try: self.wfile.write(response.content)
            except (BrokenPipeError, ConnectionResetError): pass
            close_old_connections()
        def dispatch(self):
            try:
                self.handle_request()
            finally:
                # ThreadingHTTPServer uses a new thread per request. A Django
                # persistent connection must not remain attached to a dead one.
                connections.close_all()
        do_GET = do_POST = do_DELETE = dispatch
        def log_message(self, *args): pass
    class OwnedServer(ThreadingHTTPServer):
        allow_reuse_address = False
        def server_bind(self):
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()
    server = OwnedServer(("127.0.0.1", port), Handler)
    writer = OwnedServer(("127.0.0.1", port+1), Handler)
    threading.Thread(target=writer.serve_forever, daemon=True).start()
    (run / "ready.json").write_text(json.dumps({"fixture": "sales-performance-pg-v1", "port": port, "databasePort": connection.settings_dict["PORT"]}), encoding="utf-8")
    print(f"Synthetic PostgreSQL sales UI backend ready: 127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    finally:
        writer.shutdown(); writer.server_close(); server.server_close()
