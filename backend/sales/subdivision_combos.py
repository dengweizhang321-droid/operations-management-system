"""Jackyun bundle (组合装) attribution for the category subdivision analysis.

A mapped code may be a Jackyun combo parent (e.g. 开水器 + 底座). Orders never
carry the parent code; they carry the child codes. The bundles are inferred with
the same rules as ``products/combinations.py`` (商品经营 › 组合装):

* lines only join within one platform/shop/channel/order and one sign
  (positive sales and returns are matched separately);
* parents with more distinct children are tried first, then by parent code;
  every child piece is consumed once;
* whole sets only, honouring fractional ERP ratios;
* amounts split by cumulative integer allocation, so no cent is lost.

The pieces consumed into a set move from the child's own subdivision to the
parent's subdivision; the set count (套) becomes the parent's quantity.
Leftover pieces stay on the child. No order fact is changed.
"""
from __future__ import annotations

from collections import defaultdict
from fractions import Fraction
from math import lcm
from typing import Any, Callable, Iterable

from .query import SalesRequestError

MAX_RELATIONS = 20_000
MAX_LINES = 200_000
COMBO_CATEGORY = "组合装（子件凑套）"
AMOUNT_FIELDS = ("allocated_amount_cents", "cost_amount_cents", "gross_profit_cents")
LINE_FIELDS = (
    "source_line_key", "order_no", "online_order_no", "platform", "shop_name", "channel",
    "product_code", "product_name", "quantity", "business_date", "resolved_category", "is_net_quantity_row",
    *AMOUNT_FIELDS,
)


def combo_definitions(resolve_target: Callable[[str, str], str | None]) -> dict[str, dict[str, Any]]:
    """Combo parents whose own code maps into the selected major: code -> {name, target, children}."""
    from erp_reference.models import ErpComboItem

    relations = list(ErpComboItem.objects.order_by("parent_code", "child_code").values(
        "parent_code", "parent_name", "child_code", "child_quantity_milli")[: MAX_RELATIONS + 1])
    if len(relations) > MAX_RELATIONS:
        raise SalesRequestError(f"组合装配比超过 {MAX_RELATIONS} 条，暂不支持")
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for relation in relations:
        grouped[relation["parent_code"]].append(relation)
    definitions: dict[str, dict[str, Any]] = {}
    for parent, children in grouped.items():
        target = resolve_target(parent, children[0]["parent_name"] or "")
        if not target:
            continue
        definitions[parent] = {
            "name": children[0]["parent_name"] or parent, "target": target,
            "ratios": {child["child_code"]: Fraction(int(child["child_quantity_milli"]), 1000) for child in children},
        }
    return definitions


def child_codes(definitions: dict[str, dict[str, Any]]) -> list[str]:
    return sorted({code for item in definitions.values() for code in item["ratios"]})


def allocate(lines: Iterable[dict[str, Any]], definitions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Return consumed pieces: {line, parent, quantity (pieces), sets (only on the set's first piece), amounts}."""
    ordered = sorted(definitions, key=lambda code: (-len(definitions[code]["ratios"]), code.encode("utf-8")))
    priority = {code: index for index, code in enumerate(ordered)}
    parents_by_child: dict[str, set[str]] = defaultdict(set)
    for parent, item in definitions.items():
        for child in item["ratios"]:
            parents_by_child[child].add(parent)
    groups: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        if not line["quantity"]:
            continue
        identity = line["order_no"] or line["online_order_no"] or line["source_line_key"]
        sign = -1 if line["quantity"] < 0 else 1
        groups[(line["platform"], line["shop_name"], line["channel"], identity, sign)].append(line)

    pieces: list[dict[str, Any]] = []
    for (*_, sign), members in groups.items():
        members.sort(key=lambda line: line["source_line_key"])
        remaining = {line["source_line_key"]: abs(int(line["quantity"])) for line in members}
        taken = {line["source_line_key"]: {field: 0 for field in AMOUNT_FIELDS} for line in members}
        by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for line in members:
            by_code[line["product_code"]].append(line)

        def take(line: dict[str, Any], count: int) -> dict[str, int]:
            key = line["source_line_key"]
            original = abs(int(line["quantity"]))
            remaining[key] -= count
            parts = {}
            for field in AMOUNT_FIELDS:
                target = int(Fraction(int(line[field] or 0) * (original - remaining[key]), original))
                parts[field] = target - taken[key][field]
                taken[key][field] = target
            return parts

        candidates = set().union(*(parents_by_child[code] for code in by_code)) if by_code else set()
        for parent in sorted(candidates, key=priority.__getitem__):
            ratios = definitions[parent]["ratios"]
            if any(code not in by_code for code in ratios):
                continue
            step = lcm(*(ratio.denominator for ratio in ratios.values()))
            sets = min(sum(remaining[line["source_line_key"]] for line in by_code[code]) // ratio for code, ratio in ratios.items())
            sets = int(sets) // step * step
            if not sets:
                continue
            first = True
            for code, ratio in ratios.items():
                needed = int(sets * ratio)
                for line in by_code[code]:
                    count = min(needed, remaining[line["source_line_key"]])
                    if count:
                        pieces.append({"line": line, "parent": parent, "quantity": count,
                                       "sets": sign * sets if first else 0, "amounts": take(line, count)})
                        first = False
                        needed -= count
                    if not needed:
                        break
    return pieces
