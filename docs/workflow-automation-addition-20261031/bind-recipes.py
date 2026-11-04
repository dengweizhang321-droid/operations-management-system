"""Write both recipes and both proofs from the actual gates. Read-only on code.

Run after run-mandatory-checks.py. This only computes digests and writes the
recipe/proof JSON; it never binds a candidate, touches a database, reads
credentials or changes lifecycle state. Every value is computed here, never
transcribed, so a stale hand-edited digest cannot survive a re-run.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
sys.dont_write_bytecode = True
import sales_preflight_addition as sales_gate
import workflow_automation_addition as gate


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, value):
    Path(path).write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def main():
    migration_sha = gate.common.digest(gate.common.migrations(ROOT))
    checked_at = datetime.now(timezone.utc).isoformat()

    # This generation's own chain.
    evidence = OUT / "MANDATORY-CHECKS.json"
    proof = {"version": "workflow-automation-mandatory-code-checks-v1", "status": "code-checked",
             "checkedAt": checked_at, "productionTouched": False,
             "functionalValidationPerformed": False, "steps": list(gate.STEPS),
             "generations": [154, 156], "parentVariants": [[154, 156]],
             "fullBackupOrRestorePerformed": False,
             "codeSha256": gate.code_digest(ROOT), "migrationSha256": migration_sha,
             "checks": sorted(gate.CHECKS),
             "evidence": {"path": evidence.relative_to(ROOT).as_posix(), "sha256": sha(evidence)}}
    proof_path = OUT / "workflow156-mandatory-code-checks.json"
    dump(proof_path, proof)
    recipe = {"version": "teruisi-main-schema-recipe-v1", "additionKind": "WorkflowAutomation",
              "fromGeneration": 154, "toGeneration": 156, "steps": list(gate.STEPS),
              "stepFiles": dict(gate.FILES),
              "validation": proof_path.relative_to(ROOT).as_posix(),
              "validationSha256": sha(proof_path), "codeSha256": proof["codeSha256"]}
    dump(ROOT / "config/main-schema-releases/workflow-0009.json", recipe)

    # The Sales154 cascade: six of this change's files are members of its
    # CODE_FILES too, so its digest moves even though that generation is
    # untouched. Following the pattern the CI fix established, a NEW evidence
    # file is produced and the proof is repointed at it; the previous evidence
    # file keeps its bytes and simply loses its last reference.
    sales_evidence = OUT / "MANDATORY-CHECKS-SALES154.json"
    sales_proof_path = ROOT / "docs/jackyun-sales-preflight-20261029/sales154-mandatory-code-checks.json"
    sales_proof = json.loads(sales_proof_path.read_text(encoding="utf-8-sig"))
    sales_proof["codeSha256"] = sales_gate.code_digest(ROOT)
    sales_proof["migrationSha256"] = migration_sha
    sales_proof["evidence"] = {"path": sales_evidence.relative_to(ROOT).as_posix(),
                               "sha256": sha(sales_evidence)}
    dump(sales_proof_path, sales_proof)
    sales_recipe_path = ROOT / "config/main-schema-releases/sales-0012.json"
    sales_recipe = json.loads(sales_recipe_path.read_text(encoding="utf-8-sig"))
    sales_recipe["codeSha256"] = sales_proof["codeSha256"]
    sales_recipe["validationSha256"] = sha(sales_proof_path)
    dump(sales_recipe_path, sales_recipe)

    print(json.dumps({"status": "bound",
                      "workflow": {"codeSha256": recipe["codeSha256"],
                                   "validationSha256": recipe["validationSha256"],
                                   "evidenceSha256": proof["evidence"]["sha256"]},
                      "sales154": {"codeSha256": sales_recipe["codeSha256"],
                                   "validationSha256": sales_recipe["validationSha256"],
                                   "evidenceSha256": sales_proof["evidence"]["sha256"]},
                      "migrationSha256": migration_sha}, indent=2))


if __name__ == "__main__":
    main()
