import sys
import pandas as pd
from openpyxl import load_workbook

pd.set_option("display.width", 260)
pd.set_option("display.max_rows", 500)
xlsx, pkl = sys.argv[1], sys.argv[2]
df = pd.read_pickle(pkl)
df["发货日期"] = df["发货日期"].astype(str).str.slice(0, 10)
df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
df = df[df["渠道大类"] != "销售渠道"]
CH4 = ["天猫", "京东", "拼多多", "抖店"]

weeks = [("JT", "2025-10-01", "2025-10-05"), ("JP", "2025-09-28", "2025-10-04"), ("JX", "2025-10-05", "2025-10-11")]
from openpyxl.utils import column_index_from_string
ann = {}
for name, a, b in weeks:
    w = df[(df["发货日期"] >= a) & (df["发货日期"] <= b)]
    ann[name] = {}
    ann[name]["ALL"] = w.groupby("货品分类")["分摊后金额"].sum()
    ann[name]["4CH"] = w[w["渠道大类"].isin(CH4)].groupby("货品分类")["分摊后金额"].sum()

wb = load_workbook(xlsx, data_only=True)
ws = wb["类目销售情况"]
cols = {n: column_index_from_string(n) for n, _, _ in weeks}
print(f"{'row':<4}{'报告行标签':<18}" + "".join(f"{n+'报告':>13}{n+'_ALL':>13}{n+'_4CH':>13}" for n, _, _ in weeks))
infer = {}
for r in range(5, 70):
    cat = ws.cell(row=r, column=1).value
    line = f"{r:<4}{str(cat):<18}"
    for n, _, _ in weeks:
        cur = ws.cell(row=r, column=cols[n]).value
        cur = round(float(cur), 2) if isinstance(cur, (int, float)) else cur
        av = ann[n]["ALL"].get(cat)
        c4 = ann[n]["4CH"].get(cat)
        line += f"{str(cur):>13}{'' if av is None else round(float(av),2):>13}{'' if c4 is None else round(float(c4),2):>13}"
    print(line)
print()
print("annual category -> 4CH value for 2025-10-12..10-18 (target week):")
w = df[(df["发货日期"] >= "2025-10-12") & (df["发货日期"] <= "2025-10-18")]
w4 = w[w["渠道大类"].isin(CH4)]
g4 = w4.groupby("货品分类")["分摊后金额"].sum().round(2)
ga = w.groupby("货品分类")["分摊后金额"].sum().round(2)
print(f"{'分类':<20}{'4CH':>14}{'ALL':>14}")
for k in sorted(set(g4.index) | set(ga.index), key=str):
    print(f"{str(k):<20}{float(g4.get(k,0)):>14,.2f}{float(ga.get(k,0)):>14,.2f}")
print(f"{'TOTAL':<20}{float(w4['分摊后金额'].sum()):>14,.2f}{float(w['分摊后金额'].sum()):>14,.2f}")
print("rows:", len(w4), len(w))
