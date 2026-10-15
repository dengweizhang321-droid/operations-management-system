"""JD stockout delivery: disabled by default, durable unknown-result fencing."""
from __future__ import annotations

from datetime import date
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from . import jd_logistics as source
from .dingtalk_group_message import DingTalkGroupGateway
from .dingtalk_sync import DingTalkTarget, DwsCli, _configuration_path as _controlled_profile_path
from .errors import InventoryApiError
from .jd_logistics_models import JdLogisticsBatch, JdLogisticsDelivery, JdLogisticsDepartment, JdLogisticsFact, JdLogisticsScope
from .models import InventoryWriteAuthority
from .revisions import bump_revision, revision_value
from .write_requests import lock_active_authority

GROUP_NAME = "测试群聊"
ROBOT_NAME = "志高助手"
RULE_VERSION = "jd-stockout-notification-v2"
MAX_DEPARTMENTS = 30
MAX_RISKS = 5_000
MAX_MESSAGE_CHARS = 8_000
MAX_DISPLAYED_RISKS = 50
MAX_UNRESOLVED = 1_000
PRE_SEND_DEADLINE_SECONDS = 120
META_KEYS = {"runId", "executionId", "protocol", "planHash", "verifiedBatches"}


def _lock_notification_authority():
    # The shared helper validates but intentionally does not lock. External JD
    # dispatch additionally holds the same authority row so maintenance cannot
    # revoke/change its epoch between final validation and the outgoing call.
    # All notification transactions acquire authority before revision/ledger.
    InventoryWriteAuthority.objects.select_for_update().filter(id=1).first()
    return lock_active_authority()


def _configuration_path():
    return settings.BASE_DIR.parent / "config" / "jd-logistics-notifications.json"


def notification_policy():
    policy = {"implemented": True, "enabled": False, "configured": False, "groupName": GROUP_NAME, "robotName": ROBOT_NAME, "configDigest": "", "reason": "not_configured"}
    try:
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError("duplicate configuration key")
                value[key] = item
            return value
        raw = json.loads(_configuration_path().read_text(encoding="utf-8"), object_pairs_hook=unique)
        if not isinstance(raw, dict) or set(raw) != {"version", "enabled", "groupName", "robotName"} or type(raw["version"]) is not int or raw["version"] != 1 or type(raw["enabled"]) is not bool or raw["groupName"] != GROUP_NAME or raw["robotName"] != ROBOT_NAME:
            return policy
    except (OSError, ValueError, TypeError):
        return policy
    return {**policy, "configured": True, "enabled": raw["enabled"], "configDigest": source._hash({"configuration": raw, "ruleVersion": RULE_VERSION}), "reason": "requires_dynamic_preflight" if raw["enabled"] else "disabled"}


def notification_available():
    policy = notification_policy()
    return policy["configured"] and policy["enabled"]


