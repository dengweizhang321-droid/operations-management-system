"""Small passive contracts shared by the owning business writers.

This module does not import AI models or grant cross-domain database access.
"""
import hashlib
import json
import re
import base64
import hmac
import http.client
import os
import time


PREFIX = "pi-business:"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def action_request_id(action_id, error_type):
    if not isinstance(action_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", action_id):
        raise error_type("业务操作标识无效")
    return PREFIX + action_id


def receipt(request_id, model, principal, expected_path, error_type):
    row = model.objects.filter(request_id=request_id).first()
    if row is None:
        return {"status": "unknown", "receiptFound": False, "mayReplay": False}
    if row.actor_email != principal.email.strip().lower() or row.path != expected_path or row.method != "POST":
        raise error_type("业务操作回执不在当前授权范围", code="access_denied", status=403)
    if row.status == "completed":
        return row.response_payload
    return {"status": "unknown", "receiptFound": True, "mayReplay": False}


def admit(action_id, dispatch_token, principal, error_type):
    """Exact signed AI callback; owning writers never read AI database tables.

    This check runs immediately before the owning transaction's mutation. The
    AI queue owns stop/current-principal ordering, while this domain retains its
    own authority and atomic business/receipt commit.
    """
    if not isinstance(dispatch_token, str) or not 1 <= len(dispatch_token) <= 200:
        raise error_type("业务派发凭证无效", code="access_denied", status=403)
    secret = os.getenv("TERUISI_DJANGO_INTERNAL_SECRET", "")
    if len(secret.encode()) < 32:
        raise error_type("内部签名服务未配置", code="service_unavailable", status=503)
    path = "/api/ai/pi/business-admission"
    payload = canonical({"actionId": action_id, "dispatchToken": dispatch_token}).encode()
    stamp = str(int(time.time()))
    request_id = "pi-admit-" + hashlib.sha256(payload).hexdigest()[:48]
    actor = base64.urlsafe_b64encode(canonical({"email": principal.email, "displayName": principal.display_name,
        "role": principal.role, "scope": principal.scope}).encode()).decode().rstrip("=")
    sha = hashlib.sha256(payload).hexdigest()
    signature = hmac.new(secret.encode(), "\n".join(["v1", stamp, request_id, "POST", path, "", sha, actor]).encode(), hashlib.sha256).hexdigest()
    # No model-controlled URL, proxy, DNS lookup or redirect handling exists.
    connection = http.client.HTTPConnection("127.0.0.1", 8112, timeout=5)
    try:
        connection.request("POST", path, body=payload, headers={"Content-Type": "application/json",
            "X-Teruisi-Principal": actor, "X-Teruisi-Timestamp": stamp, "X-Teruisi-Request-Id": request_id,
            "X-Teruisi-Content-SHA256": sha, "X-Teruisi-Signature": "v1=" + signature})
        response = connection.getresponse()
        raw = response.read(8193)
        if len(raw) > 8192 or response.status != 200:
            raise ValueError()
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise ValueError()
    except (OSError, ValueError, http.client.HTTPException):
        raise error_type("当前业务操作准入已失效或无法核实", code="business_admission_denied", status=409) from None
    finally:
        connection.close()
