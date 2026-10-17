import json
import math
from pathlib import Path
import sys

rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
result = []
for row in rows:
    for field in ["available", "in_transit", "positive_units", "window_days", "target_days"]:
        if type(row.get(field)) not in {int, float} or not math.isfinite(row[field]) or row[field] < 0:
            raise ValueError("missing_or_invalid_" + field)
    if row["window_days"] <= 0 or row["target_days"] <= 0:
        raise ValueError("invalid_days")
    daily = row["positive_units"] / row["window_days"]
    result.append({**row, "daily_positive_units": daily,
                   "suggested_units": max(0, math.ceil(daily * row["target_days"] - row["available"] - row["in_transit"]))})
Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
