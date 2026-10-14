"""Verify the final delivery-format delta without executing business code."""
import ast
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).parent
sha = lambda data: hashlib.sha256(data).hexdigest()
previous = json.loads(subprocess.check_output(["git", "cat-file", "blob",
    ":docs/market-ai-round2-20261015/evidence/review-freeze-result.json"], cwd=ROOT).decode("utf-8"))
previous_files = {row["path"]: row["sha256"] for row in previous["files"]}
test_path = "backend/market/test_annotation_resume_round2.py"
current_test = (ROOT / test_path).read_bytes()
reconstructed_previous_test = current_test.replace(b"\r\n", b"\n") + b"\n"
assert sha(reconstructed_previous_test) == previous_files[test_path]
assert ast.dump(ast.parse(current_test.decode("utf-8"))) == ast.dump(ast.parse(reconstructed_previous_test.decode("utf-8")))
applications = ["app/api/market/annotations/route.ts", "app/market-annotation-view.tsx",
    "backend/market/annotations.py", "backend/market/views.py", "backend/market/annotation_planning.py",
    "lib/django/market-service.ts", "lib/market/annotation-model.ts",
    "lib/market/annotation-control-channel.ts", "lib/market/annotation-control-contract.ts"]
for path in applications:
    assert sha((ROOT / path).read_bytes()) == previous_files[path], path
attribute_bytes = (EVIDENCE / ".gitattributes").read_bytes()
assert attribute_bytes.decode("utf-8").splitlines() == [
    "# Preserve captured evidence bytes, including native Windows line endings.",
    "*.log -text -diff", "*.patch -text -diff"]
raw = []
for path in sorted([*EVIDENCE.glob("*.log"), *EVIDENCE.glob("*.patch")]):
    relative = path.relative_to(ROOT).as_posix()
    indexed = subprocess.check_output(["git", "cat-file", "blob", ":" + relative], cwd=ROOT)
    current = path.read_bytes()
    assert indexed == current, relative
    raw.append({"path": relative, "bytes": len(current), "sha256": sha(current), "indexExact": True})
result = {"applicationFilesUnchanged": applications, "testOnlyDelta": {
    "path": test_path, "beforeSha256": previous_files[test_path], "afterSha256": sha(current_test),
    "formatChanges": ["LF to CRLF in the worktree", "removed one EOF blank line"],
    "astIdentical": True}, "evidenceAttributesLocalOnly": True,
    "rawCapturedFiles": raw, "businessTestsRepeated": False, "sourceReviewStillPassed": True}
(EVIDENCE / "review-format-only-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"applicationFileCount": len(applications), "rawFilesPreserved": len(raw),
                  "astIdentical": True, "sourceReviewStillPassed": True}))
