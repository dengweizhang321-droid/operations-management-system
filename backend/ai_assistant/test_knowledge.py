"""Proves lexical retrieval covers every ACL-visible active entry, not just
the most recently updated 100; that admission (database row-scan) truncation
is now by score, via a single Python pass over a streamed row-scan ceiling,
rather than by an -updated_at[:100] slice applied before any scoring
happens; that admission truncation is surfaced explicitly on both the
`search()` response and the `context()` string, instead of being silently
indistinguishable from the output-limit truncation that was already
visible (or, for context(), invisible to the model altogether); that a
malformed (non-list) tags_json value degrades a row to "no tag signal"
instead of raising an unwrapped 500 for every query that happens to pull
it in; that an oversized row is SKIPPED by the size guard rather than
raising -- a 4000-row ceiling makes that guard's old unconditional-503
behavior a release-blocking regression, since one unrelated oversized row
would then 503 every query, including ones matching nothing, with no
exception handling between here and a live chat request; that ties are
broken by recency-then-id, not id alone, since scores are low-cardinality
by construction and ties are common in real queries, not an edge case;
that search()'s tags output mirrors rank()'s own cap/filter instead of
passing malformed tag lists through verbatim; and that long, unspaced
Chinese queries do not blow up the database query (no SQL substring
pushdown is used here, so there is no SQLite expression-tree limit to hit).
See docs/knowledge-rank-truncate-20261105/REPORT.md for the measured
before/after numbers these tests are based on, and for why
docs/knowledge-lexical-index-20261105/REPORT.md (if present) should be
treated as obsolete.
"""
import json
import time
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from . import knowledge, models as m
from .policy import AiError
from . import tests as support


def seed_filler(count, *, role="analyst", start_offset=1):
    """Bulk-create `count` active, role-visible entries that never match the
    probe query used in these tests ("稀有探针词"), ordered so the most
    recently updated row is `knowledge-filler-00001`.
    """
    base = timezone.now() - timedelta(days=start_offset)
    rows = [
        m.AiKnowledgeEntries(
            id=f"knowledge-filler-{i:05d}",
            source_type="business_metric",
            source_ref="filler",
            title=f"无关填充条目标题{i:05d}",
            content=f"这是第{i:05d}条与查询完全无关的填充内容，用于撑大候选表规模。",
            tags_json="[]",
            allowed_roles_json=f'["{role}"]',
            content_digest="f" * 64,
            # Newest id (00001) gets the most recent updated_at, matching the
            # old "-updated_at" recency window the fix must stop depending on.
            updated_at=base + timedelta(seconds=count - i),
        )
        for i in range(1, count + 1)
    ]
    m.AiKnowledgeEntries.objects.bulk_create(rows)


