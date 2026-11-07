"""Broker stage correlation across the original signed HTTP protocol."""
import hashlib
import http.client
from http.server import HTTPServer
from threading import Thread
import time
import unittest
import uuid

from . import test_runner as fixtures
from .protocol import PATH, encode, signature
from .server import Handler


class BrokerStageTests(unittest.TestCase):
    def test_signed_failures_retain_redacted_inner_stage(self):
        for options, failed_stage, error_code in [
            ({"fail_start": True}, "container_execute", "execution_timeout"),
            ({"raw": b'{"private-fixture":"forged"}'}, "container_result_validation", "invalid_result"),
            ({"fail_cleanup": True}, "container_cleanup", "cleanup_failed"),
        ]:
            with self.subTest(options=options):
                broker = fixtures.BrokerTests().broker(**options)
                broker.key = b"k" * 32
                broker.reserve = lambda nonce, stamp: None
                events = []
                server = HTTPServer(("127.0.0.1", 0), Handler)
                server.broker = broker
                server.pandas_stage_sink = events.append
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                nonce, stamp = uuid.uuid4().hex, str(int(time.time()))
                body = encode({**fixtures.JOB, "code": "# private-fixture"})
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                try:
                    connection.request("POST", PATH, body=body, headers={"Content-Type": "application/json",
                        "X-Nonce": nonce, "X-Timestamp": stamp, "X-Signature": signature(broker.key, stamp, nonce, body)})
                    response = connection.getresponse()
                    raw = response.read()
                    self.assertEqual(response.status, 503)
                    self.assertEqual(raw, b'{"error":"sandbox_failed"}')
                    self.assertEqual(response.getheader("X-Signature"), signature(broker.key, stamp, nonce, raw, "response"))
                finally:
                    connection.close()
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=2)
                self.assertEqual({event["brokerRef"] for event in events}, {hashlib.sha256(nonce.encode()).hexdigest()})
                self.assertIn((failed_stage, error_code), [(event["stage"], event.get("code")) for event in events])
                self.assertIn("container_cleanup", {event["stage"] for event in events})
                self.assertNotIn("private-fixture", str(events))
                self.assertNotIn(nonce, str(events))
