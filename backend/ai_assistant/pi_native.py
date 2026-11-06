"""Root-tree admission, durable plans and independent Pi child sessions.

All mutations run under the existing AI authority transaction. Runner state is
an observation; it never grants execution or ownership of a business intent.
"""
import hashlib
import json
import os
from datetime import timedelta

from django.utils import timezone
from django.db.models import JSONField, OuterRef, Q, Subquery
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from sales.auth import Principal
from . import pi_service as service
from .pi_models import (PiNativeState, PiAgent, PiPlanRevision, PiAgentMessage,
    PiAgentWait, PiFileHandoff, PiBusinessDelegation, PiBusinessIntent,
    PiBusinessAction, PiSession, PiOperation, PiDispatch, PiFile, PiWorkspace,
    PiControl, PiUiRequest, PiEvent)
from .policy import (AiError, canonical, digest, fields, identifier, integer,
    mutation, passive, scope_covers, text, uid, current_principal)

COMMANDS = {"mode_set", "plan_save", "agent_spawn", "agent_list", "agent_send",
    "agent_follow_up", "agent_wait", "agent_cancel", "agent_close"}
TOOLS = COMMANDS
PLAN_LOCAL = {"read", "grep", "find", "ls", "questionnaire", "analysis_helper"}
PLAN_CONTROLS = {"tree", "stats", "file_list", "file_read", "file_download", "steer",
    "follow_up", "clear_queue", "abort_bash", "ui_response", "pause", "wake", "terminal_close"}


def state_for(session, *, lock=False):
    agent = PiAgent.objects.filter(session=session).first()
    root = agent.root_session_id if agent else session.id
    query = PiNativeState.objects.select_for_update() if lock else PiNativeState.objects
    state = query.filter(root_session_id=root).first()
    if state is None:
        with mutation():
            concurrency = service.number(os.getenv("PI_MAX_CONCURRENT_CHILDREN", "3"), "PI_MAX_CONCURRENT_CHILDREN", 1, 99)
            state, _ = PiNativeState.objects.get_or_create(root_session_id=root, defaults={"max_concurrent_children": concurrency})
    if agent is None:
        with mutation():
            PiAgent.objects.get_or_create(session=session, defaults={"root_session_id": root})
    return state


def admission(operation, *, lock=False):
    state = state_for(operation.session, lock=lock)
    return {"mode": state.target_mode if state.transition_status == "switching" else state.mode,
        "modeRevision": state.mode_revision, "admissionEpoch": state.admission_epoch,
        "rootSessionId": state.root_session_id, "treeVersion": state.tree_version,
        "scopeSha256": hashlib.sha256(operation.scope_json.encode()).hexdigest()}


def authorize(operation, supplied=None, *, kind="model", name="", lock=False, require_supplied=True):
    state = state_for(operation.session, lock=lock)
    principal = current_principal(Principal(operation.session.owner_email, operation.session.owner_email,
        operation.actor_role, json.loads(operation.scope_json)), write=True, background=True)
    root = service.get_session(state.root_session_id, principal, lock=lock)
    agent = PiAgent.objects.get(session=operation.session)
    settings = json.loads(agent.settings_json)
    if agent.parent_session_id and (settings.get("rootGeneration") != root.generation or settings.get("rootEpoch") != root.epoch):
        raise AiError("根会话环境代际已变化", "pi_root_generation_changed", 403)
    if root.status == "frozen" or agent.lifecycle != "open":
        raise AiError("代理树已停止或隔离", "pi_tree_fenced", 409)
    expected = admission(operation)
    # require_supplied defaults to True: any caller that passes no `supplied`
    # and does not explicitly opt out gets the comparison enforced against a
    # null/missing value, so a future client-facing call site that forgets to
    # pass an admission cannot silently skip the check (the null bypass this
    # function exists to close). The small, closed set of internal callers
    # that re-authorize with no client value to compare (listed at each call
    # site) pass require_supplied=False explicitly.
    if (supplied is not None or require_supplied) and (not isinstance(supplied, dict) or set(supplied) != set(expected)
            or any(supplied[k] != v or type(supplied[k]) is not type(v) for k, v in expected.items() if k != "treeVersion")
            or type(supplied.get("treeVersion")) is not int or not 1 <= supplied["treeVersion"] <= expected["treeVersion"]):
        raise AiError("代理树准入版本已变化", "pi_admission_changed", 409)
    if state.transition_status != "stable":
        raise AiError("模式正在排空，禁止新增执行", "pi_mode_switching", 409)
    if state.mode == "plan":
        if kind in {"business", "workspace"} and name not in PLAN_CONTROLS:
            raise AiError("计划模式禁止此执行能力", "pi_plan_read_only", 403)
        if kind == "admission" and name not in PLAN_LOCAL:
            raise AiError("计划模式只允许读取隔离输入和内置资源", "pi_plan_read_only", 403)
    return state


def _members(state):
    return PiAgent.objects.filter(root_session_id=state.root_session_id).select_related("session")


def _target(state, agent_id):
    row = _members(state).filter(session_id=identifier(agent_id, "agentId")).first()
    if not row:
        raise AiError("代理不属于当前任务树", "access_denied", 403)
    return row


def _plan(value):
    fields(value, {"goal", "constraints", "steps", "deliverables", "openQuestions"}, {"goal", "constraints", "steps", "deliverables", "openQuestions"})
    result = {"goal": text(value["goal"], "目标", 4000)}
    for key in ("constraints", "steps", "deliverables", "openQuestions"):
        values = value[key]
        if not isinstance(values, list) or len(values) > 100:
            raise AiError("计划条目无效")
        result[key] = [text(item, key, 4000) for item in values]
    passive(result, 256 * 1024)
    return result


def save_plan(session, payload):
    fields(payload, {"plan", "expectedRevision"}, {"plan"})
    state = state_for(session, lock=True)
    if payload.get("expectedRevision", state.plan_revision) != state.plan_revision:
        raise AiError("计划版本已变化", "pi_plan_revision_conflict", 409)
    value = _plan(payload["plan"])
    state.plan_revision += 1
    saved = PiPlanRevision.objects.create(id=uid("pi-plan"), root_session_id=state.root_session_id,
        revision=state.plan_revision, mode_revision=state.mode_revision, tree_version=state.tree_version,
        scope_sha256=hashlib.sha256(PiSession.objects.get(pk=state.root_session_id).scope_json.encode()).hexdigest(), plan_json=canonical(value))
    state.save(update_fields=["plan_revision"])
    root = PiSession.objects.select_for_update().get(pk=state.root_session_id)
    evidence = {"planId": saved.id, "planRevision": state.plan_revision, "plan": value,
        "rootBinding": {"rootSessionId": root.id, "epoch": root.epoch, "generation": root.generation,
            "scopeSha256": hashlib.sha256(root.scope_json.encode()).hexdigest(),
            "selectionSha256": hashlib.sha256(root.selection_json.encode()).hexdigest(), "actorRole": root.actor_role}}
    service.event(root, "plan_saved", evidence)
    if session.id != root.id:
        service.event(session, "plan_saved", evidence)
    else:
        session.event_seq = root.event_seq
    return {"planRevision": state.plan_revision, "plan": value}


