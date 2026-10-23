import sys, zipfile, re
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
print("SHEETS:", wb.sheetnames)
for ws in wb.worksheets:
    print("=" * 70)
    print("SHEET:", ws.title, "dims", ws.calculate_dimension(), "max_row", ws.max_row, "max_col", ws.max_column)
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=int(sys.argv[2]) if len(sys.argv) > 2 else 5, values_only=True)):
        print(f"  R{i+1}: {row}")
    if i > 20:
        break
wb.close()
