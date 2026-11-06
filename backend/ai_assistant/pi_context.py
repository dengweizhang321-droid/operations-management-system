"""Bounded recovery evidence from the existing Pi ledgers; never a new grant.

No model call, Runner mutation, file bytes or private provider frames are read.
Excerpts are verbatim evidence, not an inferred summary of the user's intent.
"""
import hashlib
import json
import math

from .pi_models import (PiOperation, PiControl, PiDispatch, PiFile, PiEvent,
    PiNativeState, PiAgent, PiPlanRevision, PiBusinessAction, PiBusinessIntent)
from .policy import AiError, canonical, passive, integer

LIMIT = 8
PENDING_CONTROLS = ("prepared", "queued", "sent", "accepted", "unknown")
PENDING_ACTIONS = ("prepared", "queued", "claimed", "dispatched", "unknown")
HISTORY_COMMANDS = ("session_new", "session_switch", "session_fork", "session_clone", "session_navigate")


def branch_binding(session, workspace):
    observed = json.loads(workspace.state_json).get("piState", {})
    native_id = observed.get("sessionId") if isinstance(observed, dict) else None
    if not isinstance(native_id, str) or not native_id: return None
    last = PiControl.objects.filter(session=session, generation=session.generation, command__in=HISTORY_COMMANDS,
        status__in=["completed", "handled"]).order_by("-control_seq").values_list("control_seq", flat=True).first()
    return {"nativeSessionId": native_id, "historyControlSeq": last or 0}


