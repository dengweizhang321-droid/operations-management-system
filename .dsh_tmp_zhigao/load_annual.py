import sys
import pandas as pd

path = sys.argv[1]
usecols = ["周时间", "销售渠道", "货品分类", "分摊后金额", "发货日期", "发货时间"]
df = pd.read_excel(path, sheet_name="数据源", usecols=usecols, engine="openpyxl")
print("rows:", len(df), "cols:", list(df.columns))
print("发货日期 sample:", df["发货日期"].dropna().head(3).tolist())
print("发货时间 sample:", df["发货时间"].dropna().head(3).tolist())
ch = df["销售渠道"].dropna().astype(str)
print("n channels:", ch.nunique())
for c in sorted(ch.unique().tolist()):
    print("   ", c)
print("prefix counts:")
print(ch.str.split("-").str[0].value_counts().to_string())
print("周时间 count:", df["周时间"].nunique())
df.to_pickle(sys.argv[2])
