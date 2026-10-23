import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
ws = wb[sys.argv[2]]
rows = [int(x) for x in sys.argv[3].split(",")]

hdr = []
for r in rows:
    hdr.append((r, [ws.cell(row=r, column=c).value for c in range(1, ws.max_column + 1)]))

print("SHEET:", ws.title, ws.max_column, "cols")
prev = None
for c in range(1, ws.max_column + 1):
    vals = tuple(hdr[i][1][c - 1] for i in range(len(hdr)))
    if vals != prev:
        print(f"{get_column_letter(c)}: {vals}")
        prev = vals
print("-" * 40, "merged ranges")
for m in sorted(ws.merged_cells.ranges, key=lambda x: (x.min_row, x.min_col)):
    print(m, ws.cell(row=m.min_row, column=m.min_col).value)
