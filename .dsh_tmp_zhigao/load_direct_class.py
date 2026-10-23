import sys
import pandas as pd

pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 200)
path = sys.argv[1]
df = pd.read_excel(path, sheet_name="Sheet3", engine="openpyxl")
print("rows:", len(df), "cols:", list(df.columns))
d = df["发货时间"].astype(str).str.slice(0, 10)
df["发货日期"] = d
df["渠道大类"] = df["销售渠道"].astype(str).str.split("-").str[0]
print("date range:", d.min(), d.max())
print("channel counts:", df["渠道大类"].value_counts().to_dict())
CH4 = ["天猫", "京东", "拼多多", "抖店"]
print("直销机分类 vs 货品细分 sample:")
print(df[["货品细分", "直饮机分类"]].drop_duplicates().to_string())
for label, a, b in [("2025-10-05..10-11", "2025-10-05", "2025-10-11"), ("2025-10-12..10-18", "2025-10-12", "2025-10-18")]:
    w = df[(df["发货日期"] >= a) & (df["发货日期"] <= b)]
    print("=" * 70)
    print(label, "rows:", len(w), "total:", round(float(w["分摊后金额"].sum()), 2))
    for tag, sub in (("ALL", w), ("4CH", w[w["渠道大类"].isin(CH4)])):
        g = sub.groupby("直饮机分类")["分摊后金额"].sum().round(2)
        print(f"  --{tag}--")
        print(g.to_string())