def visible_plans(session, state, *, limit=30):
    """Plan text needs original current-root-generation save evidence.

    Revision and equal scope alone cannot distinguish a reset to the same scope.
    Old root events remain audit evidence, never new-environment context.
    """
    root = PiSession.objects.get(pk=state.root_session_id)
    member = PiAgent.objects.filter(session=session).first()
    if (root.status == "frozen" or root.owner_email != session.owner_email or root.actor_role != session.actor_role
            or not scope_covers(json.loads(session.scope_json), root.scope_json)):
        return []
    if session.id != root.id:
        settings = json.loads(member.settings_json) if member else {}
        if (not member or member.lifecycle != "open" or settings.get("rootEpoch") != root.epoch
                or settings.get("rootGeneration") != root.generation):
            return []
    scope_sha = hashlib.sha256(root.scope_json.encode()).hexdigest()
    expected = {"rootSessionId": root.id, "epoch": root.epoch, "generation": root.generation,
        "scopeSha256": scope_sha, "selectionSha256": hashlib.sha256(root.selection_json.encode()).hexdigest(), "actorRole": root.actor_role}
    evidence = {}
    for event in PiEvent.objects.filter(session=root, generation=root.generation, event_type="plan_saved").order_by("-event_seq")[:limit]:
        data = json.loads(event.data_json)
        if "rootBinding" in data and data["rootBinding"] != expected:
            continue
        revision = data.get("planRevision")
        if type(revision) is int and revision not in evidence:
            evidence[revision] = data
    plans = PiPlanRevision.objects.filter(root_session=root, scope_sha256=scope_sha, revision__in=evidence).order_by("-revision")
    return [plan for plan in plans if evidence[plan.revision].get("plan") == json.loads(plan.plan_json)
        and evidence[plan.revision].get("planId", plan.id) == plan.id][:limit]


def reconcile_mode(state):
    if state.transition_status != "switching":
        return
    ids = list(_members(state).exclude(lifecycle="closed").values_list("session_id", flat=True))
    for member_id in ids:
        last = PiOperation.objects.filter(session_id=member_id).order_by("-seq").first()
        if last and PiDispatch.objects.filter(operation__session_id=member_id, operation__generation=last.generation,
                kind="runner:create", status="completed").exists() and not PiControl.objects.filter(operation=last,
                client_request_id="native-mode-"+str(state.admission_epoch), command="mode_set",
                payload_json=canonical({"admission": admission(last)}), status__in=["completed", "handled"]).exists():
            return
    if PiOperation.objects.filter(session_id__in=ids, status__in=service.ACTIVE).exists():
        return
    if PiBusinessAction.objects.filter(session_id__in=ids, status__in=["claimed", "dispatched", "unknown"]).exists():
        return
    if PiControl.objects.filter(session_id__in=ids, status__in=["sent", "unknown"]).exists():
        return
    state.mode, state.transition_status = state.target_mode, "stable"
    state.save(update_fields=["mode", "transition_status"])


def set_mode(session, payload, *, from_model=False):
    fields(payload, {"mode", "planRevision", "modeRevision", "expectedModeRevision", "treeVersion", "scopeSha256"}, {"mode"})
    target = payload["mode"]
    if target not in {"plan", "execute"}:
        raise AiError("模式无效")
    state = state_for(session, lock=True)
    reconcile_mode(state)
    if target == "execute":
        if from_model:
            raise AiError("只有用户可以批准执行计划", "access_denied", 403)
        if session.id != state.root_session_id:
            raise AiError("请在根会话批准执行计划", "access_denied", 403)
        expected_revision = payload.get("expectedModeRevision", payload.get("modeRevision"))
        if (state.transition_status != "stable" or not state.plan_revision or payload.get("planRevision") != state.plan_revision
                or expected_revision != state.mode_revision or payload.get("treeVersion") != state.tree_version):
            raise AiError("请复核当前计划及代理树版本后批准", "pi_plan_approval_stale", 409)
        scope_sha = hashlib.sha256(session.scope_json.encode()).hexdigest()
        latest = next((plan for plan in visible_plans(session, state) if plan.revision == state.plan_revision), None)
        if latest is None:
            raise AiError("当前环境没有可批准的原计划，请重新保存", "pi_plan_scope_changed", 409)
        if latest.scope_sha256 != scope_sha or payload.get("scopeSha256", scope_sha) != scope_sha:
            raise AiError("计划范围已变化，请重新保存计划", "pi_plan_scope_changed", 409)
    if target == state.mode and state.transition_status == "stable":
        return {"status": "stable", "admission": admission_for_session(session)}
    # Epoch changes before cancellation and before sending any Runner control.
    # Every descendant's next model/tool/local reservation therefore refuses.
    state.target_mode, state.transition_status = target, "switching"
    state.mode_revision += 1
    state.admission_epoch += 1
    state.updated_at = timezone.now()
    state.save()
    ids = list(_members(state).exclude(lifecycle="closed").values_list("session_id", flat=True))
    for member in PiSession.objects.select_for_update().filter(pk__in=ids):
        _cancel_session(member, reason="mode_changed", close=False)
    PiBusinessDelegation.objects.filter(owner_session_id__in=ids, status="active").update(status="revoked")
    reconcile_mode(state)
    session.refresh_from_db()
    service.event(session, "mode_changed", {"mode": state.mode, "targetMode": target,
        "status": state.transition_status, "modeRevision": state.mode_revision, "admissionEpoch": state.admission_epoch})
    return {"status": state.transition_status, "admission": admission_for_session(session)}


def admission_for_session(session):
    state = state_for(session)
    return {"mode": state.target_mode if state.transition_status == "switching" else state.mode,
        "modeRevision": state.mode_revision, "admissionEpoch": state.admission_epoch,
        "rootSessionId": state.root_session_id, "treeVersion": state.tree_version,
        "scopeSha256": hashlib.sha256(session.scope_json.encode()).hexdigest()}


def _message(state, source, target, kind, message):
    state.message_seq += 1
    state.save(update_fields=["message_seq"])
    row = PiAgentMessage.objects.create(id=uid("pi-message"), root_session_id=state.root_session_id,
        from_session=source, to_session=target, seq=state.message_seq, kind=kind, message=message)
    target = PiSession.objects.select_for_update().get(pk=target.pk)
    root = PiSession.objects.get(pk=state.root_session_id)
    binding = {"root": message_session_binding(root), "source": message_session_binding(source),
        "target": message_session_binding(target)}
    service.event(target, "agent_message", {"messageId": row.id, "fromSessionId": source.id,
        "kind": kind, "seq": row.seq, "messageSha256": hashlib.sha256(message.encode()).hexdigest(), "binding": binding})
    wake_waits(state)
    return row


def message_session_binding(session, agent=None):
    agent = agent or PiAgent.objects.filter(session=session).first()
    settings = json.loads(agent.settings_json) if agent else {}
    return {"sessionId": session.id, "epoch": session.epoch, "generation": session.generation,
        "ownerSha256": hashlib.sha256(session.owner_email.encode()).hexdigest(), "actorRole": session.actor_role,
        "scopeSha256": hashlib.sha256(session.scope_json.encode()).hexdigest(),
        "selectionSha256": hashlib.sha256(session.selection_json.encode()).hexdigest(),
        "rootSessionId": agent.root_session_id if agent else None,
        "parentSessionId": agent.parent_session_id if agent else None,
        "rootEpoch": settings.get("rootEpoch"), "rootGeneration": settings.get("rootGeneration")}


