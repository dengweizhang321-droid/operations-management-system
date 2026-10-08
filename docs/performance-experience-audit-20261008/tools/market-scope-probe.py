"""Audit white-box negative examples for unchanged reachable market functions.

The ORM seam is an in-memory QuerySet implementing only methods used here.
No database/HTTP/browser claims: this executes real function ASTs against tiny
synthetic records, isolating whether filters and truncation are consumed.
"""
import ast
import argparse
import __future__
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path
import subprocess
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]


class QuerySet:
    def __init__(self, rows): self.rows = list(rows)
    def filter(self, **filters):
        rows = self.rows
        for key, value in filters.items():
            field, _, op = key.partition("__")
            if op == "gte": rows = [r for r in rows if getattr(r, field) >= value]
            elif op == "lte": rows = [r for r in rows if getattr(r, field) <= value]
            elif op == "in": rows = [r for r in rows if getattr(r, field) in value]
            elif not op: rows = [r for r in rows if getattr(r, field) == value]
            else: raise AssertionError(f"unsupported ORM seam: {key}")
        return QuerySet(rows)
    def defer(self, *_): return self
    def order_by(self, *fields):
        rows = self.rows[:]
        for field in reversed(fields): rows.sort(key=lambda row: getattr(row, field.lstrip("-")), reverse=field.startswith("-"))
        return QuerySet(rows)
    def first(self): return self.rows[0] if self.rows else None
    def __iter__(self): return iter(self.rows)
    def __getitem__(self, key): return self.rows[key]
    def aggregate(self, **fields):
        result = {}
        for key, (op, field) in fields.items():
            values = [getattr(r, field) for r in self.rows] if isinstance(field, str) else [getattr(r, field[1])[field[2]-1:field[2]-1+field[3]] for r in self.rows]
            result[key] = sum(values) if op == "sum" else min(values) if op == "min" and values else len(set(values)) if op == "count" else None
        return result


def record(sku, month, amount, index):
    return SimpleNamespace(id=index, sku_code=sku, category="audit-category", scope="all", ranking_dimension="SKU",
                           period_start=month + "-01", period_end=month + "-28", gmv_cents=amount, quantity=1,
                           visitors=1, rank=1, product_name="synthetic", brand="synthetic", conversion_bps=100,
                           operation_mode="POP", subcategory="synthetic", price_cents=100)


def bind(path, names, namespace):
    raw = path.read_bytes()
    parsed = ast.parse(raw.decode("utf-8-sig"), filename=str(path))
    nodes = [n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec", flags=__future__.annotations.compiler_flag), namespace)
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(raw).hexdigest(), "functions": [{"name": n.name, "first_line": n.lineno, "last_line": n.end_lineno} for n in nodes]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    namespace = {"Sum": lambda field: ("sum", field), "Min": lambda field: ("min", field),
                 "Count": lambda field, **_: ("count", field), "Substr": lambda *args: ("substr", *args),
                 "_text": lambda value, *args, **kwargs: value, "_dimension": lambda value: value,
                 "_snapshot_map": lambda rows: {},
                 "FORMAL_OFFICIAL_PRICE_TYPES": {"标准售价", "到手价", "券后价"}, "SHA256_RE": re.compile(r"^[a-f0-9]{64}$"),
                 "MarketPriceSnapshot": SimpleNamespace(objects=QuerySet([]))}
    sources = [bind(ROOT / "backend/market/query.py", {"item_trend", "_official_price"}, namespace),
               bind(ROOT / "backend/market/admin.py", {"comparison"}, namespace)]
    rows = [record(sku, month, amount, i) for i, (sku, month, amount) in enumerate([
        ("a", "2026-01", 100), ("a", "2026-02", 900), ("b", "2026-01", 100), ("b", "2026-02", 900)], 1)]
    namespace["MarketRankingEntry"] = SimpleNamespace(objects=QuerySet(rows))
    selections = [{"skuCode": sku, "category": "audit-category", "scope": "all", "rankingDimension": "SKU"} for sku in ["a", "b"]]
    compared = namespace["comparison"]({"selections": selections, "startDate": "2026-01-01", "endDate": "2026-01-31"})
    assert all(r["gmvCents"] == 1000 for r in compared["items"])
    snapshots = [SimpleNamespace(category="audit-category", scope="all", sku_code=sku, ranking_dimension="SKU", month="2026-02",
                                confirmation_status="confirmed", confirmed_market_price_cents=100, ai_price_type="定金", image_content_sha256="a" * 64) for sku in ["a", "b"]]
    namespace["MarketPriceSnapshot"] = SimpleNamespace(objects=QuerySet(snapshots))
    compared_price = namespace["comparison"]({"selections": selections})
    qualified_price = namespace["_official_price"](snapshots[0])
    assert qualified_price is None and all(r["marketPriceCents"] == 100 for r in compared_price["items"])
    namespace["MarketPriceSnapshot"] = SimpleNamespace(objects=QuerySet([]))
    # Sixty newer source records hide an older month despite only two total months.
    rows = [record("a", "2026-02", 1, i) for i in range(1, 61)] + [record("a", "2026-01", 1, 0)]
    namespace["MarketRankingEntry"] = SimpleNamespace(objects=QuerySet(rows))
    trend = namespace["item_trend"]({"operation": "trend", **selections[0]})
    returned_months = sorted({r["month"] for r in trend["items"]})
    assert trend["totalMonths"] == 2 and len(returned_months) == 1 and trend["truncated"] is False
    result = {"kind": "isolated-memory-orm-seam-negative-probe", "utc": datetime.now(timezone.utc).isoformat(),
              "reviewed_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), "sources": sources,
              "scope_example": {"source_records": 4, "requested_dates": ["2026-01-01", "2026-01-31"],
                                "hypothetical_gmv_cents_if_date_applied": 100, "expected_by_current_ui_disclosure": 1000,
                                "classification": "confirmed documented full-history behavior, not a proven date-filter bug",
                                "actual_gmv_cents": [r["gmvCents"] for r in compared["items"]],
                                "actual_trend_months_per_item": [sorted({t["month"] for t in r["trend"]}) for r in compared["items"]]},
              "price_contract_example": {"snapshot_confirmation_status": "confirmed", "snapshot_price_type": "定金",
                                         "qualified_price_by_existing_helper": qualified_price,
                                         "comparison_market_prices": [r["marketPriceCents"] for r in compared_price["items"]],
                                         "production_presence_of_this_snapshot_shape": "unknown"},
              "truncation_example": {"source_records": 61, "totalMonths": trend["totalMonths"], "returned_records": len(trend["items"]),
                                     "returned_months": returned_months, "actual_truncated": trend["truncated"], "expected_truncated": True},
              "limitations": "Function-body proof with synthetic ORM seam; not an API, browser, PostgreSQL or production replay. No timing claim."}
    serialized = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "scope_is_documented_behavior": True, "truncation_bug": True, "price_contract_difference": True}, ensure_ascii=True))
    else:
        print(json.dumps(result, ensure_ascii=True, indent=2))
