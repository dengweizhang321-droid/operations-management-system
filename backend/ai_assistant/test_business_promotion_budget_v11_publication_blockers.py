"""0069 blockers pinned until a locked, independently tested publish exists."""
from importlib import import_module
from pathlib import Path
from unittest import TestCase


class BudgetV11PublicationBlockerTests(TestCase):
    def test_ready_is_still_rejected_by_both_0066_file_guards(self):
        stage = import_module("ai_assistant.business_promotion_budget_v11_stage_sql")
        self.assertIn("IF NEW.renderer_version=11 THEN\n"
            "                RAISE EXCEPTION 'ai_budget_v11_ready_unpublished';",
            stage.RUN_GUARD)
        self.assertIn("IF parent.renderer_version=11 THEN\n"
            "              RAISE EXCEPTION 'ai_budget_v11_ready_unpublished';",
            stage.COMPLETE_GUARD)
        migrations = Path(__file__).parent / "migrations"
        self.assertEqual(list(migrations.glob("0069*")), [],
            "0069 must not appear before atomic publish/OUTCOME proof")

    def test_0068_verification_has_key_rotation_race_and_no_byte_lock(self):
        verifier = import_module(
            "ai_assistant.migrations.0068_business_promotion_budget_v11_verifier_receipt")
        self.assertIn("WHERE item.key_id=selected_key AND item.status='active'",
            verifier.MAC)
        self.assertNotIn("FOR SHARE", verifier.MAC)
        self.assertNotIn("FOR UPDATE", verifier.MAC)
        self.assertNotIn("ai_business_volume_chunks", verifier.VERIFY)
        self.assertNotIn("UPDATE public.ai_business_file_runs", verifier.VERIFY)

    def test_v11_chunk_download_remains_explicitly_closed(self):
        source = (Path(__file__).parent / "business_volume_files.py").read_text(
            encoding="utf-8")
        begin = source.index("def chunk(run_id, volume_index, kind, params, principal):")
        branch = source[begin:source.index("if row.renderer_version == 10:", begin)]
        self.assertIn("if row.renderer_version == 11:", branch)
        self.assertIn("下载未开放", branch)
