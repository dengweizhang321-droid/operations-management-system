"""Exact Pi attachment preview and at-most-once approved bot delivery.

Only approved groups and the actor's existing direct binding are discoverable.
No model-provided webhook, platform identifier, staff ID or file path is used.
"""
import hashlib
import json
import os
from types import SimpleNamespace

from . import dingtalk, dingtalk_settings, dingtalk_transport
from .pi_models import PiBusinessAudit, PiFile
from .policy import AiError, canonical, current_principal, digest, fields, identifier, mutation, text


def _config():
    path = os.environ.get("TERUISI_PI_REPORT_DINGTALK_CONFIG", "")
    if not path:
        raise AiError("报告投递尚未接入已采用的企业机器人配置", "report_channel_unavailable", 503)
    from .dingtalk_bot_credentials import checked_path
    try:
        path = checked_path(path)
    except Exception:
        raise AiError("报告机器人配置路径无法核实", "report_channel_unavailable", 503) from None
    config = dingtalk_settings.effective(dingtalk.load_config(path))
    if not config["enabled"]:
        raise AiError("企业机器人尚未启用", "report_channel_unavailable", 409)
    return config


def _targets(config, principal):
    current_principal(principal, write=True)
    bindings = [item for item in config["bindings"] if item["ownerEmail"] == principal.email.lower()
        and item["role"] == principal.role and canonical(item["scope"]) == canonical(principal.scope)]
    if len(bindings) != 1:
        raise AiError("当前账号没有唯一的企业机器人身份绑定", "report_sender_unbound", 403)
    binding = bindings[0]
    bound = dingtalk.principal_for(config, binding["senderId"])
    if (bound.email, bound.role, canonical(bound.scope)) != (principal.email.lower(), principal.role, canonical(principal.scope)):
        raise AiError("企业机器人绑定身份已变化", "access_denied", 403)
    result = [{"recipientId": "pi-recipient-" + digest([config["corpId"], config["robotCode"], "direct", binding["senderId"]])[:48],
        "recipientType": "direct", "recipientName": principal.display_name or principal.email,
        "robotName": config["robotName"], "policyVersion": config["policyVersion"], "target": binding["senderId"]}]
    for group in config["groups"]:
        result.append({"recipientId": "pi-recipient-" + digest([config["corpId"], config["robotCode"], "group", group["id"]])[:48],
            "recipientType": "group", "recipientName": group["name"], "robotName": config["robotName"],
            "policyVersion": config["policyVersion"], "target": group["id"]})
    return binding, result


def recipients(principal):
    config = _config()
    _, targets = _targets(config, principal)
    return {"items": [{key: value for key, value in item.items() if key != "target"} for item in targets]}


def _file(file_id, principal):
    from .pi_service import download
    download(file_id, principal)  # Original owner, generation and scope gate.
    row = PiFile.objects.select_related("session").filter(id=file_id).first()
    if row is None or row.direction not in {"output", "export"}:
        raise AiError("只能投递当前环境已收集的报告产物", "access_denied", 403)
    if not 0 < row.size_bytes <= 2 * 1024 * 1024:
        raise AiError("企业机器人报告附件上限为2MiB", "payload_too_large", 413)
    name = row.file_name
    if (not isinstance(name, str) or not 0 < len(name) <= 120
            or any(c in name for c in "\\/:*?\"<>|\r\n")):
        raise AiError("报告附件名称无效")
    extension = name.rsplit(".", 1)[-1].lower()
    if extension not in {"xlsx", "pdf"}:
        raise AiError("报告投递只支持已收集的PDF或XLSX附件", "unsupported_report_attachment", 409)
    raw = bytes(row.payload)
    if (len(raw) != row.size_bytes or hashlib.sha256(raw).hexdigest() != row.sha256
            or extension == "xlsx" and not raw.startswith(b"PK\x03\x04")
            or extension == "pdf" and not raw.startswith(b"%PDF-")):
        raise AiError("报告附件完整性无法核实", "service_unavailable", 503)
    return row, raw


