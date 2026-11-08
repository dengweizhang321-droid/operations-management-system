"""Enterprise application delivery; no personal DWS authorization at runtime."""
import json
import html
import ipaddress
import secrets
import re
from contextlib import contextmanager
from time import monotonic
from urllib.parse import urlsplit
from .diagnostics import elapsed_ms, error_summary, phase_timing
from .dingtalk import guard
from .policy import AiError, digest

STREAM_API = "https://api.dingtalk.com/v1.0/gateway/connections/open"
STREAM_SOCKET = "https://wss-open-connection.dingtalk.com/connect"
TOKEN_API = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
GROUP_MEDIA_API = "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
PERSON_MEDIA_API = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"
GROUP_BOTS_API = "https://api.dingtalk.com/v1.0/robot/groups/robots/query"
UPLOAD_API = "https://oapi.dingtalk.com/media/upload"

# All other platform codes are correlated by digest. Even a syntactically
# valid but unexpected code could be an upstream echo of private input.
_PUBLIC_CODES = frozenset({
    "InvalidParameter", "InvalidAccessToken", "Forbidden.AccessDenied", "Throttling",
    "TooManyRequests", "invalidParameter", "invalidAccessToken", "systemError",
})


def _platform_summary(reply):
    summary = {}
    code = reply.get("code", reply.get("errcode"))
    if (type(code) is int and 0 < code <= 99999999) or (isinstance(code, str) and code in _PUBLIC_CODES):
        summary["platformCode"] = str(code)
    elif isinstance(code, str) and 0 < len(code) <= 256:
        summary["platformCodeSha256"] = digest(json.dumps(code))
    request_id = reply.get("requestId", reply.get("request_id"))
    if isinstance(request_id, str) and 0 < len(request_id) <= 256:
        summary["requestIdSha256"] = digest(json.dumps(request_id))
    return summary


def _rejection_summary(raw):
    try:
        reply = json.loads(raw)
    except (ValueError, RecursionError):
        return {}
    return _platform_summary(reply) if isinstance(reply, dict) else {}


class DingTalkDeliveryError(AiError):
    """A definite stop/rejection or an ambiguous external message outcome."""
    def __init__(self, message, code, status, delivery):
        super().__init__(message, code, status)
        self.delivery = delivery


class _DeliveryAttempt:
    def __init__(self):
        self.started = monotonic()
        self.timings = {}
        self.request_started = False
        self.platform = {}

    def details(self, stage, outcome, **metadata):
        return {"stage": stage, "outcome": outcome, "elapsedMs": elapsed_ms(self.started),
                "timingsMs": dict(self.timings), **metadata}

    @contextmanager
    def phase(self, name):
        from .transport import ProviderHttpError
        try:
            with phase_timing(self.timings, name):
                yield
        except DingTalkDeliveryError:
            raise
        except Exception as error:
            summary = error_summary(error)
            outcome = "not_sent"
            if name == "send_request":
                request_started = self.request_started and summary.get("requestStarted", True)
                status = summary.get("httpStatus")
                if request_started and isinstance(error, ProviderHttpError) and status in {400, 401, 403, 404, 405, 413, 415, 422, 429}:
                    outcome = "rejected"
                elif request_started:
                    outcome = "unknown"
            elif name == "receipt":
                outcome = "rejected" if isinstance(error, AiError) and error.code == "dingtalk_send_rejected" else "unknown"
            platform = getattr(error, "rejection_summary", {}) if isinstance(error, ProviderHttpError) else self.platform
            if outcome == "unknown":
                code, status = "delivery_unknown", 503
            elif outcome == "rejected":
                code, status = "dingtalk_send_rejected", 503
            elif name == "identity" and isinstance(error, AiError) and not error.code.startswith("provider_"):
                code, status = error.code, error.status
            else:
                code, status = {
                    "credentials": "bot_credentials_unavailable", "token": "dingtalk_token_unavailable",
                    "upload": "dingtalk_upload_unavailable", "identity": "dingtalk_identity_unavailable",
                    "send_request": "dingtalk_send_unavailable",
                }[name], 503
            raise DingTalkDeliveryError("钉钉投递阶段未完成", code, status,
                self.details(name, outcome, transport=summary, **platform)) from None


