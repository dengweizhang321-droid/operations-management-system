"""Two JSON columns whose PostgreSQL octet_length CHECKs were reachable from
character-counted application limits.

1. ai_conversation_messages.execution_json -- CHECK octet_length(...)<=16384
   (migrations/0009_model_generation_capabilities.py:10). chat.py wrote
   canonical(execution) directly, and execution["guidance"] cites one entry per
   matched rule from prompt_settings.compose(). Every rule field is bounded by
   characters, not bytes (prompt_settings.py:48-50: name 80, source 240), so a
   Chinese rule costs 1151 bytes of citation while passing validate() -- whose
   own ceiling is 65536 bytes of *configuration*, far above what 14 such rules
   need (27080 bytes with a one-character body).

2. ai_pi_business_actions.result_json -- CHECK octet_length(...)<=131072
   (migrations/0086_pi_business_actions.py:65). Each n8n receipt is bounded
   alone by passive(result, 128*1024) (pi_business.py:469, :521), but
   _merge_n8n_receipt() shallow-merges two receipts, summing disjoint top-level
   keys.

These tests assert APPLICATION-layer behaviour, because SQLite carries neither
CHECK -- the constraints are added by RunPython guarded on
connection.vendor == "postgresql". The byte arithmetic below therefore states
both sides explicitly: what the application accepts, and what the database
caps, so a passing assertion is evidence of a real gap rather than of the
database rejecting a value the application could never produce.

Application-side ceilings, for the record:
  gap 1: prompt_settings.validate() accepts 24 rules / 65536 config bytes;
         14 CJK rules produce 16651 execution bytes against a 16384 CHECK.
  gap 2: passive(result, 131072) accepts each receipt; two 66060-byte receipts
         with disjoint top-level keys merge to 132071 bytes against a 131072
         CHECK, and passive()'s 100-key dict cap allows far more.
"""
import json
from copy import deepcopy
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from . import chat, models as m, pi_business, prompt_settings, provider
from .policy import AiError, canonical
from .test_dataset_chat import wire
from . import tests as support

# The literal CHECK values, pinned to the migrations rather than imported from
# the modules under test, so these tests still fail if a module constant drifts
# away from the database in either direction.
EXECUTION_CHECK_BYTES = 16384
RESULT_CHECK_BYTES = 131072

# The widest rule shape prompt_settings.validate() accepts: id is
# policy.identifier()'s [A-Za-z0-9_-]{1,160}, name is text(..., 80), source and
# trigger are text(..., 240). body is text(..., 4000) but never reaches
# execution_json -- compose()'s evidence carries only id/name/source (:119).
RULE_ID_LENGTH = 160
NAME_CHARACTERS = 80
SOURCE_CHARACTERS = 240


def rule(index, *, cjk=True):
    """One rule at validate()'s maximum field lengths, legal and reachable."""
    filler = ("甲", "乙") if cjk else ("N", "S")
    return {"id": f"rule-{index:03d}".ljust(RULE_ID_LENGTH, "x"),
            "name": filler[0] * NAME_CHARACTERS,
            "trigger": filler[0] * SOURCE_CHARACTERS,
            "domains": ["sales"], "enabled": True,
            "source": filler[1] * SOURCE_CHARACTERS,
            # A single-character body keeps the configuration itself inside
            # validate()'s 65536-byte ceiling, which is the whole point: the
            # configuration is legal and the derived citation list is not.
            "body": "口"}


