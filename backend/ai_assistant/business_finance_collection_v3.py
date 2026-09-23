"""Owner-bound finance page collection and immutable replay for v3.

Only the explicit internal advance function can append, after fetching a page
through the signed central read tool. No caller page, public route, scheduler,
parent seal, report or model path is registered here.
"""
from __future__ import annotations

import json
from django.utils import timezone

from business_analysis import evidence_v3, finance_collection_state as verifier
from business_analysis.contracts import AnalysisContractError

from . import business_evidence_v3 as plan, business_evidence_store as store, models as m, transport
from .datasets import _result
from .policy import AiError, authorize_owner, canonical, cas, digest, identifier, integer, mutation, uid

TOOL = "get_business_finance_source_page"
MAX_LIVE_PAGES = 64  # Full immutable replay is O(pages) per step until optimized.


def _reject(message="v3财报持久来源未通过完整页链核验"):
    raise AiError(message, "conflict", 409)


def inspect(run_id, source_key, principal):
    """Rebuild actual immutable chunks; return only a non-authorizing snapshot."""
    actor = plan._actor(principal)
    row = m.AiBusinessEvidenceRun.objects.filter(pk=identifier(run_id)).first()
    if row is None:
        raise AiError("v3证据任务不存在", "not_found", 404)
    authorize_owner(row, principal)
    if (row.status != "collecting" or row.collection_status != "manual" or row.scope_json != "null"
            or row.state_json != "{}" or row.version < 1):
        _reject("v3父任务并非手工未封存状态")
    records = list(m.AiBusinessEvidenceSource.objects.filter(run_id=row.id).order_by("ordinal")
                   .values("id", "source_key", "ordinal", "domain", "query_json", "query_digest",
                           "checkpoint_json", "checkpoint_run_version", "version", "page_count",
                           "stored_bytes", "row_count", "finished")[:49])
    try:
        header = json.loads(row.plan_json)
        if type(header) is not dict or header.get("schemaVersion") != evidence_v3.HEADER_SCHEMA:
            _reject("父任务不属于v3协议")
        sources = [{"key": item["source_key"], "domain": item["domain"],
                    "query": json.loads(item["query_json"])} for item in records]
        built = evidence_v3.build_catalog(sources, analysis_request=header["analysisRequest"])
        evidence_v3.validate_header(header, sources, analysis_request=header["analysisRequest"])
        if (row.plan_json != canonical(built["header"]) or row.request_digest != plan._identity(built)
                or len(records) != len(built["entries"])):
            _reject("v3计划清单或创建摘要不一致")
        for actual, expected in zip(records, built["entries"]):
            if (actual["source_key"], actual["ordinal"], actual["domain"], actual["query_json"], actual["query_digest"]) != (
                    expected["key"], expected["ordinal"], expected["domain"], canonical(expected["query"]), expected["queryDigest"]):
                _reject("v3实际来源身份或顺序不一致")
        selected = next((item for item in records if item["source_key"] == identifier(source_key)), None)
        if selected is None or selected["domain"] != "finance":
            raise AiError("v3财报来源不存在", "not_found", 404)
        if any(item["domain"] != "finance" and (item["page_count"] or item["stored_bytes"] or item["row_count"]
                or item["finished"] or item["checkpoint_json"] != "{}") for item in records):
            _reject("v3日来源在正式采集前不得出现事实")
        if row.stored_bytes != sum(item["stored_bytes"] for item in records):
            _reject("v3父来源字节数不一致")
        chunks = list(m.AiBusinessEvidenceChunk.objects.filter(run_id=row.id, source_key=source_key)
                      .order_by("sequence").values("sequence", "payload_json", "payload_digest")[:2000])
        if len(chunks) != selected["page_count"] or selected["checkpoint_run_version"] > row.version:
            _reject("v3财报块数或父版本不一致")
        state = None
        query = next(entry["query"] for entry in built["entries"] if entry["key"] == source_key)
        for sequence, chunk in enumerate(chunks, 1):
            raw = chunk["payload_json"]
            if (chunk["sequence"] != sequence or type(raw) is not str
                    or len(raw.encode("utf-8")) > verifier.PAGE_BYTES
                    or digest(raw) != chunk["payload_digest"]):
                _reject("v3财报块顺序、摘要或容量无效")
            page = json.loads(raw)
            if raw != canonical(page):
                _reject("v3财报块不是唯一规范JSON")
            state = verifier.consume(state, page, trusted_query=query)
        if state is None:
            if (selected["version"] != 1 or selected["page_count"] != 0 or selected["stored_bytes"] != 0
                    or selected["row_count"] != 0 or selected["checkpoint_json"] != "{}" or selected["finished"]):
                _reject("v3财报来源初始状态不一致")
            next_args = {"query": query, "offset": 0, "afterId": 0}
            complete = None
        else:
            if (selected["page_count"] != state["pageCount"] or selected["row_count"] != state["rowsRead"]
                    or selected["stored_bytes"] != state["storedBytes"] or selected["finished"] != state["finished"]
                    or selected["checkpoint_json"] != canonical(state)):
                _reject("v3财报检查点不是实际不可变块的重建结果")
            next_args = None if state["finished"] else verifier.next_arguments(state, trusted_query=query)
            complete = verifier.result(state, trusted_query=query) if state["finished"] else None
        snapshot = {"runId": row.id, "runVersion": row.version, "sourceId": selected["id"],
                    "sourceKey": source_key, "sourceVersion": selected["version"],
                    "sourceCheckpointDigest": digest(selected["checkpoint_json"]),
                    "pageCount": selected["page_count"], "rowCount": selected["row_count"],
                    "storedBytes": selected["stored_bytes"], "finished": selected["finished"],
                    "nextArguments": next_args, "completeSource": complete,
                    "persistentEvidenceVerified": False, "reportGenerationSupported": False}
    except (AnalysisContractError, ValueError, TypeError, KeyError, RecursionError) as error:
        raise AiError("v3财报不可变事实与来源计划未通过重建", "conflict", 409) from error
    if plan._actor(principal) != actor:
        raise AiError("v3财报检查期间账号权限变化", "access_denied", 403)
    current = m.AiBusinessEvidenceRun.objects.filter(pk=row.id).values("version", "status", "stored_bytes", "plan_json").first()
    source_now = m.AiBusinessEvidenceSource.objects.filter(pk=selected["id"]).values(
        "version", "checkpoint_json", "page_count", "stored_bytes", "row_count", "finished").first()
    if (current != {key: getattr(row, key) for key in ("version", "status", "stored_bytes", "plan_json")}
            or source_now != {key: selected[key] for key in ("version", "checkpoint_json", "page_count",
                                                       "stored_bytes", "row_count", "finished")}):
        raise AiError("v3财报检查期间CAS身份变化", "version_conflict", 409)
    return snapshot


