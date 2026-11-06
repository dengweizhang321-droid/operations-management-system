"""Bind the reviewed AI159 recipe to one frozen source and installed158 parent.

This preparation tool only reads files. It never creates a database connection,
reads production credentials, changes schema, or changes lifecycle state.
"""
import argparse
import json
from pathlib import Path
import sys

import ai_unified_tasks_addition as gate


def relative(root, name):
    if (not isinstance(name, str) or not name or name.startswith("/") or "\\" in name or ":" in name
            or Path(name).is_absolute() or any(part in {".", ".."} for part in name.split("/"))):
        raise ValueError("Unsafe schema recipe reference")
    return root / name


FIELDS = {"version", "status", "predecessorSha256", "parentReferenceSha256", "migrationSha256",
          "steps", "stepFiles", "validation", "validationSha256", "codeSha256", "sourceSha256", "databasePolicy"}


def candidate(root, runtime, recipe_path, *, full_parent=True):
    recipe = gate.common.read(recipe_path)
    steps, files = gate.steps_files(recipe.get("fromGeneration"))
    expected = {"version", "additionKind", "fromGeneration", "toGeneration", "steps", "stepFiles",
                "validation", "validationSha256", "codeSha256"}
    if (type(recipe) is not dict or set(recipe) != expected
            or recipe["version"] != "teruisi-main-schema-recipe-v1"
            or recipe["additionKind"] != "AiUnifiedTasks"
            or type(recipe["fromGeneration"]) is not int or recipe["fromGeneration"] != 158
            or type(recipe["toGeneration"]) is not int or recipe["toGeneration"] != 159
            or recipe["steps"] != list(steps) or recipe["stepFiles"] != files):
        raise ValueError("Only the reviewed158-to159 structure recipe is supported")
    validation = relative(root, recipe["validation"])
    proof = gate.common.read(validation, recipe["validationSha256"])
    code_sha = gate.code_digest(root)
    migration_sha = gate.source_delta(root, runtime / "app")
    if (recipe["codeSha256"] != code_sha
            or proof.get("version") != "ai-unified-tasks-mandatory-code-checks-v1"
            or proof.get("status") != "code-checked" or proof.get("productionTouched") is not False or proof.get("functionalValidationPerformed") is not False
            or proof.get("generations") != [158, 159]
            or proof.get("parentVariants") != [[158, 159]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != code_sha or proof.get("migrationSha256") != migration_sha
            or proof.get("steps") != list(gate.STEPS) or set(proof.get("checks", [])) != gate.CHECKS):
        raise ValueError("Bound mandatory code checks do not cover these exact installer bytes")
    gate.verify_structure_evidence(root, proof)
    if full_parent:
        base, parent_sha = gate.parent_proof(runtime, runtime / "app")
    else:
        # This is only a comparison with a previously frozen evidence SHA.
        # PrepareApp/Plan/Install/Finalize still do their full native proofs.
        parent_sha = gate.common.sha(runtime / gate.parent.ACTIVE)
    return {"version": gate.VERSION, "status": "code-checked",
        "predecessorSha256": gate.common.sha(runtime / "app/deployment.json"),
        "parentReferenceSha256": parent_sha, "migrationSha256": migration_sha,
        "steps": list(steps), "stepFiles": files,
        "validation": str(validation), "validationSha256": recipe["validationSha256"],
        "codeSha256": code_sha, "sourceSha256": gate.source_inventory(root),
        "databasePolicy": gate.POLICY}


def bind(root, runtime, recipe, output, check=False, evidence_sha=None):
    if check:
        if not isinstance(evidence_sha, str) or not gate.common.HEX.fullmatch(evidence_sha):
            raise ValueError("Exact evidence SHA is required")
        value = gate.common.read(output, evidence_sha)
        if (type(value) is not dict or set(value) != FIELDS or value["version"] != gate.VERSION
                or value["status"] != "code-checked" or value["databasePolicy"] != gate.POLICY):
            raise ValueError("Frozen structure evidence identity is invalid")
        expected = candidate(root, runtime, recipe, full_parent=False)
        if value != expected:
            raise ValueError("Original structure evidence no longer matches its predecessor or source")
    else:
        expected = candidate(root, runtime, recipe)
        if output.exists():
            if gate.common.read(output) != expected:
                raise ValueError("Frozen structure evidence changed; original record is preserved")
        else:
            gate.common.write(output, expected)
    return {"status": "bound", "generation": 159, "check": "frozen-inputs-unchanged" if check else "parent-chain-bound",
            "evidenceSha256": gate.common.sha(output)}


def main(args):
    root, runtime = Path(args.source).absolute(), Path(args.runtime).absolute()
    if runtime != Path(r"D:\teruisi-runtime\django-sales"):
        raise ValueError("Fixed structure-release runtime required")
    recipe = Path(args.recipe).absolute()
    if recipe != root / "config/main-schema-releases/ai-0090.json":
        raise ValueError("Fixed reviewed recipe path required")
    output = root.parent / "schema/ai-0090-evidence.json"
    if Path(args.check or args.output).absolute() != output:
        raise ValueError("Evidence must belong to this frozen source packet")
    return bind(root, runtime, recipe, output, bool(args.check), args.evidence_sha)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("source", "runtime", "recipe", "output", "check", "evidence-sha"):
        parser.add_argument("--" + name, default="")
    try:
        print(json.dumps(main(parser.parse_args())))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
