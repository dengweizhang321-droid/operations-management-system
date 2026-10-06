"""Fixed signed owning-reader transport with the existing bounded HTTP seam."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from netshop.bounded_consumer_http import open_bounded_bi_reader_request

from .errors import BiApiError

SOURCES = {
    "targets": ("FINANCE", "/api/finance/erp-targets", "X-Finance-Data-Revision", "finance-erp-targets-v1"),
    "operations": ("WORKFLOW", "/api/workflow/bi-status", "X-Workflow-Data-Revision", "workflow-bi-status-v1"),
    "inventory": ("INVENTORY", "/api/inventory/bi-cockpit", "X-Inventory-Data-Revision", "inventory-bi-cockpit-v1"),
    "flow": ("NETSHOP", "/api/netshop/bi-flow", "X-Netshop-Data-Revision", "netshop-bi-flow-v1"),
}
MAX_BYTES = 2 * 1024 * 1024
MAX_SAFE = 9_007_199_254_740_991


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def _numbers(value, depth=0):
    if depth > 30:
        raise ValueError("depth")
    if isinstance(value, float) and (not math.isfinite(value) or abs(value) > MAX_SAFE) or isinstance(value, int) and not isinstance(value, bool) and abs(value) > MAX_SAFE:
        raise ValueError("unsafe number")
    if isinstance(value, dict):
        for child in value.values():
            _numbers(child, depth + 1)
    elif isinstance(value, list):
        if len(value) > 1000:
            raise ValueError("unbounded array")
        for child in value:
            _numbers(child, depth + 1)


def _read_once(principal, source, params, *, deadline):
    domain, path, header, schema = SOURCES[source]
    base = os.getenv(f"TERUISI_DJANGO_{domain}_READER_BASE_URL", "").strip()
    secret = os.getenv("TERUISI_DJANGO_INTERNAL_SECRET", "")
    try:
        address = urllib.parse.urlsplit(base)
        if address.scheme not in {"http", "https"} or address.hostname not in {"127.0.0.1", "localhost", "::1"} or address.username or address.password or address.path not in {"", "/"} or address.query or address.fragment or not address.port or not secret:
            raise ValueError()
    except ValueError as error:
        raise BiApiError(f"{source}所属读取服务未配置", code="source_not_configured", status=503) from error
    end = min(time.monotonic() + 8, deadline)
    query = urllib.parse.urlencode(params)
    actor = json.dumps({"email": principal.email, "displayName": principal.display_name, "role": principal.role, "scope": principal.scope}, ensure_ascii=False, separators=(",", ":")).encode()
    envelope = base64.urlsafe_b64encode(actor).rstrip(b"=").decode()
    timestamp, request_id = str(int(time.time())), str(uuid.uuid4())
    empty = hashlib.sha256(b"").hexdigest()
    message = "\n".join(["v1", timestamp, request_id, "GET", path, query, empty, envelope])
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(base.rstrip("/") + path + ("?" + query if query else ""), method="GET", headers={
        "Accept": "application/json", "X-Teruisi-Principal": envelope, "X-Teruisi-Timestamp": timestamp,
        "X-Teruisi-Request-Id": request_id, "X-Teruisi-Content-SHA256": empty, "X-Teruisi-Signature": "v1=" + signature,
    })
    try:
        with open_bounded_bi_reader_request(request, deadline=end) as response:
            if response.status != 200 or not re.match(r"^application/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)", response.headers.get("Content-Type", ""), re.I):
                raise ValueError("content type")
            declared = response.headers.get("Content-Length")
            if declared is not None and (not re.fullmatch(r"\d+", declared) or int(declared) > MAX_BYTES):
                raise ValueError("declared size")
            revision = response.headers.get(header, "")
            if not re.fullmatch(r"(?:0|[1-9]\d*):[a-z0-9:]{1,120}", revision):
                raise ValueError("revision")
            chunks, length = [], 0
            reader = getattr(response, "read1", None) or response.read
            while True:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                if sock is not None:
                    sock.settimeout(remaining)
                chunk = reader(min(32768, MAX_BYTES + 1 - length))
                if time.monotonic() >= end:
                    raise TimeoutError()
                if not chunk:
                    break
                chunks.append(chunk); length += len(chunk)
                if length > MAX_BYTES:
                    raise BiApiError("所属数据超过2MiB，未截断", code="capacity_exceeded", status=413)
            if declared is not None and length != int(declared):
                raise ValueError("body length")
            data = json.loads(b"".join(chunks).decode("utf8"), object_pairs_hook=_unique)
            if not isinstance(data, dict) or data.get("schemaVersion") != schema:
                raise ValueError("schema")
            if source == "targets" and (data.get("year") != params["year"] or data.get("month") != params["month"] or data.get("basis") != "erp_net_sales" or data.get("complete") is not True or not isinstance(data.get("items"), list) or len(data["items"]) > 200):
                raise ValueError("target scope")
            if source == "targets":
                for row in data["items"]:
                    if not isinstance(row, dict) or row.get("basis") != "erp_net_sales" or row.get("periodType") not in {"year", "month"} or row.get("periodKey") != params["year" if row.get("periodType") == "year" else "month"]:
                        raise ValueError("target identity")
                    if any(not isinstance(row.get(key), str) or len(row[key]) > maximum for key, maximum in (("id", 128), ("platform", 100), ("shopName", 100), ("updatedAt", 100))) or not row["id"] or bool(row["platform"]) != bool(row["shopName"]):
                        raise ValueError("target labels")
                    if type(row.get("salesTargetCents")) is not int or not 0 <= row["salesTargetCents"] <= MAX_SAFE or type(row.get("version")) is not int or not 1 <= row["version"] <= MAX_SAFE:
                        raise ValueError("target amount/version")
            if source == "operations" and (data.get("mine") is not (params.get("mine") == "1") or not isinstance(data.get("groups"), list) or len(data["groups"]) != 6):
                raise ValueError("operations scope")
            if source == "flow" and data.get("status") == "ready":
                current = data.get("periods", {}).get("current", {})
                if current.get("startDate") != params["startDate"] or current.get("endDate") != params["endDate"] or not isinstance(data.get("shops"), list) or len(data["shops"]) > 100:
                    raise ValueError("flow scope")
            _numbers(data)
            return {"status": "ready", "revision": revision, "data": data, "source": source}
    except urllib.error.HTTPError as error:
        if error.code in {401, 403}:
            raise BiApiError("所属读取权限拒绝", code="access_denied", status=error.code) from None
        raise BiApiError(f"{source}所属服务不可用", code="source_unavailable", status=503) from None
    except BiApiError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, OSError, urllib.error.URLError, UnicodeError, RecursionError) as error:
        raise BiApiError(f"{source}所属读取失败", code="source_unavailable", status=503) from error


def _comparison(current, baseline):
    result = {}
    for key, value in current.items():
        other = baseline.get(key)
        method = "percentage_points" if value["unit"] == "RATIO" else "relative_change"
        valid = value["status"] == "available" and other and other["status"] == "available"
        a, b = value["value"], other["value"] if other else None
        if not valid or method == "relative_change" and (b is None or b <= 0):
            result[key] = {"value": None, "method": method, "status": "unavailable", "reasonCode": "incomplete_or_nonpositive_baseline"}
        else:
            result[key] = {"value": (a-b)*100 if method == "percentage_points" else (a-b)/b, "method": method, "status": "available", "reasonCode": None}
    return result


def read(principal, source, params, *, deadline):
    current = _read_once(principal, source, params, deadline=deadline)
    if source != "flow" or current["data"].get("status") != "ready":
        return current
    # Read current and comparison as separate fixed owning RPCs, each retaining
    # the original 8-second budget. BI's whole 65-second budget still applies.
    # This avoids one monthly request rescanning both wide source intervals.
    window = current["data"]["periods"]["previous"]
    previous = _read_once(principal, source, {**params, "startDate": window["startDate"], "endDate": window["endDate"], "periodKind": "custom"}, deadline=deadline)
    if previous["revision"] != current["revision"] or previous["data"].get("status") != "ready":
        raise BiApiError("网店比较读取期间来源变化", code="revision_changed", status=409)
    data, prior = current["data"], previous["data"]
    data["comparisons"] = _comparison(data["summary"], prior["summary"])
    for row in data["platforms"]:
        old = next((item for item in prior["platforms"] if item["platform"] == row["platform"]), None)
        row["comparisons"] = _comparison(row["metrics"], old["metrics"] if old else {})
    for row in data["shops"]:
        old = next((item for item in prior["shops"] if (item["platform"], item["shopName"]) == (row["platform"], row["shopName"])), None)
        row["comparisons"] = _comparison(row["metrics"], old["metrics"] if old else {})
    data["comparisonWindow"] = window
    _numbers(data)
    return current
