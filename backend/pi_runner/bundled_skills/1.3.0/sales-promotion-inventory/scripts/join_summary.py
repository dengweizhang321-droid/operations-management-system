"""Synthetic/local authorized input only: {sales:[...],promotion:[...],inventory:[...]}.
Rows use product_code plus amount_cents/spend_cents/available respectively.
Amounts retain source integer cents and refunds; duplicate source groups aggregate.
"""
import json
from pathlib import Path
import sys

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
result = {}
for collection, field in [("sales", "amount_cents"), ("promotion", "spend_cents"), ("inventory", "available")]:
    for row in value.get(collection, []):
        code = row["product_code"]
        if not isinstance(code, str) or type(row[field]) is not int:
            raise ValueError("invalid_source_row")
        target = result.setdefault(code, {"product_code": code, "amount_cents": None, "spend_cents": None, "available": None})
        target[field] = (target[field] or 0) + row[field]
Path(sys.argv[2]).write_text(json.dumps(list(result.values()), ensure_ascii=False, indent=2), encoding="utf-8")