class JdNotificationGateway(DingTalkGroupGateway):
    """Retain the controlled DWS profile; tighten only the new JD protocol."""
    def __init__(self, cli=None):
        if cli is not None:
            self.cli = cli
            self.profile = None
            return
        self.profile = _load_controlled_profile()
        # Only DwsCli's existing controlled profile/credential/process path is
        # reused. JD does not depend on replenishment enabled/Base/table/fields.
        target = DingTalkTarget(profile=self.profile, corp_id=self.profile.split(":", 1)[0], base_id="", base_name="", table_id="", table_name="", fields={})
        self.cli = DwsCli(target)

    def resolve_group(self, group_name):
        matches, cursor, completed = {}, "0", False
        for _attempt in range(5):
            payload = self.cli.run("chat", "search", "--query", group_name, "--limit", "20", "--cursor", cursor)
            result = _envelope(payload)
            groups = result.get("groups")
            if not isinstance(groups, list) or any(not isinstance(group, dict) for group in groups):
                raise InventoryApiError("钉钉群目录结构不完整", code="target_not_verified", status=409)
            for group in groups:
                if group.get("title") == group_name:
                    identity = group.get("openConversationId")
                    if not isinstance(identity, str) or not identity.strip():
                        raise InventoryApiError("钉钉目标群缺少身份", code="target_not_verified", status=409)
                    matches[identity] = group
            more = result.get("hasMore")
            if more is False:
                completed = True
                break
            next_cursor = result.get("nextCursor")
            if more is not True or not isinstance(next_cursor, (str, int)) or isinstance(next_cursor, bool) or str(next_cursor) == cursor:
                raise InventoryApiError("钉钉目标群分页完整性无法核实", code="target_not_verified", status=409)
            cursor = str(next_cursor)
        if not completed:
            raise InventoryApiError("钉钉目标群搜索被截断，拒绝发送", code="target_not_verified", status=409)
        if len(matches) != 1:
            raise InventoryApiError("钉钉目标群无法精确唯一匹配", code="target_not_verified", status=409)
        return next(iter(matches))

    def preflight(self, group_name, robot_name, buyers):
        if group_name != GROUP_NAME or robot_name != ROBOT_NAME or buyers:
            raise InventoryApiError("京东通知仅支持已指定群与机器人，不接受人员或其他目标", code="target_not_verified", status=409)
        if self.profile is not None and _load_controlled_profile() != self.profile:
            raise InventoryApiError("受控钉钉身份配置已变化", code="target_not_verified", status=409)
        group_id = self.resolve_group(group_name)
        payload = self.cli.run("chat", "group", "bots", "--group", group_id)
        # Count all exact-name entries before checking availability; an inactive
        # same-name bot is still an ambiguity, not a reason to pick another one.
        bots = _envelope(payload).get("bots")
        if not isinstance(bots, list) or any(not isinstance(bot, dict) for bot in bots):
            raise InventoryApiError("指定群机器人目录结构不完整", code="target_not_verified", status=409)
        matches = [record for record in bots if record.get("name") == robot_name]
        if len(matches) != 1:
            raise InventoryApiError("指定群机器人无法精确唯一匹配", code="target_not_verified", status=409)
        bot = matches[0]
        robot_code = bot.get("robotCode")
        if not isinstance(robot_code, str) or not robot_code.strip() or type(bot.get("status")) is not int or bot["status"] != 1:
            raise InventoryApiError("指定群机器人缺少明确安装及可用证据", code="target_not_verified", status=409)
        return group_id, robot_code, []


def _envelope(payload):
    if not isinstance(payload, dict) or payload.get("success") is not True or payload.get("error") or not isinstance(payload.get("result"), dict):
        raise InventoryApiError("钉钉目标查询未明确成功", code="target_not_verified", status=409)
    return payload["result"]


def _load_controlled_profile():
    try:
        raw = json.loads(_controlled_profile_path().read_text(encoding="utf-8"))
        profile = raw.get("profile") if isinstance(raw, dict) else None
    except (OSError, ValueError):
        profile = None
    if not isinstance(profile, str) or not re.fullmatch(r"ding[a-zA-Z0-9]{8,80}:[A-Za-z0-9._-]{3,80}", profile):
        raise InventoryApiError("京东通知缺少合法受控钉钉profile", code="notification_not_configured", status=503)
    return profile