def stream_addresses(url, *, exclude=frozenset()):
    from . import transport
    def official(value):
        if value not in (STREAM_API, STREAM_SOCKET):
            raise AiError("钉钉连接地址不在固定官方入口", "access_denied", 403)
    official(url)
    addresses = transport.resolve_addresses(urlsplit(url).hostname, 443, 5)
    # The shared DoH budget stays 5 (min(5, timeout) in _public_addresses); only
    # this ceiling grows, so a failed first resolver still has room for the
    # fallback resolver's own window instead of being cut off at zero.
    addresses = transport._public_addresses(url, addresses, 5 + transport._fallback_resolver_budget, official, exclude=exclude)
    if not addresses or len(addresses) > 32 or any(not ipaddress.ip_address(a[4][0]).is_global or ipaddress.ip_address(a[4][0]).is_multicast for a in addresses):
        raise AiError("钉钉地址未解析到公网", "access_denied", 403)
    return addresses


def media_addresses(url, *, exclude=frozenset()):
    """Pin only the exact DingTalk application endpoints to verified public DNS."""
    from . import transport
    parts = urlsplit(url)
    if (parts.scheme != "https" or parts.username or parts.password or parts.fragment or parts.port not in (None, 443)
            or (parts.hostname, parts.path) not in {
                ("api.dingtalk.com", "/v1.0/oauth2/accessToken"),
                ("api.dingtalk.com", "/v1.0/robot/groupMessages/send"),
                ("api.dingtalk.com", "/v1.0/robot/oToMessages/batchSend"),
                ("api.dingtalk.com", "/v1.0/robot/groups/robots/query"),
                ("oapi.dingtalk.com", "/media/upload"),
            } or (parts.query and parts.path != "/media/upload")):
        raise AiError("钉钉媒体地址不在固定官方入口", "access_denied", 403)
    addresses = transport.resolve_addresses(parts.hostname, 443, 5)
    # The shared DoH budget stays 5 (min(5, timeout) in _public_addresses); only
    # this ceiling grows, so a failed first resolver still has room for the
    # fallback resolver's own window instead of being cut off at zero.
    addresses = transport._public_addresses(
        url, addresses, 5 + transport._fallback_resolver_budget, lambda value: media_addresses_origin(value),
        exclude=exclude,
    )
    if not addresses or len(addresses) > 32 or any(
            not ipaddress.ip_address(a[4][0]).is_global or ipaddress.ip_address(a[4][0]).is_multicast
            for a in addresses):
        raise AiError("钉钉媒体地址未解析到公网", "access_denied", 403)
    return addresses


