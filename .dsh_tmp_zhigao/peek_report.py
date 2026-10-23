import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

for path in sys.argv[1:]:
    print("=" * 90)
    print("FILE:", path)
    wb = load_workbook(path, read_only=True, data_only=True)
    print("SHEETS:", wb.sheetnames)
    ws = wb.worksheets[0]
    print("first sheet:", ws.title, ws.max_row, ws.max_column)
    rows = ws.iter_rows(min_row=1, max_row=6, values_only=True)
    for i, row in enumerate(rows):
        cells = [f"{get_column_letter(j+1)}{i+1}={v!r}" for j, v in enumerate(row) if v is not None]
        print("  " + " | ".join(cells[:60]))
    wb.close()