def config_with(count, *, cjk=True):
    return {"globalPrompt": "", "commonRules": "", "rules": [rule(i, cjk=cjk) for i in range(count)]}


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class ExecutionGuidanceByteTests(TestCase):
    """Drives the real chat.answer() path with a real saved configuration."""
    user = support.AiDomainTests.user

    def setUp(self):
        support.AiDomainTests.setUp(self)
        self.entries = deepcopy(support.CATALOG)
        # prompt_settings.tool_domains() (:103) is a substring match on tool
        # names, so the catalog must actually carry a "sales" tool for the
        # sales-domain rules to be in `allowed`. A real analyst catalog does.
        self.entries.append({**deepcopy(support.CATALOG[0]), "name": "query_sales_summary"})
        self.admin = self.user("execution-bytes-admin@example.invalid", "admin", None)

    def save_config(self, count, *, cjk=True):
        config = config_with(count, cjk=cjk)
        # Proves the configuration is accepted by the application, not just by
        # this fixture: validate() is the only gate on the admin save path.
        validated = prompt_settings.validate(config)
        self.assertEqual(len(validated["rules"]), count)
        self.assertLessEqual(len(canonical(validated).encode()), 65536)
        m.AiPromptSettingsRevision.objects.create(
            version=m.AiPromptSettingsRevision.objects.count() + 1,
            config_json=canonical(validated), created_by=self.admin.email, restored_from=None)
        return validated

    def ask(self, request_id, message="分析销售额和毛利"):
        responses = [wire("openai_compatible", answer="已根据现有数据回答。")]
        with patch.object(chat.transport, "catalog", return_value=self.entries), \
             patch.object(chat.transport, "execute_tool",
                          side_effect=lambda *a, **kw: {"ok": True, "data": {"through": "2026-09-09"}}), \
             patch.object(provider, "decrypt", return_value="isolated-fixture-key"), \
             patch.object(provider, "bounded_json", side_effect=responses):
            return chat.answer({"clientRequestId": request_id, "message": message}, self.owner, request_id)

    def stored(self, result):
        row = m.AiConversationMessages.objects.get(pk=result["assistantMessageId"])
        return row.execution_json, json.loads(row.execution_json)

    def test_thirteen_cjk_rules_store_every_citation_untrimmed(self):
        """Just under: the whole citation list survives and fits the CHECK."""
        self.save_config(13)
        raw, saved = self.stored(self.ask("exec-under"))
        size = len(raw.encode())
        self.assertLessEqual(size, EXECUTION_CHECK_BYTES, f"execution_json was {size} bytes")
        self.assertEqual(len(saved["guidance"]["rules"]), 13)
        self.assertNotIn("rulesOmitted", saved["guidance"])
        # jsonb_typeof(...)='object' is the other half of the same CHECK.
        self.assertIsInstance(saved, dict)

    def test_fourteen_cjk_rules_are_trimmed_instead_of_failing_the_answer(self):
        """Just over: the question still succeeds and the row fits the CHECK.

        Before the fix this wrote 16651 bytes, which PostgreSQL rejected with an
        IntegrityError naming ai_execution_bound, turning a valid question into
        a 500 for every conversation matching 14 rules.
        """
        self.save_config(14)
        result = self.ask("exec-over")
        self.assertEqual(result["outcome"], "answered")
        raw, saved = self.stored(result)
        size = len(raw.encode())
        self.assertLessEqual(size, EXECUTION_CHECK_BYTES, f"execution_json was {size} bytes")
        self.assertEqual(len(saved["guidance"]["rules"]), 13)
        self.assertEqual(saved["guidance"]["rulesOmitted"], 1)
        # The audit trail keeps the configuration identity even when partial,
        # so a reviewer can still tell which revision produced the answer.
        self.assertIn("digest", saved["guidance"])
        self.assertIn("version", saved["guidance"])

    def test_maximum_configuration_trims_deterministically(self):
        """24 rules is validate()'s ceiling: 28171 bytes, 1.7x the CHECK."""
        self.save_config(24)
        first = self.ask("exec-max-a")
        second = self.ask("exec-max-b")
        raw_a, saved_a = self.stored(first)
        raw_b, saved_b = self.stored(second)
        self.assertLessEqual(len(raw_a.encode()), EXECUTION_CHECK_BYTES)
        self.assertEqual(saved_a["guidance"]["rulesOmitted"], 11)
        # Deterministic: the same configuration and question drop the same tail.
        self.assertEqual([r["id"] for r in saved_a["guidance"]["rules"]],
                         [r["id"] for r in saved_b["guidance"]["rules"]])
        # The retained head is compose()'s configured order, not an arbitrary
        # subset, so the citation list stays interpretable.
        self.assertEqual([r["id"] for r in saved_a["guidance"]["rules"]],
                         [rule(i)["id"] for i in range(13)])

    def test_ascii_rules_at_the_same_count_are_never_trimmed(self):
        """ASCII is 1 byte/char: 24 ASCII rules are 12811 bytes, inside the
        CHECK. The gap is specific to multi-byte text, which is why a
        character-counted limit hid it."""
        self.save_config(24, cjk=False)
        raw, saved = self.stored(self.ask("exec-ascii"))
        self.assertLessEqual(len(raw.encode()), EXECUTION_CHECK_BYTES)
        self.assertEqual(len(saved["guidance"]["rules"]), 24)
        self.assertNotIn("rulesOmitted", saved["guidance"])