def visible_messages(session, state, root, *, model_inbox=False):
    """No historical message text without exact creation-time participant proof."""
    if model_inbox:
        return _bound_message_rows(session, state, root, target_id=session.id, kinds=["send", "follow_up"], limit=50)
    return _bound_message_rows(session, state, root)


def _bound_message_rows(session, state, root, *, target_id=None, kinds=None, after_seq=0, after_created=None, ascending=False, limit=101):
    members = {member.session_id: member for member in _members(state)}
    allowed = {}
    for member_id, member in members.items():
        target = member.session
        settings = json.loads(member.settings_json)
        if (target.owner_email != root.owner_email or target.actor_role != root.actor_role
                or not scope_covers(json.loads(root.scope_json), target.scope_json)):
            continue
        if member_id != root.id and (settings.get("rootEpoch") != root.epoch or settings.get("rootGeneration") != root.generation):
            continue
        allowed[member_id] = target
    root_binding = message_session_binding(root, members.get(root.id))
    bindings = {key: message_session_binding(value, members[key]) for key, value in allowed.items()}
    # New messages carry a root/endpoint proof in the existing immutable event.
    # Filter that proof BEFORE the bounded row window: an unproved old prefix
    # must neither become new prompt text nor starve later valid follow-ups.
    events = PiEvent.objects.filter(event_type="agent_message", session_id__in=allowed).annotate(
        _payload=Cast("data_json", JSONField()), _message_id=KeyTextTransform("messageId", Cast("data_json", JSONField())))
    events = events.filter(_payload__binding__root__sessionId=root.id,
        _payload__binding__root__epoch=root.epoch, _payload__binding__root__generation=root.generation)
    candidates = PiAgentMessage.objects.filter(root_session=root, from_session_id__in=allowed, to_session_id__in=allowed,
        seq__gt=after_seq, id__in=Subquery(events.values("_message_id")))
    if session.id != root.id:
        candidates = candidates.filter(Q(from_session=session) | Q(to_session=session))
    if target_id is not None: candidates = candidates.filter(to_session_id=target_id)
    if kinds is not None: candidates = candidates.filter(kind__in=kinds)
    if after_created is not None: candidates = candidates.filter(created_at__gt=after_created)
    candidates = list(candidates.annotate(_proof_event_id=Subquery(events.filter(_message_id=OuterRef("id")).values("id")[:1]))
        .order_by("seq" if ascending else "-seq")[:limit])
    proofs = {event.id:event for event in PiEvent.objects.filter(id__in=[row._proof_event_id for row in candidates])}
    result = []
    for row in candidates:
        event = proofs[row._proof_event_id]
        data = json.loads(event.data_json); proof = data.get("binding")
        if not isinstance(proof, dict) or proof.get("root") != root_binding: continue
        source_id = proof.get("source", {}).get("sessionId"); target_id = proof.get("target", {}).get("sessionId")
        if (source_id not in bindings or target_id not in bindings or proof.get("source") != bindings[source_id]
                or proof.get("target") != bindings[target_id] or event.session_id != target_id
                or event.generation != allowed[target_id].generation): continue
        if (row.from_session_id == proof["source"]["sessionId"] and row.to_session_id == proof["target"]["sessionId"]
                and row.seq == data.get("seq") and row.kind == data.get("kind")
                and hashlib.sha256(row.message.encode()).hexdigest() == data.get("messageSha256")):
            result.append(row)
    return result


def _new_run(target, message, *, parent=None, message_cursor=None):
    from . import configuration
    settings = json.loads(target.settings_json)
    previous = PiOperation.objects.filter(session_id=target.session_id).order_by("-seq").first()
    if target.parent_session_id is None:
        settings = {"modelId": previous.model_id if previous else None,
            "modelVersion": previous.model_version if previous else None,
            "skills": json.loads(previous.skills_json) if previous else [],
            "thinkingLevel": json.loads(previous.payload_json).get("thinkingLevel", "") if previous else ""}
    workspace = PiWorkspace.objects.filter(session_id=target.session_id).first()
    model = configuration.resolve_model(workspace.model_id if workspace and workspace.model_id else settings["modelId"])
    expected_version = workspace.model_version if workspace and workspace.model_id else settings["modelVersion"]
    if expected_version is not None and model.version != expected_version:
        raise AiError("代理的实际模型版本已变化，请显式选择模型", "pi_model_changed", 409)
    level = workspace.thinking_level if workspace and workspace.thinking_level else settings.get("thinkingLevel", "")
    session = PiSession.objects.select_for_update().get(pk=target.session_id)
    if target.lifecycle != "open" or session.status in {"unknown", "frozen", "canceling"} or PiOperation.objects.filter(session=session, status__in=service.ACTIVE).exists():
        raise AiError("目标代理已有运行或保留未知围栏", "pi_operation_active", 409)
    session.operation_seq += 1
    op = PiOperation.objects.create(id=uid("pi-op"), session=session, client_request_id=uid("pi-child-run"),
        request_digest=digest({"message": message, "settings": settings}), epoch=session.epoch,
        generation=session.generation, seq=session.operation_seq, actor_role=session.actor_role,
        scope_json=session.scope_json, model_id=model.id, model_version=model.version,
        skills_json=canonical(settings.get("skills", [])), payload_json=canonical({"message": message,
            "messageCursor": state_for(session).message_seq if message_cursor is None else message_cursor,
            "skillIds": [s["id"] for s in settings.get("skills", [])], "fileIds": [],
            "handoffIds": list(PiFileHandoff.objects.filter(target_session=session, target_generation=session.generation).values_list("id", flat=True)),
            "thinkingLevel": level, "shopSelection": json.loads(session.selection_json)}))
    session.status, session.active_operation_id = "queued", op.id
    session.save(update_fields=["operation_seq", "status", "active_operation_id"])
    service.event(session, "user_message", {"text": message}, op)
    service.event(session, "status", {"status": "queued"}, op)
    return op