def _prepared(principal, arguments):
    fields(arguments, {"fileId", "recipientId", "caption"}, {"fileId", "recipientId"})
    file_id, recipient_id = identifier(arguments["fileId"]), identifier(arguments["recipientId"])
    caption = text(arguments.get("caption", ""), "报告正文", 1000, empty=True)
    config = _config()
    binding, targets = _targets(config, principal)
    matches = [item for item in targets if item["recipientId"] == recipient_id]
    if len(matches) != 1:
        raise AiError("收件对象已撤销或不在当前允许渠道", "access_denied", 403)
    target = matches[0]
    file, raw = _file(file_id, principal)
    public_target = {key: value for key, value in target.items() if key != "target"}
    preview = {"objectType": "report_delivery", "body": caption, "recipient": public_target,
        "attachment": {"fileId": file.id, "fileName": file.file_name, "mimeType": file.mime_type,
            "sizeBytes": file.size_bytes, "sha256": file.sha256, "sessionId": file.session_id,
            "generation": file.generation, "operationId": file.operation_id, "sourceManifestSha256": digest(file.manifest_json)},
        "messageCount": 2 if caption else 1,
        "deliveryOrder": ["正文", "附件"] if caption else ["附件"],
        "unknownPolicy": "保留原投递身份及各阶段回执，结果未知或部分成功时不自动重发"}
    version = digest(["pi-report-delivery-v1", digest(config), public_target, preview])
    parameters = {"fileId": file_id, "recipientId": recipient_id, "caption": caption}
    result = {"parameters": parameters, "preview": preview, "targetVersion": version,
        "scope": {"domain": "ai", "fileId": file.id, "sessionId": file.session_id, "generation": file.generation,
            "recipientId": recipient_id}}
    return result, config, binding, target, file, raw


def prepare(principal, arguments):
    return _prepared(principal, arguments)[0]


def _audit_id(action_id, phase):
    return "pi-report-" + phase + "-" + digest(action_id)[:48]


def _save(action, phase, value):
    with mutation():
        PiBusinessAudit.objects.create(id=_audit_id(action.id, phase), action_id=action.id,
            event_type="report_delivery_" + phase, data_json=canonical(value))


def _record(action, phase):
    row = PiBusinessAudit.objects.filter(id=_audit_id(action.id, phase), action_id=action.id,
        event_type="report_delivery_" + phase).first()
    return json.loads(row.data_json) if row else None


def execute(action, principal):
    from .pi_business import pre_effect_check
    result, config, binding, target, file, raw = _prepared(principal, json.loads(action.parameters_json))
    if result["targetVersion"] != action.target_version:
        raise AiError("报告内容、附件或收件对象已变化，请重新预览确认", "version_conflict", 409)
    if (file.session_id, file.generation) != (action.session_id, action.generation):
        raise AiError("报告附件不属于本次授权环境", "access_denied", 403)
    # Reserve independently from the queue dispatch before any media upload or
    # recipient send. This create-only marker blocks re-entry after a crash.
    pre_effect_check(action)
    if _record(action, "reserved") is not None:
        return observe(action, principal)
    _save(action, "reserved", {"actionId": action.id, "targetVersion": action.target_version,
        "fileSha256": file.sha256, "recipientId": target["recipientId"]})
    session = SimpleNamespace(config_digest=digest(config), sender_id=binding["senderId"],
        owner_email=principal.email.lower(), scope_json=canonical(principal.scope),
        conversation_type="2" if target["recipientType"] == "group" else "1",
        external_conversation_id=target["target"])
    def check():
        pre_effect_check(action)
        current = _prepared(principal, json.loads(action.parameters_json))[0]
        if current["targetVersion"] != action.target_version:
            raise AiError("报告或收件对象在发送前变化", "version_conflict", 409)
    caption = result["parameters"]["caption"]
    if caption:
        _save(action, "body_dispatch", {"bodySha256": digest(caption)})
        check()
        reply = dingtalk_transport.send(_config, session, caption, before_send=check)
        _save(action, "body_receipt", reply)
    check()
    _save(action, "attachment_dispatch", {"fileSha256": file.sha256})
    reply = dingtalk_transport.send_media(_config, session, raw, file.file_name, "file", before_send=check)
    _save(action, "attachment_receipt", reply)
    return observe(action, principal)


def observe(action, principal):
    current_principal(principal, write=True)
    if action.owner_email != principal.email.lower():
        raise AiError("投递回执不在当前授权范围", "access_denied", 403)
    caption = json.loads(action.parameters_json).get("caption", "")
    body = _record(action, "body_receipt")
    attachment = _record(action, "attachment_receipt")
    complete = attachment is not None and (not caption or body is not None)
    return {"status": "succeeded" if complete else "unknown", "objectType": "report_delivery", "objectId": action.id,
        "receipt": {"actionId": action.id, "targetVersion": action.target_version,
            "state": "accepted_by_platform" if complete else "partial_or_unknown", "body": body,
            "attachment": attachment, "mayReplay": False,
            "bodyDispatched": _record(action, "body_dispatch") is not None,
            "attachmentDispatched": _record(action, "attachment_dispatch") is not None}}
