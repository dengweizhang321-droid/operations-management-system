"""Regenerate backend/sales/subdivision_maps/water_dispenser.py from the
user-maintained workbook 《直饮机分类规格匹配.xlsx》 (sheet 1, header row 4,
columns C=代码, D=名称, E=分类).

Usage (local dev Python with openpyxl; not part of the release):
    python -I generate_water_dispenser_map.py <workbook.xlsx> <output.py>
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import openpyxl

PLACEHOLDER_NAMES = {"没代码，当定制机"}


def main(source: str, target: str) -> None:
    raw = Path(source).read_bytes()
    sheet = openpyxl.load_workbook(source, data_only=True, read_only=True).worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))
    header = tuple((str(v).strip() if v is not None else "") for v in rows[3][2:5])
    if header != ("代码", "名称", "分类"):
        raise SystemExit(f"unexpected header {header!r}")
    entries: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows[4:]:
        code, name, subdivision = (("" if v is None else str(v).strip()) for v in row[2:5])
        if name in PLACEHOLDER_NAMES:
            name = ""
        if not subdivision or not (code or name):
            continue
        key = (code, name, subdivision)
        if key not in seen:
            seen.add(key)
            entries.append(key)
    lines = [
        '"""直饮机品类细分映射（自动生成，勿手改；用 docs/sales-category-subdivision-20261126/generate_water_dispenser_map.py 重新生成）。"""',
        "",
        "SOURCE = {",
        f'    "fileName": "直饮机分类规格匹配.xlsx",',
        f'    "sha256": "{hashlib.sha256(raw).hexdigest()}",',
        f'    "rowCount": {len(entries)},',
        "}",
        "",
        "# (商品编码, 商品名称, 细分)；编码或名称可为空字符串。",
        "ENTRIES: tuple[tuple[str, str, str], ...] = (",
    ]
    lines += [f"    ({c!r}, {n!r}, {s!r})," for c, n, s in entries]
    lines += [")", ""]
    Path(target).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"wrote {len(entries)} entries")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