def advance_finance_source(run_id, source_key, expected_version, principal, request_id):
    """Fetch one owner-bound page outside the AI lock, then atomically append.

    This function deliberately has no page argument. A model, caller DTO, or
    unsigned document cannot become an AI evidence chunk by supplying JSON.
    """
    identifier(run_id)
    identifier(source_key)
    identifier(request_id, "requestId")
    if len(request_id) > 128:
        raise AiError("内部财报采集请求标识超过签名桥容量")
    integer(expected_version, "expectedVersion")
    actor = plan._actor(principal)
    # The full immutable replay is deliberately bounded for this first live
    # owner path. This counter is only an early refusal, never authorization;
    # inspect below still replays and verifies every admitted chunk.
    pending = m.AiBusinessEvidenceSource.objects.filter(run_id=run_id, source_key=source_key,
        domain="finance").values("page_count").first()
    if pending is not None and pending["page_count"] >= MAX_LIVE_PAGES:
        raise AiError("当前财报采集验证页数已达到受控上限", "payload_too_large", 413)
    prepared = inspect(run_id, source_key, principal)
    if prepared["runVersion"] != expected_version:
        raise AiError("父任务版本已变化", "version_conflict", 409)
    if prepared["finished"]:
        _reject("财报来源已完整，不得再次领取")
    if prepared["pageCount"] >= MAX_LIVE_PAGES:
        raise AiError("当前财报采集验证页数已达到受控上限", "payload_too_large", 413)
    arguments = prepared["nextArguments"]
    if type(arguments) is not dict:
        _reject("财报检查点没有下一页参数")
    source = m.AiBusinessEvidenceSource.objects.filter(pk=prepared["sourceId"], run_id=run_id).values(
        "checkpoint_json", "version", "query_json").first()
    if (source is None or source["version"] != prepared["sourceVersion"]
            or digest(source["checkpoint_json"]) != prepared["sourceCheckpointDigest"]
            or source["query_json"] != canonical(arguments["query"])):
        raise AiError("财报来源在领取前已变化", "version_conflict", 409)
    checkpoint = None if source["checkpoint_json"] == "{}" else json.loads(source["checkpoint_json"])
    entries = transport.catalog(principal, "business_collection")
    matches = [entry for entry in entries if entry.get("name") == TOOL]
    if (len(matches) != 1 or matches[0].get("risk") != "read_only"
            or matches[0].get("allowedRoles") != ["admin"]
            or matches[0].get("scopePolicy") != "unscoped_only"
            or matches[0].get("execution", {}).get("mode") != "direct"
            or matches[0].get("execution", {}).get("allowedSurfaces") != ["business_collection"]):
        raise AiError("财报拥有方只读工具尚未按固定策略可用", "access_denied", 403)
    with transport.request_budget(30):
        page = _result(transport.execute_tool(TOOL, arguments, principal,
            surface="business_collection", request_id=request_id, policy_digest=digest(entries)), TOOL)
    try:
        next_state = verifier.consume(checkpoint, page, trusted_query=arguments["query"])
    except (AnalysisContractError, KeyError, TypeError, ValueError) as error:
        raise AiError("财报拥有方页面未通过来源、行链或容量核验", "conflict", 409) from error
    encoded = canonical(page)
    size = len(encoded.encode("utf-8"))
    saved = canonical(next_state)
    with mutation(principal):
        if plan._actor(principal) != actor:
            raise AiError("财报采集期间账号权限变化", "access_denied", 403)
        row = authorize_owner(m.AiBusinessEvidenceRun.objects.select_for_update().get(pk=run_id), principal)
        cas(row, expected_version)
        if row.status != "collecting" or row.collection_status != "manual" or row.state_json != "{}":
            _reject("v3父任务并非可追加财报的状态")
        record = m.AiBusinessEvidenceSource.objects.select_for_update().get(pk=prepared["sourceId"], run_id=row.id)
        if (record.domain != "finance" or record.source_key != source_key or record.finished
                or record.version != prepared["sourceVersion"]
                or digest(record.checkpoint_json) != prepared["sourceCheckpointDigest"]
                or record.query_json != canonical(arguments["query"])):
            raise AiError("财报检查点CAS或来源身份已变化", "version_conflict", 409)
        if (store.progress(row)["pageCount"] >= verifier.MAX_DATA_PAGES
                or row.stored_bytes + size > verifier.TOTAL_BYTES - verifier.FINAL_HEADER_RESERVE):
            raise AiError("共享证据事实容量已满，保留原检查点", "payload_too_large", 413)
        store.check_quota(principal, size + len(saved.encode("utf-8")) - len(record.checkpoint_json.encode("utf-8")),
                          verifier.TOTAL_BYTES)
        m.AiBusinessEvidenceChunk.objects.create(id=uid("evidence-chunk"), run=row, source_key=source_key,
            sequence=record.page_count + 1, payload_json=encoded, payload_digest=digest(encoded))
        record.page_count = next_state["pageCount"]
        record.stored_bytes = next_state["storedBytes"]
        record.row_count = next_state["rowsRead"]
        record.finished = next_state["finished"]
        record.checkpoint_json = saved
        record.checkpoint_run_version = row.version + 1
        record.version += 1
        record.updated_at = timezone.now()
        record.save(update_fields=["page_count", "stored_bytes", "row_count", "finished", "checkpoint_json",
                                   "checkpoint_run_version", "version", "updated_at"])
        row.stored_bytes += size
        row.version += 1
        row.save(update_fields=["stored_bytes", "version"])
        if plan._actor(principal) != actor:
            raise AiError("财报落地期间账号权限变化", "access_denied", 403)
    return inspect(run_id, source_key, principal)
