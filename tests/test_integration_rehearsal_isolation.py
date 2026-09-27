"""Invalid rehearsal requests must fail before creating a cluster or output."""
from pathlib import Path
import os
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/integration-migration-role-rehearsal.py"
RESTORE = ROOT / "tools/integration-protected-restore-rehearsal.py"


class IntegrationIsolationTests(unittest.TestCase):
    def run_rejected(self, script, arguments, extra_env=None):
        before = set((ROOT / ".runtime").glob("ai-pg-*"))
        env = {key: value for key, value in os.environ.items()
            if not key.startswith(("TERUISI_", "PG", "DJANGO_"))}
        result = subprocess.run([sys.executable, "-B", script, *arguments],
            cwd=ROOT, env=env | (extra_env or {}), capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(set((ROOT / ".runtime").glob("ai-pg-*")), before)
        self.assertNotIn(b"isolated_cluster_started", result.stdout)
        return result

    def test_production_and_out_of_range_ports_are_rejected(self):
        for port in (5432, 55439, 56000):
            with self.subTest(port=port):
                self.run_rejected(SCRIPT, ["--port", str(port)])

    def test_same_cluster_restore_and_privileged_model_update_are_rejected(self):
        self.run_rejected(SCRIPT, ["--port", "55972", "--restore-port", "55972"])
        self.run_rejected(SCRIPT, ["--port", "55972", "--privileged-ai-step", "0080"])

    def test_worker_rejects_production_database_even_with_test_environment(self):
        result = self.run_rejected(SCRIPT, ["--worker", "baseline", "--port", "55972"], {
            "TERUISI_DJANGO_ENVIRONMENT": "test",
            "TERUISI_DJANGO_DATABASE_URL":
                "postgresql://teruisi_sales_owner:synthetic-password@127.0.0.1:5432/teruisi_sales"})
        self.assertIn(b"synthetic worker identity mismatch", result.stderr)
        self.assertNotIn(b"synthetic-password", result.stderr)

    def test_restore_rejects_outside_runroot_and_production_port(self):
        self.run_rejected(RESTORE, ["--run-root", str(ROOT),
            "--source-port", "5432", "--target-port", "55973"])


if __name__ == "__main__":
    unittest.main()
