"""147 proof/dispatch boundaries using only owned temporary evidence."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(os.environ.get("JD_SCHEMA_SOURCE_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()
sys.path.insert(0, str(ROOT / "tools"))
import bi_app_addition as common
import jd_monitor_preferences_addition as addition
import jd_monitor_preferences_catalog as catalog
from test_jd_schema_addition import JdSchemaTests


class PreferencesSchemaTests(unittest.TestCase):
    def test_rehearsal_rejects_real_production_checkout_and_runtime_before_start(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("private147_harness", ROOT / "tools/jd_monitor_preferences_rehearsal.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        for path in (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf"),
                     Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf/subdir"),
                     Path("D:/teruisi-runtime/django-sales/app")):
            with patch.object(module, "ROOT", path.resolve()), self.assertRaises(RuntimeError): module.assert_isolated_source()
        with patch.object(module, "ROOT", ROOT): module.assert_isolated_source()

    def test_exact_delta_and_each_mutation(self):
        before = {"backend/old/migrations/0001.py": "a" * 64}
        after = before | catalog.FILES
        with patch.object(common, "migrations", side_effect=[before, after]):
            self.assertEqual(addition.source_delta("candidate", "captured146"), common.digest(after))
        for bad in (before, after | {next(iter(before)): "b" * 64},
                    after | {next(iter(catalog.FILES)): "b" * 64},
                    after | {"backend/x/migrations/9999.py": "c" * 64}):
            with patch.object(common, "migrations", side_effect=[before, bad]), self.assertRaises(ValueError):
                addition.source_delta("candidate", "captured146")

    def test_parent_original_verifier_only_sees_captured146(self):
        base143 = {"old." + str(i) for i in range(143)}
        with patch.object(addition.parent, "verify_active", return_value=({"migrationCount": 146}, {}, Path("original146"))) as verify, patch.object(addition.parent, "parent_proof", return_value=(base143, "x")) as parent, patch.object(common, "sha", return_value="a" * 64):
            base, _ = addition.parent_proof("runtime", "captured146")
            verify.assert_called_once_with("captured146", "runtime")
            parent.assert_called_once_with("runtime", Path("original146/baseline"))
            self.assertEqual(len(base), 146)
        with patch.object(addition.parent, "verify_active", return_value=({"migrationCount": 147}, {}, Path("original146"))), patch.object(addition.parent, "parent_proof", return_value=(base143, "x")), self.assertRaises(ValueError):
            addition.parent_proof("runtime", "captured146")

    def state(self):
        return {"rows": 1, "legacyRowsSha256": "a" * 64, "permissionsSha256": "b" * 64}

    def intent(self, folder):
        common.write(folder / "plan.json", {})
        common.write(folder / "install-intent.json", {"version": addition.VERSION,
            "planSha256": common.sha(folder / "plan.json"), "at": "fixture", "preservation": self.state()})

    def test_intent_rolled_back146_and_unknown147_never_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.intent(root)
            with patch("postgres_no_key_backup.verify_receipt_generation", return_value=146), patch.object(addition, "apply_steps") as apply, self.assertRaises(ValueError):
                addition.install_schema("install", MagicMock(), root, "a" * 32, root, {}, set())
            apply.assert_not_called()
            with patch.object(addition, "check_database", side_effect=ValueError("unknown")), patch.object(addition, "apply_steps") as apply, self.assertRaises(ValueError):
                addition.install_schema("reconcile", MagicMock(), root, "a" * 32, root, {}, set())
            apply.assert_not_called()

    def test_reconcile_publishes_idempotently_without_migrate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.intent(root)
            plan = {"migrationSha256": "c" * 64, "parentReferenceSha256": "d" * 64}
            with patch.object(addition, "check_database") as check, patch.object(addition, "apply_steps") as apply:
                first = addition.install_schema("reconcile", MagicMock(), root, "a" * 32, root, plan, set())
                second = addition.install_schema("reconcile", MagicMock(), root, "a" * 32, root, plan, set())
                check.assert_called_with(unittest.mock.ANY, set(), empty=True, expected=self.state())
                self.assertEqual(first, second)
                self.assertEqual(first["preservation"], self.state())
                apply.assert_not_called()

    def test_original_publisher_cas_refuses_stale_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            pointer = Path(tmp) / "active.json"
            addition.publish(pointer, {"version": 1})
            old_sha = common.sha(pointer)
            addition.publish(pointer, {"version": 2}, previous=old_sha)
            with self.assertRaises(ValueError):
                addition.publish(pointer, {"version": 3}, previous=old_sha)
            self.assertEqual(common.read(pointer), {"version": 2})

    def test_admission_binds_all_reviewed_inputs_and_private_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); proof = root / "validation.json"; evidence = root / "candidate.json"
            value = {"version": addition.VERSION, "status": "reviewed", "predecessorSha256": "p" * 64,
                "parentReferenceSha256": "r" * 64, "migrationSha256": "m" * 64,
                "steps": list(catalog.STEPS), "stepFiles": catalog.FILES, "validation": str(proof),
                "codeSha256": "c" * 64, "sourceSha256": "s" * 64, "databasePolicy": addition.POLICY}
            validation = {"version": "jd-monitor-preferences-private-postgres-v1", "status": "passed",
                "productionTouched": False, "steps": list(catalog.STEPS), "codeSha256": value["codeSha256"],
                "migrationSha256": value["migrationSha256"], "checks": sorted(addition.CHECKS)}
            def admit(candidate, report):
                proof.write_bytes(common.canonical(report)); candidate = candidate | {"validationSha256": common.sha(proof)}
                evidence.write_bytes(common.canonical(candidate))
                with patch.object(addition, "parent_proof", return_value=(set(), "r" * 64)), patch.object(common, "sha", wraps=common.sha) as digest, patch.object(addition, "source_delta", return_value="m" * 64), patch.object(addition, "code_digest", return_value="c" * 64), patch.object(addition, "source_inventory", return_value="s" * 64):
                    digest.side_effect = lambda path: "p" * 64 if str(path).endswith("deployment.json") else digest._mock_wraps(path)
                    return addition.admission(root, root, evidence, common.sha(evidence))
            self.assertEqual(admit(value, validation)["status"], "reviewed")
            for key, bad in (("productionTouched", True), ("checks", []), ("codeSha256", "x" * 64), ("migrationSha256", "x" * 64), ("steps", [])):
                with self.subTest(key=key), self.assertRaises(ValueError): admit(value, validation | {key: bad})
            for key in ("predecessorSha256", "parentReferenceSha256", "migrationSha256", "sourceSha256", "codeSha256", "databasePolicy"):
                with self.subTest(key=key), self.assertRaises(ValueError): admit(value | {key: "x" * 64}, validation)

    def test_catalog147_does_not_mutate_or_loosen146(self):
        reference = json.loads((ROOT / "tools/jd_monitor_preferences_catalog.json").read_text())
        old = json.loads((ROOT / "tools/jd_logistics_catalog.json").read_text())
        expected = copy.deepcopy(old)
        expected[catalog.TABLE]["columns"] += [[field, "jsonb", True, None, "", "", None] for field in catalog.FIELDS]
        self.assertEqual(reference, expected)
        for field in ("columns", "acl", "indexes", "columnAcl", "identity", "triggers", "policies"):
            bad = copy.deepcopy(reference); bad[catalog.TABLE][field] = [["unexpected"]]
            cursor = MagicMock(); cursor.fetchall.return_value = [(table,) for table in catalog.TABLES]
            with patch.object(catalog, "inspect_tables", return_value=bad), self.assertRaises(ValueError): catalog.verify_catalog(cursor)

    def test_database_release_dispatch_prefers147_and_fails_closed(self):
        import integration_release_gate as gate
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for active in (addition.ACTIVE, addition.parent.ACTIVE): (root / active).write_text("{}")
            with patch.object(addition, "verify_active", return_value=({"migrationCount": 147}, {}, root)) as current, patch.object(addition.parent, "verify_active") as old:
                self.assertEqual(gate.verify_release(root, root)["migrationCount"], 147)
                current.assert_called_once(); old.assert_not_called()
            with patch.object(addition, "verify_active", side_effect=ValueError("bad147")), patch.object(addition.parent, "verify_active") as old, self.assertRaises(ValueError): gate.verify_release(root, root)
            old.assert_not_called()

    def test_windows_powershell_real_lifecycle_function_and_package_inventory(self):
        # Parse only the function. No dot-source of live controllers or secrets.
        script = r"""$ErrorActionPreference='Stop'