def media_addresses_origin(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in {"api.dingtalk.com", "oapi.dingtalk.com"}:
        raise AiError("钉钉媒体地址不在固定官方入口", "access_denied", 403)


def image_markdown(caption, media_id):
    """Render a literal caption and exactly one internal DingTalk image."""
    if not re.fullmatch(r"@[A-Za-z0-9._~=-]{1,4095}", media_id):
        raise AiError("钉钉图片标识无效", "channel_unavailable", 503)
    literal = html.escape(caption, quote=False)
    literal = re.sub(r"([\\`*_{}\[\]()#+.!|>~-])", r"\\\1", literal)
    body = literal.replace("\n", "  \n") + "\n\n![完整截图](" + media_id + ")"
    if len(body) > 5000 or len(body.encode("utf-8")) > 20000:
        raise AiError("文案超出图文消息上限", "payload_too_large", 413)
    return {"title": caption.splitlines()[0][:100], "text": body}


def send_media(config_reader, session, raw, file_name, kind, caption="", *, before_send=None):
    """Prepare one bot-authored attachment and gate the final recipient POST."""
    if not isinstance(caption, str) or len(caption) > 4000 or (caption and kind != "image"):
        raise AiError("图片附带文案无效")
    caption = caption.strip()
    if caption:
        image_markdown(caption, "@media")  # Reject oversize literal text before any network call.
    if kind not in {"image", "file"} or not isinstance(raw, bytes) or not 0 < len(raw) <= 2 * 1024 * 1024:
        raise AiError("钉钉媒体内容无效", "payload_too_large", 413)
    if not isinstance(file_name, str) or not 0 < len(file_name) <= 120 or any(c in file_name for c in "\\/:*?\"<>|\r\n"):
        raise AiError("钉钉文件名无效")
    extension = file_name.rsplit(".", 1)[-1].lower()
    if (kind == "image" and (extension != "png" or not raw.startswith(b"\x89PNG\r\n\x1a\n"))
            or kind == "file" and (extension not in {"xlsx", "pdf"}
                                   or extension == "xlsx" and not raw.startswith(b"PK\x03\x04")
                                   or extension == "pdf" and not raw.startswith(b"%PDF-"))):
        raise AiError("钉钉媒体格式无效")
    attempt = _DeliveryAttempt()
    config, token = _prepare_delivery(config_reader, session, attempt)
    boundary = secrets.token_hex(16)
    name = file_name.encode("utf-8")
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"media\"; filename=\"".encode()
        + name + b"\"\r\nContent-Type: application/octet-stream\r\n\r\n" + raw
        + f"\r\n--{boundary}--\r\n".encode())
    upload_url = UPLOAD_API + "?access_token=" + token + "&type=" + kind
    # Upload is preparation. Its response cannot prove a recipient send.
    with attempt.phase("upload"):
        uploaded = _request_json(upload_url, body,
            headers={"Content-Type": "multipart/form-data; boundary=" + boundary}, timeout=30, maximum=4096)
        media_id = uploaded.get("media_id")
        if type(uploaded.get("errcode")) is not int or uploaded["errcode"] != 0 or not isinstance(media_id, str) or not media_id.startswith("@") or len(media_id) > 4096:
            attempt.platform = _platform_summary(uploaded)
            raise AiError("钉钉媒体上传未确认", "channel_unavailable", 503)
        params = {"photoURL": media_id} if kind == "image" else {
            "mediaId": media_id, "fileName": file_name, "fileType": extension}
        message_key = "sampleImageMsg" if kind == "image" else "sampleFile"
        if caption:
            params = image_markdown(caption, media_id)
            message_key = "sampleMarkdown"
    return _send_message(config_reader, config, session, token, message_key, params, before_send, attempt)


def open_stream(key, secret):
    from . import transport
    return transport._bounded_json(STREAM_API,
        {"clientId": key, "clientSecret": secret, "ua": "teruisi-readonly/1", "localIp": "127.0.0.1",
         "subscriptions": [{"type": "CALLBACK", "topic": "/v1.0/im/bot/messages/get"}]},
        timeout=15, maximum=16384, fixed_addresses=stream_addresses(STREAM_API),
        resolver=lambda tried: stream_addresses(STREAM_API, exclude=tried))


def credentials(config):
    from .dingtalk_bot_credentials import read_credentials
    return read_credentials(config)


def robot(config):
    # Identity was verified at provisioning and is bound inside the encrypted payload.
    # Every actual send authenticates this app against the official token endpoint.
    credentials(config)


def _request_json(endpoint, body, *, send_fence=None, **kwargs):
    from . import transport

    def resolve(tried):
        with transport.provider_send_fence(None):
            return media_addresses(endpoint, exclude=tried)

    addresses = resolve(frozenset())
    with transport.provider_send_fence(send_fence):
        return transport._bounded_json(endpoint, body, fixed_addresses=addresses,
            resolver=resolve, rejection_summary=_rejection_summary, **kwargs)


def _fetch_token(key, secret, attempt=None):
    reply = _request_json(TOKEN_API, {"appKey": key, "appSecret": secret}, timeout=15, maximum=4096)
    token = reply.get("accessToken")
    if not isinstance(token, str) or not 0 < len(token) <= 4096 or not re.fullmatch(r"[A-Za-z0-9._~-]+", token):
        if attempt is not None:
            attempt.platform = _platform_summary(reply)
        raise AiError("企业机器人应用认证失败", "channel_unavailable", 503)
    return token


def access_token(config):
    return _fetch_token(*credentials(config))


