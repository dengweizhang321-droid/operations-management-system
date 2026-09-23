"""Read-only owning replay of staged v3 finance chunks and CAS intentions.

No append/fetch function exists here. The signed finance page bridge is not yet
registered for the AI writer; caller-supplied pages cannot establish provenance.
"""
from __future__ import annotations

import json

from business_analysis import evidence_v3, finance_collection_state as verifier
from business_analysis.contracts import AnalysisContractError

from . import business_evidence_v3 as plan, models as m
from .policy import AiError, authorize_owner, canonical, digest, identifier


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
