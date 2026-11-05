"""Versioned, bounded deterministic retrieval from the AI knowledge authority."""

import json
import re
from . import models as m
from .policy import AiError, canonical, integer, record, text

# Safety valve on how many active rows a single rank() call will stream and
# score, not an everyday operating limit. The table has no bulk-seeding path
# in this codebase (knowledge entries are curated, not imported), so realistic
# tables are expected to sit far below this -- 4000 is ~40x the reported
# real-world symptom shape (2009 unrelated rows + 1 older match) with margin.
# Raising CANDIDATE_ROW_CEILING high enough to cover the real table, instead
# of slicing by -updated_at before scoring, is the actual fix: scoring now
# runs over every active, ACL-visible row up to the ceiling, so a correct
# match is never pushed out by rows that merely happen to be newer.
#
# The size is deliberately NOT pushed arbitrarily high: reading row.content
# (up to 16000 chars/row) is I/O-bound, not scoring-bound -- measured, 8000
# rows at 16000 chars each took ~5.2s just to iterate and touch .content,
# before any scoring logic ran (see docs/knowledge-rank-truncate-20261105/
# REPORT.md). 4000 rows at the same worst-case content size measured ~3.2s;
# a higher ceiling trades a lower chance of ever hitting it for a worse
# worst-case latency on this synchronous prompt-assembly path. If this
# ceiling is ever reached in production, `search()` surfaces it explicitly
# via `admissionTruncated` (see there) rather than silently dropping
# candidates the way the old -updated_at[:100] slice did.
CANDIDATE_ROW_CEILING = 4000


class _Ranked(list):
    """A plain list of (row, score) pairs that also carries whether the
    database admission scan hit CANDIDATE_ROW_CEILING. Subclassing list
    instead of returning a tuple keeps every existing caller (len(), slicing,
    `for row, score in ranked`) working unchanged; only code that reads the
    new `.admission_truncated` attribute needs to know about it.
    """

    admission_truncated = False


def rank(query, principal):
    normalized = re.sub(r"\s+", " ", query.lower()).strip()
    segments = [
        v for v in re.split(r"[\s,，。；;：:、/|()\[\]{}]+", normalized) if len(v) >= 2
    ]
    terms = list(
        dict.fromkeys(
            [
                *segments,
                *(
                    v[i : i + 2]
                    for v in segments
                    if len(v) > 4
                    for i in range(len(v) - 1)
                ),
            ]
        )
    )[:20]
    results = []
    # Fetch one row past the ceiling so admission truncation can be
    # detected exactly: if the table has precisely CANDIDATE_ROW_CEILING
    # active rows, slicing to [:CANDIDATE_ROW_CEILING] and checking
    # `scanned >= CANDIDATE_ROW_CEILING` after the loop would report a
    # false truncation (every row was in fact scanned, none were dropped).
    # The extra row is never scored -- the loop below stops after exactly
    # CANDIDATE_ROW_CEILING rows -- it only proves whether a next row
    # exists.
    rows = (
        m.AiKnowledgeEntries.objects.filter(status="active")
        .order_by("-updated_at", "id")[: CANDIDATE_ROW_CEILING + 1]
        .iterator(chunk_size=200)
    )
    truncated = False
    for scanned, row in enumerate(rows, start=1):
        if scanned > CANDIDATE_ROW_CEILING:
            truncated = True
            break
        if principal.role not in json.loads(row.allowed_roles_json):
            continue
        if len(row.content) > 16000 or len(row.title) > 240:
            # Skip, don't raise. This guard used to run over at most 100
            # ACL-visible rows, so one oversized row only mattered if it
            # happened to be among the 100 most recently updated. Raising
            # the admission ceiling to CANDIDATE_ROW_CEILING widened that
            # trigger surface by the same factor: there is no write-path
            # enforcement of the 16000/240 bound (tags_json's model field is
            # a bare TextField, no DB CHECK constraint), so an oversized row
            # existing is exactly the scenario this guard exists to handle,
            # not an edge case it can assume away. With a 100-row window a
            # single such row could only ever affect the handful of queries
            # that happened to scan it; at this ceiling, every query -- even
            # one that matches nothing -- would scan it and 503, and this
            # path has no exception handling between here and a user's
            # chat request (chat.py calls context() inline with no
            # try/except). A 503 here is not actionable by any caller
            # (search()/context() callers cannot fix another row's data),
            # so skipping the single bad row and letting every other row
            # still get scored is strictly better than failing every
            # request until an operator manually fixes that one row.
            continue
        try:
            parsed_tags = json.loads(row.tags_json)
        except json.JSONDecodeError:
            parsed_tags = None
        tags = parsed_tags[:12] if isinstance(parsed_tags, list) else []
        title, content = row.title.lower(), row.content.lower()
        tags = [tag.lower() for tag in tags if isinstance(tag, str)]
        score = (
            (120 if title == normalized else 80 if normalized in title else 0)
            + (70 if normalized in tags else 0)
            + (50 if normalized in content else 0)
        )
        for term in terms:
            score += (
                (18 if term in title else 0)
                + (14 if any(term in tag or tag in term for tag in tags) else 0)
                + (5 if term in content else 0)
            )
        if score >= 12:
            results.append((row, score))
    # Tie-break: most-recently-updated first, then id for full determinism.
    # Before this fix, rank() had no explicit tie-break at all -- Python's
    # sort is stable, so same-score rows kept whatever order the database
    # handed back, which was `-updated_at, id` (the admission query's own
    # ordering). That meant ties were, in effect, broken by recency. Scores
    # are low-cardinality by construction (120/80/70/50 plus 18/14/5 per
    # term), so ties are common, not an edge case: a real query ("京东仓储
    # 费率怎么计算") against 8 reasonable entries produced 8 rows with only
    # 1 distinct score. Breaking ties by id instead of recency would be a
    # silent behavior change in which curated entries actually reach a
    # user's prompt, for a curator-maintained table where "most recently
    # maintained" is the more defensible tie-break, not an arbitrary
    # id-ordering artifact.
    ranked = _Ranked(
        sorted(results, key=lambda entry: (-entry[1], -entry[0].updated_at.timestamp(), entry[0].id))
    )
    # Admission (row-scan) truncation is distinct from the output limit
    # search() applies afterwards; expose it so a caller can tell the two
    # apart instead of only ever seeing the already-visible output cut.
    ranked.admission_truncated = truncated
    return ranked


