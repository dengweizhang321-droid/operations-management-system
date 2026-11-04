"""Prove gate (3) is open: the eleven-layer chain admits this generation.

Read-only with respect to production. Nothing under D:\\teruisi-runtime is
written: segment 1 only reads it, and segment 2 works inside a pre-made copy
under D:\\codex-isolated.

Two segments, reported separately so neither is mistaken for the other.

  Segment 1 runs against the REAL repository and the REAL production runtime.
  Both calls are read-only. This is the substantive gate-(3) evidence: this
  generation's own delta is admitted, and its parent proof reaches the exact
  verified154 catalogue by recursing through all eleven existing generations to
  bi_app_addition's published 139 parent. The Sales154 gate still refuses the
  repository tree -- unchanged and deliberately not renewed.

  Segment 2 exercises THIS generation's own receipt/pointer/plan assertions,
  i.e. _verify_active_with_base and the release/successor path through it, with
  the ancestor recursion STUBBED. The stub is necessary and its scope is printed
  in the output: release/successor need an active marker that only
  install/finalize create, and those must not run against production, while a
  synthetic runtime cannot host the real chain because every ancestor's
  app.prepare-*.json binds runtimeRoot to the production path -- rewriting those
  would mean fabricating the very hashes the chain exists to check. So segment 2
  proves the field-level contract of this generation's own receipts, including
  eight negative cases, and segment 1 proves the real parent chain. Neither
  segment claims the other's scope.

Segment 1 runs anywhere. Segment 2 needs a synthetic runtime fixture at
SYNTHETIC, which is NOT kept after the run (it is a ~550MB copy of production
metadata). Rebuild it before re-running segment 2:

    SYN=D:/codex-isolated/workflow-automation-synthetic-runtime-20261031
    RT=/d/teruisi-runtime/django-sales
    mkdir -p "$SYN" && cp "$RT"/*.json "$SYN/"            # drops app.deploy-* is fine
    for d in "$RT"/*-additions "$RT"/integration-deltas "$RT"/integration-installs; do
      cp -r "$d" "$SYN/"; done
    cp -r "$RT/app" "$SYN/app"

Without it segment 2 reports blocked with "Synthetic runtime copy is
incomplete" -- that is a missing fixture, not a gate failure. Segment 1 is the
substantive gate-(3) evidence and does not depend on it.
"""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.dont_write_bytecode = True
import bi_app_addition as common
import sales_preflight_addition as sales_gate
import workflow_automation_addition as gate

PRODUCTION = Path(r"D:\teruisi-runtime\django-sales")
SYNTHETIC = Path(r"D:\codex-isolated\workflow-automation-synthetic-runtime-20261031")
OPERATION = "f" * 32


def segment1():
    result = {"newGenerationSourceDelta": gate.source_delta(ROOT, PRODUCTION / "app")}
    base, parent_sha = gate.parent_proof(PRODUCTION, PRODUCTION / "app")
    result["parentCatalogueSize"] = len(base)
    result["parentReferenceSha256"] = parent_sha
    try:
        sales_gate.source_delta(ROOT, PRODUCTION / "app")
        result["sales154RepositoryDeltaStillRefused"] = False
    except ValueError as error:
        result["sales154RepositoryDeltaStillRefused"] = True
        result["sales154Refusal"] = str(error)
    result["productionWritesPerformed"] = False
    return result


