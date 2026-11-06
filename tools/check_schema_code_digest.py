"""Read-only recipe byte bindings, using the real candidate's gate.code_digest.

This is a source check, not candidate binding, lifecycle/parent verification,
database admission, or proof that the declared checks were executed. Only the
explicit --recipe selections are checked; historical recipes are not renewed.
Run with a private Python containing the repository-pinned psycopg dependency.
"""
import argparse
import importlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True

# The finite candidate mapping mirrors main-schema-release.mjs. It selects an
# actual module, never parses or reconstructs its inherited CODE_FILES tuple.
SPECS = {
    "JdProductMonitoring": ("jd_product_monitoring_candidate", (147,), 148, None),
    "TmallWarehouse": ("tmall_warehouse_candidate", (147, 148), 149, None),
    "PiAgent": ("pi_agent_candidate", (149,), 150, None),
    "PiWorkspace": ("pi_workspace_candidate", (150,), 151, None),
    "PiBusiness": ("pi_business_candidate", (151,), 152, "pi-business-mandatory-code-checks-v1"),
    "PiNative": ("pi_native_candidate", (152,), 153, "pi-native-mandatory-code-checks-v1"),
    "SalesPreflightIndex": ("sales_preflight_candidate", (153,), 154,
                            "sales-preflight-index-mandatory-code-checks-v1"),
    "AiUnifiedTasks": ("ai_unified_tasks_candidate", (158,), 159,
                           "ai-unified-tasks-mandatory-code-checks-v1"),
    "AiTaskFeedbackCandidates": ("ai_task_feedback_candidates_candidate", (156,), 158,
                           "ai-task-feedback-candidates-mandatory-code-checks-v1"),
    "WorkflowAutomation": ("workflow_automation_candidate", (154,), 156,
                           "workflow-automation-mandatory-code-checks-v1"),
}
# These kinds additionally bind the execution material, so a proof-only digest
# edit cannot retain an old CHECKS source map. Earlier kinds predate that
# binding and keep their historical, weaker validation mode.
EXECUTION_MATERIAL_KINDS = {"SalesPreflightIndex", "WorkflowAutomation", "AiTaskFeedbackCandidates", "AiUnifiedTasks"}
RECIPE_FIELDS = {"version", "additionKind", "fromGeneration", "toGeneration", "steps",
                 "stepFiles", "validation", "validationSha256", "codeSha256"}


def relative(root, name):
    if (not isinstance(name, str) or not name or name.startswith("/")
            or "\\" in name or ":" in name
            or any(part in {"", ".", ".."} for part in name.split("/"))):
        raise ValueError("Unsafe repository-relative reference")
    result = root / name
    # Reject links in the complete path, as the native evidence reader does.
    if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)()
           for p in (result, *result.parents)):
        raise ValueError("Linked source reference")
    return result


def load_module(root, module_name):
    tools = root / "tools"
    if str(tools) not in sys.path:
        sys.path.insert(0, str(tools))
    module = importlib.import_module(module_name)
    if Path(module.__file__).resolve() != (tools / (module_name + ".py")).resolve():
        raise ValueError("Module import belongs to another source tree")
    return module


def load_candidate(root, kind):
    candidate = load_module(root, SPECS[kind][0])
    tools = root / "tools"
    if Path(candidate.gate.__file__).resolve().parent != tools.resolve():
        raise ValueError("Gate import belongs to another source tree")
    return candidate