def _strict_receipt(payload, group_id):
    # Verified against installed CLI 1.0.57 and its exact release source:
    # internal/shortcut/chat/batch_write.go returns succeeded[].target, not
    # results[].status. Array membership is the runtime's explicit success.
    if not isinstance(payload, dict) or payload.get("contractVersion") != "im.batch-write.v1" or payload.get("ok") is not True or payload.get("partial") is not False or payload.get("dry_run") is True or payload.get("executed") is False or "preview_kind" in payload or payload.get("unknownCount", 0) != 0 or payload.get("unknown") is True or payload.get("complete") is False:
        raise InventoryApiError("通知未取得明确单目标回执", code="delivery_unknown", status=503)
    for field, expected in (("requestedCount", 1), ("succeededCount", 1), ("failedCount", 0)):
        if type(payload.get(field)) is not int or payload[field] != expected:
            raise InventoryApiError("通知回执包含部分、失败或未知结果", code="delivery_unknown", status=503)
    results = payload.get("succeeded")
    if not isinstance(results, list) or len(results) != 1 or payload.get("failures") != [] or not isinstance(results[0], dict):
        raise InventoryApiError("通知回执不完整", code="delivery_unknown", status=503)
    result = results[0]
    target = result.get("target")
    lower = result.get("result")
    negative_lower = isinstance(lower, dict) and (lower.get("success") is False or bool(lower.get("error")) or lower.get("status") in {"failed", "unknown", "error"})
    if not isinstance(target, str) or target != group_id or result.get("status") in {"failed", "unknown", "error"} or negative_lower:
        raise InventoryApiError("通知回执未明确确认本次目标成功", code="delivery_unknown", status=503)
    return source._hash(payload)


def _request(payload):
    source._keys(payload, {"operation", "departmentIds"} | META_KEYS, {"operation", "departmentIds"})
    if payload["operation"] != "notify":
        source._error("通知操作无效")
    ids = payload["departmentIds"]
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_DEPARTMENTS:
        source._error("每次通知请选择1到30个事业部")
    ids = [source._text(value, "事业部ID", 80) for value in ids]
    if len(set(ids)) != len(ids):
        source._error("通知事业部不能重复")
    ids.sort()
    metadata = {}
    if META_KEYS.intersection(payload):
        if not META_KEYS.issubset(payload):
            source._error("工作流通知元数据及已验证批次必须完整提供")
        metadata = {key: source._text(payload[key], key, 160) for key in ("runId", "executionId", "protocol")}
        plan_hash = source._text(payload["planHash"], "计划摘要", 64)
        if not re.fullmatch(r"[a-f0-9]{64}", plan_hash):
            source._error("通知计划摘要无效")
        metadata["planHash"] = plan_hash
        refs = payload["verifiedBatches"]
        if not isinstance(refs, list) or not 2 * len(ids) <= len(refs) <= 4 * len(ids):
            source._error("工作流通知必须绑定完整已验证库存批次")
        seen = set()
        normalized = []
        for ref in refs:
            source._keys(ref, {"departmentId", "sourceKind", "batchId", "scopeRevision", "contentHash", "rawFileHash"}, {"departmentId", "sourceKind", "batchId", "scopeRevision", "contentHash", "rawFileHash"})
            if ref["departmentId"] not in ids or ref["sourceKind"] not in source.SOURCE_KINDS:
                source._error("通知批次不属于本次事业部或来源")
            key = (ref["departmentId"], ref["sourceKind"])
            if key in seen:
                source._error("通知批次来源不能重复")
            seen.add(key)
            normalized.append({"departmentId": ref["departmentId"], "sourceKind": ref["sourceKind"], "batchId": source._text(ref["batchId"], "批次ID", 64), "scopeRevision": source._integer(ref["scopeRevision"], "来源版本", minimum=0), "contentHash": source._text(ref["contentHash"], "业务摘要", 64), "rawFileHash": source._text(ref["rawFileHash"], "原文件摘要", 64)})
        if any((identifier, kind) not in seen for identifier in ids for kind in ("realtime_inventory", "inventory_snapshot")):
            source._error("工作流通知缺少某个事业部的两类库存批次")
        metadata["verifiedBatches"] = sorted(normalized, key=lambda row: (row["departmentId"], row["sourceKind"]))
    return ids, metadata


