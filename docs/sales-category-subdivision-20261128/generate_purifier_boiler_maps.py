"""Regenerate backend/sales/subdivision_maps/water_purifier.py and water_boiler.py
from the user-maintained workbook 《净水器&开水器分类.xlsx》.

The workbook embeds ~340 MB of pictures, so it is read as a zip archive and only
the sheet XML is streamed (openpyxl would load every picture). Sheets:
  - 净水器      -> major 净水器 (二级 only; 一级“配件”的压力桶也归入净水器，细分为“配件”)
  - 羽骏开水器  -> major 开水器 (二级 + 三级)
  - 开水器      -> major 开水器 (二级 + 三级)
Columns are found by header text: 货品编码 / 货品名称 / 一级品类 / 二级品类 / 三级品类.
The leaf label is 三级 when present, else 二级; PARENTS maps every leaf to its 二级.
A 三级 name listed under two different 二级 gets the 二级 appended, e.g.
“水盘款开水器（水尺开水器）”, so every leaf has exactly one parent.

Usage (local dev Python; not part of the release):
    python -I generate_purifier_boiler_maps.py <workbook.xlsx> <backend/sales/subdivision_maps>
"""
from __future__ import annotations

import hashlib
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
FILE_NAME = "净水器&开水器分类.xlsx"
SHEETS = {"净水器": "净水器", "羽骏开水器": "开水器", "开水器": "开水器"}
MODULES = {"净水器": "water_purifier", "开水器": "water_boiler"}
HEADER_KEYS = {"code": "货品编码", "name": "货品名称", "level1": "一级品类", "level2": "二级品类", "level3": "三级品类"}


def _clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.iter(f"{NS}t")) for si in root.findall(f"{NS}si")]


def _sheet_paths(archive: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target") for rel in rels}
    paths = {}
    for sheet in workbook.find(f"{NS}sheets"):
        target = targets[sheet.get(REL)].lstrip("/")
        paths[sheet.get("name")] = target if target.startswith("xl/") else f"xl/{target}"
    return paths


def _rows(archive: zipfile.ZipFile, path: str, strings: list[str], limit: int = 2000):
    """Yield {column: text} for the first ``limit`` rows (the sheet pads ~1M empty rows)."""
    seen = 0
    for _event, row in ET.iterparse(archive.open(path)):
        if row.tag != f"{NS}row":
            continue
        values: dict[str, str] = {}
        for cell in row.findall(f"{NS}c"):
            column = re.match(r"[A-Z]+", cell.get("r")).group()
            node = cell.find(f"{NS}v")
            kind = cell.get("t")
            if kind == "s" and node is not None:
                value = strings[int(node.text)]
            elif kind == "inlineStr":
                value = "".join(t.text or "" for t in cell.iter(f"{NS}t"))
            else:
                value = node.text if node is not None else ""
            if _clean(value):
                values[column] = _clean(value)
        row.clear()
        yield values
        seen += 1
        if seen >= limit:
            return


def _read_sheet(archive, path, strings, sheet_name):
    header = None
    records = []
    for values in _rows(archive, path, strings):
        if header is None:
            found = {key: next((col for col, text in values.items() if text.startswith(prefix)), None)
                     for key, prefix in HEADER_KEYS.items()}
            if found["code"] and found["name"] and found["level2"]:
                header = found
            continue
        get = lambda key: values.get(header[key], "") if header[key] else ""  # noqa: E731
        code, name, level2, level3 = get("code"), get("name"), get("level2"), get("level3")
        if not level2 or not (code or name):
            continue
        records.append((code, name, level2, level3))
    if header is None:
        raise SystemExit(f"sheet {sheet_name!r}: header not found")
    return records


def main(source: str, target_dir: str) -> None:
    raw_hash = hashlib.sha256()
    with open(source, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            raw_hash.update(chunk)
    digest = raw_hash.hexdigest()
    archive = zipfile.ZipFile(source)
    strings = _shared_strings(archive)
    paths = _sheet_paths(archive)
    per_major: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
    for sheet_name, major in SHEETS.items():
        if sheet_name not in paths:
            raise SystemExit(f"sheet {sheet_name!r} missing")
        per_major[major] += _read_sheet(archive, paths[sheet_name], strings, sheet_name)

    for major, records in per_major.items():
        parents_of: dict[str, set[str]] = defaultdict(set)
        for _code, _name, level2, level3 in records:
            if level3:
                parents_of[level3].add(level2)
        ambiguous = {leaf for leaf, parents in parents_of.items() if len(parents) > 1}
        entries: list[tuple[str, str, str]] = []
        parents: dict[str, str] = {}
        seen: set[tuple[str, str, str]] = set()
        for code, name, level2, level3 in records:
            leaf = level3 or level2
            if level3 in ambiguous:
                leaf = f"{level3}（{level2}）"
            parents.setdefault(leaf, level2)
            key = (code, name, leaf)
            if key not in seen:
                seen.add(key)
                entries.append(key)
        module = MODULES[major]
        lines = [
            f'"""{major}品类细分映射（自动生成，勿手改；用 docs/sales-category-subdivision-20261128/generate_purifier_boiler_maps.py 重新生成）。"""',
            "",
            "SOURCE = {",
            f'    "fileName": "{FILE_NAME}",',
            f'    "sha256": "{digest}",',
            f'    "rowCount": {len(entries)},',
            "}",
            "",
            "# (商品编码, 商品名称, 细分)；编码或名称可为空字符串。细分为三级类目，无三级时为二级类目。",
            "ENTRIES: tuple[tuple[str, str, str], ...] = (",
        ]
        lines += [f"    ({c!r}, {n!r}, {s!r})," for c, n, s in entries]
        lines += [")", "", "# 细分 -> 二级类目。", "PARENTS: dict[str, str] = {"]
        lines += [f"    {leaf!r}: {parent!r}," for leaf, parent in parents.items()]
        lines += ["}", ""]
        Path(target_dir, f"{module}.py").write_text("\n".join(lines), encoding="utf-8", newline="\n")
        print(f"{module}: {len(entries)} entries, {len(parents)} labels, ambiguous={sorted(ambiguous)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