def spawn(session, payload, operation, principal):
    fields(payload, {"task", "title", "context", "fileIds", "dependencies", "modelId", "thinkingLevel", "skills", "businessActionIds"}, {"task"})
    task = text(payload["task"], "任务", 200000)
    context = text(payload.get("context", ""), "显式上下文", 200000, empty=True)
    state = state_for(session, lock=True)
    if state.transition_status != "stable":
        raise AiError("模式切换尚未完成", "pi_mode_switching", 409)
    if _members(state).count() >= 100:
        raise AiError("单任务树代理数量超过有界存储窗口", "pi_agent_tree_limit", 409)
    if not operation:
        operation = PiOperation.objects.filter(session=session).order_by("-seq").first()
    if not operation:
        raise AiError("请先创建根任务", "pi_parent_operation_required", 409)
    parent_settings = json.loads(operation.payload_json)
    parent_workspace = PiWorkspace.objects.filter(session=session, generation=session.generation).first()
    skills = json.loads(operation.skills_json)
    selected = payload.get("skills", [s["id"] for s in skills])
    if not isinstance(selected, list) or not set(selected) <= {s["id"] for s in skills}:
        raise AiError("子代理技能必须取父级已审核快照交集", "access_denied", 403)
    from . import configuration
    from .pi_workspace import effective_model
    actual_model = parent_workspace.model_id if parent_workspace and parent_workspace.model_id else operation.model_id
    model = configuration.resolve_model(payload.get("modelId", actual_model))
    if "modelId" not in payload and model.version != (parent_workspace.model_version if parent_workspace and parent_workspace.model_id else operation.model_version):
        raise AiError("父代理实际模型版本已变化", "pi_model_changed", 409)
    actual_level = parent_workspace.thinking_level if parent_workspace and parent_workspace.thinking_level else parent_settings.get("thinkingLevel", "")
    level = payload.get("thinkingLevel", actual_level)
    effective_model(model, level)
    deps, files, actions = payload.get("dependencies", []), payload.get("fileIds", []), payload.get("businessActionIds", [])
    for values in (deps, files, actions):
        if not isinstance(values, list) or len(values) > 16 or any(not isinstance(x, str) for x in values) or len(set(values)) != len(values):
            raise AiError("代理依赖、文件或动作集合无效")
    for dep in deps:
        _target(state, dep)
        ancestor = session.id
        while ancestor:
            if dep == ancestor:
                raise AiError("子代理不能依赖祖先完成", "pi_agent_dependency_cycle", 409)
            ancestor_row = PiAgent.objects.filter(session_id=ancestor).first()
            ancestor = ancestor_row.parent_session_id if ancestor_row else None
    child = PiSession.objects.create(id=uid("pi-session"), owner_email=session.owner_email, actor_role=principal.role,
        client_request_id=uid("pi-spawn"), request_digest=digest(payload), title=text(payload.get("title", task[:80]), "标题", 160),
        scope_json=operation.scope_json, selection_json=session.selection_json)
    settings = {"modelId": model.id, "modelVersion": model.version, "thinkingLevel": level,
        "skills": [s for s in skills if s["id"] in selected], "rootGeneration": PiSession.objects.get(pk=state.root_session_id).generation,
        "rootEpoch": PiSession.objects.get(pk=state.root_session_id).epoch}
    agent = PiAgent.objects.create(session=child, root_session_id=state.root_session_id, parent_session=session,
        parent_operation=operation, dependencies_json=canonical(deps), settings_json=canonical(settings))
    for file_id in files:
        source = PiFile.objects.filter(pk=identifier(file_id), session=session, generation=session.generation).first()
        if not source or not scope_covers(json.loads(child.scope_json), source.scope_json):
            raise AiError("交接文件不在父代理当前授权范围", "access_denied", 403)
        PiFileHandoff.objects.create(id=uid("pi-handoff"), source_file=source, target_session=child,
            source_generation=source.generation, target_generation=child.generation, scope_json=source.scope_json,
            sha256=source.sha256, expires_at=timezone.now()+timedelta(hours=24))
    child_op = _new_run(agent, task + ("\n\n显式交接上下文：\n"+context if context else ""), parent=operation)
    for action_id in actions:
        intent = PiBusinessIntent.objects.select_for_update().filter(action_id=identifier(action_id)).first()
        delegation = PiBusinessDelegation.objects.select_for_update().filter(intent=intent).first() if intent else None
        if delegation and (delegation.owner_operation_id != operation.id or delegation.status != "active"
                or delegation.admission_epoch != state.admission_epoch):
            raise AiError("原动作已绑定其他或失效的委派所有者", "pi_business_owner_conflict", 409)
        if intent and not delegation and intent.parent_operation_id != operation.id:
            raise AiError("原业务意图不属于当前父代理", "access_denied", 403)
        if not intent or intent.expires_at <= timezone.now() or state.mode != "execute":
            raise AiError("原用户业务意图不可委派", "pi_business_delegation_denied", 403)
        existing = PiBusinessAction.objects.select_for_update().filter(pk=intent.action_id).first()
        if existing and existing.status != "prepared":
            raise AiError("已派发或未知动作不能转移所有者", "pi_business_owner_conflict", 409)
        if delegation:
            changed = PiBusinessDelegation.objects.filter(intent=intent, owner_operation=operation,
                version=delegation.version, status="active").update(owner_session=child, owner_operation=child_op,
                    action_version=existing.version if existing else 0, version=delegation.version+1)
            if changed != 1:
                raise AiError("委派所有者CAS冲突", "pi_business_owner_conflict", 409)
        else:
            PiBusinessDelegation.objects.create(intent=intent, owner_session=child, owner_operation=child_op,
                action_version=existing.version if existing else 0, admission_epoch=state.admission_epoch)
    state.tree_version += 1
    state.save(update_fields=["tree_version"])
    _message(state, session, child, "spawn", task)
    return {"agentId": child.id, "sessionId": child.id, "operationId": child_op.id, "status": "queued", "settings": settings}


def _cancel_session(session, *, reason, close=False):
    for op in PiOperation.objects.select_for_update().filter(session=session, status__in=service.ACTIVE):
        op.cancel_requested = True
        if op.status == "queued":
            op.status = "canceled"
            session.status, session.active_operation_id = "idle", ""
        elif op.status != "unknown":
            op.status, session.status = "canceling", "canceling"
        op.save()
        service.stop_exports(op)
        from .pi_business import cancel_parent
        cancel_parent(op)
    PiUiRequest.objects.filter(session=session, status="pending").update(status="expired")
    PiAgentWait.objects.filter(requester_session=session, status="pending").update(status="canceled", result_json=canonical({"reason": reason}))
    PiBusinessDelegation.objects.filter(owner_session=session, status="active").update(status="revoked")
    session.save(update_fields=["status", "active_operation_id"])
    if close:
        PiAgent.objects.filter(session=session).update(lifecycle="canceling")


def clear_agent_queue(session):
    state = state_for(session, lock=True)
    row = _message(state, session, session, "queue_cleared", "clear_queue")
    return {"cursor": row.seq, "cleared": True}


def cancel_tree(session):
    state = state_for(session, lock=True)
    members = list(_members(state))
    ids = {session.id}
    for _ in members:
        ids.update(a.session_id for a in members if a.parent_session_id in ids)
    for member in PiSession.objects.select_for_update().filter(pk__in=ids):
        _cancel_session(member, reason="canceled", close=member.id != state.root_session_id)
    wake_waits(state)


def rotate_root_environment(session):
    state = state_for(session, lock=True)
    if session.id != state.root_session_id:
        raise AiError("独立子代理不允许单独切换根环境范围", "pi_child_environment_fixed", 409)
    ids = list(_members(state).exclude(session=session).values_list("session_id", flat=True))
    if (PiOperation.objects.filter(session_id__in=ids, status__in=service.ACTIVE).exists()
            or PiBusinessAction.objects.filter(session_id__in=[*ids, session.id], status__in=["claimed", "dispatched", "unknown"]).exists()):
        raise AiError("旧代理树仍存活，请先停止并观察原回执", "pi_tree_environment_active", 409)
    state.admission_epoch += 1
    state.tree_version += 1
    state.save(update_fields=["admission_epoch", "tree_version"])
    for member in _members(state).exclude(session=session):
        latest = PiOperation.objects.filter(session=member.session).order_by("-seq").first()
        if latest:
            service.request_freeze(latest)
    PiAgent.objects.filter(session_id__in=ids).update(lifecycle="closed")
    PiBusinessDelegation.objects.filter(owner_session_id__in=[*ids, session.id], status="active").update(status="revoked")