def _verify_bindings(metadata):
    for ref in metadata.get("verifiedBatches", []):
        batch = JdLogisticsBatch.objects.filter(id=ref["batchId"], department_id=ref["departmentId"], source_kind=ref["sourceKind"]).first()
        if batch is None or batch.content_hash != ref["contentHash"] or batch.raw_file_hash != ref["rawFileHash"]:
            source._error("通知绑定批次与服务端记录不符", "notification_source_changed", 409)
        selected = source._current_selection(batch)
        if not selected["current"] or selected["contentHash"] != ref["contentHash"] or selected["scopeRevision"] != ref["scopeRevision"]:
            source._error("通知绑定批次已不是当前有效范围", "notification_source_changed", 409)


def _capture(ids, metadata):
    departments = list(JdLogisticsDepartment.objects.filter(id__in=ids).order_by("id"))
    if len(departments) != len(ids):
        source._error("通知事业部不存在", "source_not_registered", 409)
    for department in departments:
        if not department.logistics_enabled or not department.monitor_enabled or not department.push_enabled:
            return {"status": "disabled", "reason": "department_switch_disabled", "riskCount": 0}
        if department.stockout_threshold_days is None:
            return {"status": "not_configured", "reason": "threshold_not_configured", "riskCount": 0}
    _verify_bindings(metadata)
    monitor = source.inventory_monitor({"departmentIds": ids, "page": 1, "pageSize": source.MAX_READ_ROWS, "salesWindow": 30})
    items = monitor["items"]
    today = timezone.localdate(timezone=source.SHANGHAI)
    # A zero-sales/unknown SKU cannot veto another SKU's known stockout risk.
    # Fixed 30-day available coverage is the warning's own dependency; missing
    # on-hand/post-replenishment/ERP fields cannot suppress a known risk.
    known = [row for row in items if row["realtimeDate"] == today.isoformat() and row["stockoutAvailableDays30d"] is not None and not row["metricQualifications"]["stockoutAvailableDays30d"]]
    unknown_count = len(items) - len(known)
    missing_departments = sorted(set(ids) - {row["departmentId"] for row in items})
    risks = []
    for row in known:
        if row["warningState"] == "stockout_risk":
            risks.append({key: row[key] for key in ("departmentId", "businessUnitCode", "goodsCode", "goodsName", "warehouseKey", "warehouseName", "realtimeDate", "snapshotDate", "onHandQuantity", "availableQuantity", "purchaseInTransitQuantity", "transferInTransitQuantity", "postReplenishmentQuantity", "sales30dQuantity", "turnoverDays", "stockoutAvailableDays30d", "stockoutThresholdDays")})
    risks.sort(key=lambda row: (row["departmentId"], row["goodsCode"], row["warehouseKey"]))
    if len(risks) > MAX_RISKS:
        return {"status": "not_configured", "reason": "too_many_notification_risks", "riskCount": len(risks)}
    latest = JdLogisticsFact.objects.filter(department_id=OuterRef("department_id"), source_kind=OuterRef("source_kind")).order_by("-business_date").values("business_date")[:1]
    rows = list(JdLogisticsFact.objects.filter(department_id__in=ids, source_kind__in=["realtime_inventory", "inventory_snapshot"], business_date=Subquery(latest)).values_list("department_id", "source_kind", "row_hash")[:source.MAX_READ_ROWS + 1])
    if len(rows) > source.MAX_READ_ROWS:
        source._error("通知来源范围超过有界上限", "query_too_large", 413)
    source_digest = source._hash(sorted(rows))
    heads = list(JdLogisticsScope.objects.filter(department_id__in=ids, source_kind__in=["realtime_inventory", "inventory_snapshot"]).order_by("department_id", "source_kind").values("department_id", "source_kind", "revision"))
    semantic_scope = {"departmentIds": ids, "businessDate": today.isoformat(), "ruleVersion": RULE_VERSION, "thresholds": [{"departmentId": row.id, "days": row.stockout_threshold_days} for row in departments]}
    fence = {"settings": [[row.id, row.revision] for row in departments], "heads": heads}
    coverage = {"totalItems": len(items), "knownCount": len(known), "unknownCount": unknown_count, "missingDepartmentIds": missing_departments}
    status = "ready" if risks else "not_configured" if unknown_count or missing_departments else "empty"
    return {"status": status, "reason": "partial_coverage_no_known_risk" if status == "not_configured" else "", "riskCount": len(risks), "unknownCount": unknown_count, "risks": risks, "sourceDigest": source_digest, "scopeDigest": source._hash(semantic_scope), "fenceDigest": source._hash(fence), "scopeSnapshot": {**semantic_scope, "fence": fence, "coverage": coverage}, "riskDigest": source._hash(risks)}


