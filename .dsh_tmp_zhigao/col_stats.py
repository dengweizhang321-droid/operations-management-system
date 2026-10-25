import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
ws = wb[sys.argv[2]]
r1, r2 = int(sys.argv[3]), int(sys.argv[4])
print("col | header3 | header4 | nonempty | empty_rows")
for c in range(2, ws.max_column + 1):
    filled = sum(1 for r in range(r1, r2 + 1) if ws.cell(row=r, column=c).value not in (None, ""))
    empties = [r for r in range(r1, r2 + 1) if ws.cell(row=r, column=c).value in (None, "")]
    h3 = ws.cell(row=3, column=c).value
    h4 = ws.cell(row=4, column=c).value
    print(f"{get_column_letter(c)} | {h3} | {h4} | {filled}/{r2-r1+1} | {empties if len(empties) <= 25 else str(len(empties)) + ' rows'}")