def search(query, principal, limit=4):
    # No single-shop restriction here, on one stated premise: entries hold
    # general metric definitions and explanations, not per-shop operating data,
    # so there is nothing another shop's environment must not see. That premise
    # comes from the owner, not from anything this code can check — entries have
    # no shop column. An entry carrying a shop's operating figures invalidates
    # it, and this path would then need a per-entry classification.
    query = text(query, "query", 80)
    if len(query) < 2:
        raise AiError("知识 query 至少 2 个字符")
    limit = integer(limit, "limit", 1, 8)
    ranked = rank(query, principal)
    items = []
    for row, score in ranked[:limit]:
        item = record(
            row,
            "id source_type source_ref title version content_digest updated_at",
        )
        # tags_json is built here instead of through record()'s json_fields,
        # because record() does a raw json.loads with no malformed-value
        # guard, and tags_json has no application write path or DB CHECK
        # constraint (see AiKnowledgeEntries.tags_json) -- any valid-JSON
        # value, or even invalid JSON, can be stored there. This mirrors
        # rank()'s own degradation exactly: cap at 12 entries and drop any
        # non-string element, not just guard against a non-list value.
        # Without the [:12] cap and isinstance filter, a row with more than
        # 12 tags, or non-string tag elements (numbers, null, nested
        # objects/arrays), would reach this model-facing output even though
        # rank() never scored those extra/non-string entries as tags.
        try:
            parsed_tags = json.loads(row.tags_json)
        except json.JSONDecodeError:
            parsed_tags = None
        tags = parsed_tags[:12] if isinstance(parsed_tags, list) else []
        item["tags"] = [tag for tag in tags if isinstance(tag, str)]
        start = max(0, row.content.lower().find(query.lower()) - 80)
        item.update(
            excerpt=("…" if start else "")
            + row.content[start : start + 600]
            + ("…" if start + 600 < len(row.content) else ""),
            score=score,
        )
        items.append(item)
    return {
        "query": query,
        "matchMode": "deterministic_lexical",
        "filtersApplied": {"role": principal.role, "status": "active"},
        "totalMatched": len(ranked),
        "returned": len(items),
        "truncated": len(ranked) > len(items),
        # Distinct from "truncated" above (output limit): this is true only
        # when the database admission scan itself hit CANDIDATE_ROW_CEILING,
        # meaning rows beyond the ceiling were never scored at all and could
        # have included a better match than anything in totalMatched. The
        # old implementation hit this silently on every call (recency window
        # of 100) with no way for a caller to tell; this field makes that
        # condition visible instead of leaving it undetectable.
        "admissionTruncated": ranked.admission_truncated,
        "items": items,
    }


def context(query, principal):
    if len(query.strip()) < 2:
        return ""
    ranked = rank(query[:80], principal)
    blocks = []
    for row, _ in ranked[:4]:
        item = dict(
            id=row.id, source=row.source_ref, title=row.title, content=row.content
        )
        encoded = canonical(item).replace("<", "\\u003c")
        if sum(len(v) for v in blocks) + len(encoded) > 3000:
            break
        blocks.append(encoded)
    if not blocks and not ranked.admission_truncated:
        return ""
    # Admission truncation has to be visible here too, not only on
    # search()'s structured response: the model is the direct consumer of
    # this string (chat.py inlines it into prompt history), and unlike a
    # human or tool reading search()'s JSON, it has no other way to learn
    # that the knowledge lookup behind this block may be incomplete. A
    # silent empty string or a silently partial <knowledge> block both read
    # to the model as "no better match exists", which is not what
    # admission truncation means.
    note = "<truncated>知识库候选超过扫描上限，结果可能不完整</truncated>" if ranked.admission_truncated else ""
    return "\n<knowledge>" + "\n".join(blocks) + note + "</knowledge>"