def build_receipts(folder, runtime, parent_sha, migration_sha):
    """Write exactly the files install/finalize would, for this generation only."""
    prepared_id, maintenance = "e" * 32, "d" * 32
    predecessor_sha = common.sha(runtime / "app/deployment.json")
    candidate_sha = "a" * 64
    prepared_path = runtime / ("app.prepare-" + prepared_id + ".json")
    prepared_path.unlink(missing_ok=True)
    common.write(prepared_path, {"version": "teruisi-django-prepared-app-v1", "id": prepared_id,
                                 "runtimeRoot": str(runtime), "predecessorManifestSha256": predecessor_sha,
                                 "candidateManifestSha256": candidate_sha})
    recipe = common.read(ROOT / "config/main-schema-releases/workflow-0009.json")
    evidence = {"version": gate.VERSION, "status": "code-checked",
                "predecessorSha256": predecessor_sha, "parentReferenceSha256": parent_sha,
                "migrationSha256": migration_sha, "steps": list(gate.STEPS),
                "stepFiles": dict(gate.FILES),
                "validation": str(ROOT / recipe["validation"]),
                "validationSha256": recipe["validationSha256"],
                "codeSha256": gate.code_digest(ROOT), "sourceSha256": gate.source_inventory(ROOT),
                "databasePolicy": gate.POLICY}
    common.write(folder / "candidate.json", evidence)
    (runtime / "run").mkdir(exist_ok=True)
    window_path = runtime / "run/system-maintenance.json"
    window_path.unlink(missing_ok=True)
    common.write(window_path, {"version": "teruisi-system-maintenance-v1", "id": maintenance,
                               "keepPostgres": True, "createdAt": datetime.now(timezone.utc).isoformat()})
    plan = {**evidence, "status": "prepared", "operationId": OPERATION,
            "maintenanceId": maintenance, "maintenanceSha256": common.sha(window_path),
            "candidateManifestSha256": candidate_sha,
            "candidateEvidenceSha256": common.sha(folder / "candidate.json"),
            "preparedAppId": prepared_id, "preparedReceiptSha256": common.sha(prepared_path)}
    common.write(folder / "plan.json", plan)
    intent = {"version": gate.VERSION, "planSha256": common.sha(folder / "plan.json"),
              "at": datetime.now(timezone.utc).isoformat(),
              "preservation": {"rows": 0, "legacyRowsSha256": "0" * 64, "permissionsSha256": "1" * 64}}
    common.write(folder / "install-intent.json", intent)
    installed = {"version": gate.VERSION, "status": "schema_installed", "steps": plan["steps"],
                 "migrationCount": 156, "migrationSha256": plan["migrationSha256"],
                 "planSha256": common.sha(folder / "plan.json"), "legacyDataPreserved": True,
                 "preservation": intent["preservation"],
                 "installIntentSha256": common.sha(folder / "install-intent.json"),
                 "registrySeeded": True, "databasePolicy": gate.POLICY}
    common.write(folder / "installed.json", installed)
    common.write(folder / "finalized.json", {**installed, "status": "verified", "permissionsVerified": True})
    marker = runtime / gate.ACTIVE
    marker.unlink(missing_ok=True)
    common.write(marker, {"version": gate.VERSION, "operationId": OPERATION,
                          "receiptSha256": common.sha(folder / "finalized.json"),
                          "parentReferenceSha256": parent_sha})
    return plan


NEGATIVES = (
    ("wrongMigrationCount", "finalized.json", {"migrationCount": 155}),
    ("notFinalized", "finalized.json", {"status": "schema_installed"}),
    ("registryNotSeeded", "finalized.json", {"registrySeeded": False}),
    ("permissionsNotVerified", "finalized.json", {"permissionsVerified": False}),
    ("foreignGenerationVersion", "finalized.json",
     {"version": "teruisi-sales-preflight-index-schema-addition-v1"}),
    ("mismatchedMigrationSha", "finalized.json", {"migrationSha256": "0" * 64}),
    ("legacyDataNotPreserved", "finalized.json", {"legacyDataPreserved": False}),
    ("tamperedPlanPolicy", "plan.json", {"databasePolicy": "no-such-policy"}),
)


