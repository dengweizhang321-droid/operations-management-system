"""Registered native n8n entry; no arbitrary workflow, URL or platform call.

Native execution metadata is observed read-only. A webhook acknowledgement is
acceptance only; completion additionally requires exact native stage receipts
and authoritative coverage. Unsupported installed graphs fail before dispatch.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import http.client
import hashlib
import json
import re
import sqlite3
import time

from django.conf import settings
from django.db import transaction
from django.views.decorators.http import require_POST

from common.pi_business_contract import action_request_id, admit, canonical, digest, receipt
from .errors import WorkflowApiError
from .models import WorkflowWriteRequestReceipt
from .operations_views import WRITE_ROLES, _operations_principal
from .views import _body, _error, _json
from .write_requests import claim_write_request, complete_write_request, lock_active_operations_authority


PATH = "/api/workflow/pi-business-n8n"
CAPABILITY = "tmall-seven-day-gap-v1"
STORES = {"tmall-" + value for value in ("yijiu", "lili", "tuofeng", "yiyong", "cuizhiwang", "masitu")}
MAX_EXECUTIONS = 128
MAX_DATA_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024


def _need(value, message="原生工作流证据无法核实", code="n8n_binding_unavailable", status=409):
    if not value:
        raise WorkflowApiError(message, code=code, status=status)


def _document(path, maximum):
    path = Path(path)
    _need(path.is_file() and not any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (path, *path.parents)))
    _need(0 < path.stat().st_size <= maximum)
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    _need(isinstance(value, dict))
    return value


def _template(store_key):
    _need(store_key in STORES, "该店铺没有登记可执行的补缺能力", "unsupported_registered_capability")
    root = settings.BASE_DIR.parent
    definition = _document(root / "automation" / "n8n" / "pi-business" / (store_key + "-pi-business.candidate.workflow.json"), 256 * 1024)
    stores = _document(root / "config" / "tmall-store-accounts.json", 128 * 1024).get("stores")
    _need(isinstance(stores, list) and len(stores) <= 30)
    matches = [s for s in stores if s.get("storeKey") == store_key and s.get("enabled") is True and s.get("platform") == "天猫"]
    _need(len(matches) == 1, "受控店铺注册状态已改变")
    return definition, matches[0]


def _graph(definition):
    _need(isinstance(definition.get("nodes"), list) and 1 <= len(definition["nodes"]) <= 100
        and isinstance(definition.get("connections"), dict) and isinstance(definition.get("settings"), dict))
    return {key: definition[key] for key in ("nodes", "connections", "settings")}


def _database():
    configured = getattr(settings, "N8N_STATUS_DATABASE_PATH", "")
    _need(bool(configured), "尚未配置原生n8n只读元数据来源", status=503)
    path = Path(configured)
    _need(path.is_absolute() and path.is_file() and not any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (path, *path.parents)))
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=.5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    deadline = time.monotonic() + 3
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    return db


def _native(definition):
    db = _database()
    try:
        row = db.execute('SELECT id,active,"versionId","activeVersionId",nodes,connections,settings FROM workflow_entity '
            'WHERE id=? AND "isArchived"=0', [definition["id"]]).fetchone()
        _need(row is not None and bool(row["active"]), "该登记工作流未激活，不能创建执行")
        graph = {key: json.loads(row[key] or "{}") for key in ("nodes", "connections", "settings")}
        _need(digest(graph) == digest(_graph(definition)), "已安装原生工作流与可信登记版本不一致", "n8n_version_changed")
        _need(isinstance(row["versionId"], str) and row["versionId"] and row["activeVersionId"] == row["versionId"],
            "已安装工作流版本已变化", "n8n_version_changed")
        return {"workflowId": row["id"], "versionId": row["versionId"], "graphDigest": digest(graph)}
    finally:
        db.close()


def _entry(definition):
    store_key = definition.get("meta", {}).get("uniformDirectDaily", {}).get("storeKey")
    _need(store_key in STORES, "登记工作流没有精确店铺身份")
    path = "teruisi-pi-business-" + store_key
    hooks = [n for n in definition["nodes"] if n.get("type") == "n8n-nodes-base.webhook"
        and n.get("name") == "Pi业务执行入口" and n.get("parameters", {}).get("path") == path
        and n.get("parameters", {}).get("httpMethod") == "POST"]
    _need(len(hooks) == 1, "登记工作流入口有歧义")
    anchors = [n for n in definition["nodes"] if n.get("name") == "固定原执行计划时间"]
    _need(len(anchors) == 1 and "piBusiness" in anchors[0].get("parameters", {}).get("jsCode", ""),
        "当前原生工作流尚未采用Pi原生执行标记；本次未创建执行",
        "n8n_pi_entry_unsupported")
    return "/webhook/" + path, hooks[0]["name"]


def _coverage(principal, store, start, end):
    # Use the existing signed Worker transport only at one fixed internal path;
    # unlike AI.edge(), this owning service does not read AI/access-control PG.
    from ai_assistant.transport import bounded_json, signed_headers
    path = "/api/ai/internal/edge"
    payload = {"action": "pi_business_n8n_coverage", "shopName": store["shopName"], "startDate": start, "endDate": end}
    result = bounded_json("http://127.0.0.1:3000" + path, payload, signed_headers(path, payload, principal),
        timeout=20, maximum=128 * 1024, internal=True)
    _need(isinstance(result, dict) and result.get("shopName") == store["shopName"] and result.get("startDate") == start
        and result.get("endDate") == end and result.get("truncated") is False and isinstance(result.get("revision"), str),
        "补缺日期覆盖来源不可核实", "n8n_coverage_unavailable", 503)
    days = [(datetime.fromisoformat(start).date() + timedelta(days=i)).isoformat() for i in range(7)]
    for key in ("productDailyDates", "promotionDates", "productMissingDates", "promotionMissingDates"):
        values = result.get(key)
        _need(isinstance(values, list) and len(values) <= 7 and len(set(values)) == len(values)
            and all(isinstance(day, str) and day in days for day in values), "补缺覆盖返回非法日期", "n8n_coverage_unavailable", 503)
    _need(set(result["productMissingDates"]) == set(days) - set(result["productDailyDates"])
        and set(result["promotionMissingDates"]) == set(days) - set(result["promotionDates"]),
        "补缺覆盖与缺口集合不一致", "n8n_coverage_unavailable", 503)
    return result


def prepare(arguments, principal):
    required = {"capabilityId", "storeKey", "dataset", "startDate", "endDate"}
    _need(isinstance(arguments, dict) and required <= set(arguments)
        and not set(arguments) - required - {"scheduledAt", "registeredVersion"}, "登记补缺参数无效", "invalid_request", 400)
    _need(arguments["capabilityId"] == CAPABILITY and arguments["dataset"] == "product_and_promotion",
        "只开放已登记的天猫商品日与推广日完整补缺能力", "unsupported_registered_capability")
    yesterday = datetime.now().astimezone().date() - timedelta(days=1)
    start, end = (yesterday - timedelta(days=6)).isoformat(), yesterday.isoformat()
    _need(arguments["startDate"] == start and arguments["endDate"] == end,
        "该工作流固定检查截至本地昨天的七个完整日，不支持任意历史范围", "unsupported_workflow_range")
    definition, store = _template(arguments["storeKey"])
    _need(store.get("initialStartDate") and store["initialStartDate"] <= start,
        "该店铺注册不足七日，当前Pi能力未开放变长日期范围", "unsupported_workflow_range")
    binding = _native(definition)
    if "registeredVersion" in arguments:
        _need(arguments["registeredVersion"] == binding["versionId"], "登记工作流版本在确认后变化", "version_conflict")
    scheduled_at = arguments.get("scheduledAt", datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
    try:
        stamp = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
        _need(isinstance(scheduled_at, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", scheduled_at)
            and stamp.tzinfo is not None and stamp.astimezone().date() == datetime.now().astimezone().date(), "执行计划日期已过期", "unsupported_workflow_range")
    except (TypeError, ValueError, AttributeError):
        raise WorkflowApiError("执行计划时间无效") from None
    coverage = _coverage(principal, store, start, end)
    missing = sorted(set(coverage["productMissingDates"]) | set(coverage["promotionMissingDates"]))
    if missing:
        _entry(definition)  # Fail before confirmation/dispatch if native entry is unsupported.
    parameters = dict(arguments)
    parameters.update(scheduledAt=scheduled_at, registeredVersion=binding["versionId"])
    preview = {"objectType": "registered_n8n_gap", **parameters, **binding, "platform": "天猫", "shopName": store["shopName"],
        "coverage": coverage, "missingDates": missing, "noGap": not missing,
        "executionPath": "n8n原生入口 → 原共享helper协调 → A → (B/C/P/N逐日) → M收尾",
        "additionalEffects": "M按既有每日到期规则可能更新本店货品主数据，并关闭本店浏览器及释放helper；不强制M，不修改其节奏",
        "unknownPolicy": "仅观察原生执行与原业务批次；未知提交不重试、不换ID"}
    return {"parameters": parameters, "preview": preview, "targetVersion": digest(preview),
        "scope": {"platform": "天猫", "shopName": store["shopName"], "storeKey": store["storeKey"], "startDate": start, "endDate": end}}, definition, store


def _flatted(raw):
    values = json.loads(raw)
    _need(isinstance(values, list) and 1 <= len(values) <= 50000)
    def ref(value):
        if isinstance(value, str) and value.isascii() and value.isdigit():
            _need(int(value) < len(values))
            return values[int(value)]
        return value
    def obj(value):
        value = ref(value)
        _need(isinstance(value, dict))
        return value
    def array(value):
        value = ref(value)
        _need(isinstance(value, list) and len(value) <= 10000)
        return value
    root = obj(values[0])
    result = obj(root.get("resultData"))
    return ref, obj, array, root, result, obj(result.get("runData"))


def _outputs(run, name, ref, obj, array):
    if name not in run:
        return []
    outputs = []
    for raw_attempt in array(run[name]):
        attempt = obj(raw_attempt)
        _need(ref(attempt.get("executionStatus")) == "success" and not attempt.get("error"))
        data = obj(attempt.get("data"))
        branches = array(data.get("main"))
        _need(len(branches) >= 1)
        for item in array(branches[0]):
            outputs.append(obj(obj(item).get("json")))
    return outputs


def _execution(row, data, expected=None, depth=0):
    _need(depth <= 4, "原生重试链观察已超限", "n8n_execution_binding_conflict")
    definition = json.loads(data["workflowData"])
    _need(isinstance(definition, dict) and definition.get("id") == row["workflowId"] and not definition.get("pinData"))
    stores = []
    for key in STORES:
        template, store = _template(key)
        if template["id"] == row["workflowId"]:
            stores.append((template, store))
    _need(len(stores) == 1)
    template, store = stores[0]
    _need(digest(_graph(definition)) == digest(_graph(template)) and isinstance(definition.get("versionId"), str))
    _, webhook_name = _entry(template)
    ref, obj, array, root, result, run = _flatted(data["data"])
    _need(not root.get("startData") or not obj(root["startData"]))
    _need(not ref(result.get("pinData")))
    hooks = _outputs(run, webhook_name, ref, obj, array)
    original_id = str(row["id"])
    if not hooks:
        retry_nodes = [n for n in template["nodes"] if n.get("type") == "n8n-nodes-base.webhook" and n.get("name") != webhook_name]
        _need(len(retry_nodes) == 1)
        retries = _outputs(run, retry_nodes[0]["name"], ref, obj, array)
        _need(len(retries) == 1)
        body = obj(retries[0].get("body"))
        original_id = ref(body.get("originalExecutionId"))
        _need(ref(body.get("version")) == "teruisi-retry-context-v1" and ref(body.get("workflowId")) == row["workflowId"]
            and isinstance(original_id, str) and re.fullmatch(r"[1-9]\d{0,19}", original_id)
            and original_id != str(row["id"]))
        original = _read_execution_marker(original_id, depth + 1)
        _need(original["workflowId"] == row["workflowId"] and original["storeKey"] == store["storeKey"])
        marker = original["marker"]
        _need(ref(body.get("originalScheduledAt")) == marker["scheduledAt"])
    else:
        _need(len(hooks) == 1)
        body = obj(hooks[0].get("body"))
        marker = obj(body.get("piBusiness"))
        _need(set(marker) == {"actionId", "targetVersion", "dispatchToken", "startDate", "endDate", "scheduledAt"})
        marker = {key: ref(value) for key, value in marker.items()}
    _need(all(isinstance(value, str) and 1 <= len(value) <= 200 for value in marker.values()))
    if expected:
        _need(marker == expected, "原生执行不属于原业务派发", "n8n_execution_binding_conflict")
    return {"marker": marker, "workflowId": row["workflowId"], "versionId": definition["versionId"],
        "storeKey": store["storeKey"], "executionId": str(row["id"]), "status": row["status"],
        "originalExecutionId": original_id,
        "startedAt": row["startedAt"], "finishedAt": row["stoppedAt"], "run": run,
        "helpers": (ref, obj, array), "nativeError": bool(ref(result.get("error")))}


def read_execution_marker(execution_id):
    """Private native admission reader. It never returns arbitrary node output."""
    return _read_execution_marker(execution_id, 0)


def _read_execution_marker(execution_id, depth):
    _need(depth <= 4, "原生重试链观察已超限", "n8n_execution_binding_conflict")
    _need(isinstance(execution_id, str) and re.fullmatch(r"[1-9]\d{0,19}", execution_id))
    db = _database()
    try:
        row = db.execute('SELECT id,"workflowId",status,mode,"startedAt","stoppedAt" FROM execution_entity '
            'WHERE id=? AND "deletedAt" IS NULL AND mode=\'webhook\'', [execution_id]).fetchone()
        _need(row is not None)
        size = db.execute('SELECT length(data),length("workflowData") FROM execution_data WHERE "executionId"=?', [execution_id]).fetchone()
        _need(size is not None and 0 < size[0] <= MAX_DATA_BYTES and 0 < size[1] <= 256 * 1024)
        data = db.execute('SELECT data,"workflowData" FROM execution_data WHERE "executionId"=?', [execution_id]).fetchone()
        parsed = _execution(row, data, depth=depth)
        return {key: value for key, value in parsed.items() if key not in {"run", "helpers", "nativeError"}}
    finally:
        db.close()


def observe(body, principal):
    request_id = action_request_id(body.get("actionId"), WorkflowApiError)
    reservation = WorkflowWriteRequestReceipt.objects.filter(request_id=request_id, path=PATH,
        actor_email=principal.email.lower()).first()
    if reservation is None:
        return {"status": "unknown", "receipt": {"actionId": body["actionId"], "state": "no_reservation", "mayReplay": False}}
    if reservation.status == "completed" and reservation.response_payload.get("status") == "succeeded":
        return reservation.response_payload
    parameters = body.get("parameters")
    _need(isinstance(parameters, dict) and parameters.get("capabilityId") == CAPABILITY)
    template, store = _template(parameters.get("storeKey"))
    expected = {"actionId": body["actionId"], "targetVersion": body.get("targetVersion"), "dispatchToken": body.get("dispatchToken"),
        **{key: parameters[key] for key in ("startDate", "endDate", "scheduledAt")}}
    db = _database()
    matches, total_bytes = [], 0
    try:
        rows = db.execute('SELECT id,"workflowId",status,mode,"startedAt","stoppedAt" FROM execution_entity '
            'WHERE "workflowId"=? AND mode=\'webhook\' AND "deletedAt" IS NULL AND "createdAt">=? ORDER BY id DESC LIMIT ?',
            [template["id"], (reservation.created_at - timedelta(seconds=2)).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), MAX_EXECUTIONS + 1]).fetchall()
        _need(len(rows) <= MAX_EXECUTIONS, "原生执行观察窗口已超限，保留未知", "n8n_observation_incomplete")
        for row in rows:
            size = db.execute('SELECT length(data),length("workflowData") FROM execution_data WHERE "executionId"=?', [row["id"]]).fetchone()
            _need(size is not None and 0 < size[0] <= MAX_DATA_BYTES and 0 < size[1] <= 256 * 1024)
            total_bytes += size[0] + size[1]
            _need(total_bytes <= MAX_TOTAL_BYTES, "原生执行观察字节超限，保留未知", "n8n_observation_incomplete")
            data = db.execute('SELECT data,"workflowData" FROM execution_data WHERE "executionId"=?', [row["id"]]).fetchone()
            try:
                parsed = _execution(row, data)
            except WorkflowApiError:
                continue
            if parsed["marker"]["actionId"] == body["actionId"] and parsed["originalExecutionId"] == parsed["executionId"]:
                _need(parsed["marker"] == expected, "原执行标记发生冲突", "n8n_execution_binding_conflict")
                _need(parsed["versionId"] == parameters["registeredVersion"], "原执行工作流版本不一致", "n8n_execution_binding_conflict")
                matches.append(parsed)
    finally:
        db.close()
    _need(len(matches) <= 1, "同一操作出现多个原生执行，禁止猜测或重放", "n8n_execution_binding_conflict")
    if not matches:
        return {"status": "unknown", "receipt": {"actionId": body["actionId"], "state": "native_execution_not_yet_bound", "mayReplay": False}}
    native = matches[0]
    ref, obj, array = native["helpers"]
    coverage = _coverage(principal, store, parameters["startDate"], parameters["endDate"])
    stages, batch_ids, imports = {}, set(), []
    initial = reservation.response_payload.get("initialGaps", {})
    required_product = initial.get("productMissingDates")
    required_promotion = initial.get("promotionMissingDates")
    _need(isinstance(required_product, list) and isinstance(required_promotion, list), "原派发缺口证据缺失，不能标为完成", "n8n_observation_incomplete")
    for prefix, label in (("B·", "download"), ("C·", "import"), ("P·", "promotion"), ("N·", "coverage"), ("M·", "cleanup")):
        names = [n["name"] for n in template["nodes"] if n["name"].startswith(prefix)]
        _need(len(names) == 1)
        try:
            outputs = _outputs(native["run"], names[0], ref, obj, array)
            _need(all(ref(output.get("ok")) is True for output in outputs))
            if label in {"import", "promotion"}:
                _need(all(ref(output.get("coverageConfirmed")) is True for output in outputs))
            stages[label] = "completed" if outputs else "not_observed"
            # Whitelist direct receipt identifiers only. Arbitrary provider
            # payloads and signed URLs never enter Pi previews/audits.
            for output in outputs:
                for key in ("batchId", "importBatchId", "referenceBatchId"):
                    value = ref(output.get(key))
                    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", value):
                        batch_ids.add(value)
                if label == "import":
                    for item in array(output.get("batches", [])):
                        item = obj(item)
                        batch = ref(item.get("batchId"))
                        day, count, status = ref(item.get("businessDate")), ref(item.get("rowCount")), ref(item.get("status"))
                        _need(ref(item.get("storeKey")) == parameters["storeKey"] and day in required_product
                            and isinstance(batch, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", batch)
                            and type(count) is int and count > 0 and status in {"imported", "duplicate", "completed_with_warnings"})
                        batch_ids.add(batch)
                        imports.append({"dataset": "product_daily", "date": day, "batchId": batch, "rowCount": count, "status": status})
                if label == "promotion" and output.get("batchId") is not None:
                    batch, count = ref(output.get("batchId")), ref(output.get("rowCount"))
                    day = ref(output.get("startDate"))
                    _need(ref(output.get("storeKey")) == parameters["storeKey"] and day in required_promotion
                        and day == ref(output.get("endDate")) and type(count) is int and count > 0
                        and isinstance(batch, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", batch))
                    imports.append({"dataset": "promotion", "date": day, "batchId": batch, "rowCount": count,
                        "status": ref(output.get("status"))})
                if label == "cleanup":
                    closure = obj(output.get("browserClosure"))
                    backfill = obj(output.get("dailyBackfill"))
                    _need(ref(closure.get("ok")) is True and ref(closure.get("status")) in {"closed", "already_closed", "force_closed"}
                        and ref(backfill.get("status")) == "completed" and not array(backfill.get("remainingDates"))
                        and ref(backfill.get("storeKey")) == parameters["storeKey"]
                        and ref(backfill.get("executionId")) == native["executionId"])
        except WorkflowApiError:
            stages[label] = "failed_or_unknown"
    covered = not coverage["productMissingDates"] and not coverage["promotionMissingDates"]
    terminal = native["status"] == "success" and native["finishedAt"] and not native["nativeError"]
    # Exact business batch receipts remain required. A native success or current
    # coverage alone cannot be promoted to completed imports by this adapter.
    product_proven = {item["date"] for item in imports if item["dataset"] == "product_daily"} == set(required_product)
    promotion_proven = {item["date"] for item in imports if item["dataset"] == "promotion"} == set(required_promotion)
    completed = bool(terminal and covered and product_proven and promotion_proven and stages["cleanup"] == "completed"
        and all(stages[k] == "completed" for k in ("download", "import", "promotion", "coverage")))
    state = "succeeded" if completed else "failed" if native["status"] in {"error", "crashed", "canceled"} else "running" if not terminal else "unknown"
    return {"status": state, "objectType": "registered_n8n_execution", "objectId": native["executionId"],
        "executionId": native["executionId"], "receipt": {"actionId": body["actionId"], "executionId": native["executionId"],
            "workflowId": native["workflowId"], "versionId": native["versionId"], "storeKey": native["storeKey"],
            "state": state, "workflowStatus": native["status"], "stages": stages, "batchIds": sorted(batch_ids),
            "imports": imports, "coverage": coverage, "mayReplay": False}}


def capabilities(principal):
    yesterday = datetime.now().astimezone().date() - timedelta(days=1)
    start, end = (yesterday - timedelta(days=6)).isoformat(), yesterday.isoformat()
    items = []
    for store_key in sorted(STORES):
        item = {"capabilityId": CAPABILITY, "storeKey": store_key, "dataset": "product_and_promotion",
            "startDate": start, "endDate": end, "adopted": False, "available": False}
        try:
            definition, store = _template(store_key)
            item["shopName"] = store["shopName"]
            binding = _native(definition)
            _entry(definition)
            item.update(adopted=True, available=True, registeredVersion=binding["versionId"])
        except WorkflowApiError as error:
            item["reason"] = error.code
        except (OSError, ValueError, sqlite3.Error):
            item["reason"] = "n8n_binding_unavailable"
        items.append(item)
    return {"items": items, "limits": {"platform": "天猫", "lookbackDays": 7, "datasets": ["product_and_promotion"],
        "executionPolicy": "原生工作流精确采用后仅补固定范围缺口；无缺口不创建执行；未知结果不重放"}}


@require_POST
def endpoint(request):
    try:
        principal = _operations_principal(request, WRITE_ROLES, unrestricted=True)
        body = _body(request)
        _need(not request.GET, "登记补缺入口不接受查询参数", "invalid_request", 400)
        _need(body.get("kind") == "n8n_gap.run" and body.get("phase") in {"capabilities", "prepare", "execute", "observe"}, "登记补缺请求无效", "invalid_request", 400)
        if body["phase"] == "capabilities":
            _need(set(body) == {"phase", "kind"}, "能力目录参数无效", "invalid_request", 400)
            return _json(capabilities(principal))
        if body["phase"] == "prepare":
            _need(set(body) == {"phase", "kind", "arguments"}, "补缺预览参数无效", "invalid_request", 400)
            return _json(prepare(body["arguments"], principal)[0])
        expected_fields = {"phase", "kind", "actionId", "parameters", "targetVersion", "dispatchToken"}
        _need(set(body) == expected_fields, "补缺执行或观察参数无效", "invalid_request", 400)
        if body["phase"] == "observe":
            return _json(observe(body, principal))
        prepared, template, _store = prepare(body["parameters"], principal)
        _need(prepared["targetVersion"] == body["targetVersion"], "工作流、日期覆盖或业务范围已变化，请重新确认", "version_conflict")
        request_id = action_request_id(body["actionId"], WorkflowApiError)
        _need(request.headers.get("X-Teruisi-Request-Id") == request_id, "派发身份与原回执不一致", "access_denied", 403)
        with transaction.atomic():
            lock_active_operations_authority()
            claim = claim_write_request(request_id=request_id, actor_email=principal.email.lower(), method="POST", path=PATH,
                body_sha256=request.headers.get("X-Teruisi-Content-SHA256", ""), query_sha256=hashlib.sha256(b"").hexdigest(), authority_scope="operations")
            if claim.replay_payload is not None:
                return _json(claim.replay_payload, claim.replay_status)
            initial = {key: prepared["preview"]["coverage"][key] for key in ("productMissingDates", "promotionMissingDates")}
            WorkflowWriteRequestReceipt.objects.filter(request_id=request_id, claim_token=claim.claim_token).update(response_payload={"initialGaps": initial})
            if prepared["preview"]["noGap"]:
                result = {"status": "succeeded", "objectType": "registered_n8n_gap", "objectId": body["actionId"],
                    "receipt": {"actionId": body["actionId"], "state": "no_gap", "executionCreated": False,
                        "coverage": prepared["preview"]["coverage"], "mayReplay": False}}
                complete_write_request(claim, response_status=200, response_payload=result)
                return _json(result)
        # Durable processing reservation is committed before the one native
        # POST. Every failure remains reserved; neither expiry nor re-entry can
        # dispatch another execution under the same action identity.
        admit(body["actionId"], body["dispatchToken"], principal, WorkflowApiError)
        path, _hook = _entry(template)
        marker = {key: body[key] for key in ("actionId", "targetVersion", "dispatchToken")}
        marker.update({key: prepared["parameters"][key] for key in ("startDate", "endDate", "scheduledAt")})
        client = http.client.HTTPConnection("127.0.0.1", 5678, timeout=15)
        try:
            client.request("POST", path, body=canonical({"piBusiness": marker}).encode(), headers={"Content-Type": "application/json"})
            response = client.getresponse()
            raw = response.read(8193)
            _need(200 <= response.status < 300 and len(raw) <= 8192, "原生工作流接受结果未知，保留原操作且不重发", "n8n_dispatch_unknown", 503)
        except (OSError, http.client.HTTPException):
            raise WorkflowApiError("原生工作流派发结果未知，保留原操作且不重发", code="n8n_dispatch_unknown", status=503) from None
        finally:
            client.close()
        result = {"status": "accepted", "objectType": "registered_n8n_execution", "objectId": body["actionId"],
            "initialGaps": initial,
            "receipt": {"actionId": body["actionId"], "state": "native_webhook_accepted", "targetVersion": body["targetVersion"],
                "workflowId": template["id"], "versionId": prepared["parameters"]["registeredVersion"], "mayReplay": False}}
        with transaction.atomic():
            complete_write_request(claim, response_status=202, response_payload=result)
        return _json(result, 202)
    except Exception as error:
        return _error(error, "登记补缺操作无法核实")
