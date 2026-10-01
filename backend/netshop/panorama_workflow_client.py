"""S-only signed reader of existing, precisely filtered workflow records.

This adapter projects the owning GET; it creates no event model or aggregation.
No fallback endpoint, user URL, proxy or redirect is accepted. Each response is
bounded and fenced; repeated revision equality is not an atomic snapshot.
"""
from __future__ import annotations

import base64
from datetime import date, datetime, time as daytime, timedelta, timezone
import hashlib
import hmac
import http.client
import json
from math import isfinite
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

from .errors import NetshopApiError
from .insights_common import actor_fence
from .query import _canonical_token

SCHEMA_VERSION = "netshop-panorama-workflow-v1"
PATH = "/api/workflow/operations-records"
MAX_BYTES = 2 * 1024 * 1024
MAX_SAFE = 9_007_199_254_740_991
READ_ROLES = {"viewer", "analyst", "operator", "admin"}
REVISION_RE = re.compile(r"^(?:0|[1-9]\d*):[a-f0-9]{12}$")


def _unavailable():
    return NetshopApiError("所属经营事件只读服务暂时不可用", code="service_unavailable", status=503)


def _remaining(deadline):
    if type(deadline) not in {int, float} or not isfinite(deadline):
        raise NetshopApiError("经营事件内部读取期限无效")
    value = deadline - time.monotonic()
    if value <= 0:
        raise NetshopApiError("经营事件读取已耗尽全景整体预算", code="source_not_ready", status=503)
    return min(8.0, value)


def _text(value, maximum, *, empty=False):
    if type(value) is not str or len(value) > maximum or not empty and not value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise _unavailable()
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError as error:
        raise _unavailable() from error
    return value


def _utc(value):
    if type(value) is not str or len(value) > 48:
        raise _unavailable()
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError("Source timestamp is not offset-aware")
        return result.astimezone(timezone.utc)
    except (ValueError, OverflowError) as error:
        raise _unavailable() from error


def _iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parameters(scope, page, page_size):
    if not isinstance(scope, dict) or set(scope) != {"platform", "shopName", "startDate", "endDate"}:
        raise NetshopApiError("经营事件须精确店铺和自然日期范围")
    platform = _text(scope["platform"], 100)
    shop = _text(scope["shopName"], 100)
    if platform not in {"京东", "天猫"}:
        raise NetshopApiError("经营事件平台无效")
    try:
        first, last = date.fromisoformat(scope["startDate"]), date.fromisoformat(scope["endDate"])
    except (TypeError, ValueError) as error:
        raise NetshopApiError("经营事件自然日期无效") from error
    if first.isoformat() != scope["startDate"] or last.isoformat() != scope["endDate"] or not 1 <= (last - first).days + 1 <= 366:
        raise NetshopApiError("经营事件范围须为1—366个自然日")
    if type(page) is not int or not 1 <= page <= 5000 or type(page_size) is not int or page_size not in {5, 10, 20} or (page - 1) * page_size > 100000:
        raise NetshopApiError("经营事件有界分页无效")
    tz = ZoneInfo("Asia/Shanghai")
    try:
        start = datetime.combine(first, daytime.min, tzinfo=tz)
        end = datetime.combine(last + timedelta(days=1), daytime.min, tzinfo=tz)
    except OverflowError as error:
        raise NetshopApiError("经营事件日期端点超出安全范围") from error
    return {"platform": platform, "shopName": shop, "from": _iso(start), "to": _iso(end), "page": page, "pageSize": page_size}


def _config():
    value = os.getenv("TERUISI_DJANGO_WORKFLOW_READER_BASE_URL", "").strip()
    secret = os.getenv("TERUISI_DJANGO_INTERNAL_SECRET", "")
    try:
        parsed = urllib.parse.urlsplit(value)
        parsed.port
    except ValueError as error:
        raise _unavailable() from error
    if (not value or len(value) > 2000 or any(c.isspace() or ord(c) < 32 for c in value)
            or parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or not parsed.hostname
            or parsed.scheme == "http" and parsed.hostname.lower() not in {"127.0.0.1", "localhost", "::1"}
            or len(secret.encode("utf-8")) < 32):
        raise _unavailable()
    return value.rstrip("/"), secret


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fp.close()
        raise _unavailable()


