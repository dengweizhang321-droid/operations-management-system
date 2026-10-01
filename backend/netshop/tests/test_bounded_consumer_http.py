"""Owned-loopback transport tests; no business data, DB or grants."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
import urllib.error
import urllib.request

from django.test import SimpleTestCase
from netshop.bounded_consumer_http import open_bounded_consumer_request, ConsumerDeadlineExceeded


class BoundedConsumerHttpTests(SimpleTestCase):
    def test_no_redirect_no_arbitrary_paths_and_normal_response_close(self):
        visited = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                visited.append(self.path)
                if self.headers.get("X-Redirect") == "yes":
                    self.send_response(302); self.send_header("Location", "/unapproved"); self.end_headers()
                else:
                    self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True); thread.start()
        base = "http://127.0.0.1:" + str(server.server_port)
        try:
            request = urllib.request.Request(base + "/api/finance/consumers/query", data=b"{}", method="POST")
            with open_bounded_consumer_request(request, deadline=time.monotonic()+1) as response:
                self.assertEqual(response.read1(16), b"{}")
            self.assertTrue(response.closed)
            request.add_header("X-Redirect", "yes")
            with self.assertRaises(urllib.error.HTTPError) as redirect:
                with open_bounded_consumer_request(request, deadline=time.monotonic()+1): pass
            self.assertEqual(redirect.exception.code, 302)
            self.assertNotIn("/unapproved", visited)
            for path in ("/api/finance/imports", "/api/finance/targets", "/unapproved"):
                with self.assertRaises(ValueError):
                    with open_bounded_consumer_request(urllib.request.Request(base+path, data=b"{}", method="POST"), deadline=time.monotonic()+1): pass
            with self.assertRaises(ConsumerDeadlineExceeded):
                with open_bounded_consumer_request(request, deadline=time.monotonic()-1): pass
        finally:
            server.shutdown(); server.server_close(); thread.join(2)
        self.assertFalse(thread.is_alive())
