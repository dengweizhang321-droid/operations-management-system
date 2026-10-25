import sys, os
from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

xlsx = sys.argv[1]
wb = load_workbook(xlsx, data_only=True)
ws = wb["类目销售情况"]
for col in ["JP", "JT", "JX", "KA"]:
    ci = column_index_from_string(col)
    vals = [ws.cell(row=r, column=ci).value for r in range(5, 69)]
    nums = [v for v in vals if isinstance(v, (int, float))]
    tot = ws.cell(row=69, column=ci).value
    print(f"{col}: sum(rows5-68 numeric)={sum(nums):,.2f}  count={len(nums)}  total_row({col}69)={tot}  match={abs(sum(nums) - (tot or 0)) < 0.02}")
    blank = [5 + i for i, v in enumerate(vals) if v is None]
    print(f"   blank rows: {blank}")
    errs = [5 + i for i, v in enumerate(vals) if isinstance(v, str)]
    print(f"   text/error rows: {errs} -> {[ws.cell(row=r, column=1).value for r in errs]}")

print("lock file present:", os.path.exists(os.path.join(os.path.dirname(xlsx), "~$" + os.path.basename(xlsx))))
print("mtime:", __import__("datetime").datetime.fromtimestamp(os.path.getmtime(xlsx)))
