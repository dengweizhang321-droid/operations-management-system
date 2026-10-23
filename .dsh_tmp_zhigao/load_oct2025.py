import sys
import pandas as pd

pd.set_option("display.width", 220)
pd.set_option("display.max_rows", 500)
path = sys.argv[1]
df = pd.read_excel(path, sheet_name="sheetTitle", engine="openpyxl")
print("rows:", len(df))
print("cols:", list(df.columns))
ch = df["销售渠道"].astype(str)
df["渠道大类"] = ch.str.split("-").str[0]
print("channel prefixes:", df["渠道大类"].value_counts().to_dict())
# date columns
dcol = [c for c in df.columns if str(c).startswith("发货时间")]
print("date-like cols:", dcol)
print("last col sample:", df[dcol[-1]].dropna().head(3).tolist())
print("货品细分 unique:", sorted(df["货品细分"].dropna().astype(str).unique().tolist()))
print("货品分类 unique:", sorted(df["货品分类"].dropna().astype(str).unique().tolist()))
df.to_pickle(sys.argv[2])
