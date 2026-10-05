"""Pure stdlib comparison of baseline/current XLSX fixture constructors.

Executes only the two reviewed helper FunctionDefs and their two literal XML
namespace constants. It never imports the finance test module, Django, database
settings or finance business code, and never opens a network connection.
"""
import argparse
import ast
import hashlib
import io
import json
from pathlib import Path
import platform
import struct
import subprocess
import sys
import zipfile
import zlib


ROOT = Path(__file__).resolve().parents[3]
BASELINE = "bab42d8ce836b4ee9acd82e80de085ff71f9f494"
TEST = "backend/finance/tests/test_workbook_bytes_v2.py"
FIXTURE = "backend/finance/tests/fixtures/raw_bytes_v2_cross_group.xlsx"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def construct(source, label):
    tree = ast.parse(source, filename=label)
    constants = {}
    functions = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {"NS", "REL"}:
                    constants[target.id] = ast.literal_eval(node.value)
        if isinstance(node, ast.FunctionDef) and node.name in {"_cell", "_xlsx"}:
            functions.append(node)
    assert set(constants) == {"NS", "REL"}
    assert {node.name for node in functions} == {"_cell", "_xlsx"}
    assert not any(isinstance(node, (ast.Import, ast.ImportFrom))
                   for fn in functions for node in ast.walk(fn))
    namespace = {"io": io, "zipfile": zipfile, **constants}
    module = ast.Module(body=functions, type_ignores=[])
    exec(compile(module, label + ":selected-pure-helpers", "exec"), namespace)
    return namespace["_xlsx"](), ast.dump(module, include_attributes=False)


def compressed(blob, info):
    offset = info.header_offset
    name_length, extra_length = struct.unpack_from("<HH", blob, offset + 26)
    begin = offset + 30 + name_length + extra_length
    return blob[begin:begin + info.compress_size]


def compare_archive(fixed, generated):
    metadata = ("date_time", "compress_type", "create_system", "create_version",
                "extract_version", "flag_bits", "internal_attr", "external_attr")
    with zipfile.ZipFile(io.BytesIO(fixed)) as left, zipfile.ZipFile(io.BytesIO(generated)) as right:
        names = left.namelist()
        assert names == right.namelist()
        rows = []
        for name in names:
            a, b = left.getinfo(name), right.getinfo(name)
            uncompressed_a, uncompressed_b = left.read(name), right.read(name)
            compressed_a, compressed_b = compressed(fixed, a), compressed(generated, b)
            rows.append({
                "name": name,
                "uncompressedEqual": uncompressed_a == uncompressed_b,
                "uncompressedLength": [len(uncompressed_a), len(uncompressed_b)],
                "uncompressedSha256": [sha(uncompressed_a), sha(uncompressed_b)],
                "crcEqual": a.CRC == b.CRC,
                "compressedEqual": compressed_a == compressed_b,
                "compressedLength": [len(compressed_a), len(compressed_b)],
                "compressedSha256": [sha(compressed_a), sha(compressed_b)],
                "metadataDifferences": {key: [getattr(a, key), getattr(b, key)]
                                        for key in metadata if getattr(a, key) != getattr(b, key)},
                "extraEqual": a.extra == b.extra,
                "commentEqual": a.comment == b.comment,
            })
        return {"memberNamesEqual": True, "members": rows,
                "archiveCommentEqual": left.comment == right.comment,
                "allUncompressedMembersEqual": all(row["uncompressedEqual"] for row in rows),
                "allMemberMetadataEqual": all(not row["metadataDifferences"] and row["extraEqual"]
                                              and row["commentEqual"] for row in rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    destination = Path(args.output).resolve()
    allowed = (ROOT / "docs/performance/integration").resolve()
    assert destination.is_relative_to(allowed), "Evidence output must stay in the review directory"
    baseline_source = git("show", f"{BASELINE}:{TEST}")
    head_source = git("show", f"HEAD:{TEST}")
    working_source = (ROOT / TEST).read_bytes()
    fixed = (ROOT / FIXTURE).read_bytes()
    baseline_fixture = git("show", f"{BASELINE}:{FIXTURE}")
    head_fixture = git("show", f"HEAD:{FIXTURE}")
    before, before_ast = construct(baseline_source.decode("utf-8-sig"), "baseline")
    after, after_ast = construct(working_source.decode("utf-8-sig"), "working")
    normalize = lambda raw: raw.decode("utf-8-sig").replace("\r\n", "\n")
    result = {
        "schema": "finance-golden-pure-baseline-review-v1",
        "baseline": BASELINE,
        "head": git("rev-parse", "HEAD").decode().strip(),
        "runtime": {"executable": sys.executable, "python": platform.python_version(),
                    "zlibVersion": zlib.ZLIB_VERSION, "zlibRuntimeVersion": zlib.ZLIB_RUNTIME_VERSION,
                    "zlibNgVersion": getattr(zlib, "ZLIBNG_VERSION", None),
                    "zlibNgRuntimeVersion": getattr(zlib, "ZLIBNG_RUNTIME_VERSION", None)},
        "testSource": {"path": TEST, "baselineBlobSha256": sha(baseline_source),
                       "headBlobSha256": sha(head_source),
                       "workingBytesSha256": sha(working_source),
                       "baselineEqualsHeadBlob": baseline_source == head_source,
                       "baselineEqualsWorkingNormalized": normalize(baseline_source) == normalize(working_source),
                       "selectedHelpersAstEqual": before_ast == after_ast},
        "fixture": {"path": FIXTURE, "sha256": sha(fixed), "length": len(fixed),
                    "baselineEqualsHeadEqualsWorking": baseline_fixture == head_fixture == fixed},
        "generated": {"baselineLength": len(before), "workingLength": len(after),
                      "baselineSha256": sha(before), "workingSha256": sha(after),
                      "baselineEqualsWorking": before == after,
                      "baselineEqualsFixedFixture": before == fixed,
                      "workingEqualsFixedFixture": after == fixed},
        "archiveComparison": compare_archive(fixed, after),
        "safety": {"onlyPureHelpersExecuted": True,
                   "djangoImported": any(name == "django" or name.startswith("django.") for name in sys.modules),
                   "financeImported": any(name == "finance" or name.startswith("finance.") for name in sys.modules),
                   "noDatabaseOrNetworkOperations": True},
    }
    assert result["testSource"]["baselineEqualsHeadBlob"]
    assert result["testSource"]["baselineEqualsWorkingNormalized"]
    assert result["testSource"]["selectedHelpersAstEqual"]
    assert result["fixture"]["baselineEqualsHeadEqualsWorking"]
    assert result["generated"]["baselineEqualsWorking"]
    assert result["archiveComparison"]["allUncompressedMembersEqual"]
    assert not result["safety"]["djangoImported"] and not result["safety"]["financeImported"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(destination), "runtime": result["runtime"],
                      "generated": result["generated"],
                      "allUncompressedMembersEqual": result["archiveComparison"]["allUncompressedMembersEqual"]},
                     ensure_ascii=True))


if __name__ == "__main__":
    main()
