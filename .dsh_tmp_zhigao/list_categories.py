import sys
import pandas as pd
df = pd.read_pickle(sys.argv[1])
print("unique 货品分类 count:", df["货品分类"].nunique())
for k in sorted(df["货品分类"].dropna().astype(str).unique()):
    print("   ", k)
# also: categories present in Oct 2025 weeks
df["发货日期"] = df["发货日期"].astype(str).str.slice(0, 10)
oct25 = df[(df["发货日期"] >= "2025-09-29") & (df["发货日期"] <= "2025-10-31")]
print("Oct-2025 categories:", sorted(oct25["货品分类"].dropna().astype(str).unique()))
print("周时间 for Oct 2025 rows:", sorted(oct25["周时间"].dropna().astype(str).unique()))
