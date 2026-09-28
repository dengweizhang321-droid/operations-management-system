import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from system_backups.runner import operator_environment


class OperatorEnvironment(unittest.TestCase):
    def test_case_insensitive_filter_preserves_unrelated_configuration(self):
        environment = operator_environment({"SYSTEMROOT": "C:/Windows", "PSMODULEPATH": "poisoned",
            "PSModuleAnalysisCachePath": "wrong-cache", "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY": "1",
            "TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY": "1", "APP_VALUE": "retained"})
        self.assertEqual(environment["APP_VALUE"], "retained")
        self.assertEqual(sum(k.upper() == "PSMODULEPATH" for k in environment), 1)
        self.assertTrue(environment["PSModulePath"].replace("\\", "/").endswith("System32/WindowsPowerShell/v1.0/Modules"))
        self.assertNotIn("TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY", environment)
        self.assertNotIn("PSModuleAnalysisCachePath", environment)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell integration")
    def test_real_hidden_powershell_can_read_acl_with_poisoned_parent_path(self):
        with tempfile.TemporaryDirectory() as directory:
            source = dict(os.environ)
            source["PSModulePath"] = directory
            source["PSMODULEPATH"] = directory
            executable = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            result = subprocess.run([str(executable), "-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; $null=Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $env:TEMP; Write-Output 'acl-module-ready'"],
                env=operator_environment(source), capture_output=True, timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            self.assertIn(b"acl-module-ready", result.stdout)


if __name__ == "__main__":
    unittest.main()