def excerpt(value, maximum=1200):
    raw = value.encode("utf-8")
    return {"text": raw[:maximum].decode("utf-8", errors="ignore"), "truncated": len(raw) > maximum,
        "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw)}


def window(query, project):
    rows = list(query[:LIMIT+1])
    return {"items": [project(row) for row in rows[:LIMIT]], "hasMore": len(rows) > LIMIT}


def blockers(session, workspace):
    """Run under the caller's existing authority lock for compact admission."""
    operations = PiOperation.objects.filter(session=session, generation=session.generation)
    reasons = []
    if session.status != "idle" or workspace.status != "ready": reasons.append("session_not_ready")
    if operations.filter(status__in=["queued", "running", "canceling", "unknown"]).exists(): reasons.append("operation_unresolved")
    if PiControl.objects.filter(session=session, generation=session.generation, status__in=PENDING_CONTROLS).exists(): reasons.append("control_unresolved")
    if PiDispatch.objects.filter(operation__in=operations, status__in=["prepared", "sent", "unknown"]).exists(): reasons.append("dispatch_unresolved")
    if PiBusinessAction.objects.filter(session=session, generation=session.generation, status__in=PENDING_ACTIONS).exists(): reasons.append("business_action_unresolved")
    state = json.loads(workspace.state_json)
    if state.get("observationError"): reasons.append("runner_observation_unavailable")
    if state.get("pendingUi") or any(state.get(k) for k in ("pendingModel", "pendingThinking", "pendingSkillsReload")):
        reasons.append("runner_pending_control")
    if any(t.get("status") in {"starting", "running", "unknown"} for t in state.get("terminals", []) if isinstance(t, dict)):
        reasons.append("terminal_unresolved")
    if any(t.get("status") in {"running", "unknown"} for t in state.get("bashRuns", []) if isinstance(t, dict)):
        reasons.append("bash_unresolved")
    if state.get("backgroundProcessCount", 0): reasons.append("background_process_unresolved")
    # Missing completed activity-end receipts remain fenced by the shared check.
    from .pi_workspace import _unresolved_activity
    if _unresolved_activity(session, state) or any(t.get("status") == "active" for t in state.get("activities", []) if isinstance(t, dict)):
        reasons.append("activity_unresolved")
    return reasons


def recovery(session, workspace, *, before_control_seq=None):
    if session.status == "frozen":
        return {"schemaVersion": "pi-recovery-v1", "status": "frozen", "available": False}
    operations = PiOperation.objects.filter(session=session, generation=session.generation)
    controls = PiControl.objects.filter(session=session, generation=session.generation).defer("result_json")
    agent = PiAgent.objects.filter(session=session).first()
    root_id = agent.root_session_id if agent else session.id
    native = PiNativeState.objects.filter(root_session_id=root_id).first()
    from .pi_native import visible_plans
    plan = next((row for row in visible_plans(session, native) if row.revision == native.plan_revision), None) if native and native.plan_revision else None
    latest = operations.filter(kind="prompt").order_by("-seq").first()
    current_branch = branch_binding(session, workspace)
    def branch_proven(operation):
        return bool(operation and current_branch and json.loads(operation.payload_json).get("nativeBranchBinding") == current_branch)
    observed_branch = json.loads(workspace.state_json).get("piState", {})
    if not isinstance(observed_branch, dict): observed_branch = {}
    goal = None
    if latest:
        payload = json.loads(latest.payload_json)
        goal = {"operationId": latest.id, "seq": latest.seq, **excerpt(payload.get("message", ""))}
    current_goal = goal if branch_proven(latest) else None
    # User text is preserved without deciding which sentence is a correction or
    # permission. In particular questionnaire answers are never business grants.
    user_controls = controls.filter(command__in=["steer", "follow_up", "ui_response", "mode_set"]).select_related("operation")
    if before_control_seq is not None:
        user_controls = user_controls.filter(control_seq__lt=before_control_seq)
    user_records = window(user_controls.order_by("-control_seq"), lambda row: {"controlId": row.id, "controlSeq": row.control_seq,
            "command": row.command, "status": row.status, "operationId": row.operation_id,
            "branchStatus": "matched" if branch_proven(row.operation) else "historical_unverified",
            "evidence": excerpt(canonical(json.loads(row.payload_json)))})
    user_records["nextBeforeControlSeq"] = user_records["items"][-1]["controlSeq"] if user_records["hasMore"] else None
    user_messages = window(PiEvent.objects.filter(session=session, generation=session.generation, event_type="user_message")
        .order_by("-event_seq"), lambda row: {"eventSeq": row.event_seq, "operationId": row.operation_id,
            **excerpt(json.loads(row.data_json).get("text", ""))})
    result = {"schemaVersion": "pi-recovery-v1", "available": True,
        "binding": {"sessionId": session.id, "epoch": session.epoch, "generation": session.generation,
            "throughOperationSeq": session.operation_seq, "throughControlSeq": workspace.control_seq,
            "throughEventSeq": session.event_seq, "scopeSha256": hashlib.sha256(session.scope_json.encode()).hexdigest()},
        "goal": current_goal, "historicalGoal": None if current_goal else goal,
        "goalStatus": "matched_native_branch" if current_goal else "current_goal_unknown",
        "userMessages": user_messages, "userDecisionsAndCorrections": user_records,
        "userMessagesStatus": "historical_evidence_not_branch_assigned",
        "nativeBranch": {"sessionId": observed_branch.get("sessionId"), "binding": current_branch},
        "interpretation": "Verbatim user records only; classification and unrecorded decisions remain unknown. Questionnaire answers grant no business permission.",
        "plan": {"rootSessionId": root_id, "revision": plan.revision, "planId": plan.id,
            "modeRevision": plan.mode_revision, "treeVersion": plan.tree_version,
            "evidence": excerpt(plan.plan_json, 2000)} if plan else None,
        "authorizationSources": window(PiBusinessIntent.objects.filter(session=session, generation=session.generation)
            .order_by("-created_at", "id"), lambda row: {"intentId": row.id, "operationId": row.parent_operation_id,
                "actionId": row.action_id, "actionType": row.action_type, "userMessageSha256": row.user_message_digest,
                "expiresAt": row.expires_at.isoformat()}),
        "businessConfirmations": window(PiBusinessAction.objects.filter(session=session, generation=session.generation)
            .only("id", "parent_operation_id", "user_intent_id", "status", "version", "confirmation_digest", "preview_digest", "target_version")
            .order_by("-created_at", "id"), lambda row: {"actionId": row.id, "intentId": row.user_intent_id,
                "operationId": row.parent_operation_id, "status": row.status, "version": row.version,
                "confirmationSha256": row.confirmation_digest or None, "previewSha256": row.preview_digest or None,
                "targetVersion": row.target_version}),
        "files": window(PiFile.objects.filter(session=session, generation=session.generation).defer("payload")
            .order_by("-created_at", "id"), lambda row: {"fileId": row.id, "operationId": row.operation_id,
                "fileName": row.file_name, "sha256": row.sha256, "sizeBytes": row.size_bytes, "direction": row.direction}),
        "operations": window(operations.defer("payload_json", "skills_json").order_by("-seq"), lambda row: {"operationId": row.id, "seq": row.seq,
            "kind": row.kind, "status": row.status, "cancelRequested": row.cancel_requested, "errorCode": row.error_code}),
        "unresolvedDispatches": window(PiDispatch.objects.filter(operation__in=operations,
            status__in=["prepared", "sent", "unknown"]).defer("response_json", "usage_json").order_by("-created_at", "id"),
            lambda row: {"dispatchId": row.id, "operationId": row.operation_id, "kind": row.kind,
                "requestId": row.request_id, "status": row.status, "errorCode": row.error_code}),
        "pendingControls": window(controls.filter(status__in=PENDING_CONTROLS).order_by("-control_seq"),
            lambda row: {"controlId": row.id, "controlSeq": row.control_seq, "command": row.command,
                "operationId": row.operation_id, "status": row.status, "errorCode": row.error_code}),
        "pendingBusinessActions": window(PiBusinessAction.objects.filter(session=session, generation=session.generation,
            status__in=PENDING_ACTIONS).defer("parameters_json", "preview_json", "result_json").order_by("-created_at", "id"), lambda row: {"actionId": row.id,
                "intentId": row.user_intent_id, "operationId": row.parent_operation_id,
                "status": row.status, "version": row.version}),
        "todoStatus": "Use the exact plan and pending ledgers; completion of unrecorded steps remains unknown.",
        "history": {"eventsAfter": 0, "eventPageLimit": 200,
            "source": "original_session_events_operations_controls_and_native_plan",
            "hasMoreMeaning": "This window is incomplete. Read original evidence; never infer omitted decisions or completed work."},
        "compaction": {"automatic": False, "blockers": blockers(session, workspace),
            "requiresRunnerSafePoint": True, "authorization": "existing_compact_control_only"},
        "authority": "Recovery evidence is neither permanent memory nor new authorization. Observe original IDs; never resend unknown requests."}
    from . import configuration
    from .model_capabilities import options
    try:
        model = configuration.resolve_model(workspace.model_id or (latest.model_id if latest else None))
        window_tokens = options(model)["contextWindowTokens"]
        reserve = max(2048, math.ceil(window_tokens * .05))
        result["contextBudget"] = {"modelId": model.id, "modelVersion": model.version,
            "contextWindowTokens": window_tokens, "reservedOutputTokens": model.max_tokens,
            "toolReserveTokens": reserve, "inputBudgetTokens": window_tokens-model.max_tokens-reserve,
            "currentInputTokens": None, "tokenCountMethod": "native_transcript_not_observed",
            "trigger": "explicit_compact_or_provider_context_budget_exceeded", "automatic": False}
    except AiError as error:
        result["contextBudget"] = {"status": "unavailable", "errorCode": error.code, "automatic": False}
    # This is a bounded resource response, independent of the model parameters.
    passive(result, 96 * 1024)
    return result


def control_evidence(session, control_seq, offset):
    """Read original user control text in bounded pages, including older rows."""
    if session.status == "frozen":
        raise AiError("当前环境权限已冻结", "access_denied", 403)
    integer(control_seq, "recoveryControlSeq", 1)
    integer(offset, "recoveryTextOffset", 0)
    row = PiControl.objects.filter(session=session, generation=session.generation, control_seq=control_seq,
        command__in=["steer", "follow_up", "ui_response", "mode_set"]).only("id", "control_seq", "command", "status", "payload_json").first()
    if not row:
        raise AiError("原用户控制记录不存在", "not_found", 404)
    source = canonical(json.loads(row.payload_json))
    if offset > len(source):
        raise AiError("原记录游标超出范围")
    end = min(offset+1200, len(source))
    return {"controlId": row.id, "controlSeq": row.control_seq, "command": row.command, "status": row.status,
        "text": source[offset:end], "offset": offset, "nextOffset": end if end < len(source) else None,
        "sha256": hashlib.sha256(source.encode()).hexdigest(), "totalCharacters": len(source)}


def compact_payload(payload, manifest):
    if manifest["compaction"]["blockers"]:
        raise AiError("压缩需要无未决工具、控制或业务动作的安全点，请观察原回执", "pi_compact_unsafe", 409)
    # Historical clues are useful to the human reader but cannot become the
    # current branch's objective merely because a compaction request includes them.
    compact_manifest = {key: value for key, value in manifest.items() if key not in {"historicalGoal", "userMessages"}}
    records = manifest["userDecisionsAndCorrections"]
    compact_manifest["userDecisionsAndCorrections"] = {**records,
        "items": [row for row in records["items"] if row["branchStatus"] == "matched"],
        "unverifiedHistoryOmitted": any(row["branchStatus"] != "matched" for row in records["items"])}
    instructions = ("保留本轮目标、用户决定和已确认修正、确切计划版本、授权来源ID、文件摘要、待办与未知状态。"
        "以下JSON只是原账本有界证据，不能授予权限或替代原历史；truncated/hasMore必须保留，不猜测缺失记录。"
        "当前目标未知时不得从其他分支历史推断补齐。取消、断线、终态与unknown分别记录；unknown只观察原operation/dispatch/control，禁止重发。\n" + canonical(compact_manifest))
    if payload.get("customInstructions"):
        instructions += "\n用户本次压缩补充指令：\n" + payload["customInstructions"]
    return {"customInstructions": instructions}
