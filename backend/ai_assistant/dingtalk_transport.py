"""DWS owns platform authorization; no credentials, tickets or raw receipts are logged."""
import json
import os
import shutil
import subprocess
import ipaddress
from urllib.parse import urlsplit
from pathlib import Path
from .dingtalk import guard
from .policy import AiError

STREAM_API = "https://api.dingtalk.com/v1.0/gateway/connections/open"
STREAM_SOCKET = "https://wss-open-connection.dingtalk.com/connect"


def stream_addresses(url):
    from . import transport
    def official(value):
        if value not in (STREAM_API, STREAM_SOCKET):
            raise AiError("钉钉连接地址不在固定官方入口", "access_denied", 403)
    official(url)
    addresses = transport.resolve_addresses(urlsplit(url).hostname, 443, 5)
    addresses = transport._public_addresses(url, addresses, 5, official)
    if not addresses or len(addresses) > 32 or any(not ipaddress.ip_address(a[4][0]).is_global or ipaddress.ip_address(a[4][0]).is_multicast for a in addresses):
        raise AiError("钉钉地址未解析到公网", "access_denied", 403)
    return addresses


def open_stream(key, secret):
    from . import transport
    return transport._bounded_json(STREAM_API,
        {"clientId": key, "clientSecret": secret, "ua": "teruisi-readonly/1", "localIp": "127.0.0.1",
         "subscriptions": [{"type": "CALLBACK", "topic": "/v1.0/im/bot/messages/get"}]},
        timeout=15, maximum=16384, fixed_addresses=stream_addresses(STREAM_API))


def dws(args, profile):
    if os.name == "nt":
        launcher = shutil.which("dws.cmd") or shutil.which("dws.ps1")
        root = Path(launcher).parent if launcher else None
        node = shutil.which("node.exe")
        cli = root / "node_modules/dingtalk-workspace-cli/bin/dws.js" if root else None
        if not node or not cli or not cli.is_file():
            raise AiError("DWS 不可用", "channel_unavailable", 503)
        command = [node, str(cli)]
    else:
        command = [shutil.which("dws") or ""]
    try:
        result = subprocess.run([*command, *args, "--profile", profile, "--format", "json"],
            capture_output=True, timeout=30, check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode or len(result.stdout) > 1048576 or len(result.stderr) > 1048576:
            raise ValueError()
        payload = json.loads(result.stdout)
        if not isinstance(payload, dict) or payload.get("success") is False or payload.get("ok") is False or payload.get("error"):
            raise ValueError()
        return payload
    except Exception:
        raise AiError("DWS 调用失败或结果未确认", "channel_unavailable", 503) from None


def robot(config):
    # A live read lets DWS refresh an expired access token using the existing
    # refresh grant. Profile listing alone only reports the cached expiry.
    dws(["contact", "user", "get-self"], config["profile"])
    profile = dws(["profile", "list"], config["profile"])
    matches = [p for p in profile.get("profiles", []) if p.get("profile") == config["profile"] and p.get("corpId") == config["corpId"] and p.get("status") == "active"]
    if len(matches) != 1:
        raise AiError("DWS 组织身份无法核验", "access_denied", 403)
    apps = dws(["dev", "app", "list", "--robot-name", config["robotName"], "--page-size", "100"], config["profile"])
    matches = [a for a in apps.get("items", []) if a.get("robotName") == config["robotName"]]
    if apps.get("hasMore") is not False or len(matches) != 1 or matches[0].get("unifiedAppId") != config["unifiedAppId"]:
        raise AiError("机器人应用身份不唯一", "access_denied", 403)
    item = dws(["dev", "app", "robot", "get", "--unified-app-id", config["unifiedAppId"]], config["profile"])
    if any(item.get(k) != v for k, v in {"name": config["robotName"], "robotCode": config["robotCode"], "mode": "STREAM", "configured": True, "robotStatus": "ONLINE"}.items()):
        raise AiError("机器人配置不匹配或不可用", "access_denied", 403)


def verify_group(config, group):
    result = dws(["chat", "search", "--query", group["name"], "--limit", "100", "--cursor", "0"], config["profile"]).get("result", {})
    matches = [g for g in result.get("groups", []) if g.get("title") == group["name"]]
    if result.get("hasMore") is not False or len(matches) != 1 or matches[0].get("openConversationId") != group["id"]:
        raise AiError("指定群身份不唯一或已变化", "access_denied", 403)
    bots = dws(["chat", "group", "bots", "--group", group["id"]], config["profile"]).get("result", {}).get("bots", [])
    installed = [b for b in bots if b.get("name") == config["robotName"]]
    if len(installed) != 1 or installed[0].get("robotCode") != config["robotCode"] or installed[0].get("status") != 1:
        raise AiError("志高助手未唯一安装到指定群或已停用", "access_denied", 403)


def credentials(config):
    robot(config)
    for group in config["groups"]:
        verify_group(config, group)
    item = dws(["dev", "app", "credentials", "get", "--unified-app-id", config["unifiedAppId"]], config["profile"])
    if item.get("unifiedAppId") != config["unifiedAppId"] or item.get("appKey") != config["robotCode"] or not isinstance(item.get("appSecret"), str) or not item["appSecret"]:
        raise AiError("应用凭据身份核验失败", "access_denied", 403)
    return item["appKey"], item["appSecret"]


def send(config_reader, session, content):
    config = config_reader()
    guard(session, config)
    robot(config)
    if session.conversation_type == "2":
        group = next((g for g in config["groups"] if g["id"] == session.external_conversation_id), None)
        if not group:
            raise AiError("群聊已撤销授权", "access_denied", 403)
        verify_group(config, group)
    # Always DM the verified sender in v1. A group trigger grants no disclosure to peers.
    guard(session, config_reader())
    result = dws(["chat", "message", "send-by-bot", "--robot-code", config["robotCode"],
        "--users", session.sender_id, "--title", "志高助手 · 只读问数", "--text", content], config["profile"])
    receipt = result.get("result")
    if (result.get("success") is not True or not isinstance(receipt, dict)
            or not isinstance(receipt.get("processQueryKey"), str)
            or not 0 < len(receipt["processQueryKey"]) <= 4096
            or receipt.get("invalidStaffIdList") not in (None, [])
            or receipt.get("flowControlledStaffIdList") not in (None, [])):
        raise AiError("钉钉发送回执未确认", "delivery_unknown", 503)