def _signed_request(principal, base, secret, parameters):
    query = urllib.parse.urlencode(parameters)
    envelope = base64.urlsafe_b64encode(json.dumps({"email": principal.email, "displayName": principal.display_name, "role": principal.role, "scope": principal.scope},
                                                  ensure_ascii=False, separators=(",", ":")).encode("utf-8")).rstrip(b"=").decode("ascii")
    timestamp, request_id = str(int(time.time())), str(uuid.uuid4())
    digest = hashlib.sha256(b"").hexdigest()
    canonical = "\n".join(["v1", timestamp, request_id, "GET", PATH, query, digest, envelope])
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return urllib.request.Request(base + PATH + "?" + query, method="GET", headers={
        "Accept": "application/json", "X-Teruisi-Principal": envelope, "X-Teruisi-Timestamp": timestamp,
        "X-Teruisi-Request-Id": request_id, "X-Teruisi-Content-SHA256": digest, "X-Teruisi-Signature": "v1=" + signature,
    })


def _authority(status):
    if status in {401, 403, 409}:
        raise NetshopApiError("经营事件来源身份或参与版本已失效", status=status,
                              code={401: "authentication_required", 403: "access_denied", 409: "insights_revision_changed"}[status])


def _strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate source field")
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=pairs,
                           parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("Non-finite source number")))
    except (UnicodeError, ValueError, RecursionError) as error:
        raise _unavailable() from error
    if not isinstance(value, dict):
        raise _unavailable()
    codes = {"authentication_required": 401, "unauthenticated": 401, "access_denied": 403, "insufficient_role": 403, "insights_revision_changed": 409}
    if type(value.get("code")) is str and value["code"] in codes:
        _authority(codes[value["code"]])
    return value


def _api_get(principal, parameters, deadline, *, expected_revision=None):
    base, secret = _config()
    request = _signed_request(principal, base, secret, parameters)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        try:
            response = opener.open(request, timeout=_remaining(deadline))
        except urllib.error.HTTPError as error:
            try:
                _authority(error.code)  # Never inspect an authority response body first.
                _remaining(deadline)
                raise _unavailable() from error
            finally:
                error.close()
        with response:
            _authority(response.status)
            _remaining(deadline)
            if response.status != 200:
                raise _unavailable()
            revisions = response.headers.get_all("X-Workflow-Data-Revision", [])
            if len(revisions) != 1 or not REVISION_RE.fullmatch(revisions[0]):
                raise _unavailable()
            revision = revisions[0]
            if expected_revision is not None and revision != expected_revision:
                raise NetshopApiError("经营事件参与版本已变化", code="insights_revision_changed", status=409)
            content_type = response.headers.get("Content-Type", "")
            if not re.match(r"^application/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)", content_type, re.I):
                raise _unavailable()
            charset = re.search(r"charset\s*=\s*([^;]+)", content_type, re.I)
            if charset and charset.group(1).strip().strip('"').lower() not in {"utf-8", "utf8"}:
                raise _unavailable()
            lengths = response.headers.get_all("Content-Length", [])
            if len(lengths) > 1 or lengths and (not lengths[0].isascii() or not lengths[0].isdigit() or int(lengths[0]) > MAX_BYTES):
                raise _unavailable()
            chunks, size = [], 0
            while True:
                timeout = _remaining(deadline)
                sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                if sock is not None:
                    sock.settimeout(timeout)
                chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
                _remaining(deadline)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise _unavailable()
                chunks.append(chunk)
            if lengths and size != int(lengths[0]):
                raise _unavailable()
            return _strict_json(b"".join(chunks)), revision
    except InterruptedError:
        raise  # An interrupted caller is not a recoverable source partial.
    except (urllib.error.URLError, TimeoutError, socket.timeout, UnicodeError, OSError, http.client.HTTPException) as error:
        _remaining(deadline)
        raise _unavailable() from error


