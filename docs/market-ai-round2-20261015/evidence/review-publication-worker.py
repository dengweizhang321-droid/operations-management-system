"""Read-only exact final Worker/plan/source-binding and publisher verification."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).parent
OUT = Path("D:/codex-artifacts/market-ai-round2-20261015")
RUNTIME = Path("D:/teruisi-runtime/teruisi-worker-sales")
sha = lambda raw: hashlib.sha256(raw).hexdigest()
read_json = lambda path: json.loads(path.read_text(encoding="utf-8-sig"))
result = read_json(OUT / "worker-final-plan-result.json")
assert result["status"] == "planned"
assert result["planSha256"] == "3475f5b7b1a7c267da78e08fa19f028d385f918a0f7bd2373c1b444056f31736"
plan_path = Path(result["planPath"])
plan_raw = plan_path.read_bytes()
assert sha(plan_raw) == result["planSha256"]
assert Path(str(plan_path) + ".sha256").read_bytes() == (result["planSha256"] + "\n").encode("ascii")
plan = json.loads(plan_raw)
release = RUNTIME / "releases" / result["candidateReleaseId"]
manifest_raw = (release / "deployment-manifest.json").read_bytes()
guard_raw = (release / "audit/legacy-worker-guard-receipt.json").read_bytes()
manifest, guard = json.loads(manifest_raw), json.loads(guard_raw)
assert sha(manifest_raw) == result["candidateManifestSha256"] == plan["candidate"]["manifestSha256"]
assert sha(guard_raw) == result["candidateGuardReceiptSha256"] == plan["candidate"]["guardReceiptSha256"]
assert manifest["releaseId"] == result["candidateReleaseId"] == "20261014T202834Z-1943995b435ba5c7"
binding_raw = (OUT / "source-binding-final.json").read_bytes()
binding = json.loads(binding_raw)
assert sha(binding_raw) == manifest["source"]["sourceBinding"]["sha256"]
assert manifest["source"]["sourceBinding"]["raw"].encode("utf-8") == binding_raw
assert plan["sourceBinding"]["sha256"] == sha(binding_raw)
assert binding["predecessor"] == plan["predecessor"]
assert binding["predecessorChainStateSha256"] == plan["predecessorChainStateSha256"]
assert manifest["source"]["tree"] == binding["identity"]["sourceTree"]
assert guard["sourceFingerprint"] == manifest["source"]["sourceFingerprint"] == binding["identity"]["sourceTree"]["sha256"]
tool = "tools/worker-local-release-rotation.mjs"
expected_tool = "7dd49103f5b672dae484d3b5e70207d6644657701a5b6be23c85203cad62b72f"
guard_rows = {row["relativePath"]: row["sha256"] for row in guard["entrypoints"]}
assert guard_rows[tool] == expected_tool
assert sha((release / "source-snapshot" / tool).read_bytes()) == expected_tool
entry = next(row for row in plan["protectedEntrypoints"] if row["relativePath"] == tool)
assert entry["candidateSha256"] == expected_tool and entry["predecessorSha256"] == "ec5254ee24eed93639c2a819037b41356ea6351e7f22c0ba71402b0edc6b1f3a"
frozen = read_json(release / "source-snapshot/docs/market-ai-round2-20261015/evidence/final-application-source.json")
for path, expected in frozen["files"].items():
    assert sha((release / "source-snapshot" / path).read_bytes()) == expected, path
ready = read_json(OUT / "GUARDED_PREPARE_READY.json")
assert ready["guardOriginalRestored"] is True and ready["noApplyCalled"] is True
assert ready["workerPlanSha256"] == result["planSha256"]
assert ready["sourceCommit"] == "d3c664cd18ada5eaf6a5a1d376e4681db47919ca"
assert ready["workerCandidate"] == manifest["releaseId"] and ready["djangoPreparedId"] == "722fdc383e98498f898e135b5d10edbb"
assert sha(Path("D:/运营管理系统/tools/worker-local-release-rotation.mjs").read_bytes()) == expected_tool
publisher_bytes = (OUT / "publish.mjs").read_bytes()
publisher = publisher_bytes.decode("utf-8-sig")
lease_start = publisher.index("await rotation.withRotationLock(async rotationLease=>{")
first_effect = min(publisher.index("await writeOnce(out+'/PUBLICATION_STARTED.json'"), publisher.index("await writeOnce(out+'/publication-guard-restore-started.json'"))
assert lease_start < publisher.index("await rotation.assertActiveBatchOwnership(api.workerRuntimeRoot);", lease_start) < first_effect
assert publisher.index("await run('DeployApp'") < publisher.index("await rotation.applyApprovedRotationPlan")
assert publisher.index("await rotation.applyApprovedRotationPlan") < publisher.index("await run('ExitMaintenance'") < publisher.index("await run('Start'")
summary = {"workerRelease": manifest["releaseId"], "manifestSha256": sha(manifest_raw),
    "guardReceiptSha256": sha(guard_raw), "planSha256": sha(plan_raw), "sourceBindingSha256": sha(binding_raw),
    "sourceCommit": ready["sourceCommit"], "sourceTree": manifest["source"]["tree"],
    "candidateToolExactlyPreservesUserBytes": True, "reviewedApplicationSourcesEqual": len(frozen["files"]),
    "prepareRootOriginalRestored": True, "publisherSha256": sha(publisher_bytes),
    "earlyOriginalOwnerFence": True, "preparationOnlyNoApply": True,
    "productionWritesByReviewer": 0, "readyForAuthorizedSwitch": True}
(EVIDENCE / "review-publication-worker-result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary))
