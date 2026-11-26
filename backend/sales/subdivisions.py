"""Effective product subdivision mapping (static map + Jackyun archive + manual edits).

The static maps live in Python modules (not JSON) so the release copy list never
misses a non-.py data file. They are the *default* layer. Two small database
tables (``SalesSubdivisionLabel`` / ``SalesProductSubdivisionOverride``) carry
user edits on top of it. Sales are grouped by the Jackyun spec code
(``product_code``); the effective mapping is composed once here and shared by
the analysis API and the system-settings list so both always agree.

Precedence for a (code, name) pair:
  1. manual assignment by code            -> matchedBy "manual"
  2. static entry that carries a code      -> "code"
  3. name-only static entry whose name was found in ``ErpProductMaster``;
     every archive row with that name donates its code -> "name_to_code"
  4. name-only static entry the archive does not know ("Jackyun not found")
     still counts by exact name                          -> "name"
A mapping that points to a deleted label counts as a miss. Both sides are
compared after NFKC + whitespace removal + casefold; normalization never
rewrites stored data.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
import threading
import time
from typing import Any

from django.db import connection, transaction
from django.db.models import Count, Max, Q

from .auth import Principal
from .calculation_cache import reuse
from .models import ErpProductMaster, SalesOrderLine, SalesProductSubdivisionOverride, SalesSubdivisionLabel
from .query import SalesRequestError, binary_text_key, revision_token
from .subdivision_maps import water_dispenser

UNCLASSIFIED_LABEL = "未归类"
MATCH_ORDER = ["manual", "product_code", "name_to_code", "sales_name_to_code", "name_fallback"]
NORMALIZATION = "NFKC+strip-whitespace+casefold"
CANDIDATE_RULE = "covered_category_or_raw_code_or_fallback_name"
MASTER_CANDIDATE_LIMIT = 20000
SALES_NAME_LIMIT = 200000
LABEL_LIMIT = 200

# Registration order decides conflicts: the earlier source wins.
SUBDIVISION_SOURCES: tuple[dict[str, Any], ...] = (
    {"module": water_dispenser, "majorCategory": "直饮机", "coveredCategories": ("直饮机",)},
)

_WHITESPACE = re.compile(r"\s+")


def normalize(value: object) -> str:
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", str(value or ""))).casefold()


def static_version() -> str:
    return hashlib.sha256("".join(str(s["module"].SOURCE["sha256"]) for s in SUBDIVISION_SOURCES).encode()).hexdigest()


def map_sources() -> list[dict[str, Any]]:
    return [
        {"fileName": s["module"].SOURCE["fileName"], "sha256": s["module"].SOURCE["sha256"],
         "rowCount": int(s["module"].SOURCE["rowCount"])}
        for s in SUBDIVISION_SOURCES
    ]


def config_digest() -> str:
    """Cheap per-request fingerprint of the editable layer (row counts + latest write)."""
    labels = SalesSubdivisionLabel.objects.aggregate(rows=Count("id"), latest=Max("updated_at"))
    overrides = SalesProductSubdivisionOverride.objects.aggregate(rows=Count("product_code"), latest=Max("updated_at"))
    material = "|".join([
        static_version(), str(labels["rows"]), str(labels["latest"]), str(overrides["rows"]), str(overrides["latest"]),
    ])
    return hashlib.sha256(material.encode()).hexdigest()


def _static_entries() -> list[tuple[str, str, str, str]]:
    """(code, name, label, majorCategory) in registration order."""
    return [
        (code, name, label, source["majorCategory"])
        for source in SUBDIVISION_SOURCES
        for code, name, label in source["module"].ENTRIES
    ]


def master_candidates(covered: list[str], codes: list[str], names: list[str]) -> list[dict[str, Any]]:
    rows = list(
        ErpProductMaster.objects.filter(
            Q(category__in=covered) | Q(product_code__in=codes) | Q(product_name__in=names)
        ).order_by("product_code").values(
            "product_code", "product_name", "specification", "category", "supplier", "product_status"
        )[: MASTER_CANDIDATE_LIMIT + 1]
    )
    if len(rows) > MASTER_CANDIDATE_LIMIT:
        raise SalesRequestError(f"货品细分映射候选货品超过 {MASTER_CANDIDATE_LIMIT}，暂不支持")
    return rows


_SALES_INDEX_LOCK = threading.Lock()
_SALES_INDEX: dict[str, Any] = {"token": None, "value": None, "failedToken": None, "failedUntil": 0.0}
SALES_INDEX_TIMEOUT_MS = 60_000
SALES_INDEX_FAILURE_BACKOFF_SECONDS = 60


def _compute_sales_index() -> tuple[dict[str, frozenset[str]], dict[str, str], frozenset[str]]:
    pairs = list(
        SalesOrderLine.objects.filter(is_business_row=True).order_by()
        .values_list("product_code", "product_name").distinct()[: SALES_NAME_LIMIT + 1]
    )
    if len(pairs) > SALES_NAME_LIMIT:
        raise SalesRequestError(f"销售明细货品名称超过 {SALES_NAME_LIMIT}，暂不支持")
    names: dict[str, set[str]] = {}
    codes: set[str] = set()
    for code, name in pairs:
        if not code:
            continue
        codes.add(code)
        key = normalize(name)
        if key:
            names.setdefault(key, set()).add(code)
    latest: dict[str, tuple[str, str]] = {}
    for code, supplier, last in (
        SalesOrderLine.objects.filter(is_business_row=True).exclude(supplier="").exclude(product_code="")
        .order_by().values_list("product_code", "supplier").annotate(last=Max("business_date"))
    ):
        # Same-day ties resolve to the larger supplier text so the result is deterministic.
        if code not in latest or (str(last), supplier) > latest[code]:
            latest[code] = (str(last), supplier)
    return ({key: frozenset(value) for key, value in names.items()},
            {code: value[1] for code, value in latest.items()}, frozenset(codes))


def sales_name_index() -> tuple[dict[str, frozenset[str]], dict[str, str], frozenset[str]]:
    """normalized sales name -> raw codes; code -> latest non-empty supplier; all sales codes.

    Scans the whole sales history, so it is memoized per sales/erp revision token (one recompute per
    import, not per request). Concurrent callers may both compute; neither ever sees a partial value.
    """
    token = revision_token()
    with _SALES_INDEX_LOCK:
        if _SALES_INDEX["token"] == token:
            return _SALES_INDEX["value"]
        if _SALES_INDEX["failedToken"] == token and time.monotonic() < _SALES_INDEX["failedUntil"]:
            raise SalesRequestError("销售明细名称索引暂时无法计算，请稍后重试")
    try:
        value = _compute_with_budget()
    except Exception:
        # Back off per revision so a statement timeout is not retried by every request.
        with _SALES_INDEX_LOCK:
            _SALES_INDEX["failedToken"] = token
            _SALES_INDEX["failedUntil"] = time.monotonic() + SALES_INDEX_FAILURE_BACKOFF_SECONDS
        raise
    with _SALES_INDEX_LOCK:
        _SALES_INDEX["token"], _SALES_INDEX["value"] = token, value
        _SALES_INDEX["failedToken"] = None
    return value


def _compute_with_budget():
    """Run the full-history scan under a wider statement budget that never leaks to the caller.

    set_config(..., true) is transaction-local; inside an outer transaction the nested atomic is a savepoint,
    so the previous value is restored explicitly on success (and by the savepoint rollback on failure).
    """
    if connection.vendor != "postgresql":
        return _compute_sales_index()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('statement_timeout')")
            previous = cursor.fetchone()[0]
            cursor.execute("SELECT set_config('statement_timeout', %s, true)", [str(SALES_INDEX_TIMEOUT_MS)])
        value = _compute_sales_index()
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('statement_timeout', %s, true)", [previous])
    return value


def supplier_for(code: object, erp_supplier: object, index: tuple) -> str:
    """The archive supplier when non-empty, else the latest non-empty supplier on sales lines of that code.

    ``index`` is the tuple from one ``sales_name_index()`` call made by the caller, so per-row use never queries.
    """
    if erp_supplier and str(erp_supplier).strip():
        return str(erp_supplier)
    return index[1].get(str(code or ""), "")


def _build_data() -> dict[str, Any]:
    entries = _static_entries()
    majors: dict[str, dict[str, Any]] = {}
    for source in SUBDIVISION_SOURCES:
        major = majors.setdefault(source["majorCategory"], {"covered": [], "labels": {}})
        for category in source["coveredCategories"]:
            if category not in major["covered"]:
                major["covered"].append(category)
    for _code, _name, label, major_name in entries:
        labels = majors[major_name]["labels"]
        if label not in labels:
            labels[label] = {"source": "static", "sortOrder": len(labels) * 10, "deleted": False}
    for row in SalesSubdivisionLabel.objects.order_by("id").values("major_category", "name", "sort_order", "is_deleted"):
        major = majors.get(row["major_category"])
        if major is None:
            continue
        existing = major["labels"].get(row["name"])
        if existing is None:
            major["labels"][row["name"]] = {"source": "custom", "sortOrder": int(row["sort_order"]), "deleted": bool(row["is_deleted"])}
        else:
            existing["sortOrder"] = int(row["sort_order"])
            existing["deleted"] = bool(row["is_deleted"])
    live = {(name, label) for name, major in majors.items() for label, meta in major["labels"].items() if not meta["deleted"]}

    manual: dict[str, dict[str, Any]] = {}
    for row in SalesProductSubdivisionOverride.objects.order_by("product_code").values(
        "product_code", "major_category", "label", "source_name"
    ):
        key = normalize(row["product_code"])
        if key and row["major_category"] in majors:
            manual.setdefault(key, {
                "code": row["product_code"], "major": row["major_category"],
                "label": row["label"], "sourceName": row["source_name"],
            })

    code_map: dict[str, tuple[str, str, str]] = {}
    static_codes: set[str] = set()
    name_only: dict[str, tuple[str, str, str]] = {}  # normalized name -> (label, major, raw name)
    for code, name, label, major_name in entries:
        code_key, name_key = normalize(code), normalize(name)
        if code_key:
            code_map.setdefault(code_key, (label, major_name, "code"))
            static_codes.add(code)
        elif name_key:
            name_only.setdefault(name_key, (label, major_name, name))

    covered_all = sorted({category for major in majors.values() for category in major["covered"]})
    found_names: set[str] = set()
    name_to_code_raw: dict[str, set[str]] = {}
    if name_only:
        raw_names = sorted({raw for _label, _major, raw in name_only.values()})
        for row in master_candidates(covered_all, [], raw_names):
            name_key = normalize(row["product_name"])
            hit = name_only.get(name_key)
            code_key = normalize(row["product_code"])
            if hit is None or not code_key:
                continue
            found_names.add(name_key)
            if code_key not in code_map:
                code_map[code_key] = (hit[0], hit[1], "name_to_code")
                name_to_code_raw.setdefault(hit[1], set()).add(row["product_code"])
    sales_lookup: list[dict[str, str]] = []
    unfound = {key: hit for key, hit in name_only.items() if key not in found_names}
    if unfound:
        names_index = sales_name_index()[0]
        for name_key, hit in unfound.items():
            codes = names_index.get(name_key)
            if not codes:
                continue
            found_names.add(name_key)
            for raw_code in sorted(codes):
                code_key = normalize(raw_code)
                if code_key and code_key not in code_map:
                    code_map[code_key] = (hit[0], hit[1], "sales_name_to_code")
                    name_to_code_raw.setdefault(hit[1], set()).add(raw_code)
                    sales_lookup.append({"code": raw_code, "name": hit[2], "major": hit[1]})
    replaced = {normalize(item["sourceName"]) for item in manual.values() if item["sourceName"]}
    name_fallback = {
        key: (label, major_name, raw)
        for key, (label, major_name, raw) in name_only.items()
        if key not in found_names and key not in replaced
    }
    return {
        "majors": majors, "live": sorted(live), "manual": manual, "codeMap": code_map,
        "nameFallback": name_fallback, "staticCodes": sorted(static_codes),
        "nameToCodeRaw": {key: sorted(value) for key, value in name_to_code_raw.items()},
        "entries": entries, "salesLookup": sales_lookup,
    }


class EffectiveMapping:
    def __init__(self, data: dict[str, Any], config_version: str) -> None:
        self._majors = data["majors"]
        self._live = {tuple(item) for item in data["live"]}
        self._manual = data["manual"]
        self._code_map = data["codeMap"]
        self._name_fallback = data["nameFallback"]
        self._static_codes = data["staticCodes"]
        self._name_to_code_raw = data["nameToCodeRaw"]
        self.entries: list[tuple[str, str, str, str]] = data["entries"]
        self._sales_lookup = data["salesLookup"]
        self.config_version = config_version

    # -- structure ---------------------------------------------------------
    def major_categories(self) -> list[str]:
        return list(self._majors)

    def covered_categories(self, major: str | None = None) -> list[str]:
        if major is not None:
            return list(self._majors[major]["covered"])
        return sorted({category for item in self._majors.values() for category in item["covered"]})

    def labels(self, major: str, *, include_deleted: bool = False) -> list[dict[str, Any]]:
        items = [
            {"name": name, "source": meta["source"], "sortOrder": meta["sortOrder"], "deleted": meta["deleted"]}
            for name, meta in self._majors[major]["labels"].items()
            if include_deleted or not meta["deleted"]
        ]
        items.sort(key=lambda item: (item["sortOrder"], binary_text_key(item["name"])))
        return items

    def label_names(self, major: str | None = None) -> list[str]:
        majors = [major] if major else self.major_categories()
        return [item["name"] for name in majors for item in self.labels(name)]

    def is_live(self, major: str, label: str) -> bool:
        return (major, label) in self._live

    @property
    def version(self) -> str:
        return static_version()

    # -- resolution --------------------------------------------------------
    def code_owned(self, code: object) -> bool:
        key = normalize(code)
        return bool(key) and (key in self._manual or key in self._code_map)

    def manual_for(self, code: object) -> dict[str, Any] | None:
        return self._manual.get(normalize(code))

    def resolve(self, code: object, name: object, *, use_manual: bool = True) -> tuple[str | None, str | None, str | None]:
        """Return (label, majorCategory, matchedBy).

        ``(None, major, "manual")`` means an explicit manual "unclassified".
        ``(None, None, None)`` means no usable mapping (including a deleted label).
        """
        code_key = normalize(code)
        if code_key:
            manual = self._manual.get(code_key) if use_manual else None
            if manual is not None:
                if manual["label"] == "":
                    return None, manual["major"], "manual"
                if self.is_live(manual["major"], manual["label"]):
                    return manual["label"], manual["major"], "manual"
                return None, None, None
            hit = self._code_map.get(code_key)
            if hit is not None:
                label, major, source = hit
                return (label, major, source) if self.is_live(major, label) else (None, None, None)
        name_key = normalize(name)
        fallback = self._name_fallback.get(name_key) if name_key else None
        if fallback is not None:
            label, major, _raw = fallback
            return (label, major, "name") if self.is_live(major, label) else (None, None, None)
        return None, None, None

    # -- raw values for SQL candidate filters ------------------------------
    def raw_codes(self, major: str) -> list[str]:
        raw: set[str] = {item["code"] for item in self._manual.values() if item["major"] == major and item["label"] != ""}
        raw.update(code for code, _name, _label, owner in self.entries if code and owner == major)
        raw.update(self._name_to_code_raw.get(major, ()))
        return sorted(raw)

    def raw_fallback_names(self, major: str) -> list[str]:
        return sorted({raw for label, owner, raw in self._name_fallback.values() if owner == major})

    def static_codes(self) -> list[str]:
        return list(self._static_codes)

    def sales_lookup(self) -> list[dict[str, str]]:
        """Name-only entries resolved to a code through the historical sales lines."""
        return list(self._sales_lookup)

    @staticmethod
    def has_sales_code(code: object, index: tuple) -> bool:
        return str(code or "") in index[2]

    def manual_codes(self) -> list[str]:
        return [item["code"] for item in self._manual.values()]

    def manual_items(self) -> list[dict[str, Any]]:
        return list(self._manual.values())

    def fallback_keys(self) -> set[str]:
        return set(self._name_fallback)

    # -- display -----------------------------------------------------------
    def major_payload(self) -> list[dict[str, Any]]:
        return [
            {
                "name": name, "coveredCategories": list(self._majors[name]["covered"]),
                "labels": [{"name": item["name"], "source": item["source"], "sortOrder": item["sortOrder"]} for item in self.labels(name)],
            }
            for name in self._majors
        ]

    def mapping_info(self, major: str) -> dict[str, Any]:
        return {
            "sources": map_sources(),
            "coveredCategories": self.covered_categories(major),
            "matchOrder": MATCH_ORDER,
            "normalization": NORMALIZATION,
            "candidateRule": CANDIDATE_RULE,
            "unclassifiedLabel": UNCLASSIFIED_LABEL,
            "majorCategories": self.major_payload(),
            "selectedMajorCategory": major,
            "configVersion": self.config_version,
        }


def load_effective(principal: Principal) -> EffectiveMapping:
    # The scope carries the freshly read edit-layer fingerprint, so an edit is
    # visible to the next request even inside the shared calculation cache TTL.
    digest = config_digest()
    data = reuse("subdivision-effective", {"config": digest}, principal, _build_data)
    return EffectiveMapping(data, digest)