def verify_group(config, group, token=None):
    if group not in config["groups"]:
        raise AiError("群聊已撤销授权", "access_denied", 403)
    headers = {"x-acs-dingtalk-access-token": token or access_token(config)}
    # The approved immutable openConversationId is the destination authority.
    # A mutable group display name is never resolved to a new recipient.
    reply = _request_json(GROUP_BOTS_API, {"openConversationId": group["id"]},
        headers=headers, timeout=15, maximum=65536)
    bots = reply.get("chatbotInstanceVOList")
    if not isinstance(bots, list) or len(bots) > 100 or any(not isinstance(bot, dict) for bot in bots):
        raise AiError("群机器人列表无法确认", "access_denied", 403)
    matches = [bot for bot in bots if bot.get("name") == config["robotName"]]
    if len(matches) != 1 or matches[0].get("robotCode") != config["robotCode"]:
        raise AiError("机器人未唯一安装到指定群", "access_denied", 403)


def send(config_reader, session, content, *, before_send=None):
    if not isinstance(content, str) or not content or len(content.encode("utf-8")) > 20000:
        raise AiError("钉钉文字内容无效或过长", "payload_too_large", 413)
    attempt = _DeliveryAttempt()
    config, token = _prepare_delivery(config_reader, session, attempt)
    return _send_message(config_reader, config, session, token, "sampleText", {"content": content}, before_send, attempt)


def _prepare_delivery(config_reader, session, attempt):
    with attempt.phase("identity"):
        config = config_reader()
        guard(session, config)
    with attempt.phase("credentials"):
        key, secret = credentials(config)
    with attempt.phase("token"):
        token = _fetch_token(key, secret, attempt)
    return config, token


def _send_message(config_reader, config, session, token, message_key, params, before_send, attempt):
    from . import transport
    if session.conversation_type == "2":
        endpoint, target = GROUP_MEDIA_API, {"openConversationId": session.external_conversation_id}
    else:
        endpoint, target = PERSON_MEDIA_API, {"userIds": [session.sender_id]}
    body = {"robotCode": config["robotCode"], "msgKey": message_key,
            "msgParam": json.dumps(params, ensure_ascii=False, separators=(",", ":")), **target}

    def fence(check_budget):
        # Destination checks may themselves call a POST, e.g. a group bot
        # query. Only the outer message POST can reserve the recipient send.
        with transport.provider_send_fence(None), attempt.phase("identity"):
            current = config_reader()
            guard(session, current)
            robot(current)
            if session.conversation_type == "2":
                group = next((g for g in current["groups"] if g["id"] == session.external_conversation_id), None)
                if not group:
                    raise AiError("群聊已撤销授权", "access_denied", 403)
                verify_group(current, group, token)
            if check_budget is not None:
                check_budget()
            if before_send is not None:
                before_send()
        if check_budget is not None:
            check_budget()
        attempt.request_started = True

    with attempt.phase("send_request"):
        reply = _request_json(endpoint, body, headers={"x-acs-dingtalk-access-token": token}, timeout=30, maximum=8192, send_fence=fence)
    with attempt.phase("receipt"):
        attempt.platform = _platform_summary(reply)
        receipt = validate_receipt(reply, staff_id=session.sender_id if endpoint == PERSON_MEDIA_API else None)
    return {**receipt, "delivery": attempt.details("receipt", "accepted", **attempt.platform)}


def validate_receipt(reply, *, staff_id=None):
    key = reply.get("processQueryKey")
    invalid = reply.get("invalidStaffIdList")
    throttled = reply.get("flowControlledStaffIdList")
    if (key in (None, "") and staff_id is not None
            and ((invalid == [staff_id] and throttled in (None, [])) or (throttled == [staff_id] and invalid in (None, [])))):
        raise AiError("钉钉明确拒绝本次收件人", "dingtalk_send_rejected", 503)
    codes = (reply.get("code"), reply.get("errcode"))
    if (not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,4096}", key)
            or invalid not in (None, []) or throttled not in (None, [])
            or any(code is not None and not (type(code) is int and code == 0 or isinstance(code, str) and code in ("", "0")) for code in codes)):
        raise AiError("钉钉发送回执未确认", "delivery_unknown", 503)
    # Raw provider identifiers remain outside business records and logs.
    return {"platform": "dingtalk", "state": "accepted", "receiptSha256": digest(key)}