class FitEvidenceUnitTests(TestCase):
    """fit_evidence()/_fit_execution() arithmetic, without the chat harness."""

    def test_trimming_stops_at_the_first_fitting_prefix(self):
        evidence = {"version": 7, "digest": "a" * 64,
                    "rules": [{"id": rule(i)["id"], "name": rule(i)["name"], "source": rule(i)["source"]}
                              for i in range(24)]}
        fitted = prompt_settings.fit_evidence(evidence, 8192)
        self.assertLessEqual(len(canonical(fitted).encode()), 8192)
        # One more rule than kept would exceed the budget: the prefix is maximal.
        over = dict(fitted, rules=evidence["rules"][: len(fitted["rules"]) + 1])
        over.pop("rulesOmitted", None)
        self.assertGreater(len(canonical(over).encode()), 8192)
        self.assertEqual(fitted["rulesOmitted"], 24 - len(fitted["rules"]))

    def test_a_budget_smaller_than_one_rule_keeps_the_identity_fields(self):
        evidence = {"version": 7, "digest": "a" * 64,
                    "rules": [{"id": rule(0)["id"], "name": rule(0)["name"], "source": rule(0)["source"]}]}
        fitted = prompt_settings.fit_evidence(evidence, 16)
        self.assertEqual(fitted["rules"], [])
        self.assertEqual(fitted["rulesOmitted"], 1)
        self.assertEqual(fitted["digest"], evidence["digest"])

    def test_execution_without_a_trimmable_member_is_refused_not_truncated(self):
        """If the non-guidance members alone exceed the CHECK there is nothing
        to trim; _fit_execution must raise 413 rather than hand PostgreSQL a row
        its CHECK rejects."""
        execution = {"stopReason": "completed", "guidance": {"version": 1, "digest": "a" * 64, "rules": []},
                     "promotionEvidence": {"pad": "x" * (EXECUTION_CHECK_BYTES + 1000)}}
        with self.assertRaises(AiError) as caught:
            chat._fit_execution(execution)
        self.assertEqual(caught.exception.status, 413)
        self.assertEqual(caught.exception.code, "payload_too_large")

    def test_execution_inside_the_check_is_returned_byte_identical(self):
        execution = {"stopReason": "shortcut", "toolCalls": 0,
                     "guidance": {"version": 1, "digest": "a" * 64, "rules": []}}
        self.assertEqual(chat._fit_execution(execution), canonical(execution))


