"""Finite149 boundaries; all evidence and native execution stay private."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import tmall_warehouse_addition as addition
import tmall_warehouse_catalog as catalog
import tmall_warehouse_candidate as binder


class TmallSchemaTests(unittest.TestCase):
    def test_only_two_exact_source_deltas_and_unchanged_old_migrations(self):
        old = {"backend/old/migrations/0001.py": "a" * 64}
        for before in (old, old | addition.MONITORING_FILES):
            after = old | addition.FILES
            with patch.object(addition.common, "migrations", side_effect=[before, after]):
                self.assertEqual(addition.source_delta("new", "old"), addition.common.digest(after))
            for bad in (before, after | {next(iter(old)): "b" * 64},
                        after | {next(iter(catalog.FILES)): "b" * 64},
                        after | {"backend/x/migrations/9999.py": "c" * 64}):
                with patch.object(addition.common, "migrations", side_effect=[before, bad]), self.assertRaises(ValueError):
                    addition.source_delta("new", "old")
        for generation in (True, 146, 149, "147"):
            with self.assertRaises(ValueError): addition.steps_files(generation)

    def test_each_original_parent_only_sees_its_captured_source(self):
        for generation, owner in ((147, addition.parent), (148, addition.monitoring_parent)):
            base = {"old." + str(i) for i in range(generation - len(owner.STEPS))}
            receipt = {"migrationCount": generation}
            migrations = addition.MONITORING_FILES if generation == 148 else {}
            with patch.object(addition.common, "migrations", return_value=migrations), patch.object(owner, "verify_active", return_value=(receipt, {}, Path("captured"))) as verifier, patch.object(owner, "parent_proof", return_value=(base, "x")), patch.object(addition.common, "sha", return_value="a" * 64):
                result, _ = addition.parent_proof("runtime", "original")
                verifier.assert_called_once_with("original", "runtime")
                self.assertEqual(len(result), generation)

    def test_unknown_or_existing_intent_never_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            addition.common.write(root / "plan.json", {})
            state = {"rows": 1, "legacyRowsSha256": "a" * 64, "permissionsSha256": "b" * 64}
            addition.common.write(root / "install-intent.json", {"version": addition.VERSION,
                "planSha256": addition.common.sha(root / "plan.json"), "at": "fixture", "preservation": state})
            with patch("postgres_no_key_backup.verify_receipt_generation", return_value=147), patch.object(addition, "apply_steps") as apply, self.assertRaises(ValueError):
                addition.install_schema("install", MagicMock(), root, "a" * 32, root, {}, set())
            apply.assert_not_called()
            with patch.object(addition, "check_database", side_effect=ValueError("unknown")), patch.object(addition, "apply_steps") as apply, self.assertRaises(ValueError):
                addition.install_schema("reconcile", MagicMock(), root, "a" * 32, root, {}, set())
            apply.assert_not_called()

    def test_pointer_cas_keeps_original_unknown_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            pointer = Path(directory) / "active.json"
            addition.publish(pointer, {"version": 1}); original = addition.common.sha(pointer)
            addition.publish(pointer, {"version": 2}, previous=original)
            with self.assertRaises(ValueError): addition.publish(pointer, {"version": 3}, previous=original)
            self.assertEqual(addition.common.read(pointer), {"version": 2})

    def test_release_dispatch_prefers149_without_falling_back(self):
        import integration_release_gate as gate
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for active in (addition.ACTIVE, addition.monitoring_parent.ACTIVE): (root / active).write_text("{}")
            with patch.object(addition, "verify_active", return_value=({"migrationCount": 149}, {}, root)) as current, patch.object(addition.monitoring_parent, "verify_active") as old:
                self.assertEqual(gate.verify_release(root, root)["migrationCount"], 149)
                current.assert_called_once(); old.assert_not_called()
            with patch.object(addition, "verify_active", side_effect=ValueError("bad149")), patch.object(addition.monitoring_parent, "verify_active") as old, self.assertRaises(ValueError):
                gate.verify_release(root, root)
            old.assert_not_called()

    def test_file_only_binder_for_each_parent_rejects_stale_evidence(self):
        for generation in (147, 148):
            with self.subTest(generation=generation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); source = root / "source"; source.mkdir()
                runtime = root / "runtime"; (runtime / "app").mkdir(parents=True)
                (runtime / "app/deployment.json").write_text("{}")
                owner = addition.parent if generation == 147 else addition.monitoring_parent
                (runtime / owner.ACTIVE).write_text("{}")
                steps, files = addition.steps_files(generation)
                proof = {"version": "tmall-warehouse-private-postgres-v1", "status": "passed", "productionTouched": False,
                    "generations": [147, 148, 149], "parentVariants": [[147, 149], [148, 149]], "fullBackupOrRestorePerformed": False,
                    "steps": list(addition.STEPS), "checks": sorted(addition.CHECKS), "codeSha256": "a" * 64, "migrationSha256": "b" * 64}
                addition.common.write(source / "proof.json", proof)
                recipe = {"version": "teruisi-main-schema-recipe-v1", "additionKind": "TmallWarehouse",
                    "fromGeneration": generation, "toGeneration": 149, "steps": list(steps), "stepFiles": files,
                    "validation": "proof.json", "validationSha256": addition.common.sha(source / "proof.json"), "codeSha256": "a" * 64}
                addition.common.write(source / "recipe.json", recipe)
                migrations = addition.MONITORING_FILES if generation == 148 else {}
                with patch.object(socket.socket, "connect", side_effect=AssertionError("no network")), patch.object(addition, "code_digest", return_value="a" * 64), patch.object(addition, "source_delta", return_value="b" * 64), patch.object(addition.common, "migrations", return_value=migrations), patch.object(addition, "source_inventory", return_value="c" * 64), patch.object(addition, "parent_proof", return_value=(set(), addition.common.sha(runtime / owner.ACTIVE))):
                    output = source / "evidence.json"
                    result = binder.bind(source, runtime, source / "recipe.json", output)
                    original = output.read_bytes()
                    binder.bind(source, runtime, source / "recipe.json", output, True, result["evidenceSha256"])
                    for mutation in ({"productionTouched": True}, {"checks": []}, {"parentVariants": [[147, 149]]}, {"fullBackupOrRestorePerformed": True}):
                        (source / "proof.json").write_bytes(addition.common.canonical(proof | mutation))
                        changed = recipe | {"validationSha256": addition.common.sha(source / "proof.json")}
                        (source / "recipe.json").write_bytes(addition.common.canonical(changed))
                        with self.assertRaises(ValueError): binder.bind(source, runtime, source / "recipe.json", output)
                        self.assertEqual(output.read_bytes(), original)
                    (source / "proof.json").write_bytes(addition.common.canonical(proof))
                    (source / "recipe.json").write_bytes(addition.common.canonical(recipe))
                    (runtime / "app/deployment.json").write_text('{"changed":true}')
                    with self.assertRaises(ValueError): binder.bind(source, runtime, source / "recipe.json", output)
                    self.assertEqual(output.read_bytes(), original)

    def test_native_exact_generation149_and_adopter_contracts(self):
        from integration_migration_plan import load_policy, DELTA_STEP
        import jackyun_audit_catalog, ai_schedule_addition_catalog, jd_logistics_catalog
        import jd_monitor_preferences_catalog
        policy = load_policy(ROOT / "config/integration-migration-policy-v3.json")
        base147 = [*policy.baseline, *policy.steps, DELTA_STEP, "finance.0007_finance_erp_targets",
                   *jackyun_audit_catalog.STEPS, *ai_schedule_addition_catalog.STEPS,
                   *jd_logistics_catalog.STEPS, *jd_monitor_preferences_catalog.STEPS]
        self.assertEqual(len(base147), 147)
        def evidence(steps):
            return {"migrations": [{"app": item.split(".", 1)[0], "name": item.split(".", 1)[1]} for item in steps],
                    "tables": {"django_migrations": len(steps)}}
        full = base147 + list(addition.STEPS)
        cases = [{"accepted": True, "evidence": evidence(steps)} for steps in (base147, full[:-1], full)]
        cases += [{"accepted": False, "evidence": evidence(steps)} for steps in
                  (full[:-1] + ["inventory.9999_unknown"], full[:-2] + list(catalog.STEPS), full + list(catalog.STEPS))]
        script = r'''$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance parse failed'}
$fn=$ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq 'Assert-MaintenanceNoKeyGeneration'},$true)
Invoke-Expression $fn.Extent.Text
foreach($case in (Get-Content -LiteralPath $args[1] -Raw | ConvertFrom-Json)){
 $accepted=$true
 try{$null=Assert-MaintenanceNoKeyGeneration $case.evidence}catch{$accepted=$false}
 if($accepted -ne $case.accepted){throw 'Exact149 generation mismatch'}
}
$ast=[Management.Automation.Language.Parser]::ParseFile($args[2],[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Adopter parse failed'}
$biRequest=@{AdditionKind='TmallWarehouse'}
foreach($variable in @('$biGateName','$biApplicationName')){
 $assignment=$ast.Find({param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -ceq $variable},$true)
 Invoke-Expression $assignment.Extent.Text
}
if($biGateName -cne 'tools\tmall_warehouse_addition.py' -or $biApplicationName -cne 'teruisi_tmall_warehouse_schema_append'){throw 'Wrong149 adopter route'}
'EXACT149_NATIVE_OK'
'''
        hosts = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]
        if shutil.which("pwsh"): hosts.append(shutil.which("pwsh"))
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); fixture = folder / "cases.json"; harness = folder / "native.ps1"
            fixture.write_bytes(addition.common.canonical(cases)); harness.write_text(script, encoding="utf-8-sig")
            for host in hosts:
                result = subprocess.run([host, "-NoProfile", "-NonInteractive", "-File", str(harness),
                    str(ROOT / "tools/django-postgres-maintenance.ps1"), str(fixture), str(ROOT / "tools/bi-app-adopt.ps1")],
                    capture_output=True, text=True, encoding="utf8", errors="replace", timeout=45,
                    creationflags=subprocess.CREATE_NO_WINDOW)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("EXACT149_NATIVE_OK", result.stdout)

    def test_native_lifecycle_routes149_and_retains_failure(self):
        script = r'''$ErrorActionPreference='Stop'
$file=Join-Path $env:TMALL_TEST_ROOT 'tools\django-local-service.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$null)
$fn=$ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq 'Assert-NoUnapprovedProtectedAiMigration'},$true)
Invoke-Expression $fn.Extent.Text
$RuntimeRoot='D:\teruisi-runtime\django-sales';$BackendRoot=Join-Path $env:TMALL_TEST_ROOT 'backend';$Python='private-python'
$IntegrationEvidencePath='private-evidence';$IntegrationEvidenceSha256='a'*64;$IntegrationOperationId=''
function Test-Path {param($LiteralPath,$PathType) return $true}
function Read-JsonFile {param($a,$b) return @{version='teruisi-tmall-warehouse-schema-addition-v1'}}
$script:mode='verified'
function Invoke-BoundedNativeProcess {param($exe,$nativeArguments,$cwd) $script:route=@($nativeArguments);return @{}}
function ConvertFrom-UniqueNativeJson {param($run,$label) return @{status=$script:mode}}
Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'
if($script:route[0] -notmatch 'tmall_warehouse_addition.py' -or $script:route[1] -cne 'admission'){throw 'Wrong149 route'}
$script:mode='blocked';$rejected=$false
try{Assert-NoUnapprovedProtectedAiMigration 'PrepareApp'}catch{$rejected=$true}
if(-not $rejected){throw '149 rejection fell through'}
'TMALL149_NATIVE_OK'
'''
        hosts = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]
        if shutil.which("pwsh"): hosts.append(shutil.which("pwsh"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "native.ps1"; path.write_text(script, encoding="utf-8-sig")
            for host in hosts:
                result = subprocess.run([host, "-NoProfile", "-NonInteractive", "-File", str(path)],
                    env={**os.environ, "TMALL_TEST_ROOT": str(ROOT)}, capture_output=True, text=True, encoding="utf8", errors="replace",
                    timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("TMALL149_NATIVE_OK", result.stdout)
        shipped = (ROOT / "tools/django-local-service.ps1").read_text(encoding="utf-8-sig")
        for name in ("tmall_warehouse_addition.py", "tmall_warehouse_catalog.py", "tmall_warehouse_catalog.json", "tmall_warehouse_candidate.py", "main-schema-release.mjs"):
            self.assertIn('"tools\\' + name + '"', shipped)


if __name__ == "__main__": unittest.main()
