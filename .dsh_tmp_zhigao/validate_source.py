import sys
import pandas as pd
from openpyxl import load_workbook

pd.set_option("display.width", 240)
pd.set_option("display.max_rows", 400)
xlsx, pkl = sys.argv[1], sys.argv[2]
df = pd.read_pickle(pkl)
df["发货日期"] = df["发货日期"].astype(str).str.slice(0, 10)
df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
df = df[df["渠道大类"] != "销售渠道"]

wb = load_workbook(xlsx, data_only=True)
ws = wb["类目销售情况"]
CH4 = ["天猫", "京东", "拼多多", "抖店"]

weeks = [
    ("JT", "2025-10-01", "2025-10-05"),
    ("JP", "2025-09-28", "2025-10-04"),
    ("JX", "2025-10-05", "2025-10-11"),
]
computed = {}
for col, a, b in weeks:
    w = df[(df["发货日期"] >= a) & (df["发货日期"] <= b)]
    computed[col] = {
        "ALL": w.groupby("货品分类")["分摊后金额"].sum(),
        "4CH": w[w["渠道大类"].isin(CH4)].groupby("货品分类")["分摊后金额"].sum(),
    }

hdr = {c: ws.cell(row=3, column=c).value for c in [ws.max_column - 1]}
# map column letters
from openpyxl.utils import column_index_from_string
cols = {name: column_index_from_string(name) for name, _, _ in weeks}
print("categories:", ws.max_row)
summary = {}
for name, _, _ in weeks:
    ci = cols[name]
    print("=" * 100)
    print(f"COLUMN {name}: {ws.cell(row=3, column=ci).value}")
    rows = []
    for r in range(5, 69):
        cat = ws.cell(row=r, column=1).value
        cur = ws.cell(row=r, column=ci).value
        if cat is None:
            continue
        allv = computed[name]["ALL"].get(cat)
        c4v = computed[name]["4CH"].get(cat)
        allv = None if allv is None else round(float(allv), 2)
        c4v = None if c4v is None else round(float(c4v), 2)
        cur = None if cur is None else (round(float(cur), 2) if isinstance(cur, (int, float)) else cur)
        m_all = (cur is not None and allv is not None and abs(cur - allv) < 0.02)
        m_4 = (cur is not None and c4v is not None and abs(cur - c4v) < 0.02)
        if cur is None and allv is None and c4v is None:
            continue
        rows.append((cat, cur, allv, c4v, "ALL" if m_all else ("4CH" if m_4 else "DIFF")))
    n_all = sum(1 for x in rows if x[4] == "ALL")
    n_4 = sum(1 for x in rows if x[4] == "4CH")
    n_diff = sum(1 for x in rows if x[4] == "DIFF")
    print(f"{'category':<22}{'report':>14}{'annual ALL':>14}{'annual 4CH':>14}  match")
    for cat, cur, allv, c4v, tag in rows:
        if tag == "DIFF":
            print(f"{cat:<22}{str(cur):>14}{str(allv):>14}{str(c4v):>14}  {tag}")
    print(f"  -> exact: ALL={n_all}  4CH={n_4}  DIFF={n_diff}  (of {len(rows)})")
    # totals
    tot_report = sum(x[1] for x in rows if isinstance(x[1], (int, float)))
    tot_all = sum(x[2] for x in rows if isinstance(x[2], (int, float)))
    tot_4 = sum(x[3] for x in rows if isinstance(x[3], (int, float)))
    print(f"  sum(report rows)={tot_report:,.2f}  sum(annual ALL)={tot_all:,.2f}  sum(annual 4CH)={tot_4:,.2f}")