def history_preflight(session):
    state = state_for(session, lock=True)
    if session.id != state.root_session_id:
        raise AiError("子代理历史分支须先关闭原代理并由父级创建新任务", "pi_child_environment_fixed", 409)
    ids = list(_members(state).exclude(session=session).values_list("session_id", flat=True))
    if (PiOperation.objects.filter(session_id__in=ids, status__in=service.ACTIVE).exists()
            or PiBusinessAction.objects.filter(session_id__in=[session.id, *ids], status__in=["claimed", "dispatched", "unknown"]).exists()):
        raise AiError("分支前需确认原任务树已终结", "pi_tree_environment_active", 409)


def history_changed(session):
    state = state_for(session, lock=True)
    plans = visible_plans(session, state)
    latest_plan = plans[0] if plans else None
    for member in _members(state).exclude(session=session).exclude(lifecycle="closed"):
        member.lifecycle = "closed"
        member.save(update_fields=["lifecycle"])
        old = PiOperation.objects.filter(session=member.session).order_by("-seq").first()
        if old: service.request_freeze(old)
    PiBusinessDelegation.objects.filter(intent__session_id=state.root_session_id, status="active").update(status="revoked")
    state.tree_version += 1
    state.save(update_fields=["tree_version"])
    clear_agent_queue(session)
    if latest_plan:
        set_mode(session, {"mode": "plan"})
        save_plan(session, {"plan": json.loads(latest_plan.plan_json)})


def wake_waits(state):
    for wait in PiAgentWait.objects.select_for_update().filter(root_session_id=state.root_session_id, status="pending")[:100]:
        agents = list(_members(state).filter(session_id__in=json.loads(wait.agent_ids_json)))
        messages = PiAgentMessage.objects.filter(root_session_id=state.root_session_id,
            to_session_id=wait.requester_session_id, seq__gt=wait.cursor).exists()
        canceled = wait.requester_operation_id and PiOperation.objects.filter(pk=wait.requester_operation_id, cancel_requested=True).exists()
        terminal = agents and all(not PiOperation.objects.filter(session=a.session, status__in=service.ACTIVE).exists() for a in agents)
        events = any(a.session.event_seq > json.loads(wait.result_json).get("registeredEventSeq", {}).get(a.session_id, 0) for a in agents)
        if canceled or messages or terminal or events or wait.deadline_at <= timezone.now():
            requester = PiAgent.objects.get(session_id=wait.requester_session_id)
            if not canceled and requester.parent_session_id and PiOperation.objects.filter(pk=wait.requester_operation_id, status="running").exists():
                child_ids = _members(state).exclude(parent_session=None).values("session_id")
                parked = PiAgentWait.objects.filter(root_session_id=state.root_session_id, status="pending", requester_operation__isnull=False).values("requester_operation_id")
                occupied = PiOperation.objects.filter(session_id__in=child_ids, status__in=["running", "canceling", "unknown"]).exclude(pk__in=parked).count()
                # Waking reacquires the same root slot in this authority lock.
                # A ready event remains durable while resources are occupied.
                if occupied >= state.max_concurrent_children:
                    continue
            wait.status = "canceled" if canceled else "timeout" if wait.deadline_at <= timezone.now() else "ready"
            wait.result_json = canonical({"cursor": state.message_seq, "agents": [{"id": a.session_id, "status": a.session.status,
                "activeOperationId": a.session.active_operation_id} for a in agents]})
            wait.save(update_fields=["status", "result_json"])


def wait_for(session, payload, operation):
    fields(payload, {"agentIds", "waitId", "cursor", "timeoutMs"})
    state = state_for(session, lock=True)
    if "waitId" in payload:
        wait = PiAgentWait.objects.select_for_update().filter(pk=identifier(payload["waitId"]), requester_session=session).first()
        if not wait:
            raise AiError("等待集合不存在", "not_found", 404)
    else:
        ids = payload.get("agentIds", list(_members(state).exclude(session=session).values_list("session_id", flat=True)))
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or len(set(ids)) != len(ids):
            raise AiError("等待代理集合无效")
        for target in ids:
            _target(state, target)
            # Waiting for an ancestor while holding a child dependency is a cycle.
            ancestor = session.id
            while ancestor:
                if ancestor == target:
                    raise AiError("代理不能等待自身或祖先", "pi_agent_wait_cycle", 409)
                ancestor_row = PiAgent.objects.filter(session_id=ancestor).first()
                ancestor = ancestor_row.parent_session_id if ancestor_row else None
        timeout = integer(payload.get("timeoutMs", 30000), "timeoutMs", 1, 3600000)
        cursor = integer(payload.get("cursor", state.message_seq), "cursor", 0)
        # Registration precedes observation in the same root lock: no lost wakeup.
        wait = PiAgentWait.objects.create(id=uid("pi-wait"), root_session_id=state.root_session_id,
            requester_session=session, requester_operation=operation, agent_ids_json=canonical(ids), cursor=cursor,
            deadline_at=timezone.now()+timedelta(milliseconds=timeout), result_json=canonical({"registeredEventSeq": {
                a.session_id: a.session.event_seq for a in _members(state).filter(session_id__in=ids)}}))
    wake_waits(state)
    wait.refresh_from_db()
    return {"waitId": wait.id, "id": wait.id, "status": wait.status, "agentIds": json.loads(wait.agent_ids_json),
        "cursor": wait.cursor, "deadlineAt": wait.deadline_at.isoformat(), "result": json.loads(wait.result_json)}