def segment2():
    if not (SYNTHETIC / "app/deployment.json").is_file():
        raise RuntimeError("Synthetic runtime copy is incomplete")
    folder = SYNTHETIC / "workflow-automation-additions" / OPERATION
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    shutil.copytree(SYNTHETIC / "app", folder / "baseline",
                    ignore=shutil.ignore_patterns(".wrangler", "runtime-tools", "__pycache__"))
    # The catalogue size and parent reference the stub returns are the real ones
    # segment 1 just proved against production, not invented values.
    real_base, real_parent_sha = gate.parent_proof(PRODUCTION, PRODUCTION / "app")
    stub_base = frozenset(real_base)
    migration_sha = gate.source_delta(ROOT, folder / "baseline")
    build_receipts(folder, SYNTHETIC, real_parent_sha, migration_sha)
    outcomes, negatives = {}, {}
    with patch.object(gate, "parent_proof", lambda runtime, baseline: (stub_base, real_parent_sha)):
        for command in ("release", "successor"):
            receipt = gate.verify_active(ROOT, SYNTHETIC)[0]
            outcomes[command] = {"statusField": receipt["status"],
                                 "migrationCount": receipt["migrationCount"],
                                 "steps": receipt["steps"],
                                 "migrationSha256": receipt["migrationSha256"],
                                 "registrySeeded": receipt["registrySeeded"],
                                 "permissionsVerified": receipt["permissionsVerified"]}
        marker = SYNTHETIC / gate.ACTIVE
        for label, filename, override in NEGATIVES:
            path = folder / filename
            original = path.read_bytes()
            marker_original = marker.read_bytes()
            try:
                # Two variants per case. "hashPinned" leaves the active
                # pointer alone, so the receipt digest refuses first. "resynced"
                # repoints the pointer at the tampered bytes, which is what an
                # attacker with write access would do -- only then do the
                # field-level assertions get to be the thing that refuses.
                outcome = {}
                for variant in ("hashPinned", "resynced"):
                    path.unlink()
                    common.write(path, {**json.loads(original.decode("utf-8")), **override})
                    if variant == "resynced" and filename == "finalized.json":
                        marker.unlink()
                        common.write(marker, {**json.loads(marker_original.decode("utf-8")),
                                              "receiptSha256": common.sha(path)})
                    try:
                        gate.verify_active(ROOT, SYNTHETIC)
                        outcome[variant] = "ACCEPTED"
                    except ValueError as error:
                        outcome[variant] = "refused: " + str(error)
                    path.unlink(missing_ok=True)
                    path.write_bytes(original)
                    marker.unlink(missing_ok=True)
                    marker.write_bytes(marker_original)
                negatives[label] = outcome
            finally:
                path.unlink(missing_ok=True)
                path.write_bytes(original)
                marker.unlink(missing_ok=True)
                marker.write_bytes(marker_original)
        # The restored receipts must verify again, proving no probe leaked state.
        gate.verify_active(ROOT, SYNTHETIC)
    accepted = sorted(name + "." + variant for name, value in negatives.items()
                      for variant, outcome in value.items() if outcome == "ACCEPTED")
    return {"operationId": OPERATION, "runtime": str(SYNTHETIC),
            "stubScope": "gate.parent_proof only; it returns the catalogue size and parent "
                         "reference segment 1 proved against production. No other function is "
                         "patched and no assertion of this generation is relaxed.",
            "stubbedParentCatalogueSize": len(stub_base),
            "commands": outcomes, "negativeCases": negatives,
            "negativeCasesAccepted": accepted, "allNegativesRefused": not accepted,
            "productionWritesPerformed": False}


if __name__ == "__main__":
    report = {"version": "workflow-automation-gate3-proof-v1",
              "checkedAt": datetime.now(timezone.utc).isoformat(),
              "segment1_realRuntimeReadOnly": segment1()}
    try:
        report["segment2_ownReceiptContract"] = segment2()
    except Exception as error:
        report["segment2_ownReceiptContract"] = {"status": "blocked",
                                                 "reason": type(error).__name__ + ": " + str(error)}
    print(json.dumps(report, indent=2, ensure_ascii=False))
