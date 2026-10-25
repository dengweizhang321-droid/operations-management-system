import sys
import pandas as pd

pd.set_option("display.width", 200)
pd.set_option("display.max_rows", 300)
df = pd.read_pickle(sys.argv[1])

df["发货日期"] = df["发货日期"].astype(str).str.slice(0, 10)
ch = df["销售渠道"].astype(str)
df["渠道大类"] = ch.str.split("-").str[0]
df = df[df["渠道大类"] != "销售渠道"]

print("date range:", df["发货日期"].min(), "->", df["发货日期"].max())

CH4 = ["天猫", "京东", "拼多多", "抖店"]

def week(a, b):
    return df[(df["发货日期"] >= a) & (df["发货日期"] <= b)]

for label, a, b in [("2025-10-05..10-11", "2025-10-05", "2025-10-11"),
                    ("2025-09-28..10-04", "2025-09-28", "2025-10-04"),
                    ("2025-10-12..10-18", "2025-10-12", "2025-10-18")]:
    w = week(a, b)
    print("=" * 70)
    print(label, "rows:", len(w))
    tot = w["分摊后金额"].sum()
    print(f"  ALL channels 分摊后金额 = {tot:,.2f}")
    for c in CH4:
        sub = w[w["渠道大类"] == c]
        print(f"    {c}: {len(sub):6d} rows  {sub['分摊后金额'].sum():>15,.2f}")
    sub4 = w[w["渠道大类"].isin(CH4)]
    print(f"  4CH sum = {sub4['分摊后金额'].sum():,.2f}  rows={len(sub4)}")
    other = w[~w["渠道大类"].isin(CH4)]
    print(f"  other channels: {other.groupby('渠道大类')['分摊后金额'].agg(['count','sum']).to_string()}")
    print("  per 货品分类 (4CH):")
    print(sub4.groupby("货品分类")["分摊后金额"].sum().round(2).to_string())
