"""Infer current ERP bundles within an order, conserving every source cent.

No order fact is changed. Shared children are consumed once, preferring bundles
with more distinct children and then parent code. Positive and return quantities
are matched separately; unrelated outlets/orders never form a bundle.
"""
from collections import defaultdict
from fractions import Fraction
from math import lcm
from django.db.models import Q, Subquery

from erp_reference.models import ErpComboItem
from sales.consumers import _scoped_business, _without_special_products, _outlet_filter
from sales.models import ErpProductMaster

from .errors import ProductsApiError
from .models import ProductInventoryProjection

MAX_RELATIONS = 20_000
MAX_FACTS = 200_000
AMOUNTS = {
    "netSalesCents": "allocated_amount_cents", "costCents": "cost_amount_cents",
    "feeCents": "fee_allocation_cents", "grossProfitCents": "gross_profit_cents",
}


def infer_combinations(facts, relations):
    definitions = defaultdict(list)
    for relation in relations:
        definitions[relation["parent_code"]].append(relation)
    ordered = sorted(definitions, key=lambda code: (-len(definitions[code]), code.encode("utf-8")))
    priority = {code: index for index, code in enumerate(ordered)}
    parents_by_child = defaultdict(set)
    for parent, children in definitions.items():
        for child in children:
            parents_by_child[child["child_code"]].add(parent)
    groups = defaultdict(list)
    for fact in facts:
        # Blank order numbers cannot join independent lines.
        identity = fact["order_no"] or fact["online_order_no"] or fact["source_line_key"]
        sign = -1 if fact["quantity"] < 0 else 1
        groups[(fact["platform"], fact["shop_name"], fact["channel"], identity, sign)].append(fact)
    result = {"single": {}, "combo": {}}

    def add(kind, code, name, quantity, parts, source):
        row = result[kind].setdefault(code, dict(productCode=code, productName=name,
            specification="", category="", supplier="", netQuantity=0,
            grossSalesCents=0, refundAmountCents=0, netSalesCents=0, costCents=0,
            feeCents=0, grossProfitCents=0, absoluteQuantity=0, absoluteCostCents=0,
            outlets=[], productKind=kind, components=[dict(productCode=r["child_code"],
                productName=r["child_name"], quantity=r["child_quantity_milli"] / 1000)
                for r in definitions[code]] if kind == "combo" else []))
        row["netQuantity"] += quantity
        row["absoluteQuantity"] += abs(quantity)
        for field, value in parts.items():
            row[field] += value
        sale = parts["netSalesCents"]
        row["grossSalesCents"] += max(sale, 0)
        row["refundAmountCents"] += max(-sale, 0)
        row["absoluteCostCents"] += abs(parts["costCents"])
        outlet = dict(platform=source["platform"], shopName=source["shop_name"], channel=source["channel"])
        if outlet not in row["outlets"]:
            row["outlets"].append(outlet)
        for target, origin in (("specification", "specification"), ("category", "category"), ("supplier", "supplier")):
            if kind == "single" and source.get(origin):
                row[target] = source[origin]

    for (*_, sign), lines in groups.items():
        lines.sort(key=lambda line: line["source_line_key"])
        remaining = {line["source_line_key"]: abs(line["quantity"]) for line in lines}
        allocated = {line["source_line_key"]: {field: 0 for field in AMOUNTS} for line in lines}
        by_code = defaultdict(list)
        for line in lines:
            by_code[line["product_code"]].append(line)

        def take(line, quantity):
            key = line["source_line_key"]
            original = abs(line["quantity"])
            remaining[key] -= quantity
            parts = {}
            for field, source_field in AMOUNTS.items():
                # Cumulative integer allocation avoids per-split rounding loss;
                # the final residual always owns all remaining cents.
                target = int(Fraction(line[source_field] * (original - remaining[key]), original)) if original else line[source_field]
                parts[field] = target - allocated[key][field]
                allocated[key][field] = target
            return parts

        candidates = set().union(*(parents_by_child[code] for code in by_code))
        for parent in sorted(candidates, key=priority.__getitem__):
            children = definitions[parent]
            if any(child["child_code"] not in by_code for child in children):
                continue
            ratios = {r["child_code"]: Fraction(r["child_quantity_milli"], 1000) for r in children}
            # Sales quantities are whole pieces. Fractional ERP ratios require
            # enough whole sets to consume a whole number of every child.
            step = lcm(*(ratio.denominator for ratio in ratios.values()))
            sets = min((sum(remaining[line["source_line_key"]] for line in by_code[code]) // ratio
                for code, ratio in ratios.items()), default=0)
            sets = int(sets) // step * step
            if not sets:
                continue
            for code, ratio in ratios.items():
                needed = int(sets * ratio)
                for line in by_code[code]:
                    count = min(needed, remaining[line["source_line_key"]])
                    if count:
                        add("combo", parent, children[0]["parent_name"] or parent, 0, take(line, count), line)
                        needed -= count
                    if not needed:
                        break
            result["combo"][parent]["netQuantity"] += sign * sets
            result["combo"][parent]["absoluteQuantity"] += sets

        for line in lines:
            count = remaining[line["source_line_key"]]
            # Preserve zero-quantity adjustment amounts, too.
            if count or not line["quantity"]:
                code = line["product_code"]
                kind = "combo" if code in definitions else "single"
                add(kind, code, line["product_name"] or code, sign * count, take(line, count), line)
    return result


def combination_performance(principal, start, end_exclusive, platforms, shops, inventory_revision):
    relations = list(ErpComboItem.objects.order_by("parent_code", "child_code").values(
        "parent_code", "parent_name", "child_code", "child_name", "child_quantity_milli")[:MAX_RELATIONS + 1])
    if len(relations) > MAX_RELATIONS:
        raise ProductsApiError("组合装配比超过安全上限", code="service_unavailable", status=503)
    facts = _without_special_products(_scoped_business(principal)).exclude(product_code="").filter(
        business_date__gte=start, business_date__lt=end_exclusive)
    # Preserve the original product summary's complete ERP/inventory universe;
    # database subqueries avoid sending a 20,000-code IN list or per-SKU reads.
    facts = facts.filter(Q(product_code__in=Subquery(ErpProductMaster.objects.values("product_code")))
        | Q(product_code__in=Subquery(ProductInventoryProjection.objects.filter(
            projection_revision=inventory_revision).values("product_code"))))
    if platforms:
        facts = facts.filter(platform_key__in=platforms)
    if shops:
        facts = facts.filter(_outlet_filter([dict(platform=s["platform"], shopName=s["shop"]) for s in shops]))
    lines = list(facts.order_by("id").values("source_line_key", "order_no", "online_order_no",
        "platform", "shop_name", "channel", "product_code", "product_name", "quantity",
        "specification", "category", "supplier", *AMOUNTS.values())[:MAX_FACTS + 1])
    if len(lines) > MAX_FACTS:
        raise ProductsApiError("组合装订单明细超过安全上限，请缩短统计周期", code="service_unavailable", status=503)
    return infer_combinations(lines, relations)
