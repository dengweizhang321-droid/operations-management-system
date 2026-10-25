import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
wbv = load_workbook(path, data_only=True)
print("SHEETS:", wb.sheetnames)
ws = wb["类目销售情况"]
wsv = wbv["类目销售情况"]
print("dims", ws.dimensions, ws.max_row, ws.max_column, "freeze", ws.freeze_panes)
# headers from col JE to end
print("--- headers")
for c in range(1, ws.max_column + 1):
    h3 = ws.cell(row=3, column=c).value
    h4 = ws.cell(row=4, column=c).value
    if h3 and str(h3).startswith(("26年", "25年", "24年", "环比", "同比")):
        print(f"  {get_column_letter(c)}: {h3!r} / {h4!r}")
print("--- col A + last 12 columns (formula | cached)")
for r in range(4, ws.max_row + 1):
    label = ws.cell(row=r, column=1).value
    parts = []
    for c in range(ws.max_column - 11, ws.max_column + 1):
        f = ws.cell(row=r, column=c).value
        v = wsv.cell(row=r, column=c).value
        L = get_column_letter(c)
        parts.append(f"{L}={f!r}|{v!r}")
    print(f"R{r} {label!r}: " + "  ".join(parts))
print("--- Sheet3")
ws3 = wb["Sheet3"]
for c in range(1, ws3.max_column + 1):
    print(f"  {get_column_letter(c)}: {[ws3.cell(row=r, column=c).value for r in range(1, 5)]}")
print("  Sheet3 dims", ws3.dimensions)
