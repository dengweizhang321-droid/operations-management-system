"""Read-only full replay of v3 daily sales/netshop/market source chunks.

No signed fetch/append is exposed yet. A completed source remains only one
member of a collecting mixed parent; this module cannot seal or report it.
"""
from __future__ import annotations

import json

from business_analysis.contracts import AnalysisContractError, PageReconciler
from . import business_v3_catalog as catalog, models as m
from .business_sealed import Reader
from .policy import AiError, canonical, digest, identifier

DAILY = frozenset(("sales", "netshop", "market"))
PAGE_LIMIT = 100
PAGE_BYTES = 131_072


class _Identity(Reader):
    """Reuse v2 owning page identity rules without v2-only constructor/seal."""
    def __init__(self):
        self._limit = PAGE_LIMIT


def _reject(message="v3日来源完整页链与真实检查点不一致"):
    raise AiError(message, "conflict", 409)


def inspect(run_id, source_key, principal):
    row, built, records, actor = catalog.load(run_id, principal)
    key = identifier(source_key)
    selected = next((item for item in records if item["source_key"] == key), None)
    if selected is None or selected["domain"] not in DAILY:
        raise AiError("v3日来源不存在", "not_found", 404)
    query = next(item["query"] for item in built["entries"] if item["key"] == key)
    chunks = m.AiBusinessEvidenceChunk.objects.filter(run_id=row.id, source_key=key).order_by("sequence")
    verifier, size, count, metadata = PageReconciler(), 0, 0, None
    try:
        checkpoint = json.loads(selected["checkpoint_json"])
        if selected["page_count"] == 0:
            if checkpoint != {}:
                raise AnalysisContractError("零页检查点不可声称已开始")
        else:
            if (type(checkpoint) is not dict or set(checkpoint) != {"pageCount", "verifier", "metadata"}
                    or type(checkpoint["metadata"]) is not dict or type(checkpoint["verifier"]) is not dict):
                raise AnalysisContractError("日来源检查点字段无效")
            metadata = checkpoint["metadata"]
        identity = _Identity()
        for chunk in chunks.iterator(chunk_size=10):
            count += 1
            raw = chunk.payload_json
            if (chunk.sequence != count or count > 1999 or type(raw) is not str
                    or len(raw.encode("utf-8")) > PAGE_BYTES or digest(raw) != chunk.payload_digest):
                raise AnalysisContractError("日来源事实块顺序或摘要变化")
            page = json.loads(raw)
            if raw != canonical(page):
                raise AnalysisContractError("日来源事实块非规范JSON")
            # First-page coverage and semantics are saved in the immutable
            # checkpoint, then checked against that page and every later page.
            if metadata is None:
                raise AnalysisContractError("已落地日页缺失来源元数据")
            identity._identity({"domain": selected["domain"], "query": query}, page, metadata, count == 1)
            verifier.consume(page, request_cursor=verifier.expected_cursor)
            size += len(raw.encode("utf-8"))
        if count != selected["page_count"] or size != selected["stored_bytes"]:
            raise AnalysisContractError("日来源事实数量或字节不符")
        if count:
            if (checkpoint["pageCount"] != count or canonical(checkpoint["verifier"]) != canonical(verifier.__dict__)
                    or selected["row_count"] != verifier.rows or selected["finished"] != verifier.finished):
                raise AnalysisContractError("日来源检查点不能从实际块重建")
            if verifier.finished:
                verifier.result()
    except (AnalysisContractError, KeyError, TypeError, ValueError, AttributeError, RecursionError) as error:
        raise AiError("v3日来源实际事实未通过完整核验", "conflict", 409) from error
    catalog.unchanged(row, actor, records, principal)
    next_args = (None if verifier.finished else {"domain": selected["domain"], **query, "limit": PAGE_LIMIT,
                 **({"cursor": verifier.expected_cursor} if verifier.expected_cursor else {})})
    return {"runId": row.id, "runVersion": row.version, "sourceId": selected["id"],
            "sourceKey": key, "sourceVersion": selected["version"],
            "checkpointDigest": digest(selected["checkpoint_json"]),
            "pageCount": count, "rowCount": verifier.rows, "storedBytes": size,
            "finished": verifier.finished, "nextArguments": next_args,
            "reconciliation": verifier.result() if verifier.finished else None,
            "persistentEvidenceVerified": False, "reportGenerationSupported": False}
