"""Generate pure owning-calendar fixtures. No DB connection or source reads."""
import json
import os
from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"backend"))
os.environ.update(DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", TERUISI_DJANGO_DATABASE_URL="", TERUISI_DJANGO_SQLITE_PATH=str(ROOT/".runtime"/"unused-calendar-fixtures.sqlite3"))
import django
django.setup()
from netshop.store_overview import periods, window
from sales.summary import _custom_comparison_period
from sales.query import add_years

cases = [
    ("2026-09-03", "2026-09-03", "today"),
    ("2026-09-02", "2026-09-02", "yesterday"),
    ("2026-09-24", "2026-09-30", "last7"),
    ("2026-09-24", "2026-09-30", "custom"),
    ("2026-09-16", "2026-09-30", "last15"),
    ("2026-09-01", "2026-09-30", "last30"),
    ("2026-03-01", "2026-03-31", "month"),
    ("2026-09-01", "2026-09-04", "month"),
    ("2026-09-03", "2026-09-04", "custom"),
    ("2026-09-03", "2026-09-04", "rolling"),
    ("2026-03-29", "2026-03-31", "custom"),
    ("2024-02-28", "2024-02-29", "custom"),
    ("2026-08-28", "2026-09-04", "custom"),
    ("2026-01-01", "2026-03-31", "quarter"),
    ("2026-01-01", "2026-01-01", "quarter"),
    ("2026-07-01", "2026-09-30", "quarter"),
    ("2026-07-01", "2026-08-15", "quarter"),
    ("2025-02-28", "2026-02-28", "custom"),
]
fixtures = [{"input": {"startDate": s, "endDate": e, "kind": kind, "maximumCurrentDays": 366}, "expected": periods(s, e, kind)} for s, e, kind in cases]
for s, e in [("2024-01-01", "2025-12-30"), ("2025-02-28", "2027-02-27")]:
    ps, pe = _custom_comparison_period(date.fromisoformat(s), date.fromisoformat(e))
    fixtures.append({"input": {"startDate": s, "endDate": e, "kind": "custom", "maximumCurrentDays": 730}, "expected": {"timezone": "Asia/Shanghai", "rule": "紧邻之前的等长区间", "ruleVersion": "sales-period-v1", "current": window(s, e), "previous": window(ps, pe), "yearAgo": window(add_years(s, -1), add_years(e, -1))}})
path = ROOT/"lib/netshop/fixtures/periods.synthetic.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({"fixture": "owning-sales-period-v1-synthetic", "source": ["netshop.store_overview.periods", "sales.summary._custom_comparison_period", "sales.summary._period_for", "sales.query.add_years"], "databaseRead": False, "cases": fixtures}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(f"Generated {len(fixtures)} pure owning-calendar fixtures: {path}")
