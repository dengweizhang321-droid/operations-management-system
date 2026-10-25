import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
ws = wb[sys.argv[2]]

# overview: for each row, list non-empty column letters (compressed ranges)
def compress(cols):
    out = []
    start = prev = None
    for c in cols:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev))
            start = prev = c
    if start is not None:
        out.append((start, prev))
    parts = []
    for a, b in out:
        if a == b:
            parts.append(get_column_letter(a))
        else:
            parts.append(f"{get_column_letter(a)}-{get_column_letter(b)}")
    return ",".join(parts)

print("SHEET:", ws.title, ws.dimensions, "rows", ws.max_row, "cols", ws.max_column)
for r in range(1, ws.max_row + 1):
    cols = [c for c in range(1, ws.max_column + 1) if ws.cell(row=r, column=c).value is not None]
    if cols:
        print(f"R{r} ({len(cols)}): {compress(cols)}")