class MergedReceiptByteTests(TestCase):
    """_merge_n8n_receipt() must not produce a value wider than the CHECK."""

    def receipt(self, key, filler, *, cjk=False):
        pad = ("甲" if cjk else "x") * filler
        return {"status": "succeeded", "receipt": {"executionId": "exec-1", "workflowId": "wf-1"},
                f"pad_{key}": pad}

    def test_each_receipt_passes_passive_at_the_columns_own_limit(self):
        """The application-side ceiling, stated explicitly: passive() accepts
        both of these at exactly the CHECK's own byte limit, so the merge below
        is the only thing standing between them and the database."""
        from .policy import passive
        for part in ("a", "b"):
            value = self.receipt(part, 66010)
            size = len(canonical(value).encode())
            self.assertLessEqual(size, RESULT_CHECK_BYTES, f"receipt was {size} bytes")
            self.assertIs(passive(value, RESULT_CHECK_BYTES), value)

    def test_two_individually_legal_receipts_are_refused_when_merged(self):
        existing, incoming = self.receipt("a", 66010), self.receipt("b", 66010)
        naive = {**existing, **incoming}
        naive_size = len(canonical(naive).encode())
        # The gap, in one number: a shallow merge of two accepted receipts.
        self.assertGreater(naive_size, RESULT_CHECK_BYTES)
        with self.assertRaises(AiError) as caught:
            pi_business._merge_n8n_receipt(existing, incoming)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, "pi_n8n_receipt_too_large")

    def test_cjk_receipts_overflow_at_a_third_of_the_character_count(self):
        existing, incoming = self.receipt("a", 22010, cjk=True), self.receipt("b", 22010, cjk=True)
        self.assertLessEqual(len(canonical(existing).encode()), RESULT_CHECK_BYTES)
        self.assertLessEqual(len(canonical(incoming).encode()), RESULT_CHECK_BYTES)
        self.assertGreater(len(canonical({**existing, **incoming}).encode()), RESULT_CHECK_BYTES)
        with self.assertRaises(AiError) as caught:
            pi_business._merge_n8n_receipt(existing, incoming)
        self.assertEqual(caught.exception.code, "pi_n8n_receipt_too_large")

    def test_a_merge_that_fits_is_still_performed(self):
        """Just under: the merge is the reason this function exists -- a binding
        arriving before the webhook acknowledgement must still combine."""
        existing = {"receipt": {"executionId": "exec-1", "workflowId": "wf-1"}}
        incoming = {"status": "succeeded", "receipt": {"executionId": "exec-1", "finishedAt": "2026-11-06T00:00:00Z"},
                    "pad": "x" * 60000}
        merged = pi_business._merge_n8n_receipt(existing, incoming)
        self.assertLessEqual(len(canonical(merged).encode()), RESULT_CHECK_BYTES)
        self.assertEqual(merged["receipt"]["executionId"], "exec-1")
        self.assertEqual(merged["receipt"]["workflowId"], "wf-1")
        self.assertEqual(merged["receipt"]["finishedAt"], "2026-11-06T00:00:00Z")
        self.assertEqual(merged["status"], "succeeded")

    def test_boundary_merge_is_accepted_one_byte_under(self):
        existing = {"receipt": {"executionId": "exec-1"}}
        base = len(canonical(pi_business._merge_n8n_receipt(existing, {"pad": ""})).encode())
        exact = pi_business._merge_n8n_receipt(existing, {"pad": "x" * (RESULT_CHECK_BYTES - base)})
        self.assertEqual(len(canonical(exact).encode()), RESULT_CHECK_BYTES)
        with self.assertRaises(AiError) as caught:
            pi_business._merge_n8n_receipt(existing, {"pad": "x" * (RESULT_CHECK_BYTES - base + 1)})
        self.assertEqual(caught.exception.code, "pi_n8n_receipt_too_large")

    def test_identity_conflicts_keep_their_own_distinct_code(self):
        """The size refusal must not mask a binding conflict: a replay attempt
        with a different executionId still reports the identity code."""
        with self.assertRaises(AiError) as caught:
            pi_business._merge_n8n_receipt({"receipt": {"executionId": "exec-1"}},
                                           {"receipt": {"executionId": "exec-2"}})
        self.assertEqual(caught.exception.code, "pi_n8n_execution_binding_conflict")
