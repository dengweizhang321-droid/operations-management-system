"""Product-level subdivision maps for parent sales categories.

The maps live in Python modules (not JSON) so the release copy list never
misses a non-.py data file. Matching is code first, name second; both sides are
compared after NFKC + whitespace removal + casefold. Normalization is only used
for comparison and never rewrites stored data.
"""
from __future__ import annotations

import re
import unicodedata
from types import ModuleType
from typing import Any

from .subdivision_maps import water_dispenser

UNMATCHED_LABEL = "未细分"
MATCH_ORDER = ["product_code", "product_name"]
NORMALIZATION = "NFKC+strip-whitespace+casefold"

SUBDIVISION_MAPS: dict[str, ModuleType] = {"直饮机": water_dispenser}

_WHITESPACE = re.compile(r"\s+")


def normalize(value: object) -> str:
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", str(value or ""))).casefold()


def _build(module: ModuleType) -> dict[str, Any]:
    by_code: dict[str, str] = {}
    by_name: dict[str, str] = {}
    for code, name, subdivision in module.ENTRIES:
        code_key = normalize(code)
        name_key = normalize(name)
        if code_key:
            by_code.setdefault(code_key, subdivision)
        if name_key:
            by_name.setdefault(name_key, subdivision)
    return {
        "byCode": by_code,
        "byName": by_name,
        "rawCodes": sorted({code for code, _name, _sub in module.ENTRIES if code}),
        "rawNames": sorted({name for _code, name, _sub in module.ENTRIES if name}),
    }


_INDEX = {parent: _build(module) for parent, module in SUBDIVISION_MAPS.items()}


def configured_parents() -> list[str]:
    return list(SUBDIVISION_MAPS)


def resolve(parent: str, product_code: object, product_name: object) -> tuple[str | None, str | None]:
    index = _INDEX[parent]
    code_key = normalize(product_code)
    if code_key and code_key in index["byCode"]:
        return index["byCode"][code_key], "code"
    name_key = normalize(product_name)
    if name_key and name_key in index["byName"]:
        return index["byName"][name_key], "name"
    return None, None


def map_source(parent: str) -> dict[str, Any]:
    source = SUBDIVISION_MAPS[parent].SOURCE
    return {"fileName": source["fileName"], "sha256": source["sha256"], "rowCount": int(source["rowCount"])}


def map_version(parent: str) -> str:
    return str(SUBDIVISION_MAPS[parent].SOURCE["sha256"])


def raw_entry_values(parent: str) -> tuple[list[str], list[str]]:
    index = _INDEX[parent]
    return index["rawCodes"], index["rawNames"]
