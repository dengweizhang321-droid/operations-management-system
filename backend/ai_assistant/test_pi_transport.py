import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory, override_settings
from . import pi_transport, pi_worker
from .policy import AiError, canonical


@override_settings(DJANGO_ENVIRONMENT="test")
class PiTransportTests(SimpleTestCase):
    def test_gateway_hmac_binds_exact_path_body_and_nonce(self):
        secret = "isolated-pi-signing-key-"+"x"*40
        raw = canonical({"kind": "model"}).encode()
        stamp, nonce = str(int(time.time())), "a"*32
        identity = "\n".join(("pi-gateway-v1", "runner-to-django", "POST", "/api/ai/pi/gateway", stamp, nonce, hashlib.sha256(raw).hexdigest()))
        signature = hmac.new(secret.encode(), identity.encode(), hashlib.sha256).hexdigest()
        request = RequestFactory().post("/api/ai/pi/gateway", raw, content_type="application/json",
            headers={"X-Pi-Timestamp": stamp, "X-Pi-Nonce": nonce, "X-Pi-Signature": signature})
        with patch.dict(os.environ, {"PI_RUNNER_HMAC_SECRET": secret, "PI_RUNNER_HMAC_KEY_FILE": ""}):
            self.assertEqual(pi_transport.verify_gateway(request), nonce)
            request.path = "/api/ai/pi/gateway/"
            with self.assertRaises(AiError): pi_transport.verify_gateway(request)

    @override_settings(DJANGO_ENVIRONMENT="production")
    def test_production_rejects_plain_environment_secret(self):
        with patch.dict(os.environ, {"PI_RUNNER_HMAC_SECRET": "x"*64, "PI_RUNNER_HMAC_KEY_FILE": ""}):
            with self.assertRaises(AiError): pi_transport.secret()

    def test_dpapi_key_is_independent_and_roundtrips_without_plaintext_file(self):
        if os.name != "nt": self.skipTest("Windows DPAPI contract")
        import base64
        from pandas_runner.key_file import dpapi
        key = secrets.token_bytes(32)
        with tempfile.TemporaryDirectory(prefix="pi-key-") as root:
            file = Path(root)/"pi.dpapi.json"
            file.write_text(json.dumps({"version": 1, "keyDpapiBase64": base64.b64encode(dpapi(key, protect=True)).decode()}), encoding="utf-8")
            self.assertNotIn(key, file.read_bytes())
            with patch.dict(os.environ, {"PI_RUNNER_HMAC_KEY_FILE": str(file)}):
                self.assertEqual(pi_transport.secret(), key)

    def test_command_has_separate_startup_timeout_and_never_retries(self):
        value = {"operationId": "op", "ownerId": "owner", "conversationId": "conversation", "epoch": 1, "generation": 1, "seq": 1,
            "command": "create", "payload": {}}
        with patch.object(pi_transport, "secret", return_value=b"x"*32), patch.object(pi_transport.http.client, "HTTPConnection") as connection:
            connection.return_value.request.side_effect = OSError("synthetic send outcome unknown")
            with self.assertRaises(AiError): pi_transport.command(value)
            self.assertEqual(connection.call_count, 1)
            self.assertEqual(connection.call_args.kwargs["timeout"], 60)
            self.assertEqual(connection.return_value.request.call_count, 1)

    def test_control_stop_uses_exact_worker_token(self):
        with tempfile.TemporaryDirectory(prefix="pi-control-") as root:
            path = Path(root)/"control.json"
            token = secrets.token_hex(16)
            path.write_text(json.dumps({"version": 1, "token": token, "intent": "running"}))
            stopped = threading.Event()
            monitor = threading.Thread(target=pi_worker.lifecycle_control, args=(path, token, stopped))
            monitor.start()
            self.assertFalse(stopped.wait(.3))
            path.write_text(json.dumps({"version": 1, "token": token, "intent": "stop"}))
            self.assertTrue(stopped.wait(2))
            monitor.join(timeout=2)
