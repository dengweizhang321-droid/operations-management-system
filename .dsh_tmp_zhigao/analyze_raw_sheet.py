import sys
import pandas as pd

pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 400)
path = sys.argv[1]
df = pd.read_excel(path, sheet_name="25年10月5-11", engine="openpyxl")
print("rows:", len(df), "cols:", list(df.columns))
ch = df["销售渠道"].astype(str)
df["渠道大类"] = ch.str.split("-").str[0]
print("channel prefix counts:")
print(df["渠道大类"].value_counts().to_string())
print("发货时间 range:", str(df["发货时间"].iloc[:, 0].min()) if hasattr(df["发货时间"], "iloc") and df["发货时间"].ndim > 1 else df["发货时间"].min(),
      "->", str(df["发货时间"].iloc[:, 0].max()) if hasattr(df["发货时间"], "iloc") and df["发货时间"].ndim > 1 else df["发货时间"].max())
print("total 分摊后金额 ALL:", df["分摊后金额"].sum())
CH4 = ["天猫", "京东", "拼多多", "抖店"]
s4 = df[df["渠道大类"].isin(CH4)]
print("total 4CH:", s4["分摊后金额"].sum(), "rows", len(s4))
print("=" * 60)
print("per 货品细分 (ALL):")
print(df.groupby("货品细分")["分摊后金额"].sum().round(2).to_string())
print("=" * 60)
print("per 货品细分 (4CH):")
print(s4.groupby("货品细分")["分摊后金额"].sum().round(2).to_string())
print("=" * 60)
print("per 渠道大类 sum:")
print(df.groupby("渠道大类")["分摊后金额"].sum().round(2).to_string())