def _escape(value):
    return re.sub(r"([\\`*_{}\[\]()#+!|<>@])", r"\\\1", str(value)).replace("\r", " ").replace("\n", " ")


def _message(candidate):
    coverage = candidate["scopeSnapshot"]["coverage"]
    header = ["### 京东C仓缺货提醒", f"当前范围已判定 {candidate['riskCount']} 条风险（按事业部、JD SKU、来源仓库）；仅为系统阈值提醒。", f"另有 {coverage['unknownCount']} 条指标待核实、{len(coverage['missingDepartmentIds'])} 个事业部缺来源；不将未知视为无风险。"]
    rows, displayed = [], 0
    for risk in candidate["risks"][:MAX_DISPLAYED_RISKS]:
        on_hand = "—" if risk["onHandQuantity"] is None else str(risk["onHandQuantity"])
        line = f"- {_escape(risk['businessUnitCode'])} / {_escape(risk['goodsCode'])} {_escape(risk['goodsName'])} / {_escape(risk['warehouseName'])}：现货 {on_hand}，可用 {risk['availableQuantity']}，30日销售出库件数 {risk['sales30dQuantity']}，30日可用可售 {risk['stockoutAvailableDays30d']}天，阈值 {risk['stockoutThresholdDays']}天；实时日 {risk['realtimeDate']}，销量截至 {risk['snapshotDate']}。"
        if len("\n".join(header + rows + [line])) > MAX_MESSAGE_CHARS - 250:
            break
        rows.append(line)
        displayed += 1
    footer = f"展示 {displayed} / {candidate['riskCount']} 条；完整风险集合及来源、阈值已绑定服务端摘要，请在运营管理系统C仓页查看全量。"
    message = "\n".join(header + rows + [footer])
    if not displayed or len(message) > MAX_MESSAGE_CHARS:
        source._error("通知内容无法在消息上限内完整披露展示范围", "notification_message_too_large", 413)
    return message, displayed


def delivery_payload(row):
    return {"deliveryId": str(row.id), "status": row.status, "businessDate": row.business_date.isoformat(), "departmentIds": row.department_ids, "riskCount": row.risk_count, "unknownCount": row.scope_snapshot.get("coverage", {}).get("unknownCount", 0), "coverage": row.scope_snapshot.get("coverage", {}), "displayedCount": row.displayed_count, "messageHash": row.message_hash, "receiptHash": row.receipt_hash, "configDigest": row.config_digest, "sourceDigest": row.source_digest, "scopeDigest": row.scope_digest, "targetDigest": row.target_digest, "errorCode": row.error_code, "createdAt": row.created_at.isoformat(), "updatedAt": row.updated_at.isoformat(), "sentAt": row.sent_at.isoformat() if row.sent_at else None}


def read_deliveries(delivery_id):
    identifier = source._text(delivery_id, "通知投递ID", 64)
    row = JdLogisticsDelivery.objects.filter(id=identifier).first()
    return source._base(items=[delivery_payload(row)] if row else [], total=1 if row else 0, page=1, pageSize=1)


