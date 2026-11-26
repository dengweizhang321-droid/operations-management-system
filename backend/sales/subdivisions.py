"""Global product subdivision maps (code first, name second).

The maps live in Python modules (not JSON) so the release copy list never
misses a non-.py data file. Both sides are compared after NFKC + whitespace
removal + casefold; normalization is only used for comparison and never
rewrites stored data. A hit counts toward its subdivision regardless of the
ERP category; ``coveredCategories`` only identifies ERP categories whose
products are expected to be mapped, so unmapped ones can be reported as
"unclassified".
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from types import ModuleType
from typing import Any

from .subdivision_maps import water_dispenser

UNCLASSIFIED_LABEL = "未归类"
MATCH_ORDER = ["product_code", "product_name"]
NORMALIZATION = "NFKC+strip-whitespace+casefold"
CANDIDATE_RULE = "covered_category_or_exact_raw_value"

# Registration order decides conflicts: the earlier source wins.
SUBDIVISION_SOURCES: tuple[dict[str, Any], ...] = (
    {"module": water_dispenser, "coveredCategories": ("直饮机",)},
)

_WHITESPACE = re.compile(r"\s+")


def normalize(value: object) -> str:
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", str(value or ""))).casefold()


def _build() -> dict[str, Any]:
    by_code: dict[str, str] = {}
    by_name: dict[str, str] = {}
    raw_codes: set[str] = set()
    raw_names: set[str] = set()
    labels: dict[str, None] = {}
    entries: list[tuple[str, str, str]] = []
    covered: dict[str, None] = {}
    for source in SUBDIVISION_SOURCES:
        for category in source["coveredCategories"]:
            covered.setdefault(category)
        for code, name, subdivision in source["module"].ENTRIES:
            labels.setdefault(subdivision)
            entries.append((code, name, subdivision))
            code_key = normalize(code)
            name_key = normalize(name)
            if code_key:
                by_code.setdefault(code_key, subdivision)
            if name_key:
                by_name.setdefault(name_key, subdivision)
            if code:
                raw_codes.add(code)
            if name:
                raw_names.add(name)
    version = hashlib.sha256("".join(str(s["module"].SOURCE["sha256"]) for s in SUBDIVISION_SOURCES).encode()).hexdigest()
    return {
        "byCode": by_code, "byName": by_name,
        "rawCodes": tuple(sorted(raw_codes)), "rawNames": tuple(sorted(raw_names)),
        "labels": tuple(labels), "entries": tuple(entries), "covered": tuple(covered), "version": version,
    }


_INDEX = _build()


def resolve(product_code: object, product_name: object) -> tuple[str | None, str | None]:
    code_key = normalize(product_code)
    if code_key and code_key in _INDEX["byCode"]:
        return _INDEX["byCode"][code_key], "code"
    name_key = normalize(product_name)
    if name_key and name_key in _INDEX["byName"]:
        return _INDEX["byName"][name_key], "name"
    return None, None


def covered_categories() -> tuple[str, ...]:
    return _INDEX["covered"]


def raw_codes() -> tuple[str, ...]:
    return _INDEX["rawCodes"]


def raw_names() -> tuple[str, ...]:
    return _INDEX["rawNames"]


def entries() -> tuple[tuple[str, str, str], ...]:
    return _INDEX["entries"]


def subdivision_labels() -> list[str]:
    return list(_INDEX["labels"])


def map_sources() -> list[dict[str, Any]]:
    return [
        {"fileName": s["module"].SOURCE["fileName"], "sha256": s["module"].SOURCE["sha256"],
         "rowCount": int(s["module"].SOURCE["rowCount"])}
        for s in SUBDIVISION_SOURCES
    ]


def map_version() -> str:
    return _INDEX["version"]


def mapping_info() -> dict[str, Any]:
    return {
        "sources": map_sources(),
        "coveredCategories": list(covered_categories()),
        "matchOrder": MATCH_ORDER,
        "normalization": NORMALIZATION,
        "candidateRule": CANDIDATE_RULE,
        "unclassifiedLabel": UNCLASSIFIED_LABEL,
    }
