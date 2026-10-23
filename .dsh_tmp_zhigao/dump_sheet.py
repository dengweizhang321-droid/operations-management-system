import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
ws = wb[sys.argv[2]] if len(sys.argv) > 2 else wb.worksheets[0]
print("SHEET:", ws.title, ws.dimensions, ws.max_row, ws.max_column)
for r in range(1, ws.max_row + 1):
    vals = []
    for c in range(1, ws.max_column + 1):
        cell = ws.cell(row=r, column=c)
        v = cell.value
        if v is None:
            continue
        letter = get_column_letter(c)
        vals.append(f"{letter}{r}={v!r}")
    print(f"R{r}: " + " | ".join(vals))
