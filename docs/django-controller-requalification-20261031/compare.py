"""Byte-level comparison of two django-local-service.ps1 generations.

Static text analysis only: never executes the controller.

Functions in this controller are all declared at column 0. A function's text
runs from its `function` line up to the line before the next column-0
`function` line (or EOF). That avoids brace counting entirely, which is what
broke an earlier version of this script: a single-line `{ ... }` body made the
running depth hit zero early and swallowed the following functions.

Self-checks assert the parse found every column-0 declaration and that the
reassembled text is byte-identical to the input, so a silent mis-parse cannot
be mistaken for a clean comparison.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FN_START = re.compile(r"^function\s+([A-Za-z0-9\-_]+)")


def split_functions(text):
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if FN_START.match(line)]
    declared = sum(1 for line in lines if line.startswith("function "))
    assert len(starts) == declared, (
        "parse lost declarations: matched %d of %d" % (len(starts), declared))

    functions = {}
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        name = FN_START.match(lines[start]).group(1)
        assert name not in functions, "duplicate function name: %s" % name
        functions[name] = "".join(lines[start:end])

    preamble = "".join(lines[: starts[0]]) if starts else text
    rebuilt = preamble + "".join(functions[FN_START.match(lines[s]).group(1)] for s in starts)
    assert rebuilt == text, "reassembly is not byte-identical to the input"
    return functions, preamble


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    before = (ROOT / "before.ps1").read_text(encoding="utf-8")
    after = (ROOT / "after.ps1").read_text(encoding="utf-8")

    fb, pb = split_functions(before)
    fa, pa = split_functions(after)

    # Whole-file digests must come from the raw bytes (the files are UTF-8 with
    # BOM and CRLF), so they match the registered qualification values; the
    # decoded text is only used for the function-level split below.
    out = []
    out.append("whole_file_before=%s" % hashlib.sha256((ROOT / "before.ps1").read_bytes()).hexdigest())
    out.append("whole_file_after =%s" % hashlib.sha256((ROOT / "after.ps1").read_bytes()).hexdigest())
    out.append("function_count before=%d after=%d" % (len(fb), len(fa)))

    added = sorted(set(fa) - set(fb))
    removed = sorted(set(fb) - set(fa))
    out.append("functions_added=%s" % (",".join(added) or "(none)"))
    out.append("functions_removed=%s" % (",".join(removed) or "(none)"))

    shared = sorted(set(fb) & set(fa))
    changed = [n for n in shared if sha(fb[n]) != sha(fa[n])]
    identical = [n for n in shared if sha(fb[n]) == sha(fa[n])]
    out.append("functions_changed=%d: %s" % (len(changed), ",".join(changed) or "(none)"))
    out.append("functions_byte_identical=%d" % len(identical))
    out.append("preamble_identical=%s" % (sha(pb) == sha(pa)))

    text = "\n".join(out)
    (ROOT / "compare-result.txt").write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
