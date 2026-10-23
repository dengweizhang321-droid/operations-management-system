import sys
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, column_index_from_string

path = sys.argv[1]
wb = load_workbook(path, data_only=False)
print("SHEETS:", wb.sheetnames)
ws = wb[sys.argv[2]]
c1 = column_index_from_string(sys.argv[3])
c2 = column_index_from_string(sys.argv[4])
rows = [int(x) for x in sys.argv[5].split(",")]
hdrs = [ws.cell(row=3, column=c).value for c in range(c1, c2 + 1)]
print("cols:", list(zip([get_column_letter(c) for c in range(c1, c2 + 1)], hdrs)))
for r in rows:
    print(f"--- row {r} ({ws.cell(row=r, column=1).value!r})")
    for c in range(c1, c2 + 1):
        print(f"   {get_column_letter(c)}{r} {hdrs[c-c1]!r} = {ws.cell(row=r, column=c).value!r}")