$source=$args[0];$temporary=$args[1]
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controller syntax failed'}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-NoUnapprovedProtectedAiMigration'},$true)
Invoke-Expression $fn.Extent.Text
$RuntimeRoot='D:\teruisi-runtime\django-sales';$Python='fixture';$BackendRoot=Join-Path $temporary 'backend';$IntegrationOperationId='';$IntegrationEvidencePath='';$IntegrationEvidenceSha256='a'*64
function Test-Path {param($LiteralPath,$PathType) return $LiteralPath -match 'jd-monitor-preferences-addition-active.json|jd_monitor_preferences_addition.py|jd-logistics-addition-active.json|jd_logistics_addition.py'}
function Invoke-BoundedNativeProcess {param($exe,$arguments,$root) $script:called=@($arguments); return @{ExitCode=0}}
function ConvertFrom-UniqueNativeJson {param($run,$label) return [pscustomobject]@{status='verified'}}
foreach($operation in @('PrepareApp','DeployApp','Django migrate')){
 Assert-NoUnapprovedProtectedAiMigration $operation
 if($script:called[0] -notmatch 'jd_monitor_preferences_addition.py'){throw 'Old146 verifier received147'}
 $wanted=if($operation -ceq 'Django migrate'){'release'}else{'successor'}
 if($script:called[1] -cne $wanted){throw 'Wrong lifecycle command'}
}
function Read-JsonFile {param($path,$label) return [pscustomobject]@{version='teruisi-jd-monitor-preferences-schema-addition-v1'}}
$IntegrationEvidencePath='fixture.json'
function Test-Path {param($LiteralPath,$PathType) return $LiteralPath -notmatch 'jd-product-monitoring' }
Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
if($script:called[1] -cne 'admission' -or $script:called -cnotcontains '--evidence-sha'){throw 'Admission missing exact evidence'}
$IntegrationOperationId='b'*32
Assert-NoUnapprovedProtectedAiMigration 'DeployApp'
if($script:called[1] -cne 'deployment' -or $script:called -cnotcontains '--operation'){throw 'Deployment missing operation binding'}
function ConvertFrom-UniqueNativeJson {param($run,$label) return [pscustomobject]@{status='blocked'}}
$rejected=$false;try{Assert-NoUnapprovedProtectedAiMigration 'Django migrate'}catch{$rejected=$true}
if(-not $rejected){throw 'Bad147 proof accepted'}
'LIFECYCLE147_OK'
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "routing.ps1"; path.write_text(script, encoding="utf-8-sig")
            result = subprocess.run([r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(path), str(ROOT / "tools/django-local-service.ps1"), tmp], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("LIFECYCLE147_OK", result.stdout)
        source = (ROOT / "tools/django-local-service.ps1").read_text(encoding="utf-8-sig")
        for name in ("jd_monitor_preferences_addition.py", "jd_monitor_preferences_catalog.py", "jd_monitor_preferences_catalog.json"):
            self.assertIn('"tools\\' + name + '",', source)


if __name__ == "__main__": unittest.main()