def run_command(session, command, payload, operation, principal, *, from_model=False):
    if command not in {"agent_list", "agent_cancel"}:
        reject_during_compact(session)
    state = state_for(session, lock=True)
    if command == "mode_set":
        return set_mode(session, payload, from_model=from_model)
    if command in {"plan_save", "save_plan"}:
        return save_plan(session, payload)
    if command == "agent_spawn":
        return spawn(session, payload, operation, principal)
    if command == "agent_list":
        fields(payload, set())
        return snapshot(session)
    if command == "agent_wait":
        return wait_for(session, payload, operation)
    fields(payload, {"agentId", "message"} if command in {"agent_send", "agent_follow_up"} else {"agentId"},
        {"agentId", "message"} if command in {"agent_send", "agent_follow_up"} else {"agentId"})
    target = _target(state, payload["agentId"])
    if command in {"agent_cancel", "agent_close"}:
        current = target
        while current.session_id != session.id and current.parent_session_id:
            current = PiAgent.objects.get(session_id=current.parent_session_id)
        if current.session_id != session.id:
            raise AiError("子代理只能管理自身后代", "access_denied", 403)
    if command in {"agent_send", "agent_follow_up"}:
        if target.lifecycle != "open":
            raise AiError("目标代理已停止", "pi_agent_closed", 409)
        message = text(payload["message"], "消息", 200000)
        row = _message(state, session, target.session, "follow_up" if command == "agent_follow_up" else "send", message)
        if command == "agent_follow_up" and not target.session.active_operation_id:
            op = _new_run(target, message)
            return {"messageId": row.id, "operationId": op.id, "disposition": "started"}
        return {"messageId": row.id, "disposition": "queued" if command == "agent_follow_up" else "delivered"}
    if command == "agent_cancel":
        cancel_tree(target.session)
        return {"agentId": target.session_id, "status": "canceling"}
    if command == "agent_close":
        if (PiOperation.objects.filter(session=target.session, status__in=service.ACTIVE).exists()
                or PiUiRequest.objects.filter(session=target.session, status="pending").exists()
                or PiAgentWait.objects.filter(requester_session=target.session, status="pending").exists()
                or PiBusinessAction.objects.filter(session=target.session, status__in=["prepared", "queued", "claimed", "dispatched", "unknown"]).exists()
                or PiBusinessAction.objects.filter(user_intent_id__in=PiBusinessDelegation.objects.filter(owner_session=target.session, status="active").values("intent_id"),
                    status__in=["prepared", "queued", "claimed", "dispatched", "unknown"]).exists()):
            raise AiError("代理尚未终结，不能释放环境", "pi_agent_alive", 409)
        target.lifecycle = "closed"
        target.save(update_fields=["lifecycle"])
        latest = PiOperation.objects.filter(session=target.session).order_by("-seq").first()
        if latest:
            # Cleanup is independently dispatched by the existing freeze queue.
            service.request_freeze(latest)
        state.tree_version += 1
        state.save(update_fields=["tree_version"])
        return {"agentId": target.session_id, "status": "closed", "historyPreserved": True}
    raise AiError("代理命令无效")


def reject_during_compact(session):
    state = state_for(session, lock=True)
    if session.id != state.root_session_id:
        root = PiSession.objects.get(pk=state.root_session_id)
        member = PiAgent.objects.get(session=session)
        settings = json.loads(member.settings_json)
        if (member.lifecycle != "open" or settings.get("rootEpoch") != root.epoch
                or settings.get("rootGeneration") != root.generation):
            raise AiError("原子代理的根环境代际已变化", "pi_root_generation_changed", 403)
    if PiOperation.objects.filter(session_id__in=_members(state).values("session_id"),
            kind="workspace:compact", status__in=service.ACTIVE).exists():
        raise AiError("原压缩尚未完成，禁止变更当前任务树", "pi_control_active", 409)


def control(session_id, body, principal):
    fields(body, {"clientRequestId", "command", "payload"}, {"clientRequestId", "command", "payload"})
    command = body["command"]
    key = identifier(body["clientRequestId"])
    if key.startswith("native-"):
        raise AiError("控制标识属于系统保留范围", "access_denied", 403)
    passive(body["payload"], 512 * 1024)
    with mutation(principal):
        session = service.get_session(session_id, principal, lock=True)
        state_for(session, lock=True)
        old = PiControl.objects.filter(session=session, client_request_id=key).first()
        replayed = old is not None
        if old:
            if old.request_digest != digest(body) or old.generation != session.generation:
                raise AiError("控制身份已绑定其他内容或代际", "conflict", 409)
            result = json.loads(old.result_json)
        else:
            workspace, _ = PiWorkspace.objects.get_or_create(session=session, defaults={"generation": session.generation})
            workspace.control_seq += 1
            workspace.save(update_fields=["control_seq"])
            op = PiOperation.objects.filter(session=session, generation=session.generation).order_by("-seq").first()
            row = PiControl.objects.create(id=uid("pi-control"), session=session, operation=op,
                client_request_id=key, request_digest=digest(body), epoch=session.epoch, generation=session.generation,
                control_seq=workspace.control_seq, command=command, payload_json=canonical(body["payload"]))
            result = run_command(session, command, body["payload"], op, principal)
            row.status, row.result_json = "completed", canonical(result)
            row.save(update_fields=["status", "result_json"])
            old = row
        from .pi_workspace import control_record, workspace_record
        session.refresh_from_db()
        workspace = PiWorkspace.objects.get(session=session)
        return {"session": service.session_record(session), "workspace": workspace_record(session, workspace),
            "native": snapshot(session), "control": control_record(old), "replayed": replayed}


def snapshot(session):
    if session.status == "frozen":
        return {}
    state = state_for(session)
    root = PiSession.objects.get(pk=state.root_session_id)
    requester = PiAgent.objects.get(session=session)
    requester_settings = json.loads(requester.settings_json)
    if (root.status == "frozen" or root.owner_email != session.owner_email or root.actor_role != session.actor_role
            or not scope_covers(json.loads(root.scope_json), session.scope_json)
            or session.id != root.id and (requester.lifecycle != "open" or requester_settings.get("rootEpoch") != root.epoch
                or requester_settings.get("rootGeneration") != root.generation)):
        return {}
    # Read paths never return descendants after a principal scope change.
    plans = visible_plans(session, state)
    agents = []
    for agent in _members(state).order_by("created_at")[:100]:
        member = agent.session
        if member.owner_email != session.owner_email or member.actor_role != session.actor_role or not scope_covers(json.loads(session.scope_json), member.scope_json):
            continue
        settings = json.loads(agent.settings_json)
        if member.id != root.id and (settings.get("rootEpoch") != root.epoch or settings.get("rootGeneration") != root.generation):
            continue
        last_operation = PiOperation.objects.filter(session=member).order_by("-seq").first()
        queue_cursor = json.loads(last_operation.payload_json).get("messageCursor", 0) if last_operation else 0
        agents.append({"id": member.id, "sessionId": member.id, "parentSessionId": agent.parent_session_id,
            "title": member.title, "status": agent.lifecycle if agent.lifecycle != "open" else member.status,
            "activeOperationId": member.active_operation_id, "modelId": settings.get("modelId", ""),
            "thinkingLevel": settings.get("thinkingLevel", ""), "dependencies": json.loads(agent.dependencies_json), "queueCursor": queue_cursor})
    messages, message_bytes = [], 0
    message_rows = visible_messages(session, state, root)
    for m in message_rows[:100]:
        size = len(m.message.encode())
        if messages and message_bytes+size > 512*1024: break
        messages.append({"id": m.id, "fromSessionId": m.from_session_id, "toSessionId": m.to_session_id, "seq": m.seq,
            "kind": m.kind, "message": m.message, "createdAt": m.created_at.isoformat()})
        message_bytes += size
    waits = [{"id": w.id, "status": w.status, "agentIds": json.loads(w.agent_ids_json), "cursor": w.cursor,
        "deadlineAt": w.deadline_at.isoformat(), "result": json.loads(w.result_json)}
        for w in PiAgentWait.objects.filter(requester_session=session).order_by("-created_at")[:30]]
    workspace = PiWorkspace.objects.filter(session=session).first()
    effective = workspace.thinking_level if workspace else ""
    thinking_state = json.loads(workspace.state_json).get("thinking", {}) if workspace else {}
    if not isinstance(thinking_state, dict): thinking_state = {}
    pending_controls = PiControl.objects.filter(session=session, command="thinking_set", status__in=["prepared", "sent", "accepted", "queued"]).order_by("-control_seq").first()
    requested = json.loads(pending_controls.payload_json).get("level", effective) if pending_controls else thinking_state.get("requested", effective)
    pending = thinking_state.get("pending") or ({"controlId": pending_controls.id, "level": requested} if pending_controls else None)
    return {"rootSessionId": root.id, "parentSessionId": PiAgent.objects.get(session=session).parent_session_id,
        "mode": state.mode, "targetMode": state.target_mode, "transitionStatus": state.transition_status,
        "modeRevision": state.mode_revision, "admissionEpoch": state.admission_epoch, "treeVersion": state.tree_version,
        "scopeSha256": hashlib.sha256(root.scope_json.encode()).hexdigest(), "planRevision": state.plan_revision,
        "plan": json.loads(plans[0].plan_json) if plans else None,
        "planHistory": [{"revision": p.revision, "plan": json.loads(p.plan_json), "createdAt": p.created_at.isoformat()} for p in plans[:5]],
        "planHistoryHasMore": len(plans)>5,
        "agents": agents, "messages": messages, "messagesHasMore": len(message_rows)>len(messages), "waits": waits, "cursor": state.message_seq,
        "messageEvidencePolicy": "exact_current_root_and_participant_binding_only",
        "messageHistoryMayBeOmitted": PiAgentMessage.objects.filter(root_session=root).exclude(id__in=[row.id for row in message_rows]).exists(),
        "queue": [{"agentId": a["id"], "items": [m for m in reversed(messages) if m["toSessionId"] == a["id"] and m["kind"] == "follow_up"
            and m["seq"] > max([a["queueCursor"], *[x["seq"] for x in messages if x["toSessionId"] == a["id"] and x["kind"] == "queue_cleared"]])]} for a in agents],
        "handoffs": [{"id": h.id, "fileId": h.source_file_id, "fileName": h.source_file.file_name,
            "sha256": h.sha256, "targetSessionId": h.target_session_id, "sourceSessionId": h.source_file.session_id,
            "generation": h.target_generation, "scopeSha256": digest(json.loads(h.scope_json)), "status": "available" if h.expires_at > timezone.now() else "expired"}
            for h in PiFileHandoff.objects.filter(target_session=session).select_related("source_file")[:100]],
        "thinking": {"requested": requested, "effective": thinking_state.get("effective", effective), "pending": pending, "supported": thinking_state.get("supported", thinking_levels(session))}}