def _result(status, ids, *, reason="", candidate=None, delivery=None, available=False):
    candidate = candidate or {}
    risk_count = candidate.get("riskCount", delivery.risk_count if delivery else 0)
    risks = candidate.get("risks", delivery.risk_snapshot if delivery else [])
    counts = {identifier: sum(row["departmentId"] == identifier for row in risks) for identifier in ids}
    fields = {"status": status, "reason": reason, "riskCount": risk_count, "unknownCount": candidate.get("unknownCount", delivery.scope_snapshot.get("coverage", {}).get("unknownCount", 0) if delivery else 0), "coverage": candidate.get("scopeSnapshot", {}).get("coverage", delivery.scope_snapshot.get("coverage", {}) if delivery else {}), "notificationAvailable": available, "departmentIds": ids, "departments": [{"departmentId": identifier, "status": "empty" if status in {"sent", "duplicate"} and not counts[identifier] else status, "riskCount": counts[identifier]} for identifier in ids]}
    if delivery:
        fields.update(delivery_payload(delivery))
        fields["status"] = status
    return source._base(**fields)


def _unresolved(ids, day):
    rows = list(JdLogisticsDelivery.objects.filter(business_date=day, status__in=["sending", "unknown"]).order_by("created_at")[:MAX_UNRESOLVED + 1])
    if len(rows) > MAX_UNRESOLVED:
        source._error("待核实通知记录超过上限，拒绝新投递", "notification_unresolved", 409)
    return next((row for row in rows if set(row.department_ids).intersection(ids)), None)


