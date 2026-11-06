"""Generate AI159 code-check bindings from one clean frozen Git checkout.

Only syntax and a guarded, connection-free migration/model graph are executed.
Outputs go to the separate delivery tree; no binder or production CLI runs.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
from unittest.mock import patch

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", required=True, type=Path)
parser.add_argument("--output-root", required=True, type=Path)
parser.add_argument("--base", default="77382b5fc4ad958e1c22e7d9f8431bffdafdb204")
args = parser.parse_args()
ROOT, DELIVERY = args.source.resolve(), args.output_root.resolve()
assert ROOT != DELIVERY, "Checks must run from an independent frozen tree"
assert not str(DELIVERY).lower().startswith("d:\\teruisi-runtime"), "Private delivery tree required"
sys.path.insert(0, str(ROOT / "tools"))
import ai_unified_tasks_addition as gate

ENV = {k: v for k, v in os.environ.items() if k.upper() in {
    "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"}}
ENV.update(PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", GIT_TERMINAL_PROMPT="0")
REL = "docs/ai-p2-20261107"
OUT = DELIVERY / REL
OUT.mkdir(parents=True, exist_ok=True)


def run(command, timeout=60):
    result = subprocess.run(command, cwd=ROOT, env=ENV, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("Code check failed: " + repr(command) + "\n" +
                           result.stderr.decode("utf8", "replace")[-5000:])
    return result.stdout


def write(name, data):
    file = OUT / name
    file.write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf8", newline="\n")
    return REL + "/" + name, gate.common.sha(file)


assert run(["git", "status", "--porcelain"]).strip() == b"", "Frozen source must be clean"
commit = run(["git", "rev-parse", "HEAD"]).decode().strip()
files = {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES}
assert len(files) == len(gate.CODE_FILES)
code_sha = gate.code_digest(ROOT)
# Check Git correspondence without substituting a different digest algorithm.
for name, digest in files.items():
    assert hashlib.sha256(run(["git", "show", "HEAD:" + name])).hexdigest() == digest, name
supplemental_names = ["backend/teruisi_backend/settings.py", "tools/ai_unified_tasks_rehearsal.py",
                      "backend/ai_assistant/task_definitions.py", "backend/ai_assistant/task_connectors.py",
                      "backend/ai_assistant/task_dispatch.py", "backend/ai_assistant/task_legacy_adapters.py",
                      "backend/ai_assistant/task_dependencies.py",
                      "backend/ai_assistant/database_contract.py", "backend/ai_assistant/pi_views.py",
                      "tests/ai159-acl-catalog-boundary.py", "tools/check_schema_code_digest.py", "tools/check_catalog_baselines.py",
                      REL + "/run-mandatory-checks.py"]
supplemental = {name: gate.common.sha(ROOT / name) for name in supplemental_names}
selected = list(dict.fromkeys([*files, *supplemental]))
groups = {suffix: [name for name in selected if Path(name).suffix == suffix]
          for suffix in (".py", ".mjs", ".ps1", ".psm1", ".json")}
for name in groups[".py"]: compile((ROOT / name).read_bytes(), name, "exec", dont_inherit=True)
print(json.dumps({"phase": "python-syntax", "files": len(groups[".py"])}), flush=True)
for name in groups[".mjs"]: run(["node", "--check", name])
print(json.dumps({"phase": "node-syntax", "files": len(groups[".mjs"])}), flush=True)
ps_results = []
with tempfile.TemporaryDirectory(prefix="ai159-source-checks-") as scratch_name:
    scratch = Path(scratch_name)
    ps_files = groups[".ps1"] + groups[".psm1"]
    paths = scratch / "paths.json"
    paths.write_text(json.dumps([str(ROOT / p) for p in ps_files]), encoding="utf8")
    script = scratch / "parse.ps1"
    script.write_text("param([string]$InputFile)\n$ErrorActionPreference='Stop'\n"
        "$files=ConvertFrom-Json ([IO.File]::ReadAllText($InputFile))\n"
        "$count=0; foreach($file in $files){$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$e);"
        "if(@($e).Count){throw ('Syntax refused: '+$file)};$count++}\n"
        "@{status='passed';files=$count;version=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Compress\n",
        encoding="utf-8-sig", newline="\r\n")
    for host in ("powershell.exe", "pwsh.exe"):
        executable = shutil.which(host)
        assert executable, "Required PowerShell host missing: " + host
        result = json.loads(run([executable, "-NoProfile", "-NonInteractive", "-File", str(script), str(paths)]))
        assert result["status"] == "passed" and result["files"] == len(ps_files)
        ps_results.append({"host": host, **result})
    print(json.dumps({"phase": "powershell-syntax", "hosts": ps_results}), flush=True)
    for name in groups[".json"]: gate.common.read(ROOT / name)
    archive = run(["git", "archive", args.base, "backend"])
    baseline = scratch / "baseline158"
    baseline.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not member.isfile() or "/migrations/" not in member.name or not member.name.endswith(".py"): continue
            target = baseline / member.name
            assert baseline in target.resolve().parents
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(tar.extractfile(member).read())
    before, current = gate.common.migrations(baseline), gate.common.migrations(ROOT)
    assert set(current) == set(before) | set(gate.FILES)
    assert not set(before) & set(gate.FILES)
    assert all(current[p] == v for p, v in before.items())
    assert all(current[p] == v for p, v in gate.FILES.items())
    migration_sha = gate.source_delta(ROOT, baseline)
    project_nodes = {Path(p).parts[1] + "." + Path(p).stem for p in current if Path(p).stem != "__init__"}
    builtin = {"contenttypes.0001_initial", "contenttypes.0002_remove_content_type_name"}
    assert len(project_nodes | builtin) == 159
    assert len((project_nodes - set(gate.STEPS)) | builtin) == 158
    settings_tree = ast.parse((ROOT / "backend/teruisi_backend/settings.py").read_bytes())
    installed = next(ast.literal_eval(n.value) for n in settings_tree.body if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == "INSTALLED_APPS" for t in n.targets))
    sys.path.insert(0, str(ROOT / "backend"))
    from django.conf import settings
    settings.configure(INSTALLED_APPS=installed, DATABASES={"default": {"ENGINE": "django.db.backends.dummy"}},
                       DEFAULT_AUTO_FIELD="django.db.models.BigAutoField", USE_TZ=True, SECRET_KEY="private-source-graph")
    from django.db.backends.base.base import BaseDatabaseWrapper
    import psycopg
    def no_connection(*unused, **kwargs): raise AssertionError("Database connection forbidden in source checks")
    with patch.object(BaseDatabaseWrapper, "ensure_connection", no_connection), patch.object(psycopg, "connect", no_connection):
        import django
        django.setup()
        from django.apps import apps
        from django.db.migrations.loader import MigrationLoader
        from django.db.migrations.state import ProjectState
        from django.db.migrations.autodetector import MigrationAutodetector
        loader = MigrationLoader(None)
        assert {".".join(n) for n in loader.disk_migrations} == project_nodes | builtin
        operations = {step: [type(op).__name__ for op in loader.disk_migrations[tuple(step.split(".", 1))].operations]
                      for step in gate.STEPS}
        assert all(value.count("CreateModel") == 5 and value[-1] == "RunPython" and set(value) <= {"CreateModel", "AddConstraint", "AddIndex", "RunPython"} for value in operations.values())
        assert all(op.reversible for step in gate.STEPS
                   for op in loader.disk_migrations[tuple(step.split(".", 1))].operations)
        gate.verify_defaults(loader.project_state(loader.graph.leaf_nodes()).apps)
        assert not MigrationAutodetector(loader.project_state(), ProjectState.from_apps(apps)).changes(graph=loader.graph)
    closure = {"status": "passed", "fromGeneration": 158, "toGeneration": 159, "baselineCommit": args.base,
               "migrationSha256": migration_sha, "stepFiles": gate.FILES, "added": sorted(set(current) - set(before)),
               "graphMigrationNodes": 159, "operations": operations, "modelsMatchMigrationState": True,
               "databaseContacted": False, "installedParentVerified": False}
assert files == {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES}
assert supplemental == {name: gate.common.sha(ROOT / name) for name in supplemental}
execution = {"version": "teruisi-schema-mandatory-code-execution-v1", "checkedAt": datetime.now(timezone.utc).isoformat(),
             "baseCommit": commit, "productionTouched": False, "functionalValidationPerformed": False,
             "fullBackupOrRestorePerformed": False, "checks": sorted(gate.CHECKS), "codeSha256": code_sha,
             "migrationSha256": migration_sha, "sourceFiles": files, "supplementalSourceFiles": supplemental,
             "syntax": {"python": {"status": "passed", "files": groups[".py"]},
                        "node": {"status": "passed", "files": groups[".mjs"]},
                        "powershell": {"status": "passed", "files": ps_files, "hosts": ps_results}},
             "migrationClosure": closure, "jsonSyntax": {"status": "passed", "files": groups[".json"]},
             "executionScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
execution_path, execution_sha = write("ai159-execution.json", execution)
proof = {"version": "ai-unified-tasks-mandatory-code-checks-v1", "status": "code-checked",
         "checkedAt": execution["checkedAt"], "productionTouched": False, "functionalValidationPerformed": False,
         "fullBackupOrRestorePerformed": False, "generations": [158, 159], "parentVariants": [[158, 159]],
         "steps": list(gate.STEPS), "codeSha256": code_sha, "migrationSha256": migration_sha,
         "checks": sorted(gate.CHECKS), "evidence": {"path": execution_path, "sha256": execution_sha}}
proof_path, proof_sha = write("ai159-checks.json", proof)
recipe = {"version": "teruisi-main-schema-recipe-v1", "additionKind": "AiUnifiedTasks",
          "fromGeneration": 158, "toGeneration": 159, "steps": list(gate.STEPS), "stepFiles": gate.FILES,
          "validation": proof_path, "validationSha256": proof_sha, "codeSha256": code_sha}
recipe_file = DELIVERY / "config/main-schema-releases/ai-0090.json"
recipe_file.write_text(json.dumps(recipe, indent=2) + "\n", encoding="utf8", newline="\n")
print(json.dumps({"status": "code-checked", "codeFileCount": len(files), "codeSha256": code_sha,
                  "sourceCommit": commit, "checks": proof_path}), flush=True)
