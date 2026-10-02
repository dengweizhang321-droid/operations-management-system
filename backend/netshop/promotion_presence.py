"""Versioned, derived JSON number-presence bits; no ORM or metric algorithms.

The first *existing* key wins, including JSON null. All keys absent (or a
non-object root) yields SQL NULL, distinct from an existing non-number.
"""
from decimal import Decimal
import math

RULE = "jd-ad-presence-v1"
ALIASES = (
    ("spendCents", "花费"),
    ("netTransactionAmountCents", "总订单金额"),
    ("impressions", "展现数"),
    ("clicks", "点击数"),
    ("netOrders", "总订单行"),
)
BITS = {names: 1 << i for i, names in enumerate(ALIASES)}
MAX_MASK = (1 << len(ALIASES)) - 1
FIELDS = (
    "numeric_presence_mask", "numeric_presence_null_mask", "numeric_presence_rule",
    "numeric_presence_row_hash", "numeric_presence_batch_id",
)


def cache_values(source, dataset, metrics, row_hash, batch_id):
    empty = dict.fromkeys(FIELDS)
    if (source, dataset) != ("jd_promotion", "ad"):
        return empty
    numbers, nulls = 0, 0
    for names, bit in BITS.items():
        if not isinstance(metrics, dict) or not any(key in metrics for key in names):
            nulls |= bit
            continue
        value = next(metrics[key] for key in names if key in metrics)
        if type(value) in (int, float, Decimal):
            if (isinstance(value, Decimal) and not value.is_finite()) or (
                isinstance(value, float) and not math.isfinite(value)
            ):
                return empty  # Invalid JSON numbers cannot be certified.
            numbers |= bit
    return dict(zip(FIELDS, (numbers, nulls, RULE, row_hash, batch_id)))