def notify(payload, actor, *, gateway=None):
    ids, metadata = _request(payload)
    policy = notification_policy()
    if not policy["configured"]:
        return _result("not_configured", ids, reason="notification_configuration_missing")
    if not policy["enabled"]:
        return _result("disabled", ids, reason="notification_globally_disabled")
    started = time.monotonic()
    with transaction.atomic():
        _lock_notification_authority()
        revision_value(for_update=True)
        unresolved = _unresolved(ids, timezone.localdate(timezone=source.SHANGHAI))
        if unresolved:
            return _result("unknown", ids, reason="unresolved_business_day_delivery", delivery=unresolved, available=True)
        candidate = _capture(ids, metadata)
    if candidate["status"] != "ready":
        return _result(candidate["status"], ids, reason=candidate.get("reason", ""), candidate=candidate, available=True)
    try:
        active = gateway or JdNotificationGateway()
        group_id, robot_code, users = active.preflight(GROUP_NAME, ROBOT_NAME, [])
        if not group_id or not robot_code or users:
            raise InventoryApiError("通知目标预检不完整", code="target_not_verified", status=409)
    except Exception:
        return _result("not_configured", ids, reason="dynamic_target_preflight_failed", candidate=candidate, available=True)
    profile_digest = source._hash(getattr(active, "profile", None))
    target_digest = source._hash([group_id, robot_code, profile_digest])
    key = source._hash({"rule": RULE_VERSION, "scope": candidate["scopeDigest"], "source": candidate["sourceDigest"], "risks": candidate["riskDigest"], "target": target_digest})
    message, displayed = _message(candidate)
    owner = uuid.uuid4().hex
    with transaction.atomic():
        _lock_notification_authority()
        revision_value(for_update=True)
        unresolved = _unresolved(ids, timezone.localdate(timezone=source.SHANGHAI))
        if unresolved:
            return _result("unknown", ids, reason="unresolved_business_day_delivery", candidate=candidate, delivery=unresolved, available=True)
        existing = JdLogisticsDelivery.objects.select_for_update().filter(idempotency_key=key).first()
        if existing:
            return _result("duplicate" if existing.status == "sent" else "not_configured", ids, reason="already_sent" if existing.status == "sent" else "prior_delivery_denied", candidate=candidate, delivery=existing, available=True)
        refreshed = _capture(ids, metadata)
        if notification_policy() != policy or refreshed.get("fenceDigest") != candidate["fenceDigest"] or refreshed.get("sourceDigest") != candidate["sourceDigest"]:
            return _result("not_configured", ids, reason="notification_state_changed_before_claim", candidate=candidate, available=True)
        delivery = JdLogisticsDelivery.objects.create(idempotency_key=key, business_date=date.fromisoformat(candidate["scopeSnapshot"]["businessDate"]), department_ids=ids, owner_token=owner, risk_count=candidate["riskCount"], displayed_count=displayed, risk_snapshot=candidate["risks"], scope_snapshot=candidate["scopeSnapshot"], run_metadata=metadata, message_text=message, message_hash=hashlib.sha256(message.encode("utf-8")).hexdigest(), config_digest=policy["configDigest"], source_digest=candidate["sourceDigest"], scope_digest=candidate["scopeDigest"], target_digest=target_digest, actor=actor)
        source._audit("", "notify_claimed", str(delivery.id), actor, {}, {"scopeDigest": delivery.scope_digest, "riskCount": delivery.risk_count})
        bump_revision({"jdNotification": str(delivery.id), "status": "sending"})
    # sending is committed before this transaction. Holding the original writer
    # revision fence through final checks and dispatch prevents DB setting/source
    # changes between the final check and the external call. Lock order matches
    # all JD imports and settings writes. No automatic retry is introduced.
    try:
        with transaction.atomic():
            _lock_notification_authority()
            revision_value(for_update=True)
            current = JdLogisticsDelivery.objects.select_for_update().get(id=delivery.id)
            target = active.preflight(GROUP_NAME, ROBOT_NAME, [])
            refreshed = _capture(ids, metadata)
            lock_active_authority()
            current.refresh_from_db(fields=["status", "owner_token"])
            if current.status != "sending" or current.owner_token != owner:
                return _result("unknown", ids, reason="notification_owner_changed", candidate=candidate, delivery=current, available=True)
            valid = current.status == "sending" and current.owner_token == owner and notification_policy() == policy and refreshed.get("status") == "ready" and refreshed.get("fenceDigest") == candidate["fenceDigest"] and refreshed.get("sourceDigest") == candidate["sourceDigest"] and source._hash([target[0], target[1], profile_digest]) == target_digest and target[2] == [] and time.monotonic() - started <= PRE_SEND_DEADLINE_SECONDS
            if not valid:
                current.status, current.error_code, current.updated_at = "denied", "notification_state_changed_before_send", timezone.now()
                current.save(update_fields=["status", "error_code", "updated_at"])
                bump_revision({"jdNotification": str(current.id), "status": "denied"})
                return _result("not_configured", ids, reason=current.error_code, candidate=candidate, delivery=current, available=True)
            receipt = active.send(group_id=group_id, robot_code=robot_code, message=message, user_ids=[])
            receipt_hash = _strict_receipt(receipt, group_id)
            current.status, current.receipt_hash, current.sent_at, current.updated_at = "sent", receipt_hash, timezone.now(), timezone.now()
            current.save(update_fields=["status", "receipt_hash", "sent_at", "updated_at"])
            bump_revision({"jdNotification": str(current.id), "status": "sent"})
            return _result("sent", ids, candidate=candidate, delivery=current, available=True)
    except Exception:
        # Every exception after a durable reservation is conservatively unknown;
        # DB rollback/response loss can never authorize another external send.
        with transaction.atomic():
            _lock_notification_authority()
            revision_value(for_update=True)
            current = JdLogisticsDelivery.objects.select_for_update().get(id=delivery.id)
            if current.status == "sending" and current.owner_token == owner:
                current.status, current.error_code, current.updated_at = "unknown", "delivery_result_unknown", timezone.now()
                current.save(update_fields=["status", "error_code", "updated_at"])
                bump_revision({"jdNotification": str(current.id), "status": "unknown"})
        return _result("unknown", ids, reason="delivery_result_unknown", candidate=candidate, delivery=current, available=True)