def _project(payload, principal, scope, parameters, revision, scope_key):
    filters = payload.get("filtersApplied")
    if not isinstance(filters, dict):
        raise _unavailable()
    expected = {"types": [], "statuses": [], "shopNames": [parameters["shopName"]], "platforms": [parameters["platform"]], "owners": [],
                "query": "", "from": parameters["from"], "to": parameters["to"], "page": parameters["page"], "pageSize": parameters["pageSize"],
                "dataScope": "unrestricted" if principal.scope is None else "restricted"}
    if set(filters) != set(expected) or any(type(filters[key]) is not type(value) or filters[key] != value for key, value in expected.items()):
        raise _unavailable()
    rows, pagination = payload.get("items"), payload.get("pagination")
    if not isinstance(rows, list) or len(rows) > parameters["pageSize"] or not isinstance(pagination, dict) or set(pagination) != {"page", "pageSize", "total", "returned", "truncated"}:
        raise _unavailable()
    if any(type(pagination.get(k)) is not int or not 0 <= pagination[k] <= MAX_SAFE for k in ("page", "pageSize", "total", "returned")):
        raise _unavailable()
    offset = (parameters["page"] - 1) * parameters["pageSize"]
    returned = min(parameters["pageSize"], max(0, pagination["total"] - offset))
    if (pagination["page"] != parameters["page"] or pagination["pageSize"] != parameters["pageSize"] or pagination["returned"] != len(rows)
            or len(rows) != returned or type(pagination["truncated"]) is not bool or pagination["truncated"] != (offset + returned < pagination["total"])):
        raise _unavailable()
    items, identities = [], set()
    start, end = _utc(parameters["from"]), _utc(parameters["to"])
    for row in rows:
        if not isinstance(row, dict) or row.get("platform") != parameters["platform"] or row.get("shopName") != parameters["shopName"]:
            raise _unavailable()
        identity = _text(row.get("id"), 128)
        occurred = _utc(row.get("occurredAt"))
        if identity in identities or not start <= occurred < end:
            raise _unavailable()
        if principal.scope is not None and row.get("platform") not in principal.scope["platforms"] and row.get("channel") not in principal.scope["channels"]:
            raise NetshopApiError("经营事件来源返回越权记录", code="access_denied", status=403)
        identities.add(identity)
        items.append({"id": identity, "occurredAt": _iso(occurred), "title": _text(row.get("title"), 200),
                      "status": _text(row.get("status"), 24), "eventType": _text(row.get("type"), 16)})
    return {"schemaVersion": SCHEMA_VERSION, "scope": dict(scope), "sourceRevisions": [{"domain": "workflow", "kind": "owning_revision", "scopeKey": scope_key, "revision": revision}],
            "items": items, "pagination": dict(pagination), "limitations": [
                "只读既有运营记录的发生时间与原类型/状态，不推断经营变化因果",
                "仅返回明确分页；truncated表示仍有后续页，不冒充整个历史事件集合",
                "来源版本经过同参数重读核验；与网店来源仍为non_atomic跨域观察",
            ]}


def read_panorama_workflow(principal, scope, *, deadline, page=1, page_size=20):
    _remaining(deadline)
    if principal.role not in READ_ROLES:
        raise NetshopApiError("当前角色无权读取经营事件", code="access_denied", status=403)
    actor = actor_fence(principal)
    parameters = _parameters(scope, page, page_size)
    scope_key = _canonical_token({"version": SCHEMA_VERSION, "parameters": parameters, "actor": actor})
    raw, revision = _api_get(principal, parameters, deadline)
    data = _project(raw, principal, scope, parameters, revision, scope_key)
    repeated, _ = _api_get(principal, parameters, deadline, expected_revision=revision)
    _project(repeated, principal, scope, parameters, revision, scope_key)
    if actor_fence(principal) != actor:
        raise NetshopApiError("经营事件取数期间账号权限变化", code="access_denied", status=403)
    _remaining(deadline)
    return data


def verify_panorama_workflow(principal, data, *, deadline):
    """Final S fence re-reads this exact GET; no timestamp substitutes revision."""
    _remaining(deadline)
    actor = actor_fence(principal)
    pagination = data["pagination"]
    parameters = _parameters(data["scope"], pagination["page"], pagination["pageSize"])
    ref = data["sourceRevisions"][0]
    if ref["scopeKey"] != _canonical_token({"version": SCHEMA_VERSION, "parameters": parameters, "actor": actor}):
        raise NetshopApiError("经营事件账号或参与范围已变化", code="access_denied", status=403)
    raw, _ = _api_get(principal, parameters, deadline, expected_revision=ref["revision"])
    _project(raw, principal, data["scope"], parameters, ref["revision"], ref["scopeKey"])
    if actor_fence(principal) != actor:
        raise NetshopApiError("经营事件最终核验期间账号权限变化", code="access_denied", status=403)
    _remaining(deadline)
