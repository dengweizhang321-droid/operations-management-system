"""Read-only final source/evidence binding verification for the independent review."""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).parent
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
resume = json.loads((EVIDENCE / "resume-source-manifest.json").read_text(encoding="utf-8"))
planning = json.loads((EVIDENCE / "planning-source-manifest.json").read_text(encoding="utf-8"))
checked = []
for row in resume + planning["files"]:
    actual = sha(ROOT / row["path"])
    assert actual == row["sha256"], (row["path"], actual, row["sha256"])
    checked.append({"path": row["path"], "sha256": actual})
source = (ROOT / "backend/market/annotations.py").read_text(encoding="utf-8")
tree = ast.parse(source)
for row in planning["integrationFunctions"]:
    node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == row["name"])
    actual = hashlib.sha256(ast.get_source_segment(source, node).encode("utf-8")).hexdigest()
    assert actual == row["sourceSha256"], (row["name"], actual, row["sourceSha256"])
extra = ["lib/market/annotation-model.ts", "backend/market/test_annotation_diagnostics_round2.py",
         "tests/market-vision-adapter.test.ts", "backend/market/tests/test_annotation_priority.py"]
checked.extend({"path": path, "sha256": sha(ROOT / path)} for path in extra)
bench = json.loads((EVIDENCE / "planning-benchmark.json").read_text(encoding="utf-8"))
for count in (200, 1000, 5000):
    pair = [row for row in bench["measurements"] if row["size"] == count]
    assert len(pair) == 2 and pair[0]["candidateDigest"] == pair[1]["candidateDigest"]
    assert all(row["returned"] == count and row["sqlCount"] > 0 and row["rolledBack"] for row in pair)
browser = json.loads((EVIDENCE / "browser-result.json").read_text(encoding="utf-8"))
assert browser["status"] == "passed" and len(browser["checks"]) == 6 and not browser["consoleErrors"]
assert browser["productionWrites"] == 0 and browser["realModelCalls"] == 0
result = {"baseline": planning["baseline"], "manifestBindingsMatched": True, "files": checked,
          "benchmarkHelperSha256": planning["benchmarkHelperSha256"],
          "finalHelperSha256": sha(ROOT / "backend/market/annotation_planning.py"),
          "benchmarkFrozenContentEquality": True, "browserCases": 6,
          "reviewExternalCalls": 0, "reviewProductionWrites": 0}
(EVIDENCE / "review-freeze-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({key: value for key, value in result.items() if key != "files"}, ensure_ascii=True))
