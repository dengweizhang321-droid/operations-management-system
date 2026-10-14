"""Independent read-only canonical payload/fingerprint comparison of final Django."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).parent
OUT = Path("D:/codex-artifacts/market-ai-round2-20261015")
RUNTIME = Path("D:/teruisi-runtime/django-sales")
SOURCE = Path("D:/codex-isolated/market-ai-round2-release-20261015/source")
sha = lambda raw: hashlib.sha256(raw).hexdigest()
report = json.loads((OUT / "DJANGO_FINAL_COMPARISON.json").read_text(encoding="utf-8"))
assert report["id"] == "722fdc383e98498f898e135b5d10edbb"
receipt_bytes = (RUNTIME / ("app.prepare-" + report["id"] + ".json")).read_bytes()
assert sha(receipt_bytes) == report["receiptSha256"]
receipt = json.loads(receipt_bytes.decode("utf-8-sig"))
old, new = RUNTIME / "app", RUNTIME / ("app.deploy-" + report["id"])
assert sha((old / "deployment.json").read_bytes()) == receipt["predecessorManifestSha256"]
new_manifest_bytes = (new / "deployment.json").read_bytes()
assert sha(new_manifest_bytes) == receipt["candidateManifestSha256"]
manifest = json.loads(new_manifest_bytes.decode("utf-8-sig"))
assert manifest["appFingerprint"] == report["appFingerprint"]

def payload(root):
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob("*")
            if path.is_file() and not {"__pycache__", ".pytest_cache", ".mypy_cache"}.intersection(path.parts)
            and path.suffix.lower() not in {".pyc", ".pyo"}}

before, after = payload(old), payload(new)
rows = [relative + "\n" + sha(raw) for relative, raw in after.items() if relative != "deployment.json"]
rows.sort(key=lambda row: row.encode("utf-16-be"))
assert len(rows) == manifest["fileCount"] == 2951
assert sha("\n".join(rows).encode("utf-8")) == manifest["appFingerprint"]
differences = [{"path": path, "beforeSha256": sha(before[path]) if path in before else None,
                "afterSha256": sha(after[path]) if path in after else None}
               for path in sorted(set(before) | set(after)) if before.get(path) != after.get(path)]
assert differences == report["differences"]
allowed = {"backend/market/annotations.py", "backend/market/views.py", "backend/market/annotation_planning.py",
           "backend/market/test_annotation_diagnostics_round2.py", "backend/market/test_annotation_planning_round2.py",
           "backend/market/test_annotation_resume_round2.py", "tools/worker-local-release-rotation.mjs",
           "deployment.json", ".wrangler/cache/cf.json"}
assert {row["path"] for row in differences} == allowed
for path in allowed - {"deployment.json", ".wrangler/cache/cf.json"}:
    assert after[path] == (SOURCE / path).read_bytes(), path
cf_leaves = []
def changed_leaves(left, right, path=""):
    assert type(left) is type(right), path
    if isinstance(left, dict):
        assert left.keys() == right.keys(), path
        for key in left:
            changed_leaves(left[key], right[key], path + "." + key if path else key)
    elif isinstance(left, list):
        assert len(left) == len(right), path
        for index, (a, b) in enumerate(zip(left, right)):
            changed_leaves(a, b, path + "." + str(index))
    elif left != right:
        cf_leaves.append(path)
changed_leaves(json.loads(before[".wrangler/cache/cf.json"]), json.loads(after[".wrangler/cache/cf.json"]))
assert cf_leaves == report["cfChangedLeaves"]
assert set(cf_leaves) == {"tlsClientRandom", "tlsExportedAuthenticator.clientHandshake",
    "tlsExportedAuthenticator.serverHandshake", "tlsExportedAuthenticator.clientFinished",
    "tlsExportedAuthenticator.serverFinished", "edgeL4.deliveryRate"}
result = {"preparedId": report["id"], "receiptSha256": sha(receipt_bytes),
    "candidateManifestSha256": sha(new_manifest_bytes), "appFingerprint": manifest["appFingerprint"],
    "canonicalFingerprintRecomputed": True, "fileCount": len(rows), "differences": differences,
    "cfChangedLeaves": cf_leaves, "cfShapeAndLeafTypesEqual": True, "migrationAndUnrelatedBytesEqual": True,
    "candidateSourceBytesEqual": True, "oldInstalledManifestUnchanged": True,
    "notDeployed": True, "workerCandidateNotYetReviewed": True, "productionWrites": 0}
(EVIDENCE / "review-publication-django-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({key: value for key, value in result.items() if key not in {"differences", "cfChangedLeaves"}}))
