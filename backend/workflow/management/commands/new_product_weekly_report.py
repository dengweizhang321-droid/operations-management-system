from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime
from typing import Any, Iterable

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from sales.auth import Principal
from workflow.followup import (
    claim_weekly_delivery,
    finish_weekly_delivery,
    learn_product_line_codes,
    mark_weekly_delivery_sending,
    mark_weekly_delivery_uncertain,
    weekly_followup,
)
from workflow.models import NewProductWeeklyReportConfig


MAX_DWS_OUTPUT_BYTES = 2 * 1024 * 1024
AUTOMATION_ACTOR = "new-product-weekly-report@local.system"


def _records(value: object) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _records(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _records(nested)


def _field(record: dict[str, Any], names: tuple[str, ...]) -> str:
    for name in names:
        value = record.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _exact_identity(
    payloads: Iterable[object],
    *,
    expected_name: str,
    name_fields: tuple[str, ...],
    id_fields: tuple[str, ...],
    label: str,
) -> tuple[str, dict[str, Any]]:
    matches: dict[str, dict[str, Any]] = {}
    for payload in payloads:
        for record in _records(payload):
            name = _field(record, name_fields)
            identity = _field(record, id_fields)
            if name == expected_name and identity:
                matches[identity] = record
    if len(matches) != 1:
        raise CommandError(f"{label}“{expected_name}”精确匹配到 {len(matches)} 个对象，拒绝发送")
    identity, record = next(iter(matches.items()))
    return identity, record


def _page_value(payload: object, field: str) -> object | None:
    for record in _records(payload):
        if field in record:
            return record[field]
    return None


def _run_dws(args: list[str], *, timeout: int = 30) -> object:
    executable = shutil.which("dws.cmd" if os.name == "nt" else "dws")
    if not executable:
        raise CommandError("钉钉 dws 命令不可用")
    try:
        completed = subprocess.run(
            [executable, *args, "--format", "json"],
            capture_output=True,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CommandError("钉钉 dws 命令不可用或执行超时") from error
    if len(completed.stdout) > MAX_DWS_OUTPUT_BYTES or len(completed.stderr) > MAX_DWS_OUTPUT_BYTES:
        raise CommandError("钉钉 dws 返回内容超出安全上限")
    if completed.returncode != 0:
        raise CommandError("钉钉 dws 命令执行失败")
    try:
        return json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CommandError("钉钉 dws 未返回有效 JSON") from error


def _search_group(group_name: str) -> tuple[str, dict[str, Any]]:
    pages: list[object] = []
    cursor = "0"
    for _ in range(5):
        payload = _run_dws(["chat", "search", "--query", group_name, "--limit", "20", "--cursor", cursor])
        pages.append(payload)
        if _page_value(payload, "hasMore") is not True:
            break
        next_cursor = _page_value(payload, "nextCursor")
        if not isinstance(next_cursor, (str, int)) or str(next_cursor) == cursor:
            raise CommandError("钉钉群搜索分页游标无效")
        cursor = str(next_cursor)
    return _exact_identity(
        pages,
        expected_name=group_name,
        name_fields=("title", "name", "groupName", "conversationTitle"),
        id_fields=("openConversationId", "conversationId", "chatId"),
        label="钉钉群",
    )


def _search_robot(robot_name: str) -> tuple[str, dict[str, Any]]:
    pages: list[object] = []
    for page in range(1, 6):
        payload = _run_dws(["chat", "bot", "search", "--name", robot_name, "--page", str(page), "--size", "50"])
        pages.append(payload)
        has_more = _page_value(payload, "hasMore")
        if has_more is not True:
            break
    return _exact_identity(
        pages,
        expected_name=robot_name,
        name_fields=("robotName", "name", "title"),
        id_fields=("robotCode", "robot-code", "code"),
        label="钉钉机器人",
    )


def _assert_robot_in_group(group_id: str, robot_name: str, robot_code: str) -> None:
    payload = _run_dws(["chat", "group", "bots", "--group", group_id])
    matches = []
    for record in _records(payload):
        name = _field(record, ("robotName", "name", "title"))
        code = _field(record, ("robotCode", "robot-code", "code"))
        if code == robot_code or (name == robot_name and not code):
            matches.append(record)
    if not matches:
        raise CommandError(f"机器人“{robot_name}”尚未安装到指定钉钉群")


def _assert_send_receipt(payload: object) -> None:
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise CommandError("钉钉消息发送回执未确认成功")
    result = payload.get("result")
    if isinstance(result, dict) and result.get("success") is False:
        raise CommandError("钉钉消息发送回执标记失败")
    failure_values = {"failed", "failure", "error", "rejected"}
    for record in _records(payload):
        status = record.get("status")
        if isinstance(status, str) and status.strip().lower() in failure_values:
            raise CommandError("钉钉消息发送 ledger 包含失败目标")


def _due_now(config: NewProductWeeklyReportConfig, now: datetime) -> bool:
    scheduled_minutes = config.send_local_time.hour * 60 + config.send_local_time.minute
    current_minutes = now.hour * 60 + now.minute
    return now.weekday() == config.send_weekday and 0 <= current_minutes - scheduled_minutes < 10


class Command(BaseCommand):
    help = "Reconcile Jackyun new-product codes and safely preview or send the previous complete weekly report."

    def add_arguments(self, parser) -> None:
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true")
        mode.add_argument("--send", action="store_true")
        parser.add_argument("--force", action="store_true", help="Bypass the configured local weekday/time gate; still requires enabled=true.")

    def handle(self, *args, **options) -> None:
        if settings.DJANGO_PROCESS_ROLE not in {"workflow_writer", "development"}:
            raise CommandError("新品周报命令只能由 workflow_writer 执行")
        dry_run = bool(options["dry_run"])
        send = bool(options["send"])
        force = bool(options["force"])
        if force and not send:
            raise CommandError("--force 只能与 --send 一起使用")

        principal = Principal(AUTOMATION_ACTOR, "新品周报自动任务", "admin", None)
        learned = learn_product_line_codes(principal)
        report = weekly_followup()
        config = NewProductWeeklyReportConfig.objects.get(id=1)
        local_now = datetime.now().astimezone()
        base = {
            "status": "ready",
            "localNow": local_now.isoformat(),
            "timezone": report["timezone"],
            "weekStart": report["weekStart"],
            "weekEnd": report["weekEnd"],
            "reportSha256": report["reportSha256"],
            "learning": learned,
            "enabled": config.enabled,
        }

        if not dry_run and not send:
            self.stdout.write(json.dumps({**base, "messageText": report["messageText"]}, ensure_ascii=False, separators=(",", ":")))
            return
        if not config.enabled:
            if send:
                self.stdout.write(json.dumps({**base, "status": "disabled"}, ensure_ascii=False, separators=(",", ":")))
                return
            raise CommandError("新品钉钉周报尚未启用")
        if send and not force and not _due_now(config, local_now):
            self.stdout.write(json.dumps({**base, "status": "not_due"}, ensure_ascii=False, separators=(",", ":")))
            return

        group_id, _group = _search_group(config.target_group_name)
        robot_code, _robot = _search_robot(config.robot_name)
        _assert_robot_in_group(group_id, config.robot_name, robot_code)
        title = f"新品销售周报｜{report['weekStart']} 至 {report['weekEnd']}"
        if dry_run:
            _run_dws([
                "chat", "+messages-send", "--as", "bot", "--robot-code", robot_code,
                "--group", group_id, "--title", title, "--markdown", str(report["messageText"]), "--dry-run",
            ])
            self.stdout.write(json.dumps({**base, "status": "dry_run_ok", "groupVerified": True, "robotVerified": True}, ensure_ascii=False, separators=(",", ":")))
            return

        delivery, claimed = claim_weekly_delivery(report, config, actor=AUTOMATION_ACTOR)
        if not claimed:
            self.stdout.write(json.dumps({**base, "status": f"already_{delivery.status}"}, ensure_ascii=False, separators=(",", ":")))
            return
        mark_weekly_delivery_sending(delivery.id)
        try:
            receipt = _run_dws([
                "chat", "+messages-send", "--as", "bot", "--robot-code", robot_code,
                "--group", group_id, "--title", title, "--markdown", str(report["messageText"]), "--yes",
            ])
            _assert_send_receipt(receipt)
        except Exception as error:
            mark_weekly_delivery_uncertain(delivery.id, error_code=type(error).__name__)
            raise
        receipt_sha = hashlib.sha256(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        finish_weekly_delivery(delivery.id, provider_receipt=f"dws-sha256:{receipt_sha}")
        self.stdout.write(json.dumps({**base, "status": "delivered"}, ensure_ascii=False, separators=(",", ":")))
