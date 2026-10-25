import sys
import pandas as pd

pd.set_option("display.width", 200)
oct25 = pd.read_pickle(sys.argv[1])
oct25["发货日期"] = oct25["发货时间.1"].astype(str).str.slice(0, 10)
oct25["渠道大类"] = oct25["销售渠道"].astype(str).str.split("-").str[0]
CH4 = ["天猫", "京东", "拼多多", "抖店"]

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string
wb = load_workbook(sys.argv[2], data_only=True)
ws = wb["类目销售情况"]

overlap = ["桌面直饮机", "幼儿园机", "厨下开水器"]
targets = {"JT": ("2025-10-01", "2025-10-05"), "JP": ("2025-09-28", "2025-10-04"), "JX": ("2025-10-05", "2025-10-11")}
for col, (a, b) in targets.items():
    ci = column_index_from_string(col)
    want = ws.cell(row=69, column=ci).value
    w = oct25[(oct25["发货日期"] >= a) & (oct25["发货日期"] <= b)]
    w4 = w[w["渠道大类"].isin(CH4)]
    rowsum = sum(ws.cell(row=r, column=ci).value for r in range(5, 69) if isinstance(ws.cell(row=r, column=ci).value, (int, float)))
    ov = sum(ws.cell(row=r, column=ci).value for r in range(5, 69)
             if ws.cell(row=r, column=1).value in overlap and isinstance(ws.cell(row=r, column=ci).value, (int, float)))
    print(f"=== {col} ({a}..{b}) 报告总计={want:,.2f}")
    print(f"    sum(report rows)        = {rowsum:,.2f}   diff={rowsum-want:,.2f}")
    print(f"    sum(rows) - overlap rows= {rowsum-ov:,.2f}   diff={rowsum-ov-want:,.2f}")
    print(f"    oct25 ALL 细分 total    = {w['分摊后金额'].sum():,.2f}   diff={w['分摊后金额'].sum()-want:,.2f}")
    print(f"    oct25 4CH 细分 total    = {w4['分摊后金额'].sum():,.2f}   diff={w4['分摊后金额'].sum()-want:,.2f}")
    print(f"    oct25 ALL rows={len(w)} 4CH rows={len(w4)}")