def thinking_levels(session):
    from . import configuration
    from .pi_workspace import effective_model
    workspace = PiWorkspace.objects.filter(session=session).first()
    try:
        model = configuration.resolve_model(workspace.model_id if workspace and workspace.model_id else None)
        return thinking_levels_for_model(model)
    except AiError:
        return []


def thinking_levels_for_model(model):
    from .pi_workspace import effective_model
    result = []
    for level in ("off", "minimal", "low", "medium", "high", "xhigh", "max"):
        try:
            effective_model(model, level)
            result.append(level)
        except AiError:
            pass
    return result


def model_binding(model, level=""):
    from .model_capabilities import options
    cfg = options(model)
    actual = level or ("off" if model.reasoning_mode == "disabled" else cfg["reasoningEffort"] if cfg["reasoningEffort"] not in {"default", "none"} else "")
    return {"id": model.id, "modelName": "operation-model", "contextWindow": cfg["contextWindowTokens"],
        "maxTokens": model.max_tokens, "reasoning": model.reasoning_mode != "disabled",
        "supportedThinkingLevels": thinking_levels_for_model(model), **({"thinkingLevel": actual} if actual else {})}


def handoff_file(handoff_id, operation, principal):
    handoff = PiFileHandoff.objects.select_related("source_file", "source_file__session").filter(
        pk=identifier(handoff_id), target_session=operation.session, target_generation=operation.generation).first()
    if not handoff or handoff.expires_at <= timezone.now():
        raise AiError("文件交接已过期", "pi_handoff_expired", 403)
    source = handoff.source_file
    service.get_session(source.session_id, principal)
    if (source.generation != handoff.source_generation or source.session.generation != handoff.source_generation
            or source.sha256 != handoff.sha256 or not scope_covers(json.loads(operation.scope_json), handoff.scope_json)):
        raise AiError("交接文件的源、代际或范围已变化", "pi_handoff_fenced", 403)
    value = service.download(source.id, principal, content=True)
    return {"id": handoff.id, "sizeBytes": source.size_bytes, **value}


def scheduler_tick():
    """Wake durable sets and launch queued follow-ups without a model request."""
    with mutation():
        for state in PiNativeState.objects.select_for_update().all()[:100]:
            wake_waits(state)
            reconcile_mode(state)
            if state.transition_status != "stable":
                continue
            root = PiSession.objects.get(pk=state.root_session_id)
            if root.status == "frozen": continue
            try:
                current_principal(Principal(root.owner_email,root.owner_email,root.actor_role,json.loads(root.scope_json)),write=True,background=True)
            except AiError:
                continue
            for target in _members(state).filter(lifecycle="open"):
                if target.session.active_operation_id:
                    continue
                settings = json.loads(target.settings_json)
                if target.session_id != root.id and (settings.get("rootEpoch") != root.epoch or settings.get("rootGeneration") != root.generation): continue
                latest = PiOperation.objects.filter(session=target.session,generation=target.session.generation).order_by("-seq").first()
                cursor = json.loads(latest.payload_json).get("messageCursor") if latest else None
                has_cursor = type(cursor) is int and cursor >= 0
                after = None if has_cursor else latest.created_at if latest else target.created_at
                cleared = _bound_message_rows(target.session,state,root,target_id=target.session_id,kinds=["queue_cleared"],limit=1)
                cursor = max(cursor if has_cursor else 0,cleared[0].seq if cleared else 0)
                pending = _bound_message_rows(target.session,state,root,target_id=target.session_id,kinds=["follow_up"],
                    after_seq=cursor,after_created=after,ascending=True,limit=100)
                if pending:
                    _new_run(target, "\n\n".join(m.message for m in pending),message_cursor=pending[-1].seq)
    # Signed environment propagation is separate from the root transaction.
    # Each immutable dispatch is sent at most once; an unknown keeps switching.
    for state in PiNativeState.objects.filter(transition_status="switching")[:100]:
        for member in _members(state).exclude(lifecycle="closed"):
            op = PiOperation.objects.filter(session=member.session).order_by("-seq").first()
            if not op or op.status == "unknown" or not PiDispatch.objects.filter(operation__session=member.session,
                    operation__generation=op.generation, kind="runner:create", status="completed").exists():
                continue
            key = "native-mode-"+str(state.admission_epoch)
            previous = PiControl.objects.filter(operation=op, client_request_id=key).first()
            if previous:
                if previous.status not in {"completed", "handled", "failed"}:
                    from .pi_worker import identity
                    from . import pi_transport
                    try:
                        observed = pi_transport.command({**identity(op), "command": "workspace", "payload": {"action": "receipt", "controlId": previous.id}}).get("control", {})
                        if observed.get("controlId") == previous.id and observed.get("controlSeq") == previous.control_seq:
                            with mutation():
                                _mode_receipt(previous, observed)
                    except (AiError, KeyError, ValueError, TypeError):
                        pass
                continue
            from .pi_worker import runner_dispatch
            try:
                with mutation():
                    workspace, _ = PiWorkspace.objects.get_or_create(session=member.session, defaults={"generation": member.session.generation})
                    workspace.control_seq += 1
                    workspace.save(update_fields=["control_seq"])
                    control_id, control_seq = uid("pi-mode"), workspace.control_seq
                    previous = PiControl.objects.create(id=control_id, session=member.session, operation=op,
                        client_request_id=key, request_digest=digest({"mode": admission(op), "key": key}),
                        epoch=op.epoch, generation=op.generation, control_seq=control_seq, command="mode_set",
                        payload_json=canonical({"admission": admission(op)}), status="sent")
                result = runner_dispatch(op, "workspace", {"action": "control", "controlId": control_id,
                    "controlSeq": control_seq, "command": "mode_set", "payload": {"admission": admission(op)}}, request_id=key, terminal_control=True)
                receipt = result.get("control", {})
                with mutation():
                    _mode_receipt(previous, receipt)
            except AiError as error:
                if previous and previous.status not in {"completed", "handled", "failed"}:
                    with mutation():
                        previous.status, previous.error_code = "unknown", error.code
                        previous.save(update_fields=["status", "error_code"])