class KnowledgeRankTruncationTests(TestCase):
    user = support.AiDomainTests.user

    def setUp(self):
        support.AiDomainTests.setUp(self)

    # -- Core defect proof: a match beyond the old top-100 recency window,
    # -- and beyond a scale the old code never even tried to tolerate --

    def test_match_past_row_101_is_found_not_just_most_recent_100(self):
        seed_filler(150)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-old-match",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词说明",
            content="稀有探针词出现在这条最旧的知识条目里。",
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
            updated_at=timezone.now() - timedelta(days=365),
        )
        result = knowledge.search("稀有探针词", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-old-match")

    def test_match_past_2000_unrelated_tagged_rows_is_found(self):
        """The task's reported real-world symptom: 2009 rows that carry
        tags but match nothing textually, plus one older row that is an
        exact title match. The old -updated_at[:100] slice returned 0
        results for this shape; CANDIDATE_ROW_CEILING (4000) must
        comfortably cover it.
        """
        base = timezone.now()
        unrelated = [
            m.AiKnowledgeEntries(
                id=f"knowledge-unrelated-tag-{i:05d}",
                source_type="business_metric",
                source_ref="filler",
                title=f"完全不相关标题{i:05d}",
                content=f"完全不相关的正文内容占位{i:05d}",
                tags_json='["仓储"]',
                allowed_roles_json='["analyst"]',
                content_digest="c" * 64,
                updated_at=base - timedelta(seconds=i),
            )
            for i in range(1, 2010)
        ]
        m.AiKnowledgeEntries.objects.bulk_create(unrelated)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-exact-match-older",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词精确匹配",
            content="稀有探针词出现在这条内容里",
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
            updated_at=base - timedelta(days=365),
        )
        result = knowledge.search("稀有探针词精确匹配", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-exact-match-older")
        self.assertFalse(result["admissionTruncated"])

    def test_old_recency_window_would_have_missed_it(self):
        """Characterizes the bug directly against the old row ordering:
        the 100 most-recently-updated active rows do not include the old,
        matching row from the previous scenario.
        """
        seed_filler(150)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-old-match",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词说明",
            content="稀有探针词出现在这条最旧的知识条目里。",
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
            updated_at=timezone.now() - timedelta(days=365),
        )
        old_window_ids = list(
            m.AiKnowledgeEntries.objects.filter(status="active")
            .order_by("-updated_at", "id")[:100]
            .values_list("id", flat=True)
        )
        self.assertNotIn("knowledge-old-match", old_window_ids)
        self.assertEqual(len(old_window_ids), 100)

    # -- ACL must apply at scoring time, not via a recency/row cap that runs
    # -- ahead of it --

    def test_acl_filters_before_the_row_ceiling_not_after(self):
        base = timezone.now()
        hidden = [
            m.AiKnowledgeEntries(
                id=f"knowledge-hidden-{i:05d}",
                source_type="business_metric",
                source_ref="filler",
                title="稀有探针词命中但角色不可见",
                content="稀有探针词出现在这条角色不可见的条目里。",
                tags_json="[]",
                allowed_roles_json='["admin"]',
                content_digest="b" * 64,
                updated_at=base + timedelta(seconds=300 - i),
            )
            for i in range(1, 201)
        ]
        m.AiKnowledgeEntries.objects.bulk_create(hidden)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-visible-old",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词命中且角色可见",
            content="稀有探针词出现在这条角色可见的条目里。",
            tags_json="[]",
            allowed_roles_json='["viewer"]',
            content_digest="c" * 64,
            updated_at=base - timedelta(days=1),
        )
        result = knowledge.search("稀有探针词", self.viewer, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-visible-old")
        self.assertEqual(result["totalMatched"], 1)

    def test_viewer_without_role_grant_still_sees_nothing(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-metric",
            source_type="business_metric",
            source_ref="contract",
            title="大毛利率",
            content="按分摊后金额与成本计算，金额单位为分",
            tags_json='["毛利"]',
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        self.assertEqual(knowledge.search("大毛利率", self.viewer)["returned"], 0)

    # -- Deterministic ordering for tied scores --

    def test_tied_scores_break_ties_by_recency_then_id_deterministically(self):
        """Tie-break is (-score, -updated_at, id): most-recently-updated
        first, id only as the final tiebreaker for rows tied on both score
        and updated_at. This was originally written (and this test
        originally asserted) a pure id-ascending tie-break, which a
        reviewer caught as an unannounced behavior change: before this
        whole task, rank() had no explicit tie-break at all, and Python's
        stable sort meant ties kept the database's own `-updated_at, id`
        scan order -- i.e. recency-first, not id-first. Scores are
        low-cardinality by construction, so ties are common in real
        queries, not an edge case, which makes this a real choice about
        which curated entries reach a user's prompt, not just an ordering
        nicety. This test (and the code) were changed to make
        recency-first the explicit, intentional tie-break instead of an
        accidental implicit one -- id only breaks a tie that also ties on
        updated_at.
        """
        base = timezone.now()
        for offset, suffix in enumerate(["c", "b", "a"]):  # c newest .. a oldest
            m.AiKnowledgeEntries.objects.create(
                id=f"knowledge-tie-{suffix}",
                source_type="business_metric",
                source_ref="contract",
                title="稀有探针词并列条目",
                content="稀有探针词并列条目内容完全相同的打分。",
                tags_json="[]",
                allowed_roles_json='["analyst"]',
                content_digest="d" * 64,
                updated_at=base - timedelta(seconds=offset),
            )
        ranked_ids = [row.id for row, _ in knowledge.rank("稀有探针词", self.owner)]
        self.assertEqual(
            ranked_ids,
            ["knowledge-tie-c", "knowledge-tie-b", "knowledge-tie-a"],
            "tied-score rows must sort by recency (most recent first), "
            "falling back to id only when updated_at also ties",
        )
        self.assertEqual(
            ranked_ids, [row.id for row, _ in knowledge.rank("稀有探针词", self.owner)]
        )

    def test_tied_scores_and_tied_updated_at_fall_back_to_id(self):
        """When score AND updated_at both tie, id is the final tiebreaker
        -- this is what keeps the sort fully deterministic even though
        recency is now the primary tie-break.
        """
        base = timezone.now()
        for suffix in ["c", "a", "b"]:
            m.AiKnowledgeEntries.objects.create(
                id=f"knowledge-idtie-{suffix}",
                source_type="business_metric",
                source_ref="contract",
                title="稀有探针词完全并列条目",
                content="稀有探针词完全并列条目内容完全相同的打分与时间。",
                tags_json="[]",
                allowed_roles_json='["analyst"]',
                content_digest="d" * 64,
                updated_at=base,  # identical updated_at for all three
            )
        ranked_ids = [row.id for row, _ in knowledge.rank("稀有探针词", self.owner)]
        self.assertEqual(
            ranked_ids,
            ["knowledge-idtie-a", "knowledge-idtie-b", "knowledge-idtie-c"],
        )

    # -- Reverse tag-substring scoring must survive at scale, now that the
    # -- database filter does no tag-related narrowing at all --

    def test_short_tag_matches_longer_query_term_jd1(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-jd-tag",
            source_type="business_metric",
            source_ref="contract",
            title="完全不相关标题",
            content="完全不相关的正文内容占位",
            tags_json='["jd"]',
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        result = knowledge.search("jd1", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-jd-tag")

    def test_short_tag_matches_longer_query_term_at_scale(self):
        """Same defect, but with 2010 unrelated tagged rows ahead of it in
        -updated_at order, to prove this is no longer an admission-filter
        concern at all (there is no SQL-side tag filter to regress).
        """
        base = timezone.now()
        filler = [
            m.AiKnowledgeEntries(
                id=f"knowledge-jdscale-filler-{i:05d}",
                source_type="business_metric",
                source_ref="filler",
                title=f"无关标题{i:05d}",
                content=f"无关内容{i:05d}",
                tags_json='["无关标签"]',
                allowed_roles_json='["analyst"]',
                content_digest="f" * 64,
                updated_at=base - timedelta(seconds=i),
            )
            for i in range(1, 2011)
        ]
        m.AiKnowledgeEntries.objects.bulk_create(filler)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-jd-tag-at-scale",
            source_type="business_metric",
            source_ref="contract",
            title="完全不相关标题",
            content="完全不相关的正文内容占位",
            tags_json='["jd"]',
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
            updated_at=base - timedelta(days=365),
        )
        result = knowledge.search("jd1", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-jd-tag-at-scale")

    # -- A malformed tags_json (valid JSON, not a list) must degrade the
    # -- row to "no tag signal", not crash the whole query --

    def test_malformed_tags_json_degrades_instead_of_raising(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-malformed-tags",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词畸形标签行",
            content="稀有探针词出现在这条 tags_json 为 null 的行里。",
            tags_json="null",
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        result = knowledge.search("稀有探针词", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-malformed-tags")

    def test_malformed_tags_json_dict_also_degrades(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-malformed-tags-dict",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词畸形标签字典行",
            content="稀有探针词出现在这条 tags_json 为对象的行里。",
            tags_json='{"a": 1}',
            allowed_roles_json='["analyst"]',
            content_digest="b" * 64,
        )
        result = knowledge.search("稀有探针词", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-malformed-tags-dict")

    def test_malformed_tags_json_invalid_json_also_degrades(self):
        """tags_json has no application write path and no DB CHECK
        constraint, so even non-JSON text can land there. json.loads must
        not be allowed to raise JSONDecodeError and crash the whole query.
        """
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-malformed-tags-notjson",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词畸形标签非JSON行",
            content="稀有探针词出现在这条 tags_json 不是合法 JSON 的行里。",
            tags_json="not valid json",
            allowed_roles_json='["analyst"]',
            content_digest="c" * 64,
        )
        result = knowledge.search("稀有探针词", self.owner, 4)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(result["items"][0]["id"], "knowledge-malformed-tags-notjson")

    # -- search()'s tags output must mirror rank()'s own degradation: cap
    # -- at 12 entries, drop non-string elements. A reviewer caught this
    # -- NOT being mirrored despite a comment claiming it was: tags_json
    # -- values rank() never treats as tags (non-string elements, entries
    # -- past the 12th) were reaching the model-facing search() response
    # -- verbatim.

    def test_search_tags_output_filters_non_strings_and_caps_at_12(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-tags-output",
            source_type="business_metric",
            source_ref="contract",
            title="大毛利率",
            content="按分摊后金额与成本计算",
            tags_json=json.dumps(
                ["ok", 123, None, {"a": 1}, ["x"]]
                + [f"tag{i}" for i in range(20)]
            ),
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        result = knowledge.search("大毛利率", self.owner, 4)
        tags = result["items"][0]["tags"]
        self.assertTrue(all(isinstance(t, str) for t in tags), tags)
        self.assertLessEqual(len(tags), 12)
        # Raw tags_json is ["ok", 123, None, {"a":1}, ["x"], "tag0".."tag19"]
        # (25 elements). The [:12] cap applies BEFORE the string filter (to
        # match rank()'s own order of operations), so it keeps the first 12
        # raw elements -- "ok", four non-strings, then "tag0".."tag6" -- and
        # only then drops the non-strings, leaving 8 entries, not 12.
        self.assertEqual(
            tags,
            ["ok", "tag0", "tag1", "tag2", "tag3", "tag4", "tag5", "tag6"],
        )

    # -- Oversized-row guard SKIPS the row instead of raising 503 --
    #
    # This is a deliberate behavior change from the pre-task baseline,
    # caught by a reviewer as a release-blocking regression: the baseline
    # guard raised 503 unconditionally for any ACL-visible row admitted
    # into the scan, independent of whether it would have scored above
    # threshold, over a window of at most 100 rows. Raising
    # CANDIDATE_ROW_CEILING to 4000 widened that unconditional-503 trigger
    # surface by the same ~40x, and tags_json/content have no write-path
    # enforcement of the 16000/240 bound (bare TextField, no DB CHECK), so
    # an oversized row is exactly the case this guard exists to handle,
    # not an assumable-away edge case. With no exception handling between
    # here and a user's chat request (chat.py calls context() inline with
    # no try/except), one bad row at this ceiling would 503 every
    # conversation, including ones matching nothing. The guard now skips
    # the row (logged, not raised) so one unrelated bad row cannot take
    # down every other query.

    def test_oversized_row_is_skipped_not_raised(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-oversized",
            source_type="business_metric",
            source_ref="contract",
            title="稀有探针词超界内容",
            content="稀" * 16001,
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="e" * 64,
        )
        result = knowledge.search("稀有探针词", self.owner)
        self.assertEqual(result["returned"], 0)

    def test_oversized_irrelevant_row_does_not_break_an_unrelated_query(self):
        """The release-blocking scenario itself: 300 harmless rows plus one
        oversized, completely unrelated row seeded older than all of them
        (so it is still within the CANDIDATE_ROW_CEILING scan window), then
        a query that matches nothing at all. Before this fix, this raised
        AiError 503 for every query -- including this one, which matches
        nothing -- because the size guard ran unconditionally on every
        scanned row regardless of match. It must now return a normal empty
        result instead.
        """
        seed_filler(300)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-oversized-irrelevant",
            source_type="business_metric",
            source_ref="filler",
            title="完全不相关标题",
            content="毛" * 16001,
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="e" * 64,
            updated_at=timezone.now() - timedelta(seconds=302),
        )
        result = knowledge.search("完全不存在的探针词不匹配任何内容", self.owner)
        self.assertEqual(result["returned"], 0)

    def test_oversized_irrelevant_row_does_not_break_context(self):
        """Same scenario through context(), which is the actual path a
        reviewer traced as having no exception handling between here and
        a user's chat request (chat.py:642 calls this inline).
        """
        seed_filler(300)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-oversized-irrelevant-ctx",
            source_type="business_metric",
            source_ref="filler",
            title="完全不相关标题二",
            content="毛" * 16001,
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="e" * 64,
            updated_at=timezone.now() - timedelta(seconds=302),
        )
        result = knowledge.context("完全不存在的探针词不匹配任何内容", self.owner)
        self.assertEqual(result, "")

    # -- Existing scoring semantics must be unchanged --

    def test_existing_lexical_contract_and_role_filtered_prompt_context(self):
        seed_filler(120)
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-metric",
            source_type="business_metric",
            source_ref="contract",
            title="大毛利率",
            content="按分摊后金额与成本计算，金额单位为分",
            tags_json='["毛利"]',
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        result = knowledge.search("本月大毛利率", self.owner, 4)
        self.assertEqual(result["matchMode"], "deterministic_lexical")
        self.assertEqual(result["returned"], 1)
        self.assertIn("excerpt", result["items"][0])
        self.assertNotIn("content", result["items"][0])
        self.assertEqual(knowledge.search("大毛利率", self.viewer)["returned"], 0)
        self.assertEqual(
            knowledge.search("totally unrelated", self.owner)["returned"], 0
        )
        self.assertIn("knowledge-metric", knowledge.context("大毛利率", self.owner))
        for limit in [0, 9, True]:
            with self.assertRaises(AiError):
                knowledge.search("毛利", self.owner, limit)

    def test_score_values_match_documented_weights(self):
        m.AiKnowledgeEntries.objects.create(
            id="knowledge-score-exact-title",
            source_type="business_metric",
            source_ref="contract",
            title="大毛利率",
            content="无关正文占位",
            tags_json="[]",
            allowed_roles_json='["analyst"]',
            content_digest="a" * 64,
        )
        ranked = knowledge.rank("大毛利率", self.owner)
        self.assertEqual(len(ranked), 1)
        row, score = ranked[0]
        self.assertEqual(row.id, "knowledge-score-exact-title")
        self.assertEqual(score, 138)

    # -- Contract surface unchanged: query/limit validation untouched --

    def test_query_and_limit_contract_unchanged(self):
        with self.assertRaises(AiError):
            knowledge.search("a", self.owner)  # below 2 chars
        with self.assertRaises(AiError):
            knowledge.search("x" * 81, self.owner)  # above 80 chars
        with self.assertRaises(AiError):
            knowledge.search("毛利", self.owner, 0)
        with self.assertRaises(AiError):
            knowledge.search("毛利", self.owner, 9)

    # -- Admission truncation is now surfaced explicitly, not silently --

    def test_admission_truncated_flag_false_under_ceiling(self):
        seed_filler(50)
        result = knowledge.search("完全不存在的探针词絕對不匹配", self.owner)
        self.assertFalse(result["admissionTruncated"])

    def test_admission_truncated_flag_false_at_exactly_ceiling(self):
        """A table with EXACTLY CANDIDATE_ROW_CEILING active rows scans
        every one of them -- nothing is dropped, so admissionTruncated
        must be False. This is the boundary a reviewer caught as an
        off-by-one false positive: the original implementation sliced to
        [:CANDIDATE_ROW_CEILING] and then checked `scanned >=
        CANDIDATE_ROW_CEILING`, which is also true when the table has
        exactly that many rows and the admission scan reached every one of
        them -- a false "truncated" signal with zero actual drops. The fix
        fetches one extra row past the ceiling and only flags truncation
        if that extra row exists.
        """
        seed_filler(knowledge.CANDIDATE_ROW_CEILING)
        result = knowledge.search("完全不存在的探针词絕對不匹配", self.owner)
        self.assertFalse(result["admissionTruncated"])
        self.assertEqual(result["returned"], 0)

    def test_admission_truncated_flag_true_past_ceiling(self):
        """Seeds CANDIDATE_ROW_CEILING + 1 active rows (none matching) so
        the admission scan's extra probe row is genuinely present and at
        least one row was never scored. This pins the ceiling's current
        magnitude indirectly: if CANDIDATE_ROW_CEILING changes, this
        test's seed count must track it (it reads the constant directly).
        """
        seed_filler(knowledge.CANDIDATE_ROW_CEILING + 1)
        result = knowledge.search("完全不存在的探针词絕對不匹配", self.owner)
        self.assertTrue(result["admissionTruncated"])
        self.assertEqual(result["returned"], 0)

    # -- Chinese long-query safety: no SQL substring pushdown means no
    # -- SQLite expression-tree limit to hit --

    def test_long_unspaced_chinese_query_does_not_raise(self):
        """A 45+ character, space-free Chinese operational question used to
        blow up a prior (reverted) SQL-substring-pushdown implementation
        with `OperationalError: Expression tree is too large`. This
        implementation does no per-term SQL predicate construction at all,
        so the same query must simply return a (possibly empty) result.
        """
        query = (
            "本月各个仓库的毛利率和去年同期相比变化趋势是什么原因导致的"
            "需要从哪些维度进一步拆解分析才能找到根本原因"
        )
        self.assertGreaterEqual(len(query), 45)
        result = knowledge.search(query, self.owner, 4)
        self.assertEqual(result["matchMode"], "deterministic_lexical")

    def test_long_unspaced_chinese_query_against_context_does_not_raise(self):
        """Same shape through context(), which is the synchronous prompt
        assembly path (chat.py calls this inline, not in a background job).
        """
        query = (
            "本月各个仓库的毛利率和去年同期相比变化趋势是什么原因导致的"
            "需要从哪些维度进一步拆解分析才能找到根本原因"
        )[:80]
        result = knowledge.context(query, self.owner)
        self.assertIsInstance(result, str)

    def test_long_unspaced_chinese_query_at_scale_does_not_raise(self):
        """Same long-query shape, but with several hundred filler rows
        present, to rule out an interaction between query length and
        candidate volume (neither axis does SQL substring construction, so
        there should be no interaction, but this is asserted rather than
        assumed).
        """
        seed_filler(500)
        query = (
            "本月各个仓库的毛利率和去年同期相比变化趋势是什么原因导致的"
            "需要从哪些维度进一步拆解分析才能找到根本原因"
        )
        result = knowledge.search(query, self.owner, 4)
        self.assertEqual(result["matchMode"], "deterministic_lexical")

    # -- Performance: scanning ahead of scoring must not scale catastrophically
    # -- within the sync prompt-assembly path --

    def test_query_time_stays_bounded_as_table_grows(self):
        """500 then 2000 filler rows, one real match seeded as the oldest
        row each time (outside the old 100-row recency window). Asserts the
        match is still found at both sizes and that per-query time stays
        within a generous ceiling for a test sqlite DB. See the report for
        the actual measured numbers (this project's perf claims must be
        backed by perf_counter/tracemalloc runs, not just this test).
        """
        timings = {}
        for size in (500, 2000):
            m.AiKnowledgeEntries.objects.all().delete()
            seed_filler(size)
            m.AiKnowledgeEntries.objects.create(
                id="knowledge-perf-match",
                source_type="business_metric",
                source_ref="contract",
                title="稀有探针词说明",
                content="稀有探针词出现在这条最旧的知识条目里。",
                tags_json="[]",
                allowed_roles_json='["analyst"]',
                content_digest="a" * 64,
                updated_at=timezone.now() - timedelta(days=365),
            )
            started = time.perf_counter()
            result = knowledge.search("稀有探针词", self.owner, 4)
            elapsed = time.perf_counter() - started
            timings[size] = elapsed
            self.assertEqual(result["returned"], 1)
            self.assertEqual(result["items"][0]["id"], "knowledge-perf-match")
            self.assertLess(elapsed, 8.0, f"query took {elapsed:.3f}s at {size} rows")
