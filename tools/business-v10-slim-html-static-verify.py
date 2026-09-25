"""Verify a synthetic opt-in v10 HTML against its exact complete manifest.

This checks bytes, compressed payloads and all row digests; it is not report
authority, a browser compatibility proof, or Microsoft Excel recalculation.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from business_analysis.contracts import canonical


MAX_FILE = 256 * 1024 * 1024
MAX_TABLE_NDJSON = 256 * 1024 * 1024
SCRIPT = re.compile(rb'<script type="application/json" id="report-data">(.*?)</script>', re.S)
HEX = re.compile(r"[0-9a-f]{64}\Z")


def _pairs(items):
    value = {}
    for key, item in items:
        if key in value:
            raise ValueError("duplicate JSON key in slim HTML")
        value[key] = item
    return value


def _sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _inflate(value, expected):
    if (type(expected) is not int or not 0 <= expected <= MAX_TABLE_NDJSON
            or type(value) is not str or not re.fullmatch(r"[A-Za-z0-9+/]*={0,2}", value)):
        raise ValueError("compressed row descriptor is invalid")
    packed = base64.b64decode(value, validate=True)
    decoder = zlib.decompressobj(wbits=31)
    output = bytearray()
    for index in range(0, len(packed), 65536):
        output.extend(decoder.decompress(packed[index:index+65536],
            expected - len(output) + 1))
        if len(output) > expected or decoder.unconsumed_tail:
            raise ValueError("compressed table exceeds declared byte capacity")
    if not decoder.eof or decoder.unused_data or len(output) != expected:
        raise ValueError("compressed table is incomplete or contains trailing data")
    return bytes(output)


def verify(html_path, manifest_path, *, volume_index=1):
    html_path, manifest_path = Path(html_path), Path(manifest_path)
    if not 1 <= html_path.stat().st_size <= MAX_FILE:
        raise ValueError("HTML exceeds v10 file cap")
    full = json.loads(manifest_path.read_bytes(), object_pairs_hook=_pairs)
    if (full["rendererVersion"] != 10 or type(volume_index) is not int
            or not 1 <= volume_index <= full["volumeCount"]):
        raise ValueError("selected synthetic v10 volume is invalid")
    volume = full["volumes"][volume_index - 1]
    actual_sha = _sha(html_path)
    if (actual_sha != volume["files"]["html"]["sha256"] or
            html_path.stat().st_size != volume["files"]["html"]["bytes"]):
        raise ValueError("HTML bytes differ from complete v10 manifest")
    matches = SCRIPT.findall(html_path.read_bytes())
    if len(matches) != 1:
        raise ValueError("expected exactly one inert report-data script")
    data = json.loads(matches[0], object_pairs_hook=_pairs)
    if (set(data) != {"htmlPayloadVersion", "title", "metadata", "tables"}
            or data["htmlPayloadVersion"] != 2 or type(data["tables"]) is not list
            or len(data["tables"]) != len(volume["tables"])):
        raise ValueError("slim report directory does not match bound fragments")
    row_total = 0
    for item, proof in zip(data["tables"], volume["tables"]):
        if (set(item) != {"key", "title", "note", "columns", "rowsGzipBase64",
                "rowsNdjsonBytes", "rowsGzipSha256", "proof"}
                or item["key"] != proof["fragmentKey"]
                or item["proof"]["rowDigest"] != proof["rowDigest"]
                or item["proof"]["rowCount"] != proof["rowLimit"]
                or not HEX.fullmatch(item["rowsGzipSha256"])):
            raise ValueError("slim table fragment proof differs from manifest")
        packed = base64.b64decode(item["rowsGzipBase64"], validate=True)
        if hashlib.sha256(packed).hexdigest() != item["rowsGzipSha256"]:
            raise ValueError("compressed table SHA differs")
        raw = _inflate(item["rowsGzipBase64"], item["rowsNdjsonBytes"])
        if hashlib.sha256(raw).hexdigest() != proof["rowDigest"]:
            raise ValueError("decompressed NDJSON row digest differs")
        lines = raw.splitlines(keepends=True)
        if b"".join(lines) != raw or any(not line.endswith(b"\n") for line in lines):
            raise ValueError("decompressed NDJSON row separators differ")
        rows = [json.loads(line, object_pairs_hook=_pairs) for line in lines]
        if type(rows) is not list or len(rows) != proof["rowLimit"]:
            raise ValueError("decompressed table row count differs")
        sha = hashlib.sha256()
        for row in rows:
            if type(row) is not list or len(row) != proof["columnCount"]:
                raise ValueError("decompressed table row width differs")
            sha.update((canonical(row) + "\n").encode())
        if sha.hexdigest() != proof["rowDigest"]:
            raise ValueError("decompressed table row digest differs")
        row_total += len(rows)
    if row_total != volume["rowCount"]:
        raise ValueError("slim HTML omitted rows")
    return {"schemaVersion": "business-v10-slim-html-static-check-v1",
        "syntheticOnly": True, "nativeExcelOpened": False,
        "manifestDigest": full["manifestDigest"], "htmlSha256": actual_sha,
        "volumeIndex": volume_index, "tables": len(data["tables"]), "rows": row_total,
        "allCompressedShaAndRowDigestsVerified": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html")
    parser.add_argument("manifest")
    parser.add_argument("output")
    parser.add_argument("--volume-index", type=int, default=1)
    args = parser.parse_args()
    output = Path(args.output)
    with output.open("x", encoding="utf-8") as target:
        json.dump(verify(args.html, args.manifest,
            volume_index=args.volume_index), target,
            ensure_ascii=False, indent=2)
    print(output)