def check_recipe(root, recipe_name):
    """Return detailed failures without ever calling candidate/bind/admission."""
    root = Path(root).absolute()
    result = {"recipe": recipe_name, "status": "failed", "errors": [],
              "scope": "static-source-bindings-only", "parentVerified": False,
              "databaseContacted": False, "declaredChecksExecuted": False}
    errors = result["errors"]

    def require(condition, message):
        if not condition:
            errors.append(message)

    try:
        recipe_path = relative(root, recipe_name)
        # Use the same duplicate-key/safe-file reader even before selecting gate.
        common = load_module(root, "bi_app_addition")
        recipe = common.read(recipe_path)
        if type(recipe) is not dict or set(recipe) != RECIPE_FIELDS:
            raise ValueError("Recipe fields differ from teruisi-main-schema-recipe-v1")
        require(recipe["version"] == "teruisi-main-schema-recipe-v1", "Recipe version differs")
        kind = recipe["additionKind"]
        if kind not in SPECS:
            raise ValueError("Unsupported finite recipe additionKind")
        candidate = load_candidate(root, kind)
        gate = candidate.gate
        _, from_generations, to_generation, proof_version = SPECS[kind]
        require(type(recipe["fromGeneration"]) is int
                and recipe["fromGeneration"] in from_generations, "Recipe fromGeneration differs")
        require(type(recipe["toGeneration"]) is int
                and recipe["toGeneration"] == to_generation, "Recipe toGeneration differs")
        if errors:
            return result
        steps, files = (gate.steps_files(recipe["fromGeneration"])
                        if hasattr(gate, "steps_files") else (gate.STEPS, gate.FILES))
        require(recipe["steps"] == list(steps), "Recipe steps differ from gate")
        require(recipe["stepFiles"] == files, "Recipe stepFiles differ from gate")
        # Real inherited tuple + real raw-byte hashes + real canonical digest.
        code_sha = gate.code_digest(root)
        migration_files = gate.common.migrations(root)
        migration_sha = gate.common.digest(migration_files)
        result.update({"additionKind": kind, "codeFileCount": len(gate.CODE_FILES),
                       "actualCodeSha256": code_sha, "actualMigrationSha256": migration_sha,
                       "migrationSourceFileCount": len(migration_files),
                       "migrationScope": "source-inventory-only; no installed-parent comparison",
                       "validationMode": "mandatory-code-contract" if proof_version
                       else "historical-bindings-only; historical rehearsal declarations not validated"})
        require(recipe["codeSha256"] == code_sha, "Recipe codeSha256 differs from gate.code_digest(root)")
        for name, expected in files.items():
            require(migration_files.get(name) == expected, "Migration step source differs: " + name)
        validation_path = relative(root, recipe["validation"])
        proof = common.read(validation_path)
        require(common.HEX.fullmatch(recipe["validationSha256"] or "") is not None,
                "Recipe validationSha256 is invalid")
        actual_validation_sha = common.sha(validation_path)
        result["actualValidationSha256"] = actual_validation_sha
        require(recipe["validationSha256"] == actual_validation_sha,
                "Recipe validationSha256 differs from validation bytes")
        if type(proof) is not dict:
            raise ValueError("Validation must be an object")
        require(proof.get("codeSha256") == code_sha, "Validation codeSha256 differs from gate.code_digest(root)")
        require(proof.get("codeSha256") == recipe["codeSha256"], "Recipe and validation codeSha256 differ")
        require(proof.get("migrationSha256") == migration_sha,
                "Validation migrationSha256 differs from source inventory")
        if proof_version:
            require(proof.get("version") == proof_version, "Mandatory proof version differs")
            require(proof.get("status") == "code-checked", "Mandatory proof status differs")
            for flag in ("productionTouched", "functionalValidationPerformed", "fullBackupOrRestorePerformed"):
                require(proof.get(flag) is False, "Mandatory proof " + flag + " must be false")
            generations = [recipe["fromGeneration"], recipe["toGeneration"]]
            require(proof.get("generations") == generations, "Mandatory proof generations differ")
            require(proof.get("parentVariants") == [generations], "Mandatory proof parentVariants differ")
            require(proof.get("steps") == list(gate.STEPS), "Mandatory proof steps differ")
            checks = proof.get("checks")
            require(type(checks) is list and all(type(c) is str for c in checks)
                    and len(checks) == len(gate.CHECKS) and set(checks) == gate.CHECKS,
                    "Mandatory proof checks differ")
        if kind in EXECUTION_MATERIAL_KINDS:
            # These records also bind the new execution material, preventing a
            # proof-only digest edit from retaining an old CHECKS source map.
            # The "Sales ..." message prefixes are kept verbatim: they are the
            # strings tests/schema-code-digest-static.py asserts on, and this
            # change widens which kinds reach the branch, not what it checks.
            reference = proof.get("evidence")
            if type(reference) is not dict or set(reference) != {"path", "sha256"}:
                raise ValueError("Sales evidence reference must contain path and sha256")
            evidence_path = relative(root, reference["path"])
            evidence = common.read(evidence_path)
            require(common.HEX.fullmatch(reference["sha256"] or "") is not None
                    and common.sha(evidence_path) == reference["sha256"],
                    "Sales evidence sha256 differs from referenced bytes")
            if type(evidence) is not dict:
                raise ValueError("Sales evidence must be an object")
            require(evidence.get("version") == "teruisi-schema-mandatory-code-execution-v1",
                    "Sales evidence version differs")
            require(evidence.get("codeSha256") == code_sha, "Sales evidence codeSha256 differs")
            require(evidence.get("migrationSha256") == migration_sha, "Sales evidence migrationSha256 differs")
            source_files = {name: gate.common.sha(root / name) for name in gate.CODE_FILES}
            require(evidence.get("sourceFiles") == source_files, "Sales evidence sourceFiles differ from actual gate members")
            for flag in ("productionTouched", "functionalValidationPerformed", "fullBackupOrRestorePerformed"):
                require(evidence.get(flag) is False, "Sales evidence " + flag + " must be false")
            checks = evidence.get("checks")
            require(type(checks) is list and all(type(c) is str for c in checks)
                    and len(checks) == len(gate.CHECKS) and set(checks) == gate.CHECKS,
                    "Sales evidence checks differ")
            syntax = evidence.get("syntax")
            require(type(syntax) is dict and all(type(syntax.get(name)) is dict
                    and syntax[name].get("status") == "passed"
                    for name in ("python", "node", "powershell")), "Sales evidence syntax status differs")
            closure = evidence.get("migrationClosure")
            require(type(closure) is dict and closure.get("status") == "passed",
                    "Sales evidence migrationClosure status differs")
            supplemental = evidence.get("supplementalSourceFiles")
            require(type(supplemental) is dict, "Sales evidence supplementalSourceFiles must be an object")
            if type(supplemental) is dict:
                require("backend/teruisi_backend/settings.py" in supplemental,
                        "Sales evidence supplementalSourceFiles missing required settings.py binding")
                result["supplementalSourceFileCount"] = len(supplemental)
                result["supplementalSourceScope"] = "additional evidence bindings; not gate.code_digest members"
                for name, expected in supplemental.items():
                    source = relative(root, name)
                    if (not source.is_file() or source.stat().st_nlink != 1
                            or source.stat().st_size > 16 * 1024 * 1024):
                        raise ValueError("Unsafe supplemental source file")
                    require(isinstance(expected, str) and common.HEX.fullmatch(expected) is not None
                            and common.sha(source) == expected,
                            "Sales evidence supplementalSourceFiles differs: " + name)
        if not errors:
            result["status"] = "passed"
    except (ValueError, TypeError, KeyError, OSError, ImportError) as error:
        errors.append(type(error).__name__ + ": " + str(error))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--recipe", action="append", required=True,
                        help="explicit repository-relative recipe; repeat to select more")
    args = parser.parse_args(argv)
    results = [check_recipe(args.root, name) for name in args.recipe]
    print(json.dumps({"version": "teruisi-schema-code-digest-static-v1", "results": results},
                     ensure_ascii=True, indent=2))
    return 0 if all(r["status"] == "passed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
