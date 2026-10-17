"""Bind a reviewed 0017 recipe to one frozen source and installed147 parent.

This preparation tool only reads files. It never creates a database connection,
reads production credentials, changes schema, or changes lifecycle state.
"""
import argparse
import json
from pathlib import Path
import sys

import tmall_warehouse_addition as gate


def relative(root, name):
    if (not isinstance(name, str) or "\\" in name or ":" in name
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
            or recipe["additionKind"] != "TmallWarehouse"
            or type(recipe["fromGeneration"]) is not int or recipe["fromGeneration"] not in (147, 148)
            or type(recipe["toGeneration"]) is not int or recipe["toGeneration"] != 149
            or recipe["steps"] != list(steps) or recipe["stepFiles"] != files):
        raise ValueError("Only the reviewed147-to149 structure recipe is supported")
    validation = relative(root, recipe["validation"])
    proof = gate.common.read(validation, recipe["validationSha256"])
    code_sha = gate.code_digest(root)
    migration_sha = gate.source_delta(root, runtime / "app")
    actual_generation = 148 if next(iter(gate.MONITORING_FILES)) in gate.common.migrations(runtime / "app") else 147
    if recipe["fromGeneration"] != actual_generation:
        raise ValueError("Recipe predecessor generation differs from installed source")
    if (recipe["codeSha256"] != code_sha
            or proof.get("version") != "tmall-warehouse-private-postgres-v1"
            or proof.get("status") != "passed" or proof.get("productionTouched") is not False
            or proof.get("generations") != [147, 148, 149]
            or proof.get("parentVariants") != [[147, 149], [148, 149]]
            or proof.get("fullBackupOrRestorePerformed") is not False
            or proof.get("codeSha256") != code_sha or proof.get("migrationSha256") != migration_sha
            or proof.get("steps") != list(gate.STEPS) or set(proof.get("checks", [])) != gate.CHECKS):
        raise ValueError("Bound private PostgreSQL proof does not cover these exact installer bytes")
    if full_parent:
        base, parent_sha = gate.parent_proof(runtime, runtime / "app")
    else:
        # This is only a comparison with a previously frozen evidence SHA.
        # PrepareApp/Plan/Install/Finalize still do their full native proofs.
        owner = gate.monitoring_parent if actual_generation == 148 else gate.parent
        parent_sha = gate.common.sha(runtime / owner.ACTIVE)
    return {"version": gate.VERSION, "status": "reviewed",
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
                or value["status"] != "reviewed" or value["databasePolicy"] != gate.POLICY):
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
    return {"status": "bound", "generation": 149, "check": "frozen-inputs-unchanged" if check else "parent-chain-bound",
            "evidenceSha256": gate.common.sha(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("source", "runtime", "recipe", "output", "check", "evidence-sha"):
        parser.add_argument("--" + name, default="")
    args = parser.parse_args()
    try:
        root, runtime = Path(args.source).absolute(), Path(args.runtime).absolute()
        if runtime != Path(r"D:\teruisi-runtime\django-sales"):
            raise ValueError("Fixed structure-release runtime required")
        recipe = Path(args.recipe).absolute()
        if recipe not in (root / "config/main-schema-releases/inventory-0017.json", root / "config/main-schema-releases/inventory-0017-from148.json"):
            raise ValueError("Fixed reviewed recipe path required")
        output = root.parent / "schema/inventory-0017-evidence.json"
        if Path(args.check or args.output).absolute() != output:
            raise ValueError("Evidence must belong to this frozen source packet")
        print(json.dumps(bind(root, runtime, recipe, output, bool(args.check), args.evidence_sha)))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
