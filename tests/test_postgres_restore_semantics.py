from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from postgres_restore_semantics import normalize_dump_expression as normalize


class RestoreExpressionTests(unittest.TestCase):
    def test_actual_array_cast_is_equivalent_to_dump_reparse(self):
        before = "CHECK (((status)::text = ANY ((ARRAY['collecting'::character varying, 'sealed'::character varying])::text[])))"
        after = "CHECK (((status)::text = ANY (ARRAY[('collecting'::character varying)::text, ('sealed'::character varying)::text])))"
        self.assertEqual(normalize(before), normalize(after))

    def test_predicate_index_keeps_its_other_conditions(self):
        before = "CREATE UNIQUE INDEX x ON public.t USING btree (key) WHERE ((key <> ''::text) AND (status = ANY ((ARRAY['queued'::character varying])::text[])))"
        after = "CREATE UNIQUE INDEX x ON public.t USING btree (key) WHERE ((key <> ''::text) AND (status = ANY (ARRAY[('queued'::character varying)::text])))"
        self.assertEqual(normalize(before), normalize(after))
        self.assertNotEqual(normalize(before), normalize(after.replace("<>", "=")))

    def test_literals_order_length_casts_and_functions_are_not_erased(self):
        before = "(ARRAY['a'::character varying, 'b'::character varying])::text[]"
        for changed in (before.replace("'a'", "'c'"),
                "(ARRAY['b'::character varying, 'a'::character varying])::text[]",
                before.replace("character varying", "character varying(1)"),
                before.replace("'a'", "lower('a')"),
                before.replace("text[]", "integer[]")):
            with self.subTest(changed=changed):
                self.assertNotEqual(normalize(before), normalize(changed))

    def test_escaped_literal_and_non_array_sql_are_preserved(self):
        self.assertEqual(normalize("('a''b'::character varying)::text"), "'a''b'::text")
        source = "CHECK (amount > 0 AND name ~ '^[a-z]+$'::text)"
        self.assertIn("amount > 0", normalize(source))
        self.assertIn("'^[a-z]+$'::text", normalize(source))

    def test_sql_like_literal_contents_and_quoted_identifiers_are_not_rewritten(self):
        source = "(ARRAY['::character varying'::character varying])::text[]"
        self.assertEqual(normalize(source), "ARRAY['::character varying'::text]")
        for source in ("CHECK (note = '(ARRAY[''a''::character varying])::text[]')",
                'CHECK ("(ARRAY[\'a\'::character varying])::text[]" IS NOT NULL)',
                "CHECK (note = E'abc\\' (ARRAY[''a''::character varying])::text[]')"):
            with self.subTest(source=source):
                # Parentheses may be represented structurally; quoted bytes stay.
                self.assertNotIn("'a'::text", normalize(source))

    def test_and_association_is_normalized_without_reordering_or_mixing_or(self):
        before = "CHECK (((a >= 1) AND (a <= 5)) AND ((b >= 1) AND (b <= 512)))"
        after = "CHECK ((a >= 1) AND (a <= 5) AND ((b >= 1) AND (b <= 512)))"
        self.assertEqual(normalize(before), normalize(after))
        for changed in (after.replace("a <= 5", "a <= 6"),
                after.replace(" AND ", " OR ", 1),
                "CHECK (((b >= 1) AND (b <= 512)) AND ((a >= 1) AND (a <= 5)))"):
            self.assertNotEqual(normalize(before), normalize(changed))
        self.assertNotEqual(normalize("CHECK ((a OR b) AND c)"),
            normalize("CHECK (a OR (b AND c))"))

    def test_boolean_words_inside_literals_and_unknown_case_are_not_interpreted(self):
        source = "CHECK (label = 'a AND b' AND value = 'x OR y')"
        self.assertIn("'a AND b'", normalize(source))
        self.assertIn("'x OR y'", normalize(source))
        self.assertNotEqual(normalize(source), normalize(source.replace("'a AND b'", "'a OR b'")))


if __name__ == "__main__":
    unittest.main()
