import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=True)
ws = wb[sys.argv[2]]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
print("SHEET:", ws.title, ws.max_row, ws.max_column)
for c in range(1, ws.max_column + 1):
    col = [ws.cell(row=r, column=c).value for r in range(1, n + 1)]
    print(f"{get_column_letter(c)}: {col}")
