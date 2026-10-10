"""Read-only Git object inventory for the two scoped release sources.

No tests, builds, runtime operators, credentials, or source mutations.
"""
import hashlib
import json
import subprocess
from pathlib import Path

SOURCE = Path(r"D:\运营管理系统-sales-django-release")
REVIEW = Path(r"D:\.codex\worktrees\release-integration-review\运营管理系统")
BASE = "01a0ea6de9bfc1237a761f927fff068eb55d6e41"
AB = "c117c60d1dd23e87ebd03a4b72f0edbe09654d61"
ABC = "9d41ce4fa2c7ee4d47ba1bfda0f0967d7727be9c"
REVIEWED = "58bce3f7709f36b5eb8c61f324d34facb65f4e67"


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def inventory(commit):
    names = git(SOURCE, "diff", "--name-status", "-z", BASE, commit).split(b"\0")
    result = []
    for index in range(0, len(names) - 1, 2):
        status, name = names[index].decode(), names[index + 1].decode("utf-8")
        assert status in ("A", "M", "D"), status
        item = {"status": status, "path": name, "category": name.split("/", 1)[0]}
        if status != "A":
            item["beforeBlob"] = git(SOURCE, "rev-parse", f"{BASE}:{name}").decode().strip()
        if status != "D":
            item["afterBlob"] = git(SOURCE, "rev-parse", f"{commit}:{name}").decode().strip()
        if item["category"] == "tools":
            data = git(SOURCE, "show", f"{commit}:{name}")
            item["gitBytesSha256"] = hashlib.sha256(data).hexdigest()
            if commit == ABC:
                reference = git(REVIEW, "rev-parse", f"{REVIEWED}:{name}").decode().strip()
                item["matchesReviewedObject"] = item["afterBlob"] == reference
            elif name not in ("tools/release-batch-admission.mjs", "tools/release-daily-backup.mjs"):
                reference = git(SOURCE, "rev-parse", f"5fb35182:{name}").decode().strip()
                item["matchesOriginalAbDeliveryObject"] = item["afterBlob"] == reference
        result.append(item)
    return result


value = {"version": "task-d-scoped-source-review-v1", "mode": "read-only Git objects",
         "base": BASE, "reviewedImplementation": REVIEWED, "abCommit": AB, "abcCommit": ABC,
         "ab": inventory(AB), "abc": inventory(ABC), "productionCandidateVerified": False,
         "productionAdoption": False}
target = REVIEW / "docs/release-integration-review/evidence/scoped-source-object-inventory.json"
target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"abPaths": len(value["ab"]), "abcPaths": len(value["abc"]),
                  "abOriginalRuntimeMatches": sum(item.get("matchesOriginalAbDeliveryObject", False)
                                                   for item in value["ab"]),
                  "abcReviewedRuntimeMatches": sum(item.get("matchesReviewedObject", False)
                                                     for item in value["abc"])}, ensure_ascii=False))
