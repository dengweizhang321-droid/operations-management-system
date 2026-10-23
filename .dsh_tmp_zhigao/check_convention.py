import sys
import pandas as pd
from openpyxl import load_workbook

pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 400)
path = sys.argv[1]
wb = load_workbook(path, data_only=True)

print("=== Sheet3 (pivot for current week KA) ===")
ws3 = wb["Sheet3"]
piv = {}
for r in range(1, ws3.max_row + 1):
    a = ws3.cell(row=r, column=1).value
    b = ws3.cell(row=r, column=2).value
    if a is not None and r > 3:
        piv[a] = b
for k, v in piv.items():
    print(f"   {k!r}: {v}")

raw = wb["26年10月12-19号"]
rows = list(raw.iter_rows(values_only=True))
hdr = rows[0]
print("=== raw headers ===")
for i, h in enumerate(hdr):
    print(f"  {i}: {h!r}")
df = pd.DataFrame(rows[1:], columns=list(hdr))
df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
print("channel counts:", df["渠道大类"].value_counts().to_dict())
CH4 = ["天猫", "京东", "拼多多", "抖店"]
print("total ALL:", df["分摊后金额"].sum())
print("total 4CH:", df[df["渠道大类"].isin(CH4)]["分摊后金额"].sum())
print("date range 发货时间:", df["发货时间"].min(), "->", df["发货时间"].max())
print("=== compare pivot vs computed (4CH) and (ALL) ===")
c4 = df[df["渠道大类"].isin(CH4)].groupby("货品分类")["分摊后金额"].sum()
call = df.groupby("货品分类")["分摊后金额"].sum()
keys = sorted(set(piv) | set(c4.index) | set(call.index), key=str)
print(f"{'分类':<24}{'pivot':>14}{'4CH':>14}{'ALL':>14}  match")
for k in keys:
    p = piv.get(k)
    a = round(float(c4.get(k, 0)), 2)
    b = round(float(call.get(k, 0)), 2)
    tag = "4CH" if (p is not None and abs(p - a) < 0.005) else ("ALL" if (p is not None and abs(p - b) < 0.005) else ("" if p is not None else "-"))
    print(f"{str(k):<24}{p if p is None else round(float(p),2):>14}{a:>14}{b:>14}  {tag}")
print("pivot total:", round(sum(v for k, v in piv.items() if k != "总计"), 2))
