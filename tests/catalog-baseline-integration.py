"""Offline catalog gate wiring tests. No lifecycle entry or database is run."""
import ast
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from check_catalog_baselines import require_catalog_baselines


def function(path, name):
    tree = ast.parse((ROOT / path).read_bytes())
    matches = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
    if len(matches) != 1:
        raise AssertionError(name)
    return matches[0]


class Integration(unittest.TestCase):
    def test_candidate_refuses_before_recipe_or_runtime_reads(self):
        node = function("tools/workflow_automation_candidate.py", "candidate")
        reads = []

        def unexpected_read(*args):
            reads.append(args)
            raise AssertionError("recipe/runtime access before catalog rejection")

        env = {"require_catalog_baselines": require_catalog_baselines,
               "gate": types.SimpleNamespace(common=types.SimpleNamespace(read=unexpected_read))}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "candidate-boundary", "exec"), env)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                env["candidate"](Path(directory), Path(directory) / "never-runtime", Path(directory) / "recipe")
        self.assertEqual(reads, [])

    def test_capture_never_overwrites_frozen_catalog_and_checks_first(self):
        for stem in ("jd_logistics", "pi_agent", "pi_workspace", "tmall_warehouse", "workflow_automation"):
            path = "tools/" + stem + "_rehearsal.py"
            launch = function(path, "launch")
            self.assertIsInstance(launch.body[0], ast.ImportFrom)
            call = launch.body[1].value
            self.assertEqual(ast.unparse(call.func), "require_catalog_baselines")
            self.assertEqual(call.args[0].id, "ROOT")
            self.assertEqual(call.keywords[0].arg, "capture_target")
            self.assertEqual(call.keywords[0].value.body.value, stem + "_catalog.json")
            capture = function(path, "capture")
            branch = next(n for n in capture.body if isinstance(n, ast.If)
                          and "--capture-catalog" in ast.unparse(n.test))
            lines = [ast.unparse(n) for n in branch.body]
            checked = next(i for i, s in enumerate(lines) if s.startswith("require_catalog_baselines(ROOT, replacement="))
            target = next(i for i, s in enumerate(lines) if s.startswith("candidate_file ="))
            write = next(i for i, s in enumerate(lines) if s.startswith("with candidate_file.open("))
            self.assertLess(checked, target)
            self.assertLess(target, write)
            self.assertIn("directory /", lines[target])
            self.assertIn(".candidate", lines[target])
            self.assertIn("open('x'", lines[write])
            self.assertNotIn("write_text", "\n".join(lines))

    def test_code_check_record_is_consumed_and_checker_is_a_digest_member(self):
        addition = ast.parse((ROOT / "tools/workflow_automation_addition.py").read_bytes())
        checks = next(ast.literal_eval(n.value) for n in addition.body if isinstance(n, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "CHECKS" for t in n.targets))
        self.assertIn("catalog-baseline", checks)
        for name in ("tools/workflow_automation_candidate.py", "tools/workflow_automation_addition.py",
                     "tools/check_schema_code_digest.py"):
            source = (ROOT / name).read_text(encoding="utf8")
            self.assertIn('proof.get("catalogBaseline")', source)
            self.assertIn("require_catalog_baselines(root)", source)
        self.assertIn('tools/check_catalog_baselines.py', [n.value for n in ast.walk(addition) if isinstance(n, ast.Constant)])

    @unittest.skipUnless(os.name == "nt", "PS5/PS7 native wrapper fixture runs on Windows")
    def test_real_powershell_helper_and_preparation_order(self):
        # Only named function ASTs are loaded; the controller's top-level body,
        # PrepareApp, production identity, credentials and lifecycle never run.
        script = r'''param([string]$Root,[string]$PythonPath,[string]$Baseline)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$tree=[Management.Automation.Language.Parser]::ParseFile((Join-Path $Root 'tools/django-local-service.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controller syntax invalid'}
$functions=@($tree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
$helper=@($functions | Where-Object Name -eq 'Assert-CatalogBaselines')
if($helper.Count -ne 1){throw 'Expected one catalog helper'}
. ([scriptblock]::Create($helper[0].Extent.Text))
$convert=@($functions | Where-Object Name -eq 'ConvertFrom-UniqueNativeJson')
. ([scriptblock]::Create($convert[0].Extent.Text))
function Get-NativeFailureSummary($Run){return 'private fixture failure'}
$script:payload=$null
$script:fakeExit=0
function Invoke-BoundedNativeProcess($Executable,$Arguments,$WorkingDirectory){
  if($Executable -cne $PythonPath -or $WorkingDirectory -cne $Root){throw 'Unexpected native target'}
  if(($Arguments -join '|') -cne (@('-B',(Join-Path $Root 'tools/check_catalog_baselines.py'),'--root',$Root,'--compact') -join '|')){throw 'Wrong checker arguments'}
  if($null -eq $script:payload){
    $lines=@(& $Executable @Arguments);$exit=$LASTEXITCODE
  }else{$lines=@($script:payload);$exit=$script:fakeExit}
  return [pscustomobject]@{ExitCode=[int]$exit;LaunchFailed=$false;Output=$lines;Diagnostic=[pscustomobject]@{OutputTruncated=(($lines -join "`n").Length -gt 4096)}}
}
$ExecutionRoot=$Root;$Python=$PythonPath
Assert-CatalogBaselines
$good=[ordered]@{version='teruisi-catalog-baselines-v1';status='passed';scope='catalog-baseline';databaseContacted=$false;diagnostics=@();deferredCatalogs=@();totalDiagnostics=0;fullReportSha256=('a'*64)}
$count=0
foreach($case in @('failed','empty','garbage','deferred','wrongScope','database','exit','truncated')){
  $value=[ordered]@{};foreach($key in $good.Keys){$value[$key]=$good[$key]}
  $script:fakeExit=0
  switch($case){
    'failed' {$value.status='failed'}
    'deferred' {$value.deferredCatalogs=@('workflow_automation_catalog.json')}
    'wrongScope' {$value.scope='capture-preflight'}
    'database' {$value.databaseContacted=$true}
    'exit' {$script:fakeExit=1}
  }
  $script:payload=ConvertTo-Json -InputObject $value -Compress
  if($case -eq 'empty'){$script:payload=''}
  if($case -eq 'garbage'){$script:payload='passed checks=999'}
  if($case -eq 'truncated'){$script:payload=(' '*5000)+$script:payload}
  $refused=$false;try{Assert-CatalogBaselines}catch{$refused=$true}
  if(-not $refused){throw "Accepted invalid native result: $case"};$count++
}
$prepare=@($functions|Where-Object Name -eq 'Prepare-Application')[0]
$commands=@($prepare.Body.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true))
$names=@($commands|ForEach-Object {$_.GetCommandName()})
$gate=[Array]::IndexOf($names,'Assert-CatalogBaselines')
if($gate -lt 0 -or $gate -gt [Array]::IndexOf($names,'Assert-NoUnapprovedProtectedAiMigration') -or $gate -gt [Array]::IndexOf($names,'New-Item')){throw 'Gate must precede migration branch and staging'}
# A finite exact edit: all prior functions are unchanged except PrepareApp's
# one call and explicit copy-list member; no cold-start routing change.
$oldTokens=$null;$oldErrors=$null
$oldTree=[Management.Automation.Language.Parser]::ParseFile($Baseline,[ref]$oldTokens,[ref]$oldErrors)
if($oldErrors.Count){throw 'Baseline syntax invalid'}
$oldFunctions=@($oldTree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
if($functions.Count -ne $oldFunctions.Count+1){throw 'Unexpected controller functions'}
foreach($old in $oldFunctions){
  $current=@($functions|Where-Object Name -eq $old.Name)
  if($current.Count -ne 1){throw 'Function membership differs'}
  $text=$current[0].Extent.Text
  if($old.Name -eq 'Prepare-Application'){
    $text=$text.Replace("  Assert-CatalogBaselines`r`n",'').Replace("      `"tools\check_catalog_baselines.py`",`r`n",'')
  }
  if($text -cne $old.Extent.Text){throw "Unqualified controller change: $($old.Name)"}
}
$copyLoops=@($prepare.Body.FindAll({param($n) $n -is [Management.Automation.Language.ForEachStatementAst] -and $n.Variable.VariablePath.UserPath -eq 'relative'},$true))
if($copyLoops.Count -ne 1){throw 'Copy-list shape changed'}
$copied=@($copyLoops[0].Condition.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]},$true)|ForEach-Object {$_.Value.Replace('\','/')})
$report=& $PythonPath -B (Join-Path $Root 'tools/check_catalog_baselines.py') --root $Root | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Catalog report failed'}
foreach($property in $report.sourceFiles.PSObject.Properties){
 if($property.Name.StartsWith('tools/') -and $copied -cnotcontains $property.Name){throw ('Catalog input missing from CopyApp: '+$property.Name)}
}
[ordered]@{status='passed';negativeCases=$count;hostVersion=$PSVersionTable.PSVersion.ToString();controllerFunctions=$functions.Count}|ConvertTo-Json -Compress
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "check.ps1"
            path.write_text(script, encoding="utf-8-sig")
            baseline = Path(directory) / "baseline.ps1"
            baseline.write_bytes(subprocess.check_output(
                ["git", "show", "3ce73dfa:tools/django-local-service.ps1"], cwd=ROOT))
            hosts = [Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe", shutil.which("pwsh")]
            for host in hosts:
                self.assertTrue(host)
                result = subprocess.run([str(host), "-NoProfile", "-NonInteractive", "-File", str(path),
                                         "-Root", str(ROOT), "-PythonPath", sys.executable, "-Baseline", str(baseline)],
                                        capture_output=True, text=True, encoding="utf8", errors="replace", timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                report = json.loads(result.stdout)
                self.assertEqual(report["status"], "passed")
                self.assertEqual(report["negativeCases"], 8)


if __name__ == "__main__":
    unittest.main()
