"""One-off source checks/binding, reusing byte-identical prior results.

Requires the retained a370c993 Git evidence. Never invokes a candidate, database,
controller or build. Historical evidence remains untouched; outputs are new.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
import sales_preflight_addition as sales
import workflow_automation_addition as workflow

PRIOR = "a370c99380aaf2568902b8838b7d1f8c010c2d25"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, timeout=30)


def historical(commit, name):
    raw = run("git", "show", commit + ":" + name)
    return json.loads(raw), {"commit": commit, "path": name, "sha256": sha(raw)}


def write(name, value):
    path = OUT / name
    raw = (json.dumps(value, ensure_ascii=True, indent=2) + "\n").encode()
    path.write_bytes(raw)
    return path.relative_to(ROOT).as_posix(), sha(raw)


def main():
    for gate in (sales, workflow):
        assert Path(gate.__file__).resolve().parent == ROOT / "tools"
    # Original main checks cover the restored runtime files; prior candidate
    # checks cover the identical S/s fixes and repaired Workflow JSON.
    prior, prior_ref = historical(PRIOR, "docs/catalog-baseline-20261101/MANDATORY-CHECKS.json")
    original, original_ref = historical(PRIOR, "docs/workflow-automation-addition-20261031/MANDATORY-CHECKS.json")
    records = (original, prior)
    refs = (original_ref, prior_ref)
    paths = list(dict.fromkeys((*sales.CODE_FILES, *workflow.CODE_FILES)))
    sources = {name: workflow.common.sha(ROOT / name) for name in paths}
    settings_path = "backend/teruisi_backend/settings.py"
    supplemental = {settings_path: workflow.common.sha(ROOT / settings_path)}
    syntax = {}
    for kind, extension in (("python", ".py"), ("node", ".mjs"), ("powershell", ".ps1")):
        selected = [p for p in paths if Path(p).suffix == extension or (kind == "powershell" and p.endswith(".psm1"))]
        if kind == "python":
            selected.append(settings_path)
        checked = []
        for name in selected:
            expected = sources.get(name, supplemental.get(name))
            reusable = any(record["syntax"][kind]["status"] == "passed"
                           and name in record["syntax"][kind]["files"]
                           and {**record["sourceFiles"], **record["supplementalSourceFiles"]}.get(name) == expected
                           for record in records)
            if reusable:
                continue
            if kind == "python":
                compile((ROOT / name).read_bytes(), name, "exec", dont_inherit=True)
            elif kind == "node":
                run("node", "--check", name)
            else:
                raise ValueError("Changed PowerShell bytes need their own check: " + name)
            checked.append(name)
        syntax[kind] = {"status": "passed", "checkedNow": checked,
                        "reuse": "Other members of this language have identical SHA in referenced prior syntax files"}
    for name in paths:
        if name.endswith(".json"):
            workflow.common.read(ROOT / name)
    # New lightweight source tooling is outside the runtime CODE_FILES set.
    for name in ("tools/check_catalog_baselines.py", "tests/catalog-baselines.py", str(Path(__file__).relative_to(ROOT))):
        compile((ROOT / name).read_bytes(), name, "exec", dont_inherit=True)
    # The complete backend (migrations, models and settings) is unchanged.
    if run("git", "diff", PRIOR, "--", "backend").strip():
        raise ValueError("Backend differs; cannot reuse migration closure")
    migration_sha = workflow.common.digest(workflow.common.migrations(ROOT))
    assert migration_sha == prior["migrationSha256"]
    assert supplemental[settings_path] == prior["supplementalSourceFiles"][settings_path]
    assert workflow.FILES == prior["migrationClosure"]["stepFiles"]
    assert prior["migrationClosure"]["status"] == "passed"
    pg, pg_ref = historical(PRIOR, "docs/catalog-baseline-20261101/SYNTHETIC-COLLECTOR.json")
    assert pg["status"] == "passed"
    assert all(workflow.common.sha(ROOT / name) == digest for name, digest in pg["sourceFiles"].items())
    assert sources == {name: workflow.common.sha(ROOT / name) for name in paths}
    at = datetime.now(timezone.utc).isoformat()
    output = []
    for gate, stem, recipe_name in ((sales, "sales154", "sales-0012"), (workflow, "workflow156", "workflow-0009")):
        recipe_path = ROOT / ("config/main-schema-releases/" + recipe_name + ".json")
        recipe = json.loads(recipe_path.read_bytes())
        proof = json.loads((ROOT / recipe["validation"]).read_bytes())
        evidence = {"version": "teruisi-schema-mandatory-code-execution-v1", "checkedAt": at,
                    "baseCommit": run("git", "rev-parse", "HEAD").decode().strip(),
                    "productionTouched": False, "functionalValidationPerformed": False,
                    "fullBackupOrRestorePerformed": False, "codeSha256": gate.code_digest(ROOT),
                    "migrationSha256": migration_sha, "checks": sorted(gate.CHECKS),
                    "sourceFiles": {name: sources[name] for name in gate.CODE_FILES},
                    "supplementalSourceFiles": supplemental, "syntax": syntax,
                    "reusedSyntaxEvidence": list(refs),
                    "migrationClosure": {"status": "passed", "method": "reused identical backend and migration inventory",
                                         "evidence": prior_ref, "migrationSha256": migration_sha},
                    "reusedCollectorEvidence": pg_ref,
                    "executionScriptSha256": sha(Path(__file__).read_bytes())}
        evidence_path, evidence_sha = write(stem + "-execution.json", evidence)
        proof.update(checkedAt=at, codeSha256=evidence["codeSha256"], migrationSha256=migration_sha,
                     checks=sorted(gate.CHECKS), evidence={"path": evidence_path, "sha256": evidence_sha})
        proof.pop("catalogBaseline", None)
        proof_path, proof_sha = write(stem + "-checks.json", proof)
        recipe.update(validation=proof_path, validationSha256=proof_sha, codeSha256=evidence["codeSha256"])
        recipe_path.write_text(json.dumps(recipe, ensure_ascii=True, indent=2) + "\n", encoding="utf8", newline="\n")
        output.append({"recipe": recipe_name, "codeSha256": recipe["codeSha256"]})
    print(json.dumps({"status": "bound", "recipes": output, "checkedNow": {k: v["checkedNow"] for k, v in syntax.items()}}))


if __name__ == "__main__":
    main()