def _mode_receipt(control, receipt):
    from .pi_workspace import _known_result
    if receipt.get("status") in {"completed", "handled"}:
        result = receipt.get("result", {})
        if result.get("drained") is not True or result.get("admission") != json.loads(control.payload_json)["admission"]:
            raise AiError("模式切换缺少原准入版本的排空证明", "pi_mode_drain_unknown", 503)
    _known_result(control, receipt)


def validate_questionnaire(value):
    if value.get("title") != "pi-questionnaire-v1":
        return
    questionnaire = value.get("questionnaire")
    if questionnaire is None and isinstance(value.get("message"), str):
        try:
            questionnaire = json.loads(value["message"])
        except ValueError as error:
            raise AiError("提问结构无效", "pi_questionnaire_invalid", 503) from error
    fields(questionnaire, {"version", "questions", "toolCallId", "title"}, {"version", "questions", "toolCallId"})
    questions = questionnaire["questions"]
    if questionnaire["version"] != 1 or not isinstance(questions, list) or not 1 <= len(questions) <= 10:
        raise AiError("提问数量或版本无效", "pi_questionnaire_invalid", 503)
    seen = set()
    for q in questions:
        fields(q, {"id", "header", "question", "options", "allowCustom", "allowFreeform"}, {"id", "question"})
        qid = q["id"]
        if not isinstance(qid, str) or not 1 <= len(qid) <= 64:
            raise AiError("提问身份无效", "pi_questionnaire_invalid", 503)
        if qid in seen:
            raise AiError("提问身份重复", "pi_questionnaire_invalid", 503)
        seen.add(qid)
        text(q["question"], "提问", 4000)
        if "header" in q: text(q["header"], "提问标题", 80)
        q.setdefault("options", [])
        if not isinstance(q["options"], list) or len(q["options"]) > 10:
            raise AiError("提问选项数量无效", "pi_questionnaire_invalid", 503)
        labels = set()
        for option in q["options"]:
            fields(option, {"label", "description", "recommended"}, {"label"})
            label = text(option["label"], "选项", 512)
            text(option.get("description", ""), "说明", 2000, empty=True)
            if label in labels or "recommended" in option and type(option["recommended"]) is not bool:
                raise AiError("提问选项无效", "pi_questionnaire_invalid", 503)
            labels.add(label)
    tool_call = questionnaire["toolCallId"]
    if not isinstance(tool_call, str) or not 1 <= len(tool_call) <= 256 or value.get("toolCallId", tool_call) != tool_call:
        raise AiError("提问调用身份无效", "pi_questionnaire_invalid", 503)
    value["toolCallId"] = tool_call
    value["questionnaire"] = questionnaire


def validate_questionnaire_answer(request, payload):
    original = json.loads(request.request_json)
    if original.get("title") != "pi-questionnaire-v1" or payload.get("cancelled") is True:
        return
    if timezone.now() >= request.created_at + timedelta(hours=24):
        raise AiError("提问已过期", "pi_ui_expired", 409)
    try:
        result = json.loads(payload.get("value", ""))
    except (ValueError, TypeError) as error:
        raise AiError("提问答案必须使用结构化回复") from error
    fields(result, {"version", "answers"}, {"version", "answers"})
    questions = original["questionnaire"]["questions"]
    answers = result["answers"]
    if result["version"] != 1 or not isinstance(answers, dict) or set(answers) != {q["id"] for q in questions}:
        raise AiError("请一次性回答原提问的全部问题")
    for q in questions:
        answer = answers[q["id"]]
        text(answer, "问题答案", 8000)
        if not q.get("allowCustom", q.get("allowFreeform", True)) and answer not in {o["label"] for o in q["options"]}:
            raise AiError("回复超出原提问选项")


def consumer(payload, principal):
    fields(payload, {"operation", "parentOperationId", "name", "arguments", "invocationId", "surface"},
        {"operation", "parentOperationId", "name", "arguments", "invocationId", "surface"})
    if payload["surface"] != "pi_business" or payload["name"] not in TOOLS:
        raise AiError("代理原生工具入口无效", "access_denied", 403)
    op = PiOperation.objects.filter(pk=identifier(payload["parentOperationId"]), session__owner_email=principal.email.lower()).first()
    if not op:
        raise AiError("Pi 操作不存在", "not_found", 404)
    service.principal_for_work(op)
    # The ordinary consumer cannot mint a second invocation: it must observe
    # the gateway's original signed reservation identity.
    if not PiDispatch.objects.filter(operation=op, kind="tool", request_id=identifier(payload["invocationId"]), status="sent").exists():
        raise AiError("缺少持久网关准入", "access_denied", 403)
    with mutation(principal):
        # Internal re-authorization, no client-supplied admission to compare.
        authorize(op, kind="tool", name=payload["name"], lock=True, require_supplied=False)
        return run_command(op.session, payload["name"], payload["arguments"], op, principal, from_model=True)


def runnable(operation):
    state = state_for(operation.session, lock=True)
    if state.transition_status != "stable":
        return False
    agent = PiAgent.objects.get(session=operation.session)
    if agent.lifecycle != "open":
        return False
    for dependency in json.loads(agent.dependencies_json):
        if PiOperation.objects.filter(session_id=dependency, status__in=service.ACTIVE).exists():
            return False
    if agent.parent_session_id:
        child_ids = list(_members(state).exclude(parent_session=None).values_list("session_id", flat=True))
        waiting = PiAgentWait.objects.filter(root_session_id=state.root_session_id, status="pending", requester_operation__isnull=False).values("requester_operation_id")
        active = PiOperation.objects.filter(session_id__in=child_ids, status__in=["running", "canceling", "unknown"]).exclude(pk__in=waiting).count()
        return active < state.max_concurrent_children
    return True
