"""Check whether Remove-PreviousBootProcessRecordIfSafe's own body changed.

The comparison script attributes the lines between one column-0 `function`
declaration and the next to the earlier function, so a new top-level statement
inserted after a function lands inside that function's slice. This isolates the
function's real body: from its declaration to its closing `}` at column 0.
"""
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "function Remove-PreviousBootProcessRecordIfSafe"


def body(path):
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    start = next(i for i, l in enumerate(lines) if l.startswith(NAME))
    # The function's body ends at the first line that is exactly a closing
    # brace at column 0.
    end = next(i for i in range(start + 1, len(lines)) if lines[i].rstrip("\r\n") == "}")
    return "".join(lines[start:end + 1])


for label in ("before.ps1", "after.ps1"):
    text = body(ROOT / label)
    print(label, hashlib.sha256(text.encode("utf-8")).hexdigest()[:16], "lines=%d" % text.count("\n"))

b = body(ROOT / "before.ps1")
a = body(ROOT / "after.ps1")
print("function_body_identical =", b == a)
