import sys
import pandas as pd
from openpyxl import load_workbook

pd.set_option("display.width", 220)
path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb["Sheet3"]
rows = list(ws.iter_rows(values_only=True))
hdr = list(rows[0])
print("Sheet3 cols:", hdr)
i = hdr.index("直饮机分类") if "直饮机分类" in hdr else None
print("直饮机分类 index:", i)
if i is not None:
    vals = pd.Series([r[i] for r in rows[1:] if r[i] is not None])
    print(vals.value_counts().to_string())
# check the other pivot sheets for the extra category names
for name in ["GMV数据透视", "Sheet4", "Sheet7", "Sheet2"]:
    ws2 = wb[name]
    print("=" * 60)
    print(name, ws2.max_row, ws2.max_column)
    for r in ws2.iter_rows(min_row=1, max_row=min(ws2.max_row, 70), values_only=True):
        cells = [str(v) for v in r if v is not None]
        if cells:
            print("   ", " | ".join(cells))
wb.close()
